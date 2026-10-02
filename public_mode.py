"""Public mode: one Sednar server where people sign up, log in and use their own API key.

Always on: Sednar runs only as this public app. Accounts are in public_accounts.py. Each user
gets a folder of their own under SEDNAR_PUBLIC_ROOT, with a sample project in it. Their API keys are saved
encrypted with a key only their password gives, and are held in memory while they are logged in; their
agent settings and preferences are saved in their folder.

The terminal runs in a bubblewrap jail (sandbox.py) that sees only the user's own folder, with no network.
Every git the server starts for a user's folder runs in that jail too, since the terminal can write .git.
Everything else that runs programs on the server is off: the agent's run_command and background commands,
MCP servers and language servers. Every path in a request or socket event must stay inside the user's folder.

The patches below swap module-level functions, so the rest of Sednar runs as it does on a laptop.
"""
from __future__ import annotations

import contextvars
import copy
import functools
import json
import logging
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable
from urllib.parse import urlparse

# Sednar is a public app: always on. Only the test suite turns it off (SEDNAR_PUBLIC=0), to test the parts below it.
ENABLED = os.environ.get("SEDNAR_PUBLIC", "1").strip().lower() not in ("0", "false", "no", "off")
ROOT = os.path.realpath(os.path.expanduser(os.environ.get("SEDNAR_PUBLIC_ROOT") or "~/sednar-visitors"))
DB_PATH = os.path.realpath(os.path.expanduser(os.environ.get("SEDNAR_PUBLIC_DB") or os.path.join(ROOT, "accounts.sqlite3")))
SESSION_DAYS = float(os.environ.get("SEDNAR_PUBLIC_SESSION_DAYS") or 30)
MAX_USERS = int(os.environ.get("SEDNAR_PUBLIC_MAX_USERS") or 500)
# The site's one address (e.g. https://sednar.com). Requests for any other host are sent there.
CANONICAL_URL = (os.environ.get("SEDNAR_PUBLIC_URL") or "").rstrip("/")
QUOTA_MB = int(os.environ.get("SEDNAR_PUBLIC_QUOTA_MB") or 500)
MAX_TURNS = int(os.environ.get("SEDNAR_PUBLIC_MAX_TURNS") or 2)
CONTACT = os.environ.get("SEDNAR_PUBLIC_CONTACT", "").strip()
MAX_CLONE_MB = int(os.environ.get("SEDNAR_PUBLIC_MAX_CLONE_MB") or 200)
# Where people can get the code to run it themselves; no link is shown without one.
SOURCE_URL = os.environ.get("SEDNAR_PUBLIC_SOURCE_URL", "").strip()
# The name the hosted site goes by.
BRAND = os.environ.get("SEDNAR_PUBLIC_BRAND") or "Sednar"
SAMPLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "sample-project")
SAMPLE_NAME = "hello-sednar"
COOKIE_KEY = "lc_vid"
LOGIN_KEY = "lc_sid"

logger = logging.getLogger("Sednar.public")

# A user id: the name before the @ (or the GitHub login) as a slug plus 8 random hex digits, e.g. amar-3f9c1a2b.
# Accounts made before that have 32 hex digits.
_VID_RE = re.compile(r"^(?:[0-9a-f]{32}|[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?-[0-9a-f]{8})$")
_visitor: contextvars.ContextVar[str | None] = contextvars.ContextVar("sednar_visitor", default=None)
_lock = threading.Lock()
_llm: dict[str, dict[str, Any]] = {}
# Per user: the logins (one per browser) that are open, and the key that unlocks their saved secrets.
# Both live only in memory, so a restart logs everyone out and nothing on disk can unlock the keys.
_logins: dict[str, set[str]] = {}
_unlock: dict[str, bytes] = {}
_github_tokens: dict[str, str] = {}
_attempts: dict[tuple[str, str], list[float]] = {}
_turns: dict[str, int] = {}
_usage: dict[str, tuple[float, int]] = {}
_port = 0

# Request fields that name files or folders. Values must stay inside the visitor's folder.
PATH_KEYS = frozenset({
    "path", "paths", "project_path", "workspace_path", "project", "parent", "parent_dir", "source", "dest_dir",
    "directory", "primary_path", "cwd", "file", "plan_file",
})
# HTTP fields that may also name a file relative to its own store (memory logs, plan files).
_RELATIVE_OK = frozenset({"path", "file", "plan_file"})
# Chat content: checked by the agent's own path rules when it is used, not by the request gate.
_CONTENT_KEYS = frozenset({
    "turn_messages", "messages", "transcript_html", "html", "content", "events", "attachments", "display_payload",
    "answers", "answer", "text", "question", "message", "turn_summary", "image", "settings", "details",
})

# Routes that run programs, reach the host machine, or change settings every visitor shares.
_BLOCKED_PREFIXES = ("/sednar-mcp/", "/sednar/lsp/")
_BLOCKED_ALWAYS = frozenset({"/sednar/settings/reset"})
_ALLOWED_IN_BLOCKED = frozenset({"/sednar/lsp/config", "/sednar-mcp/status"})
_OPEN_PREFIXES = ("/sednar/static/", "/sednar/assets/", "/host/static/", "/asset/", "/templates/js/")
_OPEN_PATHS = frozenset({"/healthz", "/favicon.ico", "/site.webmanifest", "/privacy"})
_AUTH_PATHS = frozenset({"/login", "/signup", "/logout", "/auth/github", "/auth/github/callback"})

_OFF_TOOLS = frozenset({"run_command", "kill_command", "restart_command", "command_status", "call_mcp_tool"})
_SOCKET_OFF = frozenset({"ide_reveal_path"})
_TERMINAL_EVENTS = frozenset({"terminal_init", "terminal_input", "terminal_resize"})
MAX_TERMINALS = int(os.environ.get("SEDNAR_PUBLIC_MAX_TERMINALS") or 2)
_SOCKET_REPLY = {
    "ide_list_files": ("ide_files_list", None), "ide_mkdir": ("ide_mkdir_result", None),
    "ide_read_file": ("ide_file_content", None), "ide_write_file": ("ide_file_saved", None),
    "ide_create_entry": ("ide_fs_result", "create"), "ide_rename_entry": ("ide_fs_result", "rename"),
    "ide_delete_entry": ("ide_fs_result", "delete"), "ide_transfer_entry": ("ide_fs_result", "transfer"),
    "ide_duplicate_entry": ("ide_fs_result", "duplicate"), "ide_reveal_path": ("ide_reveal_result", None),
}
# Git settings for every git the server starts. Command-line config outranks a repository's own, so a
# project cannot turn on fsmonitor, hooks or filters, or pass itself off as a bare repository.
_GIT_CONFIG = (
    ("core.fsmonitor", "false"), ("core.hooksPath", "/dev/null"), ("core.symlinks", "false"),
    ("core.pager", "cat"), ("safe.bareRepository", "explicit"), ("protocol.allow", "never"),
    ("protocol.https.allow", "always"), ("submodule.recurse", "false"), ("diff.external", ""),
)

