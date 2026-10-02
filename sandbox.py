"""The public site's sandbox: bubblewrap (bwrap) jails that see one user's folder and nothing else.

Two things run in it:
- the terminal: a login shell with the user's folder as its home (/home/<name>), and no network;
- every git the server starts for a path in a user's folder. From the terminal a user can write .git/config,
  and git runs commands named there (filters, textconv, gpg.program), so git must not run outside the jail.
  public_mode.py puts sandbox_bin first on PATH; its `git` runs this file, which picks the jail from the
  folder git works in. Only `git clone` gets the network, and it reads no config the user can write.

The jail has the system read-only (/usr, /etc), its own /proc, /dev and /tmp, no other users' folders, no
accounts database, no server code, and none of the server's environment (its secrets). Every namespace is
new, so it sees only its own processes. This file runs as a script on each git call, so it imports only
the standard library.
"""
from __future__ import annotations

import os
import shutil
import sys

ROOT_ENV = "SEDNAR_PUBLIC_ROOT_REAL"
SHIM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sandbox_bin")
# Commands that need the network: a clone writes a fresh repository and reads no config the user wrote.
NETWORK_GIT = frozenset({"clone"})
# The server's git settings (public_mode._git_environment) and the clone token travel in these.
_GIT_ENV_PREFIXES = ("GIT_CONFIG_", "GIT_TERMINAL_PROMPT", "GIT_ALLOW_PROTOCOL")


def bwrap() -> str | None:
    return shutil.which("bwrap")


def _system_binds() -> list[str]:
    args = ["--ro-bind", "/usr", "/usr", "--ro-bind", "/etc", "/etc"]
    # Merged-/usr systems have /bin, /lib... as links into /usr; older ones have real folders.
    for name in ("bin", "sbin", "lib", "lib32", "lib64", "libx32"):
        path = "/" + name
        if os.path.islink(path):
            args += ["--symlink", os.readlink(path), path]
        elif os.path.isdir(path):
            args += ["--ro-bind", path, path]
    return args


def jail(user_dir: str, mount_at: str, *, network: bool = False, home: str | None = None,
         cwd: str | None = None, env: dict[str, str] | None = None, files: dict[str, int] | None = None) -> list[str]:
    """bwrap's arguments (ending in "--") for a jail with user_dir read-write at mount_at.

    files maps a path in the jail to a readable file descriptor whose contents become that (read-only) file.
    """
    exe = bwrap()
    if not exe:
        raise RuntimeError("bubblewrap (bwrap) is not installed")
    args = [exe, "--unshare-all", "--die-with-parent", "--cap-drop", "ALL", "--hostname", "sednar"]
    if network:
        args.append("--share-net")
    args += _system_binds()
    args += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/home", "--tmpfs", "/run"]
    args += ["--bind", user_dir, mount_at]
    if home and home != mount_at:
        args += ["--dir", home]
    for path, fd in (files or {}).items():
        args += ["--ro-bind-data", str(fd), path]
    args += ["--chdir", cwd or mount_at, "--clearenv"]
    for key, value in (env or {}).items():
        args += ["--setenv", key, value]
    return args + ["--"]


def data_fds(files: dict[str, bytes]) -> dict[str, int]:
    """A readable, inheritable pipe holding each file's contents, for jail(files=...). Close them after the fork."""
    fds = {}
    for path, content in files.items():
        read, write = os.pipe()
        os.write(write, content)  # small files: they fit in the pipe's buffer
        os.close(write)
        os.set_inheritable(read, True)
        fds[path] = read
    return fds


