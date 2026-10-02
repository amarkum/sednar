# Changelog

Notes for the agent harness: what was added, and which files changed. Newest first.

## A clearer way in, October 2026

The hosted site's first minutes, made less confusing (`public_mode.py`, `public_github.py`, `static/js/sednar-public.js`, `static/css/sednar-public.css`, `static/js/sednar.js`).

- **Logged out:** the login card sits in the middle of the editor, where the welcome screen's Open project, Clone repo and New project cards used to invite clicks that only opened a dialog. The top bar keeps just the theme button, the chat panel says to log in, and the left bar says where projects will appear. A click or key anywhere else brings the card forward. `#signup` in the address opens it on Create your account.
- **One GitHub button:** "Continue with GitHub" has GitHub's own look (light on dark themes, dark on light) so it no longer reads as a second Log in button. It appears only when a GitHub OAuth app is configured, on the page and on `/login` and `/signup` alike (`githubLogin` in the page config).
- **GitHub errors:** a failed or cancelled callback sends the visitor to `/login` with the reason shown once (a flash in the session), instead of rendering the login page at `/auth/github/callback?code=…`, which failed again on reload. The messages say what to do next. `/auth/github` while logged in goes to the editor.
- **`/login`, `/signup` and `/privacy`** follow the editor's theme (Black by default, or the one saved in the editor, or the system's when the editor follows it) instead of the system's light mode. The sign-up page says how long a password must be. Privacy's back link goes to the editor.
- **Logged in:** the welcome card is three numbered things to know, with "Not now" instead of "Look around first"; the account page has Log out beside the name; paths inside the user's folder show as `~/…` and never the server's path (`_sednarShortPath`); the clone and new-project dialogs default to `~`; the folder picker has no Downloads, Desktop or `..` above the user's folder; GitHub users get a "Your GitHub repositories" card on the welcome screen and a "Paste a URL instead" button in the repository picker. When the server has no sandbox (`terminal: false` in the page config), the terminal button and Terminal settings are not shown.
- **Tests:** `test_public_mode.py` covers the redirect-and-message callback, a cancelled sign-in, and a server without a GitHub app.

## Sednar: the hosted site, October 2026 (amarkum/sednar)