OFF_MESSAGE = "{what} off on " + BRAND + "'s hosted site." + (f" To use it, run it on your own machine: {SOURCE_URL}" if SOURCE_URL else "")


class Refused(ValueError):
    pass


# --- visitors -------------------------------------------------------------------------------------

def current() -> str | None:
    """The visitor this request, socket event or agent thread works for."""
    vid = _visitor.get()
    if vid:
        return vid
    try:
        from flask import has_request_context, session
        if has_request_context():
            vid, sid = session.get(COOKIE_KEY), session.get(LOGIN_KEY)
            if isinstance(vid, str) and _VID_RE.match(vid) and isinstance(sid, str):
                with _lock:
                    if sid in _logins.get(vid, ()):
                        return vid
    except Exception:
        pass
    return None


def home(vid: str | None = None) -> str | None:
    vid = vid or current()
    return os.path.join(ROOT, vid) if vid else None


def sample_project(vid: str | None = None) -> str | None:
    base = home(vid)
    return os.path.join(base, SAMPLE_NAME) if base else None


def _names_user(name: str, vid: str) -> bool:
    """True when a slug made from a path (a project storage key) contains vid as a whole part."""
    return f"-{vid}-" in f"-{name}-"


def _inside(path: str, root: str) -> bool:
    real = os.path.realpath(path)
    return real == root or real.startswith(root + os.sep)


def ensure_home(vid: str) -> None:
    """Creates a user's folder with the sample project, unless it is already there."""
    base = home(vid)
    if os.path.isdir(base):
        return
    os.makedirs(os.path.join(base, ".sednar"), exist_ok=True)
    if os.path.isdir(SAMPLE_DIR):
        shutil.copytree(SAMPLE_DIR, os.path.join(base, SAMPLE_NAME))
    else:
        os.makedirs(os.path.join(base, SAMPLE_NAME), exist_ok=True)


def _lock_out(vid: str) -> None:
    """Drops what memory holds for a user who has no login open any more, and ends their terminals."""
    with _lock:
        _logins.pop(vid, None)
        _unlock.pop(vid, None)
        _github_tokens.pop(vid, None)
        _llm.pop(vid, None)
        pids = _terminal_pids.pop(vid, set())
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


# --- terminal -------------------------------------------------------------------------------------

_sandbox_ok = False
_terminal_pids: dict[str, set[int]] = {}


def _display_name(vid: str) -> str:
    """The name a user's terminal goes by: their id without its random part (amar-3f9c1a2b is amar)."""
    match = re.match(r"^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-[0-9a-f]{8}$", vid)
    return match.group(1)[:32] if match else "user"


def terminal_spec(cwd: str | None) -> tuple[list[str], dict[str, int], int]:
    """The command for this user's terminal: (argv, file descriptors to close after the fork, file size limit)."""
    vid = current()
    if not vid:
        raise Refused("You are logged out. Reload the page and log in again.")
    if not _sandbox_ok:
        raise Refused("The terminal needs a sandbox (bubblewrap) that this server does not have.")
    with _lock:
        if len(_terminal_pids.get(vid, ())) >= MAX_TERMINALS:
            raise Refused(f"You already have {MAX_TERMINALS} terminals open. Close one, then try again.")
    from sednar import sandbox
    argv, fds = sandbox.terminal(home(vid), _display_name(vid), cwd)
    return argv, fds, QUOTA_MB * 1024 * 1024


def terminal_started(pid: int) -> None:
    vid = current()
    if vid:
        with _lock:
            _terminal_pids.setdefault(vid, set()).add(pid)


def terminal_ended(pid: int) -> None:
    with _lock:
        for vid, pids in list(_terminal_pids.items()):
            pids.discard(pid)
            if not pids:
                _terminal_pids.pop(vid, None)


def forget(vid: str) -> None:
    """Deletes a user's folder and chats, and logs them out everywhere."""
    _lock_out(vid)
    shutil.rmtree(home(vid), ignore_errors=True)
    try:
        from sednar.project_store import PROJECTS_ROOT
        for name in os.listdir(PROJECTS_ROOT):
            if _names_user(name, vid):
                shutil.rmtree(os.path.join(PROJECTS_ROOT, name), ignore_errors=True)
    except OSError:
        pass


# --- paths ----------------------------------------------------------------------------------------

def _is_git_name(name: str) -> bool:
    return name.strip().rstrip("/").lower() == ".git"


def _check_path(value: str, vhome: str, *, relative_ok: bool) -> str:
    """value with ~ meaning the visitor's folder; Refused when it points outside that folder or into .git."""
    if not value:
        return value
    # A .git folder a visitor wrote could define filters or hooks that git would run.
    if any(_is_git_name(part) for part in value.replace("\\", "/").split("/")):
        raise Refused("The public demo does not change files inside .git.")
    if value == "~" or value.startswith("~/"):
        value = vhome + value[1:]
    elif value.startswith("~"):
        raise Refused("That location is outside your folder.")
    if os.path.isabs(value):
        if not _inside(value, vhome):
            raise Refused("That location is outside your folder.")
        return value
    if not relative_ok or ".." in value.replace("\\", "/").split("/"):
        raise Refused("Use a path inside your folder.")
    return value


def confine(payload: Any, vhome: str, *, relative_ok: bool, key: str = "") -> Any:
    """A copy of payload with every path field checked (Refused when one leaves the visitor's folder)."""
    if isinstance(payload, dict):
        out = {}
        for k, v in payload.items():
            name = str(k)
            if name in _CONTENT_KEYS:
                out[k] = v
            else:
                out[k] = confine(v, vhome, relative_ok=relative_ok, key=name)
        return out
    if isinstance(payload, list):
        return [confine(v, vhome, relative_ok=relative_ok, key=key) for v in payload]
    if isinstance(payload, str) and key in PATH_KEYS:
        return _check_path(payload.strip(), vhome, relative_ok=relative_ok and key in _RELATIVE_OK)
    if isinstance(payload, str) and key in ("name", "new_name") and _is_git_name(payload):
        raise Refused("The public demo does not change files inside .git.")
    return payload


def _confine_args(args, vhome: str):
    from werkzeug.datastructures import ImmutableMultiDict
    items = []
    for k, v in args.items(multi=True):
        if k == "workspace" and v:
            try:
                parsed = json.loads(v)
            except ValueError:
                raise Refused("Invalid workspace.")
            v = json.dumps(confine(parsed, vhome, relative_ok=False))
        elif k in PATH_KEYS:
            v = _check_path(v.strip(), vhome, relative_ok=k in _RELATIVE_OK)
        items.append((k, v))
    return ImmutableMultiDict(items)