def terminal(user_dir: str, name: str, cwd: str | None = None) -> tuple[list[str], dict[str, int]]:
    """The argv for a terminal shell in user_dir's jail, and the file descriptors it reads its files from.

    The folder is the shell's home, /home/<name>, and the jail's /etc/passwd names its user <name>.
    cwd is a folder inside user_dir to start in.
    """
    home = f"/home/{name}"
    start = home
    if cwd:
        real, base = os.path.realpath(cwd), os.path.realpath(user_dir)
        if real.startswith(base + os.sep) and os.path.isdir(real):
            start = home + real[len(base):]
    uid, gid = os.getuid(), os.getgid()
    passwd = f"root:x:0:0:root:/root:/usr/sbin/nologin\n{name}:x:{uid}:{gid}:{name}:{home}:/bin/bash\n"
    group = f"root:x:0:\n{name}:x:{gid}:\n"
    bashrc = ("[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc\n"
              "PS1='\\[\\e[1;32m\\]\\u@sednar\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ '\n"
              "alias ls='ls --color=auto'\n")
    fds = data_fds({"/etc/passwd": passwd.encode(), "/etc/group": group.encode(),
                    "/etc/sednar.bashrc": bashrc.encode()})
    env = {"TERM": "xterm-256color", "HOME": home, "USER": name, "LOGNAME": name, "SHELL": "/bin/bash",
           "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
    argv = jail(user_dir, home, cwd=start, env=env, files=fds)
    return argv + ["/bin/bash", "--rcfile", "/etc/sednar.bashrc", "-i"], fds


def problem() -> str:
    """Why a jail cannot be made here ("" when it can): bwrap missing, or its own error message."""
    import subprocess
    import tempfile
    if not bwrap():
        return "bubblewrap (bwrap) is not installed"
    with tempfile.TemporaryDirectory() as folder:
        try:
            done = subprocess.run(jail(folder, "/home/check") + ["/bin/true"], capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError, RuntimeError) as e:
            return str(e)
    if done.returncode == 0:
        return ""
    return (done.stderr or done.stdout or f"bwrap exited with {done.returncode}").strip()


def works() -> bool:
    """True when a jail can actually be made here (bwrap installed, and user namespaces allowed)."""
    return not problem()


def user_dir_for(path: str, root: str) -> str | None:
    """The user's folder (root/<id>) that path is in, or None."""
    real = os.path.realpath(path)
    root = os.path.realpath(root)
    if not real.startswith(root + os.sep):
        return None
    first = real[len(root) + 1:].split(os.sep, 1)[0]
    if not first or first.startswith("."):
        return None
    return os.path.join(root, first)


def _real_git() -> str:
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        if folder and os.path.realpath(folder) != os.path.realpath(SHIM_DIR):
            candidate = os.path.join(folder, "git")
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return "/usr/bin/git"


def _git_workdir(args: list[str]) -> str:
    """The folder a git command works in: the last -C, else the current folder."""
    workdir = os.getcwd()
    i = 0
    while i < len(args):
        if args[i] == "-C" and i + 1 < len(args):
            workdir = os.path.join(workdir, args[i + 1])
            i += 2
            continue
        if not args[i].startswith("-"):
            break  # the subcommand; its own -C means something else
        i += 1
    return workdir


def _git_subcommand(args: list[str]) -> str:
    i = 0
    while i < len(args):
        if args[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
            i += 2
            continue
        if args[i].startswith("-"):
            i += 1
            continue
        return args[i]
    return ""


def run_git(args: list[str]) -> None:
    """Runs git with args: inside the user's jail when it works in a user's folder."""
    git = _real_git()
    root = os.environ.get(ROOT_ENV) or ""
    workdir = _git_workdir(args)
    user_dir = user_dir_for(workdir, root) if root else None
    if not user_dir:
        # A clone names its target last; the server clones into a user's folder.
        sub = _git_subcommand(args)
        if sub == "clone" and root and args:
            user_dir = user_dir_for(os.path.dirname(os.path.abspath(args[-1])) or ".", root)
    if not user_dir:
        os.execv(git, [git] + args)
    env = {key: value for key, value in os.environ.items() if key.startswith(_GIT_ENV_PREFIXES)}
    env.update({"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/home/git", "LANG": "C.UTF-8",
                "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"})
    cwd = os.path.realpath(os.getcwd())
    if not (cwd == user_dir or cwd.startswith(user_dir + os.sep)):
        cwd = user_dir
    argv = jail(user_dir, user_dir, network=_git_subcommand(args) in NETWORK_GIT, home="/home/git", cwd=cwd, env=env)
    os.execv(argv[0], argv + [git] + args)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "git":
        try:
            run_git(sys.argv[2:])
        except Exception as e:  # noqa: BLE001 - git's caller only sees stderr and the exit code
            sys.stderr.write(f"fatal: sednar sandbox: {e}\n")
            sys.exit(128)
    sys.stderr.write("usage: sandbox.py git [args...]\n")
    sys.exit(2)
