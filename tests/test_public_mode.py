"""Public mode (SEDNAR_PUBLIC=1): people sign up and log in, each user stays inside their own folder and
keeps their own API keys, and nobody can run programs on the server.

Public mode patches Sednar for the whole process, so the checks run again in a child process with it on."""
from __future__ import annotations

import itertools
import json
import os
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

if os.environ.get("SEDNAR_PUBLIC") != "1":

    def test_public_mode_suite(tmp_path):
        env = dict(os.environ, SEDNAR_PUBLIC="1", SEDNAR_PUBLIC_ROOT=str(tmp_path / "visitors"),
                   SEDNAR_SECRET_KEY="test-secret", SEDNAR_PORT="9555",
                   SEDNAR_GITHUB_CLIENT_ID="test-client", SEDNAR_GITHUB_CLIENT_SECRET="test-client-secret")
        done = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", __file__],
                              env=env, cwd=REPO, capture_output=True, text=True, timeout=600)
        assert done.returncode == 0, done.stdout[-6000:] + done.stderr[-3000:]

else:
    import runpy

    @pytest.fixture(scope="module")
    def server():
        cwd = os.getcwd()
        try:
            return runpy.run_path(os.path.join(REPO, "server.py"), run_name="sednar_public_test")
        finally:
            os.chdir(cwd)

    @pytest.fixture(scope="module")
    def pm(server):
        from sednar import public_mode
        return public_mode

    PASSWORD = "correct horse battery"
    _emails = itertools.count()

    def _csrf(client, page="/login"):
        client.get(page)
        with client.session_transaction() as session:
            return session["lc_csrf"]

    def _signup(server, email=None, password=PASSWORD):
        from sednar import public_mode
        public_mode._attempts.clear()
        client = server["app"].test_client()
        email = email or f"user{next(_emails)}@example.com"
        r = client.post("/signup", data={"csrf": _csrf(client, "/signup"), "email": email, "password": password})
        assert r.status_code == 302 and r.headers["Location"] == "/", r.get_data(as_text=True)[-400:]
        return client, email

    def _visitor(server):
        client, _ = _signup(server)
        assert client.get("/").status_code == 200
        with client.session_transaction() as session:
            vid = session["lc_vid"]
        return client, vid

    @pytest.fixture()
    def visitor(server):
        return _visitor(server)

    def test_a_new_user_gets_their_own_folder_with_the_sample_project(server, pm, visitor):
        client, vid = visitor
        home = pm.home(vid)
        assert os.path.isfile(os.path.join(home, "hello-sednar", "index.html"))
        assert re.match(r"^user\d+-[0-9a-f]{8}$", vid), vid  # the name before the @, plus a random suffix
        page = client.get("/").get_data(as_text=True)
        assert "window.SEDNAR_PUBLIC" in page and json.dumps(home)[1:-1] in page
        assert "sednar-public.js" in page and "<title>Sednar</title>" in page

    def test_requests_without_a_login_are_sent_to_log_in(server):
        client = server["app"].test_client()
        r = client.get("/")
        assert r.status_code == 302 and r.headers["Location"] == "/login"
        assert client.get("/sednar/llm/settings").status_code == 401
        assert b"Log in" in client.get("/login").data and b"Create your account" in client.get("/signup").data
        assert client.get("/healthz").status_code == 200

    def test_sign_up_log_out_and_log_in_again(server, pm):
        client, email = _signup(server)
        assert email.encode() in client.get("/").data
        csrf = _csrf(client, "/")
        assert client.post("/logout", data={"csrf": csrf}).status_code == 302
        assert client.get("/sednar/llm/settings").status_code == 401
        r = client.post("/login", data={"csrf": _csrf(client), "email": email.upper(), "password": PASSWORD})
        assert r.status_code == 302 and r.headers["Location"] == "/"
        assert client.get("/sednar/llm/settings").status_code == 200

    def test_a_logged_out_cookie_stays_logged_out(server):
        client, _ = _signup(server)
        csrf = _csrf(client, "/")
        with client.session_transaction() as session:
            saved = dict(session)
        client.post("/logout", data={"csrf": csrf})
        replay = server["app"].test_client()
        with replay.session_transaction() as session:
            session.update(saved)
        assert replay.get("/sednar/llm/settings").status_code == 401

    @pytest.mark.parametrize("email,password,message", [
        ("not-an-email", PASSWORD, b"valid email"),
        ("short@example.com", "short", b"at least 8"),
    ])
    def test_sign_up_checks_the_details(server, email, password, message):
        client = server["app"].test_client()
        r = client.post("/signup", data={"csrf": _csrf(client, "/signup"), "email": email, "password": password})
        assert r.status_code == 400 and message in r.data

    def test_an_email_signs_up_once(server):
        _, email = _signup(server)
        client = server["app"].test_client()
        r = client.post("/signup", data={"csrf": _csrf(client, "/signup"), "email": email, "password": PASSWORD})
        assert r.status_code == 400 and b"already exists" in r.data

    def test_a_wrong_password_or_missing_form_token_does_not_log_in(server, pm):
        _, email = _signup(server)
        client = server["app"].test_client()
        r = client.post("/login", data={"csrf": _csrf(client), "email": email, "password": "wrong password"})
        assert r.status_code == 401 and b"do not match" in r.data
        r = client.post("/login", data={"email": email, "password": PASSWORD})
        assert r.status_code == 400
        assert client.get("/sednar/llm/settings").status_code == 401

    def test_repeated_failed_logins_are_slowed_down(server, pm):
        _, email = _signup(server)
        client = server["app"].test_client()
        codes = [client.post("/login", data={"csrf": _csrf(client), "email": email, "password": "nope-nope"}).status_code
                 for _ in range(11)]
        assert codes[-1] == 429 and 401 in codes
        pm._attempts.clear()

    def test_deleting_an_account_removes_it(server, pm):
        from sednar import public_accounts
        client, email = _signup(server)
        with client.session_transaction() as session:
            vid = session["lc_vid"]
        csrf = _csrf(client, "/")
        assert client.post("/account/delete", data={"csrf": csrf, "password": "wrong"}).status_code == 403
        assert client.post("/account/delete", data={"csrf": csrf, "password": PASSWORD}).get_json()["success"]
        assert not os.path.exists(pm.home(vid)) and public_accounts.email_of(vid) == ""
        fresh = server["app"].test_client()
        r = fresh.post("/login", data={"csrf": _csrf(fresh), "email": email, "password": PASSWORD})
        assert r.status_code == 401

    @pytest.mark.parametrize("project_path", ["/etc", "/", "~/../", "../escape", "~root"])
    def test_paths_outside_the_visitor_folder_are_refused(visitor, project_path):
        client, _ = visitor
        r = client.post("/sednar/skills", json={"project_path": project_path})
        assert r.status_code == 403, r.get_json()

    def test_another_visitors_folder_is_refused(server, pm, visitor):
        client, _ = visitor
        _, other = _visitor(server)
        r = client.post("/sednar/skills", json={"project_path": os.path.join(pm.home(other), "hello-sednar")})
        assert r.status_code == 403
        workspace = json.dumps({"folders": [{"path": pm.home(other)}]})
        r = client.get("/sednar/source-models", query_string={"project": "~/hello-sednar", "workspace": workspace})
        assert r.status_code == 403

    def test_tilde_means_the_visitor_folder(visitor):
        client, _ = visitor
        r = client.post("/sednar/skills", json={"project_path": "~/hello-sednar"})
        assert r.status_code == 200, r.get_json()

    @pytest.mark.parametrize("method,path", [
        ("POST", "/sednar-mcp/servers/add"), ("POST", "/sednar-mcp/action"), ("POST", "/sednar/lsp/install"),
        ("POST", "/sednar/lsp/settings"), ("POST", "/sednar/settings/reset"),
    ])
    def test_features_that_run_programs_or_share_settings_are_off(visitor, method, path):
        client, _ = visitor
        r = client.open(path, method=method, json={})
        assert r.status_code == 403, (path, r.status_code)

    def test_language_and_mcp_servers_report_off(visitor):
        client, _ = visitor
        data = client.get("/sednar/lsp/config").get_json()
        assert data["languages"] == [] and data["bridge"]["available"] is False
        assert client.post("/sednar-mcp/status", json={"project_path": "~/hello-sednar"}).get_json()["servers"] == []

    def test_api_keys_belong_to_one_user_and_are_saved_encrypted(server, pm, monkeypatch):
        from sednar.llm import settings as llm_settings
        monkeypatch.setattr(llm_settings, "_fetch_model_ids", lambda provider, key: ["gemini-2.5-flash"])
        alice, alice_email = _signup(server)
        bob, _ = _signup(server)
        r = alice.post("/sednar/llm/settings", json={"provider": "gemini", "api_key": "alice-key-123456"})
        assert r.status_code == 200, r.get_json()
        configured = lambda c: {p["id"] for p in c.get("/sednar/llm/settings").get_json()["providers"] if p["configured"]}
        assert configured(alice) == {"gemini"}
        assert configured(bob) == set()
        assert not os.path.exists(llm_settings.CONFIG_PATH)
        for folder, _, files in os.walk(pm.ROOT):
            for name in files:
                with open(os.path.join(folder, name), "rb") as handle:
                    assert b"alice-key-123456" not in handle.read(), name
        # Logged out, the key is gone from memory; logging in again unlocks the saved copy.
        alice.post("/logout", data={"csrf": _csrf(alice, "/")})
        assert not any("alice-key-123456" in json.dumps(v) for v in pm._llm.values())
        alice.post("/login", data={"csrf": _csrf(alice), "email": alice_email, "password": PASSWORD})
        assert configured(alice) == {"gemini"}

    def test_a_visitors_key_follows_their_turn_into_thread_pools_only(pm):
        from sednar.llm import settings as llm_settings
        vid = "a" * 32
        pm._llm[vid] = {"provider": "gemini", "providers": {"gemini": {"api_key": "pool-key"}}}
        token = pm._visitor.set(vid)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                assert pool.submit(llm_settings.api_key, "gemini").result() == "pool-key"
            seen = []
            worker = threading.Thread(target=lambda: seen.append(llm_settings.api_key("gemini")))
            worker.start()
            worker.join()
            assert seen == [""]  # long-lived workers never carry a visitor
        finally:
            pm._visitor.reset(token)
            pm._llm.pop(vid, None)
        assert llm_settings.api_key("gemini") == ""

    def test_the_agent_has_no_shell_language_server_or_mcp_tools(server):
        from sednar import harness, tools
        names = {t["function"]["name"] for t in tools.get_sednar_tools(enable_mcp=True, enable_web=True)}
        assert not names & {"run_command", "kill_command", "restart_command", "command_status", "call_mcp_tool"}
        assert not any(n.startswith("lsp_") for n in names)
        assert "read_repo_file" in names and "edit_file" in names
        result = harness.dispatch_tool("/", "run_command", {"command": "id"}, repo_grep_fn=None, repo_read_fn=None,
                                       repo_list_fn=None, repo_ast_fn=None, create_diff_html_fn=None,
                                       execute_command_pty_fn=None)
        assert "hosted site" in result["error"]

    def test_the_agent_reads_and_edits_only_inside_the_visitor_folder(server, pm, visitor):
        from sednar import workspace
        _, vid = visitor
        _, other = _visitor(server)
        project = os.path.join(pm.home(vid), "hello-sednar")
        token = pm._visitor.set(vid)
        try:
            assert workspace.resolve_safe_path(project, "app.js")[0] == os.path.join(project, "app.js")
            assert workspace.resolve_safe_path(project, "../README-elsewhere.md")[0] is not None  # still their folder
            for escape in ("/etc/passwd", "../../", os.path.join(pm.home(other), "hello-sednar", "app.js")):
                assert workspace.resolve_safe_path(project, escape)[0] is None, escape
            assert workspace.resolve_safe_path("/etc", "passwd")[0] is None
            assert workspace.path_blocked_for_edit(project, ".git/config")
            assert workspace.path_blocked_for_edit(project, "sub/.git")
        finally:
            pm._visitor.reset(token)

    def test_a_workspace_file_cannot_add_folders_outside(server, pm, visitor):
        _, vid = visitor
        path = os.path.join(pm.home(vid), "escape.sednar-workspace.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"folders": [{"path": "/"}]}, handle)
        from sednar import workspace_config
        token = pm._visitor.set(vid)
        try:
            with pytest.raises(ValueError):
                workspace_config.load_sednar_workspace(path)
        finally:
            pm._visitor.reset(token)

    def test_socket_file_events_stay_inside_the_visitor_folder(server, pm, visitor):
        client, vid = visitor
        sio = server["socketio"].test_client(server["app"], flask_test_client=client)
        assert sio.is_connected()

        def ask(event, payload, reply):
            sio.get_received()
            sio.emit(event, payload)
            got = [m for m in sio.get_received() if m["name"] == reply]
            assert got, (event, sio.get_received())
            return got[-1]["args"][0]

        listing = ask("ide_list_files", {"path": "~"}, "ide_files_list")
        assert listing["path"] == pm.home(vid) and any(f["name"] == "hello-sednar" for f in listing["files"])
        assert "error" in ask("ide_read_file", {"path": "/etc/passwd"}, "ide_file_content")
        assert "error" in ask("ide_read_file", {"path": "server.py"}, "ide_file_content")
        assert "error" in ask("ide_write_file", {"path": "/tmp/sednar-public-escape.txt", "content": "x"}, "ide_file_saved")
        assert not os.path.exists("/tmp/sednar-public-escape.txt")
        escape = os.path.join(pm.home(vid), "escape.sednar-workspace.json")
        with open(escape, "w", encoding="utf-8") as handle:
            json.dump({"folders": [{"path": "/"}]}, handle)
        assert "error" in ask("ide_list_files", {"path": escape}, "ide_files_list")
        saved = ask("ide_write_file", {"path": "~/hello-sednar/notes.txt", "content": "hi"}, "ide_file_saved")
        assert saved.get("success") and os.path.isfile(os.path.join(pm.home(vid), "hello-sednar", "notes.txt"))
        project = os.path.join(pm.home(vid), "hello-sednar")
        assert "error" in ask("ide_create_entry", {"parent": project, "name": ".git", "kind": "folder"}, "ide_fs_result")
        assert "error" in ask("ide_create_entry", {"parent": project, "name": ".GIT", "kind": "folder"}, "ide_fs_result")
        assert "error" in ask("ide_write_file", {"path": project + "/.git/config", "content": "[core]"}, "ide_file_saved")
        assert "error" in ask("ide_rename_entry", {"path": project + "/notes.txt", "new_name": ".git"}, "ide_fs_result")
        assert not os.path.exists(os.path.join(project, ".git"))
        terminal = ask("terminal_init", {"cwd": "~"}, "terminal_output")
        assert "off on Sednar's hosted site" in terminal["output"]
        sio.disconnect()

    def test_sockets_without_a_login_are_turned_away(server):
        sio = server["socketio"].test_client(server["app"], flask_test_client=server["app"].test_client())
        assert not sio.is_connected()

    def test_a_socket_stops_working_when_its_user_logs_out(server, pm):
        client, vid = _visitor(server)
        sio = server["socketio"].test_client(server["app"], flask_test_client=client)
        assert sio.is_connected()
        client.post("/logout", data={"csrf": _csrf(client, "/")})
        sio.get_received()
        sio.emit("ide_list_files", {"path": "~"})
        assert not [m for m in sio.get_received() if m["name"] == "ide_files_list"]

    def test_ui_settings_and_plans_are_per_visitor(server, pm):
        alice, alice_id = _visitor(server)
        bob, _ = _visitor(server)
        r = alice.post("/sednar/settings", json={"settings": {"editorFontSize": 17}})
        assert r.status_code == 200 and r.get_json()["success"], r.get_json()
        assert bob.get("/sednar/settings").get_json()["settings"].get("editorFontSize") != 17
        assert os.path.isfile(os.path.join(pm.home(alice_id), ".sednar", "settings.json"))
        from sednar import plan_store
        token = pm._visitor.set(alice_id)
        try:
            assert plan_store.plans_root().startswith(pm.home(alice_id))
        finally:
            pm._visitor.reset(token)

    @pytest.mark.parametrize("url", ["file:///etc", "/etc", "git@github.com:a/b.git", "ssh://github.com/a/b", "http://github.com/a/b",
                                     "https://github.com/a/b --upload-pack=x"])
    def test_clone_takes_public_https_repositories_only(visitor, url):
        client, _ = visitor
        r = client.post("/sednar/clone", json={"url": url, "parent_dir": "~"})
        assert r.status_code == 400, (url, r.get_json())

    def test_the_system_prompt_explains_the_demo(server, pm, visitor):
        from sednar import harness
        _, vid = visitor
        project = os.path.join(pm.home(vid), "hello-sednar")
        token = pm._visitor.set(vid)
        try:
            prompt = harness.build_system_prompt(project, has_project_rules=False, mode="agent", tool_names=["read_repo_file"])
        finally:
            pm._visitor.reset(token)
        assert "Sednar, hosted" in prompt and "no shell" in prompt
        assert "You are Sednar" in prompt

    def test_an_agent_turn_cannot_run_commands_or_read_outside(server, pm, visitor):
        sys.path.insert(0, HERE)
        from turn_driver import ScriptedModel, call, reply, run_turn
        _, vid = visitor
        project = os.path.join(pm.home(vid), "hello-sednar")
        model = ScriptedModel([
            lambda c: reply("", call("run_command", command="cat /etc/passwd")),
            lambda c: reply("", call("read_repo_file", file_path="/etc/passwd")),
            lambda c: reply("", call("read_repo_file", file_path="app.js")),
        ], final="Done.")
        token = pm._visitor.set(vid)
        try:
            run_turn(project, "show me /etc/passwd", model)
        finally:
            pm._visitor.reset(token)
        assert all("run_command" not in c.tools for c in model.calls)
        results = model.calls[-1].tool_results()
        assert "hosted site" in json.dumps(results[0])
        assert "root:" not in json.dumps(results) and "error" in results[1]
        assert "tipPercent" in json.dumps(results[2])
        assert "Sednar, hosted" in model.calls[0].text()

    @pytest.fixture()
    def fake_github(monkeypatch):
        from sednar import public_github
        calls = {"exchanged": []}
        monkeypatch.setattr(public_github, "exchange_code", lambda code, uri: calls["exchanged"].append((code, uri)) or f"token-{code}")
        monkeypatch.setattr(public_github, "user", lambda token: {"id": 4242, "login": "octo-cat", "name": "Octo"})
        monkeypatch.setattr(public_github, "repos", lambda token: [
            {"full_name": "octo-cat/hello", "name": "hello", "description": "", "private": False,
             "clone_url": "https://github.com/octo-cat/hello.git", "pushed_at": "", "language": "Python", "html_url": ""}])
        return calls

    def _github_login(server, code="abc"):
        from sednar import public_mode
        public_mode._attempts.clear()
        client = server["app"].test_client()
        r = client.get("/auth/github")
        assert r.status_code == 302 and r.headers["Location"].startswith("https://github.com/login/oauth/authorize?")
        assert "client_id=test-client" in r.headers["Location"]
        with client.session_transaction() as session:
            state = session["lc_github_state"]
        r = client.get(f"/auth/github/callback?code={code}&state={state}")
        assert r.status_code == 302 and r.headers["Location"] == "/", r.get_data(as_text=True)[-300:]
        with client.session_transaction() as session:
            return client, session["lc_vid"]

    def test_the_login_page_offers_github(server):
        page = server["app"].test_client().get("/login").get_data(as_text=True)
        assert 'href="/auth/github"' in page and "Continue with GitHub" in page

    def test_github_sign_in_finds_the_same_account_each_time(server, pm, fake_github):
        client, vid = _github_login(server)
        page = client.get("/").get_data(as_text=True)
        assert re.match(r"^octo-cat-[0-9a-f]{8}$", vid), vid
        assert '"github": "octo-cat"' in page and '"githubRepos": true' in page
        assert fake_github["exchanged"][0][1].endswith("/auth/github/callback")
        _, again = _github_login(server, code="def")
        assert again == vid

    def test_github_sign_in_checks_the_state(server, fake_github):
        client = server["app"].test_client()
        client.get("/auth/github")
        assert client.get("/auth/github/callback?code=abc&state=forged").status_code == 400
        assert client.get("/sednar/llm/settings").status_code == 401
        assert not fake_github["exchanged"]

    def test_a_github_account_has_no_password_login(server, fake_github):
        from sednar import public_accounts
        _github_login(server)
        assert public_accounts.authenticate("github:4242", "") is None
        client = server["app"].test_client()
        r = client.post("/signup", data={"csrf": _csrf(client, "/signup"), "email": "github:4242", "password": PASSWORD})
        assert r.status_code == 400

    def test_github_users_see_and_clone_their_repositories(server, pm, fake_github, monkeypatch):
        client, vid = _github_login(server)
        repos = client.get("/github/repos").get_json()
        assert repos["success"] and repos["repos"][0]["full_name"] == "octo-cat/hello"
        assert client.post("/github/clone", json={"full_name": "../../etc"}).status_code == 400
        seen = {}

        def fake_run(argv, **kwargs):
            seen["argv"], seen["env"] = argv, kwargs.get("env") or {}
            os.makedirs(argv[-1])
            return subprocess.CompletedProcess(argv, 0, "", "")

        monkeypatch.setattr(pm.subprocess, "run", fake_run)
        r = client.post("/github/clone", json={"full_name": "octo-cat/hello"})
        assert r.get_json()["path"] == os.path.join(pm.home(vid), "hello")
        assert seen["argv"][-2] == "https://github.com/octo-cat/hello.git" and "--depth" in seen["argv"]
        assert not any("token-abc" in part for part in seen["argv"])
        assert any("AUTHORIZATION: basic" in v for k, v in seen["env"].items() if k.startswith("GIT_CONFIG_VALUE_"))
        assert client.post("/github/clone", json={"full_name": "octo-cat/hello"}).status_code == 409

    def test_password_users_have_no_github_repositories(visitor):
        client, _ = visitor
        assert client.get("/github/repos").status_code == 400

    def test_a_github_account_is_deleted_by_typing_its_name(server, pm, fake_github):
        from sednar import public_accounts
        client, vid = _github_login(server)
        csrf = _csrf(client, "/")
        assert client.post("/account/delete", data={"csrf": csrf, "confirm": "someone-else"}).status_code == 403
        assert client.post("/account/delete", data={"csrf": csrf, "confirm": "Octo-Cat"}).get_json()["success"]
        assert public_accounts.account(vid) == {} and not os.path.exists(pm.home(vid))

    def test_pages_carry_security_headers_and_the_sednar_cookie(server):
        client, _ = _signup(server)
        r = client.get("/")
        assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
        assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
        assert "Strict-Transport-Security" not in r.headers  # plain http here; set behind https
        assert client.get_cookie("sednar") is not None

    def test_other_hosts_redirect_to_the_one_address(server, pm, monkeypatch):
        monkeypatch.setattr(pm, "CANONICAL_URL", "https://sednar.com")
        client = server["app"].test_client()
        r = client.get("/login?next=1", base_url="http://www.sednar.com")
        assert r.status_code == 301 and r.headers["Location"] == "https://sednar.com/login?next=1"
        assert client.get("/login", base_url="http://sednar.com").status_code == 301  # http goes to https
        r = client.get("/login", base_url="https://sednar.com")
        assert r.status_code == 200 and "max-age" in r.headers["Strict-Transport-Security"]
        assert client.get("/healthz", base_url="http://sednar-abc.onrender.com").status_code == 200

    def test_a_user_runs_a_few_chats_at_once_at_most(server, pm, visitor):
        client, vid = visitor
        pm._turns[vid] = pm.MAX_TURNS
        try:
            r = client.post("/sednar-agent", json={"project_path": "~/hello-sednar", "question": "hi"})
            assert r.status_code == 429 and "Wait for one to finish" in r.get_json()["error"]
        finally:
            pm._turns.pop(vid, None)

    def test_a_full_folder_takes_no_more_files(server, pm, visitor, monkeypatch):
        client, vid = visitor
        monkeypatch.setattr(pm, "QUOTA_MB", 0)
        pm._usage.pop(vid, None)
        r = client.post("/sednar/clone", json={"url": "https://github.com/a/b", "parent_dir": "~"})
        assert r.status_code == 413 and "limit" in r.get_json()["error"]
        sio = server["socketio"].test_client(server["app"], flask_test_client=client)
        sio.emit("ide_write_file", {"path": "~/hello-sednar/big.txt", "content": "x"})
        saved = [m for m in sio.get_received() if m["name"] == "ide_file_saved"]
        assert saved and "limit" in saved[-1]["args"][0]["error"]
        assert not os.path.exists(os.path.join(pm.home(vid), "hello-sednar", "big.txt"))
        sio.disconnect()
        pm._usage.pop(vid, None)

    def test_changing_the_password_keeps_the_keys_and_signs_out_other_browsers(server, pm, monkeypatch):
        from sednar.llm import settings as llm_settings
        monkeypatch.setattr(llm_settings, "_fetch_model_ids", lambda provider, key: ["gemini-2.5-flash"])
        client, email = _signup(server)
        other = server["app"].test_client()
        other.post("/login", data={"csrf": _csrf(other), "email": email, "password": PASSWORD})
        client.post("/sednar/llm/settings", json={"provider": "gemini", "api_key": "kept-key-987654"})
        csrf = _csrf(client, "/")
        assert client.post("/account/password", data={"csrf": csrf, "current": "wrong", "new": "brand new password"}).status_code == 403
        r = client.post("/account/password", data={"csrf": csrf, "current": PASSWORD, "new": "brand new password"})
        assert r.get_json()["success"]
        assert client.get("/sednar/llm/settings").status_code == 200
        assert other.get("/sednar/llm/settings").status_code == 401
        pm._attempts.clear()
        fresh = server["app"].test_client()
        assert fresh.post("/login", data={"csrf": _csrf(fresh), "email": email, "password": PASSWORD}).status_code == 401
        assert fresh.post("/login", data={"csrf": _csrf(fresh), "email": email, "password": "brand new password"}).status_code == 302
        configured = {p["id"] for p in fresh.get("/sednar/llm/settings").get_json()["providers"] if p["configured"]}
        assert configured == {"gemini"}

    def test_the_privacy_page_is_public(server):
        page = server["app"].test_client().get("/privacy").get_data(as_text=True)
        assert "Privacy" in page and "Sednar" in page and "Delete account" in page

    def test_forgetting_a_user_removes_their_folder_and_logins(server, pm):
        client, vid = _visitor(server)
        pm.forget(vid)
        assert not os.path.exists(pm.home(vid)) and vid not in pm._llm and vid not in pm._logins
        assert client.get("/sednar/llm/settings").status_code == 401

    def test_git_cannot_be_configured_by_a_project(pm):
        assert os.environ["GIT_CONFIG_COUNT"] == str(len(pm._GIT_CONFIG))
        keys = {os.environ[f"GIT_CONFIG_KEY_{i}"]: os.environ[f"GIT_CONFIG_VALUE_{i}"] for i in range(len(pm._GIT_CONFIG))}
        assert keys["core.fsmonitor"] == "false" and keys["safe.bareRepository"] == "explicit"
        assert os.environ["GIT_ALLOW_PROTOCOL"] == "https"