def _allowed_root(root: str) -> bool:
    vhome = home()
    return _inside(root, vhome) if vhome else _inside(root, ROOT)


def _wrap_resolve_safe_path(original: Callable) -> Callable:
    @functools.wraps(original)
    def resolve_safe_path(project_path: str, rel_path: str):
        full, rel = original(project_path, rel_path)
        if full is None:
            return full, rel
        root = os.path.realpath(os.path.abspath(os.path.expanduser(project_path)))
        vhome = home()
        if not _allowed_root(root) or not (_inside(full, root) or (vhome and _inside(full, vhome))):
            return None, f"{rel_path} is outside the project. The public demo can only open files in your own folder."
        return full, rel
    return resolve_safe_path


def _wrap_path_blocked_for_edit(original: Callable) -> Callable:
    @functools.wraps(original)
    def path_blocked_for_edit(project_path: str, safe_rel: str):
        if any(_is_git_name(part) for part in (safe_rel or "").replace("\\", "/").split("/")):
            return "The public demo does not edit files inside .git."
        return original(project_path, safe_rel)
    return path_blocked_for_edit


def _wrap_workspace_loader(original: Callable) -> Callable:
    @functools.wraps(original)
    def load(*args, **kwargs):
        workspace = original(*args, **kwargs)
        for folder in getattr(workspace, "folders", None) or ():
            path = str(getattr(folder, "path", "") or "")
            if path and not _allowed_root(path):
                raise ValueError("A workspace folder is outside your folder in the public demo.")
        return workspace
    return load


# --- per-visitor settings ---------------------------------------------------------------------------

def _need_visitor() -> str:
    vid = current()
    if not vid:
        raise PermissionError("No visitor for this request.")
    return vid


def _llm_read() -> dict[str, Any]:
    vid = current()
    with _lock:
        return copy.deepcopy(_llm.get(vid) or {}) if vid else {}


def _llm_write(data: dict[str, Any]) -> None:
    from sednar import public_accounts
    vid = _need_visitor()
    with _lock:
        _llm[vid] = copy.deepcopy(data)
        key = _unlock.get(vid)
    if key is None:
        raise PermissionError("Log in again to save your keys.")
    public_accounts.save_secrets(vid, key, {"llm": data})


def _agent_path() -> str:
    return os.path.join(home(_need_visitor()), ".sednar", "agent.json")