- **No built-in browser:** the built-in browser, design compare and Figma were removed from Sednar; it edits code. Gone are `browser.py`, `browser_stream.py`, `browser_snapshot.py` and `figma.py`, the `browser` tool, the `/sednar/browser/...` and `/sednar/figma/token` routes, the Browser tab and Settings > Browser, the UI-check and design gates, opening sites from chat and the go-ahead for a send, post or buy step the request asked for, `~/.sednar/browser.json`, and Playwright and browser-cookie3 in `requirements.txt`.
- **Public mode** (`public_mode.py`, `SEDNAR_PUBLIC=1`): a site where people sign up and log in, then use their own API key. Each account gets a folder under `SEDNAR_PUBLIC_ROOT` with the sample project from `public/sample-project/`. The janitor closes an idle user's browser after 20 minutes.
- **Accounts** (`public_accounts.py`): SQLite with scrypt password hashes; `/signup`, `/login`, `/logout` and `/account/delete`, with CSRF tokens and rate limits. Saved API keys are AES-GCM encrypted under a key derived from the password, so they unlock only at login; open logins and unlocked keys live in memory only, and a restart logs everyone out.
- **Sign in with GitHub** (`public_github.py`): `/auth/github` and its callback (OAuth state checked), with accounts found by GitHub user id and never joined to a password account by email. Their saved keys are encrypted under a key from the server's secret. Settings > Account's "Open a repository…" lists `/github/repos` and clones one with `/github/clone` (the token goes to git through the environment, never the command line or `.git/config`). `SEDNAR_GITHUB_PRIVATE_REPOS=1` adds private repositories.
- **Per-user state:** `llm.settings._read/_write` keep a dict per user in memory and save it encrypted; `agent_settings._read_saved/_write_saved`, `settings_store._path` and `plan_store.plans_root` point into the user's folder. The user follows a turn into `ThreadPoolExecutor` tasks and into the harness's short-lived threads, but never into long-lived workers such as the browser's.
- **One gate for every request and socket event:** path fields must stay inside the visitor's folder (`~` means that folder), routes that run programs or change shared settings answer 403, and `/sednar-agent` runs without MCP. `resolve_safe_path`, `path_blocked_for_edit` (no edits inside `.git`) and the workspace loaders are wrapped so the agent stays inside too.
- **No shell:** `run_command`, `kill_command`, `restart_command`, `command_status`, `call_mcp_tool` and the `lsp_*` tools are not offered and are refused, the terminal socket answers that it is off, `/sednar/lsp/config` and `/sednar-mcp/status` report nothing configured, and git runs under `GIT_CONFIG_*` overrides (no fsmonitor, hooks, symlinks or implicit bare repos; https only). Clone is https only, `--depth 1`, 200 MB at most.
- **Browser:** `normalize_url` and a context-wide request route refuse local and private addresses. `/preview/<visitor>/…` serves the visitor's files to the server's own browser only, with `Content-Security-Policy: sandbox`. The system prompt tells the agent about the demo and its preview address.
- **Page:** `static/js/sednar-public.js` and `static/css/sednar-public.css` open the sample project, clear another account's projects and chats from the browser's storage, hide the terminal, MCP and Languages settings, show a "Try Sednar" card until a key is added, and add Settings > Account, opened by a user icon in the top bar (who is signed in, API keys, GitHub repositories, password, log out, privacy, delete account).
- **Sednar:** the hosted site's name (`SEDNAR_PUBLIC_BRAND`) is in the page title, the login and sign-up pages, the welcome card, the "off" messages and the agent's prompt. The page script rewrites the app's visible "Sednar" labels, leaving the editor, terminal, form fields and chat messages alone. The Render service is `sednar`.
- **Everything is called Sednar:** the package, folder, routes (`/sednar/...`), settings (`SEDNAR_*`), storage (`~/.sednar`, `sednar_*` browser keys), files (`static/js/sednar.js`, `static/css/sednar.css`) and every page and Markdown file. The code must sit in a folder named `sednar`, because it imports itself by that name. The "Run it yourself" link appears only when `SEDNAR_PUBLIC_SOURCE_URL` is set.
- **Editing only:** the hosted site has no built-in browser: the browser tool, its routes, the Browser tab and Settings > Browser are off, and the image installs no Chromium. Black is the default theme, and the empty editor shows the full Sednar logo.
- **Logo:** `static/assets/sednar/` has the emblem (`sednar-mark.png`), the wordmark and the emblem-plus-wordmark lockup in white and dark, and the app icon (emblem on a dark rounded tile) at 16 to 512 px with `favicon.ico`, `apple-touch-icon.png` and `site.webmanifest`. The page, sign-in pages, welcome card, empty editor and README use them.
- **Production:** gunicorn (`gunicorn.conf.py`, one process, `gthread`) serves the image; other hosts redirect to `SEDNAR_PUBLIC_URL` (https://sednar.com in `render.yaml`, with sednar.com and www.sednar.com as custom domains); security headers on every response; the login cookie is `__Host-sednar` over HTTPS; at most `SEDNAR_PUBLIC_MAX_TURNS` chats working per user and a `SEDNAR_PUBLIC_QUOTA_MB` folder quota; change password (re-encrypts the saved keys and signs out other browsers); a `/privacy` page. The README is titled Sednar.
- **Settings icons:** Agent is a bot, Harness a gauge, Models a chip, Rules a scroll, and MCP is drawn on the same 24px grid as the rest.
- **Hosting:** `Dockerfile` (Chromium through Playwright, `/healthz`, all state in `/data`), `docker-entrypoint.sh` (makes a mounted disk writable, then runs as a non-root user), `.dockerignore`, `render.yaml` (Starter with a 1 GB disk), and `server.py` listens on `$PORT` and `0.0.0.0` in public mode. The `sednar-public` launch configuration runs it locally on port 9002.
- **Tests:** `tests/test_public_mode.py` runs itself again in a child process with public mode on and covers sign-up, log-in, log-out, account deletion, encrypted keys, user isolation, keys across thread pools, blocked routes, socket events, a scripted agent turn, browser address rules and previews.

## Harness without patchy edges, and a page that does not flicker, October 2026

### Harness

- **No invented go-aheads.** An answer that ends by asking whether to send, post, submit, book or buy is held: when the request authorised that step the agent is told to do it, when the step is routine (a rename, a dependency, a check-in) it is told to carry on, otherwise it must ask in the questions card (`ASK_IN_CARD_TEMPLATE`, `GO_AHEAD_TEMPLATE`, `_asked_step_authorized`, `_asked_step_is_routine` in `harness.py`).
- **Every finish goes through the gates.** `attempt_completion` and a plain text answer take the same `_closing_gate`: to-do list, permission, UI check, design match, failing tests, then the project's checks. A stationarity hard stop ends the turn with its reason in the answer.
- **Checks run after edits** (`verification.py`, `detect_check_command`): a project with `npm test`, `pytest`, `cargo test`, `go test`, `make test` or `tsc` gets its check run when the agent finishes after editing code without testing. The run appears as a command card (`tool_call_id` `auto-check-N`), a failure's tail goes back to the model and holds the turn, twice at most (`AUTO_CHECK_MAX_RUNS`). Settings > Harness > Run the project's checks (`auto_checks`) turns it off.
- **One reminder a step.** The nudges are one if/elif chain by priority: loop guard, budget, failed edit, failing tests, exploration streak (a late variant when the turn is long), scattered searches, directory drilling, finish after editing, to-do list.
- **Context measured properly.** Images count as 1,400 tokens each, the tool schemas count against the budget, the budget comes from the model's real working window (`working_context_tokens`). Compaction keeps the failure lines and tail of command output (`command_output_digest`) and browser steps keep action, URL, title and verdict. Session compaction measures the projected history and compacts at a threshold above the in-turn one.
- **Prompt built from the tools offered** (`build_system_prompt(..., mode, tool_names)`): sections appear only for tools the turn has; the compact prompt is gone.
- **Routing with fewer false positives** (`routing.py`): closing remarks ("thanks, that fixed it") are chat only, questions are not hard tasks, a version question is not a version bump, "dont check the page" is honoured, URLs quoted as evidence ("the request to localhost:8000 returns 500") do not open the browser, and coding vocabulary ("add a POST endpoint", "wire the submit button") authorises nothing.
- **Retries:** 409 is not retried; 408, 425, 429, 5xx and 529 are, as are stream drops.

### Page

- **In-place patching** (`_sednarMorph`): the settings page, questions card, chat tabs, project tabs, queue bar and changes list are patched node by node instead of rebuilt, keyed by `data-key` or `id`, so focus, typed text, scroll position, open menus and running spinners survive a re-render. New nodes are adopted, not cloned, so listeners the renderer attached stay.
- **Chat:** a finished streamed answer is rendered off screen and patched onto the streamed nodes; command output is written once per frame and only follows its tail while the reader has not scrolled up; pinned user messages move in the same frame as the scroll with their row gaps cached; collapse measurement reads every row before writing; the transcript snapshot is written when the browser is idle and re-parsed only when there is an error row to strip; the thinking label writes only when it changed.
- **Browser tab:** the last frame stays on screen when the stream closes, the stage follows a pane drag at once and only the viewport resize waits, a changed frame size is re-fitted on the next poll, the agent pill keeps showing for eight seconds between steps and lost its entrance animation and blur.
- **Settings:** the search filters a beat after the last keystroke; a reply to an earlier save no longer flips a switch toggled while it was in flight; editor and terminal settings re-apply only when one of theirs changed.
- **Less work on the main thread:** the file tree redraws only when a silent refresh found a change; the toast has a class and is re-attached if it was detached; the body observer highlights scripts only when a script block was added; the MCP tool chip renders the settings page once; `transition: all` became the properties that change; the plan view's theme watcher starts from the right theme name; `static/assets/monaco-themes.json` ships (empty) so the page no longer 404s on load.
- **Tests:** `tests/test_frontend_morph.py` (Chromium), `test_auto_checks.py`, `test_compaction.py`, `test_retry.py`, `test_classifier.py`, and the turn driver records the page's progress events.

## Merged with main's settings and harness work, October 2026

Main was rewritten to its own history with a large Settings and harness commit. Both sides are merged here:

- **Settings UI:** main's pages are kept (General, Appearance, Agent, Harness, Plan mode, Memory, Browser, with search, backup and reset). This branch's Editor, Browser, Design and Memory tabs were dropped for them; its Terminal tab stays, and main's Design checks gain the Compare and UI check rows. Preferences are stored in `~/.sednar/settings.json`, which Reset all also clears.
- **Memory:** main's Memory page and routes, plus this branch's read and save of MEMORY.md and session logs on `/sednar/memory/file` when a path is given.
- **Chrome:** main's probe, detect and launch, with one launcher underneath that reuses a running Chrome or starts one it closes on disconnect.
- **Harness:** main's retries, streaming, settings-disabled tools and parse-error guard, together with this branch's gates, transcripts and removals.

The section below describes this branch's own Settings tabs; where it differs, this note wins.

## Settings, memory, transcripts and Chrome launch, October 2026

Ported from IntelIDE's change list, saved in `docs/ports/intelide-2026-10.md`. Its Files/S3 and Workbench shell sections have no counterpart in Sednar and were not ported.

### Settings backed by a file

- **`settings_store.py`** keeps Sednar's preferences in `~/.sednar/settings.json`. Keys match `^[A-Za-z][A-Za-z0-9_]{0,63}$`, at most 200 of them; values are bool, number or string, strings up to 500 characters. Writes are atomic (temp file and `os.replace`) under a lock.
- **Routes:** `GET/POST /sednar/settings` (`{settings: {key: value | null}}`, null removes; rejected keys come back in `rejected`) and `POST /sednar/settings/reset`, which also clears the browser and design preferences through `reset_browser_settings()` and keeps an attached Chrome.
- **The page** loads settings from the server, mirrors them to localStorage, and moves values from before the server kept them. Panel sizes (`explorerWidth`, `terminalHeight`, `chatPanelWidth`) are settings too.
- **The view** is renamed Settings and regrouped: Editor (font size, tab size, word wrap, line numbers, minimap; applied live), Terminal (font size, cursor, blink, scrollback; applied live), Browser and Design (the rows that were under Agent > Browser), Memory, and Reset all under General. Messages point to "Settings > Browser".

### Rules

- The rules list is deduplicated by file identity (`st_dev`, `st_ino`) instead of the real path, in `rules.py` (`file_identity`) and the rules route, so a symlink or hard link to a rule file shows once.

### Memory tab

- `memory/storage.py` gains `editable_memory_rel` (only `MEMORY.md` and `sessions/*.md`), `list_editable_memory`, `read_editable_memory` and `save_editable_memory`: per-project lock, atomic writes, nothing written for ephemeral workspaces. `memory.save_memory_file` also refreshes the search index.
- **Routes:** `GET/POST /sednar/memory` (listing) and `POST /sednar/memory/file` (reads without `content`, saves with it). 400 for other paths or non-text content, 404 for a missing log, 500 with a readable message on OS errors.

### Chats saved as the rendered transcript

- Each session keeps `transcript.html`, the HTML the page rendered (40 MB cap, written atomically). Loading a chat returns `transcript_html` and `message_count`.
- **Route:** `POST /sednar/session/transcript` with `project_path`, `session_id` and `html`. 400 when the chat is not in that workspace; over the cap it answers `success: false, reason: "too_large"`, not an error. The page sends the transcript after each turn, only for the open workspace.
- **Removed:** `save_diff_record`, `load_diff_records`, `save_tool_artifact`, `load_tool_artifacts`, `format_messages_for_display` and their helpers in `session.py`, their callers in `harness.py`, `display_subagent_result` in `subagent.py`, and the page's JSON-history renderer. A chat saved before transcripts shows a note that its history is still there for the agent.
- **Chat:** the questions card shows one question at a time (Next, then Continue); a finished command's long output fades before the card folds; the view stays pinned to the bottom while a reply streams and unpins only when the reader scrolls up.

### Browser

- **`launch_chrome_and_attach(port=9222)`** finds Chrome on mac, Windows or Linux (or `SEDNAR_CHROME_EXECUTABLE`), starts it with `--remote-debugging-port` and a profile at `~/.sednar/chrome-debug-profile` (log in `chrome-debug.log`), waits up to 12 s for the port, then attaches. Ports 1024 to 65535; refused when `SEDNAR_BROWSER_CDP_URL` is set. Turning the connection off closes a Chrome Sednar started.
- `connection_status()` reports `managed_launch`, `pid`, `profile_dir` and `port`. `_browser_connection_update()` handles launch, attach and disconnect for the HTTP route and a new Socket.IO pair, `sednar_browser_connection` and `sednar_browser_connection_result`.
- **UI:** a Launch Chrome button in Settings > Browser; in the Browser tab an engine chip (Chromium, Chrome, Chrome launched), a resolution chip that always shows the page size, and a theme-aware stage background.

### Prompts and tools

- The hardcoded Python-quality guidance (pre-commit, ruff, black, SonarQube) is gone from `prompts.py`.
- `git commit` runs as written: the `Co-authored-by: Sednar` trailer is no longer injected (`tools.py`), and the tool description and prompt no longer mention it.
- **`UI_VERIFY_CROP_GUIDE`:** when checking UI, crop the shared parent container so neighbouring elements show together, and back the crop with a measurement.

### UI polish

- The mode chip is tinted per mode (Agent neutral, Plan amber, Ask blue with a chat-bubble icon).
- Dividers have wider grab areas.
- The terminal has inner padding and an ANSI palette per light or dark theme.
- The design accuracy slider has a clear accent in the dark themes.

### Legacy storage removed

- `project_store.py` no longer migrates old slug-keyed project folders or adopts old multi-folder workspace storage. `project_dir`, `existing_project_dir` and `workspace_state_path` use the hashed key only. **Impact:** project folders that were never migrated, and chats that exist only as message JSON, are not migrated or shown any more. Their files stay on disk, and the agent still reads a chat's history.

### Files changed

| File | Change |
| --- | --- |
| `settings_store.py` | New: the settings file |
| `routes.py` | Settings, memory and transcript routes; connection update and Socket.IO pair; rules by file identity |
| `rules.py` | `file_identity` |
| `memory/storage.py`, `memory/__init__.py` | Editable memory files |
| `session.py`, `subagent.py`, `harness.py` | Transcript save/load; display records removed |
| `browser.py`, `browser_snapshot.py` | Chrome launch, managed status, `reset_browser_settings`, "Settings > Browser" |
| `prompts.py`, `tools.py` | Quality guidance and trailer removed; crop guide |
| `project_store.py` | Legacy migration removed |
| `static/js/sednar.js`, `static/css/sednar.css` | Settings tabs and server-backed settings, Memory tab, transcripts, questions one at a time, pinned scroll, command fade, Chrome launch, chips, mode chip, panel sizes, dividers, terminal |
| `README.md` | Settings tabs, new files and variables |
| `tests/` | `test_settings_store.py`, `test_memory_editor.py`, `test_rules.py`, `test_transcript.py`, `test_chrome_launch.py`, `test_project_store.py`, prompt tests; `app_client` fixture |

## Chat fixes and asking before a UI check, September 2026

Ported from the same fixes in IntelIDE.

### Agent

- **The agent asks before checking a UI change in the browser.** After a UI edit the reminder has it ask in the questions card, "Want me to verify the UI change in the browser?" (Yes / No). It opens the browser only on Yes, or without asking when the request already wants it seen (`user_requests_ui_check`: "check it in the browser", "take a screenshot", a URL, a design compare). On Yes it looks at a crop of just the changed element, not a full-page screenshot. No, a skip or a typed answer ends the reminders for the turn, and the answer's tool result tells the model to say the change was not checked. This replaces "UI changes are always checked in the browser" below.

### Chat UI

- **A pinned user message is pushed out by the next one** instead of the next one sliding over it. Natural positions are carried row by row, because a pinned row's `offsetTop` is its stuck position.
- **Questions card:** 10px of bottom padding in the scroll area, so a focused "Other..." row keeps its border; questions fade in only when a question set first appears, not on every click.
- **An empty tail below the last message** (10% of the chat height) whenever the chat has a message, never on the welcome screen. It no longer shrinks to nothing in a long chat (`flex: 0 0 auto`).
- **Images sent with a message open in the image viewer** (zoom cursor; works in restored chats; the click does not expand or collapse a long message).
- **Expanded command output has one scroller**, capped at `min(420px, 60vh)`. The outer body scrolled too, around an inner scroller that blocks scroll chaining, so the last lines of long output were out of reach.
- **The empty editor screen** no longer lists Agent / Explorer / Terminal.

### Files changed

| File | Change |
| --- | --- |
| `harness.py` | `_UiVerify` asks first, reads the answer (`observe_question`), `requested` from the request |
| `prompts.py` | `UI_VERIFY_QUESTION`, `UI_VERIFY_ASK_TEMPLATE`, `UI_VERIFY_DECLINED_NOTE`, crop in `UI_VERIFY_TEMPLATE`, system prompt Verifying paragraph |
| `routing.py` | `user_requests_ui_check` |
| `static/js/sednar.js` | Pinned row push-out and `_sednarUserRowNaturalTops`, questions fade once, sent-image click handler |
| `static/css/sednar.css` | Chat tail, questions padding and fade, thumbnail cursor, single command-output scroller, empty editor steps removed |
| `templates/sections/ide-editor.html` | Empty editor steps list removed |
| `tests/` | Ask, Yes and No turns; `_UiVerify` answers; `user_requests_ui_check`; prompt templates |

## Design compare, browser behaviour and asking, September 2026

### Design compare

- **Element by element is the default.** `compare` measures every element against its place in the design (position, size, padding, colours, font, radius, border, shadow). `elements: false` gives the old pixel comparison.
- **Layout mode ignores sample data.** Other words, numbers, images and extra copies of a repeated item (a 4th card where the design has 3) are counted in the summary and never a finding. `content: "exact"` or the Compare setting in Settings holds them against the page too.
- **A screenshot of one component is found on the page by itself.** A card, form or input box (1x or 2x) is matched by shape, remembered per screenshot, and compared one to one. When the element is fluid, the browser is resized to the width the design was made at. `locate: false` compares the view instead.
- **Whole-page compares are grouped into sections** (a card, a form, a header, a micro-frontend's root; copies of one component as one), so the agent fixes one section at a time.
- **Status labels are matched by their words**, wherever the design shows them, so a shuffled Sold, Paid, Cancelled is compared word to word. Sibling buttons in another order (Cancel and Save swapped) are one finding.
- **New findings:** padding (inferred from children that moved alike), border colour and corner radius of bordered boxes on their own colour, status colours.
- **Compare board restyled:** light theme, page in colour with numbered markers on the pixel board, larger type, count chips coloured by kind.

### Browser and dev server

- **"Go to this site and do this"** opens the page in the Browser tab by itself and carries out the steps. Known site names work without a domain ("go to amazon"), and "check it in the browser" means the user's own app.
- **UI changes are always checked in the browser.** A turn that edited components, pages, styles or templates cannot finish until it looked at the page after its last edit (at most two reminders; switch off in Settings).
- **New `restart_command` tool** stops a background dev server, frees its port (also for servers started elsewhere), starts it again and waits for its URL.
- **`reload {hard: true}`** clears the cache and service workers. Local pages that refuse the connection or show an error page point at the restart.

### Browser tab's live view

- **The frame is never stretched.** The stage takes the live frame's own aspect ratio (the screencast reports the page's real size, which also covers an attached Chrome), and the picture is drawn with `object-fit: contain`, so a frame that arrives before a fit resize finishes is letterboxed, not distorted. Pointer positions are mapped from the picture as drawn.
- **Selecting elements is instant.** The select tool loads a map of the visible elements once (`/sednar/browser/inspect-map`) and hit-tests it locally as the pointer moves, one test per animation frame; the map refreshes as frames change. The server round trip is only a fallback.

### Asking, and doing what was asked

- **The request's own final steps go through.** "Send Gurubani a message saying …" presses Send without a second yes, for send, post, submit, buy, book and confirm. "Don't send it" and "just draft it" are respected. Subagents get the same go-ahead.
- **"Shall I send it?" is sent back once** to do it instead of stopping.
- **The questions card is offered in every mode**, not only Plan mode. A question with no options is an open one (a text box); `allow_multiple` lets several options be picked. The answer continues the same turn.
- **Plan mode teaches all three question kinds** (one choice, several, open answer).

### Fixed

- Every agent turn crashed while building the system prompt, because literal braces were added to an f-string. A test now guards it.

### Files changed

| File | Change |
|---|---|
| `browser_stream.py` | Frame metadata (page size), real page size for attached Chrome |
| `browser.py` | `frame_size` in state, `inspect_map`; compare rewrite: layout mode, component locator, sections, padding, border, status matching, framing, hard reload, error-page hints, final-action authorisation, board style |
| `harness.py` | Site-visit and go-ahead notes, permission gate, UI-verify tracker and gate, questions card offered in agent mode, subagent go-ahead |
| `routing.py` | Site-visit and named-site detection, own-app detection, authorised final actions, permission-question detection, UI-file detection |
| `prompts.py` | Design-loop scope guidance, ask-or-act guidance, verify and restart guidance, Plan-mode question kinds, gate templates |
| `tools.py` | `restart_command` tool, `locate`, `content` and `hard` parameters, questions card in every mode, browser tool text |
| `bg_commands.py` | `restart`, port discovery and freeing |
| `questions.py` | Questions without options (open answers) |
| `subagent.py` | `restart_command` excluded for scoped writers |
| `routes.py` | `/sednar/browser/inspect-map`; settings comment for the new keys |
| `static/js/sednar.js` | Live view keeps the frame's aspect and maps pointers from the drawn picture, local element hit-testing, Browser tab comes forward on navigate, new Settings rows, open questions in the card |
| `static/css/sednar.css` | `object-fit: contain` on the live frame, "Pick any that apply" hint |
| `README.md` | Feature notes and how to run the tests |
| `tests/` | 124 tests: intent, prompts, agent turns with a scripted model, compare in Chromium, restart, front-end helper, fixtures |

### Settings added (`~/.sednar/browser.json`)

`compare_content` (`layout` or `exact`) and `ui_verify` (on by default).