def _agent_read() -> dict[str, Any]:
    try:
        with open(_agent_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _agent_write(data: dict[str, Any]) -> None:
    path = _agent_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    os.replace(path + ".tmp", path)


def _settings_path() -> str:
    return os.path.join(home(_need_visitor()), ".sednar", "settings.json")


def _plans_root(*, create: bool = True) -> str:
    root = os.path.join(home(_need_visitor()), ".sednar", "plans")
    if create:
        os.makedirs(root, exist_ok=True)
    return root


# --- tools and prompt -------------------------------------------------------------------------------

def _wrap_get_tools(original: Callable) -> Callable:
    @functools.wraps(original)
    def get_sednar_tools(*args, **kwargs):
        kwargs["enable_mcp"] = False
        result = original(*args, **kwargs)
        tools, bindings = result if isinstance(result, tuple) else (result, None)
        kept = [t for t in tools if not _tool_off(str((t.get("function") or {}).get("name") or ""))]
        return (kept, {}) if bindings is not None else kept
    return get_sednar_tools


def _tool_off(name: str) -> bool:
    return name in _OFF_TOOLS or name.startswith("lsp_")


def _wrap_dispatch(original: Callable) -> Callable:
    @functools.wraps(original)
    def dispatch_tool(project_path: str, name: str, args: dict, **kwargs):
        if _tool_off(name):
            return {"error": OFF_MESSAGE.format(what=f"The {name} tool is")}
        return original(project_path, name, args, **kwargs)
    return dispatch_tool


def _public_note(project_path: str) -> str:
    return (
        f"## {BRAND}, hosted\n"
        f"This chat runs on {BRAND}'s shared, hosted server. It is for reading and editing code: there is no shell "
        "(no commands, tests, package installs or dev servers), and no language or MCP servers. "
        "Read, search and edit files, and plan.\n"
        "When a task needs a command or a look in a browser, say what the user should run or check on their own machine."
    )


def _wrap_system_prompt(original: Callable) -> Callable:
    @functools.wraps(original)
    def build_system_prompt(project_path, *args, **kwargs):
        return f"{original(project_path, *args, **kwargs)}\n\n{_public_note(project_path)}"
    return build_system_prompt


# --- threads ---------------------------------------------------------------------------------------

def _carry_context_into_pools() -> None:
    """Agent work fanned out to thread pools keeps the visitor of the turn that started it."""
    if getattr(ThreadPoolExecutor.submit, "_sednar_public", False):
        return
    original = ThreadPoolExecutor.submit

    def submit(self, fn, /, *args, **kwargs):
        return original(self, contextvars.copy_context().run, fn, *args, **kwargs)

    submit._sednar_public = True
    ThreadPoolExecutor.submit = submit

    # Short-lived threads the agent starts for a visitor. Long-lived workers are not listed: they serve
    # every visitor, so they must never hold one visitor's keys.
    carry = {("sednar.harness", "_memory_upkeep"), ("sednar.harness", "_watchdog"),
             ("sednar.llm.settings", "_refresh")}
    start = threading.Thread.start

    def thread_start(self):
        target = getattr(self, "_target", None)
        if target is not None and (getattr(target, "__module__", ""), getattr(target, "__name__", "")) in carry:
            ctx = contextvars.copy_context()
            self._target = functools.partial(ctx.run, target)
        return start(self)

    threading.Thread.start = thread_start


# --- install ---------------------------------------------------------------------------------------

def _replace_everywhere(original: Any, replacement: Any) -> None:
    for module in list(sys.modules.values()):
        name = getattr(module, "__name__", "") or ""
        if not (name == "sednar" or name.startswith("sednar.") or name in ("ide_socket", "helpers")):
            continue
        for attr, value in list(vars(module).items()):
            if value is original:
                setattr(module, attr, replacement)


def _git_environment() -> None:
    os.environ["GIT_CONFIG_COUNT"] = str(len(_GIT_CONFIG))
    for i, (key, value) in enumerate(_GIT_CONFIG):
        os.environ[f"GIT_CONFIG_KEY_{i}"] = key
        os.environ[f"GIT_CONFIG_VALUE_{i}"] = value
    os.environ["GIT_TERMINAL_PROMPT"] = "0"
    os.environ["GIT_ALLOW_PROTOCOL"] = "https"
    os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
    if _sandbox_ok:
        # A terminal can write .git/config, so every git the server starts runs in the user's jail.
        from sednar import sandbox
        os.environ["PATH"] = sandbox.SHIM_DIR + os.pathsep + os.environ.get("PATH", "")
        os.environ[sandbox.ROOT_ENV] = ROOT
        os.environ["SEDNAR_PYTHON"] = sys.executable


def install(port: int) -> None:
    """Patches Sednar for public mode. Call before the routes and socket handlers are registered."""
    global _port
    if not ENABLED:
        return
    _port = int(port)
    os.makedirs(ROOT, exist_ok=True)
    from sednar import public_accounts
    public_accounts.configure(DB_PATH)
    # Relative paths that slip through resolve into an empty folder the server cannot write.
    jail = os.path.join(ROOT, ".cwd")
    os.makedirs(jail, exist_ok=True)
    os.chmod(jail, 0o555)
    os.chdir(jail)
    global _sandbox_ok
    from sednar import sandbox
    _sandbox_ok = sandbox.works()
    if not _sandbox_ok:
        logger.warning("Sednar public mode: no working bubblewrap sandbox, so the terminal is off.")
    _git_environment()
    _carry_context_into_pools()

    from sednar import agent_settings, plan_store, prompts, settings_store, tools, workspace, workspace_config
    from sednar.llm import settings as llm_settings

    swaps = [
        (workspace.resolve_safe_path, _wrap_resolve_safe_path(workspace.resolve_safe_path)),
        (workspace.path_blocked_for_edit, _wrap_path_blocked_for_edit(workspace.path_blocked_for_edit)),
        (workspace_config.load_sednar_workspace, _wrap_workspace_loader(workspace_config.load_sednar_workspace)),
        (workspace_config.workspace_from_payload, _wrap_workspace_loader(workspace_config.workspace_from_payload)),
        (tools.get_sednar_tools, _wrap_get_tools(tools.get_sednar_tools)),
        (tools.dispatch_tool, _wrap_dispatch(tools.dispatch_tool)),
        (prompts.build_system_prompt, _wrap_system_prompt(prompts.build_system_prompt)),
        (llm_settings._read, _llm_read),
        (llm_settings._write, _llm_write),
        (agent_settings._read_saved, _agent_read),
        (agent_settings._write_saved, _agent_write),
        (settings_store._path, _settings_path),
        (plan_store.plans_root, _plans_root),
    ]
    for original, replacement in swaps:
        _replace_everywhere(original, replacement)
    logger.info("Sednar public mode: visitor folders in %s", ROOT)


def _refuse(message: str, status: int = 403):
    from flask import jsonify
    return jsonify({"success": False, "error": message}), status


def _blocked(path: str) -> bool:
    if path in _ALLOWED_IN_BLOCKED:
        return False
    return path.startswith(_BLOCKED_PREFIXES) or path in _BLOCKED_ALWAYS


# Requests and socket events that add to the user's folder; refused once it is over its quota.
_WRITING_PATHS = frozenset({"/sednar-agent", "/sednar/clone", "/github/clone", "/sednar/new-project"})
_WRITING_EVENTS = frozenset({"ide_write_file", "ide_create_entry", "ide_mkdir", "ide_transfer_entry", "ide_duplicate_entry"})


def usage_bytes(vid: str, *, max_age_s: float = 60) -> int:
    """How much the user's folder holds, measured at most once a minute."""
    now = time.time()
    with _lock:
        cached = _usage.get(vid)
    if cached and now - cached[0] < max_age_s:
        return cached[1]
    total = 0
    for folder, _, files in os.walk(home(vid)):
        for name in files:
            try:
                total += os.lstat(os.path.join(folder, name)).st_size
            except OSError:
                pass
    with _lock:
        _usage[vid] = (now, total)
    return total


def _over_quota(vid: str) -> str:
    if usage_bytes(vid) <= QUOTA_MB * 1024 * 1024:
        return ""
    return f"Your folder is over its {QUOTA_MB} MB limit. Delete something to make room."


def _security_headers(response):
    from flask import request
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if "Content-Security-Policy" not in headers:
        headers["X-Frame-Options"] = "DENY"
        headers["Content-Security-Policy"] = "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com"
    if request.is_secure:
        headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


def install_app(app, socketio) -> None:
    """Adds the visitor cookie, the request gate and the socket gate. Call before routes are registered."""
    if not ENABLED:
        return
    from datetime import timedelta
    from flask import g, redirect, request, session
    from werkzeug.middleware.proxy_fix import ProxyFix

    app.config.update(
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SEDNAR_PUBLIC_SECURE_COOKIE", "").lower() in ("1", "true", "yes"),
        PERMANENT_SESSION_LIFETIME=timedelta(days=SESSION_DAYS),
        MAX_CONTENT_LENGTH=32 * 1024 * 1024,
    )
    # __Host- cookies are only sent over HTTPS, to this exact host and path.
    app.config["SESSION_COOKIE_NAME"] = "__Host-sednar" if app.config["SESSION_COOKIE_SECURE"] else "sednar"
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    app.after_request(_security_headers)

    @app.before_request
    def _public_canonical_host():
        if not CANONICAL_URL or request.path == "/healthz" or request.path.startswith("/socket.io/"):
            return None
        wanted = urlparse(CANONICAL_URL)
        if request.host.lower() != (wanted.netloc or "").lower() or (wanted.scheme == "https" and not request.is_secure):
            return redirect(CANONICAL_URL + request.full_path.rstrip("?"), code=301)
        return None

    @app.before_request
    def _public_gate():
        path = request.path
        if path in _OPEN_PATHS or path.startswith(_OPEN_PREFIXES) or path in _AUTH_PATHS:
            return None
        vid = current()
        if not vid:
            if path == "/" and request.method == "GET":
                return None  # the editor opens for everyone; the first click asks to log in
            return _refuse("You are logged out. Reload the page and log in again.", 401)
        ensure_home(vid)
        if path in _WRITING_PATHS and request.method == "POST":
            full = _over_quota(vid)
            if full:
                return _refuse(full, 413)
        if path == "/sednar-agent" and request.method == "POST":
            with _lock:
                running = _turns.get(vid, 0)
                if running < MAX_TURNS:
                    _turns[vid] = running + 1
            if running >= MAX_TURNS:
                return _refuse(f"You already have {running} chats working. Wait for one to finish, then send this again.", 429)
            g.sednar_turn = vid
        g.sednar_visitor_token = _visitor.set(vid)
        if _blocked(path):
            return _refuse(OFF_MESSAGE.format(what="This feature is"))
        vhome = home(vid)
        try:
            data = request.get_json(silent=True)
            if data is not None:
                checked = confine(data, vhome, relative_ok=True)
                if path == "/sednar-agent" and isinstance(checked, dict):
                    checked["enable_mcp_tools"] = False
                    checked["mcp_servers"] = []
                request._cached_json = (checked, checked)
            if request.args:
                request._get_current_object().__dict__["args"] = _confine_args(request.args, vhome)
        except Refused as e:
            return _refuse(str(e))
        return None

    @app.teardown_request
    def _public_teardown(_exc=None):
        turn = g.pop("sednar_turn", None)
        if turn:
            with _lock:
                _turns[turn] = max(0, _turns.get(turn, 1) - 1)
        token = g.pop("sednar_visitor_token", None)
        if token is not None:
            try:
                _visitor.reset(token)
            except ValueError:
                pass

    original_on = socketio.on

    def on(message, namespace=None):
        register = original_on(message, namespace)

        def decorator(handler):
            @functools.wraps(handler)
            def guarded(*args):
                vid = current()
                if message == "connect":
                    return bool(vid) and handler(*args) is not False
                if not vid or not os.path.isdir(home(vid)):
                    return None  # no cookie, or a visitor who has since been removed
                if message in _TERMINAL_EVENTS and not _sandbox_ok:
                    _socket_refused(socketio, message, args, "The terminal needs a sandbox (bubblewrap) that this server does not have.")
                    return None
                if message in _SOCKET_OFF:
                    _socket_refused(socketio, message, args, OFF_MESSAGE.format(what="This feature is"))
                    return None
                if message in _WRITING_EVENTS:
                    full = _over_quota(vid)
                    if full:
                        _socket_refused(socketio, message, args, full)
                        return None
                token = _visitor.set(vid)
                try:
                    if args and isinstance(args[0], dict):
                        try:
                            args = (confine(args[0], home(vid), relative_ok=False),) + tuple(args[1:])
                        except Refused as e:
                            _socket_refused(socketio, message, args, str(e))
                            return None
                    return handler(*args)
                finally:
                    _visitor.reset(token)
            return register(guarded)
        return decorator

    socketio.on = on

    @socketio.on("connect")
    def _public_connect(auth=None):
        return True  # the guard above turns away sockets without a visitor cookie


def _socket_refused(socketio, message: str, args: tuple, error: str) -> None:
    from flask import request
    if message == "terminal_init":
        socketio.emit("terminal_output", {"output": f"\r\n{error}\r\n"}, room=request.sid)
        return
    reply = _SOCKET_REPLY.get(message)
    if not reply:
        return
    event, op = reply
    data = args[0] if args and isinstance(args[0], dict) else {}
    payload = {"error": error, "path": data.get("path")}
    if op:
        payload["op"] = op
    socketio.emit(event, payload, room=request.sid)


def clone_repo(url: str, parent: str, name: str = "", token: str = ""):
    """Clones a public https:// repository (or a GitHub one token can read) into the user's folder."""
    from flask import jsonify
    if not re.match(r"^https://[A-Za-z0-9.-]+(:\d+)?/[\w.~%/-]+$", url):
        return _refuse("The public demo clones public https:// repositories only, e.g. https://github.com/owner/repo.", 400)
    name = name or re.sub(r"\.git$", "", url.rstrip("/").rsplit("/", 1)[-1]) or "repo"
    if name.startswith(".") or "/" in name or "\\" in name:
        return _refuse("Choose a plain folder name for the clone.", 400)
    target = os.path.join(parent, name)
    if not _inside(parent, home()) or not os.path.isdir(parent):
        return _refuse("Clone into a folder inside your own folder.", 400)
    if os.path.exists(target):
        return _refuse(f"{name} is already in your folder.", 409)
    env = dict(os.environ)
    if token and url.startswith("https://github.com/"):
        # Through the environment, so the token is in neither the command line nor .git/config.
        import base64
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        count = int(env.get("GIT_CONFIG_COUNT") or 0)
        env.update({"GIT_CONFIG_COUNT": str(count + 1), f"GIT_CONFIG_KEY_{count}": "http.https://github.com/.extraheader",
                    f"GIT_CONFIG_VALUE_{count}": f"AUTHORIZATION: basic {basic}"})
    try:
        proc = subprocess.run(["git", "clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", "--", url, target],
                              capture_output=True, text=True, timeout=180, env=env)
    except subprocess.TimeoutExpired:
        shutil.rmtree(target, ignore_errors=True)
        return _refuse("git clone took longer than 3 minutes and was stopped.", 504)
    if proc.returncode != 0:
        shutil.rmtree(target, ignore_errors=True)
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        return _refuse(detail[-1] if detail else "git clone failed.", 400)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(target) for f in fs
               if not os.path.islink(os.path.join(d, f)))
    if size > MAX_CLONE_MB * 1024 * 1024:
        shutil.rmtree(target, ignore_errors=True)
        return _refuse(f"That repository is over {MAX_CLONE_MB} MB, the public demo's limit.", 413)
    return jsonify({"success": True, "path": target})


def install_routes(app) -> None:
    """Public versions of a few routes. Call after the routes are registered."""
    if not ENABLED:
        return
    from flask import jsonify, request

    def lsp_config():
        return jsonify({"success": True, "languages": [], "bridge": {
            "available": False, "reason": OFF_MESSAGE.format(what="Language servers are")}})

    def mcp_status():
        return jsonify({"servers": [], "server_count": 0, "reason": OFF_MESSAGE.format(what="MCP servers are")})

    for endpoint, view in (("sednar_lsp_config", lsp_config), ("sednar_mcp_status", mcp_status)):
        if endpoint in app.view_functions:
            app.view_functions[endpoint] = view

    def clone():
        data = request.get_json(silent=True) or {}
        return clone_repo(str(data.get("url") or "").strip(), str(data.get("parent_dir") or home()),
                          str(data.get("name") or "").strip())

    if "sednar_clone_repo" in app.view_functions:
        app.view_functions["sednar_clone_repo"] = clone

    @app.route("/healthz")
    def sednar_public_health():
        return jsonify({"ok": True})

    _install_account_routes(app)


# --- accounts ----------------------------------------------------------------------------------------

def _rate_limited(kind: str, who: str, limit: int, window_s: float) -> bool:
    """True once who has tried kind limit times within window_s seconds."""
    now = time.time()
    with _lock:
        if len(_attempts) > 20000:
            for k in [k for k, hits in _attempts.items() if not hits or now - hits[-1] > 3600]:
                _attempts.pop(k, None)
        hits = [t for t in _attempts.get((kind, who), ()) if now - t < window_s]
        limited = len(hits) >= limit
        if not limited:
            hits.append(now)
        _attempts[(kind, who)] = hits
    return limited


def _csrf_token() -> str:
    from flask import session
    token = session.get("lc_csrf")
    if not isinstance(token, str) or not token:
        token = secrets.token_urlsafe(24)
        session["lc_csrf"] = token
    return token


def _csrf_ok() -> bool:
    import hmac
    from flask import request, session
    return hmac.compare_digest(str(session.get("lc_csrf") or "-"), str(request.form.get("csrf") or ""))


def _start_login(user: dict[str, Any], key: bytes, github_token: str = "") -> None:
    """Opens a login for user in this browser and unlocks their saved keys with key."""
    from flask import session
    from sednar import public_accounts
    vid = user["id"]
    saved = public_accounts.load_secrets(vid, key)
    sid = secrets.token_urlsafe(24)
    with _lock:
        _unlock[vid] = key
        _llm[vid] = saved["llm"] if isinstance(saved.get("llm"), dict) else {}
        _logins.setdefault(vid, set()).add(sid)
        if github_token:
            _github_tokens[vid] = github_token
    ensure_home(vid)
    session.clear()
    session[COOKIE_KEY] = vid
    session[LOGIN_KEY] = sid
    session.permanent = True


def _end_login() -> None:
    from flask import session
    vid, sid = session.get(COOKIE_KEY), session.get(LOGIN_KEY)
    last = False
    with _lock:
        logins = _logins.get(vid) if isinstance(vid, str) else None
        if logins is not None and sid in logins:
            logins.discard(sid)
            last = not logins
    if last:
        _lock_out(vid)
    session.clear()


# The standalone pages (/login, /signup, /privacy) look like the editor: Black by default, or the theme the
# visitor picked in the editor (the same localStorage keys the app page reads), so going from one to the
# other never flips between light and dark.
_AUTH_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ · __BRAND__</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/sednar/assets/sednar/icon-32.png">
<link rel="apple-touch-icon" href="/sednar/assets/sednar/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0f0f10">
<style>
  /* Black, the editor's default theme. */
  :root { color-scheme: dark; --bg: #0a0a0a; --card: #161616; --fg: #e8e8e8; --muted: #9a9a9a; --border: rgba(255,255,255,.12);
          --field: #0e0e0e; --accent: #3b82f6; --accent-hover: #2563eb; --accent-fg: #fff; --error: #f87171; --error-bg: rgba(248,113,113,.1);
          --github: #f0f3f6; --github-fg: #1f2328; --github-hover: #fff; }
  /* The editor's Dark theme. */
  :root[data-theme="dark"] { --bg: #1e1e1e; --card: #252526; --field: #1b1b1c; --accent: #81a1c1; --accent-hover: #87a6c4; --accent-fg: #191c22; }
  /* The editor's Light theme. */
  :root[data-theme="light"] { color-scheme: light; --bg: #f8fafc; --card: #fff; --fg: #1e293b; --muted: #64748b; --border: rgba(15,23,42,.12);
          --field: #fff; --accent: #2778c1; --accent-hover: #2268a8; --accent-fg: #fff; --error: #b91c1c; --error-bg: rgba(185,28,28,.07);
          --github: #24292f; --github-fg: #fff; --github-hover: #32383f; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg);
         color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(400px, 100%); padding: 28px 28px 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--card); }
  .brand { display: block; margin-bottom: 22px; }
  .brand img { display: block; height: 32px; width: auto; }
  .brand .on-light { display: none; }
  :root[data-theme="light"] .brand .on-dark { display: none; }
  :root[data-theme="light"] .brand .on-light { display: block; }
  h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0 0 20px; color: var(--muted); font-size: 14px; }
  label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0 0 6px; font-size: 13px; font-weight: 500; }
  label .hint { color: var(--muted); font-size: 12px; font-weight: 400; }
  input { width: 100%; margin: 0 0 14px; padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px;
          background: var(--field); color: var(--fg); font: inherit; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { width: 100%; margin-top: 2px; padding: 10px; border: 0; border-radius: 8px; background: var(--accent);
           color: var(--accent-fg); font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: var(--accent-hover); }
  .error { margin: 0 0 16px; padding: 10px 12px; border: 1px solid var(--error); border-radius: 8px; background: var(--error-bg);
           color: var(--error); font-size: 14px; line-height: 1.4; }
  .switch { margin: 18px 0 0; text-align: center; font-size: 14px; color: var(--muted); }
  a { color: var(--accent); }
  .note { margin: 16px 0 0; font-size: 12px; color: var(--muted); text-align: center; }
  .note a { color: inherit; }
  .doc h1 { margin-bottom: 12px; } .doc h2 { margin: 22px 0 6px; font-size: 16px; }
  .doc p, .doc li { color: var(--fg); font-size: 14px; } .doc ul { padding-left: 20px; } .doc li + li { margin-top: 6px; }
  .doc .back { display: inline-block; margin-top: 8px; }
  /* GitHub's own look, so it reads as a different way in, not a second Log in button. */
  .github { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 10px;
            border: 1px solid var(--border); border-radius: 8px; background: var(--github); color: var(--github-fg);
            font-weight: 600; text-decoration: none; }
  .github:hover { background: var(--github-hover); }
  .github svg { width: 18px; height: 18px; fill: currentColor; }
  .or { display: flex; align-items: center; gap: 10px; margin: 16px 0; color: var(--muted); font-size: 13px; }
  .or::before, .or::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
</style>
<script>
  try {
    var t = localStorage.getItem("sednar-theme");
    var prefs = JSON.parse(localStorage.getItem("sednar_settings_v1") || "{}") || {};
    if (prefs.themeFollowSystem && window.matchMedia) {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches ? (prefs.themeDark || "black") : (prefs.themeLight || "white");
    }
    if (t === "white" || t === "pink") document.documentElement.dataset.theme = "light";
    else if (t === "dark") document.documentElement.dataset.theme = "dark";
  } catch (e) {}
</script>
</head>
<body>
<main>
  <a class="brand" href="/" aria-label="__BRAND__"><img class="on-dark" src="/sednar/assets/sednar/sednar-logo-white.png" alt="__BRAND__"><img class="on-light" src="/sednar/assets/sednar/sednar-logo-dark.png" alt="__BRAND__"></a>
  <h1>__HEADING__</h1>
  <p>__LEAD__</p>
  __ERROR__
  __GITHUB__
  <form method="post" action="__ACTION__">
    <input type="hidden" name="csrf" value="__CSRF__">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="__EMAIL__" autofocus>
    <label for="password">Password__PW_HINT__</label>
    <input id="password" name="password" type="password" autocomplete="__PW_AUTOCOMPLETE__" required minlength="__MIN__" maxlength="200">
    <button type="submit">__BUTTON__</button>
  </form>
  <div class="switch">__SWITCH__</div>
  <div class="note"><a href="/privacy">Privacy</a>__SOURCE_LINK__</div>
</main>
</body>
</html>
"""


GITHUB_ICON = (
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 '
    '3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13'
    '-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 '
    '0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 '
    '2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 '
    '1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"></path></svg>'
)
_GITHUB_BUTTON = '<a class="github" href="/auth/github">' + GITHUB_ICON + 'Continue with GitHub</a><div class="or">or with email</div>'


_PRIVACY = """
<h1>Privacy</h1>
<p>__BRAND__ is a hosted coding agent. This page says what it keeps about you and where your work goes.</p>
<h2>What is stored</h2>
<ul>
  <li><b>Your account:</b> your email address, or your GitHub user id and name if you sign in with GitHub. Passwords are stored only as scrypt hashes.</li>
  <li><b>Your work:</b> the files in your folder (the sample project and anything you create or clone), your chats, and your settings.</li>
  <li><b>Your model API keys:</b> encrypted with AES-GCM. For an email account the key that unlocks them comes from your password, so they can be read only while you are logged in. For a GitHub account it comes from the server's secret.</li>
  <li><b>Server logs:</b> the web server records each request's address, time and path. They are not used for advertising.</li>
</ul>
<h2>Where your work goes</h2>
<ul>
  <li>When you chat, your messages and the parts of your files the agent reads are sent to the model provider whose key you added (for example Google, OpenAI or Anthropic), under that provider's terms.</li>
  <li>The editor's code is loaded from public CDNs (jsDelivr), which see your IP address.</li>
  <li>There are no ads and no analytics trackers.</li>
</ul>
<h2>Deleting your data</h2>
<p>Settings &gt; Account &gt; Delete account removes your account, folder, chats and saved keys at once. Backups of the server's disk may keep a copy for a few days.</p>
__CONTACT__
<p><a class="back" href="/">Back to __BRAND__</a></p>
"""


def _privacy_page():
    from html import escape
    from flask import Response
    contact = f"<h2>Contact</h2><p>{escape(CONTACT)}</p>" if CONTACT else ""
    body = _PRIVACY.replace("__BRAND__", escape(BRAND)).replace("__CONTACT__", contact)
    page = _AUTH_PAGE.split("<body>")[0].replace("__TITLE__", "Privacy").replace("__BRAND__", escape(BRAND))
    page = page.replace("main { width: min(400px, 100%);", "main { width: min(680px, 100%);")
    logo = ('<a class="brand" href="/" aria-label="__B__"><img class="on-dark" src="/sednar/assets/sednar/sednar-logo-white.png" alt="__B__">'
            '<img class="on-light" src="/sednar/assets/sednar/sednar-logo-dark.png" alt="__B__"></a>').replace("__B__", escape(BRAND))
    return Response(page + '<body><main class="doc">' + logo + body + "</main></body></html>", mimetype="text/html")


def _auth_page(mode: str, error: str = "", email: str = "", status: int = 200):
    from html import escape
    from flask import Response
    from sednar import public_accounts, public_github
    signup = mode == "signup"
    values = {
        "__TITLE__": "Create an account" if signup else "Log in",
        "__HEADING__": "Create your account" if signup else f"Log in to {escape(BRAND)}",
        "__LEAD__": f"Try the {escape(BRAND)} coding agent in your browser, on a project of your own." if signup
                    else "Welcome back. Your projects and saved keys are waiting.",
        "__ERROR__": f'<div class="error" role="alert">{escape(error)}</div>' if error else "",
        "__ACTION__": "/signup" if signup else "/login",
        "__CSRF__": escape(_csrf_token()),
        "__EMAIL__": escape(email),
        "__PW_AUTOCOMPLETE__": "new-password" if signup else "current-password",
        "__PW_HINT__": f'<span class="hint">{public_accounts.MIN_PASSWORD} characters or more</span>' if signup else "",
        "__MIN__": str(public_accounts.MIN_PASSWORD if signup else 1),
        "__BUTTON__": "Create account" if signup else "Log in",
        "__SWITCH__": 'Already have an account? <a href="/login">Log in</a>' if signup
                      else 'New here? <a href="/signup">Create an account</a>',
        "__SOURCE_LINK__": f' · <a href="{escape(SOURCE_URL)}" target="_blank" rel="noopener">Run it yourself</a>' if SOURCE_URL else "",
        # Only when a GitHub OAuth app is configured: a button that leads to "not set up" helps nobody.
        "__GITHUB__": _GITHUB_BUTTON if public_github.enabled() else "",
        "__BRAND__": escape(BRAND),
    }
    page = _AUTH_PAGE
    for key, value in values.items():
        page = page.replace(key, value)
    return Response(page, status=status, mimetype="text/html")


def _install_account_routes(app) -> None:
    from flask import jsonify, redirect, request, session
    from sednar import public_accounts

    def form_email() -> str:
        return str(request.form.get("email") or "")[:254]

    def back_to_login(message: str):
        """Sends the visitor to /login with message shown once. A redirect keeps the address clean (no
        /auth/github/callback?code=... that fails again on reload) and the message survives it in the session."""
        session["lc_flash"] = message
        return redirect("/login", code=303)

    @app.route("/login", methods=["GET", "POST"])
    def sednar_public_login():
        if request.method == "GET":
            if current():
                return redirect("/")
            flash = session.pop("lc_flash", None)
            return _auth_page("login", str(flash) if isinstance(flash, str) else "")
        email, password = form_email(), str(request.form.get("password") or "")
        if not _csrf_ok():
            return _auth_page("login", "The form had expired. Try again.", email, 400)
        if (_rate_limited("login", request.remote_addr or "?", 30, 600)
                or _rate_limited("login-email", public_accounts.normalize_email(email), 10, 600)):
            return _auth_page("login", "Too many attempts. Wait a few minutes and try again.", email, 429)
        user = public_accounts.authenticate(email, password)
        if not user:
            return _auth_page("login", "That email and password do not match an account.", email, 401)
        _start_login(user, public_accounts.unlock_key(password, user["key_salt"]))
        return redirect("/")

    @app.route("/signup", methods=["GET", "POST"])
    def sednar_public_signup():
        if request.method == "GET":
            return redirect("/") if current() else _auth_page("signup")
        email, password = form_email(), str(request.form.get("password") or "")
        if not _csrf_ok():
            return _auth_page("signup", "The form had expired. Try again.", email, 400)
        if _rate_limited("signup", request.remote_addr or "?", 5, 3600):
            return _auth_page("signup", "Too many new accounts from here. Try again later.", email, 429)
        if public_accounts.count() >= MAX_USERS:
            return _auth_page("signup", "The demo has all the accounts it can take right now. Try again later.", email, 503)
        try:
            public_accounts.create(email, password)
        except public_accounts.AccountError as e:
            return _auth_page("signup", str(e), email, 400)
        user = public_accounts.authenticate(email, password)
        _start_login(user, public_accounts.unlock_key(password, user["key_salt"]))
        return redirect("/")

    @app.route("/logout", methods=["POST"])
    def sednar_public_logout():
        if _csrf_ok():
            _end_login()
        return redirect("/")

    @app.route("/account/delete", methods=["POST"])
    def sednar_public_delete_account():
        vid = current()
        if not _csrf_ok():
            return _refuse("The page had expired. Reload it and try again.", 400)
        info = public_accounts.account(vid)
        if info.get("github"):
            if str(request.form.get("confirm") or "").strip().lower() != info["github"].lower():
                return _refuse(f"Type {info['github']} to confirm.", 403)
        else:
            user = public_accounts.authenticate(info.get("email", ""), str(request.form.get("password") or ""))
            if not user or user["id"] != vid:
                return _refuse("That password is not right.", 403)
        forget(vid)
        public_accounts.delete(vid)
        session.clear()
        return jsonify({"success": True})

    @app.route("/account/password", methods=["POST"])
    def sednar_public_change_password():
        vid = current()
        if not _csrf_ok():
            return _refuse("The page had expired. Reload it and try again.", 400)
        info = public_accounts.account(vid)
        if info.get("github"):
            return _refuse("This account signs in with GitHub, so it has no password.", 400)
        current_pw, new_pw = str(request.form.get("current") or ""), str(request.form.get("new") or "")
        if _rate_limited("password", vid, 10, 600):
            return _refuse("Too many attempts. Wait a few minutes and try again.", 429)
        user = public_accounts.authenticate(info.get("email", ""), current_pw)
        if not user or user["id"] != vid:
            return _refuse("Your current password is not right.", 403)
        try:
            public_accounts.set_password(vid, new_pw)
        except public_accounts.AccountError as e:
            return _refuse(str(e), 400)
        # The saved keys move to the new password, and every other browser is signed out.
        key = public_accounts.unlock_key(new_pw, user["key_salt"])
        with _lock:
            _unlock[vid] = key
            data = copy.deepcopy(_llm.get(vid) or {})
            _logins[vid] = {session.get(LOGIN_KEY)}
        public_accounts.save_secrets(vid, key, {"llm": data})
        return jsonify({"success": True})

    @app.route("/privacy")
    def sednar_public_privacy():
        return _privacy_page()

    from sednar import public_github

    def github_redirect_uri() -> str:
        base = (os.environ.get("SEDNAR_PUBLIC_URL") or request.url_root).rstrip("/")
        return base + "/auth/github/callback"

    @app.route("/auth/github")
    def sednar_public_github_start():
        if current():
            return redirect("/")
        if not public_github.enabled():
            return back_to_login("GitHub sign-in is not available on this server. Log in with your email instead.")
        state = secrets.token_urlsafe(24)
        session["lc_github_state"] = state
        return redirect(public_github.authorize_url(github_redirect_uri(), state))

    @app.route("/auth/github/callback")
    def sednar_public_github_callback():
        import hmac
        expected = session.pop("lc_github_state", None)
        if not public_github.enabled() or not expected or not hmac.compare_digest(str(expected), str(request.args.get("state") or "")):
            return back_to_login("That GitHub sign-in has expired. Click Continue with GitHub to start again.")
        if request.args.get("error") or not request.args.get("code"):
            return back_to_login("GitHub sign-in was cancelled, so nothing changed. You can try again or log in with your email.")
        if _rate_limited("github", request.remote_addr or "?", 30, 600):
            return back_to_login("Too many attempts. Wait a few minutes and try again.")
        try:
            token = public_github.exchange_code(str(request.args["code"]), github_redirect_uri())
            who = public_github.user(token)
        except (public_github.GitHubError, ValueError, OSError) as e:
            return back_to_login(str(e) if isinstance(e, public_github.GitHubError) else "Could not reach GitHub. Try again in a moment.")
        user = public_accounts.github_account(who["id"], who["login"])
        secret = os.environ.get("SEDNAR_PUBLIC_DATA_KEY") or app.config["SECRET_KEY"]
        _start_login(user, public_accounts.server_key(secret, user["key_salt"]), github_token=token)
        return redirect("/")

    @app.route("/github/repos")
    def sednar_public_github_repos():
        with _lock:
            token = _github_tokens.get(current() or "")
        if not token:
            return _refuse("Log in with GitHub to see your repositories.", 400)
        try:
            return jsonify({"success": True, "repos": public_github.repos(token), "private": public_github.PRIVATE_REPOS})
        except (public_github.GitHubError, OSError, ValueError) as e:
            return _refuse(str(e) if isinstance(e, public_github.GitHubError) else "Could not reach GitHub.", 502)

    @app.route("/github/clone", methods=["POST"])
    def sednar_public_github_clone():
        full_name = str((request.get_json(silent=True) or {}).get("full_name") or "").strip()
        if not re.match(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$", full_name) or ".." in full_name:
            return _refuse("Pick a repository from the list.", 400)
        with _lock:
            token = _github_tokens.get(current() or "", "")
        return clone_repo(f"https://github.com/{full_name}.git", home(), full_name.split("/", 1)[1], token=token)


def decorate_page(html: str) -> str:
    """The app page for the hosted site: its name in the title, and the public script and settings."""
    if ENABLED:
        from html import escape
        html = html.replace("<title>Sednar</title>", f"<title>{escape(BRAND)}</title>")
    return html.replace("__PUBLIC__", page_config())


def page_config() -> str:
    """The script tag that tells the page it runs as the public demo, for the logged-in user."""
    if not ENABLED:
        return ""
    from sednar import public_accounts, public_github
    vid = current()
    if vid:
        info = public_accounts.account(vid)
        with _lock:
            has_github = bool(vid in _github_tokens)
        config = {"home": home(), "project": sample_project(), "email": info.get("name", ""),
                  "github": info.get("github", ""), "githubRepos": has_github, "csrf": _csrf_token(), "source": SOURCE_URL,
                  "brand": BRAND, "terminal": _sandbox_ok}
    else:
        # Logged out: the editor shows, and the public script asks to log in before anything is used.
        config = {"guest": True, "minPassword": public_accounts.MIN_PASSWORD, "csrf": _csrf_token(),
                  "source": SOURCE_URL, "brand": BRAND, "githubLogin": public_github.enabled(), "terminal": _sandbox_ok}
    return ("<script>window.SEDNAR_PUBLIC = " + json.dumps(config).replace("</", "<\\/") + ";</script>\n"
            '<link rel="stylesheet" href="/sednar/static/css/sednar-public.css">\n'
            '<script src="/sednar/static/js/sednar-public.js"></script>\n')
