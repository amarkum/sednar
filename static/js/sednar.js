let ideEditor = null;

let ideTerminal = null;

let ideFitAddon = null;

let ideTerminalInitialized = false;

let ideFileTree = {};

let ideOpenFiles = {};

let ideActiveFile = null;

let ideExpandedFolders = new Set;

let sednarProjectPath = null;
window.getSednarProjectPath = function() { return sednarProjectPath; };

let sednarProjectName = null;

let sednarWorkspacePath = null;
let sednarWorkspaceFolders = [];
let sednarWorkspaceSettings = {};
let sednarWorkspaceMcpServers = {};
let sednarApplyingWorkspace = false;
let sednarWorkspaceMissingFolders = [];

let sednarMcpServers = [];
let sednarMcpSelectedServers = new Set();
let _sednarMcpStatusRequestSeq = 0;
let _sednarMcpStatusLoadedWithoutProbe = false;

let sednarAgentSessionId = null;
window.getSednarSessionId = function() { return sednarAgentSessionId; };

let sednarAgentRunning = false;

let sednarChatTabs = [];

let sednarActiveChatTabId = null;

let sednarChatTabCounter = 0;

let sednarTabsByProject = {};

let _sednarIdeSocket = null;

function _sednarGetIdeSocket() {
  if (_sednarIdeSocket) return _sednarIdeSocket;
  _sednarIdeSocket = (typeof socket !== "undefined" && socket)
    ? socket
    : io.connect(location.protocol + "//" + location.host, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
      });
  return _sednarIdeSocket;
}

const SEDNAR_IDE_SOCKET_TIMEOUT_MS = 15000;

function _sednarIdeSocketRequest(emitEvent, payload, responseEvent, matchFn, timeoutMs) {
  return new Promise(function(resolve) {
    const sock = _sednarGetIdeSocket();
    let done = false;
    let timer = null;
    function cleanup() {
      sock.off(responseEvent, onResponse);
      sock.off("connect_error", onConnectError);
      if (timer) clearTimeout(timer);
    }
    function onResponse(data) {
      if (done || (matchFn && !matchFn(data))) return;
      done = true;
      cleanup();
      resolve({ data: data });
    }
    function onConnectError(err) {
      if (done) return;
      done = true;
      cleanup();
      resolve({ error: "connect_error", data: { error: "Connection error: " + ((err && err.message) || err) } });
    }
    sock.on(responseEvent, onResponse);
    sock.on("connect_error", onConnectError);
    timer = setTimeout(function() {
      if (done) return;
      done = true;
      cleanup();
      resolve({ error: "timeout", data: { error: responseEvent + " timed out" } });
    }, timeoutMs || SEDNAR_IDE_SOCKET_TIMEOUT_MS);
    sock.emit(emitEvent, payload);
  });
}

const SEDNAR_COMPOSER_PLACEHOLDER = "Plan, Build, / for skills, @ for context";
const SEDNAR_FOLLOWUP_PLACEHOLDER = "Add a follow-up";

const SEDNAR_CHAT_MODES = [
  { value: "agent", label: "Agent", placeholder: SEDNAR_COMPOSER_PLACEHOLDER },
  { value: "plan", label: "Plan", placeholder: SEDNAR_COMPOSER_PLACEHOLDER },
  { value: "ask", label: "Ask", placeholder: SEDNAR_COMPOSER_PLACEHOLDER },
];

const SEDNAR_CHAT_MODE_STORAGE_KEY = "sednar-chat-mode";

const _SEDNAR_MODE_ICON_PATHS = {
  agent: '<path fill-rule="evenodd" clip-rule="evenodd" d="M6.75 9C5.1393 9 3.75 10.1979 3.75 12C3.75 13.8021 5.1393 15 6.75 15C8.93215 15 9.96658 13.7213 11.0909 12.0197C9.9648 10.2963 8.94769 9 6.75 9ZM11.9886 10.6591C10.9022 9.07118 9.47531 7.5 6.75 7.5C4.37993 7.5 2.25 9.30208 2.25 12C2.25 14.6979 4.37993 16.5 6.75 16.5C9.45251 16.5 10.8909 14.9553 11.9845 13.3798C12.4189 14.0069 12.9091 14.6294 13.5048 15.1451C14.4451 15.9593 15.6342 16.5 17.25 16.5C19.6201 16.5 21.75 14.6979 21.75 12C21.75 9.30208 19.6201 7.5 17.25 7.5C14.5253 7.5 13.0855 9.07015 11.9886 10.6591ZM12.8809 12.023C13.3905 12.8006 13.8793 13.4853 14.4866 14.0111C15.1705 14.6032 16.0158 15 17.25 15C18.8607 15 20.25 13.8021 20.25 12C20.25 10.1979 18.8607 9 17.25 9C15.0496 9 14.0162 10.3002 12.8809 12.023Z" fill="currentColor"></path>',
  plan: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"></circle>',
  ask: '<path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7.5L7 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="none"></path><line x1="7.5" y1="9.5" x2="16.5" y2="9.5"></line><line x1="7.5" y1="13" x2="13.5" y2="13"></line>',
};

const _SEDNAR_MODE_DROPDOWN_STYLE =
  "display:none;position:fixed;min-width:180px;max-height:320px;overflow:hidden;" +
  "border:1px solid rgba(71,85,105,0.4);border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,0.3);" +
  "z-index:10050;flex-direction:column;";

function _sednarGetModeIconHtml(modeValue, extraClass) {
  const paths = _SEDNAR_MODE_ICON_PATHS[modeValue] || _SEDNAR_MODE_ICON_PATHS.agent;
  const cls = "sednar-mode-icon-svg" + (extraClass ? " " + String(extraClass).trim() : "");
  const stroke = modeValue === "agent" ? "" : ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return '<svg class="' + cls + '" width="14" height="14" viewBox="0 0 24 24" fill="none"' + stroke + ' data-icon="mode-' + (modeValue || "agent") + '" aria-hidden="true">' + paths + '</svg>';
}

function _sednarFileIcon(name) {
  return typeof window.getFileIcon === "function" ? window.getFileIcon(name) : "/asset/material-icons/file.svg";
}
window.sednarFileIcon = _sednarFileIcon;

function _sednarFolderIcon(expanded, name) {
  if (typeof window.getFolderIcon === "function") return window.getFolderIcon(name || "", !!expanded);
  return expanded ? "/asset/material-icons/folder-open.svg" : "/asset/material-icons/folder.svg";
}

const _SEDNAR_ICON_SIZE_PX = { xs: 10, sm: 12, base: 14, lg: 16, xl: 20 };

const _SEDNAR_ICON_COLOR_VARS = {
  secondary: "var(--sednar-icon-secondary)", tertiary: "var(--sednar-icon-tertiary)",
  red: "var(--sednar-icon-red-primary)", green: "var(--sednar-icon-green-primary)",
};

const _SEDNAR_SVG_ICONS = {
  "arrow-up": '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>',
  "arrow-left": '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
  "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
  "at": '<circle cx="12" cy="12" r="4"></circle><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-5.5 8.28"></path>',
  "check": '<polyline points="20 6 9 17 4 12"></polyline>',
  "check-circle": '<circle cx="12" cy="12" r="9"></circle><polyline points="8.5 12.5 11 15 16 9"></polyline>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"></polyline>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"></polyline>',
  "chevron-up": '<polyline points="6 15 12 9 18 15"></polyline>',
  "clock": '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline>',
  "copy": '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  "ellipsis": '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>',
  "error": '<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="16.5" x2="12" y2="16.51"></line>',
  "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
  "folder": '<path d="M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  "folders": '<path d="M6 9V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1"></path><path d="M2 10a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"></path>',
  "history": '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline>',
  "image": '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
  "list-todo": '<path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
  "loading": '<circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M21 12a9 9 0 0 0-9-9"></path>',
  "mic": '<rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8" y1="21" x2="16" y2="21"></line>',
  "paperclip": '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
  "pencil": '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
  "plug": '<path d="M9 2v5M15 2v5"></path><path d="M6 7h12v4a6 6 0 0 1-12 0z"></path><path d="M12 17v5"></path>',
  "plus": '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
  "search": '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
  "sliders": '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>',
  "square": '<rect x="4" y="4" width="16" height="16" rx="2"></rect>',
  "stop": '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor"></rect>',
  "terminal": '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>',
  "trash": '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
  "x": '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  "arrows-cw": '<path d="M20 11a8 8 0 0 0-14.9-3.9L4 8.5"></path><path d="M4 4v4.5h4.5"></path><path d="M4 13a8 8 0 0 0 14.9 3.9l1.1-1.4"></path><path d="M20 20v-4.5h-4.5"></path>',
  "dots-3-vertical": '<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"></circle>',
  "arrows-expand": '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>',
  "arrows-contract": '<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line>',
  "layout-split-vertical": '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line>',
  "layout-panel-bottom": '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="15" x2="21" y2="15"></line>',
  "mobile": '<rect x="7" y="2" width="10" height="20" rx="2"></rect><line x1="11" y1="18" x2="13" y2="18"></line>',
  "ruler": '<path d="M3 16.5L7.5 21 21 7.5 16.5 3z"></path><line x1="7.5" y1="7.5" x2="10" y2="10"></line><line x1="11" y1="11" x2="13.5" y2="13.5"></line>',
  "layers": '<polygon points="12 2 22 8.5 12 15 2 8.5"></polygon><polyline points="2 15.5 12 22 22 15.5"></polyline>',
  "play": '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"></path>',
  "settings-gear": '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
};
_SEDNAR_SVG_ICONS["infinity"] = _SEDNAR_MODE_ICON_PATHS.agent;
_SEDNAR_SVG_ICONS["chat-bubble"] = _SEDNAR_MODE_ICON_PATHS.ask;

function _sednarIcon(name, opts) {
  const o = opts || {};
  const paths = _SEDNAR_SVG_ICONS[name] || _SEDNAR_SVG_ICONS["chevron-right"];
  const px = _SEDNAR_ICON_SIZE_PX[o.size] || _SEDNAR_ICON_SIZE_PX.sm;
  const cls = "ui-icon" + (o.spin ? " is-spinning" : "") + (o.className ? " " + o.className : "");
  const color = o.color && _SEDNAR_ICON_COLOR_VARS[o.color] ? ' style="color:' + _SEDNAR_ICON_COLOR_VARS[o.color] + '"' : "";
  return '<svg class="' + cls + '" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + color + ' data-icon="' + name + '" aria-hidden="true">' + paths + '</svg>';
}

function _sednarDotGridHtml(size) {
  let dots = "";
  for (let i = 0; i < 9; i++) {
    dots += '<circle data-dot-index="' + (i + 1) + '" cx="' + (1.25 + (i % 3) * 4) + '" cy="' + (1.25 + Math.floor(i / 3) * 4) + '" r="1.125"></circle>';
  }
  return '<span class="ui-dot-grid-loader" data-shape="sine_3x3" data-size="' + (size || "xs") + '" aria-hidden="true">' +
    '<svg viewBox="0 0 10.5 10.5" focusable="false" role="presentation">' + dots + "</svg></span>";
}

const SEDNAR_CHAT_TAB_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
const _SEDNAR_TAB_MESSAGE_ICON = SEDNAR_CHAT_TAB_ICON;
const _SEDNAR_TAB_SPINNER_ICON = _sednarDotGridHtml("xs");

function _sednarGetTabIconHtml(tab) {
  if (tab && tab.agentRunning) return _SEDNAR_TAB_SPINNER_ICON;
  return _SEDNAR_TAB_MESSAGE_ICON;
}

function _sednarClearTabUnread(tab) {
  if (tab) tab.hasUnread = false;
}

let sednarIndexReady = false;
let sednarIndexFileCount = 0;
let sednarIndexSymbolCount = 0;
let sednarIndexTruncated = false;
let sednarIndexDetails = null;
let sednarIndexFolders = [];

function _sednarApplyIndexResult(data) {
  sednarIndexReady = true;
  sednarIndexFileCount = data.file_count || 0;
  sednarIndexSymbolCount = data.symbol_count || 0;
  sednarIndexTruncated = !!data.truncated;
  sednarIndexDetails = data.details || null;
  sednarIndexFolders = Array.isArray(data.folders) ? data.folders : [];
  if (_sednarSettingsVisible("indexing")) _sednarRenderSettingsPage();
}

const SEDNAR_LAST_PROJECT_KEY = "sednar_last_project";

const SEDNAR_BROWSER_WORKSPACE_KEY = "sednar_browser_workspace";

const SEDNAR_RECENT_PROJECTS_KEY = "sednar_recent_projects";

const SEDNAR_TABS_STORAGE_PREFIX = "sednar_tabs_v1:";

const SEDNAR_CHAT_STORAGE_PREFIX = "sednar_chat_v1:";

const SEDNAR_EDITOR_TABS_STORAGE_PREFIX = "sednar_editor_tabs_v1:";

const SEDNAR_MCP_SELECTED_STORAGE_PREFIX = "sednar_mcp_selected_v2:";

let sednarWorkspaceRootOrder = [];

function _sednarStorageGet(key) {
  if (!key) return null;
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal != null) return fromLocal;
    return sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function _sednarStorageSet(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (e) {}
}

function _sednarStorageRemove(key) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {}
  try {
    sessionStorage.removeItem(key);
  } catch (e) {}
}

function _sednarTabHasConversation(tab) {
  return !!(tab && (tab.chatStarted || (tab.messagesHtml && String(tab.messagesHtml).trim())));
}

function _sednarResetTabToNewChat(tab) {
  if (!tab) return;
  const newId = _sednarNewChatSessionId();
  tab.sessionId = newId;
  tab.title = "New chat";
  tab.messagesHtml = "";
  tab.chatStarted = false;
  tab.hasUnread = false;
  tab.pendingQuestion = null;
  sednarAgentSessionId = newId;
  _sednarChatStarted = false;
  _sednarLoadChatTabState(tab);
  _sednarUpdateChatWelcome();
  _sednarRenderChatTabs();
}

function _sednarChatSnapshotKey(projectPath, sessionId, stateKey) {
  const project = stateKey || _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  const sid = String(sessionId || "").trim();
  if (!project || !sid) return "";
  return SEDNAR_CHAT_STORAGE_PREFIX + project + ":" + sid;
}

function _sednarPersistChatSnapshot(projectPath, tab, stateKey) {
  if (!tab || !projectPath || !tab.sessionId) return;
  if (_sednarIsActiveTab(tab) && !tab.agentRunning) {
    const out = getSednarChatOutput();
    if (out) {
      _sednarFinalizeDomForSnapshot(out);
      tab.messagesHtml = out.innerHTML;
    }
  }
  if (!tab.messagesHtml) return;

  if (tab.messagesHtml.indexOf("is-error") >= 0) {
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = tab.messagesHtml;
      _sednarStripErrorActivityRows(tmp);
      tab.messagesHtml = tmp.innerHTML;
    } catch (e) {}
  }

  _sednarSaveTranscript(projectPath, tab, stateKey);
  const key = _sednarChatSnapshotKey(projectPath, tab.sessionId, stateKey);
  if (!key) return;
  // A small local copy for an instant restore; the server's transcript is the one that counts, so a chat
  // too big for localStorage just skips this.
  if (tab.messagesHtml.length > SEDNAR_LOCAL_SNAPSHOT_MAX_CHARS) {
    _sednarStorageRemove(key);
    return;
  }
  try {
    _sednarStorageSet(key, JSON.stringify({
      messagesHtml: tab.messagesHtml,
      title: tab.title || "",
      chatStarted: !!tab.chatStarted,
      updatedAt: Date.now(),
    }));
  } catch (e) {}
}

const SEDNAR_LOCAL_SNAPSHOT_MAX_CHARS = 1500000;
const _sednarTranscriptTimers = {};

// The chat as rendered goes to the server (transcript.html), which is what reloading it shows. Only for the
// workspace that is open: the server would file it under whichever workspace the payload names.
function _sednarSaveTranscript(projectPath, tab, stateKey) {
  if (!tab || !tab.sessionId || !tab.messagesHtml || !sednarProjectPath) return;
  if (_sednarNormalizeProjectKey(projectPath) !== _sednarNormalizeProjectKey(sednarProjectPath)) return;
  if (stateKey && stateKey !== (_sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(sednarProjectPath))) return;
  const sessionId = tab.sessionId;
  const body = { project_path: sednarProjectPath, session_id: sessionId, html: tab.messagesHtml, workspace: _sednarCurrentWorkspacePayload() };
  if (_sednarTranscriptTimers[sessionId]) clearTimeout(_sednarTranscriptTimers[sessionId]);
  _sednarTranscriptTimers[sessionId] = setTimeout(function() {
    delete _sednarTranscriptTimers[sessionId];
    fetch("/sednar/session/transcript", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (data && data.success === false && data.reason === "too_large" && !tab._transcriptTooLargeWarned) {
          tab._transcriptTooLargeWarned = true;
          _sednarShowIdeToast("This chat is too long to save as shown (over 40 MB); its history is still kept.");
        }
      })
      .catch(function() {});
  }, 400);
}

const _SEDNAR_LEGACY_TRANSCRIPT_SELECTOR = [
  ".sednar-activity-line:not(.ui-tool-call-line):not(.ui-collapsible-header)",
  ".sednar-term-card:not(.ui-shell-tool-call)",
  ".sednar-diff-block:not(.ui-edit-tool-call)",
  ".sednar-agent-row:not([data-subagent-task-card])",
].join(", ");

function _sednarIsLegacyTranscriptHtml(html) {
  const text = String(html || "");
  if (!/sednar-(?:activity-line|term-card|diff-block|agent-row)/.test(text)) return false;
  try {
    const tpl = document.createElement("template");
    tpl.innerHTML = text;
    if (tpl.content.querySelector(_SEDNAR_LEGACY_TRANSCRIPT_SELECTOR)) return true;
    return Array.from(tpl.content.querySelectorAll(".sednar-term-card")).some(function(card) {
      return !card.querySelector(".ui-shell-tool-call__description-row");
    }) || Array.from(tpl.content.querySelectorAll(".sednar-diff-block")).some(function(block) {
      return !block.querySelector(".ui-tool-call-card__expand-button");
    });
  } catch (e) {
    return false;
  }
}

function _sednarLoadChatSnapshot(projectPath, sessionId) {
  const key = _sednarChatSnapshotKey(projectPath, sessionId);
  if (!key) return null;
  try {
    const raw = _sednarStorageGet(key);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (snap && _sednarIsLegacyTranscriptHtml(snap.messagesHtml)) {
      _sednarStorageRemove(key);
      return null;
    }
    return snap;
  } catch (e) {
    return null;
  }
}

function _sednarPersistTabsStorage(projectPath) {
  const project = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!project) return;
  try {
    _sednarStorageSet(SEDNAR_TABS_STORAGE_PREFIX + project, JSON.stringify({
      tabs: sednarChatTabs.map(_sednarSnapshotTab),
      activeTabId: sednarActiveChatTabId,
      tabCounter: sednarChatTabCounter,
    }));
  } catch (e) {}
}

function _sednarLoadTabsStorage(projectPath) {
  const project = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!project) return null;
  try {
    const raw = _sednarStorageGet(SEDNAR_TABS_STORAGE_PREFIX + project);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _sednarPersistEditorTabs(projectPath) {
  const project = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!project) return;
  const openPaths = Object.keys(ideOpenFiles);
  const key = SEDNAR_EDITOR_TABS_STORAGE_PREFIX + project;
  if (!openPaths.length) {
    _sednarStorageRemove(key);
    return;
  }
  try {
    _sednarStorageSet(key, JSON.stringify({
      openPaths: openPaths,
      activeFile: ideActiveFile && ideOpenFiles[ideActiveFile] ? ideActiveFile : openPaths[openPaths.length - 1],
    }));
  } catch (e) {}
}

let _sednarPersistEditorTabsTimer = null;
let _sednarEditorAutosaveBound = false;
let _sednarEditorAutosaveTimer = null;

function _sednarFlushPersistEditorTabs() {
  if (_sednarPersistEditorTabsTimer) {
    clearTimeout(_sednarPersistEditorTabsTimer);
    _sednarPersistEditorTabsTimer = null;
  }
  if (sednarProjectPath) _sednarPersistEditorTabs(sednarProjectPath);
}

function _sednarPersistEditorTabsDebounced(projectPath) {
  if (!projectPath) return;
  if (_sednarPersistEditorTabsTimer) clearTimeout(_sednarPersistEditorTabsTimer);
  _sednarPersistEditorTabsTimer = setTimeout(function() {
    _sednarPersistEditorTabsTimer = null;
    _sednarPersistEditorTabs(projectPath);
  }, 400);
}

function _sednarBindEditorAutosaveOnce() {
  if (_sednarEditorAutosaveBound || !window.ideEditor) return;
  _sednarEditorAutosaveBound = true;
  window.ideEditor.onDidChangeModelContent(function() {
    if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) return;
    const fileInfo = ideOpenFiles[ideActiveFile];
    if (fileInfo.isSettings) return;
    if (_sednarFileUsesPlanSurface(fileInfo) && fileInfo.viewMode === "markdown") return;
    const currentContent = window.ideEditor.getValue();
    const originalContent = fileInfo.originalContent || "";
    const isModified = currentContent !== originalContent;
    if (fileInfo.modified !== isModified) {
      fileInfo.modified = isModified;
      _sednarUpdateOpenFileTabBadge(ideActiveFile);
    }
    if (isModified) {
      clearTimeout(_sednarEditorAutosaveTimer);
      _sednarEditorAutosaveTimer = setTimeout(function() {
        autoSaveIDEFile(ideActiveFile);
      }, typeof window._sednarEditorAutosaveDelay === "function" ? window._sednarEditorAutosaveDelay() : 1e3);
    }
  });
}

function _sednarLoadEditorTabsStorage(projectPath) {
  const project = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!project) return null;
  try {
    const raw = _sednarStorageGet(SEDNAR_EDITOR_TABS_STORAGE_PREFIX + project);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.openPaths) || !parsed.openPaths.length) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function _sednarClearEditorFiles() {
  Object.keys(ideOpenFiles).forEach(function(filePath) {
    const info = ideOpenFiles[filePath];
    try { if (window.WBLsp) window.WBLsp.onFileClosed(filePath); } catch (e) {}
    if (info && info.model) {
      try {
        info.model.dispose();
      } catch (e) {}
    }
  });
  ideOpenFiles = {};
  ideActiveFile = null;
}

function _sednarRestoreEditorTabs(projectPath) {
  const saved = _sednarLoadEditorTabsStorage(projectPath);
  if (!saved || !saved.openPaths || !saved.openPaths.length) {
    showSednarEditorIdle();
    return;
  }
  const paths = saved.openPaths.filter(function(p) { return !!p; });
  if (!paths.length) {
    showSednarEditorIdle();
    return;
  }
  const active = saved.activeFile && paths.indexOf(saved.activeFile) !== -1
    ? saved.activeFile
    : paths[paths.length - 1];
  const backgroundPaths = paths.filter(function(p) { return p !== active; });

  function _sednarLoadEditorTabFile(filePath, onDone) {
    if (ideOpenFiles[filePath]) {
      onDone();
      return;
    }
    if (_sednarIsPlanTabKey(filePath)) {
      const planFile = filePath.slice(SEDNAR_PLAN_TAB_PREFIX.length);
      window.openSednarPlanTab(planFile, "", { activate: false }).then(onDone);
      return;
    }
    if (filePath === SEDNAR_SETTINGS_TAB_KEY) {
      ideOpenFiles[filePath] = { isSettings: true, path: filePath, name: "Settings", content: "", originalContent: "", modified: false };
      onDone();
      return;
    }
    if (filePath.indexOf("sednar://") === 0) {
      onDone();
      return;
    }
    _sednarIdeSocketRequest(
      "ide_read_file", { path: filePath },
      "ide_file_content",
      function(data) { return data && data.path === filePath; }
    ).then(function(result) {
      const data = result.data;
      if (!data.error) {
        const content = data.content || "";
        const fileName = filePath.split("/").pop();
        ideOpenFiles[filePath] = {
          content: content,
          path: filePath,
          name: fileName,
          modified: false,
          originalContent: content,
          readOnlyLarge: !!data.large_file,
        };
      } else if (result.error) {
        console.error("Sednar: failed to restore tab for", filePath, data.error);
      }
      onDone();
    });
  }

  _sednarLoadEditorTabFile(active, function() {
    if (ideOpenFiles[active]) {
      switchToFile(active);
    } else {
      const remaining = Object.keys(ideOpenFiles);
      if (remaining.length) switchToFile(remaining[remaining.length - 1]);
      else showSednarEditorIdle();
    }
    updateOpenFilesList(true);
    updatePlayButtonVisibility();
    _sednarPersistEditorTabsDebounced(projectPath);
    backgroundPaths.forEach(function(filePath) {
      _sednarLoadEditorTabFile(filePath, function() {});
    });
  });
}

function _sednarSaveProjectUiState() {
  if (!sednarProjectPath) return;
  _sednarSaveTabsForProject(sednarProjectPath);
  _sednarFlushPersistEditorTabs();
}

let _sednarProjectStateListenersBound = false;

function _sednarBindProjectStateListenersOnce() {
  if (_sednarProjectStateListenersBound) return;
  _sednarProjectStateListenersBound = true;
  window.addEventListener("pagehide", _sednarSaveProjectUiState);
  window.addEventListener("beforeunload", _sednarSaveProjectUiState);
}

function _sednarStripErrorActivityRows(root) {
  if (!root) return;
  root.querySelectorAll(".sednar-activity-line.is-error").forEach(function(line) {
    const outer = line.closest(".sednar-activity-wrap-outer") || line.closest(".sednar-activity-wrap");
    (outer || line).remove();
  });
  root.querySelectorAll(".chat-row.sednar-agent-steps-row").forEach(function(row) {
    const steps = row.querySelector(".sednar-agent-steps");
    if (steps && !steps.querySelector(".sednar-activity-wrap-outer, .sednar-activity-wrap")) {
      row.remove();
    }
  });
}

function _sednarPostProcessRestoredOutput(out) {
  _sednarSyncPlanCardButtons(out);
  if (!out) return;
  _sednarRegroupTranscript(out);
  if (out.querySelector(".sednar-agents-card")) _sednarBindAgentsCardOnce();
  _sednarScheduleStickyUserRows(out);
  _sednarStripErrorActivityRows(out);
  out.querySelectorAll(".sednar-term-card.is-fading-out").forEach(function(card) { card.classList.remove("is-fading-out"); });
  out.querySelectorAll(".sednar-term-card").forEach(_sednarTerminalSyncScroll);
  if (typeof window.rehydrateSednarChatMarkdown === "function") {
    window.rehydrateSednarChatMarkdown(out);
  }
  if (typeof decorateCodeBlocks === "function") {
    out.querySelectorAll(".sednar-code-card").forEach(function(card) {
      decorateCodeBlocks(card);
    });
  }
  if (typeof window._decorateChatLinksGlobal === "function") {
    out.querySelectorAll(".sednar-stream-msg, .chat-msg.assistant.sednar-plain-msg").forEach(function(el) {
      window._decorateChatLinksGlobal(el);
    });
  }
  out.querySelectorAll(".chat-msg.assistant").forEach(_sednarDecorateFileCodeSpans);
}

function _sednarApplySnapshotToTab(tab, sessionId, snap) {
  if (!tab || !snap || !snap.messagesHtml) return false;
  tab.sessionId = sessionId;
  tab.messagesHtml = snap.messagesHtml;
  tab.chatStarted = true;
  tab.title = _sednarTruncateTabTitle(snap.title || tab.title || "New chat");
  sednarAgentSessionId = sessionId;
  _sednarChatStarted = true;
  _sednarShowChatContainer();

  _sednarLoadChatTabState(tab);
  _sednarPostProcessRestoredOutput(getSednarChatOutput());
  _sednarRenderChatTabs();
  return true;
}

function _sednarClearChatSnapshot(projectPath, sessionId) {
  const key = _sednarChatSnapshotKey(projectPath, sessionId);
  if (!key) return;
  _sednarStorageRemove(key);
}

function _sednarResolveSessionTitle(session) {
  const sid = (session && session.session_id) || "";
  if (!sid) return "Chat";
  if (session.title) return session.title;
  if (sednarProjectPath) {
    const pending = _sednarGetPendingSessionTitles(sednarProjectPath);
    if (pending[sid]) return pending[sid];
  }
  const tab = sednarChatTabs.find(function(t) { return t.sessionId === sid; });
  if (tab && tab.title && tab.title !== "New chat" && tab.title !== "Loading…") {
    return tab.title;
  }
  return session.first_user_preview || sid || "Chat";
}

function _sednarUpsertPendingSession(sessionId, title) {
  if (!sessionId || !title || !sednarProjectPath) return;
  const pending = _sednarGetPendingSessionTitles(sednarProjectPath);
  pending[sessionId] = title;
  let found = false;
  let cached = _sednarGetCachedSessions(sednarProjectPath).slice();
  cached = cached.map(function(s) {
    if (s.session_id !== sessionId) return s;
    found = true;
    return Object.assign({}, s, { title: title });
  });
  if (!found) {
    cached.unshift({
      session_id: sessionId,
      title: title,
      updated_at: Date.now() / 1000,
    });
  }
  _sednarSetCachedSessions(sednarProjectPath, cached);
}

function _sednarPurgeDeletedSession(sessionId) {
  if (!sessionId || !sednarProjectPath) return;
  const pending = _sednarGetPendingSessionTitles(sednarProjectPath);
  delete pending[sessionId];
  _sednarClearChatSnapshot(sednarProjectPath, sessionId);
  _sednarSetCachedSessions(sednarProjectPath, _sednarGetCachedSessions(sednarProjectPath).filter(function(s) {
    return s.session_id !== sessionId;
  }));
  const tabsForSession = sednarChatTabs.filter(function(t) { return t.sessionId === sessionId; });
  tabsForSession.forEach(function(tab) {
    if (tab.agentRunning) return;
    if (sednarChatTabs.length <= 1) {
      _sednarResetTabToNewChat(tab);
    } else {
      _sednarCloseChatTab(tab.id);
    }
  });
}

function _sednarFormatSessionTime(ts) {
  const n = Number(ts);
  if (!n || Number.isNaN(n)) return "";
  try {
    const d = new Date(n * 1000);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

var _sednarCachedSessionsByProject = {};
var _sednarPendingSessionTitlesByProject = {};
var _sednarSessionFetchToken = 0;
var _sednarSessionMenuOpen = false;

function _sednarGetPendingSessionTitles(projectPath) {
  const key = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!key) return {};
  if (!_sednarPendingSessionTitlesByProject[key]) {
    _sednarPendingSessionTitlesByProject[key] = {};
  }
  return _sednarPendingSessionTitlesByProject[key];
}

function _sednarGetCachedSessions(projectPath) {
  const key = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!key) return [];
  return _sednarCachedSessionsByProject[key] || [];
}

function _sednarSetCachedSessions(projectPath, sessions) {
  const key = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!key) return;
  _sednarCachedSessionsByProject[key] = sessions;
}

function _sednarResetSessionMenuForProject(projectPath) {
  const key = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(projectPath);
  if (!key) return;
  delete _sednarCachedSessionsByProject[key];
  delete _sednarPendingSessionTitlesByProject[key];
}

function _sednarInvalidateSessionFetches() {
  _sednarSessionFetchToken++;
}
var _sednarSessionMenuPositionBound = false;

function _sednarEnsureSessionMenuPortal() {
  const menu = document.getElementById("sednar-chat-session-menu");
  if (menu && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
}

function _sednarPositionSessionMenu() {
  const menu = document.getElementById("sednar-chat-session-menu");
  const btn = document.getElementById("sednar-chat-session-history");
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const gap = 4;
  const viewportPad = 8;
  menu.style.top = Math.max(viewportPad, rect.bottom + gap) + "px";
  menu.style.right = Math.max(viewportPad, window.innerWidth - rect.right) + "px";
  menu.style.left = "auto";
  const maxH = Math.min(420, window.innerHeight - rect.bottom - gap - viewportPad);
  menu.style.maxHeight = Math.max(160, maxH) + "px";
}

function _sednarOnSessionMenuReposition() {
  if (!_sednarSessionMenuOpen) return;
  _sednarPositionSessionMenu();
}

function _sednarBindSessionMenuReposition() {
  if (_sednarSessionMenuPositionBound) return;
  _sednarSessionMenuPositionBound = true;
  window.addEventListener("resize", _sednarOnSessionMenuReposition, true);
  document.addEventListener("scroll", _sednarOnSessionMenuReposition, true);
}

function _sednarUnbindSessionMenuReposition() {
  if (!_sednarSessionMenuPositionBound) return;
  _sednarSessionMenuPositionBound = false;
  window.removeEventListener("resize", _sednarOnSessionMenuReposition, true);
  document.removeEventListener("scroll", _sednarOnSessionMenuReposition, true);
}

const _SEDNAR_SESSION_CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 11 14 15 10"></polyline></svg>';
const _SEDNAR_SESSION_RUNNING_ICON = _sednarDotGridHtml("xs");

const SEDNAR_SESSIONS_FETCH_TIMEOUT_MS = 20000;

function _sednarMarkSessionsFetchFailed(list) {
  const result = list || [];
  result._sednarFetchFailed = true;
  return result;
}

function _sednarFetchSessions(projectPath) {
  if (!projectPath) return Promise.resolve([]);
  const hasAbort = typeof AbortController !== "undefined";
  const controller = hasAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(function() { controller.abort(); }, SEDNAR_SESSIONS_FETCH_TIMEOUT_MS) : null;
  const fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: projectPath,
      limit: 30,
      workspace: _sednarCurrentWorkspacePayload(),
    }),
  };
  if (controller) fetchOptions.signal = controller.signal;
  return fetch(
    "/sednar/sessions",
    fetchOptions
  )
    .then(function(r) {
      if (timeoutId) clearTimeout(timeoutId);
      return r.json().then(function(data) {
        if (!r.ok || !data || !data.success) {
          console.error("Sednar: failed to load sessions for", projectPath, (data && data.error) || r.status);
          return _sednarMarkSessionsFetchFailed([]);
        }
        return data.sessions || [];
      });
    })
    .catch(function(err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.error("Sednar: failed to load sessions for", projectPath, err);
      return _sednarMarkSessionsFetchFailed([]);
    });
}

function _sednarGroupSessionsByDate(sessions) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = { today: [], yesterday: [], older: [] };
  (sessions || []).forEach(function(s) {
    const ts = Number(s.updated_at);
    if (!ts || Number.isNaN(ts)) {
      groups.older.push(s);
      return;
    }
    const d = new Date(ts * 1000);
    if (d.toDateString() === today.toDateString()) groups.today.push(s);
    else if (d.toDateString() === yesterday.toDateString()) groups.yesterday.push(s);
    else groups.older.push(s);
  });
  return groups;
}

function _sednarUnbindSessionItemMenuReposition(menu) {
  if (!menu || !menu._sednarRepositionHandler) return;
  window.removeEventListener("resize", menu._sednarRepositionHandler, true);
  document.removeEventListener("scroll", menu._sednarRepositionHandler, true);
  menu._sednarRepositionHandler = null;
}

function _sednarPositionSessionItemMenu(menu, anchor) {
  if (!menu || !anchor) return;
  const gap = 4;
  const viewportPad = 8;
  const rect = anchor.getBoundingClientRect();
  menu.style.display = "flex";
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + gap;
  let left = rect.right - menuRect.width;
  if (top + menuRect.height > window.innerHeight - viewportPad) {
    top = rect.top - menuRect.height - gap;
  }
  left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuRect.width - viewportPad));
  top = Math.max(viewportPad, Math.min(top, window.innerHeight - menuRect.height - viewportPad));
  menu.style.top = top + "px";
  menu.style.left = left + "px";
}

function _sednarBindSessionItemMenuReposition(menu, anchor) {
  _sednarUnbindSessionItemMenuReposition(menu);
  const handler = function() {
    if (!menu.isConnected) {
      _sednarUnbindSessionItemMenuReposition(menu);
      return;
    }
    _sednarPositionSessionItemMenu(menu, anchor);
  };
  menu._sednarRepositionHandler = handler;
  window.addEventListener("resize", handler, true);
  document.addEventListener("scroll", handler, true);
}

function _sednarCloseSessionItemMenus() {
  document.querySelectorAll(".sednar-chat-session-item-menu").forEach(function(menu) {
    _sednarUnbindSessionItemMenuReposition(menu);
  });
  if (typeof window.closeChatMenus === "function") {
    window.closeChatMenus();
  }
}

const _SEDNAR_SESSION_MENU_ICONS = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M12 13v4M10 15h4"></path></svg>',
  duplicate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>',
  markdown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M6 15V9l3 3 3-3v6M17 9v6M15 13l2 2 2-2"></path></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"></path></svg>',
};

function _sednarBuildSessionMoreMenu(sessionId, currentTitle) {
  const menu = document.createElement("div");
  menu.className = "chat-history-menu sednar-chat-session-item-menu";
  menu.setAttribute("role", "menu");
  const items = [
    { icon: "open", label: "Open in new tab", run: function() { window.openSednarSessionInNewTab(sessionId); } },
    { icon: "duplicate", label: "Duplicate", run: function() { window.duplicateSednarSession(sessionId, currentTitle); } },
    { icon: "markdown", label: "Copy as Markdown", run: function() { window.copySednarSessionMarkdown(sessionId); } },
    null,
    { icon: "rename", label: "Rename", run: function(ev) { window.renameSednarSession(sessionId, currentTitle, ev); } },
    { icon: "delete", label: "Delete", danger: true, run: function(ev) { window.deleteSednarSession(sessionId, ev); } },
  ];
  items.forEach(function(item) {
    if (!item) {
      const sep = document.createElement("div");
      sep.className = "chat-history-menu-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-history-menu-item" + (item.danger ? " danger" : "");
    btn.setAttribute("role", "menuitem");
    btn.innerHTML = _SEDNAR_SESSION_MENU_ICONS[item.icon] + "<span>" + _sednarEscapeHtml(item.label) + "</span>";
    btn.onclick = function(ev) {
      ev.stopPropagation();
      _sednarCloseSessionItemMenus();
      item.run(ev);
    };
    menu.appendChild(btn);
  });
  return menu;
}

// Opens a saved chat in a tab of its own (or switches to the tab it is already in).
window.openSednarSessionInNewTab = function(sessionId) {
  if (!sessionId || !sednarProjectPath) return;
  closeSednarSessionMenu();
  const open = sednarChatTabs.find(function(t) { return t.sessionId === sessionId; });
  if (open) {
    _sednarSwitchChatTab(open.id);
    return;
  }
  _sednarSaveActiveChatTabState();
  _sednarCreateChatTab("Loading…", { activate: true });
  const tab = _sednarGetActiveChatTab();
  if (tab) _sednarFetchSessionIntoTab(tab, sessionId, {});
};

// A copy of the chat, history and all, to take in another direction; it opens in a new tab.
window.duplicateSednarSession = function(sessionId, currentTitle) {
  if (!sessionId || !sednarProjectPath) return;
  if (sednarChatTabs.some(function(t) { return t.sessionId === sessionId && t.agentRunning; })) {
    _sednarShowIdeToast("Wait for this chat's agent to finish before duplicating it.");
    return;
  }
  const newId = _sednarNewChatSessionId();
  fetch("/sednar/session/fork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: sednarProjectPath,
      session_id: sessionId,
      new_session_id: newId,
      title: "Copy of " + (currentTitle || "chat"),
      workspace: _sednarCurrentWorkspacePayload(),
    }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.success) {
      _sednarShowIdeToast("Couldn't duplicate the chat: " + ((data && data.error) || "unknown error"));
      return;
    }
    renderSednarSessionDropdown();
    window.openSednarSessionInNewTab(newId);
  }).catch(function(err) {
    _sednarShowIdeToast("Couldn't duplicate the chat: " + (err.message || err));
  });
};

window.copySednarSessionMarkdown = function(sessionId) {
  if (!sessionId || !sednarProjectPath) return;
  fetch("/sednar/session/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: sednarProjectPath, session_id: sessionId, workspace: _sednarCurrentWorkspacePayload() }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.success || !String(data.markdown || "").trim()) {
      _sednarShowIdeToast("Nothing to copy from this chat yet.");
      return;
    }
    _sednarCopyToClipboard(data.markdown, "Copied the chat as Markdown");
  }).catch(function(err) {
    _sednarShowIdeToast("Couldn't copy the chat: " + (err.message || err));
  });
};

function _sednarCreateSessionMenuRow(session) {
  const sid = session.session_id || "";
  const titleText = _sednarResolveSessionTitle(session);
  const isActive = sid === sednarAgentSessionId;
  const isRunning = sednarChatTabs.some(function(t) {
    return t.sessionId === sid && t.agentRunning;
  });
  const hasUnread = !isRunning && sednarChatTabs.some(function(t) {
    return t.sessionId === sid && t.hasUnread;
  });

  const row = document.createElement("div");
  row.className = "sednar-chat-session-menu-item-row theme-transition" + (hasUnread ? " has-unread" : "");
  row.dataset.sessionId = sid;

  const itemBtn = document.createElement("button");
  itemBtn.type = "button";
  itemBtn.className = "sednar-chat-session-menu-item theme-transition" +
    (isActive ? " is-active" : "") +
    (isRunning ? " is-running" : "");
  const iconSpan = document.createElement("span");
  iconSpan.className = "sednar-chat-session-menu-item-icon";
  iconSpan.innerHTML = isRunning ? _SEDNAR_SESSION_RUNNING_ICON : _SEDNAR_SESSION_CHECK_ICON;
  const titleSpan = document.createElement("span");
  titleSpan.className = "sednar-chat-session-menu-item-title";
  titleSpan.textContent = titleText;
  itemBtn.appendChild(iconSpan);
  itemBtn.appendChild(titleSpan);
  itemBtn.onclick = function(e) {
    if (e.target.closest(".chat-history-menu") || e.target.closest(".sednar-chat-session-menu-item-more")) {
      return;
    }
    _sednarCloseSessionItemMenus();
    window.resumeSednarSession(sid);
    closeSednarSessionMenu();
  };

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sednar-chat-session-menu-item-more chat-history-item-more";
  moreBtn.title = "More";
  moreBtn.setAttribute("aria-label", "More options");
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>';
  moreBtn.onclick = function(e) {
    e.stopPropagation();
    const existing = document.querySelector(".sednar-chat-session-item-menu.is-portaled");
    _sednarCloseSessionItemMenus();
    if (existing) return;
    const menu = _sednarBuildSessionMoreMenu(sid, titleText);
    menu.classList.add("is-portaled");
    document.body.appendChild(menu);
    moreBtn.setAttribute("aria-expanded", "true");
    _sednarPositionSessionItemMenu(menu, moreBtn);
    _sednarBindSessionItemMenuReposition(menu, moreBtn);
  };

  row.appendChild(itemBtn);
  row.appendChild(moreBtn);
  return row;
}

function _sednarPopulateSessionMenuList(list, sessions, fetchFailed, projectPath) {
  list.innerHTML = "";
  if (projectPath) {
    const name = projectPath.split("/").filter(Boolean).pop() || projectPath;
    const header = document.createElement("div");
    header.className = "sednar-chat-session-menu-section-label";
    header.textContent = name;
    header.title = projectPath;
    list.appendChild(header);
  }
  if (!sessions || !sessions.length) {
    if (fetchFailed) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sednar-chat-session-menu-empty sednar-chat-session-menu-retry";
      retry.style.cssText = "width:100%;background:transparent;border:none;color:inherit;cursor:pointer;text-align:left;";
      retry.textContent = "Failed to load sessions — click to retry";
      retry.onclick = function() { renderSednarSessionDropdown(); };
      list.appendChild(retry);
    } else {
      const empty = document.createElement("div");
      empty.className = "sednar-chat-session-menu-empty";
      empty.textContent = "No saved sessions";
      list.appendChild(empty);
    }
    return;
  }
  const groups = _sednarGroupSessionsByDate(sessions);
  const sections = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "older", label: "Older" },
  ];
  sections.forEach(function(sec) {
    const items = groups[sec.key] || [];
    if (!items.length) return;
    const label = document.createElement("div");
    label.className = "sednar-chat-session-menu-section-label";
    label.textContent = sec.label;
    list.appendChild(label);
    items.forEach(function(s) {
      list.appendChild(_sednarCreateSessionMenuRow(s));
    });
  });
}

function renderSednarSessionDropdown() {
  const list = document.getElementById("sednar-chat-session-menu-list");
  if (!list) return;
  const projectPath = sednarProjectPath;
  if (!projectPath) {
    list.innerHTML = '<div class="sednar-chat-session-menu-empty">Open a project to view sessions</div>';
    return;
  }
  const fetchToken = ++_sednarSessionFetchToken;
  list.innerHTML = '<div class="sednar-chat-session-menu-empty">Loading sessions…</div>';
  _sednarFetchSessions(projectPath).then(function(sessions) {
    if (fetchToken !== _sednarSessionFetchToken) return;
    if (_sednarNormalizeProjectKey(projectPath) !== _sednarNormalizeProjectKey(sednarProjectPath)) return;
    const fetchFailed = !!sessions._sednarFetchFailed;
    const merged = _sednarMergeSessionSources(sessions, projectPath);
    _sednarSetCachedSessions(projectPath, merged);
    _sednarPopulateSessionMenuList(list, merged, fetchFailed, projectPath);
    if (_sednarSessionMenuOpen) _sednarPositionSessionMenu();
  });
}

function _sednarMergeSessionSources(serverSessions, projectPath) {
  const byId = {};
  (serverSessions || []).forEach(function(s) {
    if (s && s.session_id) byId[s.session_id] = s;
  });
  const pendingTitles = _sednarGetPendingSessionTitles(projectPath);
  Object.keys(pendingTitles).forEach(function(sid) {
    const pendingTitle = pendingTitles[sid];
    if (!byId[sid]) {
      byId[sid] = { session_id: sid, title: pendingTitle, updated_at: Date.now() / 1000 };
    } else if (!byId[sid].title && pendingTitle) {
      byId[sid].title = pendingTitle;
    }
  });
  sednarChatTabs.forEach(function(tab) {
    if (!tab.sessionId || !tab.title || tab.title === "New chat" || tab.title === "Loading…") return;
    if (!byId[tab.sessionId]) {
      byId[tab.sessionId] = {
        session_id: tab.sessionId,
        title: tab.title,
        updated_at: Date.now() / 1000,
      };
    }
  });
  return Object.keys(byId).map(function(sid) { return byId[sid]; })
    .sort(function(a, b) { return Number(b.updated_at || 0) - Number(a.updated_at || 0); });
}

window.getSednarKnownSessions = function() {
  const projectPath = sednarProjectPath;
  if (!projectPath) return Promise.resolve([]);
  return _sednarFetchSessions(projectPath).then(function(sessions) {
    const base = sessions && sessions._sednarFetchFailed
      ? _sednarGetCachedSessions(projectPath)
      : sessions;
    const merged = _sednarMergeSessionSources(base, projectPath);
    _sednarSetCachedSessions(projectPath, merged);
    return merged;
  }).catch(function() {
    return _sednarMergeSessionSources(_sednarGetCachedSessions(projectPath), projectPath);
  });
};

window.renameSednarSession = function(sessionId, currentTitle, event) {
  if (event) event.stopPropagation();
  if (!sessionId || !sednarProjectPath || typeof window.showRenameModal !== "function") return false;
  window.showRenameModal(currentTitle || "Chat", function(newTitle) {
    const title = (newTitle || "").trim();
    if (!title) return;
    fetch("/sednar/session/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: sednarProjectPath,
        session_id: sessionId,
        title: title,
        workspace: _sednarCurrentWorkspacePayload(),
      }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (!data || !data.success) return;
      const tab = sednarChatTabs.find(function(t) { return t.sessionId === sessionId; });
      if (tab) {
        tab.title = title;
        _sednarRenderChatTabs();
      }
      renderSednarSessionDropdown();
    }).catch(function(err) {
      console.error("Sednar rename session failed:", err);
    });
  });
  return false;
};

function _sednarResetSessionIfDeleted(sessionId) {
  _sednarPurgeDeletedSession(sessionId);
}

window.deleteSednarSession = function(sessionId, event) {
  if (event) event.stopPropagation();
  if (!sessionId || !sednarProjectPath) return false;
  const runningTab = sednarChatTabs.find(function(t) {
    return t.sessionId === sessionId && t.agentRunning;
  });
  if (runningTab) {
    if (typeof _sednarShowIdeToast === "function") {
      _sednarShowIdeToast("Can't delete a chat while its agent is running.");
    }
    return false;
  }
  const projectPath = sednarProjectPath;
  _sednarPurgeDeletedSession(sessionId);
  _sednarSaveTabsForProject(projectPath);
  renderSednarSessionDropdown();
  fetch("/sednar/session/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: projectPath,
      session_id: sessionId,
      workspace: _sednarCurrentWorkspacePayload(),
    }),
  }).then(function(r) {
    return r.json().catch(function() { return null; });
  }).then(function(data) {
    if (!data || !data.success) {
      console.error("Sednar delete session failed:", (data && data.error) || "unknown error");
    }
  }).catch(function(err) {
    console.error("Sednar delete session failed:", err);
  }).then(function() {
    if (_sednarNormalizeProjectKey(projectPath) === _sednarNormalizeProjectKey(sednarProjectPath)) {
      renderSednarSessionDropdown();
    }
  });
  return false;
};

window.closeSednarSessionMenu = function() {
  const menu = document.getElementById("sednar-chat-session-menu");
  const btn = document.getElementById("sednar-chat-session-history");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
  _sednarSessionMenuOpen = false;
  _sednarUnbindSessionMenuReposition();
  _sednarCloseSessionItemMenus();
};

window.toggleSednarSessionMenu = function() {
  const menu = document.getElementById("sednar-chat-session-menu");
  const btn = document.getElementById("sednar-chat-session-history");
  if (!menu || !btn) return;
  if (_sednarSessionMenuOpen) {
    closeSednarSessionMenu();
    return;
  }
  if (typeof closeSednarProjectMenu === "function") closeSednarProjectMenu();
  _sednarEnsureSessionMenuPortal();
  _sednarSessionMenuOpen = true;
  _sednarPositionSessionMenu();
  menu.style.display = "flex";
  btn.setAttribute("aria-expanded", "true");
  renderSednarSessionDropdown();
  _sednarBindSessionMenuReposition();
};

var _sednarProjectMenuOpen = false;
var _sednarProjectMenuPositionBound = false;

function _sednarEnsureProjectMenuPortal() {
  const menu = document.getElementById("sednar-project-menu");
  if (menu && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
}

function _sednarPositionProjectMenu() {
  const menu = document.getElementById("sednar-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const gap = 4;
  const viewportPad = 8;
  menu.style.top = Math.max(viewportPad, rect.bottom + gap) + "px";
  const menuWidth = menu.offsetWidth || 320;
  const left = Math.min(
    Math.max(viewportPad, rect.left),
    window.innerWidth - menuWidth - viewportPad
  );
  menu.style.left = Math.max(viewportPad, left) + "px";
  menu.style.right = "auto";
  const maxH = Math.min(420, window.innerHeight - rect.bottom - gap - viewportPad);
  menu.style.maxHeight = Math.max(160, maxH) + "px";
}

function _sednarOnProjectMenuReposition() {
  if (!_sednarProjectMenuOpen) return;
  _sednarPositionProjectMenu();
}

function _sednarBindProjectMenuReposition() {
  if (_sednarProjectMenuPositionBound) return;
  _sednarProjectMenuPositionBound = true;
  window.addEventListener("resize", _sednarOnProjectMenuReposition, true);
  document.addEventListener("scroll", _sednarOnProjectMenuReposition, true);
}

function _sednarUnbindProjectMenuReposition() {
  if (!_sednarProjectMenuPositionBound) return;
  _sednarProjectMenuPositionBound = false;
  window.removeEventListener("resize", _sednarOnProjectMenuReposition, true);
  document.removeEventListener("scroll", _sednarOnProjectMenuReposition, true);
}

function renderSednarProjectDropdown() {
  const list = document.getElementById("sednar-project-menu-list");
  if (!list) return;
  _sednarCloseSessionItemMenus();
  list.innerHTML = "";
  const projects = getSednarRecentProjects();
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "sednar-chat-session-menu-empty";
    empty.textContent = "No recent projects";
    list.appendChild(empty);
  } else {
    const label = document.createElement("div");
    label.className = "sednar-chat-session-menu-section-label";
    label.textContent = "Recent";
    list.appendChild(label);
    projects.forEach(function(path) {
      list.appendChild(_sednarCreateProjectMenuRow(path));
    });
  }
  const sep = document.createElement("div");
  sep.className = "sednar-project-menu-sep";
  list.appendChild(sep);
  const openRow = document.createElement("div");
  openRow.className = "sednar-chat-session-menu-item-row theme-transition";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "sednar-chat-session-menu-item theme-transition";
  openBtn.onclick = function() {
    window.openSednarFolderFromMenu();
  };
  const openTitle = document.createElement("span");
  openTitle.className = "sednar-chat-session-menu-item-title";
  openTitle.textContent = "Open Folder…";
  openBtn.appendChild(openTitle);
  openRow.appendChild(openBtn);
  list.appendChild(openRow);
  [
    ["Add Folder to Workspace…", window.addSednarFolderToWorkspaceFromMenu],
    ["Manage Workspace…", window.openSednarWorkspaceManager],
    ["Open Workspace File…", window.openSednarWorkspaceFileFromMenu],
    ["Save Workspace As…", window.saveSednarWorkspaceAsFromMenu]
  ].forEach(function(action) {
    const row = document.createElement("div");
    row.className = "sednar-chat-session-menu-item-row theme-transition";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sednar-chat-session-menu-item theme-transition";
    btn.onclick = function() {
      if (typeof action[1] === "function") action[1]();
    };
    const title = document.createElement("span");
    title.className = "sednar-chat-session-menu-item-title";
    title.textContent = action[0];
    btn.appendChild(title);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function _sednarBuildProjectMoreMenu(path) {
  const menu = document.createElement("div");
  menu.className = "chat-history-menu sednar-chat-session-item-menu";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "chat-history-menu-item danger";
  removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9,3H7c0-1.7,1.3-3,3-3v2C9.4,2,9,2.4,9,3z"/><path d="M17,3h-2c0-0.6-0.4-1-1-1V0C15.7,0,17,1.3,17,3z"/><polygon points="17,6 7,6 7,3 9,3 9,4 15,4 15,3 17,3"/><rect x="10" width="4" height="2"/><path d="M21,6H3C2.4,6,2,5.6,2,5s0.4-1,1-1h18c0.6,0,1,0.4,1,1S21.6,6,21,6z"/><path d="M19,24H5c-0.6,0-1-0.4-1-1V9c0-0.6,0.4-1,1-1h14c0.6,0,1,0.4,1,1v14C20,23.6,19.6,24,19,24z M6,22h12V10H6V22z"/><path d="M10,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C11,19.6,10.6,20,10,20z"/><path d="M14,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C15,19.6,14.6,20,14,20z"/></svg>Remove from recents';
  removeBtn.onclick = function(ev) {
    ev.stopPropagation();
    _sednarCloseSessionItemMenus();
    removeSednarRecentProject(path);
  };
  menu.appendChild(removeBtn);
  return menu;
}

function _sednarCreateProjectMenuRow(path) {
  const name = path.split("/").filter(Boolean).pop() || path;
  const isActive = path === sednarProjectPath;

  const row = document.createElement("div");
  row.className = "sednar-chat-session-menu-item-row theme-transition";
  row.dataset.projectPath = path;

  const itemBtn = document.createElement("button");
  itemBtn.type = "button";
  itemBtn.className = "sednar-chat-session-menu-item theme-transition" + (isActive ? " is-active" : "");
  const titleSpan = document.createElement("span");
  titleSpan.className = "sednar-chat-session-menu-item-title";
  titleSpan.title = path;
  titleSpan.textContent = name;
  itemBtn.appendChild(titleSpan);
  itemBtn.onclick = function(e) {
    if (e.target.closest(".chat-history-menu") || e.target.closest(".sednar-chat-session-menu-item-more")) {
      return;
    }
    _sednarCloseSessionItemMenus();
    window.selectSednarProjectFromMenu(path);
  };

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sednar-chat-session-menu-item-more chat-history-item-more";
  moreBtn.title = "More";
  moreBtn.setAttribute("aria-label", "More options");
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>';
  moreBtn.onclick = function(e) {
    e.stopPropagation();
    const existing = document.querySelector(".sednar-chat-session-item-menu.is-portaled");
    _sednarCloseSessionItemMenus();
    if (existing) return;
    const menu = _sednarBuildProjectMoreMenu(path);
    menu.classList.add("is-portaled");
    document.body.appendChild(menu);
    _sednarPositionSessionItemMenu(menu, moreBtn);
    _sednarBindSessionItemMenuReposition(menu, moreBtn);
  };

  row.appendChild(itemBtn);
  row.appendChild(moreBtn);
  return row;
}

window.selectSednarProjectFromMenu = function(path) {
  closeSednarProjectMenu();
  if (!path) return;
  _sednarOpenProjectOrWorkspace(path);
  showIDEPanel("explorer");
};

window.openSednarFolderFromMenu = function() {
  closeSednarProjectMenu();
  openSednarProjectBrowser();
};

function _sednarFolderNameFromPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path || "workspace");
}

function _sednarWorkspaceRefForMcp() {
  return sednarWorkspacePath || sednarProjectPath;
}

function _sednarStableStringHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function _sednarMcpWorkspaceIdentity() {
  const identityKey = _sednarWorkspaceIdentityKey();
  return identityKey ? "browser:" + identityKey : "";
}

function _sednarMcpSelectionStorageKey() {
  const key = _sednarMcpWorkspaceIdentity();
  return key ? SEDNAR_MCP_SELECTED_STORAGE_PREFIX + key : "";
}

function _sednarLoadMcpSelection() {
  const next = new Set();
  const key = _sednarMcpSelectionStorageKey();
  if (key) {
    try {
      const parsed = JSON.parse(_sednarStorageGet(key) || "[]");
      if (Array.isArray(parsed)) {
        parsed.forEach(function(name) {
          const value = String(name || "").trim();
          if (value) next.add(value);
        });
      }
    } catch (e) {}
  }
  sednarMcpSelectedServers = next;
  _sednarUpdateMcpToggle();
}

function _sednarPersistMcpSelection() {
  const key = _sednarMcpSelectionStorageKey();
  if (!key) return;
  _sednarStorageSet(key, JSON.stringify(Array.from(sednarMcpSelectedServers).sort()));
}

function _sednarIsWorkspaceFilePath(path) {
  const value = String(path || "").trim().toLowerCase();
  return value.endsWith(".sednar-workspace.json") || value.endsWith(".sednar-workspace") || value.endsWith(".code-workspace");
}

function _sednarIsSednarWorkspaceFilePath(path) {
  const value = String(path || "").trim().toLowerCase();
  return value.endsWith(".sednar-workspace.json") || value.endsWith(".sednar-workspace");
}

var _sednarWorkspaceAutoSaveTimer = null;
function _sednarScheduleWorkspaceFileAutoSave() {
  if (!sednarWorkspacePath || !_sednarIsSednarWorkspaceFilePath(sednarWorkspacePath)) return;
  if (_sednarWorkspaceAutoSaveTimer) clearTimeout(_sednarWorkspaceAutoSaveTimer);
  const targetPath = sednarWorkspacePath;
  _sednarWorkspaceAutoSaveTimer = setTimeout(function() {
    _sednarWorkspaceAutoSaveTimer = null;
    _sednarSaveWorkspaceFile(targetPath, { silent: true }).catch(function() {});
  }, 600);
}

function _sednarOpenProjectOrWorkspace(path, options) {
  if (!path) return;
  const opts = options || {};
  if (_sednarIsWorkspaceFilePath(path)) {
    _sednarLoadWorkspaceFile(path, opts).catch(function(err) {
      _sednarShowIdeToast("Couldn't open workspace: " + (err && err.message ? err.message : String(err)));
      renderSednarExplorerEmpty();
      updateSednarExplorerHeader();
      updateOpenFilesList();
    });
    return;
  }
  setSednarProject(path);
}

function _sednarNormalizeWorkspacePath(path) {
  let value = String(path || "").trim().replace(/\\+/g, "/");
  const unc = value.startsWith("//");
  value = value.replace(/\/+/g, "/");
  if (unc && !value.startsWith("//")) value = "/" + value;
  if (value.length > 1 && value !== "//") value = value.replace(/\/+$/, "");
  return value;
}

function _sednarWorkspaceNameKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function _sednarUniqueWorkspaceName(baseName, usedNames) {
  const base = String(baseName || "workspace").trim() || "workspace";
  let name = base;
  let index = 2;
  while (usedNames.has(_sednarWorkspaceNameKey(name))) {
    name = base + "-" + index;
    index += 1;
  }
  usedNames.add(_sednarWorkspaceNameKey(name));
  return name;
}

function _sednarNormalizeWorkspaceFolders(folders) {
  const usedPaths = new Set();
  const usedNames = new Set();
  const out = [];
  (Array.isArray(folders) ? folders : []).forEach(function(folder) {
    if (!folder) return;
    const path = _sednarNormalizeWorkspacePath(folder.path || folder);
    if (!path || _sednarIsWorkspaceFilePath(path)) return;
    const pathKey = _sednarNormalizeProjectKey(path);
    if (usedPaths.has(pathKey)) return;
    usedPaths.add(pathKey);
    const rawName = String(folder.name || "").trim();
    const safeName = rawName && rawName !== "." && rawName !== ".." && !/[\\/]/.test(rawName)
      ? rawName
      : _sednarFolderNameFromPath(path);
    out.push({ name: _sednarUniqueWorkspaceName(safeName, usedNames), path: path });
  });
  return out;
}

function _sednarCurrentWorkspacePayload() {
  const folders = _sednarNormalizeWorkspaceFolders(sednarWorkspaceFolders.length
    ? sednarWorkspaceFolders
    : (sednarProjectPath ? [{ name: _sednarFolderNameFromPath(sednarProjectPath), path: sednarProjectPath }] : []));
  return {
    path: sednarWorkspacePath || "",
    folders: folders,
    settings: sednarWorkspaceSettings || {},
    mcpServers: sednarWorkspaceMcpServers || {}
  };
}
window._sednarCurrentWorkspacePayload = _sednarCurrentWorkspacePayload;
function _sednarWorkspaceStateKey() {
  const payload = _sednarCurrentWorkspacePayload();
  const primary = (payload.folders || [])[0];
  return primary ? _sednarNormalizeProjectKey(primary.path) : "";
}
window._sednarWorkspaceStateKey = _sednarWorkspaceStateKey;
function _sednarWorkspaceIdentityKey() {
  const payload = _sednarCurrentWorkspacePayload();
  const paths = (payload.folders || []).map(function(folder) {
    return _sednarNormalizeProjectKey(folder.path);
  }).filter(Boolean).sort();
  if (!paths.length) return "";
  if (paths.length === 1) return paths[0];
  return "workspace:" + _sednarStableStringHash(JSON.stringify(paths));
}
window._sednarWorkspaceIdentityKey = _sednarWorkspaceIdentityKey;

function _sednarPersistBrowserWorkspace() {
  const payload = _sednarCurrentWorkspacePayload();
  if (!payload.folders.length) {
    try { localStorage.removeItem(SEDNAR_BROWSER_WORKSPACE_KEY); } catch (e) {}
    return;
  }
  try { localStorage.setItem(SEDNAR_BROWSER_WORKSPACE_KEY, JSON.stringify(payload)); } catch (e) {}
}

function _sednarLoadBrowserWorkspace() {
  let raw = "";
  try { raw = localStorage.getItem(SEDNAR_BROWSER_WORKSPACE_KEY) || ""; } catch (e) {}
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (payload && Array.isArray(payload.folders) && payload.folders.length) {
      payload.folders = _sednarNormalizeWorkspaceFolders(payload.folders);
      return payload.folders.length ? payload : null;
    }
  } catch (e) {}
  return null;
}

function _sednarApplyWorkspaceFolderOrder(folders, message) {
  sednarWorkspaceFolders = folders.map(function(folder) {
    return { name: folder.name || _sednarFolderNameFromPath(folder.path), path: folder.path };
  }).filter(function(folder) { return !!folder.path; });
  _sednarPersistBrowserWorkspace();
  const primary = sednarWorkspaceFolders.length ? sednarWorkspaceFolders[0].path : "";
  const primaryChanged = _sednarNormalizeProjectKey(primary) !== _sednarNormalizeProjectKey(sednarProjectPath);
  if (primary && primaryChanged) {
    sednarApplyingWorkspace = true;
    try {
      setSednarProject(primary);
    } finally {
      sednarApplyingWorkspace = false;
    }
  } else {
    ideHomePath = primary || ideHomePath;
    ideFileTreeData = {};
    ideExpandedFolders.clear();
    _sednarLoadWorkspaceFolderTrees();
    _sednarMcpStatusLoadedWithoutProbe = false;
    refreshSednarMcpStatus({ probeServers: [], hydrateSelected: true });
    renderSednarRecentSessions();
    if (primary) _sednarWarmWorkspaceIndex(primary);
  }
  _sednarScheduleWorkspaceFileAutoSave();
  if (_sednarProjectMenuOpen) renderSednarProjectDropdown();
  _sednarRenderWorkspaceManager();
  _sednarSyncActiveProjectTab();
  if (message) _sednarShowIdeToast(message);
}

function _sednarSetWorkspaceFromPayload(workspace) {
  if (!workspace || !Array.isArray(workspace.folders) || !workspace.folders.length) return false;
  sednarWorkspacePath = workspace.path || null;
  sednarWorkspaceFolders = _sednarNormalizeWorkspaceFolders(workspace.folders);
  sednarWorkspaceSettings = workspace.settings || {};
  sednarWorkspaceMcpServers = workspace.mcpServers || {};
  if (!sednarWorkspaceFolders.length) return false;
  _sednarPersistBrowserWorkspace();
  sednarApplyingWorkspace = true;
  try {
    setSednarProject(sednarWorkspaceFolders[0].path);
  } finally {
    sednarApplyingWorkspace = false;
  }
  return true;
}

async function _sednarLoadWorkspaceFile(path, options) {
  const opts = options || {};
  const resp = await fetch("/sednar/workspace/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: path, allow_partial: !!opts.allowPartial })
  });
  const payload = await resp.json();
  if (resp.status === 409 && payload.code === "workspace_folders_missing" && !opts.allowPartial) {
    const missing = Array.isArray(payload.missing) ? payload.missing : [];
    const names = missing.map(function(f) { return f.name || f.path; }).join(", ");
    const remaining = typeof payload.remaining === "number" ? payload.remaining : 0;
    if (!remaining) throw new Error(payload.error || "Workspace has no valid folders");
    const ok = await _sednarModalConfirm({
      title: "Folders missing",
      message: `${missing.length} folder(s) in this workspace could not be found (${names}). Open the remaining ${remaining} folder(s)?`,
      confirmText: "Open remaining folders",
    });
    if (!ok) throw new Error("Workspace open cancelled");
    return _sednarLoadWorkspaceFile(path, Object.assign({}, opts, { allowPartial: true }));
  }
  if (!resp.ok || !payload.workspace) throw new Error(payload.error || "Unable to open workspace file");
  if (!_sednarSetWorkspaceFromPayload(payload.workspace)) throw new Error("Workspace has no folders");
  saveSednarRecentProject(payload.workspace.path || path);
  renderSednarRecentProjects();
  if (_sednarProjectMenuOpen) renderSednarProjectDropdown();
  if (!opts.silent) _sednarShowIdeToast("Workspace opened");
}

async function _sednarSaveWorkspaceFile(path, options) {
  const opts = options || {};
  const folders = _sednarNormalizeWorkspaceFolders(sednarWorkspaceFolders.length
    ? sednarWorkspaceFolders
    : (sednarProjectPath ? [{ name: _sednarFolderNameFromPath(sednarProjectPath), path: sednarProjectPath }] : []));
  if (!folders.length) {
    if (!opts.silent) _sednarShowIdeToast("Open a folder before saving a workspace.");
    return;
  }
  const resp = await fetch("/sednar/workspace/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: path,
      folders: folders,
      settings: sednarWorkspaceSettings || {},
      mcpServers: sednarWorkspaceMcpServers || {}
    })
  });
  const payload = await resp.json();
  if (!resp.ok || !payload.workspace) throw new Error(payload.error || "Unable to save workspace");
  if (!opts.silent) {
    _sednarSetWorkspaceFromPayload(payload.workspace);
  } else {
    sednarWorkspacePath = payload.workspace.path || sednarWorkspacePath;
  }
  saveSednarRecentProject(payload.workspace.path || path);
  renderSednarRecentProjects();
  if (_sednarProjectMenuOpen) renderSednarProjectDropdown();
  if (!opts.silent) _sednarShowIdeToast("Workspace saved");
}

window.addSednarFolderToWorkspaceFromMenu = function() {
  closeSednarProjectMenu();
  openSednarFolderBrowser(function(path) {
    const normalizedPath = _sednarNormalizeWorkspacePath(path);
    const existingKeys = new Set(sednarWorkspaceFolders.map(function(folder) { return _sednarNormalizeProjectKey(folder.path); }));
    const exists = existingKeys.has(_sednarNormalizeProjectKey(normalizedPath));
    if (exists) {
      _sednarShowIdeToast("Folder already in workspace");
      return;
    }
    const next = sednarWorkspaceFolders.concat([{ name: _sednarFolderNameFromPath(normalizedPath), path: normalizedPath }]);
    _sednarApplyWorkspaceFolderOrder(next, "Folder added to workspace");
  }, sednarProjectPath || "~");
};

function _sednarEnsureWorkspaceManager() {
  let dialog = document.getElementById("sednar-workspace-manager");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "sednar-workspace-manager";
  dialog.className = "sednar-workspace-manager theme-transition";
  dialog.style.display = "none";
  dialog.innerHTML = '<div class="sednar-workspace-manager-modal theme-transition" role="dialog" aria-modal="true" aria-labelledby="sednar-workspace-manager-title"><div class="sednar-workspace-manager-header"><div><div id="sednar-workspace-manager-title" class="sednar-workspace-manager-title">Workspace folders</div><div id="sednar-workspace-manager-subtitle" class="sednar-workspace-manager-subtitle"></div></div><button type="button" class="sednar-workspace-manager-close theme-transition" onclick="closeSednarWorkspaceManager(); return false;" aria-label="Close workspace manager">Close</button></div><div id="sednar-workspace-manager-list" class="sednar-workspace-manager-list"></div><div class="sednar-workspace-manager-footer"><button type="button" class="sednar-workspace-manager-action theme-transition" onclick="addSednarFolderToWorkspaceFromManager(); return false;">Add Folder</button><button type="button" class="sednar-workspace-manager-action theme-transition" onclick="saveSednarWorkspaceAsFromManager(); return false;">Save Workspace As</button></div></div>';
  document.body.appendChild(dialog);
  dialog.addEventListener("click", function(e) {
    if (e.target === dialog) closeSednarWorkspaceManager();
    e.stopPropagation();
  });
  return dialog;
}

function _sednarWorkspaceFoldersForManager() {
  if (sednarWorkspaceFolders.length) return sednarWorkspaceFolders.slice();
  return sednarProjectPath ? [{ name: _sednarFolderNameFromPath(sednarProjectPath), path: sednarProjectPath }] : [];
}

function _sednarWorkspaceFolderIndexByPath(path) {
  const key = _sednarNormalizeProjectKey(path);
  return _sednarWorkspaceFoldersForManager().findIndex(function(folder) {
    return _sednarNormalizeProjectKey(folder.path) === key;
  });
}

function _sednarMakeWorkspaceFolderPrimary(path) {
  const next = _sednarWorkspaceFoldersForManager();
  const index = _sednarWorkspaceFolderIndexByPath(path);
  if (index <= 0) return;
  const item = next.splice(index, 1)[0];
  if (item) next.unshift(item);
  _sednarApplyWorkspaceFolderOrder(next, "Primary workspace folder changed");
}

function _sednarWorkspaceFolderOrderChanged(current, next) {
  if (current.length !== next.length) return true;
  return current.some(function(folder, index) {
    return _sednarNormalizeProjectKey(folder.path) !== _sednarNormalizeProjectKey(next[index] && next[index].path);
  });
}

function _sednarWorkspacePrimaryChanged(current, next) {
  const currentPrimary = current.length ? current[0].path : "";
  const nextPrimary = next.length ? next[0].path : "";
  return _sednarNormalizeProjectKey(currentPrimary) !== _sednarNormalizeProjectKey(nextPrimary);
}

function _sednarWorkspaceFolderLabel(folder) {
  return folder ? (folder.name || _sednarFolderNameFromPath(folder.path)) : "";
}

function _sednarMoveWorkspaceFolderToIndex(path, targetIndex) {
  const current = _sednarWorkspaceFoldersForManager();
  const index = _sednarWorkspaceFolderIndexByPath(path);
  if (index < 0 || targetIndex < 0 || targetIndex > current.length) return Promise.resolve(false);
  let insertionIndex = targetIndex;
  if (index < insertionIndex) insertionIndex -= 1;
  const next = current.slice();
  const item = next.splice(index, 1)[0];
  insertionIndex = Math.max(0, Math.min(next.length, insertionIndex));
  next.splice(insertionIndex, 0, item);
  if (!_sednarWorkspaceFolderOrderChanged(current, next)) return Promise.resolve(false);
  const primaryChanged = _sednarWorkspacePrimaryChanged(current, next);
  const title = primaryChanged ? "Change primary workspace folder?" : "Reorder workspace folders?";
  const nextPrimary = _sednarWorkspaceFolderLabel(next[0]);
  const message = primaryChanged
    ? nextPrimary + " will become the primary folder for MCP priority and workspace-relative actions."
    : "Apply this workspace folder order?";
  return _sednarModalConfirm({ title: title, message: message, confirmText: "Apply order" }).then(function(ok) {
    if (!ok) return false;
    _sednarApplyWorkspaceFolderOrder(next, primaryChanged ? "Primary workspace folder changed" : "Workspace folders reordered");
    return true;
  });
}

function _sednarRemoveWorkspaceFolder(path) {
  const next = _sednarWorkspaceFoldersForManager();
  const index = _sednarWorkspaceFolderIndexByPath(path);
  if (index < 0 || next.length <= 1) return;
  next.splice(index, 1);
  _sednarApplyWorkspaceFolderOrder(next, "Folder removed from workspace");
}

function _sednarRenderWorkspaceManager() {
  const dialog = document.getElementById("sednar-workspace-manager");
  if (!dialog || dialog.style.display === "none") return;
  const folders = _sednarWorkspaceFoldersForManager();
  const subtitle = dialog.querySelector("#sednar-workspace-manager-subtitle");
  const list = dialog.querySelector("#sednar-workspace-manager-list");
  if (subtitle) subtitle.textContent = folders.length ? folders.length + " folder" + (folders.length === 1 ? "" : "s") + " in this workspace" : "Open or add folders to build a workspace";
  if (!list) return;
  if (!folders.length) {
    list.innerHTML = '<div class="sednar-workspace-manager-empty">No workspace folders yet.</div>';
    return;
  }
  list.innerHTML = folders.map(function(folder, index) {
    const name = _sednarEscapeHtml(folder.name || _sednarFolderNameFromPath(folder.path));
    const path = _sednarEscapeHtml(folder.path || "");
    const primary = index === 0 ? '<span class="sednar-workspace-primary-badge">Primary</span>' : '';
    return '<div class="sednar-workspace-folder-row theme-transition" draggable="true" data-sednar-workspace-row="' + index + '"><div class="sednar-workspace-folder-drag" aria-hidden="true"></div><div class="sednar-workspace-folder-main"><div class="sednar-workspace-folder-name">' + name + '</div><div class="sednar-workspace-folder-path">' + path + '</div></div><div class="sednar-workspace-folder-actions">' + primary + '<button type="button" class="sednar-workspace-folder-btn is-danger theme-transition" data-sednar-workspace-remove="' + index + '" ' + (folders.length === 1 ? 'disabled' : '') + '>Remove</button></div></div>';
  }).join("");
  _sednarBindWorkspaceManagerDrag(list);
  list.querySelectorAll("[data-sednar-workspace-remove]").forEach(function(button) {
    button.addEventListener("click", function() {
      const index = Number(button.getAttribute("data-sednar-workspace-remove"));
      const target = _sednarWorkspaceFoldersForManager()[index];
      if (target) _sednarRemoveWorkspaceFolder(target.path);
    });
  });
}

window.openSednarWorkspaceManager = function() {
  closeSednarProjectMenu();
  const dialog = _sednarEnsureWorkspaceManager();
  _sednarRenderWorkspaceManager();
  dialog.style.display = "flex";
  _sednarRenderWorkspaceManager();
};

window.closeSednarWorkspaceManager = function() {
  const dialog = document.getElementById("sednar-workspace-manager");
  if (dialog) dialog.style.display = "none";
};

window.addSednarFolderToWorkspaceFromManager = function() {
  closeSednarWorkspaceManager();
  window.addSednarFolderToWorkspaceFromMenu();
};

window.saveSednarWorkspaceAsFromManager = function() {
  closeSednarWorkspaceManager();
  window.saveSednarWorkspaceAsFromMenu();
};

window.openSednarWorkspaceFileFromMenu = function() {
  closeSednarProjectMenu();
  openSednarFileBrowser(function(path) {
    _sednarLoadWorkspaceFile(path).catch(function(err) {
      _sednarShowIdeToast("Couldn't open workspace: " + (err && err.message ? err.message : String(err)));
    });
  }, sednarProjectPath || "~", [".sednar-workspace.json", ".sednar-workspace", ".code-workspace"]);
};

window.saveSednarWorkspaceAsFromMenu = function() {
  closeSednarProjectMenu();
  const initial = sednarWorkspacePath || ((sednarProjectPath || "~/workspace") + ".sednar-workspace.json");
  _sednarModalPrompt({
    title: "Save workspace as",
    message: "Enter a path for the Sednar workspace file.",
    value: initial,
    placeholder: "~/my-project.sednar-workspace.json",
    confirmText: "Save",
    wide: true
  }).then(function(path) {
    if (!path) return;
    _sednarSaveWorkspaceFile(path).catch(function(err) {
      _sednarShowIdeToast("Couldn't save workspace: " + (err && err.message ? err.message : String(err)));
    });
  });
};

window.closeSednarProjectMenu = function() {
  const menu = document.getElementById("sednar-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (menu) menu.style.display = "none";
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  }
  _sednarProjectMenuOpen = false;
  _sednarUnbindProjectMenuReposition();
  _sednarCloseSessionItemMenus();
};

window.toggleSednarProjectMenu = function() {
  const menu = document.getElementById("sednar-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (!menu || !btn) return;
  if (_sednarProjectMenuOpen) {
    closeSednarProjectMenu();
    return;
  }
  if (typeof closeSednarSessionMenu === "function") closeSednarSessionMenu();
  _sednarEnsureProjectMenuPortal();
  _sednarProjectMenuOpen = true;
  menu.style.display = "flex";
  _sednarPositionProjectMenu();
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("active");
  btn.setAttribute("aria-pressed", "true");
  renderSednarProjectDropdown();
  _sednarBindProjectMenuReposition();
};

function _sednarRefreshSessionMenuIfOpen() {
  if (!_sednarSessionMenuOpen) return;
  renderSednarSessionDropdown();
  _sednarPositionSessionMenu();
}

function renderSednarRecentSessions() {
  _sednarRefreshSessionMenuIfOpen();
}

// A chat from before Sednar kept the rendered transcript: its history is still there for the agent, but
// there is nothing to show.
function _sednarNoTranscriptHtml() {
  return '<div class="chat-row sednar-status-row sednar-no-transcript"><div class="chat-msg assistant sednar-plain-msg">' +
    "This chat was saved before Sednar kept chats as they were shown, so its messages can’t be displayed. " +
    "The agent still has its history: carry on here and it picks up where you left off.</div></div>";
}

function _sednarTranscriptFirstUser(out) {
  const first = out && out.querySelector(".chat-row.sednar-user-row .chat-msg.user");
  return first ? String(first.innerText || first.textContent || "").trim().split("\n")[0].slice(0, 120) : "";
}

async function _sednarFetchSessionIntoTab(tab, sessionId, options) {
  options = options || {};
  if (!tab || !sessionId || !sednarProjectPath) return;
  _sednarClearTabUnread(tab);
  tab.sessionId = sessionId;
  if (_sednarIsActiveTab(tab)) {
    sednarAgentSessionId = sessionId;
  }

  if (!options.forceServer && tab.agentRunning && tab.messagesHtml && tab.chatStarted) {
    _sednarChatStarted = true;
    _sednarShowChatContainer();
    _sednarLoadChatTabState(tab);
    _sednarPostProcessRestoredOutput(getSednarChatOutput());
    _sednarRenderChatTabs();
    toggleSednarAgentPane(true);
    return;
  }

  if (!options.forceServer && tab.agentRunning) {
    const snap = _sednarLoadChatSnapshot(sednarProjectPath, sessionId);
    if (_sednarApplySnapshotToTab(tab, sessionId, snap)) {
      toggleSednarAgentPane(true);
      return;
    }
  }

  if (!options.forceServer && !tab.agentRunning) {
    if (!(tab.messagesHtml && String(tab.messagesHtml).trim())) {
      const saved = _sednarLoadChatSnapshot(sednarProjectPath, sessionId);
      if (saved && saved.messagesHtml) {
        tab.messagesHtml = saved.messagesHtml;
        if (saved.title) tab.title = _sednarTruncateTabTitle(saved.title);
      }
    }
    if (tab.messagesHtml && String(tab.messagesHtml).trim()) {
      tab.chatStarted = true;
      if (_sednarIsActiveTab(tab) && !options.silent) {
        _sednarChatStarted = true;
        _sednarShowChatContainer();
        _sednarLoadChatTabState(tab);
        toggleSednarAgentPane(true);
      }
      _sednarRenderChatTabs();
      return;
    }
  }

  const silent = !!options.silent;
  const hadCachedContent = !!(tab.messagesHtml && String(tab.messagesHtml).trim());
  const wasActiveAtStart = _sednarIsActiveTab(tab);

  if (!silent) {
    tab.title = "Loading…";
    if (wasActiveAtStart) {
      _sednarLoadChatTabState(tab);
      toggleSednarAgentPane(true);
      _sednarShowChatContainer();
      const liveOut = getSednarChatOutput();
      _sednarMarkChatOutputForTab(liveOut, tab);
      if (liveOut) {
        if (hadCachedContent) {
          liveOut.innerHTML = tab.messagesHtml;
          _sednarPostProcessRestoredOutput(liveOut);
        } else {
          liveOut.innerHTML = '<div class="chat-row"><div class="chat-msg assistant sednar-plain-msg" style="opacity:0.7;font-size:13px;">Loading session…</div></div>';
        }
      }
    }
    _sednarRenderChatTabs();
  }
  try {
    const resp = await fetch("/sednar/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: sednarProjectPath,
        session_id: sessionId,
        workspace: _sednarCurrentWorkspacePayload(),
      }),
    });
    const data = await resp.json();
    const transcript = data && data.success ? String(data.transcript_html || "") : "";
    const messageCount = data && data.success ? Number(data.message_count) || 0 : 0;
    if (!transcript.trim() && !messageCount) {

      if (silent) return;
      if (_sednarIsActiveTab(tab)) {
        _sednarResetTabToNewChat(tab);
      } else {
        tab.title = "New chat";
        tab.messagesHtml = "";
        tab.chatStarted = false;
        tab.sessionId = _sednarNewChatSessionId();
        tab.hasUnread = false;
        _sednarRenderChatTabs();
      }
      return;
    }
    const isStillActive = _sednarIsActiveTab(tab);

    const renderOut = (isStillActive && !silent) ? getSednarChatOutput() : document.createElement("div");
    if (!renderOut) return;
    _sednarResetTurnState();
    renderOut.innerHTML = transcript.trim() ? transcript : _sednarNoTranscriptHtml();
    _sednarSyncTurnPointersFromDom();
    const rendered = { firstUser: _sednarTranscriptFirstUser(renderOut) };
    _sednarStripStaleWelcome(renderOut);
    _sednarSanitizeLoadedActivityHtml(renderOut);
    _sednarPostProcessRestoredOutput(renderOut);
    const newHtml = renderOut.innerHTML;
    const changed = newHtml !== tab.messagesHtml;
    tab.messagesHtml = newHtml;
    tab.chatStarted = true;
    tab.restoredFromServer = true;
    if (isStillActive) {
      sednarAgentSessionId = tab.sessionId;
      _sednarChatStarted = true;
      _sednarShowChatContainer();
      if (silent && changed) {
        const liveOut = getSednarChatOutput();
        if (liveOut) {
          liveOut.innerHTML = newHtml;
          _sednarPostProcessRestoredOutput(liveOut);
        }
      }
    }
    tab.title = _sednarTruncateTabTitle(
      (data.summary && data.summary.title) || rendered.firstUser || "Chat"
    );
    _sednarPersistChatSnapshot(sednarProjectPath, tab);
    if (!silent) _sednarRenderChatTabs();
    renderSednarRecentSessions();
    if (isStillActive && !silent) renderOut.scrollTop = renderOut.scrollHeight;
  } catch (e) {
    if (silent) {
      console.error("Sednar: background session refresh failed", e);
      return;
    }
    if (_sednarIsActiveTab(tab)) {
      _sednarResetTabToNewChat(tab);
    }
  }
}

window.resumeSednarSession = async function(sessionId) {
  if (!sessionId || !sednarProjectPath) return;
  closeSednarSessionMenu();
  let tab = sednarChatTabs.find(function(t) { return t.sessionId === sessionId; });
  if (tab) {
    if (!_sednarIsActiveTab(tab)) {
      _sednarSwitchChatTab(tab.id);
    } else {
      _sednarClearTabUnread(tab);
    }
  } else {
    _sednarSaveActiveChatTabState();
    let activeTab = _sednarGetActiveChatTab();
    if (!activeTab) {
      _sednarInitChatTabs();
      activeTab = _sednarGetActiveChatTab();
    }
    if (activeTab && activeTab.chatStarted) {
      _sednarCreateChatTab("Loading…", { activate: true });
      tab = _sednarGetActiveChatTab();
    } else {
      tab = activeTab;
    }
  }
  if (!tab) return;
  await _sednarFetchSessionIntoTab(tab, sessionId, {});
};

const SEDNAR_PROJECT_TAB = "__sednar_project__";

window.inferLangFromPath = function(path) {
  const p = (path || "").toLowerCase();
  if (p.endsWith(".py") || p.endsWith(".pyi")) return "python";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".tsx")) return "typescriptreact";
  if (p.endsWith(".jsx")) return "javascriptreact";
  if (p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".mts") || p.endsWith(".cts")) return "typescript";
  if (p.endsWith(".js")) return "javascript";
  if (p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".go")) return "golang";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".xml")) return "xml";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".sql")) return "sql";
  if (p.endsWith(".sh") || p.endsWith(".bash")) return "sh";
  if (p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".yml")) return "yml";
  if (p.endsWith(".toml")) return "toml";
  if (p.endsWith(".ini")) return "ini";
  if (p.endsWith(".properties")) return "ini";
  if (p.endsWith(".txt")) return "text";
  const name = p.split(/[\\/]/).pop() || "";
  if (_SEDNAR_FILENAME_LANGS[name]) return _SEDNAR_FILENAME_LANGS[name];
  if (/^dockerfile(\..*)?$/.test(name) || name.endsWith(".dockerfile")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && _SEDNAR_EXT_LANGS[name.slice(dot + 1)]) return _SEDNAR_EXT_LANGS[name.slice(dot + 1)];
  return "text";
};

// Extensions and file names beyond the ones above, mapped straight to Monaco language ids.
const _SEDNAR_EXT_LANGS = {
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala", groovy: "java", gradle: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  cs: "csharp", csx: "csharp", fs: "fsharp", fsi: "fsharp", fsx: "fsharp", vb: "vb",
  rs: "rust", swift: "swift", m: "objective-c", mm: "objective-c", dart: "dart",
  rb: "ruby", rake: "ruby", gemspec: "ruby", php: "php", phtml: "php", pl: "perl", pm: "perl",
  lua: "lua", r: "r", jl: "julia", ex: "elixir", exs: "elixir", clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  coffee: "coffeescript", ps1: "powershell", psm1: "powershell", psd1: "powershell", bat: "bat", cmd: "bat",
  zsh: "shell", fish: "shell", ksh: "shell", env: "ini", cfg: "ini", conf: "ini", editorconfig: "ini", gitconfig: "ini",
  scss: "scss", sass: "scss", less: "less", vue: "html", svelte: "html", astro: "html", xhtml: "html",
  hbs: "handlebars", handlebars: "handlebars", mustache: "handlebars", pug: "pug", jade: "pug", twig: "twig", liquid: "liquid",
  svg: "xml", xsd: "xml", xsl: "xml", plist: "xml", csproj: "xml", fsproj: "xml", vbproj: "xml", props: "xml", targets: "xml", resx: "xml",
  jsonc: "json", json5: "json", geojson: "json", webmanifest: "json", ipynb: "json", har: "json",
  graphql: "graphql", gql: "graphql", proto: "proto", tf: "hcl", tfvars: "hcl", hcl: "hcl", bicep: "bicep",
  sol: "solidity", cairo: "cairo", mdx: "mdx", markdown: "markdown", rst: "restructuredtext", tex: "plaintext",
  pas: "pascal", pp: "pascal", dpr: "pascal", ml: "fsharp", mli: "fsharp", erl: "plaintext", hs: "plaintext",
  sv: "systemverilog", svh: "systemverilog", v: "verilog", vh: "verilog", tcl: "tcl", st: "st", abap: "abap",
  apex: "apex", cls: "apex", trigger: "apex", azcli: "azcli", cypher: "cypher", flow: "flow9", lex: "lexon",
  m3: "m3", pq: "powerquery", pqm: "powerquery", qs: "qsharp", rq: "sparql", sparql: "sparql", redis: "redis",
  pgsql: "pgsql", mysql: "mysql", sb: "sb", scm: "scheme", ss: "scheme", rkt: "scheme", wgsl: "wgsl",
  dockerignore: "ignore", gitignore: "plaintext", log: "plaintext", csv: "plaintext", tsv: "plaintext",
};
const _SEDNAR_FILENAME_LANGS = {
  makefile: "shell", gnumakefile: "shell", "cmakelists.txt": "plaintext", gemfile: "ruby", rakefile: "ruby",
  podfile: "ruby", vagrantfile: "ruby", brewfile: "ruby", jenkinsfile: "java", procfile: "shell",
  ".bashrc": "shell", ".zshrc": "shell", ".profile": "shell", ".bash_profile": "shell", ".env": "ini",
  ".npmrc": "ini", ".gitconfig": "ini", ".editorconfig": "ini", "go.mod": "go", "go.sum": "plaintext",
  "cargo.lock": "ini", "poetry.lock": "ini", "pipfile": "ini", "pom.xml": "xml",
};

window.mapToMonacoLang = function(lang) {
  const langMap = {
    python: "python",
    html: "html",
    javascript: "javascript",
    typescript: "typescript",
    typescriptreact: "typescript",
    javascriptreact: "javascript",
    json: "json",
    golang: "go",
    markdown: "markdown",
    text: "plaintext",
    xml: "xml",
    css: "css",
    sql: "sql",
    sh: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini"
  };
  if (langMap[lang]) return langMap[lang];
  // inferLangFromPath also returns Monaco ids directly (java, rust, cpp, …).
  try {
    if (window.monaco && monaco.languages.getLanguages().some(function(l) { return l.id === lang; })) return lang;
  } catch (e) {}
  return lang && lang !== "text" && Object.values(_SEDNAR_EXT_LANGS).indexOf(lang) !== -1 ? lang : "plaintext";
};

let _sednarMonacoThemes = null;
let _sednarLastMonacoTheme = null;
fetch("/sednar/assets/monaco-themes.json")
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(themes) {
    if (!themes) return;
    _sednarMonacoThemes = themes;
    if (_sednarLastMonacoTheme && window.monaco) window.applyIDEDynamicTheme(_sednarLastMonacoTheme);
  })
  .catch(function() {});

const _SEDNAR_THEME_ICONS =
  '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"></path></svg>';

const _SEDNAR_THEMES = [
  { id: "dark", label: "Dark", swatch: "#1e293b" },
  { id: "white", label: "Light", swatch: "#f1f5f9" },
  { id: "black", label: "Black", swatch: "#0a0a0a" },
  { id: "pink", label: "Pink", swatch: "#fbcfe8" },
];

function _sednarCurrentThemeId() {
  const match = _SEDNAR_THEMES.filter(function(t) { return document.body.classList.contains(t.id + "-theme"); })[0];
  return match ? match.id : "dark";
}

// The theme is a body class ("dark-theme", "white-theme", "black-theme", "pink-theme").
window.setSednarTheme = function(theme) {
  const next = _SEDNAR_THEMES.some(function(t) { return t.id === theme; }) ? theme : "dark";
  _SEDNAR_THEMES.forEach(function(t) { document.body.classList.remove(t.id + "-theme"); });
  document.body.classList.add(next + "-theme");
  try { localStorage.setItem("sednar-theme", next); } catch (e) {}
  if (typeof window.applyIDEDynamicTheme === "function") window.applyIDEDynamicTheme(next);
  _sednarApplyTerminalTheme();  // open terminals keep the colours they were created with otherwise
  _sednarSyncThemeButton();
};

function _sednarSyncThemeButton() {
  const btn = document.getElementById("sednar-theme-toggle");
  if (!btn) return;
  const current = _sednarCurrentThemeId();
  const idx = _SEDNAR_THEMES.findIndex(function(t) { return t.id === current; });
  const cur = _SEDNAR_THEMES[idx < 0 ? 0 : idx];
  const next = _SEDNAR_THEMES[(idx + 1) % _SEDNAR_THEMES.length];
  btn.title = "Theme: " + cur.label + " (click for " + next.label + ")";
  btn.setAttribute("aria-label", btn.title);
}

// One button cycles Dark -> Light -> Black -> Pink.
window.toggleSednarTheme = function() {
  const current = _sednarCurrentThemeId();
  const idx = _SEDNAR_THEMES.findIndex(function(t) { return t.id === current; });
  window.setSednarTheme(_SEDNAR_THEMES[(idx + 1) % _SEDNAR_THEMES.length].id);
};

window.applyIDEDynamicTheme = function(themeName) {
  _sednarLastMonacoTheme = themeName;
  if (!window.monaco) return;
  const sednarTheme = _sednarMonacoThemes && (_sednarMonacoThemes[themeName] || _sednarMonacoThemes.black);
  if (sednarTheme) {
    monaco.editor.defineTheme("sednar-dynamic-theme", sednarTheme);
    monaco.editor.setTheme("sednar-dynamic-theme");
    return "sednar-dynamic-theme";
  }
  const isPink = themeName === "pink";
  const isDark = themeName === "dark";
  const isBlack = themeName === "black";
  const bg = isPink ? "#fdf2f8" : isBlack ? "#1a1a1a" : isDark ? "#1e293b" : themeName === "white" ? "#f1f5f9" : "#ffffff";
  const fg = isPink ? "#831843" : isBlack ? "#d4d4d4" : isDark ? "#e2e8f0" : "#1e293b";
  const themeId = "sednar-dynamic-theme";
  monaco.editor.defineTheme(themeId, {
    base: isDark || isBlack ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorGutter.background": bg,
      "editorLineNumber.foreground": isPink ? "#be185d" : isBlack ? "#737373" : isDark ? "#94a3b8" : "#64748b",
      "editorLineNumber.activeForeground": isPink ? "#831843" : isBlack || isDark ? "#ffffff" : "#111827",
      "editor.lineHighlightBackground": bg,
      "editor.selectionBackground": isPink ? "#fbcfe8" : isBlack ? "#1f2937" : isDark ? "#334155" : "#cfe8ff",
      "editorIndentGuide.background": isPink ? "#f9a8d4" : isBlack ? "#1a1a1a" : isDark ? "#334155" : "#e5e7eb",
      "editorIndentGuide.activeBackground": isPink ? "#ec4899" : isBlack ? "#404040" : isDark ? "#64748b" : "#9ca3af",
      "editorSuggestWidget.background": isPink ? "#fdf2f8" : isBlack ? "#1a1a1a" : isDark ? "#1e293b" : "#ffffff",
      "editorSuggestWidget.border": isPink ? "#f9a8d4" : isBlack ? "#333333" : isDark ? "#334155" : "#e2e8f0",
      "editorSuggestWidget.foreground": fg,
      "editorSuggestWidget.selectedBackground": isPink ? "#fbcfe8" : isBlack ? "#2a2a2a" : isDark ? "#334155" : "#eff6ff",
      "editorSuggestWidget.selectedForeground": fg,
      "editorSuggestWidget.highlightForeground": isPink ? "#be185d" : isBlack || isDark ? "#93c5fd" : "#2563eb",
      "editorSuggestWidget.focusHighlightForeground": isPink ? "#be185d" : isBlack || isDark ? "#93c5fd" : "#2563eb",
      "editorHoverWidget.background": isPink ? "#fdf2f8" : isBlack ? "#1a1a1a" : isDark ? "#1e293b" : "#ffffff",
      "editorHoverWidget.border": isPink ? "#f9a8d4" : isBlack ? "#333333" : isDark ? "#334155" : "#e2e8f0",
      "list.activeSelectionBackground": isPink ? "#fbcfe8" : isBlack ? "#2a2a2a" : isDark ? "#334155" : "#eff6ff",
      "list.activeSelectionForeground": fg,
      "list.inactiveSelectionBackground": isPink ? "#fbcfe8" : isBlack ? "#2a2a2a" : isDark ? "#334155" : "#eff6ff",
      "list.inactiveSelectionForeground": fg,
      "list.focusBackground": isPink ? "#fbcfe8" : isBlack ? "#2a2a2a" : isDark ? "#334155" : "#eff6ff",
      "list.focusForeground": fg,
      "list.focusHighlightForeground": isPink ? "#be185d" : isBlack || isDark ? "#93c5fd" : "#2563eb",
      "list.hoverBackground": isPink ? "#fce7f3" : isBlack ? "#242424" : isDark ? "#293548" : "#f8fafc",
      "list.hoverForeground": fg
    }
  });
  monaco.editor.setTheme(themeId);
  return themeId;
};

function initializeIDEEditor() {
  if (window.ideEditor) return;
  const container = document.getElementById("ide-monaco");
  if (!container) return;
  const wasHidden = container.style.display === "none";
  try {
    container.style.display = "block";
  } catch (_) {}
  function createEditor() {
    const currentTheme = localStorage.getItem("sednar-theme") || "black";
    if (window.monaco && window.applyIDEDynamicTheme) {
      window.applyIDEDynamicTheme(currentTheme);
    }
    console.log("Creating Monaco editor for IDE section...");
    window.ideEditor = monaco.editor.create(container, {
      value: "",
      language: "plaintext",
      theme: "sednar-dynamic-theme",
      automaticLayout: true,
      fixedOverflowWidgets: true,
      minimap: {
        enabled: false
      },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      fontLigatures: false,
      fontWeight: "400",
      fontFamily: window.SEDNAR_MONACO_FONT || "'SednarMono', 'Prima Sans Mono W01 Roman', 'PrimaSansMonoW01-Roman', Consolas, 'Liberation Mono', 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      tabSize: 4,
      insertSpaces: true,
      renderWhitespace: "none",
      cursorBlinking: "solid",
      cursorStyle: "line",
      smoothScrolling: true,
      roundedSelection: false,
      renderLineHighlight: "line",
      lineDecorationsWidth: 16,
      lineNumbersMinChars: 3,
      glyphMargin: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "always",
      scrollbar: {
        horizontal: "auto",
        vertical: "auto",
        horizontalScrollbarSize: 10,
        verticalScrollbarSize: 10,
        horizontalSliderSize: 10,
        verticalSliderSize: 10,
        useShadows: false,
        handleMouseWheel: true
      }
    });
    try {
      monaco.editor.remeasureFonts();
    } catch (e) {}
    window.addEventListener("resize", function() {
      if (window.ideEditor) {
        try {
          window.ideEditor.layout();
        } catch (_) {}
      }
    });
    ideEditor = window.ideEditor;
    window.ideEditorReady = true;
    if (typeof window._sednarApplyEditorSettings === "function") window._sednarApplyEditorSettings();
    _sednarBindEditorAutosaveOnce();
    _sednarBindPlanMonacoAutosave();
    try { if (typeof window.installSednarTsIntel === "function") window.installSednarTsIntel(); } catch (e) {}
    try {
      if (window.WBLsp && sednarProjectPath) {
        window.WBLsp.onProjectOpen(sednarProjectPath, null);
        if (window.WBTsIntel) window.WBTsIntel.onProjectOpen(sednarProjectPath, null);
      }
    } catch (e) {}
    console.log("Monaco editor created successfully for IDE section");
    if (wasHidden || !ideActiveFile) {
      container.style.display = "none";
      const placeholder = document.getElementById("ide-editor-placeholder");
      if (placeholder) {
        updateSednarEditorPlaceholder();
        placeholder.style.display = "flex";
      }
    }
  }
  if (typeof require !== "undefined") {
    require.config({
      paths: {
        vs: window.SEDNAR_MONACO_VS || "/templates/js/monaco-editor/vs"
      }
    });
    if (window.monaco && monaco.editor) {
      if (typeof window.installSednarMonacoDefaults === "function") {
        window.installSednarMonacoDefaults();
      }
      createEditor();
    } else {
      require([ "vs/editor/editor.main" ], function() {
        if (typeof window.installSednarMonacoDefaults === "function") {
          window.installSednarMonacoDefaults();
        }
        createEditor();
      });
    }
  }
}

window.createAndShowIDEEditor = function(showImmediately = true) {
  var ideSection = document.getElementById("ide-editor-section");
  var ideBtn = document.getElementById("ideEditorToggleBtn");
  if (!ideSection) return false;
  if (ideSection.style.display === "none" || !ideSection.style.display) {
    closeAllSectionsExcept("ideEditor");
    ideSection.style.display = "block";
    if (typeof updateDockIndicators === "function") {
      updateDockIndicators("ideEditor");
    }
    if (window.ideIsFullscreen) {
      exitIDEFullscreen();
    }
    initializeIDEEditor();
    const panelContent = document.getElementById("ide-panel-content");
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
    setTimeout(function() {
      initSednarProjectState();
      if (!ideTerminalInitialized) {
        initializeIDETerminal();
      }
      if (typeof window.initChatbotModelSelectors === "function") {
        window.initChatbotModelSelectors();
      }
      if (typeof window.initSednarModeSelector === "function") {
        window.initSednarModeSelector();
      }
      if (typeof window.refreshSednarShimmerStyle === "function") {
        window.refreshSednarShimmerStyle();
      }
    }, 100);
    if (showImmediately && ideSection) {}
  } else {
    window.sednarRecordToolOpen("ideEditor");
    return false;
  }
  return true;
};

window.closeIDEEditor = function() {
  var ideSection = document.getElementById("ide-editor-section");
  var ideBtn = document.getElementById("ideEditorToggleBtn");
  if (ideSection) {
    if (window.ideIsFullscreen) {
      exitIDEFullscreen();
    }
    ideSection.style.display = "none";
    if (ideBtn) ideBtn.classList.remove("selected");
    var openSections = parseSednarOpenSectionsList();
    openSections = openSections.filter(s => s !== "ideEditor");
    if (typeof saveOpenSections === "function") {
      saveOpenSections(openSections);
    } else {
      localStorage.setItem("sednar-open-sections", JSON.stringify(openSections));
    }
  }
  closeAllSectionsExcept(null);
  updateNotesVisibility();
};

window.toggleIDEFullscreen = function() {
  if (window.ideIsFullscreen) {
    exitIDEFullscreen();
  } else {
    enterIDEFullscreen();
  }
};

function _sednarRelayoutAfterFullscreen() {
  setTimeout(function() {
    if (window.ideEditor) {
      try { window.ideEditor.layout(); } catch (e) {}
    }
    if (ideFitAddon) {
      try { ideFitAddon.fit(); } catch (e) {}
    }
  }, 100);
}

function enterIDEFullscreen() {
  const ideSection = document.getElementById("ide-editor-section");
  const ideInner = document.getElementById("ide-editor-inner");
  if (!ideSection || !ideInner) return;
  if (!window.ideOriginalStates) window.ideOriginalStates = {};
  window.ideOriginalStates["ideInnerHeight"] = ideInner.style.height || "";
  ideSection.classList.add("fullscreen-section");
  document.body.classList.add("ide-editor-fullscreen");
  document.documentElement.classList.add("ide-editor-fullscreen");
  ideInner.style.height = "100%";
  const enterIcon = document.getElementById("ide-fullscreen-enter-icon");
  const exitIcon = document.getElementById("ide-fullscreen-exit-icon");
  if (enterIcon) enterIcon.style.display = "none";
  if (exitIcon) exitIcon.style.display = "";
  window.ideIsFullscreen = true;
  _sednarRelayoutAfterFullscreen();
}

function exitIDEFullscreen() {
  const ideSection = document.getElementById("ide-editor-section");
  const ideInner = document.getElementById("ide-editor-inner");
  if (!ideSection || !ideInner) return;
  ideSection.classList.remove("fullscreen-section");
  document.body.classList.remove("ide-editor-fullscreen");
  document.documentElement.classList.remove("ide-editor-fullscreen");
  const originalHeight = (window.ideOriginalStates && window.ideOriginalStates["ideInnerHeight"]) || "";
  ideInner.style.height = originalHeight || "";
  const enterIcon = document.getElementById("ide-fullscreen-enter-icon");
  const exitIcon = document.getElementById("ide-fullscreen-exit-icon");
  if (enterIcon) enterIcon.style.display = "";
  if (exitIcon) exitIcon.style.display = "none";
  window.ideIsFullscreen = false;
  _sednarRelayoutAfterFullscreen();
}

let ideTerminalTabs = [];

let ideActiveTabId = null;

let ideTerminalTabCounter = 0;

let _ideTerminalIdSeq = 0;
const _ideTerminalSetsByProject = {};
const _SEDNAR_TERMINAL_BUFFER_MAX = 512 * 1024;

function _sednarWaitForNonZeroSize(el, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    function tick() {
      if (!el || !el.isConnected) {
        resolve(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const ok = rect && rect.width > 2 && rect.height > 2;
      if (ok) {
        resolve(true);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function _sednarFlushTerminalOutput(tabData) {
  if (!tabData) return;
  if (!tabData._pendingOutput || !tabData.terminal) return;
  try {
    tabData.terminal.write(tabData._pendingOutput);
  } catch (e) {}
  tabData._pendingOutput = "";
}

function _sednarFitTerminalTab(tabData, { emitResize = false } = {}) {
  if (!tabData) return;
  const wrapper = document.getElementById(`ide-terminal-wrapper-${tabData.id}`);
  if (!wrapper) return;

  const applyViewportPadding = () => {
    const viewport = wrapper.querySelector(".xterm-viewport");
    if (viewport) {
      viewport.style.position = "absolute";
      viewport.style.top = "0";
      viewport.style.left = "0";
      viewport.style.right = "0";
      viewport.style.bottom = "0";
    }
  };

  applyViewportPadding();

  if (tabData.fitAddon) {
    try {
      tabData.fitAddon.fit();
    } catch (e) {}
  }

  if (tabData.terminal) {
    try {
      tabData.terminal.scrollToBottom();
    } catch (e) {}
  }

  if (emitResize && tabData.socket && tabData.fitAddon) {
    try {
      const dims = tabData.fitAddon.proposeDimensions();
      if (dims) {
        tabData.socket.emit("terminal_resize", {
          cols: dims.cols,
          rows: dims.rows
        });
      }
    } catch (e) {}
  }
}

function createTerminalTab(name = null, options = null) {
  ++ideTerminalTabCounter;
  const tabId = `terminal-${++_ideTerminalIdSeq}`;
  let tabName = name;
  if (!tabName) {
    if (ideTerminalTabCounter === 1) {
      tabName = "Local";
    } else {
      tabName = `Local (${ideTerminalTabCounter})`;
    }
  }
  const tabsList = document.getElementById("ide-terminal-tabs-list");
  if (!tabsList) return null;
  const tabElement = document.createElement("button");
  tabElement.className = "ide-terminal-tab";
  tabElement.id = `ide-terminal-tab-${tabId}`;
  tabElement.dataset.tabId = tabId;
  const icon = document.createElement("span");
  icon.className = "ide-terminal-tab-icon";
  icon.innerHTML = _sednarIcon("terminal", { size: "base" });
  const label = document.createElement("span");
  label.className = "ide-terminal-tab-label";
  label.textContent = tabName;
  const closeBtn = document.createElement("button");
  closeBtn.className = "ide-terminal-tab-close";
  closeBtn.title = "Kill terminal";
  closeBtn.innerHTML = _sednarIcon("x", { size: "base" });
  closeBtn.onclick = e => {
    e.stopPropagation();
    closeTerminalTab(tabId);
  };
  tabElement.appendChild(icon);
  tabElement.appendChild(label);
  tabElement.appendChild(closeBtn);
  tabElement.onclick = () => switchTerminalTab(tabId);
  tabsList.appendChild(tabElement);
  const tabData = {
    id: tabId,
    name: tabName,
    element: tabElement,
    terminal: null,
    fitAddon: null,
    socket: null,
    initialized: false,
    _pendingOutput: ""
  };
  ideTerminalTabs.push(tabData);
  switchTerminalTab(tabId, options);
  return tabId;
}

function switchTerminalTab(tabId, options) {
  if (ideActiveTabId === tabId) return;
  const tabData = ideTerminalTabs.find(t => t.id === tabId);
  if (!tabData) return;
  tabData._noFocus = !!(options && options.focus === false);
  const container = document.getElementById("ide-terminal-container");
  if (!container) return;
  const allWrappers = container.querySelectorAll('[id^="ide-terminal-wrapper-"]');
  allWrappers.forEach(wrapper => {
    wrapper.style.display = "none";
  });
  ideTerminalTabs.forEach(tab => {
    const tabElement = document.querySelector(`#ide-terminal-tab-${tab.id}`);
    if (tabElement) {
      tabElement.classList.remove("active");
    }
  });
  ideActiveTabId = tabId;
  const tabElement = document.querySelector(`#ide-terminal-tab-${tabId}`);
  if (tabElement) {
    tabElement.classList.add("active");
  }
  if (!tabData.initialized) {
    initializeTerminalForTab(tabData, container);
  } else {
    const wrapper = document.getElementById(`ide-terminal-wrapper-${tabId}`);
    if (wrapper) {
      wrapper.style.display = "block";
      _sednarWaitForNonZeroSize(wrapper, { timeoutMs: 1000 }).finally(() => {
        _sednarFitTerminalTab(tabData, { emitResize: true });
        _sednarFlushTerminalOutput(tabData);
        if (tabData.terminal && !tabData._noFocus) {
          tabData.terminal.focus();
        }
        tabData._noFocus = false;
        ideTerminal = tabData.terminal;
        ideFitAddon = tabData.fitAddon;
        window.ideTerminalSocket = tabData.socket;
      });
    }
  }
}

function _sednarTeardownTerminalTab(tabData) {
  if (!tabData) return;
  if (tabData._terminalResizeObserver) {
    try {
      tabData._terminalResizeObserver.disconnect();
    } catch (e) {}
    tabData._terminalResizeObserver = null;
  }
  if (tabData._windowResizeHandler) {
    window.removeEventListener("resize", tabData._windowResizeHandler);
    tabData._windowResizeHandler = null;
  }
  if (tabData.socket) {
    try {
      tabData.socket.disconnect();
    } catch (e) {}
    tabData.socket = null;
  }
  if (tabData.terminal) {
    try {
      tabData.terminal.dispose();
    } catch (e) {}
    tabData.terminal = null;
  }
  const wrapper = document.getElementById(`ide-terminal-wrapper-${tabData.id}`);
  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.removeChild(wrapper);
  }
  if (tabData.element && tabData.element.parentNode) {
    tabData.element.parentNode.removeChild(tabData.element);
  }
}

function _sednarResetTerminalsForProject() {
  ideTerminalTabs.slice().forEach(_sednarTeardownTerminalTab);
  ideTerminalTabs = [];
  ideActiveTabId = null;
  ideTerminalTabCounter = 0;
  ideTerminal = null;
  ideFitAddon = null;
  window.ideTerminalSocket = null;
  ideTerminalInitialized = false;
}

function _sednarSwapTerminalsForProject(previousPath, nextPath) {
  const prevKey = _sednarNormalizeProjectKey(previousPath);
  const nextKey = _sednarNormalizeProjectKey(nextPath);
  if (prevKey === nextKey) return;
  if (prevKey && ideTerminalTabs.length) {
    ideTerminalTabs.forEach(function(tab) {
      if (tab.element) tab.element.hidden = true;
      const wrapper = document.getElementById(`ide-terminal-wrapper-${tab.id}`);
      if (wrapper) wrapper.style.display = "none";
    });
    _ideTerminalSetsByProject[prevKey] = {
      tabs: ideTerminalTabs,
      activeTabId: ideActiveTabId,
      counter: ideTerminalTabCounter,
    };
  } else {
    ideTerminalTabs.slice().forEach(_sednarTeardownTerminalTab);
  }
  const next = nextKey ? _ideTerminalSetsByProject[nextKey] : null;
  if (next) delete _ideTerminalSetsByProject[nextKey];
  ideTerminalTabs = next ? next.tabs : [];
  ideTerminalTabCounter = next ? next.counter : 0;
  ideActiveTabId = null;
  ideTerminal = null;
  ideFitAddon = null;
  window.ideTerminalSocket = null;
  ideTerminalTabs.forEach(function(tab) {
    if (tab.element) tab.element.hidden = false;
  });
  const showId = next && ideTerminalTabs.some(function(t) { return t.id === next.activeTabId; })
    ? next.activeTabId
    : (ideTerminalTabs[0] && ideTerminalTabs[0].id);
  if (showId) {
    switchTerminalTab(showId, { focus: false });
  } else if (ideTerminalVisible && nextKey) {
    createTerminalTab(null, { focus: false });
  }
}

function _sednarCloseProjectTerminals(key) {
  const set = _ideTerminalSetsByProject[key];
  if (!set) return;
  delete _ideTerminalSetsByProject[key];
  set.tabs.forEach(_sednarTeardownTerminalTab);
}

function _sednarBufferTerminalOutput(tabData, text) {
  let buffered = (tabData._pendingOutput || "") + text;
  if (buffered.length > _SEDNAR_TERMINAL_BUFFER_MAX) {
    buffered = buffered.slice(buffered.length - _SEDNAR_TERMINAL_BUFFER_MAX);
  }
  tabData._pendingOutput = buffered;
}

function closeTerminalTab(tabId) {
  const tabIndex = ideTerminalTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  const tabData = ideTerminalTabs[tabIndex];
  const isLastTab = ideTerminalTabs.length === 1;
  _sednarTeardownTerminalTab(tabData);
  ideTerminalTabs.splice(tabIndex, 1);
  if (isLastTab) {
    ideActiveTabId = null;
    hideIDETerminal();
    return;
  }
  if (ideActiveTabId === tabId) {
    if (ideTerminalTabs.length > 0) {
      switchTerminalTab(ideTerminalTabs[ideTerminalTabs.length - 1].id);
    } else {
      ideActiveTabId = null;
    }
  }
}

function _sednarGetTerminalTheme() {

  const styles = getComputedStyle(document.body);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };

  const bg = read("--ide-terminal-bg", "#141414");
  const fg = read("--ide-terminal-fg", "#ffffff");
  const selectionBackground = read("--ide-terminal-selection-bg", "rgba(148, 163, 184, 0.35)");
  const selectionForeground = read("--ide-terminal-selection-fg", fg);

  // ANSI colours tuned per theme: xterm's defaults are harsh on dark backgrounds and unreadable on light ones.
  const light = document.body.classList.contains("white-theme") || document.body.classList.contains("pink-theme");
  const ansi = light ? {
    black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#7d4e00", blue: "#0550ae", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01", brightBlue: "#0969da", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
  } : {
    black: "#3b4252", red: "#f07178", green: "#a5d6a7", yellow: "#ffcb6b", blue: "#82aaff", magenta: "#c792ea", cyan: "#89ddff", white: "#d0d7de",
    brightBlack: "#6b7280", brightRed: "#ff8b92", brightGreen: "#c3e88d", brightYellow: "#ffe08a", brightBlue: "#9cc4ff", brightMagenta: "#ddb3ff", brightCyan: "#a6f0ff", brightWhite: "#ffffff",
  };
  return Object.assign({
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,

    selection: selectionBackground,
    selectionBackground: selectionBackground,
    selectionForeground: selectionForeground
  }, ansi);
}

function _sednarApplyTerminalTheme() {
  const theme = _sednarGetTerminalTheme();
  ideTerminalTabs.forEach((t) => {
    if (!t || !t.terminal) return;
    try {
      t.terminal.options.theme = theme;
    } catch (e) {}
  });
}
window._sednarApplyTerminalTheme = _sednarApplyTerminalTheme;

function _sednarTerminalContentEnd(line, cell, cols) {
  for (let x = Math.min(cols, line.length) - 1; x >= 0; x--) {
    const current = line.getCell(x, cell);
    if (!current) continue;
    const chars = current.getChars();
    if ((chars && chars !== " ") || !current.isBgDefault() || current.isInverse()) {
      return x + Math.max(1, current.getWidth());
    }
  }
  return 0;
}

function _sednarTrimTerminalSelection(terminal) {
  const layer = terminal.element && terminal.element.querySelector(".xterm-screen .xterm-selection");
  if (!layer) return;
  const observer = new MutationObserver(function() {
    if (!layer.firstElementChild) return;
    const sampleRow = terminal.element.querySelector(".xterm-rows > div");
    const cellHeight = sampleRow ? parseFloat(sampleRow.style.height) : 0;
    const cellWidth = sampleRow ? parseFloat(sampleRow.style.width) / terminal.cols : 0;
    if (!(cellHeight > 0 && cellWidth > 0)) return;
    const buffer = terminal.buffer.active;
    const cell = buffer.getNullCell();
    const spans = [];
    Array.from(layer.children).forEach(function(block) {
      const left = parseFloat(block.style.left);
      const firstRow = Math.round(parseFloat(block.style.top) / cellHeight);
      const rowCount = Math.round(parseFloat(block.style.height) / cellHeight);
      const startCol = Math.round(left / cellWidth);
      const endCol = Math.round((left + parseFloat(block.style.width)) / cellWidth);
      for (let row = firstRow; row < firstRow + rowCount; row++) {
        const line = buffer.getLine(buffer.viewportY + row);
        const stopCol = Math.min(endCol, line ? _sednarTerminalContentEnd(line, cell, terminal.cols) : 0);
        if (stopCol <= startCol) continue;
        const previous = spans[spans.length - 1];
        if (previous && previous.startCol === startCol && previous.stopCol === stopCol && previous.row + previous.rows === row) {
          previous.rows++;
        } else {
          spans.push({ row: row, rows: 1, startCol: startCol, stopCol: stopCol });
        }
      }
    });
    const fragment = document.createDocumentFragment();
    spans.forEach(function(span) {
      const element = document.createElement("div");
      element.style.top = span.row * cellHeight + "px";
      element.style.height = span.rows * cellHeight + "px";
      element.style.left = span.startCol * cellWidth + "px";
      element.style.width = (span.stopCol - span.startCol) * cellWidth + "px";
      fragment.appendChild(element);
    });
    layer.replaceChildren(fragment);
    observer.takeRecords();
  });
  observer.observe(layer, { childList: true });
}

function initializeTerminalForTab(tabData, container) {

  const fontStack = "'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace";

  const terminalWrapper = document.createElement("div");
  terminalWrapper.id = `ide-terminal-wrapper-${tabData.id}`;
  terminalWrapper.style.cssText = "width:100%;height:100%;position:relative;";
  terminalWrapper.style.padding = "6px 8px 4px 12px";
  terminalWrapper.style.boxSizing = "border-box";
  container.appendChild(terminalWrapper);

  const isActive = () => ideActiveTabId === tabData.id;

  document.fonts.ready.then(() => {
    Promise.resolve().finally(() => {

      const termOpts = _sednarTerminalOptionsFromSettings();
      const terminal = new Terminal({
        cursorBlink: termOpts.cursorBlink,
        cursorStyle: termOpts.cursorStyle,
        scrollback: termOpts.scrollback,
        fontFamily: fontStack,
        fontSize: termOpts.fontSize,
        lineHeight: 1.2,
        fontWeight: "normal",
        letterSpacing: 0,
        theme: _sednarGetTerminalTheme(),
        allowProposedApi: true,
        rightClickSelectsWord: true
      });

      let fitAddon = null;
      if (window.FitAddon) {
        fitAddon = new window.FitAddon.FitAddon;
        terminal.loadAddon(fitAddon);
      }

      terminal.open(terminalWrapper);
      _sednarTrimTerminalSelection(terminal);

      const socket = io.connect(location.protocol + "//" + location.host);
      let terminalInitEmittedForSid = null;
      socket.on("connect_error", function() {
        try {
          socket.disconnect();
        } catch (e) {}
      });
      socket.on("disconnect", () => {
        terminalInitEmittedForSid = null;
      });

      function emitInitWithBestDims() {
        if (!socket || !socket.connected) return;
        if (terminalInitEmittedForSid === socket.id) return;
        terminalInitEmittedForSid = socket.id;
        let cols = 80;
        let rows = 24;
        if (fitAddon) {
          try {
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols && dims.rows) {
              cols = dims.cols;
              rows = dims.rows;
            }
          } catch (e) {}
        }
        socket.emit("terminal_init", {
          cols,
          rows,
          cwd: sednarProjectPath || undefined
        });
      }

      function ensureFitAndInit() {
        return _sednarWaitForNonZeroSize(terminalWrapper, { timeoutMs: 2000 }).finally(() => {
          _sednarFitTerminalTab(tabData);
          if (socket && socket.connected) {
            emitInitWithBestDims();
          }
          if (isActive()) {
            _sednarFlushTerminalOutput(tabData);
            if (!tabData._noFocus) {
              try {
                terminal.focus();
              } catch (e) {}
            }
            tabData._noFocus = false;
          }
        });
      }

      socket.on("connect", () => {
        ensureFitAndInit();
      });

      socket.on("terminal_output", data => {
        if (!data || !data.output) return;
        if (isActive() && ideTerminalVisible) {
          _sednarFlushTerminalOutput(tabData);
          try {
            terminal.write(data.output);  // xterm follows the tail by itself while the viewport is at the bottom
          } catch (e) {}
        } else {
          _sednarBufferTerminalOutput(tabData, data.output);
        }
      });

      terminal.onData(data => {
        socket.emit("terminal_input", {
          input: data
        });
      });

      terminal.onResize(size => {
        socket.emit("terminal_resize", {
          cols: size.cols,
          rows: size.rows
        });
      });

      tabData.terminal = terminal;
      tabData.fitAddon = fitAddon;
      tabData.socket = socket;
      tabData.initialized = true;
      tabData.terminal.element = terminalWrapper;

      if (isActive()) {
        terminalWrapper.style.display = "block";
        ideTerminal = terminal;
        ideFitAddon = fitAddon;
        window.ideTerminalSocket = socket;
      } else {
        terminalWrapper.style.display = "none";
      }

      const windowResizeHandler = () => {
        if (fitAddon && isActive()) {
          _sednarFitTerminalTab(tabData, { emitResize: true });
        }
      };
      window.addEventListener("resize", windowResizeHandler);
      tabData._windowResizeHandler = windowResizeHandler;

      if (fitAddon && typeof ResizeObserver !== "undefined") {
        const resizeObserver = new ResizeObserver(() => {
          if (!isActive()) return;
          _sednarFitTerminalTab(tabData, { emitResize: true });
        });
        resizeObserver.observe(terminalWrapper);
        tabData._terminalResizeObserver = resizeObserver;
      }

      ensureFitAndInit();
    });
  });
}

function initializeIDETerminal() {
  const container = document.getElementById("ide-terminal-container");
  if (!container) return;
  const addBtn = document.getElementById("ide-terminal-tab-add");
  if (addBtn) {
    addBtn.onclick = () => createTerminalTab();
  }
  if (ideTerminalTabs.length === 0 && sednarProjectPath) {
    createTerminalTab();
  }
  ideTerminalInitialized = true;
}

let ideTerminalVisible = false;

function showIDETerminal() {
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const terminalDivider = document.getElementById("ide-terminal-divider");
  if (terminalPanel && terminalDivider) {
    terminalPanel.style.display = "flex";
    terminalPanel.style.opacity = "";
    terminalPanel.style.overflow = "";
    terminalPanel.style.transition = "";
    terminalDivider.style.display = "block";
    const ideEditorInner = document.getElementById("ide-editor-inner");
    if (ideEditorInner) {
      const sectionHeight = ideEditorInner.getBoundingClientRect().height || 499;
      const savedHeight = Number(_sednarSettingsGet("terminalHeight")) || 0;
      const terminalHeight = savedHeight >= 100 ? Math.min(savedHeight, Math.max(100, sectionHeight - 100)) : Math.round(sectionHeight * .3);
      if (!terminalPanel.style.height || terminalPanel.style.height === "100px" || terminalPanel.style.height === "150px") {
        terminalPanel.style.height = terminalHeight + "px";
      }
    }
    if (ideTerminalTabs.length === 0) {
      createTerminalTab();
    }
    ideTerminalVisible = true;
    const toggleBtn = document.getElementById("ide-terminal-toggle");
    if (toggleBtn) {
      toggleBtn.innerHTML = `\n                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                    <polyline points="20 6 9 17 4 12"></polyline>\n                 </svg>\n                 <span>Terminal</span>\n               `;
    }
    const activityTerminalBtn = document.getElementById("ide-activity-terminal");
    if (activityTerminalBtn) {
      activityTerminalBtn.classList.add("active");
      activityTerminalBtn.setAttribute("aria-pressed", "true");
    }
    function scheduleFits() {
      [ 100, 280, 550 ].forEach(delay => {
        setTimeout(() => {
          if (ideFitAddon) {
            try {
              ideFitAddon.fit();
            } catch (e) {}
          }
        }, delay);
      });
    }
    scheduleFits();
    const shown = ideTerminalTabs.find(t => t.id === ideActiveTabId);
    if (shown) setTimeout(() => _sednarFlushTerminalOutput(shown), 120);
  }
}

function hideIDETerminal() {
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const terminalDivider = document.getElementById("ide-terminal-divider");
  if (terminalPanel && terminalDivider) {
    terminalPanel.style.display = "none";
    terminalPanel.style.opacity = "";
    terminalPanel.style.overflow = "";
    terminalPanel.style.transition = "";
    terminalDivider.style.display = "none";
    ideTerminalVisible = false;
    const toggleBtn = document.getElementById("ide-terminal-toggle");
    if (toggleBtn) {
      toggleBtn.innerHTML = `\n                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                    <polyline points="4 17 10 11 4 5"></polyline>\n                    <line x1="12" y1="19" x2="20" y2="19"></line>\n                 </svg>\n                 <span>Terminal</span>\n               `;
    }
    const activityTerminalBtn = document.getElementById("ide-activity-terminal");
    if (activityTerminalBtn) {
      activityTerminalBtn.classList.remove("active");
      activityTerminalBtn.setAttribute("aria-pressed", "false");
    }
  }
}

function toggleIDETerminal() {
  if (ideTerminalVisible) {
    hideIDETerminal();
  } else {
    showIDETerminal();
  }
}
window.toggleIDETerminal = toggleIDETerminal;

document.addEventListener("DOMContentLoaded", function() {
  const toggleBtn = document.getElementById("ide-terminal-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleIDETerminal);
  }
});

function updatePlayButtonVisibility() {
  const playButton = document.getElementById("ide-play-button");
  updateIdePlanChrome();
  if (!playButton) return;
  if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) {
    playButton.style.display = "none";
    return;
  }
  const fileName = ideOpenFiles[ideActiveFile].name;
  if (fileName.toLowerCase().endsWith(".py")) {
    playButton.style.display = "inline-flex";
  } else {
    playButton.style.display = "none";
  }
}

function runCurrentPythonFile() {
  if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) {
    return;
  }
  const fileName = ideOpenFiles[ideActiveFile].name;
  if (!fileName.toLowerCase().endsWith(".py")) {
    return;
  }
  runPythonFile(ideActiveFile);
}

function runPythonFile(filePath) {
  showIDETerminal();
  if (!ideTerminalInitialized) {
    initializeIDETerminal();
    setTimeout(() => {
      executePythonFile(filePath);
    }, 500);
  } else {
    executePythonFile(filePath);
  }
}

function executePythonFile(filePath) {
  const command = `python3 "${filePath}"\n`;
  if (!window.ideTerminalSocket) {
    window.ideTerminalSocket = io.connect(location.protocol + "//" + location.host);
    window.ideTerminalSocket.on("connect", () => {
      window.ideTerminalSocket.emit("terminal_input", {
        input: command
      });
      setTimeout(() => {
        if (ideTerminal) {
          ideTerminal.focus();
        }
      }, 100);
    });
  } else {
    window.ideTerminalSocket.emit("terminal_input", {
      input: command
    });
    setTimeout(() => {
      if (ideTerminal) {
        ideTerminal.focus();
      }
    }, 100);
  }
}

let ideFileTreeData = {};

let ideHomePath = "~";

function _sednarRootFolderName(path) {
  return (path || "").split("/").filter(Boolean).pop() || path || "Project";
}

function _sednarUniqueWorkspaceRootName(baseName, usedNames) {
  let name = baseName || "Project";
  let index = 2;
  while (usedNames.has(name)) {
    name = (baseName || "Project") + " " + index;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function _sednarWrapRootTreeChildren(actualPath, children) {
  const rootName = _sednarRootFolderName(actualPath);
  ideExpandedFolders.add(actualPath);
  return {
    [rootName]: {
      type: "folder",
      path: actualPath,
      is_dir: true,
      children: children,
      expanded: true,
      loaded: true
    }
  };
}

function _sednarWorkspaceRenderRootPath() {
  return sednarWorkspaceFolders.length > 1 ? "__sednar_workspace__" : ideHomePath;
}

function _sednarRenderWorkspaceTree() {
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (!fileTreeEl) return;
  renderFileTree(ideFileTreeData, fileTreeEl, _sednarWorkspaceRenderRootPath());
}

function _sednarIsWorkspaceRootNode(rootPath, level, nodePath) {
  if (rootPath !== "__sednar_workspace__" || level !== 0 || !nodePath) return false;
  return _sednarWorkspaceFolderIndexByPath(nodePath) !== -1;
}

function _sednarAppendWorkspaceRootControls(item, nodePath) {
  const index = _sednarWorkspaceFolderIndexByPath(nodePath);
  if (index < 0) return;
  item.dataset.sednarWorkspaceRootPath = nodePath;
  item.dataset.sednarWorkspaceRootIndex = String(index);
  if (index === 0) {
    const badge = document.createElement("span");
    badge.className = "sednar-workspace-root-badge theme-transition";
    badge.textContent = "Primary";
    item.appendChild(badge);
  }
  if (_sednarWorkspaceFolderIsMissing(nodePath)) {
    const missingBadge = document.createElement("span");
    missingBadge.className = "sednar-workspace-missing-badge theme-transition";
    missingBadge.textContent = "Missing";
    item.appendChild(missingBadge);
  }
}

function _sednarWorkspaceFolderIsMissing(nodePath) {
  const norm = _sednarNormalizeProjectKey(nodePath);
  return sednarWorkspaceMissingFolders.some(function(p) { return _sednarNormalizeProjectKey(p) === norm; });
}

function _sednarRefreshWorkspaceMissingBadges() {
  document.querySelectorAll("#ide-file-tree .sednar-workspace-root-item").forEach(function(item) {
    const nodePath = item.dataset.sednarWorkspaceRootPath;
    const existing = item.querySelector(".sednar-workspace-missing-badge");
    if (_sednarWorkspaceFolderIsMissing(nodePath)) {
      if (!existing) {
        const missingBadge = document.createElement("span");
        missingBadge.className = "sednar-workspace-missing-badge theme-transition";
        missingBadge.textContent = "Missing";
        item.appendChild(missingBadge);
      }
    } else if (existing) {
      existing.remove();
    }
  });
}

function _sednarWorkspaceDragIndexFromEvent(row, event) {
  const rawIndex = Number(row.getAttribute("data-sednar-workspace-row") || row.dataset.sednarWorkspaceRootIndex || "-1");
  if (rawIndex < 0) return -1;
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? rawIndex + 1 : rawIndex;
}

function _sednarClearWorkspaceDragClasses(container) {
  if (!container) return;
  container.querySelectorAll(".sednar-workspace-drag-over-before, .sednar-workspace-drag-over-after, .sednar-workspace-dragging").forEach(function(row) {
    row.classList.remove("sednar-workspace-drag-over-before", "sednar-workspace-drag-over-after", "sednar-workspace-dragging");
  });
}

function _sednarUpdateWorkspaceDropIndicator(row, event) {
  row.classList.remove("sednar-workspace-drag-over-before", "sednar-workspace-drag-over-after");
  const rect = row.getBoundingClientRect();
  row.classList.add(event.clientY > rect.top + rect.height / 2 ? "sednar-workspace-drag-over-after" : "sednar-workspace-drag-over-before");
}

function _sednarWorkspaceDragPayload(event) {
  if (!event.dataTransfer) return null;
  try {
    const raw = event.dataTransfer.getData("application/x-sednar-workspace-root");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function _sednarStartWorkspaceRowDrag(row, event) {
  const index = Number(row.getAttribute("data-sednar-workspace-row") || row.dataset.sednarWorkspaceRootIndex || "-1");
  const folders = _sednarWorkspaceFoldersForManager();
  const folder = folders[index];
  if (!folder || !event.dataTransfer) return false;
  event.stopPropagation();
  row.classList.add("sednar-workspace-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-sednar-workspace-root", JSON.stringify({ path: folder.path }));
  event.dataTransfer.setData("text/plain", _sednarWorkspaceFolderLabel(folder));
  return true;
}

function _sednarBindWorkspaceRowDrag(row, container) {
  row.addEventListener("dragstart", function(event) {
    _sednarStartWorkspaceRowDrag(row, event);
  });
  row.addEventListener("dragover", function(event) {
    const types = event.dataTransfer ? Array.prototype.slice.call(event.dataTransfer.types || []) : [];
    if (types.indexOf("application/x-sednar-workspace-root") === -1) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    _sednarUpdateWorkspaceDropIndicator(row, event);
  });
  row.addEventListener("dragleave", function(event) {
    if (row.contains(event.relatedTarget)) return;
    row.classList.remove("sednar-workspace-drag-over-before", "sednar-workspace-drag-over-after");
  });
  row.addEventListener("drop", function(event) {
    const payload = _sednarWorkspaceDragPayload(event);
    if (!payload || !payload.path) return;
    event.preventDefault();
    event.stopPropagation();
    const targetIndex = _sednarWorkspaceDragIndexFromEvent(row, event);
    _sednarClearWorkspaceDragClasses(container);
    _sednarMoveWorkspaceFolderToIndex(payload.path, targetIndex);
  });
  row.addEventListener("dragend", function() {
    _sednarClearWorkspaceDragClasses(container);
  });
}

function _sednarBindWorkspaceManagerDrag(list) {
  list.querySelectorAll("[data-sednar-workspace-row]").forEach(function(row) {
    _sednarBindWorkspaceRowDrag(row, list);
  });
}

function _sednarLoadWorkspaceFolderTrees() {
  if (!sednarWorkspaceFolders.length) return;
  const rootPath = _sednarWorkspaceRenderRootPath();
  if (sednarWorkspaceFolders.length > 1) {
    ideFileTreeData[rootPath] = {};
    sednarWorkspaceRootOrder = [];
    const usedNames = new Set();
    sednarWorkspaceFolders.forEach(function(folder) {
      if (!folder || !folder.path) return;
      const baseName = folder.name || _sednarRootFolderName(folder.path);
      const name = _sednarUniqueWorkspaceRootName(baseName, usedNames);
      sednarWorkspaceRootOrder.push(name);
      ideFileTreeData[rootPath][name] = {
        type: "folder",
        path: folder.path,
        is_dir: true,
        children: {},
        expanded: true,
        loaded: false
      };
      ideExpandedFolders.add(folder.path);
      loadIDEFileTree(folder.path, ideFileTreeData[rootPath][name]);
    });
    _sednarRenderWorkspaceTree();
    return;
  }
  loadIDEFileTree(sednarWorkspaceFolders[0].path);
}

function _sednarTreeNodeFromListItem(item) {
  return {
    type: item.type || (item.is_dir ? "folder" : "file"),
    path: item.path,
    is_dir: item.is_dir || false,
    children: item.is_dir ? {} : undefined,
    expanded: false,
    loaded: false
  };
}

function loadIDEFileTree(path, parentNode = null) {
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (!fileTreeEl) return;
  if (!path && !sednarProjectPath) {
    renderSednarExplorerEmpty();
    return;
  }
  const listPath = path || sednarProjectPath;
  if (!listPath) {
    renderSednarExplorerEmpty();
    return;
  }
  const emptyEl = document.getElementById("ide-explorer-empty");
  if (emptyEl) emptyEl.style.display = "none";
  const requestedProject = sednarProjectPath;
  _sednarIdeSocketRequest(
    "ide_list_files", { path: listPath },
    "ide_files_list",
    function(data) {
      return data && (data.requested_path !== undefined ? data.requested_path === listPath : data.path === listPath);
    }
  ).then(function(result) {
    if (sednarProjectPath !== requestedProject) return;
    const data = result.data;
    if (data.error) {
      if (result.error) console.error("Sednar: failed to list", listPath, data.error);
      if (!parentNode) {
        fileTreeEl.innerHTML = `<div style="padding:4px 8px;color:#ef4444;font-size:12px;">Error: ${data.error}</div>`;
      }
      return;
    }
    const actualPath = data.path || listPath;
    if (!parentNode) {
      ideHomePath = actualPath;
      sednarProjectPath = actualPath;
      sednarProjectName = actualPath.split("/").filter(Boolean).pop() || actualPath;
    }
    const children = {};
    if (data.files && Array.isArray(data.files)) {
      data.files.forEach(item => {
        children[item.name] = _sednarTreeNodeFromListItem(item);
      });
    }
    if (parentNode) {
      parentNode.loaded = true;
      parentNode.children = children;
      _sednarRenderWorkspaceTree();
    } else {
      ideFileTreeData[actualPath] = _sednarWrapRootTreeChildren(actualPath, children);
      _sednarRenderWorkspaceTree();
    }
  });
}

let _sednarFileTreeRenderRaf = null;
let _sednarFileTreeRenderArgs = null;

function _sednarToggleFolderChevron(item, expanded) {
  const chevron = item.querySelector(".ide-chevron-expanded, .ide-chevron-collapsed");
  if (!chevron) return;
  chevron.classList.toggle("ide-chevron-expanded", expanded);
  chevron.classList.toggle("ide-chevron-collapsed", !expanded);
  const folderImg = item.querySelector("img");
  const folderName = String(item.dataset.idePath || "").split("/").filter(Boolean).pop() || "";
  if (folderImg) folderImg.setAttribute("src", _sednarFolderIcon(expanded, folderName));
}

function _sednarScheduleFileTreeRender(treeData, container, rootPath) {
  _sednarFileTreeRenderArgs = { treeData: treeData, container: container, rootPath: rootPath };
  if (_sednarFileTreeRenderRaf != null) return;
  _sednarFileTreeRenderRaf = requestAnimationFrame(function() {
    _sednarFileTreeRenderRaf = null;
    const args = _sednarFileTreeRenderArgs;
    _sednarFileTreeRenderArgs = null;
    if (args) _sednarRenderFileTreeNow(args.treeData, args.container, args.rootPath);
  });
}

function renderFileTree(treeData, container, rootPath) {
  _sednarScheduleFileTreeRender(treeData, container, rootPath);
}

function _sednarRenderFileTreeNow(treeData, container, rootPath) {
  container.innerHTML = "";
  function renderNode(node, name, fullPath, level, parentPath, parentContainer) {
    const isFolder = node.is_dir || node.type === "folder";
    const indent = level * 16;
    const isExpanded = node.expanded && ideExpandedFolders.has(node.path);
    const icon = isFolder ? _sednarFolderIcon(isExpanded, name) : _sednarFileIcon(name);
    const hasChildren = isFolder && node.children && Object.keys(node.children).length > 0;
    const item = document.createElement("div");
    item.className = isFolder ? "folder-item theme-transition" : "file-item theme-transition";
    item.style.cssText = `padding:2px 4px;padding-left:${4 + indent}px;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:13px;border-radius:0;min-width:max-content;`;
    let chevron = "";
    if (isFolder) {
      const chevronClass = isExpanded ? "ide-chevron-expanded" : "ide-chevron-collapsed";
      chevron = `<span class="${chevronClass}" style="width:12px;height:12px;display:inline-block;margin-right:6px;vertical-align:middle;"></span>`;
    } else {
      chevron = '<span style="width:12px;display:inline-block;margin-right:6px;"></span>';
    }
    item.innerHTML = `\n              ${chevron}\n              <img src="${icon}" alt="${isFolder ? "Folder" : "File"}" style="width: 16px; height: 16px; flex-shrink: 0;" />\n              <span style="white-space:nowrap;min-width:0;">${name}</span>\n            `;
    const isWorkspaceRootNode = _sednarIsWorkspaceRootNode(rootPath, level, node.path);
    if (isWorkspaceRootNode) {
      item.classList.add("sednar-workspace-root-item");
      _sednarAppendWorkspaceRootControls(item, node.path);
      _sednarBindWorkspaceRowDrag(item, container);
    }
    item.dataset.idePath = node.path;
    if (_sednarFsClipboard && _sednarFsClipboard.mode === "move" && _sednarFsClipboard.path === node.path) {
      item.classList.add("ide-cut-pending");
    }
    item.draggable = true;
    item.addEventListener("dragstart", function(e) {
      if (isWorkspaceRootNode) return;
      if (!e.dataTransfer) return;
      e.stopPropagation();
      const repoPath = _sednarWorkspaceRepoPath(node.path);
      const payload = {
        repoPath: repoPath,
        kind: isFolder ? "folder" : "file",
        name: name
      };
      window._sednarRepoDragPayload = payload;
      e.dataTransfer.setData("application/x-sednar-repo-context", JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "copy";
    });
    item.addEventListener("dragend", function() {
      setTimeout(function() {
        window._sednarRepoDragPayload = null;
      }, 0);
    });
    const dragImg = item.querySelector("img");
    if (dragImg) dragImg.draggable = false;
    if (!isFolder) {
      item.onclick = e => {
        e.stopPropagation();
        openFileInEditorFromPath(node.path);
      };
      item.oncontextmenu = e => {
        showIDEContextMenu(e, node.path, name, false);
      };
      parentContainer.appendChild(item);
    } else {
      item.oncontextmenu = e => {
        showIDEContextMenu(e, node.path, name, true);
      };
      const wrap = document.createElement("div");
      wrap.className = "ide-tree-folder-wrap";
      wrap.dataset.folderPath = node.path;
      wrap.appendChild(item);
      const childContainer = document.createElement("div");
      childContainer.className = "ide-tree-children";
      childContainer.dataset.treeChildren = node.path;
      childContainer.style.setProperty("--ide-tree-guide-x", (indent + 8) + "px");
      childContainer.style.display = isExpanded ? "" : "none";
      wrap.appendChild(childContainer);
      parentContainer.appendChild(wrap);
      item.onclick = e => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        if (node.expanded) {
          ideExpandedFolders.add(node.path);
        } else {
          ideExpandedFolders.delete(node.path);
        }
        if (!node.loaded) {
          loadIDEFileTree(node.path, node);
          return;
        }
        childContainer.style.display = node.expanded ? "" : "none";
        _sednarToggleFolderChevron(item, node.expanded);
      };
      if (isExpanded && hasChildren) {
        Object.keys(node.children).sort((a, b) => {
          const aIsFolder = node.children[a].is_dir || node.children[a].type === "folder";
          const bIsFolder = node.children[b].is_dir || node.children[b].type === "folder";
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a.localeCompare(b);
        }).forEach(childName => {
          const childNode = node.children[childName];
          if (childNode.is_dir && !childNode.loaded && ideExpandedFolders.has(childNode.path)) {
            loadIDEFileTree(childNode.path, childNode);
          }
          renderNode(childNode, childName, fullPath + "/" + childName, level + 1, node.path, childContainer);
        });
      }
    }
  }
  const rootTree = treeData[rootPath] || {};
  if (!rootTree || Object.keys(rootTree).length === 0) {
    container.innerHTML = '<div style="padding:4px 8px;font-size:12px;" class="theme-transition">Loading...</div>';
    return;
  }
  const sortedKeys = Object.keys(rootTree).sort((a, b) => {
    if (rootPath === "__sednar_workspace__") {
      const aIndex = sednarWorkspaceRootOrder.indexOf(a);
      const bIndex = sednarWorkspaceRootOrder.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
    }
    const aIsFolder = rootTree[a].is_dir || rootTree[a].type === "folder";
    const bIsFolder = rootTree[b].is_dir || rootTree[b].type === "folder";
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b);
  });
  sortedKeys.forEach(name => {
    renderNode(rootTree[name], name, name, 0, rootPath, container);
  });
  _sednarSyncTreeActiveFile(container);
}

function _sednarSyncTreeActiveFile(container) {
  const tree = container || document.getElementById("ide-file-tree");
  if (!tree) return;
  tree.querySelectorAll(".file-item.is-active-file").forEach(function(row) {
    if (row.dataset.idePath !== ideActiveFile) row.classList.remove("is-active-file");
  });
  if (!ideActiveFile) return;
  tree.querySelectorAll(".file-item").forEach(function(row) {
    if (row.dataset.idePath === ideActiveFile) row.classList.add("is-active-file");
  });
}

const SEDNAR_PLAN_TAB_PREFIX = "plan://";
const SEDNAR_PLAN_MERMAID_PREFIX = "sednar-plan-mermaid-";

function _sednarPlanTabKey(planFile) {
  return SEDNAR_PLAN_TAB_PREFIX + planFile;
}

function _sednarIsPlanTabKey(key) {
  return String(key || "").indexOf(SEDNAR_PLAN_TAB_PREFIX) === 0;
}

function _sednarIsMarkdownFileName(name) {
  return /\.(md|markdown)$/i.test(String(name || ""));
}

function _sednarIsPlanFileName(name) {
  return /\.plan\.md$/i.test(String(name || ""));
}

function _sednarActiveFileInfo() {
  return ideActiveFile ? (ideOpenFiles[ideActiveFile] || null) : null;
}

function _sednarFileUsesPlanSurface(info) {
  if (!info) return false;
  if (info.isPlan) return true;

  return _sednarIsMarkdownFileName(info.name);
}

function _sednarHidePlanSurface() {
  const view = document.getElementById("ide-plan-view");
  if (view) {
    view.style.display = "none";
    view.classList.remove("is-monaco-source");
  }
  const monacoSurface = document.getElementById("ide-monaco");
  if (monacoSurface) monacoSurface.style.top = "0";
  _sednarClosePlanMenu();
}

let _sednarPlanSourceSaveTimer = null;
let _sednarPlanMonacoListenerBound = false;

function _sednarSyncPlanSourceFromEditor() {
  const info = _sednarActiveFileInfo();
  if (!info) return "";
  let next = null;
  if (info.viewMode === "markdown" && window.ideEditor) {
    try {
      const model = window.ideEditor.getModel();
      if (model && (!info.model || info.model === model)) {
        next = window.ideEditor.getValue();
      }
    } catch (e) {}
  }
  if (next == null) {
    const editor = document.getElementById("ide-plan-source-editor");
    if (!editor) return info.content || "";
    next = editor.value;
  }
  info.content = next;
  const original = info.originalContent || "";
  const isModified = next !== original;
  if (info.modified !== isModified) {
    info.modified = isModified;
    updateOpenFilesList();
  }
  return next;
}

function _sednarBindPlanMonacoAutosave() {
  if (_sednarPlanMonacoListenerBound || !window.ideEditor) return;
  _sednarPlanMonacoListenerBound = true;
  window.ideEditor.onDidChangeModelContent(function() {
    const info = _sednarActiveFileInfo();
    if (!info || info.viewMode !== "markdown" || !_sednarFileUsesPlanSurface(info)) return;
    _sednarSyncPlanSourceFromEditor();
    _sednarSchedulePlanSourceSave();
  });
}

function _sednarFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view) {
  if (view) view.classList.remove("is-monaco-source");
  if (monacoSurface) {
    monacoSurface.style.display = "none";
    monacoSurface.style.top = "0";
  }
  if (!body || !fileInfo) return false;
  body.classList.add("is-source");
  body.innerHTML = "";
  const editor = document.createElement("textarea");
  editor.id = "ide-plan-source-editor";
  editor.className = "ide-plan-source-editor theme-transition";
  editor.value = fileInfo.content || "";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Edit markdown");
  editor.addEventListener("input", function() {
    _sednarSyncPlanSourceFromEditor();
    _sednarSchedulePlanSourceSave();
  });
  editor.addEventListener("blur", function() {
    clearTimeout(_sednarPlanSourceSaveTimer);
    _sednarSyncPlanSourceFromEditor();
    _sednarSavePlanSourceContent(ideActiveFile, { silent: true });
  });
  body.appendChild(editor);
  requestAnimationFrame(function() {
    try { editor.focus(); } catch (e) {}
  });
  return false;
}

function _sednarFinishMountPlanMarkdownInMonaco(fileKey) {
  const fileInfo = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  const header = document.getElementById("ide-plan-header");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  const placeholder = document.getElementById("ide-editor-placeholder");
  if (!fileInfo || !view || !monacoSurface) return false;
  if (ideActiveFile !== fileKey || fileInfo.viewMode !== "markdown") return false;
  if (placeholder) placeholder.style.display = "none";
  if (body) {
    body.classList.remove("is-source");
    body.innerHTML = "";
  }
  view.classList.add("is-monaco-source");
  if (codeEditor) codeEditor.style.display = "none";
  if (!window.ideEditor || !window.monaco || !window.monaco.editor) {
    return _sednarFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
  }
  const top = header ? Math.max(header.offsetHeight, 38) : 38;
  monacoSurface.style.display = "block";
  monacoSurface.style.top = top + "px";
  monacoSurface.style.zIndex = "1";
  const detectedLang = typeof window.inferLangFromPath === "function"
    ? window.inferLangFromPath(fileInfo.name || fileKey)
    : "markdown";
  const monacoLang = typeof window.mapToMonacoLang === "function"
    ? window.mapToMonacoLang(detectedLang)
    : "markdown";
  if (!fileInfo.model) {
    try {
      const uri = (fileInfo.path || fileKey).startsWith("/")
        ? monaco.Uri.file(fileInfo.path || fileKey)
        : monaco.Uri.parse("inmemory://ide/" + encodeURIComponent(String(fileKey).replace(/^\/+/, "")));
      fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang, uri);
    } catch (e) {
      try {
        fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang);
      } catch (e2) {
        console.error("Sednar: could not create Monaco model for markdown", e2);
        return _sednarFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
      }
    }
  } else {
    try {
      if (fileInfo.model.getValue() !== (fileInfo.content || "")) {
        fileInfo.model.setValue(fileInfo.content || "");
      }
      monaco.editor.setModelLanguage(fileInfo.model, monacoLang);
    } catch (e) {}
  }
  try {
    window.ideEditor.setModel(fileInfo.model);
  } catch (e) {
    console.error("Sednar: setModel failed for plan markdown", e);
    return _sednarFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
  }
  _sednarBindPlanMonacoAutosave();
  requestAnimationFrame(function() {
    try {
      window.ideEditor.layout();
      window.ideEditor.focus();
    } catch (e) {}
  });
  return true;
}

function _sednarMountPlanMarkdownInMonaco(fileKey) {
  const fileInfo = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  const monacoSurface = document.getElementById("ide-monaco");
  if (!fileInfo || !view || !monacoSurface) return false;
  if (body) {
    body.classList.remove("is-source");
    body.innerHTML = "";
  }
  view.classList.add("is-monaco-source");
  if (!window.ideEditor) {
    try { initializeIDEEditor(); } catch (e) {
      console.error("Sednar: Monaco init failed for plan markdown", e);
    }
  }
  if (window.ideEditor) {
    return _sednarFinishMountPlanMarkdownInMonaco(fileKey);
  }

  let tries = 0;
  const wait = setInterval(function() {
    tries += 1;
    if (window.ideEditor) {
      clearInterval(wait);
      _sednarFinishMountPlanMarkdownInMonaco(fileKey);
      return;
    }
    if (tries >= 50) {
      clearInterval(wait);
      _sednarFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
    }
  }, 100);
  return false;
}

function _sednarSavePlanSourceContent(fileKey, options) {
  const opts = options || {};
  const key = fileKey || ideActiveFile;
  const info = key ? ideOpenFiles[key] : null;
  if (!info) return Promise.resolve(false);
  const content = opts.content != null ? String(opts.content) : (info.content || "");
  if (content === (info.originalContent || "") && !opts.force) {
    info.modified = false;
    return Promise.resolve(true);
  }
  if (info.isPlan && info.planFile) {
    return fetch("/sednar/plan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: info.planFile,
        content: content,
        title: info.title || info.name || "",
      }),
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) throw new Error((data && data.error) || "Save failed");
        info.content = data.content != null ? data.content : content;
        info.originalContent = info.content;
        info.modified = false;
        if (data.title) info.title = data.title;
        updateOpenFilesList();
        if (!opts.silent) _sednarSetPlanStatus("Plan saved");
        return true;
      })
      .catch(function(err) {
        console.error("Sednar: plan save failed", err);
        if (!opts.silent) _sednarSetPlanStatus("Save failed: " + (err.message || err));
        return false;
      });
  }
  if (!info.path || _sednarIsPlanTabKey(info.path)) {
    info.content = content;
    info.originalContent = content;
    info.modified = false;
    updateOpenFilesList();
    return Promise.resolve(true);
  }
  return _sednarIdeSocketRequest(
    "ide_write_file", { path: info.path, content: content },
    "ide_file_saved",
    function(data) { return data && data.path === info.path; }
  ).then(function(result) {
    const data = result.data;
    if (data && data.error) {
      console.error("Sednar: markdown save failed", data.error);
      if (!opts.silent) _sednarSetPlanStatus("Save failed: " + data.error);
      return false;
    }
    info.content = content;
    info.originalContent = content;
    info.modified = false;
    updateOpenFilesList();
    if (!opts.silent) _sednarSetPlanStatus("Saved");
    return true;
  });
}

function _sednarSchedulePlanSourceSave() {
  clearTimeout(_sednarPlanSourceSaveTimer);
  _sednarPlanSourceSaveTimer = setTimeout(function() {
    _sednarSyncPlanSourceFromEditor();
    _sednarSavePlanSourceContent(ideActiveFile, { silent: true });
  }, 800);
}

function _sednarRenderPlanMarkdownLikeChat(body, markdown) {
  body.innerHTML = "";
  const doc = document.createElement("div");
  doc.className = "sednar-plan-md";
  body.appendChild(doc);
  const text = String(markdown || "");
  if (!text.trim()) {
    doc.innerHTML = '<p style="opacity:0.4;font-style:italic;">No content.</p>';
    return;
  }
  const diagrams = [];
  const source = text.replace(/```\s*mermaid\s*\n([\s\S]*?)```/gi, function(_m, code) {
    diagrams.push(String(code).trim());
    return "\n\n%%SEDNAR_PLAN_MERMAID_" + (diagrams.length - 1) + "%%\n\n";
  });
  window.mountSednarChatMarkdown(doc, source, { sednar: true, persistRaw: false, keepTableTitle: true });
  doc.querySelectorAll('a[href]').forEach(function(a) {
    const href = String(a.getAttribute("href") || "").trim();
    const target = href.replace(/#L?(\d+).*$/i, "");
    const lineMatch = href.match(/#L?(\d+)/i) || target.match(/:(\d+)$/);
    const path = target.replace(/:\d+$/, "");
    if (path && !/^[a-z][\w+.-]*:/i.test(path) && _sednarLooksLikeFilePath(path)) {
      const link = document.createElement("span");
      link.className = "sednar-md-file-link sednar-plan-file-link";
      link.setAttribute("data-file-path", _sednarResolveProjectFilePath(path));
      if (lineMatch) link.setAttribute("data-line-meta", "L" + lineMatch[1]);
      link.setAttribute("role", "link");
      link.setAttribute("tabindex", "0");
      link.setAttribute("title", path);
      link.textContent = a.textContent;
      a.replaceWith(link);
    } else {
      a.replaceWith(document.createTextNode(a.textContent));
    }
  });
  _sednarDecorateFileCodeSpans(doc);
  if (!diagrams.length) return;
  doc.querySelectorAll("p").forEach(function(p) {
    const hit = /^%%SEDNAR_PLAN_MERMAID_(\d+)%%$/.exec(p.textContent.trim());
    if (!hit) return;
    const wrap = document.createElement("div");
    wrap.className = "mermaid-container";
    const node = document.createElement("div");
    node.className = "mermaid";
    node.id = SEDNAR_PLAN_MERMAID_PREFIX + "src-" + hit[1];
    node.textContent = diagrams[Number(hit[1])];
    wrap.appendChild(node);
    p.replaceWith(wrap);
  });
  if (typeof _mdpdfRenderMermaidDiagrams === "function") {
    body._mdpdfMermaidPromise = _mdpdfRenderMermaidDiagrams(doc, SEDNAR_PLAN_MERMAID_PREFIX, SEDNAR_PLAN_MERMAID_PREFIX, false, _sednarPlanMermaidThemeVariables());
  }
}

function _sednarPlanMermaidThemeVariables() {
  const view = document.getElementById("ide-plan-view");
  if (!view) return {};
  const styles = getComputedStyle(view);
  const fg = (styles.getPropertyValue("--lc-fg") || "").trim().split(/\s+/).join(", ");
  if (!fg) return {};
  const bg = (styles.getPropertyValue("--lc-bg") || "").trim() || "transparent";
  const surface = (styles.getPropertyValue("--lc-bubble-bg") || "").trim() || bg;
  const text = "rgb(" + fg + ")";
  const muted = "rgba(" + fg + ", 0.7)";
  const border = "rgba(" + fg + ", 0.28)";
  const faint = "rgba(" + fg + ", 0.08)";
  return {
    background: "transparent",
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: border,
    lineColor: muted,
    secondaryColor: faint,
    tertiaryColor: surface,
    clusterBkg: faint,
    clusterBorder: border,
    edgeLabelBackground: bg,
    textColor: text,
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: border,
    signalColor: muted,
    signalTextColor: text,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: surface,
    noteBorderColor: border,
    noteTextColor: text
  };
}

let _sednarPlanThemeObserver = null;
function _sednarWatchPlanTheme() {
  if (_sednarPlanThemeObserver || typeof MutationObserver === "undefined") return;
  const currentTheme = function() {
    return ["dark-theme", "white-theme", "pink-theme", "black-theme"].filter(function(c) {
      return document.body.classList.contains(c);
    }).join(" ");
  };
  let lastTheme = currentTheme();
  _sednarPlanThemeObserver = new MutationObserver(function() {
    const theme = currentTheme();
    if (theme === lastTheme) return;
    lastTheme = theme;
    const info = ideActiveFile ? ideOpenFiles[ideActiveFile] : null;
    if (info && info.isPlan) _sednarRenderPlanSurface(ideActiveFile);
  });
  _sednarPlanThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

function _sednarRenderPlanSurface(fileKey) {
  _sednarWatchPlanTheme();
  const info = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  if (!info || !view || !body) return false;
  const placeholder = document.getElementById("ide-editor-placeholder");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  if (placeholder) placeholder.style.display = "none";
  if (codeEditor) codeEditor.style.display = "none";
  view.style.display = "flex";

  const rootEl = document.getElementById("ide-plan-breadcrumb-root");
  const nameEl = document.getElementById("ide-plan-name");
  if (rootEl) rootEl.textContent = info.isPlan ? "Plans" : (sednarProjectName || "Workspace");
  if (nameEl) nameEl.textContent = info.name || "";
  _sednarSetPlanStatus("");

  const markdown = info.content || "";
  if (info.viewMode === "markdown") {
    _sednarMountPlanMarkdownInMonaco(fileKey);
  } else {
    view.classList.remove("is-monaco-source");
    if (monacoSurface) {
      monacoSurface.style.display = "none";
      monacoSurface.style.top = "0";
    }
    body.classList.remove("is-source");
    if (typeof window.mountSednarChatMarkdown === "function") {
      _sednarRenderPlanMarkdownLikeChat(body, info.isPlan ? _sednarPlanMarkdownWithoutChecklist(markdown) : markdown);
      if (info.isPlan) _sednarMountPlanTodos(body, fileKey);
    } else if (typeof window.renderMarkdownLikeMdpdfPreview === "function") {
      window.renderMarkdownLikeMdpdfPreview(body, markdown, SEDNAR_PLAN_MERMAID_PREFIX);
    } else if (typeof window.renderMarkdownInElement === "function") {
      window.renderMarkdownInElement(body, markdown);
    } else {
      body.textContent = markdown;
    }
    body.scrollTop = 0;
  }
  updateIdePlanChrome();
  return true;
}

function _sednarSetPlanStatus(message) {
  const el = document.getElementById("ide-plan-status");
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.style.display = "inline-flex";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(function() {
    el.style.display = "none";
    el.textContent = "";
  }, 4000);
}

function updateIdePlanChrome() {
  const info = _sednarActiveFileInfo();
  const isPlan = !!(info && (info.isPlan || _sednarIsPlanFileName(info.name)));
  const buildBtn = document.getElementById("ide-plan-build");
  if (buildBtn) buildBtn.style.display = isPlan ? "inline-flex" : "none";
  if (isPlan) _sednarSyncPlanHeaderBuildButton();
  const previewBtn = document.getElementById("ide-md-preview-button");

  if (previewBtn) previewBtn.style.display = "none";
  const menu = document.getElementById("ide-plan-menu");
  if (menu && menu.style.display !== "none") _sednarRenderPlanMenu();
}

window.openSednarPlanTab = function(planFile, title, options) {
  const file = String(planFile || "").trim();
  if (!file) return Promise.resolve(false);
  const opts = options || {};
  const key = _sednarPlanTabKey(file);
  return fetch("/sednar/plan-content?file=" + encodeURIComponent(file))
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "Plan not found");
      const existing = ideOpenFiles[key];
      const content = data.content || "";
      ideOpenFiles[key] = {
        isPlan: true,
        planFile: file,
        path: key,
        name: file,
        title: data.title || title || file,
        content: content,
        originalContent: content,
        modified: false,
        viewMode: (existing && existing.viewMode) || "preview",
      };
      if (opts.activate === false && ideActiveFile !== key) {
        updateOpenFilesList();
      } else {
        switchToFile(key);
      }
      updatePlayButtonVisibility();
      if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
      return true;
    })
    .catch(function(err) {
      console.error("Sednar: could not open plan", file, err);
      return false;
    });
};

window.setSednarPlanViewMode = function(mode) {
  const info = _sednarActiveFileInfo();
  if (!info) return;
  clearTimeout(_sednarPlanSourceSaveTimer);
  _sednarSyncPlanSourceFromEditor();
  const next = mode === "markdown" ? "markdown" : "preview";
  const finish = function() {
    info.viewMode = next;
    _sednarClosePlanMenu();
    const planBody = document.getElementById("ide-plan-body");
    const planView = document.getElementById("ide-plan-view");
    if (planBody) planBody.style.transition = "none";
    if (planView) planView.style.transition = "none";
    switchToFile(ideActiveFile);
    requestAnimationFrame(function() {
      if (planBody) planBody.style.transition = "";
      if (planView) planView.style.transition = "";
    });
  };
  if (info.modified) {
    _sednarSavePlanSourceContent(ideActiveFile, { silent: true }).then(finish);
  } else {
    finish();
  }
};

window.toggleSednarMarkdownPreview = function() {
  const info = _sednarActiveFileInfo();
  if (!info || !_sednarIsMarkdownFileName(info.name)) return;
  window.setSednarPlanViewMode(info.viewMode === "preview" ? "markdown" : "preview");
};

function _sednarRenderPlanMenu() {
  const menu = document.getElementById("ide-plan-menu");
  const info = _sednarActiveFileInfo();
  if (!menu || !info) return;
  const mode = info.viewMode === "markdown" ? "markdown" : "preview";
  const check = '<svg class="ide-plan-menu-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const modeItem = function(value, label) {
    return '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitemradio" aria-checked="'
      + (mode === value) + '" onclick="setSednarPlanViewMode(\'' + value + '\'); return false;">'
      + '<span>' + label + '</span>' + (mode === value ? check : "") + "</button>";
  };
  let html = '<div class="ide-plan-menu-label">Editor Mode</div>';
  html += modeItem("preview", "Preview");
  html += modeItem("markdown", "Markdown");
  html += '<div class="ide-plan-menu-sep"></div>';
  if (info.isPlan) {
    html += '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitem" onclick="saveSednarPlanToWorkspace(); return false;"><span>Save to Workspace</span></button>';
  }
  html += '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitem" onclick="downloadSednarMarkdownPdf(); return false;"><span>Download PDF</span></button>';
  menu.innerHTML = html;
}

function _sednarClosePlanMenu() {
  const menu = document.getElementById("ide-plan-menu");
  const btn = document.getElementById("ide-plan-menu-btn");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

window.toggleSednarPlanMenu = function(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById("ide-plan-menu");
  const btn = document.getElementById("ide-plan-menu-btn");
  if (!menu || !btn) return;
  if (menu.style.display === "block") {
    _sednarClosePlanMenu();
    return;
  }
  _sednarRenderPlanMenu();
  menu.style.display = "block";
  btn.setAttribute("aria-expanded", "true");
  if (!window._sednarPlanMenuGlobalBound) {
    window._sednarPlanMenuGlobalBound = true;
    document.addEventListener("click", function(e) {
      const open = document.getElementById("ide-plan-menu");
      if (!open || open.style.display !== "block") return;
      if (e.target.closest("#ide-plan-menu") || e.target.closest("#ide-plan-menu-btn")) return;
      _sednarClosePlanMenu();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") _sednarClosePlanMenu();
    });
  }
};

window.saveSednarPlanToWorkspace = function() {
  const info = _sednarActiveFileInfo();
  if (!info || !info.isPlan || !info.planFile) return;
  if (!sednarProjectPath) {
    _sednarSetPlanStatus("Open a project folder first");
    return;
  }
  _sednarClosePlanMenu();
  clearTimeout(_sednarPlanSourceSaveTimer);
  _sednarSyncPlanSourceFromEditor();
  const doSave = function() {
    fetch("/sednar/plan/save-to-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: info.planFile, project_path: sednarProjectPath }),
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) throw new Error((data && data.error) || "Save failed");
        _sednarSetPlanStatus("Saved to " + data.relative_path);
        if (sednarProjectPath) loadIDEFileTree(sednarProjectPath);
      })
      .catch(function(err) {
        _sednarSetPlanStatus("Save failed: " + (err.message || err));
      });
  };
  _sednarSavePlanSourceContent(ideActiveFile, { silent: true }).then(doSave);
};

window.downloadSednarMarkdownPdf = function() {
  const info = _sednarActiveFileInfo();
  if (!info) return;
  _sednarClosePlanMenu();
  if (typeof window.downloadMarkdownAsPdf !== "function") return;

  if (info.viewMode === "markdown") {
    info.viewMode = "preview";
    _sednarRenderPlanSurface(ideActiveFile);
  }
  const body = document.getElementById("ide-plan-body");
  if (!body) return;
  const fileName = String(info.name || "document").replace(/\.(plan\.md|md|markdown)$/i, "") + ".pdf";
  window.downloadMarkdownAsPdf(body, fileName);
};

window.buildSednarPlan = function() {
  const info = _sednarActiveFileInfo();
  if (!info || !info.isPlan || !info.planFile) return;
  if (!sednarProjectPath) {
    _sednarSetPlanStatus("Open a project folder first");
    return;
  }
  const tab = _sednarGetActiveChatTab();
  if (tab && tab.agentRunning) {
    _sednarSetPlanStatus("Agent is still running");
    return;
  }
  clearTimeout(_sednarPlanSourceSaveTimer);
  _sednarSyncPlanSourceFromEditor();
  const startBuild = function() {
    _sednarStartPlanBuild(info.planFile, info.title || info.name);
  };
  _sednarSavePlanSourceContent(ideActiveFile, { silent: true, force: !!info.modified }).then(function(ok) {
    if (info.modified && !ok) {
      _sednarSetPlanStatus("Save plan edits before building");
      return;
    }
    startBuild();
  });
};

document.addEventListener("keydown", function(e) {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
  const view = document.getElementById("ide-plan-view");
  if (!view || view.style.display === "none") return;
  const info = _sednarActiveFileInfo();
  if (!info || !info.isPlan) return;
  if (e.target && e.target.closest && e.target.closest(".chatbot-composer")) return;
  e.preventDefault();
  window.buildSednarPlan();
});

let _sednarIdeToastEl = null;
let _sednarIdeToastTimer = null;

function _sednarShowIdeToast(message) {
  if (!_sednarIdeToastEl) {
    _sednarIdeToastEl = document.createElement("div");
    _sednarIdeToastEl.className = "sednar-toast theme-transition";
    _sednarIdeToastEl.setAttribute("role", "status");
    _sednarIdeToastEl.style.position = "fixed";
    _sednarIdeToastEl.style.top = "auto";
    _sednarIdeToastEl.style.right = "auto";
    _sednarIdeToastEl.style.bottom = "20px";
    _sednarIdeToastEl.style.left = "50%";
    _sednarIdeToastEl.style.transform = "translateX(-50%)";
    _sednarIdeToastEl.style.zIndex = "10060";
    _sednarIdeToastEl.style.maxWidth = "60vw";
    _sednarIdeToastEl.style.fontSize = "12px";
    _sednarIdeToastEl.style.fontWeight = "600";
    _sednarIdeToastEl.style.display = "none";
    document.body.appendChild(_sednarIdeToastEl);
  }
  if (!_sednarIdeToastEl.isConnected) document.body.appendChild(_sednarIdeToastEl);
  _sednarIdeToastEl.textContent = message;
  _sednarIdeToastEl.style.display = "flex";
  if (_sednarIdeToastTimer) clearTimeout(_sednarIdeToastTimer);
  _sednarIdeToastTimer = setTimeout(function() {
    if (_sednarIdeToastEl) _sednarIdeToastEl.style.display = "none";
  }, 4000);
}

function _sednarNormalizeLineNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function _sednarRevealEditorLine(lineNumber) {
  const line = _sednarNormalizeLineNumber(lineNumber);
  if (!line) return;
  if (window.ideEditor) {
    try {
      window.ideEditor.setPosition({ lineNumber: line, column: 1 });
      window.ideEditor.revealLineInCenter(line);
      window.ideEditor.focus();
      return;
    } catch (_) {}
  }
  const codeEditor = document.getElementById("ide-code-editor");
  if (codeEditor && codeEditor.style.display !== "none") {
    const lines = String(codeEditor.value || "").split("\n");
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    codeEditor.focus();
    try { codeEditor.setSelectionRange(offset, offset); } catch (_) {}
  }
}

function openFileInEditorFromPath(filePath, options) {
  const opts = options || {};
  if (ideOpenFiles[filePath]) {
    switchToFile(filePath, opts);
    return;
  }
  _sednarIdeSocketRequest(
    "ide_read_file", { path: filePath },
    "ide_file_content",
    function(data) { return data && data.path === filePath; }
  ).then(function(result) {
    const data = result.data;
    if (data.error) {
      console.error("Error reading file:", data.error);
      _sednarShowIdeToast(
        result.error === "timeout"
          ? "Timed out opening " + filePath.split("/").pop()
          : "Couldn't open " + filePath.split("/").pop() + ": " + data.error
      );
      return;
    }
    const content = data.content || "";
    const fileName = filePath.split("/").pop();
    ideOpenFiles[filePath] = {
      content: content,
      path: filePath,
      name: fileName,
      modified: false,
      originalContent: content,
      readOnlyLarge: !!data.large_file,
    };
    if (data.large_file) {
      _sednarShowIdeToast("Large file opened read-only: " + fileName);
    }
    switchToFile(filePath, opts);
    updatePlayButtonVisibility();
    if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
    if (opts && opts.lineNumber) {
      _sednarRevealEditorLine(opts.lineNumber);
    }
  });
}

function _sednarUpdateOpenFileTabBadge(filePath) {
  const filesList = document.getElementById("ide-open-files-list");
  if (!filesList) return;
  const file = ideOpenFiles[filePath];
  if (!file) return;
  const item = Array.from(filesList.querySelectorAll(".ide-open-file-item")).find(function(el) {
    return el.dataset.path === filePath;
  });
  if (!item) {
    updateOpenFilesList(true);
    return;
  }
  item.classList.toggle("active", ideActiveFile === filePath);
  item.classList.toggle("is-dirty", !!file.modified);
}

function updateOpenFilesList(forceRebuild) {
  _sednarSyncTreeActiveFile();
  const filesList = document.getElementById("ide-open-files-list");
  if (!filesList) return;
  const openPaths = Object.keys(ideOpenFiles);
  if (openPaths.length === 0) {
    filesList.innerHTML = "";
    filesList.style.display = "none";
    return;
  }
  filesList.style.display = "flex";
  if (!forceRebuild) {
    const existingItems = filesList.querySelectorAll(".ide-open-file-item");
    if (existingItems.length === openPaths.length) {
      const existingPaths = new Set(Array.from(existingItems).map(function(el) { return el.dataset.path; }));
      if (openPaths.every(function(p) { return existingPaths.has(p); })) {
        openPaths.forEach(function(filePath) {
          _sednarUpdateOpenFileTabBadge(filePath);
        });
        return;
      }
    }
  }
  filesList.innerHTML = "";
  openPaths.forEach(filePath => {
    const file = ideOpenFiles[filePath];
    const isActive = ideActiveFile === filePath;
    const fileItem = document.createElement("div");
    fileItem.className = `ide-open-file-item theme-transition${isActive ? " active" : ""}`;
    fileItem.style.cssText = "cursor:pointer;display:flex;align-items:center;white-space:nowrap;user-select:none;";
    fileItem.dataset.path = filePath;
    const iconPath = file.isSettings ? _SEDNAR_SETTINGS_TAB_ICON : _sednarFileIcon(file.name);
    const iconImg = document.createElement("img");
    iconImg.src = iconPath;
    iconImg.alt = "File";
    iconImg.style.cssText = "width:16px;height:16px;flex-shrink:0;display:block;";
    iconImg.onerror = function() {
      this.src = _sednarFileIcon("");
      this.onerror = null;
    };
    const fileNameSpan = document.createElement("span");
    fileNameSpan.textContent = file.name;
    fileNameSpan.className = "ide-open-file-label theme-transition";
    if (file.modified) fileItem.classList.add("is-dirty");
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = _sednarIcon("x", { size: "lg" });
    closeBtn.className = "ide-file-close theme-transition";
    closeBtn.title = "Close";
    closeBtn.onclick = e => {
      e.stopPropagation();
      closeFile(filePath);
    };
    fileItem.appendChild(iconImg);
    fileItem.appendChild(fileNameSpan);
    fileItem.appendChild(closeBtn);
    fileItem.onclick = () => switchToFile(filePath);
    filesList.appendChild(fileItem);
  });
}

function switchToFile(filePath, options) {
  if (!ideOpenFiles[filePath]) return;
  const opts = options || {};
  if (ideOpenFiles[filePath].isSettings) {
    ideActiveFile = filePath;
    _sednarShowSettingsSurface();
    updateOpenFilesList();
    updatePlayButtonVisibility();
    if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
    return;
  }
  _sednarHideSettingsSurface();
  if (_sednarFileUsesPlanSurface(ideOpenFiles[filePath])) {
    ideActiveFile = filePath;
    _sednarRenderPlanSurface(filePath);
    updateOpenFilesList();
    if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
    return;
  }
  _sednarHidePlanSurface();
  const placeholder = document.getElementById("ide-editor-placeholder");
  const codeEditor = document.getElementById("ide-code-editor");
  if (placeholder) placeholder.style.display = "none";
  const monacoSurface = document.getElementById("ide-monaco");
  if (monacoSurface && window.ideEditor && window.monaco && window.monaco.editor) {
    if (codeEditor) codeEditor.style.display = "none";
    monacoSurface.style.display = "block";
    const fileInfo = ideOpenFiles[filePath];
    const detectedLang = typeof window.inferLangFromPath === "function" ? window.inferLangFromPath(fileInfo.name || filePath) : "text";
    let monacoLang = typeof window.mapToMonacoLang === "function" ? window.mapToMonacoLang(detectedLang) : "plaintext";
    if (fileInfo.readOnlyLarge) {
      monacoLang = "plaintext";
    }
    if (!fileInfo.model) {
      try {
        const uri = filePath.startsWith("/")
          ? monaco.Uri.file(filePath)
          : monaco.Uri.parse("inmemory://ide/" + encodeURIComponent(filePath.replace(/^\/+/, "")));
        const existing = monaco.editor.getModel(uri);
        if (existing) {
          fileInfo.model = existing;
          if (existing.getValue() !== (fileInfo.content || "")) {
            existing.setValue(fileInfo.content || "");
          }
          if (existing.getLanguageId() !== monacoLang) {
            try { monaco.editor.setModelLanguage(existing, monacoLang); } catch (_) {}
          }
        } else {
          fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang, uri);
        }
      } catch (e) {
        try {
          fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang);
        } catch (e2) {
          if (codeEditor) {
            codeEditor.style.display = "block";
            codeEditor.value = fileInfo.content || "";
            codeEditor.readOnly = !!fileInfo.readOnlyLarge;
            return;
          }
        }
      }
    } else {
      const modelContent = fileInfo.model.getValue();
      const desiredContent = fileInfo.content || "";
      if (modelContent !== desiredContent) {
        fileInfo.model.setValue(desiredContent);
      }
      if (fileInfo.model.getLanguageId() !== monacoLang) {
        try {
          monaco.editor.setModelLanguage(fileInfo.model, monacoLang);
        } catch (e) {}
      }
    }
    try {
      window.ideEditor.setModel(fileInfo.model);
      window.ideEditor.updateOptions({ readOnly: !!fileInfo.readOnlyLarge });
      try { if (window.WBLsp && !fileInfo.readOnlyLarge) window.WBLsp.onFileOpened(filePath, fileInfo.model); } catch (_) {}
      requestAnimationFrame(function() {
        try { window.ideEditor.layout(); } catch (_) {}
      });
    } catch (e) {
      if (codeEditor) {
        codeEditor.style.display = "block";
        codeEditor.value = fileInfo.content || "";
        codeEditor.readOnly = !!fileInfo.readOnlyLarge;
        return;
      }
    }
  } else if (monacoSurface) {
    if (codeEditor) {
      codeEditor.style.display = "block";
      const fileInfo = ideOpenFiles[filePath];
      codeEditor.value = fileInfo.content || "";
      codeEditor.readOnly = !!fileInfo.readOnlyLarge;
    }
    _sednarUpgradeEditorToMonacoWhenReady(filePath);
  } else if (codeEditor) {
    codeEditor.style.display = "block";
    const fileInfo = ideOpenFiles[filePath];
    codeEditor.value = fileInfo.content || "";
    codeEditor.readOnly = !!fileInfo.readOnlyLarge;
  }
  ideActiveFile = filePath;
  updateOpenFilesList();
  updatePlayButtonVisibility();
  if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
  if (opts && opts.lineNumber) {
    _sednarRevealEditorLine(opts.lineNumber);
  }
}

let _sednarMonacoUpgradeTimer = null;

function _sednarUpgradeEditorToMonacoWhenReady(filePath) {
  function _mountNow() {
    const target = (ideActiveFile && ideOpenFiles[ideActiveFile]) ? ideActiveFile : filePath;
    if (ideOpenFiles[target] && !_sednarFileUsesPlanSurface(ideOpenFiles[target])) {
      switchToFile(target);
    }
  }
  if (!window.ideEditor) {
    try { initializeIDEEditor(); } catch (e) { console.error("Sednar: Monaco init failed", e); }
  }
  if (window.ideEditor && window.monaco && window.monaco.editor) {
    _mountNow();
    return;
  }
  if (_sednarMonacoUpgradeTimer) return;
  let tries = 0;
  _sednarMonacoUpgradeTimer = setInterval(function() {
    tries += 1;
    if (window.ideEditor && window.monaco && window.monaco.editor) {
      clearInterval(_sednarMonacoUpgradeTimer);
      _sednarMonacoUpgradeTimer = null;
      _mountNow();
    } else if (tries >= 100) {
      clearInterval(_sednarMonacoUpgradeTimer);
      _sednarMonacoUpgradeTimer = null;
    }
  }, 100);
}

function autoSaveIDEFile(filePath) {
  if (!filePath || !ideOpenFiles[filePath] || !window.ideEditor) {
    return;
  }
  const file = ideOpenFiles[filePath];
  if (file.readOnlyLarge || file.isSettings) return;

  if (_sednarFileUsesPlanSurface(file) && file.viewMode === "markdown") {
    _sednarSyncPlanSourceFromEditor();
    _sednarSavePlanSourceContent(filePath, { silent: true });
    return;
  }
  const content = window.ideEditor.getValue();
  if (content === file.originalContent) {
    return;
  }
  _sednarIdeSocketRequest(
    "ide_write_file", { path: file.path, content: content },
    "ide_file_saved",
    function(data) { return data && data.path === file.path; }
  ).then(function(result) {
    const data = result.data;
    if (data.error) {
      console.error("Auto-save error:", data.error);
      if (result.error) _sednarShowIdeToast("Auto-save failed for " + (file.name || file.path.split("/").pop()));
    } else {
      file.originalContent = content;
      file.modified = false;
      _sednarUpdateOpenFileTabBadge(filePath);
    }
  });
}

function showIDEPanel(panelName) {
  const recentBtn = document.getElementById("ide-activity-recent");
  if (recentBtn) {
    const recentActive = panelName === "recent" || panelName === "settings";
    recentBtn.classList.toggle("active", recentActive);
    recentBtn.setAttribute("aria-pressed", recentActive ? "true" : "false");
  }
  const explorerPanel = document.getElementById("ide-explorer-panel");
  const recentPanel = document.getElementById("ide-recent-panel");
  const panelContent = document.getElementById("ide-panel-content");
  if (explorerPanel) explorerPanel.style.display = "none";
  if (recentPanel) recentPanel.style.display = "none";
  if (panelName === "explorer") {
    if (explorerPanel) explorerPanel.style.display = "block";
    if (recentPanel) recentPanel.style.display = "none";
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
  } else if (panelName === "recent" || panelName === "settings") {
    if (explorerPanel) explorerPanel.style.display = "none";
    if (recentPanel) {
      recentPanel.style.display = "block";
      renderSednarRecentProjects();
    }
    if (panelContent) {
      panelContent.style.overflowX = "hidden";
      panelContent.style.overflowY = "auto";
    }
  } else {
    if (explorerPanel) explorerPanel.style.display = "block";
    if (recentPanel) recentPanel.style.display = "none";
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
  }
}

function closeFile(filePath) {
  if (!ideOpenFiles[filePath]) return;
  try { if (window.WBLsp) window.WBLsp.onFileClosed(filePath); } catch (e) {}
  delete ideOpenFiles[filePath];
  updateOpenFilesList();
  const openPaths = Object.keys(ideOpenFiles);
  if (openPaths.length > 0) {
    switchToFile(openPaths[openPaths.length - 1]);
  } else {
    showSednarEditorIdle();
  }
  updatePlayButtonVisibility();
  if (sednarProjectPath) _sednarPersistEditorTabsDebounced(sednarProjectPath);
}

let ideContextMenuTarget = null;

function _sednarToRepoPath(absPath) {
  const project = sednarProjectPath || "";
  if (!project || !absPath) return "";
  const norm = function(p) { return String(p || "").replace(/\\/g, "/"); };
  let rel = norm(absPath);
  const root = norm(project).replace(/\/$/, "");
  if (rel === root) return "";
  if (rel.startsWith(root + "/")) rel = rel.slice(root.length + 1);
  return rel;
}

function _sednarWorkspaceRepoPath(path) {
  const full = _sednarNormalizePath(path);
  const folders = sednarWorkspaceFolders.length
    ? sednarWorkspaceFolders
    : (
        sednarProjectPath
          ? [{
              name: _sednarFolderNameFromPath(sednarProjectPath),
              path: sednarProjectPath
            }]
          : []
      );

  const matches = folders.map(function(folder) {
    const root = _sednarNormalizePath((folder || {}).path);
    return { folder: folder || {}, root: root };
  }).filter(function(item) {
    return item.root && (full === item.root || full.startsWith(item.root + "/"));
  }).sort(function(a, b) {
    return b.root.length - a.root.length;
  });

  if (!matches.length) return _sednarToRepoPath(path);

  const match = matches[0];
  const rel = full === match.root ? "" : full.slice(match.root.length + 1);
  if (folders.length <= 1) return rel;

  const name = String(
    match.folder.name || _sednarFolderNameFromPath(match.root)
  ).trim();
  return rel ? name + "/" + rel : name;
}

let _sednarFsClipboard = null;

function _sednarSyncCutMarks() {
  const cutPath = _sednarFsClipboard && _sednarFsClipboard.mode === "move" ? _sednarFsClipboard.path : null;
  document.querySelectorAll("[data-ide-path]").forEach(function(el) {
    el.classList.toggle("ide-cut-pending", cutPath !== null && el.dataset.idePath === cutPath);
  });
}

const _IDE_CTX_ICONS = {
  open: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
  newFile: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
  newFolder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
  cut: '<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
  path: '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
  reveal: '<path d="M4 9V6.47214C4 6.16165 4.07229 5.85542 4.21115 5.57771L5 4H10L11 6H21C21.5523 6 22 6.44772 22 7V9V18C22 19.1046 21.1046 20 20 20H18"></path><path d="M17.2362 9H2.30925C1.64988 9 1.17099 9.62698 1.34449 10.2631L3.59806 18.5262C3.83537 19.3964 4.62569 20 5.52759 20H19.6908C20.3501 20 20.829 19.373 20.6555 18.7369L18.201 9.73688C18.0823 9.30182 17.6872 9 17.2362 9Z"></path>',
  rename: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"></path>',
  trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
  workspace: '<path d="M3 6h18"></path><path d="M3 12h18"></path><path d="M3 18h18"></path><path d="M7 3v18"></path>',
};

function _ideCtxIcon(name) {
  const body = _IDE_CTX_ICONS[name] || _IDE_CTX_ICONS.file;
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

function _ideCtxItemHtml(icon, label, action, opts) {
  const o = opts || {};
  if (o.disabled) {
    return '<div class="ide-context-menu-item is-disabled" aria-disabled="true">' + _ideCtxIcon(icon) + '<span>' + label + '</span></div>';
  }
  const cls = o.danger ? "ide-context-menu-item is-danger" : "ide-context-menu-item";
  return '<div class="' + cls + '" onclick="ideContextMenuAction(\'' + action + '\');">' + _ideCtxIcon(icon) + '<span>' + label + '</span></div>';
}

function _ideCtxSeparator() {
  return '<div class="ide-context-menu-separator" role="separator"></div>';
}

function showIDEContextMenu(e, itemPath, itemName, isDir) {
  const contextMenu = document.getElementById("ide-context-menu");
  if (!contextMenu) return;
  e.preventDefault();
  e.stopPropagation();
  const repoPath = _sednarWorkspaceRepoPath(itemPath);
  const workspaceRootIndex = isDir ? _sednarWorkspaceFolderIndexByPath(itemPath) : -1;
  ideContextMenuTarget = {
    path: itemPath,
    repoPath: repoPath,
    name: itemName,
    isDir: !!isDir,
    workspaceRootIndex: workspaceRootIndex,
  };
  const clip = _sednarFsClipboard;
  const pasteDisabled = !clip;
  const pasteLabel = "Paste";
  const rows = [];
  if (isDir) {
    if (workspaceRootIndex > 0) {
      rows.push(_ideCtxItemHtml("workspace", "Make primary", "workspace-make-primary"));
    }
    if (workspaceRootIndex >= 0 && sednarWorkspaceFolders.length > 1) {
      rows.push(_ideCtxItemHtml("close", "Remove from workspace", "workspace-remove-folder"));
    }
    if (workspaceRootIndex >= 0) {
      rows.push(_ideCtxSeparator());
    }
    rows.push(_ideCtxItemHtml("folder", "Add folder to chat", "add-folder-to-chat"));
    rows.push(_ideCtxItemHtml("chat", "Add to new Chat", "add-to-new-chat"));
    rows.push(_ideCtxSeparator());
    rows.push(_ideCtxItemHtml("newFile", "New File…", "new-file"));
    rows.push(_ideCtxItemHtml("newFolder", "New Folder…", "new-folder"));
    rows.push(_ideCtxSeparator());
  } else {
    rows.push(_ideCtxItemHtml("open", "Open", "open-file"));
    rows.push(_ideCtxItemHtml("file", "Add file to chat", "add-file-to-chat"));
    rows.push(_ideCtxItemHtml("chat", "Add to new Chat", "add-to-new-chat"));
    rows.push(_ideCtxSeparator());
  }
  rows.push(_ideCtxItemHtml("cut", "Cut", "fs-cut"));
  rows.push(_ideCtxItemHtml("copy", "Copy", "fs-copy"));
  rows.push(_ideCtxItemHtml("paste", pasteLabel, "fs-paste", { disabled: pasteDisabled }));
  rows.push(_ideCtxItemHtml("duplicate", "Duplicate", "fs-duplicate"));
  rows.push(_ideCtxSeparator());
  rows.push(_ideCtxItemHtml("reveal", _sednarRevealLabel(), "reveal-in-os"));
  rows.push(_ideCtxItemHtml("path", "Copy Path", "copy-path"));
  rows.push(_ideCtxItemHtml("path", "Copy Relative Path", "copy-relative-path"));
  rows.push(_ideCtxSeparator());
  rows.push(_ideCtxItemHtml("rename", "Rename…", "rename"));
  rows.push(_ideCtxItemHtml("trash", "Delete", "delete"));

  contextMenu.innerHTML = rows.join("");
  contextMenu.style.display = "block";
  contextMenu.style.left = e.clientX + "px";
  contextMenu.style.top = e.clientY + "px";
  const rect = contextMenu.getBoundingClientRect();
  let left = e.clientX;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - 8 - rect.width;
  left = Math.max(8, left);
  let top = e.clientY;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - 8 - rect.height;
  top = Math.max(8, top);
  contextMenu.style.left = left + "px";
  contextMenu.style.top = top + "px";
  const closeMenu = function(event) {
    if (!contextMenu.contains(event.target)) {
      contextMenu.style.display = "none";
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(function() {
    document.addEventListener("click", closeMenu);
  }, 100);
}

function showFolderContextMenu(e, folderPath, folderName) {
  showIDEContextMenu(e, folderPath, folderName, true);
}

function _sednarAddRepoContextToActiveChat(target) {
  if (!target || typeof window.addSednarRepoContextToChat !== "function") return false;
  return !!window.addSednarRepoContextToChat({
    repoPath: target.repoPath,
    kind: target.isDir ? "folder" : "file",
    name: target.name,
  });
}

function _sednarRefreshIdeTree() {
  if (!sednarProjectPath) return;
  ideFileTreeData = {};
  if (sednarWorkspaceFolders.length) {
    _sednarLoadWorkspaceFolderTrees();
    return;
  }
  loadIDEFileTree(sednarProjectPath);
}

const SEDNAR_TREE_MUTATING_TOOLS = new Set(["write_file", "edit_file", "multi_edit", "run_command", "checkout_branch"]);
let _sednarTreeRefreshTimer = null;
let _sednarTreeRefreshRunning = false;
let _sednarTreeRefreshQueued = false;

function _sednarCollectLoadedTreeDirs(nodes, out) {
  Object.keys(nodes || {}).forEach(function(name) {
    const node = nodes[name];
    if (!node || !(node.is_dir || node.type === "folder") || !node.loaded) return;
    out.push(node);
    _sednarCollectLoadedTreeDirs(node.children, out);
  });
}

function _sednarDropExpandedUnder(node) {
  ideExpandedFolders.delete(node.path);
  Object.keys(node.children || {}).forEach(function(name) {
    _sednarDropExpandedUnder(node.children[name]);
  });
}

function _sednarMergeDirListing(node) {
  const listPath = node.path;
  return _sednarIdeSocketRequest(
    "ide_list_files", { path: listPath },
    "ide_files_list",
    function(data) {
      return data && (data.requested_path !== undefined ? data.requested_path === listPath : data.path === listPath);
    }
  ).then(function(result) {
    const data = result.data;
    if (!data || data.error || !Array.isArray(data.files)) return;
    const previous = node.children || {};
    const next = {};
    data.files.forEach(function(item) {
      const existing = previous[item.name];
      if (existing && !!existing.is_dir === !!item.is_dir) {
        existing.path = item.path;
        next[item.name] = existing;
      } else {
        next[item.name] = _sednarTreeNodeFromListItem(item);
      }
    });
    Object.keys(previous).forEach(function(name) {
      if (next[name] !== previous[name]) _sednarDropExpandedUnder(previous[name]);
    });
    node.children = next;
  });
}

function _sednarTreeFingerprint(nodes, out) {
  // Names, kinds and paths of every loaded node: what the tree draws. Equal before and after a refresh
  // means nothing on disk changed, so the tree is left alone.
  out = out || [];
  Object.keys(nodes || {}).sort().forEach(function(name) {
    const node = nodes[name];
    if (!node) return;
    out.push(name, node.is_dir ? "d" : "f", String(node.path || ""), node.loaded ? "1" : "0");
    if (node.children) _sednarTreeFingerprint(node.children, out);
  });
  return out;
}

function _sednarRunSilentTreeRefresh() {
  if (_sednarTreeRefreshRunning) {
    _sednarTreeRefreshQueued = true;
    return;
  }
  const dirs = [];
  Object.keys(ideFileTreeData || {}).forEach(function(key) {
    _sednarCollectLoadedTreeDirs(ideFileTreeData[key], dirs);
  });
  if (!dirs.length) return;
  const snapshot = ideFileTreeData;
  const before = _sednarTreeFingerprint(ideFileTreeData).join("\n");
  _sednarTreeRefreshRunning = true;
  Promise.all(dirs.map(_sednarMergeDirListing)).catch(function() {}).then(function() {
    _sednarTreeRefreshRunning = false;
    if (snapshot === ideFileTreeData && _sednarTreeFingerprint(ideFileTreeData).join("\n") !== before) _sednarRenderWorkspaceTree();
    if (_sednarTreeRefreshQueued) {
      _sednarTreeRefreshQueued = false;
      _sednarScheduleSilentTreeRefresh();
    }
  });
}

function _sednarScheduleSilentTreeRefresh() {
  if (_sednarTreeRefreshTimer) clearTimeout(_sednarTreeRefreshTimer);
  _sednarTreeRefreshTimer = setTimeout(function() {
    _sednarTreeRefreshTimer = null;
    _sednarRunSilentTreeRefresh();
  }, 350);
}

function _sednarCopyToClipboard(text, label) {
  const value = String(text == null ? "" : text);
  const message = label || "Copied: " + value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(function() {
      _sednarShowIdeToast(message);
    }).catch(function() {
      _sednarShowIdeToast("Couldn't copy to clipboard");
    });
    return;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    _sednarShowIdeToast(message);
  } catch (err) {
    _sednarShowIdeToast("Couldn't copy to clipboard");
  }
}

function _sednarParentDir(path) {
  const norm = String(path || "").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? norm.slice(0, idx) : norm;
}

function _sednarFsRequest(emitEvent, payload, opName) {
  return _sednarIdeSocketRequest(
    emitEvent, payload, "ide_fs_result",
    function(data) { return data && data.op === opName; }
  ).then(function(result) {
    const data = result.data || {};
    if (result.error || data.error) {
      _sednarModalAlert({ title: "Couldn't complete that action", message: data.error || (opName + " failed") });
      return null;
    }
    return data;
  });
}

function _sednarCtxNewEntry(target, kind) {
  const label = kind === "folder" ? "Folder" : "File";
  _sednarModalPrompt({
    title: "New " + label,
    message: "Create inside " + target.name,
    placeholder: label.toLowerCase() + " name",
    confirmText: "Create",
  }).then(function(name) {
    if (!name || !name.trim()) return;
    _sednarFsRequest("ide_create_entry", { parent: target.path, name: name.trim(), kind: kind }, "create").then(function(data) {
      if (!data) return;
      ideExpandedFolders.add(target.path);
      _sednarRefreshIdeTree();
      if (kind === "file" && data.path) {
        setTimeout(function() { openFileInEditorFromPath(data.path); }, 150);
      }
    });
  });
}

function _sednarCtxRename(target) {
  _sednarModalPrompt({
    title: "Rename",
    message: "Rename “" + target.name + "”",
    value: target.name,
    confirmText: "Rename",
  }).then(function(next) {
    if (!next || !next.trim() || next.trim() === target.name) return;
    _sednarFsRequest("ide_rename_entry", { path: target.path, new_name: next.trim() }, "rename").then(function(data) {
      if (!data) return;
      if (ideOpenFiles[target.path]) closeFile(target.path);
      _sednarRefreshIdeTree();
      _sednarShowIdeToast("Renamed to " + next.trim());
    });
  });
}

function _sednarCtxDelete(target) {
  const kindWord = target.isDir ? "folder" : "file";
  _sednarModalConfirm({
    title: "Move to Trash",
    message: "Move " + kindWord + " “" + target.name + "” to the Trash?",
    confirmText: "Move to Trash",
  }).then(function(ok) {
    if (!ok) return;
    _sednarFsRequest("ide_delete_entry", { path: target.path }, "delete").then(function(data) {
      if (!data) return;
      if (ideOpenFiles[target.path]) closeFile(target.path);
      _sednarRefreshIdeTree();
      _sednarShowIdeToast("Moved to Trash: " + target.name);
    });
  });
}

function _sednarCtxReveal(target) {
  _sednarIdeSocketRequest(
    "ide_reveal_path", { path: target.path }, "ide_reveal_result",
    function(data) { return data && data.path === target.path; }
  ).then(function(result) {
    const data = result.data || {};
    if (result.error || data.error) {
      _sednarModalAlert({ title: "Couldn't open the file manager", message: data.error || "Reveal failed" });
    }
  });
}

function _sednarCtxDuplicate(target) {
  _sednarFsRequest("ide_duplicate_entry", { path: target.path }, "duplicate").then(function(data) {
    if (!data) return;
    _sednarRefreshIdeTree();
    _sednarShowIdeToast("Duplicated " + target.name);
  });
}

function _sednarCtxPaste(target) {
  const clip = _sednarFsClipboard;
  if (!clip) return;
  const destDir = target.isDir ? target.path : _sednarParentDir(target.path);
  _sednarFsRequest(
    "ide_transfer_entry",
    { source: clip.path, dest_dir: destDir, mode: clip.mode },
    "transfer"
  ).then(function(data) {
    if (!data) return;
    if (clip.mode === "move" && ideOpenFiles[clip.path]) closeFile(clip.path);
    _sednarFsClipboard = null;
    _sednarSyncCutMarks();
    ideExpandedFolders.add(destDir);
    _sednarRefreshIdeTree();
    _sednarShowIdeToast((clip.mode === "move" ? "Moved " : "Copied ") + clip.name);
  });
}

function ideContextMenuAction(action) {
  const contextMenu = document.getElementById("ide-context-menu");
  if (contextMenu) {
    contextMenu.style.display = "none";
  }
  const target = ideContextMenuTarget;
  ideContextMenuTarget = null;
  if (!target) {
    if (action === "recent" || action === "settings") showIDEPanel("recent");
    return;
  }
  if (action === "workspace-make-primary") {
    _sednarMakeWorkspaceFolderPrimary(target.path);
    return;
  }
  if (action === "workspace-remove-folder") {
    _sednarRemoveWorkspaceFolder(target.path);
    return;
  }
  if (action === "add-file-to-chat" || action === "add-folder-to-chat") {
    _sednarAddRepoContextToActiveChat(target);
    toggleSednarAgentPane(true);
    return;
  }
  if (action === "add-to-new-chat") {
    if (typeof window.createSednarChatTab === "function") {
      window.createSednarChatTab();
    }
    if (typeof window.clearSednarComposer === "function") {
      window.clearSednarComposer();
    }
    _sednarAddRepoContextToActiveChat(target);
    toggleSednarAgentPane(true);
    return;
  }
  if (action === "open-file") {
    openFileInEditorFromPath(target.path);
    return;
  }
  if (action === "new-file") { _sednarCtxNewEntry(target, "file"); return; }
  if (action === "new-folder") { _sednarCtxNewEntry(target, "folder"); return; }
  if (action === "reveal-in-os") { _sednarCtxReveal(target); return; }
  if (action === "fs-cut") {
    _sednarFsClipboard = { path: target.path, name: target.name, isDir: target.isDir, mode: "move" };
    _sednarSyncCutMarks();
    _sednarShowIdeToast("Cut " + target.name);
    return;
  }
  if (action === "fs-copy") {
    _sednarFsClipboard = { path: target.path, name: target.name, isDir: target.isDir, mode: "copy" };
    _sednarSyncCutMarks();
    _sednarShowIdeToast("Copied " + target.name);
    return;
  }
  if (action === "fs-paste") { _sednarCtxPaste(target); return; }
  if (action === "fs-duplicate") { _sednarCtxDuplicate(target); return; }
  if (action === "copy-path") { _sednarCopyToClipboard(target.path); return; }
  if (action === "copy-relative-path") { _sednarCopyToClipboard(target.repoPath || target.name); return; }
  if (action === "rename") { _sednarCtxRename(target); return; }
  if (action === "delete") { _sednarCtxDelete(target); return; }
  if (action === "recent" || action === "settings") {
    showIDEPanel("recent");
  }
}

function _sednarRevealLabel() {
  const p = String(navigator.platform || navigator.userAgent || "").toLowerCase();
  if (p.indexOf("mac") !== -1) return "Reveal in Finder";
  if (p.indexOf("win") !== -1) return "Show in Explorer";
  return "Show in File Manager";
}

function _sednarEscapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let _sednarModalResolve = null;

function _sednarEnsureModal() {
  let overlay = document.getElementById("ide-modal-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "ide-modal-overlay";
  overlay.className = "ide-modal-overlay theme-transition";
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="ide-modal theme-transition" role="dialog" aria-modal="true">' +
      '<button type="button" class="ide-modal-close" id="ide-modal-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>' +
      '<div class="ide-modal-title" id="ide-modal-title"></div>' +
      '<div class="ide-modal-message" id="ide-modal-message"></div>' +
      '<input type="text" class="ide-modal-input theme-transition" id="ide-modal-input" autocomplete="off" spellcheck="false" hidden />' +
      '<div class="ide-modal-actions">' +
        '<button type="button" class="ide-modal-btn theme-transition" id="ide-modal-cancel"></button>' +
        '<button type="button" class="ide-modal-btn theme-transition ide-modal-btn-primary" id="ide-modal-confirm"></button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", function(ev) {
    if (ev.target === overlay) _sednarCloseModal(null);
  });
  overlay.querySelector("#ide-modal-close").addEventListener("click", function() { _sednarCloseModal(null); });
  overlay.querySelector("#ide-modal-cancel").addEventListener("click", function() { _sednarCloseModal(null); });
  overlay.querySelector("#ide-modal-confirm").addEventListener("click", function() {
    const input = overlay.querySelector("#ide-modal-input");
    _sednarCloseModal(input.hidden ? true : input.value);
  });
  overlay.querySelector("#ide-modal-input").addEventListener("keydown", function(ev) {
    if (ev.key === "Enter") { ev.preventDefault(); _sednarCloseModal(ev.target.value); }
  });
  document.addEventListener("keydown", function(ev) {
    if (!overlay.hidden && ev.key === "Escape") { ev.preventDefault(); _sednarCloseModal(null); }
  });
  return overlay;
}

function _sednarCloseModal(value) {
  const overlay = document.getElementById("ide-modal-overlay");
  if (overlay) {
    overlay.hidden = true;
    const input = overlay.querySelector("#ide-modal-input");
    if (input) { input.value = ""; input.type = "text"; }
  }
  const resolve = _sednarModalResolve;
  _sednarModalResolve = null;
  if (resolve) resolve(value);
}

function _sednarOpenModal(opts) {
  const o = opts || {};
  const overlay = _sednarEnsureModal();
  if (_sednarModalResolve) _sednarModalResolve(null);
  overlay.querySelector("#ide-modal-title").textContent = o.title || "";
  const msgEl = overlay.querySelector("#ide-modal-message");
  msgEl.textContent = o.message || "";
  msgEl.hidden = !o.message;
  const input = overlay.querySelector("#ide-modal-input");
  const cancelBtn = overlay.querySelector("#ide-modal-cancel");
  const confirmBtn = overlay.querySelector("#ide-modal-confirm");
  if (o.mode === "prompt") {
    input.hidden = false;
    input.type = o.inputType || "text";
    input.value = o.value || "";
    input.placeholder = o.placeholder || "";
  } else {
    input.hidden = true;
  }
  cancelBtn.hidden = o.mode === "alert";
  cancelBtn.textContent = o.cancelText || "Cancel";
  confirmBtn.textContent = o.confirmText || (o.mode === "alert" ? "OK" : "Confirm");
  confirmBtn.classList.toggle("ide-modal-btn-danger", !!o.danger);
  overlay.classList.toggle("is-wide", !!o.wide);
  overlay.hidden = false;
  return new Promise(function(resolve) {
    _sednarModalResolve = resolve;
    setTimeout(function() {
      if (o.mode === "prompt") { input.focus(); input.select(); }
      else confirmBtn.focus();
    }, 30);
  });
}

function _sednarModalPrompt(opts) {
  return _sednarOpenModal(Object.assign({ mode: "prompt" }, opts || {})).then(function(v) {
    return v == null ? null : String(v);
  });
}

function _sednarModalConfirm(opts) {
  return _sednarOpenModal(Object.assign({ mode: "confirm" }, opts || {})).then(function(v) {
    return v === true;
  });
}

function _sednarModalAlert(opts) {
  return _sednarOpenModal(Object.assign({ mode: "alert" }, opts || {})).then(function() {});
}

function getSednarRecentProjects() {
  try {
    const raw = localStorage.getItem(SEDNAR_RECENT_PROJECTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(p => typeof p === "string" && p.length > 0) : [];
  } catch (e) {
    return [];
  }
}

function saveSednarRecentProject(path) {
  if (!path) return;
  let list = getSednarRecentProjects().filter(p => p !== path);
  list.unshift(path);
  list = list.slice(0, 10);
  try {
    localStorage.setItem(SEDNAR_RECENT_PROJECTS_KEY, JSON.stringify(list));
    localStorage.setItem(SEDNAR_LAST_PROJECT_KEY, path);
  } catch (e) {}
}

function _sednarClearActiveProject() {
  const previousPath = sednarProjectPath;
  sednarChatTabs.forEach(function(t) {
    if (t.agentRunning) _sednarAbortTabTurn(t);
  });
  if (previousPath) {
    try { _sednarSaveTabsForProject(previousPath); } catch (e) {}
    try { _sednarPersistEditorTabs(previousPath); } catch (e) {}
  }
  _sednarInvalidateSessionFetches();
  if (typeof closeSednarSessionMenu === "function") closeSednarSessionMenu();
  _sednarResetTerminalsForProject();
  _sednarClearEditorFiles();
  showSednarEditorIdle();

  sednarProjectPath = null;
  sednarProjectName = null;
  sednarWorkspacePath = null;
  sednarWorkspaceFolders = [];
  sednarWorkspaceSettings = {};
  sednarWorkspaceMcpServers = {};
  _sednarPersistBrowserWorkspace();
  ideHomePath = "~";
  ideFileTreeData = {};
  ideExpandedFolders.clear();
  sednarIndexReady = false;
  sednarIndexFileCount = 0;
  sednarIndexSymbolCount = 0;
  sednarIndexDetails = null;
  sednarIndexFolders = [];
  sednarIndexTruncated = false;

  sednarChatTabs = [];
  sednarActiveChatTabId = null;
  sednarChatTabCounter = 0;
  sednarAgentSessionId = _sednarNewChatSessionId();
  _sednarInitChatTabs();
  _sednarUpdateChatWelcome();
  _sednarRenderChatTabs();

  renderSednarExplorerEmpty();
  updateSednarExplorerHeader();
  updateOpenFilesList();
  renderSednarRecentSessions();
  updateSednarEditorPlaceholder();
  _sednarRenderProjectTabs();
}

function _sednarRecentEntryIsActive(path) {
  if (_sednarIsWorkspaceFilePath(path)) {
    return !!sednarWorkspacePath && _sednarNormalizeProjectKey(path) === _sednarNormalizeProjectKey(sednarWorkspacePath);
  }
  return _sednarNormalizeProjectKey(path) === _sednarNormalizeProjectKey(sednarProjectPath);
}

function removeSednarRecentProject(path) {
  const list = getSednarRecentProjects().filter(p => p !== path);
  const wasActive = _sednarRecentEntryIsActive(path);
  try {
    localStorage.setItem(SEDNAR_RECENT_PROJECTS_KEY, JSON.stringify(list));
    const last = localStorage.getItem(SEDNAR_LAST_PROJECT_KEY);
    if (last === path || !list.length) {
      localStorage.removeItem(SEDNAR_LAST_PROJECT_KEY);
    }
  } catch (e) {}
  if (!_sednarIsWorkspaceFilePath(path)) {
    fetch("/sednar/project-storage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: path })
    }).catch(() => {});
  }
  if (wasActive) {
    _sednarClearActiveProject();
  }
  _sednarForgetOpenProject(_sednarNormalizeProjectKey(path));
  renderSednarRecentProjects();
  if (_sednarProjectMenuOpen) renderSednarProjectDropdown();
}

function renderSednarRecentProjects() {
  _sednarRenderWelcomeRecents();
  const el = document.getElementById("ide-recent-projects-list");
  if (!el) return;
  const list = getSednarRecentProjects();
  if (!list.length) {
    el.innerHTML = '<div style="padding:8px 4px;opacity:0.6;font-size:12px;">No recent projects</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const name = p.split("/").filter(Boolean).pop() || p;
    const esc = p.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const isActive = _sednarRecentEntryIsActive(p);
    return `<div class="theme-transition sednar-recent-item${isActive ?" is-active" : ""}" style="padding:8px 10px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;margin-bottom:2px;" onclick="_sednarOpenProjectOrWorkspace('${esc}'); showIDEPanel('explorer'); return false;">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
        <span style="font-size:13px;font-weight:${isActive ? "600" : "500"};">${name.replace(/</g, "&lt;")}</span>
        <span class="sednar-recent-item-path" style="font-size:10px;opacity:0.55;line-height:1.35;white-space:nowrap;overflow-x:auto;">${p.replace(/</g, "&lt;")}</span>
      </div>
      <button type="button" class="sednar-recent-item-remove" title="Remove from recents" aria-label="Remove from recents" onclick="event.stopPropagation(); removeSednarRecentProject('${esc}'); return false;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>`;
  }).join("");
}

function updateSednarExplorerHeader() {

}
window.updateSednarExplorerHeader = updateSednarExplorerHeader;

function renderSednarExplorerEmpty() {
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (!fileTreeEl) return;
  fileTreeEl.innerHTML = `<div id="ide-explorer-empty" class="theme-transition">
     <div class="ide-explorer-empty-title">No folder open</div>
     <div class="ide-explorer-empty-sub">Browse files and let the agent work in a folder.</div>
     <button type="button" class="ide-explorer-empty-btn" onclick="openSednarProjectBrowser(); return false;">Open folder</button>
     <button type="button" class="ide-explorer-empty-link" onclick="openSednarCloneDialog(); return false;">Clone a repository</button>
  </div>`;
  updateSednarExplorerHeader();
}

function _sednarWarmWorkspaceIndex(path) {
  const scheduleIndex = typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : function(cb) { setTimeout(cb, 1); };
  scheduleIndex(function() {
    fetch("/sednar/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: path, workspace: _sednarCurrentWorkspacePayload() })
    }).then(r => r.json()).then(data => {
      if (data.success) {
        _sednarApplyIndexResult(data);
        sednarWorkspaceMissingFolders = Array.isArray(data.missing) ? data.missing.map(function(f) { return f.path; }) : [];
        _sednarRefreshWorkspaceMissingBadges();
      }
    }).catch(() => {});
  });
}

window.setSednarProject = function(path) {
  if (!path) return;
  if (_sednarIsWorkspaceFilePath(path)) {
    _sednarOpenProjectOrWorkspace(path);
    return;
  }
  const previousPath = sednarProjectPath;
  const normPrev = _sednarNormalizeProjectKey(previousPath);
  const normNext = _sednarNormalizeProjectKey(path);
  if (normPrev !== normNext) {
    if (normPrev) {
      _sednarStashRunningProjectChats(previousPath);
      _sednarSaveTabsForProject(previousPath);
      _sednarPersistEditorTabs(previousPath);
    }
    _sednarClearEditorFiles();
    if (!previousPath) {
      sednarAgentSessionId = null;
    }
    _sednarInvalidateSessionFetches();
    if (typeof closeSednarSessionMenu === "function") closeSednarSessionMenu();
  }
  sednarProjectPath = path;
  sednarProjectName = _sednarFolderNameFromPath(path);
  if (!sednarApplyingWorkspace && (!sednarWorkspaceFolders.length || normPrev !== normNext)) {
    sednarWorkspacePath = null;
    sednarWorkspaceFolders = [{ name: _sednarFolderNameFromPath(path), path: path }];
    sednarWorkspaceSettings = {};
    sednarWorkspaceMcpServers = {};
    _sednarPersistBrowserWorkspace();
  }
  ideHomePath = path;
  try {
    if (window.WBTsIntel) window.WBTsIntel.onProjectOpen(path, previousPath || null);
    if (window.WBLsp && window.monaco) window.WBLsp.onProjectOpen(path, previousPath || null);
  } catch (e) {}
  ideFileTreeData = {};
  ideExpandedFolders.clear();
  saveSednarRecentProject(path);
  sednarIndexReady = false;
  sednarIndexFileCount = 0;
  sednarIndexSymbolCount = 0;
  sednarIndexDetails = null;
  sednarIndexFolders = [];
  sednarIndexTruncated = false;
  if (normPrev !== normNext || !sednarChatTabs.length) _sednarLoadTabsForProject(path);
  const activeTab = _sednarGetActiveChatTab();
  if (activeTab && !activeTab.chatStarted) {
    sednarAgentSessionId = activeTab.sessionId || _sednarNewChatSessionId();
    activeTab.sessionId = sednarAgentSessionId;
  } else if (!sednarAgentSessionId) {
    sednarAgentSessionId = _sednarNewChatSessionId();
  }
  if (normPrev !== normNext) {
    _sednarSwapTerminalsForProject(previousPath, path);
  }
  _sednarLoadWorkspaceFolderTrees();
  _sednarRestoreEditorTabs(path);
  toggleSednarAgentPane(true);
  renderSednarRecentProjects();
  if (_sednarProjectMenuOpen) renderSednarProjectDropdown();
  renderSednarRecentSessions();
  _sednarUpdateChatWelcome();
  updateSednarExplorerHeader();
  _sednarMcpStatusRequestSeq += 1;
  _sednarMcpStatusLoadedWithoutProbe = false;
  _sednarLoadMcpSelection();
  refreshSednarMcpStatus({ probeServers: [], hydrateSelected: true });
  _sednarWarmWorkspaceIndex(path);
  _sednarSyncActiveProjectTab();
};


const SEDNAR_OPEN_PROJECTS_KEY = "sednar_open_projects_v1";
let _sednarOpenProjects = null;
let _sednarProjectTabsHtml = null;
let _sednarProjectSwitching = false;

function _sednarOpenProjectEntry(raw) {
  if (!raw || !raw.path) return null;
  return {
    key: _sednarNormalizeProjectKey(raw.path),
    path: raw.path,
    primary: raw.primary || raw.path,
    workspace: raw.workspace && Array.isArray(raw.workspace.folders) ? raw.workspace : null,
  };
}

function _sednarLoadOpenProjects() {
  if (_sednarOpenProjects) return _sednarOpenProjects;
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(SEDNAR_OPEN_PROJECTS_KEY) || "[]"); } catch (e) {}
  const seen = new Set();
  _sednarOpenProjects = (Array.isArray(raw) ? raw : []).map(_sednarOpenProjectEntry).filter(function(entry) {
    if (!entry || !entry.key || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
  return _sednarOpenProjects;
}

function _sednarPersistOpenProjects() {
  try {
    localStorage.setItem(SEDNAR_OPEN_PROJECTS_KEY, JSON.stringify(_sednarLoadOpenProjects().map(function(entry) {
      return { path: entry.path, primary: entry.primary, workspace: entry.workspace || undefined };
    })));
  } catch (e) {}
}

function _sednarActiveProjectKey() {
  return _sednarNormalizeProjectKey(sednarWorkspacePath || sednarProjectPath);
}

function _sednarSyncActiveProjectTab() {
  const key = _sednarActiveProjectKey();
  const list = _sednarLoadOpenProjects();
  if (key && sednarProjectPath) {
    const payload = _sednarCurrentWorkspacePayload();
    const entry = _sednarOpenProjectEntry({
      path: sednarWorkspacePath || sednarProjectPath,
      primary: sednarProjectPath,
      workspace: !sednarWorkspacePath && payload.folders.length > 1 ? payload : null,
    });
    let index = list.findIndex(function(e) { return e.key === key; });
    if (index === -1 && sednarWorkspacePath) {
      const primaryKey = _sednarNormalizeProjectKey(sednarProjectPath);
      index = list.findIndex(function(e) { return e.key === primaryKey && e.workspace; });
    }
    if (index === -1) list.push(entry);
    else list[index] = entry;
    _sednarPersistOpenProjects();
  }
  _sednarRenderProjectTabs();
}

function _sednarProjectTabLabel(entry) {
  if (_sednarIsWorkspaceFilePath(entry.path)) {
    return _sednarFolderNameFromPath(entry.path).replace(/\.code-workspace$/i, "") || "Workspace";
  }
  const name = _sednarFolderNameFromPath(entry.path) || entry.path;
  const extra = entry.workspace ? entry.workspace.folders.length - 1 : 0;
  return extra > 0 ? name + " +" + extra : name;
}

function _sednarProjectTabStatus(entry, isActive) {
  const background = _sednarBackgroundProjectChats[_sednarNormalizeProjectKey(entry.primary)];
  const tabs = isActive ? sednarChatTabs : (background ? background.tabs : []);
  if (!isActive && tabs.some(function(t) { return t.pendingPermissionRequestId || t.pendingQuestion; })) return "attention";
  if (tabs.some(function(t) { return t.agentRunning; })) return "running";
  if (!isActive && tabs.some(function(t) { return t.hasUnread; })) return "unread";
  return "";
}

const _SEDNAR_PROJECT_TAB_CUBE_ICON = '<svg class="ui-icon" width="14" height="14" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><g transform="translate(64 34.346667)"><path d="M192,0 L384,110.851252 L384,332.553755 L192,443.405007 L0,332.553755 L0,110.851252 L192,0 Z M42.666,157.654 L42.6666667,307.920144 L170.666,381.82 L170.666,231.555 L42.666,157.654 Z M341.333,157.655 L213.333,231.555 L213.333,381.82 L341.333333,307.920144 L341.333,157.655 Z M192,49.267223 L66.1333333,121.936377 L192,194.605531 L317.866667,121.936377 L192,49.267223 Z"></path></g></svg>';

const _SEDNAR_PROJECT_TAB_ICONS = {
  folder: _SEDNAR_PROJECT_TAB_CUBE_ICON,
  workspace: _SEDNAR_PROJECT_TAB_CUBE_ICON,
  close: _sednarIcon("x", { size: "base" }),
  add: _sednarIcon("plus", { size: "lg" }),
};

function _sednarRenderProjectTabs() {
  const strip = document.getElementById("ide-project-tabs");
  if (!strip) return;
  const list = _sednarLoadOpenProjects();
  const activeKey = _sednarActiveProjectKey();
  const esc = function(text) { return _sednarEscapeHtml(String(text || "")).replace(/"/g, "&quot;"); };
  const tabsHtml = list.map(function(entry) {
    const isActive = entry.key === activeKey && !!sednarProjectPath;
    const status = _sednarProjectTabStatus(entry, isActive);
    const label = _sednarProjectTabLabel(entry);
    const kind = _sednarIsWorkspaceFilePath(entry.path) || entry.workspace ? "workspace" : "folder";
    let icon = _SEDNAR_PROJECT_TAB_ICONS[kind];
    let statusLabel = "";
    if (status === "running") {
      icon = _sednarAgentIconHtml("running");
      statusLabel = "Agent working";
    } else if (status === "attention") {
      icon = '<span class="ide-project-tab-dot is-attention"></span>';
      statusLabel = "Agent waiting for you";
    } else if (status === "unread") {
      icon = '<span class="ide-project-tab-dot"></span>';
      statusLabel = "Agent finished";
    }
    const title = entry.path + (statusLabel ? " (" + statusLabel + ")" : "");
    return '<div class="ide-project-tab' + (isActive ? " is-active" : "") + (status ? " is-" + status : "") + '" role="tab"' +
      ' aria-selected="' + (isActive ? "true" : "false") + '" tabindex="' + (isActive ? "0" : "-1") + '"' +
      ' data-project-key="' + esc(entry.key) + '" title="' + esc(title) + '">' +
      (status === "attention" || status === "unread" || status === "running" ?
        '<span class="ide-project-tab-icon" aria-hidden="true">' + icon + "</span>" : "") +
      '<span class="ide-project-tab-name">' + _sednarEscapeHtml(label) + "</span>" +
      (statusLabel ? '<span class="ide-project-tab-sr">' + _sednarEscapeHtml(statusLabel) + "</span>" : "") +
      '<button type="button" class="ide-project-tab-close" data-project-close tabindex="-1" title="Close project" aria-label="Close ' + esc(label) + '">' +
      _SEDNAR_PROJECT_TAB_ICONS.close + "</button></div>";
  }).join("");
  const html = '<div class="ide-project-tabs-list" role="tablist" aria-label="Open projects">' + tabsHtml + "</div>" +
    '<button type="button" class="ide-project-tab-add" data-project-open title="Open folder" aria-label="Open folder">' +
    _SEDNAR_PROJECT_TAB_ICONS.add + "</button>" +
    '<button type="button" id="ide-activity-recent" class="sednar-chat-tab-action theme-transition" title="Recent Projects" aria-label="Recent Projects" aria-haspopup="true" aria-expanded="false" aria-pressed="false">' +
    '<svg class="ui-icon" width="16" height="16" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><g transform="translate(64 34.346667)"><path d="M192,-7.10542736e-15 L384,110.851252 L384,242.986 L341.333,242.986 L341.333,157.655 L213.333,231.555 L213.333,431.088 L192,443.405007 L0,332.553755 L0,110.851252 L192,-7.10542736e-15 Z M341.333333,264.32 L341.333,328.32 L405.333333,328.32 L405.333333,370.986667 L341.333,370.986 L341.333333,434.986667 L298.666667,434.986667 L298.666,370.986 L234.666667,370.986667 L234.666667,328.32 L298.666,328.32 L298.666667,264.32 L341.333333,264.32 Z M42.666,157.654 L42.6666667,307.920144 L170.666,381.82 L170.666,231.555 L42.666,157.654 Z M192,49.267223 L66.1333333,121.936377 L192,194.605531 L317.866667,121.936377 L192,49.267223 Z"></path></g></svg>' + "</button>" +
    '<button type="button" id="ide-play-button" class="sednar-chat-tab-action theme-transition" onclick="runCurrentPythonFile(); return false;" title="Run Python File" aria-label="Run Python File" style="display:none;">' +
    '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' + "</button>" +
    '<button type="button" id="sednar-theme-toggle" class="sednar-chat-tab-action theme-transition" onclick="toggleSednarTheme(); return false;" title="Theme" aria-label="Theme">' +
    _SEDNAR_THEME_ICONS + "</button>" +
    '<button type="button" id="ide-activity-terminal" class="sednar-chat-tab-action theme-transition" onclick="toggleIDETerminal(); return false;" title="Toggle Terminal" aria-label="Toggle Terminal" aria-pressed="false">' +
    '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>' + "</button>" +
    (window.SEDNAR_PUBLIC ?
      '<button type="button" id="sednar-account-open" class="sednar-chat-tab-action theme-transition" onclick="openSednarSettings(\'account\'); return false;" title="Account" aria-label="Account">' +
      '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path></svg>' + "</button>" : "") +
    '<button type="button" id="sednar-settings-open" class="sednar-chat-tab-action theme-transition" onclick="openSednarSettings(); return false;" title="Settings" aria-label="Settings">' +
    _sednarIcon("settings-gear", { size: "lg" }) + "</button>";
  strip.hidden = !list.length;
  if (html === _sednarProjectTabsHtml) return;
  const existingList = strip.querySelector(".ide-project-tabs-list");
  if (existingList && strip.dataset.actionsBuilt === "1") {
    // Only the tabs changed: patch them in place. The action buttons (run, terminal, fullscreen) carry
    // live pressed and shown state, so they are never rebuilt.
    _sednarMorph(existingList, tabsHtml);
  } else {
    const focusedKey = document.activeElement && strip.contains(document.activeElement) && document.activeElement.getAttribute("data-project-key");
    strip.innerHTML = html;
    strip.dataset.actionsBuilt = "1";
    _sednarSyncThemeButton();
    if (focusedKey) {
      const again = Array.from(strip.querySelectorAll(".ide-project-tab")).find(function(el) { return el.getAttribute("data-project-key") === focusedKey; });
      if (again) again.focus();
    }
  }
  _sednarProjectTabsHtml = html;
  const active = strip.querySelector(".ide-project-tab.is-active");
  const tabsList = strip.querySelector(".ide-project-tabs-list");
  if (active && tabsList) {
    if (active.offsetLeft < tabsList.scrollLeft) {
      tabsList.scrollLeft = active.offsetLeft;
    } else if (active.offsetLeft + active.offsetWidth > tabsList.scrollLeft + tabsList.clientWidth) {
      tabsList.scrollLeft = active.offsetLeft + active.offsetWidth - tabsList.clientWidth;
    }
  }
}

async function _sednarActivateProjectTab(key) {
  const entry = _sednarLoadOpenProjects().find(function(e) { return e.key === key; });
  if (!entry || _sednarProjectSwitching) return false;
  if (entry.key === _sednarActiveProjectKey() && sednarProjectPath) return true;
  _sednarProjectSwitching = true;
  let ok = false;
  try {
    if (_sednarIsWorkspaceFilePath(entry.path)) {
      await _sednarLoadWorkspaceFile(entry.path, { silent: true, allowPartial: true });
      ok = true;
    } else if (entry.workspace && entry.workspace.folders.length > 1) {
      ok = await _sednarRestoreBrowserWorkspace(entry.workspace);
    } else {
      const result = await _sednarValidateWorkspaceFolders([{ name: _sednarFolderNameFromPath(entry.path), path: entry.path }]);
      const present = (result.folders || [])[0];
      ok = !!present && _sednarSetWorkspaceFromPayload({ path: "", folders: [present], settings: {}, mcpServers: {} });
    }
  } catch (e) {
    ok = false;
  } finally {
    _sednarProjectSwitching = false;
  }
  if (!ok) {
    _sednarShowIdeToast("Couldn't open " + _sednarProjectTabLabel(entry) + ": it no longer exists.");
    _sednarForgetOpenProject(entry.key);
  }
  _sednarRenderProjectTabs();
  return ok;
}

function _sednarForgetOpenProject(key) {
  const list = _sednarLoadOpenProjects();
  const index = list.findIndex(function(e) { return e.key === key; });
  if (index === -1) return;
  const entry = list[index];
  list.splice(index, 1);
  _sednarPersistOpenProjects();
  const primaryKey = _sednarNormalizeProjectKey(entry.primary);
  if (primaryKey !== _sednarNormalizeProjectKey(sednarProjectPath)) {
    _sednarStopBackgroundProjectChats(primaryKey);
    _sednarCloseProjectTerminals(primaryKey);
  }
  _sednarRenderProjectTabs();
}

window.closeSednarProjectTab = async function(key) {
  const list = _sednarLoadOpenProjects();
  const index = list.findIndex(function(e) { return e.key === key; });
  if (index === -1 || _sednarProjectSwitching) return;
  const entry = list[index];
  const isActive = entry.key === _sednarActiveProjectKey() && !!sednarProjectPath;
  const label = _sednarProjectTabLabel(entry);
  const status = _sednarProjectTabStatus(entry, isActive);
  if (status === "running" || status === "attention") {
    const ok = await _sednarModalConfirm({
      title: "Stop the agent?",
      message: "An agent is still working in " + label + ". Closing the project stops it.",
      confirmText: "Stop and close",
      danger: true,
    });
    if (!ok) return;
  }
  if (!isActive) {
    _sednarForgetOpenProject(entry.key);
    return;
  }
  sednarChatTabs.forEach(function(t) {
    if (t.agentRunning) _sednarAbortTabTurn(t);
  });
  _sednarResetTerminalsForProject();
  list.splice(index, 1);
  _sednarPersistOpenProjects();
  let switched = false;
  for (let tries = list.length; tries > 0 && !switched; tries--) {
    const remaining = _sednarLoadOpenProjects();
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (!next) break;
    switched = await _sednarActivateProjectTab(next.key);
  }
  if (!switched) {
    _sednarClearActiveProject();
    try { localStorage.removeItem(SEDNAR_LAST_PROJECT_KEY); } catch (e) {}
    renderSednarRecentProjects();
  }
  _sednarRenderProjectTabs();
};

function _sednarBindProjectTabsOnce() {
  const strip = document.getElementById("ide-project-tabs");
  if (!strip || strip._sednarBound) return;
  strip._sednarBound = true;
  strip.addEventListener("click", function(e) {
    const target = e.target && e.target.closest ? e.target : null;
    if (!target) return;
    if (target.closest("[data-project-open]")) {
      openSednarProjectBrowser();
      return;
    }
    const tab = target.closest(".ide-project-tab");
    if (!tab) return;
    const key = tab.getAttribute("data-project-key");
    if (target.closest("[data-project-close]")) {
      e.stopPropagation();
      closeSednarProjectTab(key);
      return;
    }
    _sednarActivateProjectTab(key);
  });
  strip.addEventListener("auxclick", function(e) {
    if (e.button !== 1) return;
    const tab = e.target && e.target.closest ? e.target.closest(".ide-project-tab") : null;
    if (!tab) return;
    e.preventDefault();
    closeSednarProjectTab(tab.getAttribute("data-project-key"));
  });
  strip.addEventListener("keydown", function(e) {
    const tab = e.target && e.target.closest ? e.target.closest(".ide-project-tab") : null;
    if (!tab) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      _sednarActivateProjectTab(tab.getAttribute("data-project-key"));
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const tabs = Array.from(strip.querySelectorAll(".ide-project-tab"));
      const next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      if (next) next.focus();
    } else if (e.key === "Delete") {
      e.preventDefault();
      closeSednarProjectTab(tab.getAttribute("data-project-key"));
    }
  });
}

function updateSednarEditorPlaceholder() {
  const noProject = document.getElementById("ide-editor-placeholder-no-project");
  const noFile = document.getElementById("ide-editor-placeholder-no-file");
  const hasProject = !!sednarProjectPath;
  if (noProject) noProject.style.display = hasProject ? "none" : "";
  if (noFile) noFile.style.display = hasProject ? "" : "none";
  if (!hasProject) _sednarRenderWelcomeRecents();
}

function showSednarEditorIdle() {
  ideActiveFile = null;
  const placeholder = document.getElementById("ide-editor-placeholder");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  if (monacoSurface) monacoSurface.style.display = "none";
  if (codeEditor) codeEditor.style.display = "none";
  _sednarHidePlanSurface();
  _sednarHideSettingsSurface();
  updateSednarEditorPlaceholder();
  if (placeholder) placeholder.style.display = "flex";
  if (window.ideEditor) try { window.ideEditor.setModel(null); } catch (e) {}
  updateOpenFilesList();
  updateIdePlanChrome();
}

async function _sednarValidateWorkspaceFolders(folders) {
  const resp = await fetch("/sednar/workspace/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folders: folders })
  });
  const payload = await resp.json();
  if (!resp.ok) throw new Error(payload.error || "Unable to validate workspace");
  return payload;
}

async function _sednarRestoreBrowserWorkspace(workspace) {
  const folders = _sednarNormalizeWorkspaceFolders(workspace.folders || []);
  if (!folders.length) return false;
  let result;
  try {
    result = await _sednarValidateWorkspaceFolders(folders);
  } catch (e) {
    return false;
  }
  const present = result.folders || [];
  if (!present.length) {
    try { localStorage.removeItem(SEDNAR_BROWSER_WORKSPACE_KEY); } catch (e) {}
    return false;
  }
  const missing = result.missing || [];
  const applied = _sednarSetWorkspaceFromPayload(Object.assign({}, workspace, { folders: present }));
  if (!applied) return false;
  if (missing.length) {
    const names = missing.map(function(f) { return f.name || f.path; }).join(", ");
    const primaryGone = missing.some(function(f) { return f.path === folders[0].path; });
    _sednarShowIdeToast(
      (primaryGone ? "Primary workspace folder was missing; promoted the next folder. " : "") +
      `Removed ${missing.length} missing workspace folder(s): ${names}.`
    );
  }
  return true;
}

async function _sednarRestoreLastProject(last) {
  if (_sednarIsWorkspaceFilePath(last)) {
    try {
      await _sednarLoadWorkspaceFile(last, { silent: true, allowPartial: true });
      return true;
    } catch (e) {
      return false;
    }
  }
  let result;
  try {
    result = await _sednarValidateWorkspaceFolders([{ name: _sednarFolderNameFromPath(last), path: last }]);
  } catch (e) {
    return false;
  }
  const present = result.folders || [];
  if (!present.length) return false;
  setSednarProject(present[0].path);
  return true;
}

async function initSednarProjectState() {
  _sednarBindProjectStateListenersOnce();
  _sednarBindProjectTabsOnce();
  _sednarLoadOpenProjects();
  const workspace = _sednarLoadBrowserWorkspace();
  let restored = workspace ? await _sednarRestoreBrowserWorkspace(workspace) : false;
  if (!restored) {
    let last = null;
    try { last = localStorage.getItem(SEDNAR_LAST_PROJECT_KEY); } catch (e) {}
    if (last) {
      restored = await _sednarRestoreLastProject(last);
      if (!restored) {
        _sednarShowIdeToast("Couldn't reopen the last project — it no longer exists.");
        removeSednarRecentProject(last);
      }
    }
    for (const entry of _sednarLoadOpenProjects().slice()) {
      if (restored) break;
      restored = await _sednarActivateProjectTab(entry.key);
    }
    if (!restored) {
      renderSednarExplorerEmpty();
      updateSednarExplorerHeader();
      updateOpenFilesList();
    }
  }
  _sednarSyncActiveProjectTab();
  initSednarAgentSocket();
  if (!sednarChatTabs.length) {
    if (!sednarAgentSessionId) {
      sednarAgentSessionId = _sednarNewChatSessionId();
    }
    _sednarInitChatTabs();
  }
  _sednarUpdateChatWelcome();
  toggleSednarAgentPane(true);
}

var _sednarBrowserPath = "~";
var _sednarBrowserHomePath = null;
var _sednarBrowserSelected = null;
var _sednarBrowserMode = "folder";
var _sednarBrowserOnSelect = null;
var _sednarBrowserFileExtensions = null;

function _sednarBrowserExtensionAllowed(path) {
  if (!_sednarBrowserFileExtensions || !_sednarBrowserFileExtensions.length) return true;
  const lower = String(path || "").toLowerCase();
  return _sednarBrowserFileExtensions.some(function(ext) {
    return lower.endsWith(ext.toLowerCase());
  });
}
var _sednarBrowserSock = null;
var _sednarBrowserItems = [];
var _sednarBrowserHistory = [];
var _sednarBrowserHistoryIndex = -1;
var _sednarBrowserListHandler = null;

var SEDNAR_FINDER_FAV_KEY = "sednarBrowserFavorites";

var SEDNAR_FINDER_SORT_KEY = "sednarBrowserSort";
var _sednarFinderSortKey = "name";
var _sednarFinderSortDir = "asc";
try {
  var _savedFinderSort = JSON.parse(localStorage.getItem(SEDNAR_FINDER_SORT_KEY) || "null");
  if (_savedFinderSort && _savedFinderSort.key) {
    _sednarFinderSortKey = _savedFinderSort.key;
    _sednarFinderSortDir = _savedFinderSort.dir === "desc" ? "desc" : "asc";
  }
} catch (e) {}

function _sednarSortFinderItems(items) {
  var key = _sednarFinderSortKey;
  var factor = _sednarFinderSortDir === "desc" ? -1 : 1;
  var sorted = (items || []).slice();
  sorted.sort(function(a, b) {
    var aDir = a.is_dir || a.type === "folder";
    var bDir = b.is_dir || b.type === "folder";
    if (aDir !== bDir) return aDir ? -1 : 1;
    var cmp = 0;
    if (key === "size") {
      cmp = (Number(a.size) || 0) - (Number(b.size) || 0);
    } else if (key === "mtime") {
      cmp = (Number(a.mtime) || 0) - (Number(b.mtime) || 0);
    } else if (key === "kind") {
      var aKind = String(a.kind || (aDir ? "Folder" : "Document"));
      var bKind = String(b.kind || (bDir ? "Folder" : "Document"));
      cmp = aKind.localeCompare(bKind, undefined, { sensitivity: "base" });
    } else {
      cmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true });
    }
    if (cmp === 0) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true });
    }
    return cmp * factor;
  });
  return sorted;
}

function _sednarUpdateFinderSortHeaders() {
  document.querySelectorAll("#sednarProjectBrowserModal .sednar-finder-sort").forEach(function(th) {
    var active = th.getAttribute("data-sort-key") === _sednarFinderSortKey;
    th.classList.toggle("is-sorted", active);
    th.classList.toggle("is-desc", active && _sednarFinderSortDir === "desc");
    th.setAttribute("aria-sort", active ? (_sednarFinderSortDir === "desc" ? "descending" : "ascending") : "none");
  });
}

window.sednarBrowserSortBy = function(key) {
  if (!/^(name|size|kind|mtime)$/.test(key)) return;
  if (_sednarFinderSortKey === key) {
    _sednarFinderSortDir = _sednarFinderSortDir === "asc" ? "desc" : "asc";
  } else {
    _sednarFinderSortKey = key;
    _sednarFinderSortDir = (key === "size" || key === "mtime") ? "desc" : "asc";
  }
  try {
    localStorage.setItem(SEDNAR_FINDER_SORT_KEY, JSON.stringify({ key: _sednarFinderSortKey, dir: _sednarFinderSortDir }));
  } catch (e) {}
  var search = document.getElementById("sednar-finder-search");
  window.sednarBrowserFilterList(search ? search.value : "");
};

var _SEDNAR_STAR_OUTLINE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
var _SEDNAR_STAR_FILLED = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

function _sednarGetFavorites() {
  try {
    const raw = localStorage.getItem(SEDNAR_FINDER_FAV_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function (p) { return typeof p === "string" && p; }) : [];
  } catch (e) { return []; }
}

function _sednarSetFavorites(list) {
  try { localStorage.setItem(SEDNAR_FINDER_FAV_KEY, JSON.stringify(list)); } catch (e) {}
}

function _sednarIsFavorite(path) {
  return !!path && _sednarGetFavorites().indexOf(path) !== -1;
}

function _sednarFinderBasename(path) {
  const parts = String(path || "").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path || "");
}

function _sednarRenderFinderFavorites() {
  const wrap = document.getElementById("sednar-finder-favorites");
  if (!wrap) return;
  const favs = _sednarGetFavorites();
  if (!favs.length) { wrap.innerHTML = ""; return; }
  let html = '<div class="sednar-finder-sidebar-sublabel">Favorites</div>';
  html += favs.map(function (p) {
    const esc = p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const name = _sednarFinderBasename(p).replace(/</g, "&lt;");
    return '<div class="sednar-finder-fav-row">' +
      '<button type="button" class="sednar-finder-sidebar-item sednar-finder-fav-item theme-transition" data-finder-path="' + esc + '" title="' + esc + '" onclick="sednarBrowserNavigate(\'' + esc + '\'); return false;">' + name + '</button>' +
      '<button type="button" class="sednar-finder-fav-remove" title="Remove from Locations" onclick="sednarBrowserToggleFavorite(\'' + esc + '\', event); return false;">' + _SEDNAR_STAR_FILLED + '</button>' +
      '</div>';
  }).join("");
  wrap.innerHTML = html;
}

window.sednarBrowserToggleFavorite = function (path, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!path) return;
  const list = _sednarGetFavorites();
  const idx = list.indexOf(path);
  if (idx === -1) list.push(path);
  else list.splice(idx, 1);
  _sednarSetFavorites(list);
  _sednarRenderFinderFavorites();
  _sednarUpdateFinderSidebarActive(_sednarBrowserPath);
  const search = document.getElementById("sednar-finder-search");
  window.sednarBrowserFilterList(search ? search.value : "");
};

function _sednarEnsureBrowserSocket() {
  if (!_sednarBrowserSock) {
    _sednarBrowserSock = _sednarGetIdeSocket();
  }
  return _sednarBrowserSock;
}

function _sednarGetParentPath(path) {
  if (!path || path === "~") return null;
  const normalized = String(path).replace(/\/$/, "");
  if (!normalized || normalized === "/") return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(0, -1).join("/");
}

function _sednarRenderFinderBreadcrumb(actualPath) {
  const el = document.getElementById("sednar-finder-breadcrumb");
  if (!el) return;
  const chevron = '<span class="sednar-finder-breadcrumb-sep">›</span>';
  let html = '<span class="sednar-finder-breadcrumb-item" onclick="sednarBrowserNavigate(\'~\');return false;">Home</span>';
  if (!actualPath || actualPath === "~") {
    el.innerHTML = html;
    return;
  }
  const parts = actualPath.replace(/\/$/, "").split("/").filter(Boolean);
  let currentPath = "";
  parts.forEach(function(part) {
    currentPath += "/" + part;
    const esc = currentPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    html += chevron + '<span class="sednar-finder-breadcrumb-item" title="' + currentPath.replace(/"/g, "&quot;") + '" onclick="sednarBrowserNavigate(\'' + esc + '\');return false;">' + part.replace(/</g, "&lt;") + "</span>";
  });
  el.innerHTML = html;
}

function _sednarUsernameFromHomePath(homePath) {
  if (!homePath) return null;
  const parts = homePath.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function _sednarUpdateFinderSidebarHomeLabel() {
  const btn = document.querySelector('.sednar-finder-sidebar-item[data-finder-path="~"]');
  if (!btn) return;
  const username = _sednarUsernameFromHomePath(_sednarBrowserHomePath);
  btn.textContent = username || "Home";
}

function _sednarMaybeSetHomePath(actualPath) {
  if (!actualPath || actualPath === "~") return;
  const match = actualPath.match(/^(\/Users\/[^/]+)/) || actualPath.match(/^(\/home\/[^/]+)/i);
  if (match) {
    _sednarBrowserHomePath = match[1];
    _sednarUpdateFinderSidebarHomeLabel();
  }
}

function _sednarUpdateFinderSidebarActive(actualPath) {
  const home = _sednarBrowserHomePath;
  const desktopPath = home ? home + "/Desktop" : null;
  const downloadsPath = home ? home + "/Downloads" : null;
  document.querySelectorAll(".sednar-finder-sidebar-item").forEach(function(btn) {
    const shortcut = btn.getAttribute("data-finder-path") || "";
    let active = false;
    if (shortcut === "~/Desktop" && desktopPath && actualPath) {
      active = actualPath === desktopPath || actualPath.indexOf(desktopPath + "/") === 0;
    } else if (shortcut === "~/Downloads" && downloadsPath && actualPath) {
      active = actualPath === downloadsPath || actualPath.indexOf(downloadsPath + "/") === 0;
    } else if (shortcut === "~") {
      if (!actualPath || actualPath === "~") {
        active = true;
      } else if (home) {
        active = actualPath === home;
      }
    } else if (shortcut && actualPath) {
      active = actualPath === shortcut;
    }
    btn.classList.toggle("is-active", active);
  });
}

function _sednarFormatFileSize(bytes) {
  if (bytes == null || bytes === "") return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return n + " bytes";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace(/\.0$/, "") + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10485760 ? 1 : 0).replace(/\.0$/, "") + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " GB";
}

function _sednarFormatFinderDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return "Today at " + time;
  if (isYesterday) return "Yesterday at " + time;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function _sednarFinderIcon(item) {
  const name = item.name || "";
  if (item.is_dir || item.type === "folder") {
    return _sednarFolderIcon(false, name);
  }
  return _sednarFileIcon(name);
}

function _sednarUpdateFinderNavButtons() {
  const back = document.getElementById("sednar-finder-back");
  const fwd = document.getElementById("sednar-finder-forward");
  if (back) back.disabled = _sednarBrowserHistoryIndex <= 0;
  if (fwd) fwd.disabled = _sednarBrowserHistoryIndex < 0 || _sednarBrowserHistoryIndex >= _sednarBrowserHistory.length - 1;
}

function _sednarPushBrowserHistory(path) {
  if (_sednarBrowserHistoryIndex >= 0 && _sednarBrowserHistory[_sednarBrowserHistoryIndex] === path) return;
  _sednarBrowserHistory = _sednarBrowserHistory.slice(0, _sednarBrowserHistoryIndex + 1);
  _sednarBrowserHistory.push(path);
  _sednarBrowserHistoryIndex = _sednarBrowserHistory.length - 1;
  _sednarUpdateFinderNavButtons();
}

window.sednarBrowserGoBack = function() {
  if (_sednarBrowserHistoryIndex <= 0) return;
  _sednarBrowserHistoryIndex -= 1;
  sednarBrowserNavigate(_sednarBrowserHistory[_sednarBrowserHistoryIndex], true);
};

window.sednarBrowserGoForward = function() {
  if (_sednarBrowserHistoryIndex >= _sednarBrowserHistory.length - 1) return;
  _sednarBrowserHistoryIndex += 1;
  sednarBrowserNavigate(_sednarBrowserHistory[_sednarBrowserHistoryIndex], true);
};

window.sednarBrowserRefresh = function() {
  if (_sednarBrowserPath) sednarBrowserNavigate(_sednarBrowserPath, true);
};

function _sednarRenderFinderRows(items, selectedPath, currentPath) {
  const tbody = document.getElementById("sednar-browser-list");
  if (!tbody) return;
  let rowsHtml = "";
  const parentPath = _sednarGetParentPath(currentPath);
  if (parentPath) {
    const parentEsc = parentPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    rowsHtml += `<tr class="sednar-finder-row theme-transition is-folder is-parent" data-path="${parentEsc}" onclick="sednarBrowserNavigate('${parentEsc}'); return false;">
      <td><div class="sednar-finder-name-cell"><img class="sednar-finder-icon" src="${_sednarFolderIcon(false)}" alt=""/><span>..</span></div></td>
      <td>—</td>
      <td>Folder</td>
      <td>—</td>
    </tr>`;
  }
  if (!items || !items.length) {
    tbody.innerHTML = rowsHtml || '<tr><td colspan="4" style="padding:24px;text-align:center;opacity:0.6;">Empty folder</td></tr>';
    return;
  }
  rowsHtml += items.map(function(it) {
    const isDir = it.is_dir || it.type === "folder";
    const esc = (it.path || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const name = (it.name || "").replace(/</g, "&lt;");
    const selected = selectedPath && it.path === selectedPath;
    const rowClass = "sednar-finder-row theme-transition" + (isDir ? " is-folder" : " is-file") + (selected ? " is-selected" : "");
    const icon = _sednarFinderIcon(it);
    const size = isDir ? "—" : _sednarFormatFileSize(it.size);
    const kind = (it.kind || (isDir ? "Folder" : "Document")).replace(/</g, "&lt;");
    const date = _sednarFormatFinderDate(it.mtime);
    const click = isDir
      ? `onclick="sednarBrowserNavigate('${esc}'); return false;"`
      : `onclick="sednarBrowserSelectFolder('${esc}', false); return false;" ondblclick="sednarBrowserActivateSelection('${esc}', false); return false;"`;
    const isFav = isDir && _sednarIsFavorite(it.path);
    const favStar = isDir
      ? `<button type="button" class="sednar-finder-fav-star${isFav ? " is-fav" : ""}" title="${isFav ? "Remove from Locations" : "Add to Locations"}" onclick="sednarBrowserToggleFavorite('${esc}', event); return false;">${isFav ? _SEDNAR_STAR_FILLED : _SEDNAR_STAR_OUTLINE}</button>`
      : "";
    return `<tr class="${rowClass}" data-path="${esc}" ${click}>
      <td><div class="sednar-finder-name-cell"><img class="sednar-finder-icon" src="${icon}" alt=""/><span>${name}</span>${favStar}</div></td>
      <td>${size}</td>
      <td>${kind}</td>
      <td>${date}</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rowsHtml;
}

window.sednarBrowserFilterList = function(query) {
  const q = String(query || "").trim().toLowerCase();
  let base = _sednarBrowserItems;
  if (!_sednarSettingsGet("showHiddenFiles")) {
    base = base.filter(function(it) { return !String(it.name || "").startsWith("."); });
  }
  const filtered = !q ? base : base.filter(function(it) {
    return (it.name || "").toLowerCase().includes(q);
  });
  const sorted = _sednarSortFinderItems(filtered);
  _sednarUpdateFinderSortHeaders();
  _sednarRenderFinderRows(sorted, _sednarBrowserSelected, _sednarBrowserPath);
};

window.openSednarProjectBrowser = function() {
  const modal = document.getElementById("sednarProjectBrowserModal");
  if (!modal) return;
  _sednarBrowserMode = "folder";
  _sednarBrowserOnSelect = null;
  modal.classList.add("open");
  _sednarBrowserSelected = null;
  _sednarBrowserHistory = [];
  _sednarBrowserHistoryIndex = -1;
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const search = document.getElementById("sednar-finder-search");
  if (search) search.value = "";
  const sel = document.getElementById("sednar-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  let start = "~";
  try { start = localStorage.getItem("sednarBrowserLastPath") || sednarProjectPath || "~"; } catch (e) {}
  _sednarRenderFinderFavorites();
  _sednarMaybeSetHomePath(start);
  _sednarBrowserPath = start;
  sednarBrowserNavigate(start);
};

window.openSednarFileBrowser = function(onSelect, startPath, extensions) {
  const modal = document.getElementById("sednarProjectBrowserModal");
  if (!modal) return;
  _sednarBrowserMode = "file";
  _sednarBrowserOnSelect = typeof onSelect === "function" ? onSelect : null;
  _sednarBrowserFileExtensions = Array.isArray(extensions) && extensions.length ? extensions : null;
  modal.classList.add("open");
  _sednarBrowserSelected = null;
  _sednarBrowserHistory = [];
  _sednarBrowserHistoryIndex = -1;
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const search = document.getElementById("sednar-finder-search");
  if (search) search.value = "";
  const sel = document.getElementById("sednar-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  let start = startPath || "~";
  try { if (!startPath) start = localStorage.getItem("sednarBrowserLastPath") || "~"; } catch (e) {}
  _sednarRenderFinderFavorites();
  _sednarMaybeSetHomePath(start);
  _sednarBrowserPath = start;
  sednarBrowserNavigate(start);
};

window.openSednarFolderBrowser = function(onSelect, startPath) {
  const modal = document.getElementById("sednarProjectBrowserModal");
  if (!modal) return;
  _sednarBrowserMode = "folder";
  _sednarBrowserOnSelect = typeof onSelect === "function" ? onSelect : null;
  _sednarBrowserFileExtensions = null;
  modal.classList.add("open");
  _sednarBrowserSelected = null;
  _sednarBrowserHistory = [];
  _sednarBrowserHistoryIndex = -1;
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const search = document.getElementById("sednar-finder-search");
  if (search) search.value = "";
  const sel = document.getElementById("sednar-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  let start = startPath || "~";
  try { if (!startPath) start = localStorage.getItem("sednarBrowserLastPath") || "~"; } catch (e) {}
  _sednarRenderFinderFavorites();
  _sednarMaybeSetHomePath(start);
  _sednarBrowserPath = start;
  sednarBrowserNavigate(start);
};

window.closeSednarProjectBrowser = function() {
  const modal = document.getElementById("sednarProjectBrowserModal");
  if (modal) modal.classList.remove("open");
  if (_sednarBrowserSock && _sednarBrowserListHandler) {
    _sednarBrowserSock.off("ide_files_list", _sednarBrowserListHandler);
    _sednarBrowserListHandler = null;
  }
  _sednarBrowserMode = "folder";
  _sednarBrowserOnSelect = null;
  _sednarBrowserFileExtensions = null;
};

window.sednarBrowserNavigate = function(path, skipHistory) {
  _sednarBrowserPath = path;
  if (!skipHistory) _sednarPushBrowserHistory(path);
  else _sednarUpdateFinderNavButtons();
  _sednarBrowserSelected = null;
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const sel = document.getElementById("sednar-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  const tbody = document.getElementById("sednar-browser-list");
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;opacity:0.6;">Loading…</td></tr>';
  _sednarRenderFinderBreadcrumb(path);
  _sednarUpdateFinderSidebarActive(path);
  if (!sednarProjectPath) updateSednarExplorerHeader();
  const sock = _sednarEnsureBrowserSocket();
  if (_sednarBrowserListHandler) sock.off("ide_files_list", _sednarBrowserListHandler);
  _sednarBrowserListHandler = function(data) {
    if (!data) return;
    const matches = data.requested_path !== undefined ? data.requested_path === path : data.path === path;
    if (!matches) return;
    if (data.error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:24px;color:#ef4444;">${data.error}</td></tr>`;
      return;
    }
    const actualPath = data.path || path;
    if (path === "~") {
      _sednarBrowserHomePath = actualPath;
      _sednarUpdateFinderSidebarHomeLabel();
    } else {
      _sednarMaybeSetHomePath(actualPath);
    }
    _sednarBrowserPath = actualPath;
    _sednarRenderFinderBreadcrumb(actualPath);
    _sednarUpdateFinderSidebarActive(actualPath);
    try { localStorage.setItem("sednarBrowserLastPath", actualPath); } catch (e) {}
    if (!sednarProjectPath) updateSednarExplorerHeader();
    _sednarBrowserItems = data.files || [];
    const search = document.getElementById("sednar-finder-search");
    window.sednarBrowserFilterList(search ? search.value : "");
    sednarBrowserSelectFolder(actualPath, true);
  };
  sock.on("ide_files_list", _sednarBrowserListHandler);
  sock.emit("ide_list_files", { path: path });
};

window.sednarBrowserSelectFolder = function(path, isFolder) {
  if (!path) return;
  _sednarBrowserSelected = path;
  document.querySelectorAll("#sednar-browser-list .sednar-finder-row").forEach(function(row) {
    row.classList.toggle("is-selected", row.dataset.path === path);
  });
  const sel = document.getElementById("sednar-browser-selected");
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (_sednarBrowserMode === "file") {
    if (isFolder) {
      if (sel) { sel.textContent = ""; sel.style.display = "none"; }
      if (btn) btn.disabled = true;
    } else if (!_sednarBrowserExtensionAllowed(path)) {
      if (sel) { sel.textContent = "Unsupported file type"; sel.style.display = "block"; }
      if (btn) btn.disabled = true;
    } else {
      if (sel) { sel.textContent = path; sel.style.display = "none"; }
      if (btn) btn.disabled = false;
    }
    return;
  }
  if (isFolder) {
    if (sel) { sel.textContent = path; sel.style.display = "none"; }
    if (btn) btn.disabled = false;
  } else {
    if (sel) { sel.textContent = "Select a folder to open as project"; sel.style.display = "block"; }
    if (btn) btn.disabled = true;
  }
};

window.sednarBrowserNewFolder = function() {
  const name = prompt("New folder name:");
  if (!name || !name.trim()) return;
  const sock = _sednarEnsureBrowserSocket();
  sock.off("ide_mkdir_result");
  sock.on("ide_mkdir_result", function(data) {
    sock.off("ide_mkdir_result");
    if (data.error) {
      alert(data.error);
      return;
    }
    sednarBrowserNavigate(data.parent || _sednarBrowserPath);
  });
  sock.emit("ide_mkdir", { path: _sednarBrowserPath, name: name.trim() });
};

window.sednarBrowserActivateSelection = function(path, isFolder) {
  sednarBrowserSelectFolder(path, isFolder);
  const btn = document.getElementById("sednarBrowserSelectBtn");
  if (btn && !btn.disabled) selectSednarProjectFromBrowser();
};

window.selectSednarProjectFromBrowser = function() {
  if (!_sednarBrowserSelected) return;
  const path = _sednarBrowserSelected;
  const onSelect = _sednarBrowserOnSelect;
  closeSednarProjectBrowser();
  if (onSelect) {
    onSelect(path);
    return;
  }
  setSednarProject(path);
};

window.toggleSednarAgentPane = function(forceOpen) {

  const panel = document.getElementById("sednar-agent-panel");
  const divider = document.getElementById("ide-agent-divider");
  if (!panel) return;
  void forceOpen;
  panel.style.display = "flex";
  if (!window._sednarAgentDefaultWidthApplied) {
    panel.style.width = "420px";
    window._sednarAgentDefaultWidthApplied = true;
  }
  if (divider) divider.style.display = "block";
  _sednarInitChatTabs();
  _sednarBindChatScrollWheel();
  const out = getSednarChatOutput();
  if (out) requestAnimationFrame(function() { out.scrollTop = out.scrollHeight; });
  if (window.ideEditor) {
    setTimeout(() => { try { window.ideEditor.layout(); } catch (e) {} }, 100);
  }
};

let _sednarChatAbortController = null;
let _sednarStatusRow = null;
let _sednarStatusMsg = null;
let _sednarCurrentUserRow = null;
let _sednarAssistantStreamEl = null;
let _sednarChatStarted = false;

function getSednarChatOutput() {
  return document.getElementById("sednar-chat-messages");
}

function _sednarTruncateTabTitle(text, maxLen) {
  let t = String(text || "");
  try {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = t;
    t = decoder.value || t;
  } catch (e) {}
  t = t
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_#>\[\](){}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "New chat";
  maxLen = maxLen || 28;
  return t.length <= maxLen ? t : t.slice(0, maxLen - 1).trimEnd() + "\u2026";
}

function _sednarNormalizeProjectKey(path) {
  if (!path) return "";
  return String(path).replace(/\\/g, "/").replace(/\/+$/, "");
}

function _sednarSnapshotTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    title: tab.title,
    sessionId: tab.sessionId,
    messagesHtml: tab.messagesHtml,
    chatStarted: !!tab.chatStarted,
    planFile: tab.planFile || "",
    costUsd: tab.costUsd || 0,
    contextUsed: tab.contextUsed || 0,
    contextLimit: tab.contextLimit || 0,
    contextBreakdown: tab.contextBreakdown || null,
    contextCompactAt: tab.contextCompactAt || 0,
    contextModel: tab.contextModel || "",
    contextCached: tab.contextCached || 0,
  };
}

function _sednarSaveTabsForProject(path) {
  const key = _sednarNormalizeProjectKey(path);
  if (!key) return;
  _sednarSaveActiveChatTabState();
  sednarTabsByProject[key] = {
    tabs: sednarChatTabs.map(_sednarSnapshotTab),
    activeTabId: sednarActiveChatTabId,
    tabCounter: sednarChatTabCounter,
  };
  _sednarPersistTabsStorage(path);
  sednarChatTabs.forEach(function(tab) {
    if (tab.messagesHtml && tab.sessionId) {
      _sednarPersistChatSnapshot(path, tab);
    }
  });
}

const _sednarBackgroundProjectChats = {};

function _sednarStashRunningProjectChats(path) {
  const key = _sednarNormalizeProjectKey(path);
  if (!key || !sednarChatTabs.some(function(t) { return t.agentRunning; })) return false;
  const current = _sednarGetActiveChatTab();
  if (current) {
    _sednarSaveTurnCtxToTab(current);
    _sednarSyncTabStreamOutput(current);
    _sednarPrepareTabStreamBackground(current);
  }
  _sednarBackgroundProjectChats[key] = {
    path: path,
    stateKey: _sednarWorkspaceStateKey() || key,
    tabs: sednarChatTabs,
    activeTabId: sednarActiveChatTabId,
    tabCounter: sednarChatTabCounter,
  };
  return true;
}

function _sednarBackgroundEntryForTab(tab) {
  if (!tab) return null;
  for (const key in _sednarBackgroundProjectChats) {
    const entry = _sednarBackgroundProjectChats[key];
    if (entry.tabs.indexOf(tab) !== -1) return entry;
  }
  return null;
}

function _sednarFindBackgroundChatTab(sessionId) {
  if (!sessionId) return null;
  for (const key in _sednarBackgroundProjectChats) {
    const tab = _sednarBackgroundProjectChats[key].tabs.find(function(t) { return t.sessionId === sessionId; });
    if (tab) return tab;
  }
  return null;
}

function _sednarPersistBackgroundProjectChats(entry, tab) {
  if (!entry) return;
  _sednarPersistChatSnapshot(entry.path, tab, entry.stateKey);
  const snapshot = {
    tabs: entry.tabs.map(_sednarSnapshotTab),
    activeTabId: entry.activeTabId,
    tabCounter: entry.tabCounter,
  };
  sednarTabsByProject[_sednarNormalizeProjectKey(entry.path)] = snapshot;
  try { _sednarStorageSet(SEDNAR_TABS_STORAGE_PREFIX + entry.stateKey, JSON.stringify(snapshot)); } catch (e) {}
}

function _sednarStopBackgroundProjectChats(key) {
  const entry = _sednarBackgroundProjectChats[key];
  if (!entry) return;
  delete _sednarBackgroundProjectChats[key];
  entry.tabs.forEach(function(tab) {
    if (tab.agentRunning) _sednarAbortTabTurn(tab, { saveState: false });
  });
}

function _sednarLoadTabsForProject(path) {
  const key = _sednarNormalizeProjectKey(path);
  const live = _sednarBackgroundProjectChats[key];
  if (live) {
    delete _sednarBackgroundProjectChats[key];
    sednarChatTabs = live.tabs;
    sednarActiveChatTabId = live.activeTabId;
    sednarChatTabCounter = live.tabCounter;
    const shown = _sednarGetActiveChatTab() || sednarChatTabs[0];
    if (shown) {
      sednarActiveChatTabId = shown.id;
      sednarAgentSessionId = shown.sessionId || _sednarNewChatSessionId();
      shown.sessionId = sednarAgentSessionId;
      _sednarClearTabUnread(shown);
      _sednarLoadChatTabState(shown);
      if (shown.agentRunning && shown._backgroundOutput) {
        const out = getSednarChatOutput();
        if (out) out.innerHTML = shown._backgroundOutput.innerHTML;
        shown._backgroundOutput = null;
      }
      _sednarSyncTurnPointersFromDom();
      if (shown.queueWaiting && !shown.agentRunning) setTimeout(function() { _sednarMaybeRunQueue(shown); }, 250);
    }
    _sednarRenderChatTabs();
    _sednarSyncGlobalRunningFromActiveTab();
    _sednarSyncPermissionToolbar();
    return;
  }
  let saved = sednarTabsByProject[key];
  if (!saved || !saved.tabs || !saved.tabs.length) {
    saved = _sednarLoadTabsStorage(path);
  }
  if (saved && saved.tabs && saved.tabs.length) {
    sednarChatTabs = saved.tabs.map(function(t) {
      let title = t.title || "New chat";
      let messagesHtml = t.messagesHtml || "";
      if (_sednarIsLegacyTranscriptHtml(messagesHtml)) messagesHtml = "";
      if (!messagesHtml && t.chatStarted && t.sessionId) {
        const snap = _sednarLoadChatSnapshot(path, t.sessionId);
        if (snap && snap.messagesHtml) {
          messagesHtml = snap.messagesHtml;
          if (snap.title) title = snap.title;
        }
      }
      const started = !!(t.chatStarted && t.sessionId);
      return {
        id: t.id,
        title: title,
        sessionId: started ? t.sessionId : _sednarNewChatSessionId(),
        messagesHtml: messagesHtml,
        chatStarted: started,
        planFile: t.planFile || "",
        abortController: null,
        agentRunning: false,
        hasUnread: false,
        costUsd: t.costUsd || 0,
        contextUsed: t.contextUsed || 0,
        contextLimit: t.contextLimit || 0,
        contextBreakdown: t.contextBreakdown || null,
        contextCompactAt: t.contextCompactAt || 0,
        contextModel: t.contextModel || "",
        contextCached: t.contextCached || 0,
      };
    });
    sednarActiveChatTabId = saved.activeTabId || sednarChatTabs[0].id;
    sednarChatTabCounter = saved.tabCounter || sednarChatTabs.length;
  } else {
    sednarChatTabs = [];
    sednarActiveChatTabId = null;
    sednarChatTabCounter = 0;
    sednarAgentSessionId = null;
    _sednarInitChatTabs();
  }
  const activeTab = _sednarGetActiveChatTab();
  if (activeTab) {
    sednarAgentSessionId = activeTab.sessionId || _sednarNewChatSessionId();
    activeTab.sessionId = sednarAgentSessionId;
    if (activeTab.chatStarted && activeTab.sessionId) {
      if (activeTab.agentRunning) {
        _sednarLoadChatTabState(activeTab);
      } else if (activeTab.messagesHtml && String(activeTab.messagesHtml).trim()) {
        _sednarLoadChatTabState(activeTab);
      } else {
        _sednarFetchSessionIntoTab(activeTab, activeTab.sessionId, {});
      }
    } else {
      _sednarLoadChatTabState(activeTab);
    }
  } else {
    sednarAgentSessionId = _sednarNewChatSessionId();
  }
  _sednarRenderChatTabs();
  _sednarSyncGlobalRunningFromActiveTab();
}

function _sednarSyncTabStreamOutput(tab) {
  if (!tab) return;
  if (_sednarIsActiveTab(tab)) {
    const out = getSednarChatOutput();
    if (out) tab.messagesHtml = out.innerHTML;
  } else if (tab._backgroundOutput) {
    tab.messagesHtml = tab._backgroundOutput.innerHTML;
  }
}

function _sednarPrepareTabStreamBackground(tab) {

  if (!tab || !tab.agentRunning) return;
  if (!_sednarIsActiveTab(tab)) return;
  const out = getSednarChatOutput();
  if (!out) return;
  if (!_sednarChatOutputBelongsToTab(out, tab)) return;

  const cloned = out.cloneNode(true);
  const tmp = document.createElement("div");
  tmp.innerHTML = cloned.innerHTML;

  tab.messagesHtml = tmp.innerHTML;
  tab._backgroundOutput = tmp;
  _sednarSyncTurnPointersFromOutput(tmp, tab);
}

function _sednarEnsureBackgroundOutput(tab) {

  if (!tab) return null;
  if (_sednarIsActiveTab(tab)) {
    return getSednarChatOutput();
  }
  if (!tab._backgroundOutput) {
    tab._backgroundOutput = document.createElement("div");
    tab._backgroundOutput.innerHTML = tab.messagesHtml || "";
  }
  return tab._backgroundOutput;
}

function _sednarGetOutputForTab(tab) {
  if (!tab) return getSednarChatOutput();
  if (_sednarIsActiveTab(tab)) {
    if (tab._backgroundOutput) {
      const live = getSednarChatOutput();
      if (live) live.innerHTML = tab._backgroundOutput.innerHTML;
      tab._backgroundOutput = null;
    }
    return getSednarChatOutput();
  }
  return _sednarEnsureBackgroundOutput(tab);
}

function _sednarGetOutputForSession(sessionId) {
  const tab = sednarChatTabs.find(function(t) { return t.sessionId === sessionId; });
  return tab ? _sednarGetOutputForTab(tab) : null;
}

function _sednarGetTabStreamOutput(tab) {
  return _sednarGetOutputForTab(tab);
}

function _sednarAbortTabTurn(tab, options) {
  const opts = options || {};
  if (!tab) return;
  const stopSessionId = tab.sessionId || (_sednarIsActiveTab(tab) ? sednarAgentSessionId : "");
  if (tab.agentRunning && stopSessionId) {
    fetch("/sednar/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: stopSessionId }),
    }).catch(function() {});
  }
  if (tab.abortController) {
    try {
      tab.abortController.abort();
    } catch (e) {}
    tab.abortController = null;
  }
  if (tab.agentRunning) {
    tab.agentRunning = false;
    if (opts.saveState !== false && _sednarIsActiveTab(tab)) {
      _sednarSaveActiveChatTabState();
    }
  }
  if (_sednarIsActiveTab(tab)) {
    _sednarChatAbortController = null;
    _sednarClearPendingToolSteps();
  }
}

function _sednarIsTabRunning(tab) {
  return !!(tab && tab.agentRunning);
}

function _sednarGetRunningTab() {
  for (let i = 0; i < sednarChatTabs.length; i++) {
    if (sednarChatTabs[i].agentRunning) return sednarChatTabs[i];
  }
  return null;
}

function _sednarSyncGlobalRunningFromActiveTab() {
  const tab = _sednarGetActiveChatTab();
  sednarAgentRunning = _sednarIsTabRunning(tab);
  _setSednarChatBusy(sednarAgentRunning);
}

function _sednarNewChatSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return "sednar_" + window.crypto.randomUUID().replace(/-/g, "");
  }
  const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return "sednar_" + randomPart.replace(/[^a-z0-9]/g, "").padEnd(32, "0").slice(0, 32);
}

function _sednarGetActiveChatTab() {
  return sednarChatTabs.find(function(t) { return t.id === sednarActiveChatTabId; }) || null;
}

function _sednarIsActiveTab(tab) {
  return !!tab && tab === _sednarGetActiveChatTab();
}

function _sednarSaveActiveChatTabState() {
  const tab = _sednarGetActiveChatTab();
  if (!tab) return;
  const out = getSednarChatOutput();
  if (out && !tab.agentRunning) {
    _sednarFinalizeDomForSnapshot(out);
  }
  tab.messagesHtml = out ? out.innerHTML : "";
  tab.sessionId = sednarAgentSessionId || tab.sessionId;
  tab.chatStarted = _sednarChatStarted;
  if (sednarProjectPath && tab.sessionId && _sednarTabHasConversation(tab)) {
    _sednarPersistChatSnapshot(sednarProjectPath, tab);
  }
}

function _sednarSyncTurnPointersFromOutput(out, tab) {
  if (!out) {
    _sednarStatusRow = null;
    _sednarStatusMsg = null;
    _sednarCurrentUserRow = null;
    _sednarAssistantStreamEl = null;
    if (tab) _sednarSaveTurnCtxToTab(tab);
    return;
  }
  _sednarStatusRow = out.querySelector("#sednar-agent-status-row");
  _sednarStatusMsg = _sednarStatusRow ? _sednarStatusRow.querySelector(".sednar-status-msg") : null;
  const userRows = out.querySelectorAll(".sednar-user-row");
  _sednarCurrentUserRow = userRows.length ? userRows[userRows.length - 1] : null;
  const streamRows = out.querySelectorAll(".sednar-assistant-row .sednar-stream-msg");
  _sednarAssistantStreamEl = streamRows.length ? streamRows[streamRows.length - 1] : null;

  if (tab) {
    if (!(tab._assistantStreamRow && out.contains(tab._assistantStreamRow))) {
      tab._assistantStreamRow = null;
    }
  }
  const runningOuter = out.querySelector(".sednar-activity-wrap-outer.is-running");
  _sednarRunningActivityEl = runningOuter || null;
  if (tab) _sednarSaveTurnCtxToTab(tab);
}

function _sednarSyncTurnPointersFromDom() {
  _sednarSyncTurnPointersFromOutput(getSednarChatOutput(), _sednarGetActiveChatTab());
  _sednarLastToolLabel = "";
  _sednarLastTool = "";
  _sednarLastToolArgs = {};
  _sednarThinkingStartMs = null;
  _sednarPendingDurationS = null;
  _sednarPendingDurationMs = null;
  _sednarCancelThoughtStreamFlush();
  _sednarPendingThoughtContent = "";
  _sednarStreamingThoughtContentEl = null;
  _sednarStopThinkingTicker();
}

function _sednarSanitizeLoadedActivityHtml(out) {
  if (!out) return;

  out.querySelectorAll(".is-running").forEach(function(el) {
    el.classList.remove("is-running");
  });
  out.querySelectorAll(".ui-shimmer").forEach(function(el) {
    el.classList.remove("ui-shimmer");
  });
  out.querySelectorAll(".sednar-term-action").forEach(function(el) {
    if (el.textContent === "Running") el.textContent = "Ran";
  });
  out.querySelectorAll(".sednar-term-card-title").forEach(function(el) {
    if (el.textContent === "Running command") el.textContent = "Ran command";
  });
  out.querySelectorAll(".sednar-activity-wrap-outer.is-running").forEach(function(el) {
    el.classList.remove("is-running");
  });
  out.querySelectorAll(".sednar-thought-wrap.is-streaming").forEach(function(el) {
    el.classList.remove("is-streaming");
  });
  _sednarRemoveGenericWorkingActivities(out);
  out.querySelectorAll(".sednar-run-spinner").forEach(function(el) {
    el.remove();
  });
}

function _sednarUpdateUserMessageCollapseState(out) {
  if (!out) return;
  // scrollHeight is the full content height even when the bubble is clamped, so every row can be
  // measured first and written after: one layout for the batch instead of one per row.
  const measured = [];
  Array.from(out.querySelectorAll(".chat-row.sednar-user-row")).forEach(function(row) {
    const msg = row.querySelector(".chat-msg.user");
    if (!msg) return;
    const styles = getComputedStyle(msg);
    let lineHeight = parseFloat(styles.lineHeight || "0");
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(styles.fontSize || "0");
      lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.55 : 18;
    }
    measured.push({ row: row, collapsible: msg.scrollHeight > lineHeight * 6.2 + 2 });
  });
  measured.forEach(function(item) {
    item.row.classList.toggle("is-collapsible", item.collapsible);
    if (!item.collapsible) item.row.classList.remove("is-expanded");
  });
}

function _sednarScheduleUserMessageCollapseState(out) {
  if (!out) return;
  requestAnimationFrame(function() {
    _sednarUpdateUserMessageCollapseState(out);
  });
}

function _sednarFinalizeDomForSnapshot(out) {
  if (!out) return;
  _sednarSanitizeLoadedActivityHtml(out);
  _sednarSettleRunningAgents(out);
  _sednarUpdateUserMessageCollapseState(out);
  Array.from(out.querySelectorAll(".sednar-agent-steps-row")).forEach(function(row) {
    if (!row.querySelector(".sednar-activity-wrap-outer")) {
      row.remove();
    }
  });
}

function _sednarLoadChatTabState(tab) {
  if (!tab) return;
  if (!tab.agentRunning) tab._backgroundOutput = null;
  if (!tab.messagesHtml && tab.chatStarted && tab.sessionId && sednarProjectPath) {
    const snap = _sednarLoadChatSnapshot(sednarProjectPath, tab.sessionId);
    if (snap && snap.messagesHtml) {
      tab.messagesHtml = snap.messagesHtml;
      if (snap.title) tab.title = _sednarTruncateTabTitle(snap.title);
    }
  }
  _sednarResetTurnState();
  sednarAgentSessionId = tab.sessionId || _sednarNewChatSessionId();
  tab.sessionId = sednarAgentSessionId;
  _sednarChatStarted = !!tab.chatStarted;
  const out = getSednarChatOutput();
  if (out) {
    _sednarMarkChatOutputForTab(out, tab);
    out.innerHTML = tab.messagesHtml || "";
  }
  _sednarStripStaleWelcome(out);
  _sednarSanitizeLoadedActivityHtml(out);
  if (out && !tab.agentRunning && out.querySelector(".sednar-term-card:not([data-done])")) {
    _sednarSettleRunningTerminalCards(out, { keepEmpty: true });
    tab.messagesHtml = out.innerHTML;
  }
  if (out && !tab.agentRunning && out.querySelector('.sednar-agent-row[data-state="running"]')) {
    _sednarSettleRunningAgents(out);
    tab.messagesHtml = out.innerHTML;
  }
  _sednarPostProcessRestoredOutput(out);
  _sednarScheduleUserMessageCollapseState(out);
  _sednarSyncTurnPointersFromDom();
  _sednarSaveTurnCtxToTab(tab);
  _sednarSchedulePendingChangesRefresh();
  _sednarSyncComposerPlaceholder();
  _sednarRenderQuestionsBar();
  _sednarRenderQueueBar();
}

function _sednarRenderChatTabs() {
  const list = document.getElementById("sednar-chat-tabs-list");
  if (!list) return;
  if (!list.dataset.clicksBound) {
    list.dataset.clicksBound = "1";
    list.addEventListener("click", function(e) {
      const tabEl = e.target.closest ? e.target.closest(".sednar-chat-tab") : null;
      if (!tabEl || !list.contains(tabEl)) return;
      if (e.target.closest(".sednar-chat-tab-close")) {
        e.preventDefault();
        e.stopPropagation();
        _sednarCloseChatTab(tabEl.dataset.tabId);
        return;
      }
      _sednarSwitchChatTab(tabEl.dataset.tabId);
    });
  }
  const html = sednarChatTabs.map(function(tab) {
    const active = tab.id === sednarActiveChatTabId;
    const tabTitle = _sednarTruncateTabTitle(tab.title);
    return '<div class="sednar-chat-tab theme-transition' + (active ? " active" : "") + (tab.agentRunning ? " is-running" : "") +
      (tab.hasUnread && !tab.agentRunning ? " has-unread" : "") + '" data-key="' + _sednarEscapeHtml(String(tab.id)) + '" data-tab-id="' + _sednarEscapeHtml(String(tab.id)) +
      '" role="tab" tabindex="' + (active ? "0" : "-1") + '" aria-selected="' + (active ? "true" : "false") + '">' +
      '<span class="sednar-chat-tab-icon">' + _sednarGetTabIconHtml(tab) + "</span>" +
      '<span class="sednar-chat-tab-label" title="' + _sednarEscapeHtml(tabTitle) + '">' + _sednarEscapeHtml(tabTitle) + "</span>" +
      '<button type="button" class="sednar-chat-tab-close theme-transition" title="Close chat" aria-label="Close chat">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      "</button></div>";
  }).join("");
  _sednarMorph(list, html);
  _sednarUpdateBackgroundStatusPill();
  _sednarUpdateChatCostDisplay(_sednarGetActiveChatTab());
  _sednarUpdateContextRing(_sednarGetActiveChatTab());
  _sednarRenderProjectTabs();
}

let SEDNAR_USD_TO_INR = 95;
let _sednarFxRateFetchStarted = false;

function _sednarLoadCachedFxRate() {
  try {
    const raw = localStorage.getItem("sednar_usd_to_inr");
    const val = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(val) && val > 0) SEDNAR_USD_TO_INR = val;
  } catch (e) {}
}

function _sednarFetchFxRateOnce() {
  if (_sednarFxRateFetchStarted) return;
  _sednarFxRateFetchStarted = true;
  _sednarLoadCachedFxRate();
  fetch("/sednar/fx-rate")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      const rate = data && Number(data.rate);
      if (Number.isFinite(rate) && rate > 0) {
        SEDNAR_USD_TO_INR = rate;
        try { localStorage.setItem("sednar_usd_to_inr", String(rate)); } catch (e) {}
        _sednarUpdateChatCostDisplay(_sednarGetActiveChatTab());
      }
    })
    .catch(function() {});
}

const SEDNAR_INR_ICON_SVG =
  '<span class="sednar-chat-cost-icon" aria-hidden="true">₹</span>';

function _sednarFormatInrCount(amount) {
  const rounded = Math.round(amount);
  if (rounded < 1000) return String(rounded);
  const thousands = rounded / 1000;
  return thousands.toFixed(1) + "K";
}

const _sednarCostMarkerAnim = { raf: null, shownInr: 0, tabId: null };

function _sednarRenderCostMarkerValue(el, roundedInr) {
  el.innerHTML = SEDNAR_INR_ICON_SVG +
    '<span class="sednar-chat-cost-value">' + _sednarEscapeHtml(_sednarFormatInrCount(roundedInr)) + "</span>";
}

function _sednarBumpCostMarker(el) {
  el.classList.remove("is-ticking");
  void el.offsetWidth;
  el.classList.add("is-ticking");
}

function _sednarAnimateCostMarker(el, fromVal, toVal) {
  if (_sednarCostMarkerAnim.raf) {
    cancelAnimationFrame(_sednarCostMarkerAnim.raf);
    _sednarCostMarkerAnim.raf = null;
  }
  const delta = toVal - fromVal;

  if (delta <= 3) {
    _sednarCostMarkerAnim.shownInr = toVal;
    _sednarRenderCostMarkerValue(el, toVal);
    _sednarBumpCostMarker(el);
    return;
  }

  const start = performance.now();
  const duration = Math.min(450, Math.max(120, delta * 4));
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 2);
    const current = Math.round(fromVal + delta * eased);
    if (current !== _sednarCostMarkerAnim.shownInr) {
      _sednarCostMarkerAnim.shownInr = current;
      _sednarRenderCostMarkerValue(el, current);
    }
    if (t < 1) {
      _sednarCostMarkerAnim.raf = requestAnimationFrame(step);
    } else {
      _sednarCostMarkerAnim.raf = null;
      _sednarCostMarkerAnim.shownInr = toVal;
      _sednarRenderCostMarkerValue(el, toVal);
      _sednarBumpCostMarker(el);
    }
  }
  _sednarCostMarkerAnim.raf = requestAnimationFrame(step);
}

function _sednarUpdateContextRing(tab) {
  const ring = document.getElementById("sednar-context-ring");
  if (!ring) return;
  const arc = ring.querySelector(".sednar-ctx-arc");
  if (!arc) return;
  const used = Number(tab && tab.contextUsed) || 0;
  const limit = Number(tab && tab.contextLimit) || 0;
  const frac = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const circumference = 56.549;
  arc.style.strokeDashoffset = String(circumference * (1 - frac));
  ring.classList.toggle("is-warn", frac >= 0.75 && frac < 0.9);
  ring.classList.toggle("is-full", frac >= 0.9);
  const label = limit > 0
    ? "Context: " + Math.round(frac * 100) + "% used (" + used.toLocaleString() + " / " + limit.toLocaleString() + " tokens)"
    : "Context: 0% used (updates after the first message)";
  ring.removeAttribute("title");  // the hover card says it, with the breakdown
  ring.setAttribute("aria-label", label);
  ring.tabIndex = 0;
  _sednarBindContextCard(ring);
  if (_sednarContextCard && _sednarContextCard.classList.contains("is-open")) _sednarRenderContextCard(tab);
}

// ---- Context ring hover card: how full the context window is, and what fills it.

const _SEDNAR_CONTEXT_PARTS = [
  { key: "conversation", label: "Conversation", color: "#5b8def" },
  { key: "tool_results", label: "Tool results", color: "#e0884a" },
  { key: "system", label: "System prompt & rules", color: "#4fb286" },
  { key: "tools", label: "Tool definitions", color: "#a78bfa" },
  { key: "images", label: "Images", color: "#d9728f" },
];
let _sednarContextCard = null;
let _sednarContextCardHideTimer = null;

function _sednarFormatTokens(n) {
  n = Math.max(0, Number(n) || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

function _sednarContextCardHtml(tab) {
  const used = Number(tab && tab.contextUsed) || 0;
  const limit = Number(tab && tab.contextLimit) || 0;
  const esc = _sednarEscapeHtml;
  if (!limit) {
    return '<div class="sednar-ctx-card-head"><span>Context window</span></div>' +
      '<div class="sednar-ctx-card-bar"></div>' +
      '<p class="sednar-ctx-card-note">Shows how full the model\'s context is after the first reply.</p>';
  }
  const pct = function(n) { return Math.max(0, Math.min(100, (n / limit) * 100)); };
  const parts = tab.contextBreakdown || {};
  const known = _SEDNAR_CONTEXT_PARTS.filter(function(p) { return Number(parts[p.key]) > 0; });
  const rows = known.length ? known : [{ key: "_used", label: "Used", color: "#5b8def" }];
  const valueOf = function(p) { return p.key === "_used" ? used : Number(parts[p.key]) || 0; };
  let bar = "";
  rows.forEach(function(p) { bar += '<span style="width:' + pct(valueOf(p)).toFixed(2) + "%;background:" + p.color + '"></span>'; });
  const compactAt = Number(tab.contextCompactAt) || 0;
  const marker = compactAt > 0 && compactAt < 1 ? '<i class="sednar-ctx-card-mark" style="left:' + (compactAt * 100).toFixed(1) + '%" title="Auto-compacts here"></i>' : "";
  let list = "";
  rows.forEach(function(p) {
    const v = valueOf(p);
    list += '<div class="sednar-ctx-card-row"><span class="sednar-ctx-card-dot" style="background:' + p.color + '"></span>' +
      '<span class="sednar-ctx-card-label">' + esc(p.label) + "</span>" +
      '<span class="sednar-ctx-card-num">' + _sednarFormatTokens(v) + "</span>" +
      '<span class="sednar-ctx-card-pct">' + (used ? Math.round((v / used) * 100) : 0) + "%</span></div>";
  });
  list += '<div class="sednar-ctx-card-row is-free"><span class="sednar-ctx-card-dot"></span><span class="sednar-ctx-card-label">Free</span>' +
    '<span class="sednar-ctx-card-num">' + _sednarFormatTokens(Math.max(0, limit - used)) + "</span><span class=\"sednar-ctx-card-pct\"></span></div>";
  return '<div class="sednar-ctx-card-head"><span>Context window</span><span class="sednar-ctx-card-total">' +
      _sednarFormatTokens(used) + " / " + _sednarFormatTokens(limit) + " (" + Math.round(pct(used)) + "%)</span></div>" +
    '<div class="sednar-ctx-card-bar">' + bar + marker + "</div>" +
    '<div class="sednar-ctx-card-rows">' + list + "</div>";
}

function _sednarRenderContextCard(tab) {
  if (_sednarContextCard) _sednarContextCard.innerHTML = _sednarContextCardHtml(tab);
}

function _sednarPlaceContextCard(ring) {
  const card = _sednarContextCard;
  const r = ring.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
  card.style.left = Math.round(left) + "px";
  card.style.top = Math.round(top) + "px";
}

function _sednarBindContextCard(ring) {
  if (ring._contextCardBound) return;
  ring._contextCardBound = true;
  const show = function() {
    clearTimeout(_sednarContextCardHideTimer);
    if (!_sednarContextCard) {
      _sednarContextCard = document.createElement("div");
      _sednarContextCard.className = "sednar-ctx-card";
      _sednarContextCard.setAttribute("role", "tooltip");
      (document.getElementById("sednar-agent-panel") || document.body).appendChild(_sednarContextCard);
    }
    _sednarRenderContextCard(_sednarGetActiveChatTab());
    _sednarContextCard.classList.add("is-open");
    _sednarPlaceContextCard(ring);
  };
  const hide = function() {
    clearTimeout(_sednarContextCardHideTimer);
    _sednarContextCardHideTimer = setTimeout(function() {
      if (_sednarContextCard) _sednarContextCard.classList.remove("is-open");
    }, 80);
  };
  ring.addEventListener("mouseenter", show);
  ring.addEventListener("focus", show);
  ring.addEventListener("mouseleave", hide);
  ring.addEventListener("blur", hide);
}

function _sednarUpdateChatCostDisplay(tab, options) {
  const el = document.getElementById("sednar-chat-cost-marker");
  if (!el) return;
  const opts = options || {};
  const usd = (tab && tab.costUsd) || 0;
  const inr = usd * SEDNAR_USD_TO_INR;
  const targetRounded = Math.round(inr);
  const tabId = tab ? tab.id : null;

  if (usd <= 0 || targetRounded <= 0) {
    if (_sednarCostMarkerAnim.raf) {
      cancelAnimationFrame(_sednarCostMarkerAnim.raf);
      _sednarCostMarkerAnim.raf = null;
    }
    _sednarCostMarkerAnim.shownInr = 0;
    _sednarCostMarkerAnim.tabId = tabId;
    el.style.display = "none";
    return;
  }

  const titleText = "Estimated spend for this chat: $" + usd.toFixed(4) +
    " (₹" + inr.toFixed(2) + " at ₹" + SEDNAR_USD_TO_INR + "/$1)";
  if (el.title !== titleText) el.title = titleText;
  if (el.style.display === "none") el.style.display = "";

  const sameTab = _sednarCostMarkerAnim.tabId === tabId;
  _sednarCostMarkerAnim.tabId = tabId;

  if (sameTab && !_sednarCostMarkerAnim.raf && _sednarCostMarkerAnim.shownInr === targetRounded) {
    return;
  }

  if (opts.animate && sameTab && _sednarCostMarkerAnim.shownInr < targetRounded) {
    _sednarAnimateCostMarker(el, _sednarCostMarkerAnim.shownInr, targetRounded);
  } else {
    if (_sednarCostMarkerAnim.raf) {
      cancelAnimationFrame(_sednarCostMarkerAnim.raf);
      _sednarCostMarkerAnim.raf = null;
    }
    _sednarCostMarkerAnim.shownInr = targetRounded;
    _sednarRenderCostMarkerValue(el, targetRounded);
  }
}

function _sednarUpdateBackgroundStatusPill() {
  const pill = document.getElementById("sednar-chat-background-status");
  if (!pill) return;
  const badgeEl = pill.querySelector(".sednar-chat-background-badge");
  const runningCount = sednarChatTabs.filter(function(t) {
    return t.agentRunning && t.id !== sednarActiveChatTabId;
  }).length;
  if (runningCount > 0) {
    pill.style.display = "";
    if (badgeEl) badgeEl.textContent = String(runningCount);
    pill.title = runningCount === 1 ?
      "1 chat still running in the background" :
      runningCount + " chats still running in the background";
  } else {
    pill.style.display = "none";
  }
}

function _sednarSwitchChatTab(tabId) {
  if (!tabId || tabId === sednarActiveChatTabId) return;
  const currentTab = _sednarGetActiveChatTab();
  if (currentTab) {
    _sednarSaveTurnCtxToTab(currentTab);
    _sednarSyncTabStreamOutput(currentTab);
    if (!currentTab.agentRunning) {
      _sednarSaveActiveChatTabState();
    }
    _sednarPrepareTabStreamBackground(currentTab);
  }
  const tab = sednarChatTabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  sednarActiveChatTabId = tabId;
  _sednarClearTabUnread(tab);
  _sednarLoadChatTabState(tab);
  if (tab.agentRunning && tab._backgroundOutput) {
    const out = getSednarChatOutput();
    if (out) out.innerHTML = tab._backgroundOutput.innerHTML;
    tab._backgroundOutput = null;
  }
  _sednarSyncTurnPointersFromDom();
  _sednarSyncGlobalRunningFromActiveTab();
  _sednarSyncPermissionToolbar();
  _sednarRenderChatTabs();
  const out = getSednarChatOutput();
  if (out) requestAnimationFrame(function() { out.scrollTop = out.scrollHeight; });
  if (sednarProjectPath) _sednarSaveTabsForProject(sednarProjectPath);
  if (tab.queueWaiting && !tab.agentRunning) setTimeout(function() { _sednarMaybeRunQueue(tab); }, 250);
}

function _sednarCloseChatTab(tabId) {
  const tabIndex = sednarChatTabs.findIndex(function(t) { return t.id === tabId; });
  if (tabIndex === -1) return;
  const closingTab = sednarChatTabs[tabIndex];
  const wasActive = sednarActiveChatTabId === tabId;
  closingTab.queuedMessages = [];
  _sednarPersistQueue(closingTab);
  if (wasActive) {
    _sednarSaveActiveChatTabState();
  }
  _sednarAbortTabTurn(closingTab, { saveState: wasActive });
  if (sednarChatTabs.length === 1) {
    const tab = sednarChatTabs[0];
    tab.title = "New chat";
    tab.messagesHtml = "";
    tab.chatStarted = false;
    tab.sessionId = _sednarNewChatSessionId();
    tab.hasUnread = false;
    tab.pendingPermissionRequestId = "";
    tab.pendingQuestion = null;
    _sednarLoadChatTabState(tab);
    _sednarSyncGlobalRunningFromActiveTab();
    _sednarSyncPermissionToolbar();
    _sednarRenderChatTabs();
    if (sednarProjectPath) _sednarSaveTabsForProject(sednarProjectPath);
    return;
  }
  sednarChatTabs.splice(tabIndex, 1);
  if (wasActive) {
    const nextTab = sednarChatTabs[Math.max(0, tabIndex - 1)];
    sednarActiveChatTabId = nextTab.id;
    _sednarLoadChatTabState(nextTab);
    _sednarSyncGlobalRunningFromActiveTab();
  }
  _sednarRenderChatTabs();
  if (sednarProjectPath) _sednarSaveTabsForProject(sednarProjectPath);
}

function _sednarCreateChatTab(title, options) {
  const opts = options || {};
  const currentTab = _sednarGetActiveChatTab();
  if (currentTab && !opts.skipSave) {
    _sednarSaveTurnCtxToTab(currentTab);
    _sednarSyncTabStreamOutput(currentTab);
    _sednarSaveActiveChatTabState();
    _sednarPrepareTabStreamBackground(currentTab);
  }
  const tabId = "chat-" + (++sednarChatTabCounter);
  const tab = {
    id: tabId,
    title: title || "New chat",
    sessionId: _sednarNewChatSessionId(),
    messagesHtml: "",
    chatStarted: false,
    abortController: null,
    agentRunning: false,
    hasUnread: false,
    pendingPermissionRequestId: "",
    costUsd: 0,
  };
  sednarChatTabs.push(tab);
  if (opts.activate !== false) {
    sednarActiveChatTabId = tabId;
    _sednarClearTabUnread(tab);
    _sednarLoadChatTabState(tab);
    _sednarSyncGlobalRunningFromActiveTab();
  }
  _sednarRenderChatTabs();
  if (sednarProjectPath) _sednarSaveTabsForProject(sednarProjectPath);
  return tabId;
}

let _sednarChatTabsBound = false;

function _sednarBindChatTabControlsOnce() {
  if (_sednarChatTabsBound) return;
  _sednarChatTabsBound = true;
  const addBtn = document.getElementById("sednar-chat-tab-add");
  if (addBtn) {
    addBtn.addEventListener("click", function(e) {
      e.preventDefault();
      window.createSednarChatTab();
    });
  }
  const historyBtn = document.getElementById("sednar-chat-session-history");
  if (historyBtn) {
    historyBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.toggleSednarSessionMenu();
    });
  }
  const backgroundStatusBtn = document.getElementById("sednar-chat-background-status");
  if (backgroundStatusBtn) {
    backgroundStatusBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.toggleSednarSessionMenu();
    });
  }
  const projectTabsStrip = document.getElementById("ide-project-tabs");
  if (projectTabsStrip) {
    projectTabsStrip.addEventListener("click", function(e) {
      if (!e.target.closest("#ide-activity-recent")) return;
      e.preventDefault();
      e.stopPropagation();
      window.toggleSednarProjectMenu();
    });
  }
  const sessionMenu = document.getElementById("sednar-chat-session-menu");
  if (sessionMenu) {
    sessionMenu.addEventListener("click", function(e) { e.stopPropagation(); });
  }
  const projectMenu = document.getElementById("sednar-project-menu");
  if (projectMenu) {
    projectMenu.addEventListener("click", function(e) { e.stopPropagation(); });
  }
  if (!window._sednarSessionMenuGlobalBound) {
    window._sednarSessionMenuGlobalBound = true;
    document.addEventListener("click", function(e) {
      if (_sednarSessionMenuOpen) {
        if (!e.target.closest("#sednar-chat-session-menu") &&
            !e.target.closest("#sednar-chat-session-history") &&
            !e.target.closest("#sednar-chat-background-status")) {
          closeSednarSessionMenu();
        }
      }
      if (_sednarProjectMenuOpen) {
        if (!e.target.closest("#sednar-project-menu") &&
            !e.target.closest("#ide-activity-recent") &&
            !e.target.closest(".sednar-chat-session-item-menu")) {
          closeSednarProjectMenu();
        }
      }
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        if (_sednarSessionMenuOpen) closeSednarSessionMenu();
        if (_sednarProjectMenuOpen) closeSednarProjectMenu();
      }
    });
  }
}

function _sednarInitChatTabs() {
  _sednarBindChatTabControlsOnce();
  if (sednarChatTabs.length) return;
  const sessionId = sednarProjectPath
    ? _sednarNewChatSessionId()
    : (sednarAgentSessionId || _sednarNewChatSessionId());
  sednarChatTabCounter += 1;
  const tab = {
    id: "chat-" + sednarChatTabCounter,
    title: "New chat",
    sessionId: sessionId,
    messagesHtml: getSednarChatOutput() ? getSednarChatOutput().innerHTML : "",
    chatStarted: _sednarChatStarted,
    abortController: null,
    agentRunning: false,
    hasUnread: false,
    costUsd: 0,
  };
  sednarChatTabs.push(tab);
  sednarActiveChatTabId = tab.id;
  sednarAgentSessionId = sessionId;
  _sednarRenderChatTabs();
}

function _sednarUpdateActiveChatTabTitle(text, force) {
  const tab = _sednarGetActiveChatTab();
  if (!tab) return;
  const nextTitle = _sednarTruncateTabTitle(text);
  if (force || tab.title === "New chat" || !tab.title) {
    tab.title = nextTitle;
    _sednarRenderChatTabs();
  }
}

window.createSednarChatTab = function() {
  return _sednarCreateChatTab("New chat");
};

window.switchSednarChatTab = function(tabId) {
  _sednarSwitchChatTab(tabId);
};

const _SEDNAR_REVERT_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3.5 3 6l2.5 2.5"></path><path d="M3 6h6.25a3.75 3.75 0 0 1 0 7.5H6.5"></path></svg>';

function _sednarDecorateUserRows(rows) {
  rows.forEach(function(row) {
    const bubble = row.querySelector(".chat-msg.user");
    if (!bubble || bubble.querySelector(".sednar-user-revert")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sednar-user-revert";
    btn.title = "Restore checkpoint: undo file changes from here on and edit this message";
    btn.setAttribute("aria-label", "Restore checkpoint");
    btn.innerHTML = _SEDNAR_REVERT_ICON_SVG;
    bubble.appendChild(btn);
  });
}

function _sednarSetComposerText(text) {
  const input = document.getElementById("sednar-chat-input");
  if (!input) return;
  input.textContent = String(text || "");
  input.classList.toggle("is-empty", !input.textContent);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function _sednarEnsureConfirmDialog() {
  let dialog = document.getElementById("sednar-confirm-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "sednar-confirm-dialog";
  dialog.className = "sednar-confirm-dialog theme-transition";
  dialog.style.display = "none";
  dialog.innerHTML =
    '<div class="sednar-confirm-modal theme-transition" role="alertdialog" aria-modal="true" aria-labelledby="sednar-confirm-title" aria-describedby="sednar-confirm-message">' +
    '<div id="sednar-confirm-title" class="sednar-confirm-title"></div>' +
    '<div id="sednar-confirm-message" class="sednar-confirm-message"></div>' +
    '<pre id="sednar-confirm-detail" class="sednar-confirm-detail" hidden></pre>' +
    '<div class="sednar-confirm-footer">' +
    '<button type="button" class="sednar-confirm-btn theme-transition" data-sednar-confirm="cancel">Cancel</button>' +
    '<button type="button" class="sednar-confirm-btn is-primary theme-transition" data-sednar-confirm="ok">OK</button>' +
    "</div></div>";
  document.body.appendChild(dialog);
  return dialog;
}

function _sednarOpenConfirmDialog(opts) {
  const dialog = _sednarEnsureConfirmDialog();
  const detail = dialog.querySelector("#sednar-confirm-detail");
  const cancelBtn = dialog.querySelector('[data-sednar-confirm="cancel"]');
  const okBtn = dialog.querySelector('[data-sednar-confirm="ok"]');
  dialog.querySelector("#sednar-confirm-title").textContent = opts.title || "";
  dialog.querySelector("#sednar-confirm-message").textContent = opts.message || "";
  detail.textContent = opts.detail || "";
  detail.hidden = !opts.detail;
  cancelBtn.textContent = opts.cancelLabel || "Cancel";
  cancelBtn.style.display = opts.cancelLabel === null ? "none" : "";
  okBtn.textContent = opts.confirmLabel || "OK";
  dialog.classList.toggle("is-error", !!opts.isError);
  dialog.style.display = "flex";
  return new Promise(function(resolve) {
    function done(result) {
      dialog.style.display = "none";
      dialog.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onClick(e) {
      const btn = e.target && e.target.closest ? e.target.closest("[data-sednar-confirm]") : null;
      if (btn) {
        e.stopPropagation();
        done(btn.getAttribute("data-sednar-confirm") === "ok");
      } else if (e.target === dialog) {
        e.stopPropagation();
        done(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter" && document.activeElement !== cancelBtn) {
        e.preventDefault();
        e.stopPropagation();
        done(true);
      }
    }
    dialog.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    okBtn.focus();
  });
}

function _sednarShowErrorDialog(title, message, detail) {
  return _sednarOpenConfirmDialog({
    title: title,
    message: message,
    detail: detail,
    confirmLabel: "Close",
    cancelLabel: null,
    isError: true,
  });
}

function _sednarSessionPost(path, extra) {
  const tab = _sednarGetActiveChatTab();
  if (!tab || !tab.sessionId) return Promise.reject(new Error("This chat has no saved session yet."));
  if (!sednarProjectPath) return Promise.reject(new Error("No project is open."));
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({
      project_path: sednarProjectPath,
      session_id: tab.sessionId,
      workspace: _sednarCurrentWorkspacePayload(),
    }, extra || {})),
  }).then(function(resp) {
    return resp.text().then(function(text) {
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (data && data.success) return data;
      const err = new Error((data && data.error) || "The server returned HTTP " + resp.status + (resp.statusText ? " " + resp.statusText : "") + ".");
      const failed = data && Array.isArray(data.failed) ? data.failed : [];
      err.detail = failed.length
        ? failed.join("\n")
        : (data ? "" : String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400));
      err.status = resp.status;
      throw err;
    });
  });
}

function _sednarRestoreRequest(userIndex) {
  return _sednarSessionPost("/sednar/session/checkpoints/restore", { user_index: userIndex, rewind_chat: true });
}

function _sednarRestoreCheckpoint(row) {
  const out = getSednarChatOutput();
  const tab = _sednarGetActiveChatTab();
  if (!out || !row || !tab) return;
  if (tab.agentRunning || sednarAgentRunning) {
    _sednarShowErrorDialog("Can't restore right now", "Stop the agent before restoring a checkpoint.", "");
    return;
  }
  const rows = Array.from(out.querySelectorAll(":scope > .chat-row.sednar-user-row"));
  const userIndex = rows.indexOf(row);
  if (userIndex < 0) return;
  _sednarOpenConfirmDialog({
    title: "Restore to before this message?",
    message: "File changes the agent made from this message on will be undone, and the conversation will go back to this point.",
    confirmLabel: "Restore",
    cancelLabel: "Cancel",
  }).then(function(ok) {
    if (!ok) return null;
    const bubbleText = String((row.querySelector(".sednar-user-text") || row.querySelector(".chat-msg.user") || {}).textContent || "").trim();
    return _sednarRestoreRequest(userIndex).then(function(data) {
      _sednarReloadChangedFiles(data);
      let node = row;
      while (node) {
        const next = node.nextElementSibling;
        node.remove();
        node = next;
      }
      _sednarCurrentUserRow = null;
      tab.messagesHtml = out.innerHTML;
      if (sednarProjectPath) _sednarPersistChatSnapshot(sednarProjectPath, tab);
      _sednarSetComposerText(data.prompt || bubbleText);
      const changed = (data.restored || []).length + (data.removed || []).length;
      _sednarShowIdeToast(changed ? "Restored " + changed + " file" + (changed === 1 ? "" : "s") : "Restored checkpoint");
    }).catch(function(err) {
      return _sednarShowErrorDialog("Couldn't restore the checkpoint", (err && err.message) || "Unknown error.", (err && err.detail) || "");
    }).finally(function() {
      _sednarRefreshPendingChanges();
    });
  });
}

function _sednarBindUserRevertOnce() {
  if (window._sednarUserRevertBound) return;
  window._sednarUserRevertBound = true;
  document.addEventListener("click", function(e) {
    const btn = e.target && e.target.closest ? e.target.closest(".sednar-user-revert") : null;
    if (!btn || !btn.closest("#sednar-chat-messages")) return;
    e.preventDefault();
    e.stopPropagation();
    _sednarRestoreCheckpoint(btn.closest(".chat-row.sednar-user-row"));
  }, true);
}

const _sednarRowGapCache = new WeakMap();

function _sednarRowGap(prev, row) {
  const cached = _sednarRowGapCache.get(row);
  if (cached && cached.prev === prev) return cached.gap;
  const gap = Math.max(parseFloat(getComputedStyle(prev).marginBottom) || 0, parseFloat(getComputedStyle(row).marginTop) || 0);
  _sednarRowGapCache.set(row, { prev: prev, gap: gap });
  return gap;
}

// Where each user row would sit if nothing were pinned. A pinned row's
// offsetTop is its stuck position, so the previous row can't be trusted
// when it is itself a user row: those positions are carried row by row.
function _sednarUserRowNaturalTops(rows) {
  const natural = new Map();
  return rows.map(function(row) {
    const prev = row.previousElementSibling;
    let top = 0;
    if (prev) {
      const prevTop = natural.has(prev) ? natural.get(prev) : prev.offsetTop;
      top = prevTop + prev.offsetHeight + _sednarRowGap(prev, row);
    }
    natural.set(row, top);
    return top;
  });
}

function _sednarSyncStickyUserRows(out) {
  out = out || getSednarChatOutput();
  if (!out) return;
  const rows = Array.from(out.querySelectorAll(":scope > .chat-row.sednar-user-row"));
  if (!rows.length) return;
  _sednarDecorateUserRows(rows);
  _sednarBindUserRevertOnce();
  const top = out.scrollTop;
  const naturalTops = _sednarUserRowNaturalTops(rows);
  let current = 0;
  naturalTops.forEach(function(natural, i) { if (natural <= top + 1) current = i; });
  rows.forEach(function(row, i) {
    row.classList.toggle("is-unpinned", i !== current);
    row.classList.toggle("is-stuck", i === current && naturalTops[i] < top - 0.5);
  });
  // The next user message pushes the pinned one up and out rather than
  // sliding over it, the way section headers hand over in a list.
  const pinned = rows[current];
  const next = rows[current + 1];
  let push = 0;
  if (pinned.classList.contains("is-stuck") && next) {
    const pinTop = parseFloat(getComputedStyle(pinned).top) || 0;
    const nextOnScreen = naturalTops[current + 1] - top;
    push = Math.max(0, pinTop + pinned.offsetHeight + _sednarRowGap(pinned, next) - nextOnScreen);
  }
  rows.forEach(function(row) {
    const value = row === pinned && push > 0 ? "translateY(" + (-push).toFixed(1) + "px)" : "";
    if (row.style.transform !== value) row.style.transform = value;
    row.classList.toggle("is-pushed", row === pinned && push > 0);
  });
}

let _sednarStickyRaf = null;

function _sednarScheduleStickyUserRows(out) {
  if (_sednarStickyRaf) return;
  _sednarStickyRaf = requestAnimationFrame(function() {
    _sednarStickyRaf = null;
    _sednarSyncStickyUserRows(out);
  });
}

function _sednarBindChatScrollWheel() {
  const out = getSednarChatOutput();
  if (!out || out.dataset.wheelBound === "1") return;
  out.dataset.wheelBound = "1";
  out.addEventListener("wheel", function(e) {
    if (e.deltaY < 0) _sednarScrollPinned = false;
    if (out.scrollHeight <= out.clientHeight + 1) return;
    const delta = e.deltaY;
    const atTop = out.scrollTop <= 0;
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 1;
    if ((delta < 0 && !atTop) || (delta > 0 && !atBottom)) {
      e.stopPropagation();
    }
  }, { passive: true, capture: true });
  // Pinned to the bottom while a reply streams in: only a move up (wheel, keys, the scrollbar) unpins. Content
  // growing under the view also makes the gap large for a moment, and that must not count as the reader leaving.
  let lastTop = out.scrollTop;
  out.addEventListener("scroll", function() {
    const top = out.scrollTop;
    const gap = out.scrollHeight - out.clientHeight - top;
    if (gap <= 2) _sednarScrollPinned = true;
    else if (gap > 40 && top < lastTop - 1) _sednarScrollPinned = false;
    lastTop = top;
    // Pinned rows move with this scroll frame, not the next one, so the hand-over never wobbles.
    _sednarSyncStickyUserRows(out);
  }, { passive: true });
  // A command card's output follows its own tail only while the reader has not scrolled up in it.
  out.addEventListener("scroll", function(e) {
    const scroll = e.target;
    if (!scroll || !scroll.classList || !scroll.classList.contains("sednar-term-scroll")) return;
    const card = scroll.closest(".sednar-term-card");
    if (card) card._sednarScrolledUp = scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 24;
  }, { passive: true, capture: true });
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(function() {
      if (_sednarScrollPinned) _sednarAutoScroll(out);
    }).observe(out, { childList: true, subtree: true, characterData: true });
  }
  out.addEventListener("load", function() {
    if (_sednarScrollPinned) _sednarAutoScroll(out);
  }, true);
  if (typeof ResizeObserver !== "undefined") {
    let lastHeight = out.clientHeight;
    new ResizeObserver(function() {
      const height = out.clientHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      if (_sednarScrollPinned) out.scrollTop = out.scrollHeight;
    }).observe(out);
  }
}

function _sednarShowChatContainer() {
  _sednarChatStarted = true;
  _sednarSyncComposerPlaceholder();
}

function _sednarIsPreservedChatRow(row) {
  if (!row) return true;
  if (row.classList.contains("sednar-user-row") ||
      row.classList.contains("sednar-assistant-row") ||
      row.classList.contains("sednar-agent-steps-row") ||
      row.classList.contains("sednar-status-row") ||
      row.classList.contains("sednar-diff-row") ||
      row.classList.contains("sednar-command-output") ||
      row.classList.contains("lazie-command-output") ||
      row.classList.contains("sednar-permission-row")) {
    return true;
  }

  if (row.querySelector(".sednar-diff-block, .sednar-code-card, .lazie-code-card, .sednar-json-display-block, .sednar-table-display-block, .sednar-csv-display-block")) {
    return true;
  }
  return false;
}

function _sednarChatOutputBelongsToTab(out, tab) {
  if (!out || !tab) return false;
  if (!tab.sessionId) return true;
  const domSessionId = out.dataset ? (out.dataset.sednarSessionId || "") : "";

  return !!domSessionId && domSessionId === tab.sessionId;
}

function _sednarMarkChatOutputForTab(out, tab) {
  if (!out || !out.dataset) return;
  if (tab && tab.sessionId) out.dataset.sednarSessionId = tab.sessionId;
  else delete out.dataset.sednarSessionId;
}

const _sednarSnapshotTimers = new Map();

function _sednarScheduleChatSnapshot(projectPath, tab, stateKey) {
  // Serialising the transcript and writing it to storage is main-thread work; during a turn it is asked
  // for after every diff and command, so it is coalesced and run when the browser is idle.
  if (!tab || !tab.sessionId) return;
  const key = tab.sessionId;
  const pending = _sednarSnapshotTimers.get(key);
  if (pending) return;
  const run = function() {
    _sednarSnapshotTimers.delete(key);
    _sednarPersistChatSnapshot(projectPath, tab, stateKey);
  };
  const handle = typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(run, { timeout: 1500 })
    : setTimeout(run, 400);
  _sednarSnapshotTimers.set(key, handle);
}

function _sednarSyncActiveTabMessagesHtml() {
  const tab = _sednarGetActiveChatTab();
  const out = getSednarChatOutput();
  if (tab && out && _sednarIsActiveTab(tab) && _sednarChatOutputBelongsToTab(out, tab)) {
    tab.messagesHtml = out.innerHTML;
    if (sednarProjectPath && tab.sessionId && tab.messagesHtml) _sednarScheduleChatSnapshot(sednarProjectPath, tab);
  }
}

function _sednarClearWelcomePlaceholder(out) {
  if (!out) return;
  Array.from(out.querySelectorAll(":scope > .chat-row")).forEach(function(row) {
    if (_sednarIsPreservedChatRow(row)) return;
    if (row.querySelector(".sednar-plain-msg")) row.remove();
  });
}

function _sednarStripStaleWelcome(out) {
  if (!out || !out.querySelector(".sednar-user-row")) return;
  _sednarClearWelcomePlaceholder(out);
}

let _sednarScrollPinned = true;
let _sednarAutoScrollRaf = null;
let _sednarAutoScrollTarget = null;

function _sednarAutoScroll(out) {
  out = out || getSednarChatOutput();
  if (out) _sednarScheduleStickyUserRows(out);
  if (!out || !_sednarScrollPinned) return;
  _sednarAutoScrollTarget = out;
  if (_sednarAutoScrollRaf) return;
  _sednarAutoScrollRaf = requestAnimationFrame(function() {
    _sednarAutoScrollRaf = null;
    const target = _sednarAutoScrollTarget;
    _sednarAutoScrollTarget = null;
    if (!target || !_sednarScrollPinned) return;
    const bottom = target.scrollHeight - target.clientHeight;
    if (target.scrollTop < bottom - 1) target.scrollTop = bottom;
  });
}

function _sednarScrollChatToBottom(out) {
  if (!out) return;
  _sednarScrollPinned = true;
  out.scrollTop = out.scrollHeight;
  requestAnimationFrame(function() {
    try { out.scrollTop = out.scrollHeight; } catch (e) {}
  });
}

function _sednarUpdateChatWelcome() {
  const out = getSednarChatOutput();
  if (!out || _sednarChatStarted) return;
  out.innerHTML = "";
}

function _setSednarChatBusy(busy) {
  document.querySelectorAll('.chatbot-composer[data-sidebar-section="sednar"]').forEach(function(el) {
    el.classList.toggle("is-llm-answering", busy);
    var stop = el.querySelector(".chatbot-composer-stop-btn");
    if (stop) stop.style.display = busy ? "inline-flex" : "";
  });
  _sednarSyncComposerDraftState();
  const chatOut = getSednarChatOutput();
  if (chatOut) chatOut.classList.toggle("is-turn-running", !!busy || !!chatOut.querySelector(":scope > .sednar-user-row"));
  if (chatOut && !busy) _sednarScheduleRegroup(chatOut);
  _sednarRenderQueueBar();
  _sednarRenderChangesBar(_sednarChangesFiles);
}

function _sednarIsGenericStatusMessage(msg) {
  const t = String(msg || "").trim();
  return !t || /^Working/i.test(t) || /^Explored project/i.test(t);
}

function _sednarTypingMarkup() {
  return typeof window.sednarChatWaitingMarkup === "function"
    ? window.sednarChatWaitingMarkup()
    : '<div class="wb-chat-waiting" aria-busy="true"><span class="wb-chat-wait-dot"></span><span class="wb-chat-wait-dot"></span><span class="wb-chat-wait-dot"></span></div>';
}

function _sednarGetAgentStepsRow(output) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  const rows = Array.from(output.querySelectorAll(".chat-row"));
  if (!rows.length) return null;
  const startIdx = _sednarCurrentUserRow ? rows.indexOf(_sednarCurrentUserRow) : -1;

  let lastIdx = rows.length - 1;
  while (lastIdx >= 0 && rows[lastIdx].classList.contains("sednar-assistant-row") &&
      !rows[lastIdx].classList.contains("sednar-narration-row")) {
    lastIdx -= 1;
  }
  if (lastIdx < 0) return null;
  const lastRow = rows[lastIdx];
  if (!lastRow.classList.contains("sednar-agent-steps-row")) return null;
  return lastIdx > startIdx ? lastRow : null;
}

function _sednarGetAssistantAnchor(output, tab) {

  if (!output) return null;
  const t = tab || _sednarGetActiveChatTab();
  if (t && t._assistantStreamRow && output.contains(t._assistantStreamRow)) {
    return t._assistantStreamRow;
  }
  return null;
}

function _sednarAppendChatRow(output, row, tab) {
  if (!output || !row) return;
  const anchor = _sednarGetAssistantAnchor(output, tab);
  if (anchor && anchor.parentNode === output) {
    output.insertBefore(row, anchor);
  } else {
    const statusRow = output.querySelector(".sednar-status-row, .sednar-status-row");
    if (statusRow && statusRow.parentNode === output) {
      output.insertBefore(row, statusRow);
    } else {
      output.appendChild(row);
    }
  }
}

function _sednarEnsureAgentStepsRow(output) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  let stepsRow = _sednarGetAgentStepsRow(output);
  if (!stepsRow) {
    stepsRow = document.createElement("div");
    stepsRow.className = "chat-row sednar-agent-steps-row";
    stepsRow.innerHTML = '<div class="chat-msg assistant sednar-agent-steps"></div>';
    _sednarAppendChatRow(output, stepsRow);
  }
  return stepsRow.querySelector(".sednar-agent-steps");
}

let _sednarLastToolLabel = "";
let _sednarLastTool = "";
let _sednarLastToolArgs = {};
let _sednarRunningActivityEl = null;
let _sednarThinkingStartMs = null;
let _sednarPendingDurationS = null;
let _sednarPendingDurationMs = null;
let _sednarPendingThoughtContent = "";
let _sednarThoughtToggleBound = false;
let _sednarStreamingThoughtContentEl = null;
let _sednarThinkingTicker = null;
let _sednarThoughtStreamFlushTimer = null;
let _sednarThoughtStreamRaf = null;
let _sednarLastProgressSeqBySession = {};
let _sednarActiveTurnIdBySession = {};
const _SEDNAR_MAX_THOUGHT_CHARS = 6000;
const _SEDNAR_THOUGHT_STREAM_FLUSH_MS = 33;

function _sednarCreateTurnCtx() {
  return {
    currentUserRow: null,
    assistantStreamEl: null,
    statusRow: null,
    statusMsg: null,
    runningActivityEl: null,
    lastToolLabel: "",
    lastTool: "",
    lastToolArgs: {},
    thinkingStartMs: null,
    pendingDurationS: null,
    pendingDurationMs: null,
    pendingThoughtContent: "",
    streamingThoughtContentEl: null,
  };
}

function _sednarSaveTurnCtxToTab(tab) {
  if (!tab) return;
  if (!tab._turnCtx) tab._turnCtx = _sednarCreateTurnCtx();
  const ctx = tab._turnCtx;
  ctx.currentUserRow = _sednarCurrentUserRow;
  ctx.assistantStreamEl = _sednarAssistantStreamEl;
  ctx.statusRow = _sednarStatusRow;
  ctx.statusMsg = _sednarStatusMsg;
  ctx.runningActivityEl = _sednarRunningActivityEl;
  ctx.lastToolLabel = _sednarLastToolLabel;
  ctx.lastTool = _sednarLastTool;
  ctx.lastToolArgs = _sednarLastToolArgs;
  ctx.thinkingStartMs = _sednarThinkingStartMs;
  ctx.pendingDurationS = _sednarPendingDurationS;
  ctx.pendingDurationMs = _sednarPendingDurationMs;
  ctx.pendingThoughtContent = _sednarPendingThoughtContent;
  ctx.streamingThoughtContentEl = _sednarStreamingThoughtContentEl;
}

function _sednarLoadTurnCtxFromTab(tab) {
  if (!tab || !tab._turnCtx) {
    _sednarResetTurnState();
    return;
  }
  const ctx = tab._turnCtx;
  _sednarCurrentUserRow = ctx.currentUserRow;
  _sednarAssistantStreamEl = ctx.assistantStreamEl;
  _sednarStatusRow = ctx.statusRow;
  _sednarStatusMsg = ctx.statusMsg;
  _sednarRunningActivityEl = ctx.runningActivityEl;
  _sednarLastToolLabel = ctx.lastToolLabel;
  _sednarLastTool = ctx.lastTool;
  _sednarLastToolArgs = ctx.lastToolArgs;
  _sednarThinkingStartMs = ctx.thinkingStartMs;
  _sednarPendingDurationS = ctx.pendingDurationS;
  _sednarPendingDurationMs = ctx.pendingDurationMs;
  _sednarPendingThoughtContent = ctx.pendingThoughtContent;
  _sednarStreamingThoughtContentEl = ctx.streamingThoughtContentEl;
}

function _sednarWithTabContext(tab, fn) {
  const activeTab = _sednarGetActiveChatTab();
  const isActive = !!tab && tab === activeTab;
  if (!isActive && activeTab) {
    _sednarSaveTurnCtxToTab(activeTab);
  }
  if (tab) {
    if (!isActive) {
      const tabOutput = _sednarGetOutputForTab(tab);
      if (tabOutput) _sednarSyncTurnPointersFromOutput(tabOutput, tab);
    } else {
      const liveOut = getSednarChatOutput();
      if (liveOut) _sednarResolveRunningActivityEl(liveOut);
    }
    _sednarLoadTurnCtxFromTab(tab);
    if (isActive) {
      const liveOut = getSednarChatOutput();
      if (liveOut) _sednarResolveRunningActivityEl(liveOut);
    }
  }
  try {
    return fn();
  } finally {
    if (tab) _sednarSaveTurnCtxToTab(tab);
    if (!isActive && activeTab) {
      _sednarLoadTurnCtxFromTab(activeTab);
    }
  }
}

function _sednarFindRunningActivityWrap(output) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  const stepsContainer = _sednarGetAgentStepsRow(output);
  if (!stepsContainer) return null;
  const outers = stepsContainer.querySelectorAll(".sednar-activity-wrap-outer.is-running");
  return outers.length ? outers[outers.length - 1] : null;
}

function _sednarResolveRunningActivityEl(output) {
  output = output || getSednarChatOutput();
  if (_sednarRunningActivityEl && output && output.contains(_sednarRunningActivityEl)) {
    return _sednarRunningActivityEl;
  }
  const found = _sednarFindRunningActivityWrap(output);
  if (found) _sednarRunningActivityEl = found;
  return _sednarRunningActivityEl;
}

function _sednarCleanupStaleThinkingLines(output, keepWrap) {
  output = output || getSednarChatOutput();
  const stepsContainer = _sednarGetAgentStepsRow(output);
  if (!stepsContainer) return;
  stepsContainer.querySelectorAll(".sednar-activity-wrap-outer.is-running").forEach(function(outer) {
    if (outer === keepWrap) return;
    const text = outer.querySelector(".sednar-activity-text");
    const label = String(text && text.textContent ? text.textContent : "").trim();
    if (_SEDNAR_THINKING_LABEL_RE.test(label)) outer.remove();
  });
}

function _sednarFindRunningThinkingWrap(output) {
  output = output || getSednarChatOutput();
  const stepsContainer = _sednarGetAgentStepsRow(output);
  if (!stepsContainer) return null;
  const thinking = [];
  stepsContainer.querySelectorAll(".sednar-activity-wrap-outer.is-running").forEach(function(outer) {
    const text = outer.querySelector(".sednar-activity-text");
    const label = String(text && text.textContent ? text.textContent : "").trim();
    if (_SEDNAR_THINKING_LABEL_RE.test(label)) thinking.push(outer);
  });
  const keep = thinking.length ? thinking[thinking.length - 1] : null;
  thinking.forEach(function(outer) {
    if (outer !== keep) outer.remove();
  });
  return keep;
}

function _sednarAdoptRunningThinking(output, label) {
  const existing = _sednarFindRunningThinkingWrap(output);
  if (!existing) return false;
  _sednarRunningActivityEl = existing;
  _sednarLastTool = "attempt_completion";
  _sednarLastToolArgs = {};
  _sednarLastToolLabel = label || "Thinking";
  if (!_sednarThinkingStartMs) _sednarThinkingStartMs = Date.now();
  const textEl = existing.querySelector(".sednar-activity-text");
  if (textEl) textEl.textContent = _sednarLastToolLabel;
  _sednarCleanupStaleThinkingLines(output, existing);
  return true;
}

function _sednarComputeThoughtDuration() {
  if (!_sednarThinkingStartMs) return 1;
  return Math.max(1, Math.round((Date.now() - _sednarThinkingStartMs) / 1000));
}

function _sednarComputeThoughtDurationMs() {
  if (!_sednarThinkingStartMs) return 0;
  return Math.max(0, Date.now() - _sednarThinkingStartMs);
}

function _sednarThoughtDurationLabel(seconds, durationMs) {
  const ms = Number(durationMs);
  if (Number.isFinite(ms) && ms > 0) {
    return ms < 500 ? "briefly" : Math.max(1, Math.round(ms / 1000)) + "s";
  }
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 ? Math.round(s) + "s" : "briefly";
}

var _SEDNAR_THINKING_LABEL_RE = /^(Thinking|Planning next moves)\b/i;

function _sednarIsThinkingLine() {
  return _sednarLastTool === "attempt_completion" && _SEDNAR_THINKING_LABEL_RE.test(String(_sednarLastToolLabel || "").trim());
}

function _sednarStopThinkingTicker() {
  if (_sednarThinkingTicker) {
    clearInterval(_sednarThinkingTicker);
    _sednarThinkingTicker = null;
  }
}

function _sednarUpdateThinkingLineLabel() {
  _sednarResolveRunningActivityEl();
  if (!_sednarRunningActivityEl || !_sednarIsThinkingLine()) return;
  const textEl = _sednarRunningActivityEl.querySelector(".sednar-activity-text");
  if (!textEl) return;
  if (textEl.textContent !== _sednarLastToolLabel) textEl.textContent = _sednarLastToolLabel;
}

function _sednarStartThinkingTicker() {
  _sednarStopThinkingTicker();
  _sednarUpdateThinkingLineLabel();
  _sednarThinkingTicker = setInterval(function() {
    if (!_sednarRunningActivityEl || !_sednarIsThinkingLine() || !sednarAgentRunning) {
      _sednarStopThinkingTicker();
      return;
    }
    _sednarUpdateThinkingLineLabel();
  }, 1000);
}

function _sednarThoughtParts() {
  const durationMs = _sednarPendingDurationMs || _sednarComputeThoughtDurationMs();
  return {
    verb: "Thought",
    detail: _sednarThoughtDurationLabel(_sednarPendingDurationS, durationMs),
    meta: "",
    thoughtContent: String(_sednarPendingThoughtContent || "").trim(),
  };
}

function _sednarBriefThoughtLine(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  if (/\n\s*\n/.test(raw) || /^#{1,6}\s/m.test(raw) || raw.length > 400) {
    return "";
  }
  const lines = raw.split(/\r?\n/);
  let line = "";
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "").replace(/\s+/g, " ").trim();
    if (t) {
      line = t;
      break;
    }
  }
  if (!line) return "";
  if (line.length > 160) return line.slice(0, 159).trimEnd() + "…";
  return line;
}

function _sednarSubagentSummary(goal) {
  let g = String(goal || "").replace(/\s+/g, " ").trim();
  if (!g) return "";
  g = g.replace(/^[\w][\w-]{0,28}:\s+/, "");
  let s = g.split(/(?<=[.!?])\s+/)[0] || g;
  if (s.length > 88) s = s.slice(0, 85).replace(/\s+\S*$/, "") + "…";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _sednarBasename(path) {
  if (!path) return "";
  const p = String(path).replace(/\\/g, "/");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function _sednarResolveProjectFilePath(filePath) {
  let p = String(filePath || "").trim().replace(/\\/g, "/");
  if (!p) return "";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return p;
  if (!sednarProjectPath) return p;
  let base = String(sednarProjectPath).replace(/\\/g, "/");
  if (base.length > 1 && base.endsWith("/")) base = base.slice(0, -1);
  const rel = p.replace(/^\.?\//, "");
  return base + "/" + rel;
}

function _sednarWorkspaceMetaForArgs(args, pathValue) {
  const a = args || {};
  let workspace = String(a.workspace || "").trim();
  const rawPath = String(pathValue || a.file_path || a.path || a.directory || "").trim().replace(/\\/g, "/");
  if (!workspace && rawPath && !rawPath.startsWith("/") && !/^[A-Za-z]:/.test(rawPath)) {
    const first = rawPath.split("/").filter(Boolean)[0] || "";
    const match = (sednarWorkspaceFolders || []).find(function(folder) {
      return String(folder.name || "") === first;
    });
    if (match) workspace = String(match.name || "").trim();
  }
  if (!workspace && rawPath && (sednarWorkspaceFolders || []).length > 1) {
    const primary = (sednarWorkspaceFolders || []).find(function(folder) { return folder.primary; });
    workspace = String((primary && primary.name) || "").trim();
  }
  return workspace ? "workspace " + workspace : "";
}

function _sednarMergeActivityMeta(meta, workspaceMeta) {
  const left = String(meta || "").trim();
  const right = String(workspaceMeta || "").trim();
  if (!left) return right;
  if (!right) return left;
  return left + " · " + right;
}

function _sednarFileActivityParts(verb, filePath, meta, args) {
  const detail = _sednarBasename(filePath) || String(filePath || "").trim();
  const parts = { verb: verb, detail: detail, meta: _sednarMergeActivityMeta(meta, _sednarWorkspaceMetaForArgs(args, filePath)) };
  const abs = _sednarResolveProjectFilePath(filePath);
  if (abs) parts.detailFilePath = abs;
  return parts;
}

function _sednarIsFileEditTool(tool) {
  const t = String(tool || "").toLowerCase();
  return t === "edit_file" || t === "write_file" || t === "multi_edit";
}

function _sednarEditLabelForKind(errorKind, errMsg) {
  const kind = String(errorKind || "").trim();
  const map = {
    multiple_matches: "Multiple matches found",
    no_matches: "No matches found",
    file_not_found: "File not found",
    invalid_input: "Invalid input",
  };

  const msg = String(errMsg || "").trim();
  if (kind === "file_not_found") return "File not found";
  if (kind === "invalid_input" && /missing required argument:\s*file_path/i.test(msg)) {
    return "Missing file path";
  }
  if (kind && map[kind]) return map[kind];
  if (/found multiple times/i.test(msg)) return "Multiple matches found";
  if (/not found in the file/i.test(msg)) return "No matches found";
  if (/^File not found:/i.test(msg)) return "File not found";
  if (/old string and new string are the same/i.test(msg)) return "Invalid input";
  return "Edit failed";
}

function _sednarEditFailedParts(args, message, errorKind) {
  const a = args || {};
  const fp = _sednarBasename(a.file_path) || "";
  const errMsg = String(message || "").trim();
  const kindStr = String(errorKind || "").trim();
  const parts = {
    verb: _sednarEditLabelForKind(kindStr, errMsg),
    detail: fp || errMsg,
    meta: "",
    fullErrorTitle: errMsg,
    isError: true,

    suppressActivity: [
      "no_matches",
      "multiple_matches",
      "file_not_found",
      "invalid_input",
    ].includes(kindStr),
  };
  if (a.file_path) {
    const abs = _sednarResolveProjectFilePath(a.file_path);
    if (abs) parts.detailFilePath = abs;
  }
  return parts;
}

function _sednarClearTransientEditFailure(filePath, stepsContainer) {
  if (!stepsContainer || !filePath) return;
  const base = _sednarBasename(filePath);
  const abs = _sednarResolveProjectFilePath(filePath);
  const outers = Array.from(stepsContainer.querySelectorAll(".sednar-activity-wrap-outer"));
  if (!outers.length) return;

  for (let i = outers.length - 1; i >= 0; i--) {
    const outer = outers[i];
    if (outer.classList.contains("is-running")) continue;
    const line = outer.querySelector(".sednar-activity-line.is-error");
    if (!line) continue;
    const detail = outer.querySelector(".sednar-activity-detail");
    if (!detail) continue;
    const text = (detail.textContent || "").trim();
    const linkedPath = outer.querySelector("[data-file-path]");
    const detailPath = linkedPath ? String(linkedPath.getAttribute("data-file-path") || "") : "";
    if (text === base || (abs && detailPath === abs)) {
      outer.remove();
      return;
    }
  }
}

function _sednarRecordEditFailure(args, message, errorKind, output) {
  output = output || getSednarChatOutput();
  const stepsContainer = _sednarEnsureAgentStepsRow(output);
  if (!stepsContainer) return null;
  const parts = _sednarEditFailedParts(args, message, errorKind);

  if (_sednarRunningActivityEl) {
    _sednarStopThinkingTicker();
    _sednarRunningActivityEl.remove();
    _sednarRunningActivityEl = null;
    _sednarPendingDurationS = null;
    _sednarPendingDurationMs = null;
    _sednarCancelThoughtStreamFlush();
    _sednarPendingThoughtContent = "";
    _sednarStreamingThoughtContentEl = null;
    _sednarThinkingStartMs = null;
  }
  if (!parts.suppressActivity) {
    _sednarAppendActivityParts(parts, false, output);
    _sednarAutoScroll(output);
  }
  return parts;
}

function _sednarTruncateMiddle(str, maxLen) {
  const s = String(str || "");
  const n = Math.max(0, maxLen | 0);
  if (!n || s.length <= n) return s;
  if (n <= 1) return "…";
  const head = Math.ceil((n - 1) / 2);
  const tail = Math.floor((n - 1) / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

function _sednarMcpToolInfo(tool, args) {
  const t = String(tool || "");
  const a = args || {};
  if (t.indexOf("mcp__") === 0) {
    const rest = t.slice(5);
    const idx = rest.indexOf("__");
    return idx === -1 ? { isMcp: true, server: "", name: rest } : { isMcp: true, server: rest.slice(0, idx), name: rest.slice(idx + 2) };
  }
  if (t === "call_mcp_tool") return { isMcp: true, server: String(a.server_name || ""), name: String(a.tool_name || "") };
  return { isMcp: false, server: "", name: "" };
}

function _sednarParseActivityParts(tool, args, message) {
  const a = args || {};
  const msg = String(message || "").trim();
  const t = String(tool || "").toLowerCase();
  const mcpInfo = _sednarMcpToolInfo(tool, a);
  if (mcpInfo.isMcp || /^Called MCP tool\b/i.test(msg)) {
    const toolName = mcpInfo.name || msg.replace(/^Called MCP tool\s*/i, "").trim();
    return { verb: "Ran", detail: toolName, meta: mcpInfo.server ? "(" + _sednarMcpDisplayName(mcpInfo.server) + ")" : "", mcpArgs: a, isMcp: true, kind: "mcp" };
  }

  if (t === "grep_repo" || msg.startsWith("Grepped")) {
    const gm = msg.match(/Grepped\s+`([\s\S]+)`\s+in\s+(.+)$/i);
    if (gm) return { verb: "Grepped", detail: gm[1], meta: "in " + gm[2].trim(), kind: "search" };
    let pat = a.pattern != null ? String(a.pattern) : "";
    if (!pat) {
      const m = msg.match(/Grepped\s+`([\s\S]+)`/i);
      pat = m ? m[1] : msg.replace(/^Grepped\s*/i, "").replace(/`?\s*$/, "");
    }
    const scope = String(a.directory || a.path || "").trim();
    const gf = String(a.glob_filter || "").trim();
    let meta = "";
    if (scope && gf) meta = "in " + _sednarBasename(scope) + " (" + gf + ")";
    else if (scope) meta = "in " + _sednarBasename(scope);
    else if (gf) meta = "in " + gf;
    return { verb: "Grepped", detail: pat, meta: _sednarMergeActivityMeta(meta, _sednarWorkspaceMetaForArgs(a, scope)), kind: "search" };
  }
  if (t === "read_repo_file" || /^Read\s/i.test(msg)) {
    const fp = a.file_path || msg.replace(/^Read\s+/i, "").split(/\s+L\d/)[0].trim();
    let meta = "";
    const start = a.start_line;
    const end = a.end_line;
    if (start && end) meta = "L" + start + "-" + end;
    else if (start) meta = "L" + start + "+";
    else {
      const m = msg.match(/\s(L\d[\d+-]*)\s*$/);
      if (m) meta = m[1];
    }
    return Object.assign(_sednarFileActivityParts("Read", fp, meta, a), { kind: "read" });
  }
  if (t === "list_repo_dir" || /^(Explored|Listed)\s/i.test(msg)) {
    const dir = String(a.directory || a.path || "").trim() || msg.replace(/^(Explored|Listed)\s+/i, "") || "project";
    return { verb: "Listed", detail: dir === "project" || dir === "." ? "project" : _sednarBasename(dir) || dir, meta: _sednarWorkspaceMetaForArgs(a, dir), kind: "list", listPath: dir };
  }
  if (t === "find_files" || /^Find files\b/i.test(msg)) {
    const d = String(a.query || "").trim() || msg.replace(/^Find files\s*/i, "").replace(/`/g, "").trim();
    const dir = String(a.path_prefix || "").trim();
    return { verb: "Searched files", detail: d || "project", meta: _sednarMergeActivityMeta(dir ? "in " + _sednarBasename(dir) : "", _sednarWorkspaceMetaForArgs(a)), kind: "search" };
  }
  if (t === "glob_files" || /^Glob\b/i.test(msg)) {
    const d = String(a.pattern || "").trim() || msg.replace(/^Glob\s*/i, "").replace(/`/g, "").trim();
    const dir = String(a.path || "").trim();
    return { verb: "Searched files", detail: d || "project", meta: _sednarMergeActivityMeta(dir ? "in " + _sednarBasename(dir) : "", _sednarWorkspaceMetaForArgs(a)), kind: "search" };
  }
  if (t === "find_symbol" || /^Find symbol\b/i.test(msg)) {
    const d = String(a.name || "").trim() || msg.replace(/^Find symbol\s*/i, "").replace(/`/g, "").trim();
    return { verb: "Searched", detail: d ? "symbol " + d : "symbols", meta: _sednarWorkspaceMetaForArgs(a), kind: "search" };
  }
  if (t === "find_references" || /^Find refs\b/i.test(msg)) {
    const d = String(a.name || "").trim() || msg.replace(/^Find refs\s*/i, "").replace(/`/g, "").trim();
    return { verb: "Searched", detail: d ? "references to " + d : "references", meta: _sednarWorkspaceMetaForArgs(a), kind: "search" };
  }
  if (t === "list_symbols" || /^List symbols\b/i.test(msg)) {
    const d = String(a.path || "").trim() || msg.replace(/^List symbols(\s+in)?\s*/i, "").trim() || "project";
    return { verb: "Listed", detail: "symbols in " + (d === "project" ? "project" : _sednarBasename(d) || d), meta: _sednarWorkspaceMetaForArgs(a, d), kind: "search" };
  }
  if (t === "ast_symbols" || t === "lsp_document_symbols") {
    const fp = a.file_path || msg.replace(/^(Explored|Outlined)\s+/i, "").trim();
    return Object.assign(_sednarFileActivityParts("Outlined", fp, "", a), { kind: "read" });
  }
  if (_sednarIsFileEditTool(t) || msg.startsWith("Editing")) {
    const fp = a.file_path || msg.replace(/^Editing\s+/i, "").trim();
    return Object.assign(_sednarFileActivityParts("Edited", fp, "", a), { kind: "edit" });
  }
  if (t === "ask_question") {
    const count = Array.isArray(a.questions) ? a.questions.length : 0;
    const plural = count > 1 || (count === 0 && /\bquestions\b/i.test(msg));
    const noun = plural ? (count ? count + " questions" : "questions") : "question";
    return { verb: /^Skipped\b/i.test(msg) ? "Skipped" : "Asked", detail: noun, meta: "", kind: "question" };
  }
  if (t === "create_plan" || /^(Creating|Writing) plan\b/i.test(msg)) {
    return { verb: "Wrote plan", detail: "", meta: "", kind: "plan" };
  }
  if (t === "command_status") {
    const re = String(a.wait_for || a.pattern || "").trim();
    return { verb: "Waited", detail: re ? "for " + re : "for background command", meta: "", kind: "other" };
  }
  if (t === "kill_command") {
    return { verb: "Stopped", detail: "background command", meta: "", kind: "other" };
  }
  if (t === "restart_command") {
    const what = String(a.command || "").trim();
    return { verb: "Restarted", detail: what ? what.slice(0, 72) : "dev server", meta: "", kind: "shell" };
  }
  if (t === "run_command" || msg.startsWith("Running")) {
    const rawCmd = String(a.command || msg.replace(/^Running\s*`?/i, "").replace(/`?\s*$/, ""));
    const cmd = typeof window.sednarCommandHeaderLabel === "function" ? window.sednarCommandHeaderLabel(rawCmd) : rawCmd.slice(0, 72);
    return { verb: "Ran", detail: cmd, meta: "", kind: "shell" };
  }
  if (t === "web_search") {
    return { verb: "Searched web", detail: String(a.query || "").trim(), meta: "", kind: "search" };
  }
  if (t === "web_fetch") {
    return { verb: "Fetched page", detail: String(a.url || "").trim(), meta: "", kind: "fetch" };
  }
  if (t === "memory_search") {
    return { verb: "Searched", detail: "memory for " + String(a.query || "").trim(), meta: "", kind: "search" };
  }
  if (t === "memory_get") {
    return { verb: "Read", detail: "memory", meta: "", kind: "read" };
  }
  if (t === "update_memory" || /^Updated memory\b/i.test(msg)) {
    return { verb: "Updated memory", detail: "", meta: "", kind: "other" };
  }
  if (/^Thinking$/i.test(msg)) {
    return { verb: "Thinking", detail: "", meta: "", kind: "thinking" };
  }
  if (t === "attempt_completion" || msg === "Thought briefly" || /^Thought\b/i.test(msg)) {
    const m = msg.match(/(?:for\s+)?(\d+)\s*s\b/i);
    if (m) return { verb: "Thought", detail: _sednarThoughtDurationLabel(m[1]), meta: "", kind: "thinking" };
    const detail = msg.replace(/^Thought\s*/i, "").trim();
    if (detail && detail !== "briefly") return { verb: "Thought", detail: detail, meta: "", kind: "thinking" };
    const durationMs = _sednarPendingDurationMs || _sednarComputeThoughtDurationMs();
    return { verb: "Thought", detail: _sednarThoughtDurationLabel(_sednarPendingDurationS, durationMs), meta: "", kind: "thinking" };
  }
  if (t === "error" || /^Failed\b/i.test(msg)) {
    const rawDetail = msg.replace(/^Failed\s+/i, "");
    return { verb: "Failed", detail: _sednarTruncateMiddle(rawDetail, 140), meta: "", isError: true, fullErrorTitle: rawDetail, kind: "error" };
  }
  if (/^Indexed\s/i.test(msg)) {
    return { verb: "Indexed", detail: msg.replace(/^Indexed\s+/i, ""), meta: "", kind: "other" };
  }
  if (/^Found\s/i.test(msg)) {
    return { verb: "Found", detail: msg.replace(/^Found\s+/i, ""), meta: "", kind: "search" };
  }
  if (/^Exit\s/i.test(msg)) {
    return { verb: "Exit", detail: msg.replace(/^Exit\s+/i, ""), meta: "", kind: "other" };
  }
  if (t === "spawn_subagent" || /^Subagent\b/i.test(msg)) {
    const goal = String(a.goal || msg.replace(/^Subagent\s*:?\s*/i, "")).trim();
    return { verb: "Completed task", detail: String(a.title || "").trim() || _sednarSubagentSummary(goal) || "Task", meta: "", isSubagent: true, subagentGoal: goal, kind: "task" };
  }
  if (t === "git_log") {
    const meta = a.grep ? "matching " + String(a.grep).slice(0, 40) : "";
    if (a.path) return Object.assign(_sednarFileActivityParts("Checked", a.path, meta, a), { detail: "history of " + _sednarBasename(a.path), kind: "search" });
    return { verb: "Checked", detail: "git history", meta: meta, kind: "search" };
  }
  if (t === "todo_write" || /^Updated task list\b/i.test(msg)) {
    let n = Array.isArray(a.todos) ? a.todos.length : 0;
    if (!n) {
      const m = msg.match(/\((\d+)\s+items?\)/i);
      if (m) n = parseInt(m[1], 10);
    }
    const done = Array.isArray(a.todos) ? a.todos.filter(function(td) { return td && td.status === "completed"; }).length : 0;
    return { verb: "Updated todos", detail: n ? done + " of " + n + " done" : "", meta: "", kind: "other" };
  }
  if (t === "update_goal" || /^Goal\b/i.test(msg)) {
    let detail = "progress";
    if (a.completed || /complete/i.test(msg)) detail = "complete";
    else if (a.blocked_reason || /blocked/i.test(msg)) detail = "blocked";
    return { verb: "Updated goal", detail: detail, meta: "", kind: "other" };
  }
  if (t === "compaction") {
    return { verb: "Compacted", detail: "conversation history", meta: a.forced ? "context limit" : "", kind: "other" };
  }
  if (t === "lsp_diagnostics") {
    const fp = a.file_path ? _sednarBasename(String(a.file_path)) : "";
    return { verb: "Read lints", detail: fp, meta: "", kind: "lint" };
  }
  if (t === "lsp_definition" || t === "lsp_references" || t === "lsp_hover") {
    const fp = a.file_path ? _sednarBasename(String(a.file_path)) : "";
    const loc = a.line ? ":" + a.line : "";
    const detail = { lsp_definition: "definition in ", lsp_references: "references in ", lsp_hover: "" }[t] + fp + loc;
    return { verb: t === "lsp_hover" ? "Inspected" : "Found", detail: detail.trim(), meta: "", kind: "search" };
  }
  return { verb: msg.split(/\s/)[0] || "Working", detail: msg.split(/\s/).slice(1).join(" "), meta: "", kind: "other" };
}

function _sednarMarkdownToSafeHtml(text) {
  var md = String(text || "");
  if (typeof window._linkifyBareUrlsInMarkdownGlobal === "function") {
    md = window._linkifyBareUrlsInMarkdownGlobal(md);
  }
  if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(marked.parse(md));
  }
  return _sednarEscapeHtml(md).replace(/\n/g, "<br>");
}

function _sednarPrepareThoughtMarkdown(text) {
  var md = String(text || "");
  if (typeof window._linkifyBareUrlsInMarkdownGlobal === "function") {
    md = window._linkifyBareUrlsInMarkdownGlobal(md);
  }
  return md;
}

function _sednarRenderThoughtMarkdown(el, markdown) {
  if (!el) return;
  el.classList.add("sednar-markdown-content", "mdpdf-preview-body");
  const md = _sednarPrepareThoughtMarkdown(markdown);
  if (!md.trim()) {
    el.innerHTML = "";
    return;
  }
  if (typeof window.renderMarkdownLikeMdpdfPreview === "function") {
    window.renderMarkdownLikeMdpdfPreview(el, md, "sednar-thought-mermaid-");
    return;
  }
  el.innerHTML = _sednarMarkdownToSafeHtml(md);
}

function _sednarRenderThoughtBody(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return '<div class="sednar-thought-content sednar-markdown-content mdpdf-preview-body"></div>';
}

function _sednarUpgradeToStreamingThought() {
  if (!_sednarRunningActivityEl) return null;
  const outer = _sednarRunningActivityEl;
  let wrap = outer.querySelector(".sednar-thought-wrap");
  if (!wrap) {
    outer.innerHTML =
      '<div class="sednar-activity-wrap sednar-thought-wrap ui-collapsible is-expandable is-collapsed is-streaming" data-step-kind="thinking">' +
      '<span class="sednar-activity-line sednar-thought-toggle ui-collapsible-header is-running" data-expandable role="button" tabindex="0" aria-expanded="true" data-panel-open>' +
      _sednarThoughtLabelHtml({ verb: "Thinking" }, true) + _sednarActivityChevronHtml() + "</span>" +
      '<div class="sednar-thought-body" hidden><div class="sednar-thought-content sednar-markdown-content mdpdf-preview-body"></div></div></div>';
    wrap = outer.querySelector(".sednar-thought-wrap");
  }
  if (wrap) {
    wrap.classList.add("is-streaming");
    const body = wrap.querySelector(".sednar-thought-body");
    if (body) body.hidden = false;
  }
  _sednarStreamingThoughtContentEl = outer.querySelector(".sednar-thought-content");
  if (_sednarStreamingThoughtContentEl) {
    _sednarStreamingThoughtContentEl.classList.add("sednar-markdown-content");
  }
  return _sednarStreamingThoughtContentEl;
}

function _sednarCancelThoughtStreamFlush() {
  if (_sednarThoughtStreamFlushTimer) {
    clearTimeout(_sednarThoughtStreamFlushTimer);
    _sednarThoughtStreamFlushTimer = null;
  }
  if (_sednarThoughtStreamRaf && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(_sednarThoughtStreamRaf);
  }
  _sednarThoughtStreamRaf = null;
}

function _sednarFlushStreamingThoughtDom() {
  _sednarThoughtStreamFlushTimer = null;
  _sednarThoughtStreamRaf = null;
  const contentEl = _sednarStreamingThoughtContentEl || _sednarUpgradeToStreamingThought();
  if (!contentEl) return;
  contentEl.classList.add("sednar-markdown-content", "mdpdf-preview-body");
  _sednarRenderStreamingMarkdown(contentEl, _sednarPrepareThoughtMarkdown(_sednarPendingThoughtContent));
  const body = contentEl.closest(".sednar-thought-body");
  if (body) body.classList.toggle("is-clipped", contentEl.scrollHeight > body.clientHeight + 1);
  _sednarAutoScroll();
}

function _sednarScheduleThoughtStreamFlush() {
  if (typeof requestAnimationFrame === "function") {
    if (_sednarThoughtStreamRaf) return;
    _sednarThoughtStreamRaf = requestAnimationFrame(_sednarFlushStreamingThoughtDom);
    return;
  }
  if (_sednarThoughtStreamFlushTimer) return;
  _sednarThoughtStreamFlushTimer = setTimeout(
    _sednarFlushStreamingThoughtDom,
    _SEDNAR_THOUGHT_STREAM_FLUSH_MS
  );
}

function _sednarAppendThoughtDelta(delta) {
  const text = String(delta || "");
  if (!text) return;
  _sednarPendingThoughtContent += text;
  if (_sednarPendingThoughtContent.length > _SEDNAR_MAX_THOUGHT_CHARS * 2) {
    const cut = _sednarPendingThoughtContent.length - _SEDNAR_MAX_THOUGHT_CHARS;
    const para = _sednarPendingThoughtContent.indexOf("\n\n", cut);
    _sednarPendingThoughtContent = _sednarPendingThoughtContent.slice(para >= 0 ? para + 2 : cut);
  }

  if (!_sednarStreamingThoughtContentEl) _sednarUpgradeToStreamingThought();
  _sednarScheduleThoughtStreamFlush();
}

function _sednarFillThoughtBody(wrapOrLine, text) {
  if (!wrapOrLine) return;
  const cEl = wrapOrLine.querySelector(".sednar-thought-content");
  const md = String(text || "").trim();
  if (!cEl || !md) return;
  _sednarRenderThoughtMarkdown(cEl, md);
}

function _sednarFinalizeThoughtActivity(thoughtContent, output, opts) {
  opts = opts || {};
  _sednarCancelThoughtStreamFlush();
  let thought = opts.answerPending
    ? ""
    : String(thoughtContent || _sednarPendingThoughtContent || "").trim();
  if (thought.length > _SEDNAR_MAX_THOUGHT_CHARS) {
    thought = thought.slice(-_SEDNAR_MAX_THOUGHT_CHARS).trim();
  }
  _sednarStreamingThoughtContentEl = null;
  _sednarStopThinkingTicker();

  _sednarPendingThoughtContent = thought;
  output = output || getSednarChatOutput();
  _sednarResolveRunningActivityEl(output);
  _sednarCleanupStaleThinkingLines(output, _sednarRunningActivityEl);
  const parts = _sednarThoughtParts();
  if (_sednarRunningActivityEl) {
    _sednarRunningActivityEl.classList.remove("is-running");
    _sednarRunningActivityEl.removeAttribute("data-sednar-thought-transient");
    _sednarRunningActivityEl.innerHTML = _sednarBuildActivityHtml(parts, false);
    _sednarFillThoughtBody(_sednarRunningActivityEl, parts.thoughtContent);
    _sednarLastThoughtOuter = _sednarRunningActivityEl;
    _sednarRunningActivityEl = null;
  } else {
    const wrap = _sednarAppendActivityParts(parts, false, output);
    _sednarFillThoughtBody(wrap, parts.thoughtContent);
    _sednarLastThoughtOuter = wrap;
  }
  _sednarLastThoughtParts = parts;
  _sednarPendingThoughtContent = "";
  _sednarPendingDurationS = null;
  _sednarPendingDurationMs = null;
  _sednarThinkingStartMs = null;
  _sednarAutoScroll(output);
}

function _sednarBindThoughtTogglesOnce() {
  if (_sednarThoughtToggleBound) return;
  _sednarThoughtToggleBound = true;
  function toggle(e) {
    const btn = e.target && e.target.closest ? e.target.closest(".sednar-thought-toggle") : null;
    if (!btn || !btn.closest("#sednar-chat-messages")) return;
    const wrap = btn.closest(".sednar-thought-wrap");
    if (!wrap) return;
    const body = wrap.querySelector(".sednar-thought-body");
    if (!body) return;
    e.preventDefault();
    const expanded = wrap.classList.contains("is-streaming")
      ? body.hidden
      : wrap.classList.toggle("is-expanded");
    wrap.classList.toggle("is-expanded", expanded);
    wrap.classList.toggle("is-collapsed", !expanded);
    body.hidden = !expanded;
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    btn.toggleAttribute("data-panel-open", expanded);
  }
  document.addEventListener("click", toggle);
  document.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") toggle(e);
  });
}

const _SEDNAR_LOADING_VERBS = {
  Grepped: "Grepping",
  Read: "Reading",
  Listed: "Listing",
  Edited: "Editing",
  Created: "Creating",
  Wrote: "Writing",
  Deleted: "Deleting",
  Ran: "Running",
  Thought: "Thinking",
  Thinking: "Thinking",
  Searched: "Searching",
  "Searched files": "Searching files",
  "Searched web": "Searching web",
  "Fetched page": "Fetching page",
  "Read lints": "Reading lints",
  Outlined: "Outlining",
  Found: "Finding",
  Indexed: "Indexing",
  Compacted: "Compacting",
  "Updated todos": "Updating todos",
  "Updated goal": "Updating goal",
  "Updated memory": "Updating memory",
  "Wrote plan": "Writing plan",
  Asked: "Asking questions",
  Waited: "Waiting",
  Stopped: "Stopping",
  Checked: "Checking",
  Inspected: "Inspecting",
  "Completed task": "Working on task",
};

function _sednarRunningVerb(verb) {
  return _SEDNAR_LOADING_VERBS[verb] || verb;
}

window.refreshSednarShimmerStyle = function() {};

function _sednarActivityDetailHtml(p, shimmer) {
  const detail = String(p.detail || "").trim();
  const meta = p.meta ? String(p.meta).trim() : "";
  if (!detail && !meta) return "";
  const text = [detail, meta].filter(Boolean).join(" ");
  const filePath = String(p.detailFilePath || "").trim();
  const attrs = filePath
    ? ' data-file-path="' + _sednarEscapeHtml(filePath).replace(/"/g, "&quot;") + '"' +
      ' data-line-meta="' + _sednarEscapeHtml(meta).replace(/"/g, "&quot;") + '"' +
      ' title="' + _sednarEscapeHtml(filePath).replace(/"/g, "&quot;") + '"'
    : "";
  const cls = "sednar-activity-detail ui-tool-call-line-details" + (filePath ? " sednar-activity-file-link" : "") + (shimmer ? " ui-shimmer" : "");
  return ' <span class="' + cls + '"' + attrs + ">" + _sednarEscapeHtml(text) + "</span>";
}

function _sednarShouldShimmerActivity(p, running) {
  if (running || (p && p.shimmer)) return true;
  const verb = String((p && p.verb) || "").toLowerCase();
  const detail = String((p && p.detail) || "").toLowerCase();
  return (verb === "compacted" || verb === "compacting") && detail === "conversation history";
}

function _sednarStepKind(p) {
  if (!p) return "other";
  if (p.kind) return p.kind;
  if (p.isError) return "error";
  const v = String(p.verb || "").toLowerCase();
  if (v === "thought" || v === "thinking" || v === "planning next moves") return "thinking";
  if (v === "read" || v === "reading" || v === "outlined" || v === "outlining") return "read";
  if (v === "listed" || v === "listing") return "list";
  if (v === "grepped" || v === "grepping" || v === "searched" || v === "searching" || v === "searched files" ||
      v === "searching files" || v === "searched web" || v === "searching web" || v === "found" || v === "finding") return "search";
  if (v === "fetched page" || v === "fetching page") return "fetch";
  if (v === "read lints" || v === "reading lints") return "lint";
  return "other";
}

function _sednarActivityLabelHtml(p, withChevron, running) {
  const shimmer = _sednarShouldShimmerActivity(p, running);
  const verb = _sednarEscapeHtml(p.verb || "");
  if (shimmer && !p.detail && !p.meta) {
    return '<span class="sednar-activity-text ui-shimmer"><span class="sednar-activity-verb ui-tool-call-line-action">' + verb + "</span></span>" +
      (withChevron ? _sednarActivityChevronHtml() : "");
  }
  const verbHtml = '<span class="sednar-activity-verb ui-tool-call-line-action">' + verb + "</span>";
  const icon = p.iconHtml ? '<span class="ui-tool-call-line-icon">' + p.iconHtml + "</span>" : "";
  return icon + '<span class="sednar-activity-text' + (shimmer ? " ui-shimmer" : "") + '">' + verbHtml + _sednarActivityDetailHtml(p, false) + "</span>" +
    (withChevron ? _sednarActivityChevronHtml() : "");
}

function _sednarActivityChevronHtml() {
  return _sednarIcon("chevron-right", { className: "ui-collapsible-chevron sednar-activity-chevron" });
}

function _sednarBuildActivityHtml(parts, running) {
  const p = Object.assign({}, parts || { verb: "", detail: "", meta: "" });
  const isMcpCall = !!p.isMcp;
  if (running && p.verb) {
    p.verb = _sednarRunningVerb(p.verb);
  }
  const runClass = running ? " is-running" : "";
  const errClass = p.isError ? " is-error" : "";
  const kind = _sednarStepKind(parts);
  if (!running && p.verb === "Thought" && p.thoughtContent) {
    return '<div class="sednar-activity-wrap sednar-thought-wrap ui-collapsible is-expandable is-collapsed" data-step-kind="thinking">' +
      '<span class="sednar-activity-line sednar-thought-toggle ui-collapsible-header' + errClass + '" data-expandable role="button" tabindex="0" aria-expanded="false">' +
      _sednarThoughtLabelHtml(p, false) + _sednarActivityChevronHtml() + "</span>" +
      '<div class="sednar-thought-body" hidden>' + _sednarRenderThoughtBody(p.thoughtContent) + "</div>" +
      "</div>";
  }
  if (isMcpCall) {
    return _sednarBuildMcpCallHtml(p, errClass, running);
  }
  let titleAttr = "";
  if (p.fullErrorTitle) {
    titleAttr = ' title="' + _sednarEscapeHtml(p.fullErrorTitle).replace(/"/g, "&quot;") + '"';
  }
  const clickable = p.detailFilePath && !running ? " ui-tool-call-line--clickable" : "";
  const dimmed = p.dimmed ? " is-dimmed" : "";
  return '<div class="sednar-activity-wrap" data-step-kind="' + kind + '">' +
    '<span class="sednar-activity-line ui-tool-call-line' + clickable + dimmed + runClass + errClass + '"' + titleAttr + ">" +
    _sednarActivityLabelHtml(p, false, running) + "</span></div>";
}

function _sednarThoughtLabelHtml(p, running) {
  if (running) {
    return '<span class="sednar-activity-text ui-shimmer"><span class="sednar-activity-verb ui-collapsible-action">' + _sednarEscapeHtml(p.verb || "Thinking") + "</span></span>";
  }
  return '<span class="sednar-activity-text">' +
    '<span class="sednar-activity-verb ui-collapsible-action">' + _sednarEscapeHtml(p.verb || "Thought") + "</span>" +
    (p.detail ? ' <span class="sednar-activity-detail ui-collapsible-details">' + _sednarEscapeHtml(p.detail) + "</span>" : "") +
    "</span>";
}

const _SEDNAR_MCP_ERROR_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const _SEDNAR_MCP_CALL_CHEVRON_SVG = '<span class="sednar-activity-chevron" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>';

function _sednarHighlightJson(text) {
  return _sednarEscapeHtml(text).replace(/"/g, "&quot;").replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],:])/g, function(m, str, colon, kw, num, punct) {
    if (str) return '<span class="' + (colon ? "sednar-json-key" : "sednar-json-str") + '">' + str + "</span>" + (colon ? '<span class="sednar-json-punct">' + colon + "</span>" : "");
    if (kw) return '<span class="sednar-json-kw">' + kw + "</span>";
    if (num) return '<span class="sednar-json-num">' + num + "</span>";
    return '<span class="sednar-json-punct">' + punct + "</span>";
  });
}

function _sednarBuildMcpCallHtml(p, errClass, running) {
  const toolName = String(p.detail || "").replace(/^`|`$/g, "");
  const badge = toolName ? '<span class="sednar-mcp-call-badge">' + _sednarEscapeHtml(toolName) + "</span>" : "";
  const status = !running && p.isError
    ? '<span class="sednar-mcp-call-status is-error" aria-hidden="true">' + _SEDNAR_MCP_ERROR_SVG + "</span>"
    : "";
  const hasArgs = p.mcpArgs && typeof p.mcpArgs === "object" && Object.keys(p.mcpArgs).length > 0;
  const wrapClass = "sednar-activity-wrap sednar-thought-wrap sednar-mcp-call-wrap" + (hasArgs ? " is-expandable is-collapsed" : "");
  const chevron = hasArgs ? _SEDNAR_MCP_CALL_CHEVRON_SVG : "";
  const role = hasArgs ? ' role="button" tabindex="0"' : "";
  const toggleClass = "sednar-activity-line sednar-thought-toggle sednar-mcp-call-toggle" + (running ? " is-running" : "") + errClass;
  const verb = running ? "Calling MCP tool" : "Called MCP tool";
  const label = chevron + '<span class="sednar-activity-text"><span class="sednar-activity-verb">' + verb + "</span>" + badge + "</span>" + status;
  const body = hasArgs
    ? '<div class="sednar-mcp-call-body sednar-thought-body" hidden><pre class="sednar-mcp-call-args">' + _sednarHighlightJson(JSON.stringify(p.mcpArgs, null, 2)) + "</pre></div>"
    : "";
  return '<div class="' + wrapClass + '" data-step-kind="mcp"><span class="' + toggleClass + '"' + role + ' aria-expanded="false">' + label + "</span>" + body + "</div>";
}

function _sednarRemoveTransientThought(output) {
  output = output || getSednarChatOutput();
  if (!output) return;
  output.querySelectorAll("[data-sednar-thought-transient]").forEach(function(el) { el.remove(); });
}

function _sednarIsGenericWorkingActivityText(text) {
  const label = String(text || "").trim();
  return /^Working\s*$/i.test(label);
}

function _sednarRemoveGenericWorkingActivities(output) {
  output = output || getSednarChatOutput();
  if (!output) return;
  output.querySelectorAll(".sednar-activity-wrap-outer").forEach(function(el) {
    const text = el.querySelector(".sednar-activity-text");
    if (_sednarIsGenericWorkingActivityText(text && text.textContent)) el.remove();
  });
}

function _sednarAppendActivityParts(parts, running, output) {
  output = output || getSednarChatOutput();
  if (!output || !parts || !parts.verb) return null;
  const activityLabel = [parts.verb, parts.detail, parts.meta].filter(function(s) { return s; }).join(" ");
  if (_sednarIsGenericWorkingActivityText(activityLabel)) return null;
  const stepsContainer = _sednarEnsureAgentStepsRow(output);
  if (!stepsContainer) return null;
  _sednarRemoveTransientThought(output);
  _sednarRemoveGenericWorkingActivities(output);
  const wrap = document.createElement("div");
  wrap.className = "sednar-activity-wrap-outer" + (running ? " is-running" : "");
  wrap.setAttribute("data-step-id", _sednarNextStepId());
  wrap.innerHTML = _sednarBuildActivityHtml(parts, running);
  stepsContainer.appendChild(wrap);
  if (running) _sednarRunningActivityEl = wrap;
  _sednarScheduleRegroup(output);
  _sednarAutoScroll(output);
  return wrap;
}

function _sednarFinalizeRunningActivity(options, output) {
  const opts = options || {};
  output = output || getSednarChatOutput();
  _sednarResolveRunningActivityEl(output);
  if (!_sednarRunningActivityEl) return;
  if (opts.remove) {
    _sednarStopThinkingTicker();
    _sednarCancelThoughtStreamFlush();
    _sednarRunningActivityEl.remove();
    _sednarRunningActivityEl = null;
    _sednarPendingDurationS = null;
    _sednarPendingDurationMs = null;
    _sednarPendingThoughtContent = "";
    _sednarStreamingThoughtContentEl = null;
    _sednarThinkingStartMs = null;
    return;
  }
  const parts = opts.editFailed
    ? _sednarEditFailedParts(opts.args || _sednarLastToolArgs, opts.message || "", opts.errorKind)
    : _sednarIsThinkingLine()
      ? _sednarThoughtParts()
      : _sednarParseActivityParts(_sednarLastTool, _sednarLastToolArgs, _sednarLastToolLabel);
  if (opts.pastTense && !opts.editFailed && parts && _sednarIsFileEditTool(_sednarLastTool) && parts.verb === "Editing") {
    parts.verb = String(_sednarLastTool || "").toLowerCase() === "write_file" ? "Wrote" : "Edited";
  }
  if (opts.editFailed) {
    _sednarStopThinkingTicker();
    _sednarCancelThoughtStreamFlush();
    _sednarRunningActivityEl.remove();
    _sednarRunningActivityEl = null;
    _sednarPendingDurationS = null;
    _sednarPendingDurationMs = null;
    _sednarPendingThoughtContent = "";
    _sednarStreamingThoughtContentEl = null;
    _sednarThinkingStartMs = null;
    _sednarRecordEditFailure(opts.args || _sednarLastToolArgs, opts.message || "", opts.errorKind, output);
    return;
  }
  if (_sednarIsThinkingLine()) {
    _sednarStopThinkingTicker();
  }
  _sednarCancelThoughtStreamFlush();
  _sednarRunningActivityEl.classList.remove("is-running");
  _sednarRunningActivityEl.innerHTML = _sednarBuildActivityHtml(parts, false);
  if (parts && parts.verb === "Thought") {
    _sednarRunningActivityEl.setAttribute("data-sednar-thought-transient", "1");
  }
  _sednarRunningActivityEl = null;
  _sednarPendingDurationS = null;
  _sednarPendingDurationMs = null;
  _sednarPendingThoughtContent = "";
  _sednarStreamingThoughtContentEl = null;
  if (_sednarIsThinkingLine() || (parts && parts.verb === "Thought")) {
    _sednarThinkingStartMs = null;
  }
}

function _sednarAppendCompletedActivity(tool, args, message) {
  const parts = _sednarParseActivityParts(tool, args, message);
  _sednarAppendActivityParts(parts, false);
}


let _sednarStepSeq = 0;

function _sednarNextStepId() {
  _sednarStepSeq += 1;
  return "s" + Date.now().toString(36) + _sednarStepSeq.toString(36);
}

const _SEDNAR_TOOL_STEP_KINDS = new Set(["read", "list", "search", "fetch", "lint", "edit", "shell", "mcp"]);
const _SEDNAR_STANDALONE_STEP_KINDS = new Set(["task", "plan", "question", "barrier"]);

const SEDNAR_CONVERSATION_DENSITIES = [
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
];

const SEDNAR_STEP_GROUPINGS = [
  { value: "grouped", label: "Grouped" },
  { value: "ungrouped", label: "Ungrouped" },
];

function _sednarStepGrouping() {
  let value = "";
  try { value = _sednarSettingsGet("stepGrouping"); } catch (e) {}
  return value === "ungrouped" ? "ungrouped" : "grouped";
}

function _sednarConversationDensity() {
  let value = "";
  try { value = _sednarSettingsGet("conversationDensity"); } catch (e) {}
  return value === "balanced" ? value : "detailed";
}

function _sednarApplyConversationDensity() {
  const out = getSednarChatOutput();
  if (out) _sednarRegroupTranscript(out);
  sednarChatTabs.forEach(function(tab) {
    if (tab._backgroundOutput) _sednarRegroupTranscript(tab._backgroundOutput);
  });
}
const _sednarRegroupPending = new Set();

function _sednarScheduleRegroup(output) {
  output = output || getSednarChatOutput();
  if (!output || _sednarRegroupPending.has(output)) return;
  _sednarRegroupPending.add(output);
  const run = function() {
    _sednarRegroupPending.delete(output);
    _sednarRegroupTranscript(output, { lastTurnOnly: true });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function _sednarStepIdFor(el) {
  let id = el.getAttribute("data-step-id");
  if (!id) {
    id = _sednarNextStepId();
    el.setAttribute("data-step-id", id);
  }
  return id;
}

function _sednarLineStep(outer) {
  const inner = outer.querySelector("[data-step-kind]");
  let kind = inner ? inner.getAttribute("data-step-kind") : "";
  const textEl = outer.querySelector(".sednar-activity-text");
  const label = String(textEl ? textEl.textContent : outer.textContent || "").trim();
  if (!kind) kind = _sednarStepKind({ verb: label.split(/\s+/)[0] });
  if (/^(Thinking|Planning next moves|Retrying model)/i.test(label)) kind = "thinking";
  const detailEl = outer.querySelector(".sednar-activity-detail");
  const detail = String(detailEl ? detailEl.textContent : "").trim();
  return {
    el: outer,
    row: outer.closest(".chat-row"),
    kind: kind,
    running: outer.classList.contains("is-running") || !!outer.querySelector(".is-running"),
    detail: detail,
    file: kind === "read" ? (detail.split(/\s+L\d/)[0] || detail) : "",
  };
}

function _sednarTurnSteps(rows) {
  const steps = [];
  rows.forEach(function(row) {
    const cl = row.classList;
    if (cl.contains("lc-group-row") || cl.contains("lc-turn-footer") || cl.contains("sednar-status-row")) return;
    if (cl.contains("sednar-agent-steps-row")) {
      const lines = row.querySelectorAll(".sednar-activity-wrap-outer");
      if (!lines.length) return;
      lines.forEach(function(outer) {
        _sednarStepIdFor(outer);
        steps.push(_sednarLineStep(outer));
      });
      return;
    }
    if (cl.contains("sednar-diff-row")) {
      const block = row.querySelector(".ui-edit-tool-call, .sednar-diff-block");
      steps.push({
        el: row,
        row: row,
        kind: "edit",
        running: false,
        file: block ? String(block.getAttribute("data-file-name") || "") : "",
        additions: block ? Number(block.getAttribute("data-additions")) || 0 : 0,
        deletions: block ? Number(block.getAttribute("data-deletions")) || 0 : 0,
      });
      _sednarStepIdFor(row);
      return;
    }
    if (cl.contains("sednar-term-row")) {
      const card = row.querySelector(".sednar-term-card");
      const desc = card ? String(card.getAttribute("data-description") || "") : "";
      steps.push({ el: row, row: row, kind: "shell", running: !!(card && !card.hasAttribute("data-done")), description: desc });
      _sednarStepIdFor(row);
      return;
    }
    steps.push({ el: row, row: row, kind: "barrier" });
  });
  return steps;
}

function _sednarStepGroups(steps, density) {
  const groups = [];
  const laneStandalone = density === "balanced" || density === "detailed";
  let run = [];
  const flush = function() {
    let start = 0;
    let end = run.length;
    while (start < end && run[start].kind === "thinking") start++;
    while (end > start && run[end - 1].kind === "thinking") end--;
    const trimmed = run.slice(start, end);
    const acts = trimmed.filter(function(s) { return s.kind !== "thinking"; });
    if (acts.length > 1) groups.push(trimmed);
    run = [];
  };
  steps.forEach(function(step) {
    if (_SEDNAR_STANDALONE_STEP_KINDS.has(step.kind) || (laneStandalone && (step.kind === "edit" || step.kind === "shell"))) flush();
    else run.push(step);
  });
  flush();
  return groups;
}

function _sednarCountText(n, word, plural) {
  return n + " " + (n === 1 ? word : (plural || word + "s"));
}

function _sednarGroupSummary(group) {
  const tools = group.filter(function(s) { return _SEDNAR_TOOL_STEP_KINDS.has(s.kind); });
  const loading = group.some(function(s) { return s.running; });
  const count = function(kind) { return tools.filter(function(s) { return s.kind === kind; }).length; };
  const edits = tools.filter(function(s) { return s.kind === "edit"; });
  const commands = count("shell");
  let additions = 0;
  let deletions = 0;
  edits.forEach(function(s) { additions += s.additions || 0; deletions += s.deletions || 0; });

  if (!tools.length) {
    const n = group.filter(function(s) { return s.kind !== "thinking"; }).length;
    return { action: loading ? "Running" : "Ran", details: _sednarCountText(n, "tool"), stats: null, loading: loading };
  }
  if (commands && commands === tools.length) {
    const only = tools.length === 1 ? String(tools[0].description || "").trim().replace(/^run(?=\s|$)\s*/i, "") : "";
    return {
      action: loading ? "Running" : "Ran",
      details: only ? only.charAt(0).toUpperCase() + only.slice(1) : _sednarCountText(commands, "command"),
      stats: null,
      loading: loading,
    };
  }

  const parts = [];
  const editedFiles = [];
  edits.forEach(function(s) {
    const name = _sednarBasename(s.file || "");
    if (name && editedFiles.indexOf(name) < 0) editedFiles.push(name);
  });
  const fileCount = editedFiles.length || edits.length;
  if (fileCount) parts.push(fileCount === 1 && editedFiles[0] ? editedFiles[0] : _sednarCountText(fileCount, "file"));
  const explored = [];
  const allowName = !fileCount;
  const dirs = tools.filter(function(s) { return s.kind === "list"; });
  const files = tools.filter(function(s) { return s.kind === "read"; });
  if (dirs.length) explored.push(allowName && dirs.length === 1 && dirs[0].detail ? dirs[0].detail : _sednarCountText(dirs.length, "directory", "directories"));
  if (files.length) explored.push(allowName && !explored.length && files.length === 1 && files[0].file ? files[0].file : _sednarCountText(files.length, "file"));
  const searches = count("search");
  if (searches) explored.push(_sednarCountText(searches, "search", "searches"));
  const fetches = count("fetch");
  if (fetches) explored.push(_sednarCountText(fetches, "fetch", "fetches"));
  if (count("lint")) explored.push("lints");
  const mcp = count("mcp");
  if (mcp) explored.push(_sednarCountText(mcp, "tool"));
  if (fileCount && explored.length) explored[0] = "explored " + explored[0];
  parts.push.apply(parts, explored);
  if (commands) parts.push("ran " + _sednarCountText(commands, "command"));
  return {
    action: fileCount ? (loading ? "Editing" : "Edited") : (loading ? "Exploring" : "Explored"),
    details: parts.join(", "),
    stats: additions || deletions ? { additions: additions, deletions: deletions } : null,
    loading: loading,
  };
}

function _sednarGroupHeaderHtml(summary, open) {
  const stats = summary.stats
    ? '<span class="lc-group-stats">' +
      (summary.stats.additions ? '<span class="lc-stat-added">+' + summary.stats.additions + "</span>" : "") +
      (summary.stats.deletions ? '<span class="lc-stat-removed">-' + summary.stats.deletions + "</span>" : "") +
      "</span>"
    : "";
  return '<div class="ui-collapsible ui-step-group-collapsible" data-tone="muted">' +
    '<div class="ui-collapsible-header lc-group-toggle" data-expandable role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '"' + (open ? " data-panel-open" : "") + ">" +
    '<span class="ui-collapsible-action' + (summary.loading ? " ui-shimmer" : "") + '">' + _sednarEscapeHtml(summary.action) + "</span>" +
    (summary.details || stats ? '<span class="ui-collapsible-details">' + _sednarEscapeHtml(summary.details) + stats + "</span>" : "") +
    _sednarIcon("chevron-right", { className: "ui-collapsible-chevron" }) +
    "</div></div>";
}

function _sednarSplitStepsRowAt(line) {
  const steps = line.parentNode;
  const row = steps && steps.closest(".chat-row");
  if (!row || steps.firstElementChild === line) return row;
  const next = document.createElement("div");
  next.className = "chat-row sednar-agent-steps-row";
  next.innerHTML = '<div class="chat-msg assistant sednar-agent-steps"></div>';
  const target = next.firstElementChild;
  let node = line;
  while (node) {
    const after = node.nextElementSibling;
    target.appendChild(node);
    node = after;
  }
  row.after(next);
  return next;
}

function _sednarRegroupTranscript(output, opts) {
  output = output || getSednarChatOutput();
  if (!output) return;
  opts = opts || {};
  const density = _sednarConversationDensity();
  const grouped = _sednarStepGrouping() === "grouped";
  if (output.getAttribute("data-density") !== density) output.setAttribute("data-density", density);
  let rows = Array.from(output.children).filter(function(el) { return el.classList && el.classList.contains("chat-row"); });
  if (opts.lastTurnOnly) {
    let start = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].classList.contains("sednar-user-row")) { start = i + 1; break; }
    }
    rows = rows.slice(start);
  }
  const headers = {};
  rows.forEach(function(row) {
    if (row.classList.contains("lc-group-row")) headers[row.getAttribute("data-group-key")] = row;
  });

  const turns = [];
  let turn = [];
  rows.forEach(function(row) {
    if (row.classList.contains("sednar-user-row")) {
      if (turn.length) turns.push(turn);
      turn = [];
    } else {
      turn.push(row);
    }
  });
  if (turn.length) turns.push(turn);

  const members = new Map();
  const keep = new Set();
  turns.forEach(function(turnRows) {
    const groups = grouped ? _sednarStepGroups(_sednarTurnSteps(turnRows), density) : [];
    groups.forEach(function(group) {
      const first = group[0];
      if (first.el.classList.contains("sednar-activity-wrap-outer")) {
        first.row = _sednarSplitStepsRowAt(first.el);
      }
      const last = group[group.length - 1];
      if (last.el.classList.contains("sednar-activity-wrap-outer") && last.el.nextElementSibling) {
        _sednarSplitStepsRowAt(last.el.nextElementSibling);
      }
      const groupRows = [];
      group.forEach(function(step) {
        const row = step.el.closest(".chat-row");
        if (row && groupRows.indexOf(row) < 0) groupRows.push(row);
      });
      if (!groupRows.length) return;
      const key = _sednarStepIdFor(first.el);
      let header = headers[key];
      const open = !!(header && header.getAttribute("data-open") === "1");
      if (!header) {
        header = document.createElement("div");
        header.className = "chat-row lc-group-row";
        header.setAttribute("data-group-key", key);
      }
      const html = _sednarGroupHeaderHtml(_sednarGroupSummary(group), open);
      if (header._curHtml !== html) {
        header.innerHTML = html;
        header._curHtml = html;
      }
      if (header.nextElementSibling !== groupRows[0]) groupRows[0].before(header);
      keep.add(header);
      groupRows.forEach(function(row, i) {
        members.set(row, { key: key, first: i === 0, open: open });
      });
    });
  });

  Object.keys(headers).forEach(function(key) {
    if (!keep.has(headers[key])) headers[key].remove();
  });
  Array.from(output.children).forEach(function(row) {
    if (!row.classList || !row.classList.contains("chat-row") || row.classList.contains("lc-group-row")) return;
    const m = members.get(row);
    if (!m && opts.lastTurnOnly && rows.indexOf(row) < 0) return;
    row.classList.toggle("lc-group-member", !!m);
    row.classList.toggle("lc-group-first", !!(m && m.first));
    row.classList.toggle("is-group-collapsed", !!(m && !m.open));
    if (m) row.setAttribute("data-group-key", m.key);
    else row.removeAttribute("data-group-key");
    row.classList.toggle("lc-empty-row", row.classList.contains("sednar-agent-steps-row") && !row.querySelector(".sednar-activity-wrap-outer"));
  });
  _sednarAddTurnFooters(output, opts);
}

// ---- Under a finished turn's answer: copy, branch, and when it finished.

function _sednarWorkedForLabel(ms) {
  const n = Number(ms);
  if (!(n > 0)) return "Worked";
  const sec = Math.max(1, Math.round(n / 1000));
  if (sec < 60) return "Worked for " + sec + "s";
  const min = Math.floor(sec / 60);
  if (min < 60) return "Worked for " + min + "m" + (sec % 60 ? " " + (sec % 60) + "s" : "");
  return "Worked for " + Math.floor(min / 60) + "h" + (min % 60 ? " " + (min % 60) + "m" : "");
}

function _sednarMarkTurnsFinished(output) {
  if (!output) return;
  output.querySelectorAll(":scope > .chat-row.sednar-user-row[data-turn-started]:not([data-turn-ms])").forEach(function(row) {
    const started = Number(row.getAttribute("data-turn-started")) || Date.now();
    row.setAttribute("data-turn-ms", String(Math.max(0, Date.now() - started)));
  });
  _sednarRegroupTranscript(output);
}

function _sednarAddTurnFooters(output, opts) {
  // Chats saved while finished turns were folded under "Worked for …" still have those headers.
  output.querySelectorAll(":scope > .chat-row.lc-worked-row").forEach(function(r) { r.remove(); });
  output.querySelectorAll(":scope > .chat-row.lc-work-member").forEach(function(r) { r.classList.remove("lc-work-member", "is-work-collapsed"); });
  const rows = Array.from(output.children).filter(function(el) { return el.classList && el.classList.contains("chat-row"); });
  const turns = [];
  let cur = null;
  rows.forEach(function(row) {
    if (row.classList.contains("sednar-user-row")) {
      cur = { user: row, rows: [] };
      turns.push(cur);
    } else if (cur) {
      cur.rows.push(row);
    }
  });
  const todo = opts && opts.lastTurnOnly ? turns.slice(-1) : turns;
  todo.forEach(function(t) {
    const user = t.user;
    let footer = t.rows.filter(function(r) { return r.classList.contains("lc-turn-footer"); })[0] || null;
    const body = t.rows.filter(function(r) { return !r.classList.contains("lc-turn-footer"); });
    // Only the newest turn can still be running; one with a turn after it has finished.
    const running = t === turns[turns.length - 1] && user.hasAttribute("data-turn-started") && !user.hasAttribute("data-turn-ms");
    let finalIdx = -1;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].classList.contains("sednar-assistant-row")) { finalIdx = i; break; }
    }
    // The footer under a finished answer: copy, branch, and when it finished.
    if (!running && finalIdx >= 0) {
      if (!footer) {
        footer = document.createElement("div");
        footer.className = "chat-row lc-turn-footer";
      }
      const html = _sednarTurnFooterHtml(user);
      if (footer._curHtml !== html) {
        footer.innerHTML = html;
        footer._curHtml = html;
      }
      const last = body[body.length - 1];
      if (last.nextElementSibling !== footer) last.after(footer);
    } else if (footer) {
      footer.remove();
    }
  });
}

const _SEDNAR_TURN_FOOTER_ICONS = {
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>',
  branch: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="2.5"></circle><circle cx="6" cy="6" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><path d="M18 8.5v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-1M12 11.5v4"></path></svg>',
};

function _sednarTurnEndedAt(user) {
  const started = Number(user.getAttribute("data-turn-started")) || 0;
  const ms = Number(user.getAttribute("data-turn-ms")) || 0;
  return started && ms ? started + ms : 0;
}

function _sednarShortAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function _sednarTurnFooterHtml(user) {
  const ended = _sednarTurnEndedAt(user);
  let time = "";
  if (ended) {
    const when = new Date(ended).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    time = '<span class="lc-turn-time" tabindex="0" data-ended="' + ended + '">' + _sednarShortAgo(ended) +
      '<span class="lc-turn-tip" role="tooltip"><span>' + _sednarEscapeHtml(when) + "</span>" +
      '<span class="lc-turn-tip-sub">' + _sednarEscapeHtml(_sednarWorkedForLabel(user.getAttribute("data-turn-ms"))) + "</span></span></span>";
  }
  return '<div class="lc-turn-actions">' +
    '<button type="button" class="lc-turn-btn" data-turn-action="copy" title="Copy" aria-label="Copy answer">' + _SEDNAR_TURN_FOOTER_ICONS.copy + "</button>" +
    '<button type="button" class="lc-turn-btn" data-turn-action="branch" title="Branch into a new chat from here" aria-label="Branch into a new chat from here">' + _SEDNAR_TURN_FOOTER_ICONS.branch + "</button>" +
    time + "</div>";
}

// The rows of the turn a footer closes, and its user message.
function _sednarFooterTurn(footer) {
  let node = footer.previousElementSibling;
  const rows = [];
  while (node && !node.classList.contains("sednar-user-row")) {
    rows.unshift(node);
    node = node.previousElementSibling;
  }
  return { user: node, rows: rows };
}

function _sednarCopyTurnAnswer(footer) {
  const turn = _sednarFooterTurn(footer);
  const answers = turn.rows.filter(function(r) { return r.classList.contains("sednar-assistant-row"); });
  const msg = answers.length ? answers[answers.length - 1].querySelector(".chat-msg") : null;
  if (!msg) return;
  const text = msg.dataset && msg.dataset.rawMd ? msg.dataset.rawMd : msg.innerText;
  _sednarCopyToClipboard(String(text || "").trim(), "Copied the answer");
}

// A new chat with this chat's history up to the end of this turn, opened in its own tab.
function _sednarBranchFromTurn(footer) {
  const out = footer.parentNode;
  const tab = _sednarGetActiveChatTab();
  const turn = _sednarFooterTurn(footer);
  if (!out || !tab || !tab.sessionId || !turn.user || !sednarProjectPath) return;
  if (tab.agentRunning) {
    _sednarShowIdeToast("Wait for the agent to finish before branching.");
    return;
  }
  const userIndex = Array.from(out.querySelectorAll(":scope > .chat-row.sednar-user-row")).indexOf(turn.user);
  if (userIndex < 0) return;
  const scratch = document.createElement("div");
  let node = out.firstElementChild;
  while (node) {
    scratch.appendChild(node.cloneNode(true));
    if (node === footer) break;
    node = node.nextElementSibling;
  }
  const newId = _sednarNewChatSessionId();
  fetch("/sednar/session/fork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: sednarProjectPath,
      session_id: tab.sessionId,
      new_session_id: newId,
      title: "Branch of " + (tab.title || "chat"),
      through_user_turn: userIndex,
      transcript_html: scratch.innerHTML,
      workspace: _sednarCurrentWorkspacePayload(),
    }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.success) {
      _sednarShowIdeToast("Couldn't branch the chat: " + ((data && data.error) || "unknown error"));
      return;
    }
    window.openSednarSessionInNewTab(newId);
  }).catch(function(err) {
    _sednarShowIdeToast("Couldn't branch the chat: " + (err.message || err));
  });
}

document.addEventListener("click", function(e) {
  const btn = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .lc-turn-btn") : null;
  if (!btn) return;
  e.preventDefault();
  const footer = btn.closest(".lc-turn-footer");
  if (!footer) return;
  if (btn.getAttribute("data-turn-action") === "copy") _sednarCopyTurnAnswer(footer);
  else if (btn.getAttribute("data-turn-action") === "branch") _sednarBranchFromTurn(footer);
});

// "14m ago" stays current.
setInterval(function() {
  document.querySelectorAll("#sednar-chat-messages .lc-turn-time[data-ended]").forEach(function(el) {
    const label = _sednarShortAgo(Number(el.getAttribute("data-ended")));
    const textNode = el.firstChild;
    if (textNode && textNode.nodeType === 3 && textNode.nodeValue !== label) textNode.nodeValue = label;
  });
}, 30000);

function _sednarToggleStepGroup(header) {
  const row = header.closest(".lc-group-row");
  const output = row && row.parentNode;
  if (!row || !output) return;
  const open = row.getAttribute("data-open") !== "1";
  row.setAttribute("data-open", open ? "1" : "0");
  const key = row.getAttribute("data-group-key");
  header.setAttribute("aria-expanded", open ? "true" : "false");
  header.toggleAttribute("data-panel-open", open);
  row._curHtml = row.innerHTML;
  output.querySelectorAll('.chat-row.lc-group-member[data-group-key="' + key + '"]').forEach(function(member) {
    member.classList.toggle("is-group-collapsed", !open);
  });
}

function _sednarBindStepGroupsOnce() {
  if (window._sednarStepGroupsBound) return;
  window._sednarStepGroupsBound = true;
  document.addEventListener("click", function(e) {
    const header = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .lc-group-toggle") : null;
    if (!header) return;
    e.preventDefault();
    _sednarToggleStepGroup(header);
  });
  document.addEventListener("keydown", function(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const header = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .lc-group-toggle") : null;
    if (!header) return;
    e.preventDefault();
    _sednarToggleStepGroup(header);
  });
}
_sednarBindStepGroupsOnce();

function _sednarToolCallArgs(tc) {
  try {
    const fn = (tc && tc.function) || {};
    const raw = fn.arguments || "{}";
    return typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
  } catch (_) {
    return {};
  }
}

function _sednarHumanToolLabel(tool, args) {
  const a = args || {};
  if (tool === "grep_repo") {
    const pat = String(a.pattern || "").slice(0, 80);
    return a.glob_filter ? "Grepped `" + pat + "` in " + a.glob_filter : "Grepped `" + pat + "`";
  }
  if (tool === "find_files") {
    const q = String(a.query || "").trim();
    const ext = String(a.ext || "").trim();
    const prefix = String(a.path_prefix || "").trim();
    const details = [q ? "`" + q.slice(0, 80) + "`" : "project", ext ? ("ext " + ext) : "", prefix ? ("in " + prefix) : ""].filter(Boolean).join(" ");
    return "Find files " + details;
  }
  if (tool === "glob_files") {
    const pat = String(a.pattern || "").trim();
    const dir = String(a.path || "").trim();
    const details = [pat ? "`" + pat.slice(0, 80) + "`" : "project", dir ? ("in " + dir) : ""].filter(Boolean).join(" ");
    return "Glob " + details;
  }
  if (tool === "read_repo_file") {
    const fp = _sednarBasename(a.file_path || "");
    if (a.start_line && a.end_line) return "Read " + fp + " L" + a.start_line + "-" + a.end_line;
    if (a.start_line) return "Read " + fp + " L" + a.start_line + "+";
    return "Read " + fp;
  }
  if (tool === "list_repo_dir") return "Explored " + (String(a.directory || "").trim() || "project");
  if (tool === "ast_symbols") return "Explored " + _sednarBasename(a.file_path || "");
  if (_sednarIsFileEditTool(tool)) return "Editing " + _sednarBasename(a.file_path || "");
  if (tool === "run_command") return "Running `" + String(a.command || "").slice(0, 72) + "`";
  if (tool === "find_symbol") return "Find symbol `" + String(a.name || "").slice(0, 40) + "`";
  if (tool === "find_references") return "Find refs `" + String(a.name || "").slice(0, 40) + "`";
  if (tool === "list_symbols") return "List symbols in " + String(a.path || "project").slice(0, 40);
  if (tool === "update_memory") return "Updated memory";
  if (tool === "todo_write") {
    const n = Array.isArray(a.todos) ? a.todos.length : 0;
    return "Updated task list" + (n ? " (" + n + " item" + (n === 1 ? "" : "s") + ")" : "");
  }
  if (tool === "update_goal") {
    if (a.completed) return "Goal complete";
    if (a.blocked_reason) return "Goal blocked";
    return "Goal progress";
  }
  if (tool === "lsp_definition" || tool === "lsp_references" || tool === "lsp_hover" || tool === "lsp_diagnostics") {
    const verb = { lsp_definition: "Definition", lsp_references: "References", lsp_hover: "Hover", lsp_diagnostics: "Diagnostics" }[tool];
    const fp = _sednarBasename(a.file_path || "");
    return verb + (fp ? " in " + fp + (a.line ? ":" + a.line : "") : "");
  }
  if (tool === "spawn_subagent") return "Subagent " + String(a.goal || "");
  if (tool === "attempt_completion") return "Thought briefly";
  if (tool === "git_log") {
    if (a.path && a.grep) return "Checked history of `" + a.path + "` matching `" + String(a.grep).slice(0, 40) + "`";
    if (a.path) return "Checked history of `" + a.path + "`";
    if (a.grep) return "Checked git history matching `" + String(a.grep).slice(0, 40) + "`";
    return "Checked git history";
  }
  const mcpInfo = _sednarMcpToolInfo(tool, a);
  if (mcpInfo.isMcp) return "Called MCP tool " + (mcpInfo.name || tool);
  return tool || "Working";
}

function _sednarAppendLoadedToolActivity(msg, output, next) {
  const calls = (msg && msg.tool_calls) || [];
  if (!calls.length) return;
  const nextRole = next ? next.role : "";
  calls.forEach(function(tc) {
    const fn = (tc && tc.function) || {};
    const tool = fn.name || "tool";
    if (tool === "attempt_completion") return;
    if (tool === "todo_write") return;
    if (tool === "spawn_subagent") {
      const agentArgs = _sednarToolCallArgs(tc);
      const saved = msg.subagent || {};
      _sednarAgentsAddRow(output, {
        id: tc.id || "",
        title: saved.title || agentArgs.title || _sednarAgentTitleFromGoal(agentArgs.goal),
        goal: agentArgs.goal || saved.goal || "",
        model: saved.model || "",
        state: "done",
      });
      _sednarAgentsFinishRow(output, tc.id || "", msg.subagent ? saved : { state: "done", outcome: "Done" }, agentArgs);
      return;
    }
    if (tool === "ask_question" && nextRole === "tool_artifact") return;
    const args = _sednarToolCallArgs(tc);
    if (tool === "run_command") {
      if (nextRole === "tool_artifact" && next.tool_name === "run_command") return;
      _sednarAppendLoadedCommandBlock(args.command || "", "", undefined, output, { description: args.description });
      return;
    }
    if (_sednarIsFileEditTool(tool) && nextRole === "diff") return;
    const parts = _sednarParseActivityParts(tool, args, _sednarHumanToolLabel(tool, args));
    if (parts && _sednarIsFileEditTool(tool) && parts.verb === "Editing") {
      parts.verb = String(tool || "").toLowerCase() === "write_file" ? "Wrote" : "Edited";
    }
    _sednarAppendActivityParts(parts, false, output);
  });
}


const _SEDNAR_AGENT_LOG_MAX = 40;
const _SEDNAR_AGENT_DEFAULT_STATUS = "Planning next moves";

function _sednarAgentIconHtml(state) {
  if (state === "running") {
    return '<span class="composer-subagent-status-indicator composer-subagent-status-indicator--running">' + _sednarDotGridHtml("xs") + "</span>";
  }
  const variant = state === "failed" ? "error" : "done";
  return '<span class="composer-subagent-status-indicator"><span class="composer-subagent-status-indicator__dot composer-subagent-status-indicator__dot--' + variant + '" aria-hidden="true"></span></span>';
}

function _sednarAgentCount(n, word, plural) {
  return n + " " + (n === 1 ? word : (plural || word + "s"));
}

function _sednarAgentTitleFromGoal(goal) {
  const first = String(goal || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?;:])\s/)[0] || "";
  const words = first.split(" ").slice(0, 6).join(" ").replace(/[\s.;:-]+$/, "");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function _sednarAgentDuration(seconds) {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

function _sednarAgentsCard(output, create) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  let last = output.lastElementChild;
  while (last && (
    !last.classList.contains("chat-row") ||
    last.classList.contains("sednar-status-row") ||
    last.classList.contains("lc-group-row") ||
    (last.classList.contains("sednar-assistant-row") && !last.classList.contains("sednar-narration-row"))
  )) {
    last = last.previousElementSibling;
  }
  if (last && last.classList.contains("sednar-agents-row")) return last.querySelector(".sednar-agents-card");
  if (!create) return null;
  _sednarBindAgentsCardOnce();
  const row = document.createElement("div");
  row.className = "chat-row sednar-agents-row";
  row.innerHTML = '<div class="sednar-agents-card" data-state="running"><div class="sednar-agents-list" role="list"></div></div>';
  _sednarAppendChatRow(output, row);
  return row.querySelector(".sednar-agents-card");
}

function _sednarAgentRow(output, agentId) {
  if (!output || !agentId) return null;
  const rows = output.querySelectorAll(".sednar-agent-row");
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].getAttribute("data-agent-id") === agentId) return rows[i];
  }
  return null;
}

function _sednarSetAgentState(row, state) {
  if (row.getAttribute("data-state") === state) return;
  row.setAttribute("data-state", state);
  const icon = row.querySelector(".sednar-agent-icon");
  icon.innerHTML = _sednarAgentIconHtml(state);
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", { running: "Running", done: "Completed", failed: "Failed", stopped: "Stopped" }[state] || state);
}

function _sednarSetAgentAction(row, text, live) {
  const el = row.querySelector(".sednar-agent-action");
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle("ui-shimmer", !!live);
  el.title = text;
}

function _sednarSetAgentCounts(row, data) {
  ["files_read", "searches", "files_changed"].forEach(function(key) {
    const value = data[key];
    if (value == null) return;
    const n = Array.isArray(value) ? value.length : (Number(value) || 0);
    row.setAttribute("data-" + key.replace(/_/g, "-"), String(n));
  });
}

function _sednarSetAgentModel(row, model) {
  const el = row.querySelector(".lc-subagent__model");
  const text = String(model || "").trim();
  if (el && text && el.textContent !== text) el.textContent = text;
}

function _sednarSetAgentStats(row) {
  let added = 0;
  let removed = 0;
  row.querySelectorAll(".sednar-agent-file").forEach(function(file) {
    added += Number(file.getAttribute("data-additions")) || 0;
    removed += Number(file.getAttribute("data-deletions")) || 0;
  });
  const el = row.querySelector(".lc-subagent__stats");
  if (!el) return;
  el.innerHTML = (added ? '<span class="lc-stat-added">+' + added + "</span>" : "") + (removed ? '<span class="lc-stat-removed">-' + removed + "</span>" : "");
}

function _sednarUpdateAgentsSummary(card) {
  if (!card) return;
  const running = card.querySelector('.sednar-agent-row[data-state="running"]');
  card.setAttribute("data-state", running ? "running" : "done");
}

function _sednarAgentsAddRow(output, agent) {
  const id = String(agent.id || "");
  let row = id ? _sednarAgentRow(output, id) : null;
  if (!row) {
    const card = _sednarAgentsCard(output, true);
    if (!card) return null;
    row = document.createElement("div");
    row.className = "sednar-agent-row";
    row.setAttribute("role", "listitem");
    row.setAttribute("data-agent-id", id);
    row.setAttribute("data-subagent-task-card", "");
    row.innerHTML =
      '<div class="sednar-agent-head" data-subagent-task-card-header role="button" tabindex="0" aria-expanded="false">' +
      '<div class="lc-subagent__main">' +
      '<span class="sednar-agent-icon lc-subagent__indicator"></span>' +
      '<div class="lc-subagent__body">' +
      '<div class="lc-subagent__title-row"><span class="sednar-agent-title lc-subagent__title"></span><span class="lc-subagent__model"></span></div>' +
      '<span class="lc-subagent__status"><span class="sednar-agent-action lc-subagent__status-text"></span><span class="lc-subagent__stats"></span></span>' +
      "</div>" +
      '<span class="lc-subagent__chevron">' + _sednarIcon("chevron-right", { size: "sm" }) + "</span>" +
      "</div></div>" +
      '<div class="sednar-agent-detail lc-subagent__detail" hidden>' +
      '<div class="sednar-agent-goal lc-subagent__goal"></div>' +
      '<ol class="sednar-agent-log lc-subagent__steps"></ol>' +
      '<div class="sednar-agent-files lc-subagent__files"></div>' +
      '<div class="sednar-agent-findings lc-subagent__findings"></div>' +
      '<div class="sednar-agent-findings-src" hidden></div></div>';
    card.querySelector(".sednar-agents-list").appendChild(row);
  }
  const title = String(agent.title || "").trim() || "Subagent";
  const goal = String(agent.goal || "").trim();
  row.querySelector(".sednar-agent-title").textContent = title;
  if (goal) row.querySelector(".sednar-agent-goal").textContent = goal;
  row.querySelector(".sednar-agent-head").title = goal || title;
  _sednarSetAgentModel(row, agent.model);
  const state = agent.state || "running";
  _sednarSetAgentState(row, state);
  if (state === "running") _sednarSetAgentAction(row, _SEDNAR_AGENT_DEFAULT_STATUS, true);
  _sednarUpdateAgentsSummary(row.closest(".sednar-agents-card"));
  return row;
}

function _sednarAgentStepHtml(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/^((?:Searched the web for|Searched memory for|Found references to|Finding references to|Listed symbols in|Read history of|Checked command|Found files|[A-Z][a-z]+))\s+(.*)$/);
  const verb = m ? m[1] : raw;
  const detail = m ? m[2].replace(/^["`]|["`]$/g, "") : "";
  return '<li class="ui-tool-call-line"><span class="ui-tool-call-line-action">' + _sednarEscapeHtml(verb) + "</span>" +
    (detail ? '<span class="ui-tool-call-line-details">' + _sednarEscapeHtml(detail) + "</span>" : "") + "</li>";
}

function _sednarAppendAgentLog(row, text) {
  const log = row.querySelector(".sednar-agent-log");
  const tmp = document.createElement("ol");
  tmp.innerHTML = _sednarAgentStepHtml(text);
  log.appendChild(tmp.firstElementChild);
  while (log.children.length > _SEDNAR_AGENT_LOG_MAX) log.removeChild(log.firstChild);
}

function _sednarAgentFileHtml(file) {
  const path = String(file.path || "");
  const name = _sednarBasename(path) || path;
  const open = _sednarEscapeHtml(String(file.absolute_path || path)).replace(/"/g, "&quot;");
  const added = Number(file.additions) || 0;
  const deleted = Number(file.deletions) || 0;
  return '<div class="sednar-agent-file ui-tool-call-line ui-tool-call-line--clickable" data-path="' + _sednarEscapeHtml(path).replace(/"/g, "&quot;") + '"' +
    ' data-additions="' + added + '" data-deletions="' + deleted + '">' +
    '<span class="ui-tool-call-line-icon"><img src="' + _sednarEscapeHtml(_sednarFileIcon(path)).replace(/"/g, "&quot;") + '" alt="" aria-hidden="true" draggable="false"></span>' +
    '<span class="ui-tool-call-line-details sednar-activity-file-link" data-file-path="' + open + '" title="' + _sednarEscapeHtml(path).replace(/"/g, "&quot;") + '">' + _sednarEscapeHtml(name) + "</span>" +
    (added || deleted ? '<span class="lc-group-stats">' +
      (added ? '<span class="lc-stat-added">+' + added + "</span>" : "") +
      (deleted ? '<span class="lc-stat-removed">-' + deleted + "</span>" : "") + "</span>" : "") +
    "</div>";
}

function _sednarRenderAgentFiles(row, files) {
  row.querySelector(".sednar-agent-files").innerHTML = (files || [])
    .filter(function(f) { return f && f.path; })
    .map(_sednarAgentFileHtml)
    .join("");
  _sednarSetAgentStats(row);
}

function _sednarAgentFileChanged(row, file) {
  const list = row.querySelector(".sednar-agent-files");
  const path = String(file.path || "");
  if (!path) return;
  const existing = Array.from(list.children).find(function(el) { return el.getAttribute("data-path") === path; });
  const total = {
    path: path,
    absolute_path: file.absolute_path || "",
    additions: (Number(file.additions) || 0) + (existing ? Number(existing.getAttribute("data-additions")) || 0 : 0),
    deletions: (Number(file.deletions) || 0) + (existing ? Number(existing.getAttribute("data-deletions")) || 0 : 0),
  };
  const tmp = document.createElement("div");
  tmp.innerHTML = _sednarAgentFileHtml(total);
  if (existing) existing.replaceWith(tmp.firstElementChild);
  else list.appendChild(tmp.firstElementChild);
  _sednarSetAgentStats(row);
}

function _sednarAgentsApplyUpdate(output, data) {
  const id = String(data.agent_id || "");
  let row = _sednarAgentRow(output, id);
  if (!row) row = _sednarAgentsAddRow(output, { id: id, title: data.title || data.message || "", model: data.model, state: "running" });
  if (!row) return;
  const state = data.state || "running";
  _sednarSetAgentState(row, state);
  _sednarSetAgentCounts(row, data);
  _sednarSetAgentModel(row, data.model);
  if (state === "running") {
    _sednarSetAgentAction(row, String(data.action || "") || _SEDNAR_AGENT_DEFAULT_STATUS, true);
    if (data.action && !data.action_running) _sednarAppendAgentLog(row, data.action);
  } else {
    _sednarSetAgentAction(row, _sednarAgentFinalStatus(state, data), false);
  }
  if (data.changed_file && data.changed_file.path) {
    _sednarAgentFileChanged(row, data.changed_file);
    if (data.changed_file.absolute_path) refreshSednarFileFromDisk(data.changed_file.absolute_path);
    _sednarSchedulePendingChangesRefresh();
    _sednarScheduleSilentTreeRefresh();
  }
  _sednarUpdateAgentsSummary(row.closest(".sednar-agents-card"));
}

function _sednarAgentFinalStatus(state, result) {
  if (state === "failed") return "Stopped with error";
  if (state === "stopped") return "Stopped";
  return "Completed";
}

function _sednarAgentsFinishRow(output, agentId, result, args) {
  result = result || {};
  args = args || {};
  let row = _sednarAgentRow(output, agentId);
  if (!row) {
    row = _sednarAgentsAddRow(output, {
      id: agentId,
      title: result.title || args.title || "",
      goal: args.goal || result.goal || "",
      model: result.model,
      state: "done",
    });
  }
  if (!row) return;
  const state = result.state || (result.error ? "failed" : "done");
  _sednarSetAgentState(row, state);
  _sednarSetAgentModel(row, result.model);
  const changedFiles = Array.isArray(result.files_changed) ? result.files_changed : null;
  _sednarSetAgentCounts(row, {
    files_read: result.files_read,
    searches: result.searches,
    files_changed: changedFiles,
  });
  _sednarSetAgentAction(row, _sednarAgentFinalStatus(state, result), false);
  const action = row.querySelector(".sednar-agent-action");
  if (state === "failed" && result.error) action.title = String(result.error);
  else if (result.duration_s != null) action.title = String(result.outcome || "Completed") + " · " + _sednarAgentDuration(result.duration_s);
  if (Array.isArray(result.actions) && result.actions.length) {
    row.querySelector(".sednar-agent-log").innerHTML = "";
    result.actions.slice(-_SEDNAR_AGENT_LOG_MAX).forEach(function(step) { _sednarAppendAgentLog(row, String(step)); });
  }
  if (changedFiles) _sednarRenderAgentFiles(row, changedFiles);
  const findings = String(result.result || "").trim();
  const src = row.querySelector(".sednar-agent-findings-src");
  if (findings && src.textContent !== findings) {
    src.textContent = findings;
    row.querySelector(".sednar-agent-findings").innerHTML = "";
    if (!row.querySelector(".sednar-agent-detail").hidden) _sednarRenderAgentFindings(row);
  }
  _sednarUpdateAgentsSummary(row.closest(".sednar-agents-card"));
}

function _sednarRenderAgentFindings(row) {
  const box = row.querySelector(".sednar-agent-findings");
  const src = row.querySelector(".sednar-agent-findings-src");
  if (!box || !src || box.childNodes.length || !src.textContent.trim()) return;
  _sednarRenderAssistantMarkdown(box, src.textContent);
}

function _sednarSettleRunningAgents(out) {
  if (!out) return;
  out.querySelectorAll('.sednar-agent-row[data-state="running"]').forEach(function(row) {
    _sednarSetAgentState(row, "stopped");
    _sednarSetAgentAction(row, "Stopped", false);
  });
  out.querySelectorAll(".sednar-agents-card").forEach(_sednarUpdateAgentsSummary);
}

function _sednarToggleAgentRow(head) {
  const row = head.closest(".sednar-agent-row");
  const detail = row && row.querySelector(".sednar-agent-detail");
  if (!detail) return;
  const open = detail.hidden;
  detail.hidden = !open;
  row.classList.toggle("is-open", open);
  head.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) _sednarRenderAgentFindings(row);
}

function _sednarBindAgentsCardOnce() {
  if (window._sednarAgentsCardBound) return;
  window._sednarAgentsCardBound = true;
  document.addEventListener("click", function(e) {
    const target = e.target && e.target.closest ? e.target : null;
    if (!target || !target.closest("#sednar-chat-messages")) return;
    if (target.closest(".sednar-agent-detail")) return;
    const head = target.closest(".sednar-agent-head");
    if (head) _sednarToggleAgentRow(head);
  });
  document.addEventListener("keydown", function(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const head = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .sednar-agent-head") : null;
    if (!head) return;
    e.preventDefault();
    _sednarToggleAgentRow(head);
  });
}

function _sednarAppendLoadedActivitySummary(text, output) {
  const raw = String(text || "").trim();
  if (!raw) return;
  raw.split(/\n+/).map(function(line) { return line.trim(); }).filter(Boolean).forEach(function(line) {
    _sednarAppendCompletedActivity("", {}, line);
  });
}

function _sednarAppendLoadedCommandBlock(command, outputText, exitCode, container, opts) {
  container = container || getSednarChatOutput();
  if (!container) return null;
  const row = _sednarCreateTerminalRow({
    command: command,
    description: opts && opts.description,
    output: outputText,
    exitCode: exitCode,
  });
  _sednarRemoveTransientThought(container);
  _sednarAppendChatRow(container, row);
  _sednarTerminalSyncScroll(row.querySelector(".sednar-term-card"));
  _sednarAutoScroll(container);
  _sednarSyncActiveTabMessagesHtml();
  return row;
}

const _SEDNAR_TERM_SHELL_SVG = "";
const _SEDNAR_TERM_CHEVRON_SVG = "";
const _SEDNAR_TERM_MORE_SVG = "";

function _sednarShellTokens(command) {
  const s = String(command || "");
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      tokens.push({ type: "space", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) j += (ch === '"' && s[j] === "\\") ? 2 : 1;
      j = Math.min(j + 1, s.length);
      tokens.push({ type: "str", text: s.slice(i, j) });
      i = j;
      continue;
    }
    const op = s.slice(i, i + 2).match(/^(&&|\|\||;|\||&|\(|\))/);
    if (op && !(op[0] === "&" && /[<>]/.test(s[i - 1] || ""))) {
      tokens.push({ type: "op", text: op[0] });
      i += op[0].length;
      continue;
    }
    let j = i;
    while (j < s.length && !/[\s'"()]/.test(s[j])) {
      if (/[;|]/.test(s[j]) || (s[j] === "&" && !/[<>]/.test(s[j - 1] || ""))) break;
      j++;
    }
    tokens.push({ type: "word", text: s.slice(i, j) });
    i = j;
  }
  return tokens;
}

function _sednarIsShellAssignment(word) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function _sednarHighlightShell(command) {
  let expectCmd = true;
  const tok = function(type, text) { return '<span class="ui-shell-tool-call__token--' + type + '">' + text + "</span>"; };
  return _sednarShellTokens(command).map(function(t) {
    const text = _sednarEscapeHtml(t.text);
    if (t.type === "space") return text;
    if (t.type === "op") {
      expectCmd = true;
      return tok("operator", text);
    }
    if (t.type === "str") {
      expectCmd = false;
      return tok("string", text);
    }
    if (/^\$/.test(t.text)) {
      expectCmd = false;
      return tok("variable", text);
    }
    if (expectCmd) {
      if (_sednarIsShellAssignment(t.text)) return text;
      expectCmd = false;
      return tok("command", text);
    }
    if (/^-(?!-?$)/.test(t.text)) return tok("flag", text);
    return tok("text", text);
  }).join("");
}

function _sednarCommandNames(command) {
  const names = [];
  let expectCmd = true;
  _sednarShellTokens(command).forEach(function(tok) {
    if (tok.type === "space") return;
    if (tok.type === "op") {
      expectCmd = tok.text !== ")";
      return;
    }
    if (!expectCmd) return;
    if (tok.type === "word" && _sednarIsShellAssignment(tok.text)) return;
    expectCmd = false;
    const name = tok.text.replace(/^['"]|['"]$/g, "").split("/").pop();
    if (name && names.indexOf(name) < 0) names.push(name);
  });
  return names;
}

function _sednarCleanTerminalText(text) {
  return String(text || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(function(line) {
      const parts = line.split("\r");
      return parts[parts.length - 1];
    })
    .join("\n");
}

function _sednarTerminalCardHtml(opts) {
  const o = opts || {};
  const command = String(o.command || "");
  const givenDescription = String(o.description || "").replace(/\s+/g, " ").trim();
  const rawDescription = givenDescription.replace(/^run(?=\s|$)\s*/i, "");
  const description = rawDescription ? rawDescription.charAt(0).toUpperCase() + rawDescription.slice(1) : "";
  const cardDescription = givenDescription ? givenDescription.charAt(0).toUpperCase() + givenDescription.slice(1) : "";
  const allNames = _sednarCommandNames(command);
  const title = description || _sednarTruncateMiddle(command.replace(/\s+/g, " ").trim(), 96) || "command";
  const allNamesText = allNames.slice(0, 5).join(", ") + (allNames.length > 5 ? " +" + (allNames.length - 5) : "");
  const names = description ? allNamesText : "";
  const output = _sednarCleanTerminalText(o.output).replace(/\s+$/, "");
  const exitCode = o.exitCode === undefined || o.exitCode === null ? "" : String(o.exitCode);
  const failed = exitCode !== "" && exitCode !== "0";
  const cls = "sednar-term-card ui-shell-tool-call" + (o.running ? " is-running" : "") + (failed ? " is-error" : "");
  const exitAttr = exitCode !== "" ? ' data-exit-code="' + _sednarEscapeHtml(exitCode) + '"' : "";
  const doneAttr = o.running ? "" : ' data-done="1"';
  const descAttr = ' data-description="' + _sednarEscapeHtml(description || title).replace(/"/g, "&quot;") + '"';
  return '<div class="' + cls + '"' + exitAttr + doneAttr + descAttr + ">" +
    '<div class="sednar-term-header ui-collapsible-header" data-expandable role="button" tabindex="0" aria-expanded="false">' +
    '<span class="ui-shell-tool-call__icon-swap" aria-hidden="true">' +
    _sednarIcon("terminal", { size: "sm", className: "ui-shell-tool-call__icon-default" }) +
    _sednarIcon("chevron-right", { size: "sm", className: "ui-shell-tool-call__icon-hover" }) +
    "</span>" +
    '<span class="sednar-term-action ui-collapsible-action' + (o.running ? " ui-shimmer" : "") + '">' + (o.running ? "Running" : "Ran") + "</span>" +
    '<span class="ui-collapsible-details ui-shell-tool-call__line-details">' +
    '<span class="sednar-term-title ui-shell-tool-call__line-description">' + _sednarEscapeHtml(title) + "</span>" +
    (names ? '<span class="sednar-term-cmds ui-shell-tool-call__line-summary">' + _sednarEscapeHtml(names) + "</span>" : "") +
    "</span>" +
    '<span class="ui-shell-tool-call__description-row">' +
    '<span class="sednar-term-card-title ui-shell-tool-call__description' + (o.running ? " ui-shimmer" : "") + '" data-description="' + (cardDescription ? "1" : "") + '">' +
    _sednarEscapeHtml(cardDescription || (o.running ? "Running command" : "Ran command")) + "</span>" +
    (allNamesText ? '<span class="ui-shell-tool-call__summary">' + _sednarEscapeHtml(allNamesText) + "</span>" : "") +
    "</span>" +
    '<span class="sednar-term-status ui-shell-tool-call__status">' + (failed ? "exit " + _sednarEscapeHtml(exitCode) : "") + "</span>" +
    _sednarIcon("chevron-right", { className: "ui-collapsible-chevron" }) +
    "</div>" +
    '<div class="sednar-term-body ui-shell-tool-call__body">' +
    '<button type="button" class="sednar-term-more ui-shell-tool-call__menu" title="Shell command options" aria-label="Shell command options" aria-haspopup="menu">' + _sednarIcon("ellipsis", { size: "sm" }) + "</button>" +
    '<div class="sednar-term-scroll ui-shell-tool-call__scroll">' +
    '<div class="sednar-term-cmdline ui-shell-tool-call__command"><span class="ui-shell-tool-call__prompt">$ </span>' + _sednarHighlightShell(command) + "</div>" +
    '<div class="sednar-term-output ui-shell-tool-call__output"' + (output ? "" : " hidden") + ">" + _sednarEscapeHtml(output) + "</div>" +
    "</div></div>" +
    "</div>";
}

const SEDNAR_AUTO_EXPAND_SHELL_LINES = 10;
const SEDNAR_AUTO_EXPAND_DIFF_LINES = 12;
const _SEDNAR_CARD_WRAP_CHARS = 48;

function _sednarVisualLineCount(text) {
  const value = String(text || "");
  if (!value) return 0;
  return value.split("\n").reduce(function(total, line) {
    return total + Math.max(1, Math.ceil(line.length / _SEDNAR_CARD_WRAP_CHARS));
  }, 0);
}

function _sednarSetTerminalExpanded(card, expanded) {
  card.classList.toggle("is-expanded", expanded);
  const header = card.querySelector(".sednar-term-header");
  if (header) {
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    header.toggleAttribute("data-panel-open", expanded);
  }
}

function _sednarTerminalWantsExpanded(card) {
  const cmd = card.querySelector(".sednar-term-cmdline");
  const out = card.querySelector(".sednar-term-output");
  const lines = _sednarVisualLineCount(cmd ? cmd.textContent : "") +
    _sednarVisualLineCount(out && !out.hidden ? out.textContent : "");
  return lines <= SEDNAR_AUTO_EXPAND_SHELL_LINES;
}

function _sednarAutoExpandTerminalCard(card) {
  if (!card || card.dataset.userToggled || card.classList.contains("is-pending")) return;
  _sednarSetTerminalExpanded(card, _sednarTerminalWantsExpanded(card));
}

// A finished command whose output is too long to keep open fades its output out before it folds, instead of
// snapping shut under the reader.
const SEDNAR_TERM_FADE_MS = 220;
function _sednarSettleFinishedTerminalCard(card) {
  const folding = card.classList.contains("is-expanded") && !card.dataset.userToggled &&
    !card.classList.contains("is-pending") && !_sednarTerminalWantsExpanded(card);
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!folding || reduced) {
    _sednarAutoExpandTerminalCard(card);
    _sednarTerminalSyncScroll(card);
    return;
  }
  card.classList.add("is-fading-out");
  setTimeout(function() {
    card.classList.remove("is-fading-out");
    _sednarAutoExpandTerminalCard(card);
    _sednarTerminalSyncScroll(card);
  }, SEDNAR_TERM_FADE_MS);
}

function _sednarCreateTerminalRow(opts) {
  const row = document.createElement("div");
  row.className = "chat-row sednar-command-output sednar-term-row";
  row.setAttribute("data-step-id", _sednarNextStepId());
  row.innerHTML = '<div class="chat-msg assistant sednar-plain-msg">' + _sednarTerminalCardHtml(opts) + "</div>";
  _sednarAutoExpandTerminalCard(row.querySelector(".sednar-term-card"));
  return row;
}

function _sednarSetTerminalRunning(card, running) {
  if (!card) return;
  card.classList.toggle("is-running", !!running);
  const action = card.querySelector(".sednar-term-action");
  if (action) {
    action.textContent = running ? "Running" : "Ran";
    action.classList.toggle("ui-shimmer", !!running);
  }
  const cardTitle = card.querySelector(".sednar-term-card-title");
  if (cardTitle) {
    if (!cardTitle.getAttribute("data-description")) cardTitle.textContent = running ? "Running command" : "Ran command";
    cardTitle.classList.toggle("ui-shimmer", !!running);
  }
}

function _sednarTerminalSyncScroll(card) {
  if (!card || card._sednarScrolledUp) return;
  const scroll = card.querySelector(".sednar-term-scroll");
  if (scroll && card.classList.contains("is-running")) scroll.scrollTop = scroll.scrollHeight;
}

function _sednarTerminalSetOutput(card, text) {
  const out = card && card.querySelector(".sednar-term-output");
  if (!out) return;
  const clean = _sednarCleanTerminalText(text).replace(/\s+$/, "");
  if (out.textContent !== clean) out.textContent = clean;
  out.hidden = !clean;
  _sednarTerminalSyncScroll(card);
}

function _sednarTerminalAppendOutput(card, chunk) {
  const out = card && card.querySelector(".sednar-term-output");
  if (!out || !chunk) return;
  card._sednarRawOutput = (card._sednarRawOutput != null ? card._sednarRawOutput : out.textContent) + String(chunk);
  // Chunks arrive faster than frames are drawn: the card is written once per frame.
  if (card._sednarFlushRaf) return;
  card._sednarFlushRaf = requestAnimationFrame(function() {
    card._sednarFlushRaf = null;
    if (card._sednarRawOutput != null) _sednarTerminalSetOutput(card, card._sednarRawOutput);
  });
}

function _sednarRunningTerminalCard(output) {
  if (!output) return null;
  const cards = output.querySelectorAll(".sednar-term-card:not([data-done])");
  return cards.length ? cards[cards.length - 1] : null;
}

function _sednarStartTerminalCard(args, output, tab) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  const a = args || {};
  const row = _sednarCreateTerminalRow({ command: a.command || "", description: a.description, running: true });
  _sednarRemoveTransientThought(output);
  _sednarAppendChatRow(output, row, tab);
  _sednarAutoScroll(output);
  return row.querySelector(".sednar-term-card");
}

function _sednarFinishTerminalCard(card, result) {
  if (!card) return;
  const r = result || {};
  const denied = card.classList.contains("is-denied");
  const text = r.output != null && String(r.output) !== "" ? r.output : (r.error || "");
  if (text && !denied) _sednarTerminalSetOutput(card, text);
  delete card._sednarRawOutput;
  card.dataset.done = "1";
  _sednarSetTerminalRunning(card, false);
  card.classList.remove("is-pending");
  const footer = card.querySelector(".sednar-term-footer");
  if (footer) footer.remove();
  if (r.exit_code !== undefined && r.exit_code !== null) card.dataset.exitCode = String(r.exit_code);
  const failed = !denied && (!!r.error || (r.exit_code !== undefined && r.exit_code !== null && Number(r.exit_code) !== 0));
  card.classList.toggle("is-error", failed);
  const statusEl = card.querySelector(".sednar-term-status");
  if (r.background && r.running) {
    card.classList.add("is-background");
    if (statusEl) statusEl.textContent = "in background";
  } else if (r.timed_out && statusEl) {
    statusEl.textContent = "timed out";
  } else if (r.cancelled && statusEl) {
    statusEl.textContent = "stopped";
  } else if (denied && statusEl) {
    statusEl.textContent = "skipped";
  } else if (statusEl) {
    statusEl.textContent = failed && r.exit_code != null ? "exit " + r.exit_code : "";
  }
  _sednarSettleFinishedTerminalCard(card);
  _sednarScheduleRegroup(card.closest("#sednar-chat-messages") || undefined);
}

function _sednarToggleTerminalCard(card) {
  if (!card || card.classList.contains("is-pending")) return;
  card.dataset.userToggled = "1";
  _sednarSetTerminalExpanded(card, !card.classList.contains("is-expanded"));
  _sednarTerminalSyncScroll(card);
}

function _sednarCloseTerminalMenu() {
  const menu = document.getElementById("sednar-term-menu");
  if (menu) menu.remove();
}

function _sednarOpenTerminalMenu(btn) {
  const card = btn && btn.closest(".sednar-term-card");
  if (!card) return;
  _sednarCloseTerminalMenu();
  const menu = document.createElement("div");
  menu.id = "sednar-term-menu";
  menu.className = "sednar-term-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML =
    '<button type="button" role="menuitem" data-term-action="copy-command">Copy command</button>' +
    '<button type="button" role="menuitem" data-term-action="copy-output">Copy output</button>';
  menu._sednarCard = card;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = Math.round(rect.bottom + 4) + "px";
  menu.style.left = Math.round(Math.max(8, rect.right - menu.offsetWidth)) + "px";
}

function _sednarTerminalCardText(card, part) {
  if (!card) return "";
  if (part === "output") {
    const out = card.querySelector(".sednar-term-output");
    return out ? out.textContent : "";
  }
  const line = card.querySelector(".sednar-term-cmdline");
  return line ? line.textContent.replace(/^\$\s/, "") : "";
}

let _sednarTerminalCardsBound = false;

function _sednarBindTerminalCardsOnce() {
  if (_sednarTerminalCardsBound) return;
  _sednarTerminalCardsBound = true;
  document.addEventListener("click", function(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const openMenu = document.getElementById("sednar-term-menu");
    const menuItem = t.closest("#sednar-term-menu [data-term-action]");
    if (menuItem) {
      const card = openMenu && openMenu._sednarCard;
      const action = menuItem.getAttribute("data-term-action");
      if (action === "copy-output") _sednarCopyToClipboard(_sednarTerminalCardText(card, "output"), "Output copied");
      else _sednarCopyToClipboard(_sednarTerminalCardText(card, "command"), "Command copied");
      _sednarCloseTerminalMenu();
      return;
    }
    const more = t.closest("#sednar-chat-messages .sednar-term-more");
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      const sameCard = openMenu && openMenu._sednarCard === more.closest(".sednar-term-card");
      if (sameCard) _sednarCloseTerminalMenu();
      else _sednarOpenTerminalMenu(more);
      return;
    }
    if (openMenu && !t.closest("#sednar-term-menu")) _sednarCloseTerminalMenu();
    if (!t.closest("#sednar-chat-messages")) return;
    const permBtn = t.closest(".sednar-permission-approve, .sednar-permission-deny");
    if (permBtn) {
      e.preventDefault();
      const row = permBtn.closest(".sednar-permission-row");
      _sednarSubmitPermissionDecision(row && row.dataset.requestId, permBtn.classList.contains("sednar-permission-approve"));
      return;
    }
    const header = t.closest(".sednar-term-header");
    if (header && !header.closest(".sednar-approval-card")) {
      _sednarToggleTerminalCard(header.closest(".sednar-term-card"));
      return;
    }
    const body = t.closest(".sednar-term-body");
    const bodyCard = body && body.closest(".sednar-term-card");
    if (bodyCard && !bodyCard.classList.contains("sednar-approval-card") && !t.closest("button, a")) {
      const sel = window.getSelection ? String(window.getSelection()) : "";
      if (!sel) _sednarToggleTerminalCard(bodyCard);
    }
  });
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") _sednarCloseTerminalMenu();
    if (e.key !== "Enter" && e.key !== " ") return;
    const header = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .sednar-term-header") : null;
    if (!header || e.target.closest(".sednar-term-more") || header.closest(".sednar-approval-card")) return;
    e.preventDefault();
    _sednarToggleTerminalCard(header.closest(".sednar-term-card"));
  });
  document.addEventListener("scroll", function(e) {
    const el = e.target;
    if (!el || !el.classList) return;
    const isBody = el.classList.contains("sednar-term-body");
    if (isBody) {
      const card = el.closest(".sednar-term-card");
      if (card) card.classList.toggle("is-clipped", el.scrollTop > 1);
    }
    if (isBody || el.id === "sednar-chat-messages") _sednarCloseTerminalMenu();
  }, true);
}

function _sednarSettleRunningTerminalCards(output, opts) {
  if (!output) return;
  const keepEmpty = !!(opts && opts.keepEmpty);
  output.querySelectorAll(".sednar-term-card:not([data-done])").forEach(function(card) {
    if (card.classList.contains("is-pending") && !keepEmpty) return;
    const out = card.querySelector(".sednar-term-output");
    if (keepEmpty || (out && out.textContent)) {
      _sednarFinishTerminalCard(card, {});
      return;
    }
    const row = card.closest(".chat-row");
    if (row) row.remove();
  });
}

function _sednarHandleCommandStream(data) {
  if (!data || data.source !== "sednar" || !data.session_id) return;
  const tab = sednarChatTabs.find(function(t) {
    return t.sessionId === data.session_id && t.agentRunning;
  });
  if (!tab || tab._answerStreaming || tab._turnStreamComplete) return;
  const output = _sednarGetOutputForTab(tab);
  if (!output) return;
  const isActiveTab = _sednarIsActiveTab(tab);
  if (isActiveTab && !_sednarChatOutputBelongsToTab(getSednarChatOutput(), tab)) return;
  _sednarWithTabContext(tab, function() {
    let card = _sednarRunningTerminalCard(output);
    if (!card) card = _sednarStartTerminalCard({ command: data.command || "" }, output, tab);
    if (!card) return;
    _sednarSetTerminalRunning(card, true);
    if (data.status === "stream") {
      _sednarTerminalAppendOutput(card, data.output || "");
    } else if (data.status === "output") {
      delete card._sednarRawOutput;
      _sednarTerminalSetOutput(card, data.output || "");
    }
    _sednarAutoScroll(output);
  });
  _sednarScheduleProgressSnapshot(tab, output, isActiveTab, data.status === "output");
}

const _SEDNAR_FILE_LINK_EXTS = new Set((
  "py pyi js jsx mjs cjs ts tsx json jsonc jsonl md mdx txt html htm css scss sass less xml yml yaml toml ini cfg conf " +
  "env lock sh bash zsh fish ps1 bat go rs java kt kts scala swift m mm c cc cpp cxx h hh hpp cs rb php pl lua r sql " +
  "graphql gql proto vue svelte astro dart ex exs erl hs ml clj tf hcl gradle properties csv tsv log ipynb pdf png jpg " +
  "jpeg gif svg webp ico wasm"
).split(" "));

function _sednarLooksLikeFilePath(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 240 || /\s/.test(raw)) return false;
  const path = raw.replace(/:\d+(?::\d+)?$/, "");
  if (!/^[\w.~@\/-]+$/.test(path) || /\/$/.test(path)) return false;
  const base = path.split("/").pop();
  if (/^\.[\w-]+$/.test(base)) return true;
  const m = base.match(/^[\w@-][\w.@-]*\.([A-Za-z0-9]{1,10})$/);
  return !!(m && _SEDNAR_FILE_LINK_EXTS.has(m[1].toLowerCase()));
}

function _sednarDecorateFileCodeSpans(el) {
  if (!el) return;
  el.querySelectorAll("code").forEach(function(code) {
    if (code.classList.contains("sednar-md-file-link") || code.closest("pre, a")) return;
    const text = String(code.textContent || "").trim();
    if (!_sednarLooksLikeFilePath(text)) return;
    const lineMatch = text.match(/:(\d+)(?::\d+)?$/);
    code.classList.add("sednar-md-file-link");
    code.setAttribute("data-file-path", _sednarResolveProjectFilePath(text.replace(/:\d+(?::\d+)?$/, "")));
    if (lineMatch) code.setAttribute("data-line-meta", "L" + lineMatch[1]);
    code.setAttribute("role", "link");
    code.setAttribute("tabindex", "0");
    code.setAttribute("title", text);
  });
}

function _sednarSplitMarkdownBlocks(md) {
  const text = String(md || "");
  if (!text.trim()) return [];
  if (typeof marked !== "undefined" && marked && typeof marked.lexer === "function") {
    try {
      const blocks = [];
      marked.lexer(text).forEach(function(tok) {
        if (tok && tok.type !== "space" && tok.raw) blocks.push(String(tok.raw));
      });
      if (blocks.length) return blocks;
    } catch (e) {}
  }
  const out = [];
  let cur = [];
  let fence = "";
  text.split("\n").forEach(function(line) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!fence) fence = m[1].charAt(0);
      else if (m[1].charAt(0) === fence) fence = "";
    }
    if (!fence && !line.trim()) {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
      return;
    }
    cur.push(line);
  });
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const _SEDNAR_OPEN_FENCE_RE = /^\s*(`{3,}|~{3,})([^\n]*)\n?([\s\S]*)$/;

function _sednarOpenFence(raw) {
  const m = String(raw || "").match(_SEDNAR_OPEN_FENCE_RE);
  if (!m) return null;
  const marker = m[1];
  const body = m[3];
  const lines = body.split("\n");
  const closed = lines.some(function(line) {
    const t = line.trim();
    return t.length >= marker.length && t.charAt(0) === marker.charAt(0) && /^(`{3,}|~{3,})$/.test(t);
  });
  if (closed) return null;
  return { lang: String(m[2] || "").trim().split(/\s+/)[0] || "", code: body };
}

function _sednarStreamBlockNodes(raw, openFence) {
  if (openFence) {
    const pre = document.createElement("pre");
    pre.className = "sednar-stream-code";
    const code = document.createElement("code");
    if (openFence.lang) code.className = "language-" + openFence.lang.replace(/[^\w-]/g, "");
    code.textContent = openFence.code;
    pre.appendChild(code);
    return [pre];
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = _sednarMarkdownToSafeHtml(raw);
  return Array.from(tmp.childNodes);
}

function _sednarStreamStateValid(el, state) {
  return state.blocks.every(function(block) {
    return block.nodes.every(function(node) { return node.parentNode === el; });
  });
}

function _sednarRenderStreamingMarkdown(el, text) {
  if (!el) return;
  const md = String(text || "");
  let state = el._sednarStream;
  if (!state || !_sednarStreamStateValid(el, state)) {
    el.innerHTML = "";
    state = { blocks: [], text: "" };
    el._sednarStream = state;
  }
  el._sednarFinalMd = null;
  const blocks = _sednarSplitMarkdownBlocks(md);
  let same = 0;
  while (same < blocks.length && same < state.blocks.length && state.blocks[same].raw === blocks[same]) same++;
  if (same === blocks.length - 1 && same === state.blocks.length - 1) {
    const prev = state.blocks[same];
    const fence = _sednarOpenFence(blocks[same]);
    if (prev.fence && fence && fence.lang === prev.fence.lang && prev.nodes.length === 1) {
      const code = prev.nodes[0].firstChild;
      if (code) code.textContent = fence.code;
      prev.raw = blocks[same];
      prev.fence = fence;
      state.text = md;
      return;
    }
  }
  for (let k = same; k < state.blocks.length; k++) {
    state.blocks[k].nodes.forEach(function(node) { if (node.parentNode === el) el.removeChild(node); });
  }
  state.blocks.length = same;
  for (let k = same; k < blocks.length; k++) {
    const fence = k === blocks.length - 1 ? _sednarOpenFence(blocks[k]) : null;
    const nodes = _sednarStreamBlockNodes(blocks[k], fence);
    nodes.forEach(function(node) { el.appendChild(node); });
    state.blocks.push({ raw: blocks[k], nodes: nodes, fence: fence });
  }
  state.text = md;
}

function _sednarRenderAssistantMarkdown(el, text) {
  if (!el) return;
  const md = String(text || "");
  const key = md.trim();
  if (el._sednarFinalMd === key && el.childNodes.length) return;
  const streamed = el._sednarStream && _sednarStreamStateValid(el, el._sednarStream) ? el._sednarStream : null;
  el._sednarStream = null;
  const hostMount = typeof window.mountSednarChatMarkdown === "function";
  if (streamed && !hostMount && streamed.text.trim() === key && !(streamed.blocks.length && streamed.blocks[streamed.blocks.length - 1].fence)) {
    _sednarDecorateRenderedMarkdown(el);
    el._sednarFinalMd = key;
    return;
  }
  const pinned = streamed && el.isConnected ? el.offsetHeight : 0;
  if (pinned) el.style.minHeight = pinned + "px";
  if (hostMount) {
    let patched = false;
    if (streamed && el.childNodes.length) {
      // Finishing a streamed answer: render the final markdown off screen and patch the streamed nodes to
      // match it, so the blocks that did not change keep their nodes and nothing blinks or jumps.
      const scratch = document.createElement("div");
      scratch.className = el.className;
      try {
        window.mountSednarChatMarkdown(scratch, md, { sednar: true, persistRaw: true });
        _sednarMorphChildren(el, scratch);
        if (scratch.dataset && scratch.dataset.rawMd != null) el.dataset.rawMd = scratch.dataset.rawMd;
        patched = true;
      } catch (e) {
        patched = false;
      }
    }
    if (!patched) {
      window.mountSednarChatMarkdown(el, md, {
        sednar: true,
        persistRaw: true,
      });
    }
    _sednarDecorateFileCodeSpans(el);
  } else if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    el.innerHTML = _sednarMarkdownToSafeHtml(md);
    _sednarDecorateRenderedMarkdown(el);
  } else {
    el.textContent = md;
  }
  el._sednarFinalMd = key;
  if (pinned) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { el.style.minHeight = ""; });
    });
  }
}

function _sednarDecorateRenderedMarkdown(el) {
  if (typeof window._decorateChatLinksGlobal === "function") {
    window._decorateChatLinksGlobal(el);
  }
  if (typeof window._decorateCodeBlocksGlobal === "function") {
    window._decorateCodeBlocksGlobal(el, { sednar: true });
  }
  _sednarDecorateFileCodeSpans(el);
}

function _sednarAppendNarration(text, output, tab) {
  const md = String(text || "").trim();
  output = output || getSednarChatOutput();
  if (!md || !output) return null;
  const row = document.createElement("div");
  row.className = "chat-row sednar-assistant-row sednar-narration-row";
  const msgEl = document.createElement("div");
  msgEl.className = "chat-msg assistant sednar-plain-msg";
  row.appendChild(msgEl);
  _sednarAppendChatRow(output, row, tab);
  _sednarRenderAssistantMarkdown(msgEl, md);
  _sednarAutoScroll(output);
  return row;
}

let _sednarAnswerLiveEl = null;
let _sednarAnswerLiveBuf = "";
let _sednarAnswerLiveRaf = null;

function _sednarResetAnswerLiveStream() {
  if (_sednarAnswerLiveRaf) {
    cancelAnimationFrame(_sednarAnswerLiveRaf);
    _sednarAnswerLiveRaf = null;
  }
  _sednarAnswerLiveEl = null;
  _sednarAnswerLiveBuf = "";
}

function _sednarDropLiveAnswerPreamble() {
  if (!_sednarAnswerLiveEl && !_sednarAnswerLiveBuf) return;
  if (_sednarAnswerLiveRaf) {
    cancelAnimationFrame(_sednarAnswerLiveRaf);
    _sednarAnswerLiveRaf = null;
  }
  if (_sednarAnswerLiveEl) {
    const row = _sednarAnswerLiveEl.closest(".sednar-assistant-row");
    if (row && row.parentNode) row.parentNode.removeChild(row);
    if (_sednarAssistantStreamEl === _sednarAnswerLiveEl) _sednarAssistantStreamEl = null;
  }
  _sednarAnswerLiveEl = null;
  _sednarAnswerLiveBuf = "";
}

function _sednarEnsureAnswerLiveEl(output, tab) {
  output = output || getSednarChatOutput();
  if (!output) return null;
  if (_sednarAnswerLiveEl && output.contains(_sednarAnswerLiveEl)) {
    return _sednarAnswerLiveEl;
  }
  _sednarFinalizeRunningActivity(undefined, output);
  const row = document.createElement("div");
  row.className = "chat-row sednar-assistant-row";
  const msgEl = document.createElement("div");
  msgEl.className = "chat-msg assistant sednar-stream-msg sednar-plain-msg";
  row.appendChild(msgEl);
  output.appendChild(row);
  _sednarAnswerLiveEl = msgEl;
  if (tab) tab._assistantStreamRow = row;
  _sednarAssistantStreamEl = msgEl;
  return msgEl;
}

function _sednarAppendAnswerDelta(delta, output, tab) {
  const text = String(delta || "");
  if (!text) return;
  _sednarAnswerLiveBuf += text;
  _sednarEnsureAnswerLiveEl(output, tab);
  if (_sednarAnswerLiveRaf) return;
  _sednarAnswerLiveRaf = requestAnimationFrame(function() {
    _sednarAnswerLiveRaf = null;
    const el = _sednarAnswerLiveEl;
    if (!el || (el._sednarFinalMd != null && el._sednarFinalMd === _sednarAnswerLiveBuf.trim())) return;
    _sednarRenderStreamingMarkdown(el, _sednarAnswerLiveBuf);
    _sednarAutoScroll(output || getSednarChatOutput());
  });
}

function _sednarCancelAnswerLiveFrame() {
  if (!_sednarAnswerLiveRaf) return;
  cancelAnimationFrame(_sednarAnswerLiveRaf);
  _sednarAnswerLiveRaf = null;
}

function _sednarFinalizeLiveAnswer(finalText, output, tab) {
  _sednarCancelAnswerLiveFrame();
  const txt = finalText || _sednarAnswerLiveBuf;
  if (txt) {
    const el = _sednarEnsureAnswerLiveEl(output, tab);
    if (el) _sednarRenderAssistantMarkdown(el, txt);
    _sednarAutoScroll(output || getSednarChatOutput());
  }
  if (tab) tab._answerStreamedText = txt;
  const o = output || getSednarChatOutput();
  if (tab && o) tab.messagesHtml = o.innerHTML;
  _sednarAnswerLiveEl = null;
  _sednarAnswerLiveBuf = "";
}

let _sednarStepNarrationEl = null;
let _sednarLastThoughtOuter = null;
let _sednarLastThoughtParts = null;
const _SEDNAR_SILENT_TOOLS = new Set(["todo_write", "update_goal", "attempt_completion", "structured_output"]);

function _sednarCommitLiveNarration(output, tab, finalText) {
  output = output || getSednarChatOutput();
  if (!_sednarAnswerLiveEl || !output || !output.contains(_sednarAnswerLiveEl)) return null;
  _sednarCancelAnswerLiveFrame();
  const el = _sednarAnswerLiveEl;
  const row = el.closest(".sednar-assistant-row");
  const text = String(finalText != null ? finalText : _sednarAnswerLiveBuf || "").trim();
  if (text) {
    _sednarRenderAssistantMarkdown(el, text);
    el.classList.remove("sednar-stream-msg");
    if (row) row.classList.add("sednar-narration-row");
  } else if (row && row.parentNode) {
    row.parentNode.removeChild(row);
  }
  if (tab && tab._assistantStreamRow === row) tab._assistantStreamRow = null;
  if (_sednarAssistantStreamEl === el) _sednarAssistantStreamEl = null;
  _sednarAnswerLiveEl = null;
  _sednarAnswerLiveBuf = "";
  _sednarStepNarrationEl = text ? el : null;
  return _sednarStepNarrationEl;
}

function _sednarAttachThoughtBody(text) {
  const body = String(text || "").trim();
  const outer = _sednarLastThoughtOuter;
  if (!body || !outer || !outer.isConnected || outer.querySelector(".sednar-thought-body")) return;
  const parts = Object.assign({}, _sednarLastThoughtParts || { verb: "Thought", detail: "briefly", meta: "" }, { thoughtContent: body });
  outer.innerHTML = _sednarBuildActivityHtml(parts, false);
  _sednarFillThoughtBody(outer, body);
}

function _sednarSettleLiveContent(data, output, tab, isActiveTab) {
  const role = data.role === "answer" ? "answer" : "narration";
  const text = String(data.text || "").trim();
  if (data.thought_content) _sednarAttachThoughtBody(data.thought_content);
  if (role === "answer") {
    if (isActiveTab && _sednarAnswerLiveEl && text) {
      _sednarCancelAnswerLiveFrame();
      _sednarAnswerLiveBuf = text;
      _sednarRenderAssistantMarkdown(_sednarAnswerLiveEl, text);
    }
    return;
  }
  if (isActiveTab && _sednarCommitLiveNarration(output, tab, text)) {
    _sednarAutoScroll(output);
    return;
  }
  if (_sednarStepNarrationEl && _sednarStepNarrationEl.isConnected) {
    if (text) _sednarRenderAssistantMarkdown(_sednarStepNarrationEl, text);
    return;
  }
  if (text) {
    const row = _sednarAppendNarration(text, output, tab);
    _sednarStepNarrationEl = row ? row.querySelector(".chat-msg") : null;
  }
}

function _sednarRemovePendingToolLines(output) {
  output = output || getSednarChatOutput();
  if (!output) return;
  output.querySelectorAll(".sednar-pending-tool").forEach(function(el) {
    if (_sednarRunningActivityEl === el) _sednarRunningActivityEl = null;
    el.remove();
  });
}

function _sednarPendingToolReady(tool, args) {
  if (_sednarIsFileEditTool(tool)) return !!String(args.file_path || "").trim();
  if (tool === "spawn_subagent") return !!String(args.goal || "").trim();
  return tool === "create_plan" || tool === "ask_question";
}

function _sednarShowPendingToolCall(data, output, tab) {
  const tool = String(data.tool || "");
  output = output || getSednarChatOutput();
  if (!tool || !output || _SEDNAR_SILENT_TOOLS.has(tool)) return;
  _sednarCommitLiveNarration(output, tab);
  const args = data.args || {};
  if (!_sednarPendingToolReady(tool, args)) return;
  const index = String(data.index != null ? data.index : 0);
  if (output.querySelector('.sednar-pending-tool[data-pending-index="' + index + '"]')) return;
  const parts = _sednarParseActivityParts(tool, args, _sednarHumanToolLabel(tool, args));
  if (!parts || !parts.verb) return;
  _sednarFinalizeRunningActivity(undefined, output);
  const el = _sednarAppendActivityParts(parts, true, output);
  if (!el) return;
  el.classList.add("sednar-pending-tool");
  el.setAttribute("data-pending-index", index);
  _sednarAutoScroll(output);
}

function _sednarActivityFeedActive() {
  return !!sednarAgentRunning;
}

function _sednarShowImmediateThinking(output, options) {
  output = output || getSednarChatOutput();
  const label = (options && options.bootstrap) ? "Planning next moves" : "Thinking";
  if (_sednarRunningActivityEl && _sednarIsThinkingLine()) {
    _sednarLastToolLabel = label;
    _sednarUpdateThinkingLineLabel();
    _sednarCleanupStaleThinkingLines(output, _sednarRunningActivityEl);
    _sednarStartThinkingTicker();
    return;
  }
  if (_sednarAdoptRunningThinking(output, label)) {
    _sednarStartThinkingTicker();
    return;
  }
  _sednarThinkingStartMs = Date.now();
  _sednarLastTool = "attempt_completion";
  _sednarLastToolArgs = {};
  _sednarLastToolLabel = label;
  _sednarAppendActivityParts({ verb: label, detail: "", meta: "" }, true, output);
  _sednarStartThinkingTicker();
}

function _sednarEnsureStatusRow(output) {
  output = output || getSednarChatOutput();
  if (!output) return;
  if (!_sednarStatusRow) {
    _sednarStatusRow = document.createElement("div");
    _sednarStatusRow.className = "chat-row sednar-status-row";
    _sednarStatusRow.id = "sednar-agent-status-row";
    _sednarStatusMsg = document.createElement("div");
    _sednarStatusMsg.className = "chat-msg assistant sednar-status-msg sednar-typing-indicator";
    _sednarStatusRow.appendChild(_sednarStatusMsg);
  }
  if (!_sednarStatusRow.parentNode) _sednarAppendChatRow(output, _sednarStatusRow);
  else if (_sednarStatusRow !== output.lastElementChild) {
    const anchor = _sednarGetAssistantAnchor(output);
    if (anchor && anchor.parentNode === output) {
      output.insertBefore(_sednarStatusRow, anchor);
    } else {
      output.appendChild(_sednarStatusRow);
    }
  }
}

function _sednarShowTyping(hint, output) {
  if (_sednarActivityFeedActive()) return;
  output = output || getSednarChatOutput();
  _sednarEnsureStatusRow(output);
  if (!_sednarStatusMsg) return;
  _sednarStatusMsg.classList.remove("sednar-running-status");
  _sednarStatusMsg.classList.add("sednar-typing-indicator");
  _sednarStatusMsg.innerHTML = '<span class="ui-shimmer">' + _sednarEscapeHtml(hint || "Planning next moves") + "</span>";
  _sednarAutoScroll(output);
}

function _sednarShowShimmer(message, output) {
  if (_sednarActivityFeedActive()) return;
  output = output || getSednarChatOutput();
  _sednarEnsureStatusRow(output);
  if (!_sednarStatusMsg) return;
  _sednarStatusMsg.classList.remove("sednar-typing-indicator");
  _sednarStatusMsg.classList.add("sednar-running-status");
  _sednarStatusMsg.innerHTML = '<span class="ui-shimmer">' + _sednarEscapeHtml(message) + "</span>";
  _sednarAutoScroll(output);
}

function _sednarSetPermissionToolbarVisible(visible) {
  const wrap = document.getElementById("sednar-permission-toolbar-actions");
  if (!wrap) return;
  wrap.style.display = visible ? "flex" : "none";
}

function _sednarGetActivePendingPermissionRequestId() {
  const tab = _sednarGetActiveChatTab();
  return tab ? String(tab.pendingPermissionRequestId || "") : "";
}

function _sednarSyncPermissionToolbar() {
  _sednarSetPermissionToolbarVisible(!!_sednarGetActivePendingPermissionRequestId());
  _sednarRenderQuestionsBar();
  _sednarSyncPlanCardButtons();
}

function _sednarClearPermissionRequest(requestId) {
  sednarChatTabs.forEach(function(tab) {
    if (tab.pendingPermissionRequestId === requestId) {
      tab.pendingPermissionRequestId = "";
    }
  });
  _sednarSyncPermissionToolbar();
}

function _sednarResolvePermissionRow(requestId, approved, output, label) {
  output = output || getSednarChatOutput();
  if (!output || !requestId) return;
  const row = Array.from(output.querySelectorAll(".sednar-permission-row"))
    .find(function(r) { return r.dataset && r.dataset.requestId === requestId; });
  if (!row) return;
  row.dataset.resolved = approved ? "approved" : "denied";
  const card = row.querySelector(".sednar-term-card");
  if (card) {
    const footer = card.querySelector(".sednar-term-footer");
    if (footer) footer.remove();
    card.classList.remove("is-pending");
    if (approved && !row.classList.contains("sednar-term-row")) {
      row.remove();
    } else if (!approved) {
      card.classList.remove("is-running");
      card.classList.add("is-denied");
      const status = card.querySelector(".sednar-term-status");
      if (status) status.textContent = label || (row.classList.contains("sednar-term-row") ? "Skipped" : "Denied");
    }
  } else if (approved) {
    row.remove();
  } else {
    const msg = row.querySelector(".sednar-permission-msg");
    if (msg) {
      msg.classList.add("is-denied");
      msg.querySelectorAll("button").forEach(function(btn) { btn.disabled = true; btn.remove(); });
      const kicker = msg.querySelector(".sednar-permission-kicker");
      if (kicker) kicker.textContent = label || "Permission denied";
    }
  }
  if (typeof _sednarSyncActiveTabMessagesHtml === "function") {
    _sednarSyncActiveTabMessagesHtml();
  }
}

function _sednarSubmitPermissionDecision(requestId, approved) {
  if (!requestId) return;
  const out = getSednarChatOutput();
  const row = out && Array.from(out.querySelectorAll(".sednar-permission-row"))
    .find(function(r) { return r.dataset && r.dataset.requestId === requestId; });
  if (row && row.dataset.resolved) return;
  _sednarClearPermissionRequest(requestId);
  _sednarResolvePermissionRow(requestId, approved, out);
  fetch("/sednar/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, approved: approved }),
  }).catch(function() {});
}

function _sednarPermissionFooterHtml(approveLabel) {
  return '<div class="sednar-term-footer ui-shell-tool-call__approval">' +
    '<button type="button" class="sednar-term-btn sednar-permission-deny ui-shell-tool-call__skip-btn">Skip</button>' +
    '<button type="button" class="sednar-term-btn is-primary sednar-permission-approve ui-shell-tool-call__run-btn">' + _sednarEscapeHtml(approveLabel) +
    '<span class="ui-shell-tool-call__kbd">\u23ce</span></button>' +
    "</div>";
}

function _sednarShowPermissionRequest(data, output, targetTab) {
  const tab = targetTab || _sednarGetActiveChatTab();
  output = output || getSednarChatOutput();
  if (!output) return;
  const requestId = data.request_id || "";

  if (requestId) {
    if (tab) tab.pendingPermissionRequestId = requestId;
    _sednarSyncPermissionToolbar();
    const existing = Array.from(output.querySelectorAll(".sednar-permission-row"))
      .find(function(row) { return row.dataset && row.dataset.requestId === requestId; });
    if (existing) {
      _sednarAutoScroll(output);
      return;
    }
  }
  const tool = data.tool || "";
  const args = data.args || {};

  if (tool === "run_command") {
    const card = _sednarRunningTerminalCard(output) || _sednarStartTerminalCard(args, output, tab);
    const cmdRow = card && card.closest(".chat-row");
    if (!cmdRow) return;
    cmdRow.classList.add("sednar-permission-row");
    cmdRow.dataset.requestId = requestId;
    card.classList.add("is-pending");
    const cardBody = card.querySelector(".sednar-term-body") || card;
    if (!card.querySelector(".sednar-term-footer")) {
      cardBody.insertAdjacentHTML("beforeend", _sednarPermissionFooterHtml("Run"));
    }
    _sednarAutoScroll(output);
    return;
  }

  function previewValue(value) {
    if (value == null || value === "") return "";
    let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    text = String(text || "").trim();
    return text.length > 600 ? text.slice(0, 597) + "…" : text;
  }

  const filePath = String(args.file_path || args.path || args.directory || "");
  let preview = previewValue(args.content || args.new_string || args.old_string) || filePath || tool || "unknown";
  let detail = filePath ? _sednarBasename(filePath) : tool;
  let verbLabel = _sednarIsFileEditTool(tool) ? "Edit" : "Run";

  const row = document.createElement("div");
  row.className = "chat-row sednar-permission-row sednar-command-output";
  row.dataset.requestId = requestId;
  row.innerHTML =
    '<div class="chat-msg assistant sednar-permission-msg sednar-plain-msg">' +
    '<div class="sednar-term-card ui-shell-tool-call sednar-approval-card is-pending">' +
    '<div class="sednar-term-header ui-collapsible-header">' +
    '<span class="ui-collapsible-action">' + _sednarEscapeHtml(verbLabel) + "</span>" +
    '<span class="ui-collapsible-details ui-shell-tool-call__line-details"><span class="sednar-term-title ui-shell-tool-call__line-description">' + _sednarEscapeHtml(detail) + "</span></span>" +
    '<span class="ui-shell-tool-call__description-row"><span class="ui-shell-tool-call__description">' + _sednarEscapeHtml(verbLabel + " " + detail) + "</span></span>" +
    '<span class="sednar-term-status ui-shell-tool-call__status"></span>' +
    "</div>" +
    '<div class="sednar-term-body ui-shell-tool-call__body"><div class="sednar-term-scroll ui-shell-tool-call__scroll">' +
    '<div class="sednar-term-output ui-shell-tool-call__output sednar-approval-preview">' + _sednarEscapeHtml(preview) + "</div>" +
    "</div>" + _sednarPermissionFooterHtml("Allow") + "</div>" +
    "</div></div>";
  _sednarAppendChatRow(output, row);
  _sednarTerminalSyncScroll(row.querySelector(".sednar-term-card"));
  _sednarAutoScroll(output);
}

const SEDNAR_FREEFORM_OPTION_ID = "__freeform_other__";
const SEDNAR_QUESTIONS_PLACEHOLDER = "Add more optional details";
const _SEDNAR_QUESTION_ICON_SVG =
  '<svg class="sednar-questions-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2.5 3.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11A1.5 1.5 0 0 1 2.5 9.5z"></path>' +
  '<path d="M6.6 5.1a1.45 1.45 0 0 1 2.8.5c0 .95-1.4 1.2-1.4 2"></path><circle cx="8" cy="9.1" r=".35" fill="currentColor" stroke="none"></circle></svg>';
const _SEDNAR_CHEVRON_UP_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4.5 10 8 6.5 11.5 10"></polyline></svg>';
const _SEDNAR_CHEVRON_DOWN_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4.5 6.5 8 10 11.5 6.5"></polyline></svg>';

function _sednarActiveQuestionState() {
  const tab = _sednarGetActiveChatTab();
  return tab && tab.pendingQuestion ? tab.pendingQuestion : null;
}

function _sednarQuestionAnswered(state, question) {
  if (!question.options || !question.options.length) return !!String(state.other[question.id] || "").trim();
  return (state.selections[question.id] || []).length > 0;
}

function _sednarQuestionsAllAnswered(state) {
  return state.questions.every(function(q) { return _sednarQuestionAnswered(state, q); });
}

function _sednarNextUnansweredQuestion(state, fromIndex) {
  const qs = state.questions;
  for (let i = fromIndex + 1; i < qs.length; i++) {
    if (!_sednarQuestionAnswered(state, qs[i])) return i;
  }
  for (let i = 0; i < fromIndex; i++) {
    if (!_sednarQuestionAnswered(state, qs[i])) return i;
  }
  return -1;
}

function _sednarShowQuestionRequest(data, targetTab) {
  const tab = targetTab || _sednarGetActiveChatTab();
  const questions = Array.isArray(data.questions) ? data.questions : [];
  if (!tab || !data.request_id || !questions.length) return;
  if (tab.pendingQuestion && tab.pendingQuestion.requestId === data.request_id) return;
  tab.pendingQuestion = {
    requestId: data.request_id,
    questions: questions,
    selections: {},
    other: {},
    active: 0,
    focused: -1,
    collapsed: false,
    submitting: false,
    focusOnRender: true,
  };
  if (_sednarIsActiveTab(tab)) _sednarRenderQuestionsBar();
}

function _sednarClearQuestionRequest(tab, requestId) {
  if (!tab || !tab.pendingQuestion) return;
  if (requestId && tab.pendingQuestion.requestId !== requestId) return;
  tab.pendingQuestion = null;
  if (_sednarIsActiveTab(tab)) _sednarRenderQuestionsBar();
}

function _sednarQuestionRowHtml(state, question, qIndex, oIndex, optionId, labelHtml) {
  const selected = (state.selections[question.id] || []).indexOf(optionId) >= 0;
  const hasSelection = _sednarQuestionAnswered(state, question);
  const focused = state.active === qIndex && state.focused === oIndex;
  const freeform = optionId === SEDNAR_FREEFORM_OPTION_ID;
  return '<div class="sednar-questions-option' +
    (freeform ? " is-freeform" : "") +
    (focused ? " is-focused" : "") +
    (!selected && hasSelection ? " is-unselected" : "") +
    (selected ? " is-selected" : "") +
    '" role="button" data-q="' + qIndex + '" data-o="' + oIndex + '">' +
    '<button type="button" class="sednar-questions-letter" tabindex="-1">' + String.fromCharCode(65 + oIndex) + "</button>" +
    labelHtml + "</div>";
}

function _sednarRenderQuestionsBar() {
  const bar = document.getElementById("sednar-questions-bar");
  const composer = document.getElementById("sednar-chat-composer");
  const input = document.getElementById("sednar-chat-input");
  const state = _sednarActiveQuestionState();
  if (!bar) return;
  _sednarBindQuestionsBarOnce(bar);
  if (!state) {
    if (!bar.hidden) {
      bar.hidden = true;
      bar.innerHTML = "";
      if (composer) composer.classList.remove("has-pending-questionnaire");
      _sednarApplyChatModeToUI();
    }
    return;
  }
  const oldScroll = bar.querySelector(".sednar-questions-scroll");
  const scrollTop = oldScroll ? oldScroll.scrollTop : 0;
  const activeEl = document.activeElement;
  const refocusFreeform = activeEl && activeEl.classList && activeEl.classList.contains("sednar-questions-freeform") && bar.contains(activeEl)
    ? Number(activeEl.getAttribute("data-q"))
    : -1;

  const total = state.questions.length;
  const answered = state.questions.filter(function(q) { return _sednarQuestionAnswered(state, q); }).length;
  // One question at a time: the card shows the active question, Next moves on to the next unanswered one,
  // and Continue sends the answers once every question has one.
  const allAnswered = _sednarQuestionsAllAnswered(state);
  const activeAnswered = _sednarQuestionAnswered(state, state.questions[state.active]);
  const canContinue = (allAnswered || activeAnswered) && !state.submitting;
  const othersOpen = state.questions.some(function(q, i) { return i !== state.active && !_sednarQuestionAnswered(state, q); });
  const continueLabel = othersOpen ? "Next" : "Continue";
  const headerRight = state.collapsed
    ? '<span class="sednar-questions-answered">' + answered + " of " + total + " answered</span>"
    : '<span class="sednar-questions-stepper">' +
        '<button type="button" class="sednar-questions-icon-btn" data-questions-action="prev" title="Previous question" aria-label="Previous question">' + _SEDNAR_CHEVRON_UP_SVG + "</button>" +
        '<span class="sednar-questions-stepper-label">' + (state.active + 1) + " of " + total + "</span>" +
        '<button type="button" class="sednar-questions-icon-btn" data-questions-action="next" title="Next question" aria-label="Next question">' + _SEDNAR_CHEVRON_DOWN_SVG + "</button>" +
      "</span>";
  const questionsHtml = state.questions.map(function(q, qIndex) {
    if (qIndex !== state.active) return "";
    const rows = q.options.map(function(opt, oIndex) {
      return _sednarQuestionRowHtml(state, q, qIndex, oIndex, opt.id,
        '<span class="sednar-questions-option-label">' + _sednarEscapeHtml(opt.label) + "</span>");
    }).join("") + _sednarQuestionRowHtml(state, q, qIndex, q.options.length, SEDNAR_FREEFORM_OPTION_ID,
      '<textarea class="sednar-questions-freeform" rows="' + (q.options.length ? 1 : 2) + '" placeholder="' +
        (q.options.length ? "Other..." : "Type your answer…") + '" data-q="' + qIndex + '"></textarea>');
    const hint = q.options.length ? (q.allow_multiple ? '<span class="sednar-questions-hint">Pick any that apply</span>' : "") : "";
    return '<div class="sednar-questions-question' + (qIndex === state.active ? " is-active" : "") + '" data-q="' + qIndex + '" data-key="q' + qIndex + '">' +
      '<div class="sednar-questions-prompt"><span class="sednar-questions-number">' + (qIndex + 1) + ".</span>" +
      '<span class="sednar-questions-prompt-text">' + _sednarEscapeHtml(q.prompt) + "</span>" + hint + "</div>" +
      '<div class="sednar-questions-options">' + rows + "</div></div>";
  }).join("");

  bar.hidden = false;
  bar.classList.toggle("is-collapsed", !!state.collapsed);
  _sednarMorph(bar,
    '<div class="sednar-questions-header" data-questions-action="' + (state.collapsed ? "expand" : "") + '">' +
      _SEDNAR_QUESTION_ICON_SVG +
      '<span class="sednar-questions-title">Questions</span>' +
      headerRight +
      '<button type="button" class="sednar-questions-icon-btn sednar-questions-collapse" data-questions-action="collapse" title="' +
        (state.collapsed ? "Expand questions" : "Minimize questions") + '" aria-label="' + (state.collapsed ? "Expand questions" : "Minimize questions") + '">' +
        (state.collapsed ? _SEDNAR_CHEVRON_UP_SVG : _SEDNAR_CHEVRON_DOWN_SVG) +
      "</button>" +
    "</div>" +
    (state.collapsed ? "" :
      '<div class="sednar-questions-scroll"><div class="sednar-questions-list">' + questionsHtml + "</div></div>" +
      '<div class="sednar-questions-actions">' +
        '<button type="button" class="sednar-btn is-text" data-questions-action="skip"' + (state.submitting ? " disabled" : "") + '>Skip<span class="sednar-kbd">Esc</span></button>' +
        '<button type="button" class="sednar-btn is-yellow" data-questions-action="continue"' + (canContinue ? "" : " disabled") + ">" + continueLabel + '<span class="sednar-kbd">⏎</span></button>' +
      "</div>"));

  bar.querySelectorAll(".sednar-questions-freeform").forEach(function(ta) {
    const q = state.questions[Number(ta.getAttribute("data-q"))];
    const value = (q && state.other[q.id]) || "";
    if (document.activeElement !== ta && ta.value !== value) ta.value = value;
    _sednarAutosizeQuestionFreeform(ta);
  });
  const scroll = bar.querySelector(".sednar-questions-scroll");
  if (scroll) {
    if (Math.abs(scroll.scrollTop - scrollTop) > 1) scroll.scrollTop = scrollTop;
    if (!scroll.dataset.maskBound) {
      scroll.dataset.maskBound = "1";
      scroll.addEventListener("scroll", function() { _sednarSyncQuestionsScrollMask(scroll); });
    }
    _sednarSyncQuestionsScrollMask(scroll);
  }
  if (composer) composer.classList.add("has-pending-questionnaire");
  if (input) input.setAttribute("data-placeholder", SEDNAR_QUESTIONS_PLACEHOLDER);
  if (refocusFreeform >= 0) {
    const ta = bar.querySelector('.sednar-questions-freeform[data-q="' + refocusFreeform + '"]');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  } else if (state.focusOnRender) {
    state.focusOnRender = false;
    requestAnimationFrame(function() {
      bar.focus({ preventScroll: true });
      const firstScroll = bar.querySelector(".sednar-questions-scroll");
      if (firstScroll) firstScroll.scrollTop = 0;
    });
  }
}

function _sednarAutosizeQuestionFreeform(ta) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

function _sednarSyncQuestionsScrollMask(scroll) {
  const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
  scroll.classList.toggle("is-at-bottom", atBottom);
}

function _sednarScrollToActiveQuestion() {
  const state = _sednarActiveQuestionState();
  const bar = document.getElementById("sednar-questions-bar");
  const scroll = bar && bar.querySelector(".sednar-questions-scroll");
  const el = scroll && scroll.querySelector('.sednar-questions-question[data-q="' + (state ? state.active : 0) + '"]');
  if (!el) return;
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  scroll.scrollTo({ top: Math.min(el.offsetTop, maxTop), behavior: "smooth" });
}

function _sednarSetActiveQuestion(state, index) {
  if (index < 0 || index >= state.questions.length) return;
  state.active = index;
  state.focused = -1;
  _sednarRenderQuestionsBar();
  _sednarScrollToActiveQuestion();
}

function _sednarToggleQuestionOption(state, qIndex, optionId) {
  const question = state.questions[qIndex];
  if (!question || state.submitting) return;
  const current = state.selections[question.id] || [];
  const has = current.indexOf(optionId) >= 0;
  let next;
  if (question.allow_multiple) {
    next = has ? current.filter(function(id) { return id !== optionId; }) : current.concat([optionId]);
  } else {
    next = has ? [] : [optionId];
  }
  state.selections[question.id] = next;
  state.active = qIndex;
  if (!question.allow_multiple && next.length && optionId !== SEDNAR_FREEFORM_OPTION_ID && !_sednarQuestionsAllAnswered(state)) {
    const nextIndex = _sednarNextUnansweredQuestion(state, qIndex);
    if (nextIndex >= 0) {
      _sednarSetActiveQuestion(state, nextIndex);
      return;
    }
  }
  _sednarRenderQuestionsBar();
}

function _sednarFocusQuestionFreeform(qIndex) {
  setTimeout(function() {
    const bar = document.getElementById("sednar-questions-bar");
    const ta = bar && bar.querySelector('.sednar-questions-freeform[data-q="' + qIndex + '"]');
    if (ta) ta.focus();
  }, 0);
}

function _sednarSubmitQuestions(skipped) {
  const tab = _sednarGetActiveChatTab();
  const state = tab && tab.pendingQuestion;
  if (!state || state.submitting) return;
  if (!skipped && !_sednarQuestionsAllAnswered(state)) {
    const nextIndex = _sednarNextUnansweredQuestion(state, state.active);
    _sednarSetActiveQuestion(state, nextIndex >= 0 ? nextIndex : state.active);
    return;
  }
  const composerState = typeof window.getSednarComposerState === "function" ? window.getSednarComposerState() : { text: "" };
  const details = String(composerState.text || "").trim();
  const answers = skipped ? [] : state.questions.map(function(q) {
    return { id: q.id, selected: state.selections[q.id] || [], other: state.other[q.id] || "" };
  });
  state.submitting = true;
  _sednarRenderQuestionsBar();
  fetch("/sednar/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: state.requestId, skipped: !!skipped, answers: answers, details: details }),
  }).then(function(resp) {
    if (!resp.ok && resp.status !== 404) throw new Error("HTTP " + resp.status);
    if (details && typeof window.clearSednarComposer === "function") window.clearSednarComposer();
    _sednarClearQuestionRequest(tab, state.requestId);
  }).catch(function() {
    state.submitting = false;
    _sednarRenderQuestionsBar();
  });
}

function _sednarHandleQuestionsKeydown(e) {
  const state = _sednarActiveQuestionState();
  const bar = document.getElementById("sednar-questions-bar");
  if (!state || !bar || bar.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  const active = document.activeElement;
  const messages = getSednarChatOutput();
  if (!(active === document.body || bar.contains(active) || (messages && messages.contains(active)))) return;
  if (state.collapsed) {
    if ((e.key === "Enter" || e.key === " ") && bar.contains(active)) {
      e.preventDefault();
      state.collapsed = false;
      _sednarRenderQuestionsBar();
    }
    return;
  }
  const question = state.questions[state.active];
  if (!question) return;
  const optionCount = question.options.length + 1;
  const stop = function() { e.preventDefault(); e.stopPropagation(); };
  const pick = function(oIndex) {
    if (oIndex < question.options.length) {
      _sednarToggleQuestionOption(state, state.active, question.options[oIndex].id);
      return;
    }
    const qIndex = state.active;
    if ((state.selections[question.id] || []).indexOf(SEDNAR_FREEFORM_OPTION_ID) < 0) {
      _sednarToggleQuestionOption(state, qIndex, SEDNAR_FREEFORM_OPTION_ID);
    }
    _sednarFocusQuestionFreeform(qIndex);
  };
  switch (e.key) {
    case "Tab":
      stop();
      _sednarSetActiveQuestion(state, (state.active + (e.shiftKey ? -1 : 1) + state.questions.length) % state.questions.length);
      return;
    case "ArrowDown":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowLeft": {
      stop();
      const step = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : -1;
      state.focused = state.focused < 0 ? 0 : (state.focused + step + optionCount) % optionCount;
      _sednarRenderQuestionsBar();
      return;
    }
    case " ":
      stop();
      if (state.focused < 0) state.focused = 0;
      pick(state.focused);
      return;
    case "Enter":
      stop();
      _sednarSubmitQuestions(false);
      return;
    case "Escape":
      stop();
      _sednarSubmitQuestions(true);
      return;
    default:
      if (e.key.length === 1) {
        const oIndex = e.key.toUpperCase().charCodeAt(0) - 65;
        if (oIndex >= 0 && oIndex < optionCount) {
          stop();
          state.focused = -1;
          pick(oIndex);
        }
      }
  }
}

function _sednarBindQuestionsBarOnce(bar) {
  if (bar.dataset.bound === "1") return;
  bar.dataset.bound = "1";
  window.addEventListener("keydown", _sednarHandleQuestionsKeydown, { capture: true });
  bar.addEventListener("click", function(e) {
    const state = _sednarActiveQuestionState();
    if (!state) return;
    const actionEl = e.target.closest("[data-questions-action]");
    const action = actionEl ? actionEl.getAttribute("data-questions-action") : "";
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      if (action === "prev" || action === "next") {
        const n = state.questions.length;
        _sednarSetActiveQuestion(state, (state.active + (action === "next" ? 1 : -1) + n) % n);
      } else if (action === "collapse" || action === "expand") {
        state.collapsed = action === "collapse" ? !state.collapsed : false;
        _sednarRenderQuestionsBar();
        bar.focus({ preventScroll: true });
      } else if (action === "skip") {
        _sednarSubmitQuestions(true);
      } else if (action === "continue") {
        _sednarSubmitQuestions(false);
      }
      return;
    }
    const row = e.target.closest(".sednar-questions-option");
    if (!row) return;
    const qIndex = Number(row.getAttribute("data-q"));
    const oIndex = Number(row.getAttribute("data-o"));
    const question = state.questions[qIndex];
    if (!question) return;
    state.focused = -1;
    if (row.classList.contains("is-freeform")) {
      const selected = (state.selections[question.id] || []).indexOf(SEDNAR_FREEFORM_OPTION_ID) >= 0;
      if (!selected || e.target.closest(".sednar-questions-letter")) {
        _sednarToggleQuestionOption(state, qIndex, SEDNAR_FREEFORM_OPTION_ID);
      }
      if (!selected) _sednarFocusQuestionFreeform(qIndex);
      return;
    }
    _sednarToggleQuestionOption(state, qIndex, question.options[oIndex].id);
    if (document.activeElement !== bar) bar.focus({ preventScroll: true });
  });
  bar.addEventListener("input", function(e) {
    const ta = e.target.closest(".sednar-questions-freeform");
    const state = _sednarActiveQuestionState();
    if (!ta || !state) return;
    const question = state.questions[Number(ta.getAttribute("data-q"))];
    if (!question) return;
    state.other[question.id] = ta.value;
    _sednarAutosizeQuestionFreeform(ta);
    // An open question counts as answered once it has text: Continue follows it without a redraw.
    const go = bar.querySelector('[data-questions-action="continue"]');
    if (go) go.disabled = !(_sednarQuestionsAllAnswered(state) && !state.submitting);
  });
  bar.addEventListener("focusin", function(e) {
    const ta = e.target.closest && e.target.closest(".sednar-questions-freeform");
    const state = _sednarActiveQuestionState();
    if (!ta || !state) return;
    const qIndex = Number(ta.getAttribute("data-q"));
    const question = state.questions[qIndex];
    if (question && (state.selections[question.id] || []).indexOf(SEDNAR_FREEFORM_OPTION_ID) < 0) {
      _sednarToggleQuestionOption(state, qIndex, SEDNAR_FREEFORM_OPTION_ID);
    }
  });
  bar.addEventListener("keydown", function(e) {
    const ta = e.target.closest && e.target.closest(".sednar-questions-freeform");
    if (!ta || !_sednarActiveQuestionState()) return;
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ta.blur();
      bar.focus({ preventScroll: true });
      _sednarSubmitQuestions(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      ta.blur();
      bar.focus({ preventScroll: true });
    }
  });
}

const _SEDNAR_TODOS_ICON_SVG =
  '<svg class="sednar-todos-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="3.6" cy="4.6" r="1.35"></circle><circle cx="3.6" cy="11.4" r="1.35"></circle>' +
  '<line x1="7" y1="4.6" x2="13.5" y2="4.6"></line><line x1="7" y1="11.4" x2="13.5" y2="11.4"></line></svg>';
const _SEDNAR_PLUS_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="3" x2="8" y2="13"></line><line x1="3" y1="8" x2="13" y2="8"></line></svg>';
const _SEDNAR_X_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"></line><line x1="12" y1="4" x2="4" y2="12"></line></svg>';
const _SEDNAR_TODO_SECTION_RE = /^##\s+task checklist\s*$/i;
const _SEDNAR_TODO_LINE_RE = /^(\s*[-*]\s+\[)([ xX~-])(\]\s+)(.*)$/;
const _SEDNAR_TODO_MARK_STATUS = { x: "completed", X: "completed", "~": "in_progress", "-": "cancelled", " ": "pending" };
const _SEDNAR_TODO_STATUS_MARK = { completed: "x", in_progress: "~", cancelled: "-", pending: " " };

function _sednarTodoStatusIconHtml(status) {
  const cls = "sednar-todo-status is-" + (status || "pending");
  if (status === "completed") {
    return '<span class="' + cls + '" aria-label="Completed"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="currentColor"></circle><polyline points="5.2 8.2 7.2 10.1 10.9 6.1" stroke="var(--lc-bg)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"></polyline></svg></span>';
  }
  if (status === "in_progress") {
    return '<span class="' + cls + '" aria-label="In progress"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6" stroke-dasharray="2.4 2.2"></circle></svg></span>';
  }
  return '<span class="' + cls + '" aria-label="' + (status === "cancelled" ? "Cancelled" : "Pending") + '"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6"></circle></svg></span>';
}

function _sednarPlanChecklistBounds(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (_SEDNAR_TODO_SECTION_RE.test(lines[i].trim())) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#/.test(lines[j])) { end = j; break; }
      }
      return { heading: i, start: i + 1, end: end };
    }
  }
  return null;
}

function _sednarPlanTodosFromMarkdown(markdown) {
  const lines = String(markdown || "").split("\n");
  const bounds = _sednarPlanChecklistBounds(lines);
  if (!bounds) return [];
  const todos = [];
  for (let i = bounds.start; i < bounds.end; i++) {
    const m = _SEDNAR_TODO_LINE_RE.exec(lines[i]);
    if (!m || !m[4].trim()) continue;
    todos.push({ id: "plan-" + (todos.length + 1), content: m[4].trim(), status: _SEDNAR_TODO_MARK_STATUS[m[2]] || "pending" });
  }
  return todos;
}

function _sednarPlanMarkdownWithTodos(markdown, todos) {
  const lines = String(markdown || "").replace(/\s+$/, "").split("\n");
  const items = (todos || []).filter(function(t) { return String(t.content || "").trim(); }).map(function(t) {
    return "- [" + (_SEDNAR_TODO_STATUS_MARK[t.status] || " ") + "] " + String(t.content).replace(/\s+/g, " ").trim();
  });
  const bounds = _sednarPlanChecklistBounds(lines);
  if (!bounds) {
    if (!items.length) return lines.join("\n");
    return lines.join("\n") + "\n\n## Task checklist\n\n" + items.join("\n") + "\n";
  }
  const section = items.length ? ["", ...items, ""] : [""];
  const head = lines.slice(0, items.length ? bounds.start : bounds.heading);
  const tail = lines.slice(bounds.end);
  return (items.length ? head.concat(section) : head).concat(tail).join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

function _sednarPlanMarkdownWithoutChecklist(markdown) {
  const lines = String(markdown || "").split("\n");
  const bounds = _sednarPlanChecklistBounds(lines);
  if (!bounds) return String(markdown || "");
  return lines.slice(0, bounds.heading).concat(lines.slice(bounds.end)).join("\n");
}

function _sednarPlanCardHtml(plan) {
  const file = String(plan.file || "");
  const overview = String(plan.overview || "").trim();
  return '<div class="sednar-plan-card" data-plan-file="' + _sednarEscapeHtml(file).replace(/"/g, "&quot;") + '">' +
    '<div class="sednar-plan-card-head">' +
      '<span class="sednar-plan-card-kicker">Created Plan</span>' +
      '<span class="sednar-plan-card-title">' + _sednarEscapeHtml(plan.title || "Plan") + "</span>" +
    "</div>" +
    '<div class="sednar-plan-card-body">' +
      (overview ? '<div class="sednar-plan-card-overview">' + _sednarMarkdownToSafeHtml(overview) + "</div>" : "") +
      '<div class="sednar-plan-card-actions">' +
        '<button type="button" class="sednar-btn is-text" data-plan-action="view">View Plan</button>' +
        '<button type="button" class="sednar-btn is-yellow sednar-plan-card-build" data-plan-action="build">Build<span class="sednar-kbd">⌘⏎</span></button>' +
      "</div>" +
    "</div></div>";
}

function _sednarAppendPlanCard(plan, output, tab) {
  output = output || getSednarChatOutput();
  if (!output || !plan || !plan.file) return null;
  output.querySelectorAll('.sednar-plan-card-row').forEach(function(row) {
    if (row.getAttribute("data-plan-file") === plan.file) row.remove();
  });
  const row = document.createElement("div");
  row.className = "chat-row sednar-plan-card-row";
  row.setAttribute("data-plan-file", plan.file);
  row.innerHTML = _sednarPlanCardHtml(plan);
  _sednarAppendChatRow(output, row, tab);
  _sednarSyncPlanCardButtons(output);
  _sednarAutoScroll(output);
  return row;
}

function _sednarSyncPlanCardButtons(output) {
  output = output || getSednarChatOutput();
  if (!output) return;
  const tab = _sednarGetActiveChatTab();
  const building = tab && tab.agentRunning ? String(tab.buildingPlanFile || "") : "";
  output.querySelectorAll(".sednar-plan-card").forEach(function(card) {
    const btn = card.querySelector(".sednar-plan-card-build");
    if (!btn) return;
    const isBuilding = !!building && card.getAttribute("data-plan-file") === building;
    btn.disabled = !!(tab && tab.agentRunning);
    btn.classList.toggle("is-building", isBuilding);
    btn.innerHTML = "Build" + '<span class="sednar-kbd">⌘⏎</span>';
  });
  _sednarSyncPlanHeaderBuildButton();
  const planInfo = _sednarActiveFileInfo();
  if (planInfo && planInfo.isPlan && planInfo.planFile) _sednarRefreshPlanTodosView(planInfo.planFile);
}

function _sednarSyncPlanHeaderBuildButton() {
  const btn = document.getElementById("ide-plan-build");
  if (!btn) return;
  const info = _sednarActiveFileInfo();
  const tab = _sednarGetActiveChatTab();
  const running = !!(tab && tab.agentRunning);
  const isBuilding = running && !!info && !!info.planFile && tab.buildingPlanFile === info.planFile;
  btn.disabled = running;
  btn.classList.toggle("is-building", isBuilding);
  btn.innerHTML = "Build" + '<span class="sednar-kbd">⌘⏎</span>';
}

function _sednarBuildTodoSummary(todos) {
  const list = (todos || []).filter(function(t) { return t && t.status !== "cancelled"; });
  if (!list.length) return null;
  let index = list.findIndex(function(t) { return t.status === "in_progress"; });
  if (index < 0) index = list.findIndex(function(t) { return t.status !== "completed"; });
  if (index < 0) index = list.length - 1;
  return { item: list[index], position: index + 1, total: list.length };
}

function _sednarRenderBuildTodos(row, todos) {
  if (!row) return;
  const wrap = row.querySelector(".sednar-plan-exec-todos");
  if (!wrap) return;
  const known = row._sednarTodoTexts || (row._sednarTodoTexts = {});
  (row._sednarTodos || []).forEach(function(t) {
    if (t && t.id && t.content && t.content !== t.id) known[t.id] = t.content;
  });
  todos = (todos || []).map(function(t) {
    if (!t || !t.id || (t.content && t.content !== t.id)) return t;
    return known[t.id] ? Object.assign({}, t, { content: known[t.id] }) : t;
  });
  const planFile = row.getAttribute("data-plan-file");
  if (planFile && !row._sednarTextsFetched && todos.some(function(t) { return t && t.id && (!t.content || t.content === t.id); })) {
    row._sednarTextsFetched = true;
    fetch("/sednar/plan-content?file=" + encodeURIComponent(planFile))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) return;
        (data.todos || []).forEach(function(t) { if (t && t.id && t.content) known[t.id] = t.content; });
        _sednarRenderBuildTodos(row, row._sednarTodos || todos);
      })
      .catch(function() {});
  }
  const summary = _sednarBuildTodoSummary(todos);
  if (!summary) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  row._sednarTodos = todos;
  const expanded = row.classList.contains("is-todos-expanded");
  wrap.hidden = false;
  wrap.innerHTML =
    '<button type="button" class="sednar-plan-exec-todo-summary" data-plan-action="toggle-todos" aria-expanded="' + expanded + '">' +
      _sednarTodoStatusIconHtml(summary.item.status) +
      '<span class="sednar-plan-exec-todo-text">' + _sednarEscapeHtml(summary.item.content) + "</span>" +
      '<span class="sednar-plan-exec-todo-count">' + summary.position + "/" + summary.total + "</span>" +
    "</button>" +
    (expanded ? '<div class="sednar-plan-exec-todo-list">' + todos.map(function(t) {
      return '<div class="sednar-plan-exec-todo-item is-' + (t.status || "pending") + '">' + _sednarTodoStatusIconHtml(t.status) +
        '<span class="sednar-plan-exec-todo-text">' + _sednarEscapeHtml(t.content || "") + "</span></div>";
    }).join("") + "</div>" : "");
}

function _sednarRenderPlanBuildRow(output, displayPayload) {
  const build = displayPayload && displayPayload.plan_build;
  if (!output || !build || !build.file) return null;
  const row = document.createElement("div");
  row.className = "chat-row sednar-user-row sednar-plan-exec-row";
  row.setAttribute("data-plan-file", build.file);
  row.innerHTML =
    '<div class="sednar-plan-exec">' +
      '<button type="button" class="sednar-plan-exec-head" data-plan-action="view" title="Open plan">' +
        '<span class="sednar-plan-exec-label">Build</span>' + _SEDNAR_TODOS_ICON_SVG +
        '<span class="sednar-plan-exec-title">' + _sednarEscapeHtml(build.title || "Plan") + "</span>" +
      "</button>" +
      '<div class="sednar-plan-exec-todos" hidden></div>' +
    "</div>";
  output.appendChild(row);
  fetch("/sednar/plan-content?file=" + encodeURIComponent(build.file))
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data && data.ok && !row._sednarTodos) _sednarRenderBuildTodos(row, data.todos || []);
    })
    .catch(function() {});
  return row;
}

function _sednarUpdateBuildTodos(output, planFile, todos) {
  output = output || getSednarChatOutput();
  if (!output || !planFile) return;
  const rows = Array.from(output.querySelectorAll(".sednar-plan-exec-row")).filter(function(r) {
    return r.getAttribute("data-plan-file") === planFile;
  });
  if (rows.length) _sednarRenderBuildTodos(rows[rows.length - 1], todos);
}

function _sednarStartPlanBuild(planFile, title) {
  if (!planFile) return;
  if (!sednarProjectPath) {
    _sednarSetPlanStatus("Open a project folder first");
    return;
  }
  const tab = _sednarGetActiveChatTab();
  if (tab && tab.agentRunning) {
    _sednarSetPlanStatus("Agent is still running");
    return;
  }
  window.sednarChatMode = "agent";
  try { localStorage.setItem(SEDNAR_CHAT_MODE_STORAGE_KEY, "agent"); } catch (e) {}
  _sednarApplyChatModeToUI();
  toggleSednarAgentPane(true);
  window.sendSednarAgentMessage(
    "Implement the approved plan: " + (title || planFile),
    { mode: "agent", planFile: planFile, planTitle: title || planFile }
  );
}

function _sednarBindPlanCardsOnce() {
  if (window._sednarPlanCardsBound) return;
  window._sednarPlanCardsBound = true;
  document.addEventListener("click", function(e) {
    const actionEl = e.target.closest && e.target.closest("[data-plan-action]");
    if (!actionEl || !actionEl.closest("#sednar-chat-messages")) return;
    const holder = actionEl.closest("[data-plan-file]");
    const planFile = holder ? holder.getAttribute("data-plan-file") : "";
    const action = actionEl.getAttribute("data-plan-action");
    e.preventDefault();
    if (action === "toggle-todos") {
      const row = actionEl.closest(".sednar-plan-exec-row");
      if (!row) return;
      row.classList.toggle("is-todos-expanded");
      if (row._sednarTodos) {
        _sednarRenderBuildTodos(row, row._sednarTodos);
      } else if (planFile) {
        fetch("/sednar/plan-content?file=" + encodeURIComponent(planFile))
          .then(function(resp) { return resp.json(); })
          .then(function(data) { if (data && data.ok) _sednarRenderBuildTodos(row, data.todos || []); })
          .catch(function() {});
      }
      return;
    }
    if (!planFile) return;
    if (action === "view") {
      window.openSednarPlanTab(planFile, "");
    } else if (action === "build" && !actionEl.disabled) {
      const title = (holder.querySelector(".sednar-plan-card-title") || {}).textContent || "";
      _sednarStartPlanBuild(planFile, title);
    }
  });
}

const _SEDNAR_CHAT_BUBBLE_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 2.5c3.3 0 5.5 2.1 5.5 4.8S11.3 12 8 12c-.6 0-1.2-.1-1.8-.2L3 13.3l.9-2.6C3 9.8 2.5 8.6 2.5 7.3 2.5 4.6 4.7 2.5 8 2.5z"></path></svg>';
const _SEDNAR_SPINNER_SVG =
  '<svg class="sednar-plan-todo-spinner" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M8 2a6 6 0 1 1-6 6"></path></svg>';

function _sednarPlanBuildTab(planFile) {
  if (!planFile) return null;
  const marker = 'data-plan-file="' + planFile.replace(/"/g, "&quot;") + '"';
  let found = null;
  sednarChatTabs.forEach(function(tab) {
    if (found && found.agentRunning) return;
    const live = _sednarIsActiveTab(tab) ? getSednarChatOutput() : null;
    const html = live ? live.innerHTML : String(tab.messagesHtml || (tab._backgroundOutput && tab._backgroundOutput.innerHTML) || "");
    if (html.indexOf("sednar-plan-exec-row") >= 0 && html.indexOf(marker) >= 0) found = tab;
  });
  return found;
}

function _sednarPlanTodosSectionHtml(todos, planFile) {
  const buildTab = _sednarPlanBuildTab(planFile);
  const building = !!(buildTab && buildTab.agentRunning && buildTab.buildingPlanFile === planFile);
  return '<div class="sednar-plan-todos">' +
    '<div class="sednar-plan-todos-header">' +
      '<span class="sednar-plan-todos-label">' + todos.length + " To-do" + (todos.length === 1 ? "" : "s") + "</span>" +
      '<span class="sednar-plan-todos-actions">' +
        '<button type="button" class="sednar-btn is-secondary" data-plan-todo-action="add">' + _SEDNAR_PLUS_SVG + "New</button>" +
      "</span>" +
    "</div>" +
    '<div class="sednar-plan-todos-list">' +
      (todos.length ? todos.map(function(t, i) {
        const assignment = buildTab
          ? '<span class="sednar-plan-todo-trailing"><button type="button" class="sednar-plan-todo-assignment" data-plan-todo-action="open-build" tabindex="-1" aria-label="Open the Build chat" title="Open the Build chat">' +
              (building && t.status === "in_progress" ? _SEDNAR_SPINNER_SVG : _SEDNAR_CHAT_BUBBLE_SVG) + "</button></span>"
          : "";
        return '<div class="sednar-plan-todo is-' + (t.status || "pending") + '" data-index="' + i + '">' +
          '<button type="button" class="sednar-plan-todo-status" data-plan-todo-action="toggle" tabindex="-1" aria-label="Mark ' +
            (t.status === "completed" ? "not done" : "done") + '">' + _sednarTodoStatusIconHtml(t.status) + "</button>" +
          '<textarea class="sednar-plan-todo-text" rows="1" spellcheck="false" placeholder="Todo description..." aria-label="Todo content" data-index="' + i + '"></textarea>' +
          assignment +
        "</div>";
      }).join("") : '<button type="button" class="sednar-plan-todos-empty" data-plan-todo-action="add">Add a to-do to get started</button>') +
    "</div></div>";
}

function _sednarRefreshPlanTodosView(planFile, todos) {
  const key = _sednarPlanTabKey(planFile);
  const info = ideOpenFiles[key];
  if (!info || !info.isPlan) return;
  if (Array.isArray(todos) && todos.length) {
    const statuses = {};
    todos.forEach(function(t) { if (t && t.id) statuses[t.id] = t.status; });
    const merged = _sednarPlanTodosFromMarkdown(info.content || "").map(function(t) {
      return statuses[t.id] ? Object.assign({}, t, { status: statuses[t.id] }) : t;
    });
    const wasClean = info.content === (info.originalContent || "");
    info.content = _sednarPlanMarkdownWithTodos(info.content || "", merged);
    if (wasClean) info.originalContent = info.content;
  }
  const body = document.getElementById("ide-plan-body");
  if (ideActiveFile !== key || !body || info.viewMode === "markdown") return;
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains("sednar-plan-todo-text") && body.contains(active)) return;
  body.querySelectorAll(".sednar-plan-todos").forEach(function(el) { el.remove(); });
  _sednarMountPlanTodos(body, key);
}

function _sednarAutosizePlanTodo(ta) {
  if (!ta || (window.CSS && CSS.supports && CSS.supports("field-sizing", "content"))) return;
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

function _sednarMountPlanTodos(body, fileKey, focus, list) {
  const info = ideOpenFiles[fileKey];
  if (!body || !info || !info.isPlan) return;
  const todos = (list || _sednarPlanTodosFromMarkdown(info.content || "")).map(function(t) {
    return { content: String(t.content || ""), status: t.status || "pending" };
  });
  const holder = document.createElement("div");
  holder.innerHTML = _sednarPlanTodosSectionHtml(todos, info.planFile);
  const section = holder.firstChild;
  section._todos = todos;
  const doc = body.querySelector(".sednar-plan-md");
  (doc || body).appendChild(section);
  section.querySelectorAll(".sednar-plan-todo-text").forEach(function(ta) {
    const item = todos[Number(ta.getAttribute("data-index"))];
    ta.value = item ? item.content : "";
    _sednarAutosizePlanTodo(ta);
  });
  if (focus && focus.index != null) {
    const ta = section.querySelector('.sednar-plan-todo-text[data-index="' + focus.index + '"]');
    if (ta) {
      ta.focus();
      const pos = focus.caret === "start" ? 0 : ta.value.length;
      ta.setSelectionRange(pos, pos);
    }
  }

  const current = function() {
    section.querySelectorAll(".sednar-plan-todo-text").forEach(function(ta) {
      const item = section._todos[Number(ta.getAttribute("data-index"))];
      if (item) item.content = ta.value.replace(/\s+/g, " ").trim();
    });
    return section._todos.map(function(t) { return Object.assign({}, t); });
  };
  const save = function(next) {
    const markdown = _sednarPlanMarkdownWithTodos(info.content || "", next.filter(function(t) { return t.content; }));
    if (markdown === info.content) return;
    info.content = markdown;
    info.modified = info.content !== (info.originalContent || "");
    _sednarSavePlanSourceContent(fileKey, { silent: true });
  };
  const rerender = function(next, focusAfter) {
    const scrollTop = body.scrollTop;
    section.remove();
    _sednarMountPlanTodos(body, fileKey, focusAfter, next);
    body.scrollTop = scrollTop;
  };

  section.addEventListener("click", function(e) {
    const btn = e.target.closest("[data-plan-todo-action]");
    if (!btn) return;
    e.preventDefault();
    const action = btn.getAttribute("data-plan-todo-action");
    const next = current();
    if (action === "add") {
      const last = next.length - 1;
      if (last >= 0 && !next[last].content) {
        rerender(next, { index: last });
        return;
      }
      next.push({ content: "", status: "pending" });
      rerender(next, { index: next.length - 1 });
      return;
    }
    if (action === "open-build") {
      const tab = _sednarPlanBuildTab(info.planFile);
      if (!tab) return;
      if (!_sednarIsActiveTab(tab)) _sednarSwitchChatTab(tab.id);
      toggleSednarAgentPane(true);
      const out = getSednarChatOutput();
      const rows = out ? Array.from(out.querySelectorAll(".sednar-plan-exec-row")).filter(function(r) {
        return r.getAttribute("data-plan-file") === info.planFile;
      }) : [];
      if (rows.length) rows[rows.length - 1].scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const rowEl = btn.closest(".sednar-plan-todo");
    const index = rowEl ? Number(rowEl.getAttribute("data-index")) : -1;
    if (action === "toggle" && next[index] && next[index].content) {
      next[index].status = next[index].status === "completed" ? "pending" : "completed";
      save(next);
      rerender(next.filter(function(t) { return t.content; }));
    }
  });
  section.addEventListener("input", function(e) {
    const ta = e.target.closest && e.target.closest(".sednar-plan-todo-text");
    if (ta) _sednarAutosizePlanTodo(ta);
  });
  section.addEventListener("keydown", function(e) {
    const ta = e.target.closest && e.target.closest(".sednar-plan-todo-text");
    if (!ta) return;
    const index = Number(ta.getAttribute("data-index"));
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const next = current();
      if (!next[index] || !next[index].content) return;
      next.splice(index + 1, 0, { content: "", status: "pending" });
      save(next);
      rerender(next, { index: index + 1 });
    } else if (e.key === "Backspace" && !ta.value && ta.selectionStart === 0) {
      e.preventDefault();
      const next = current();
      next.splice(index, 1);
      save(next);
      rerender(next, index > 0 ? { index: index - 1 } : null);
    } else if (e.key === "ArrowUp" && ta.selectionStart === 0 && index > 0) {
      e.preventDefault();
      const prev = section.querySelector('.sednar-plan-todo-text[data-index="' + (index - 1) + '"]');
      if (prev) { prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length); }
    } else if (e.key === "ArrowDown" && ta.selectionEnd === ta.value.length) {
      const below = section.querySelector('.sednar-plan-todo-text[data-index="' + (index + 1) + '"]');
      if (below) { e.preventDefault(); below.focus(); below.setSelectionRange(0, 0); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      ta.blur();
    }
  });
  section.addEventListener("focusout", function(e) {
    const ta = e.target.closest && e.target.closest(".sednar-plan-todo-text");
    if (!ta || !section.isConnected) return;
    const next = current();
    save(next);
    const stillInList = e.relatedTarget && section.contains(e.relatedTarget);
    if (!stillInList && next.some(function(t) { return !t.content; })) {
      rerender(next.filter(function(t) { return t.content; }));
    }
  });
}

function _sednarHideStatusRow() {
  if (_sednarStatusRow && _sednarStatusRow.parentNode) _sednarStatusRow.remove();
}

function _sednarClearPendingToolSteps() {
  _sednarFinalizeRunningActivity();
  _sednarSettleRunningTerminalCards(getSednarChatOutput());
  _sednarHideStatusRow();
}

let _sednarProgressSnapshotTimer = null;
const _sednarProgressSnapshotTimersByTab = {};

function _sednarFlushProgressSnapshot(targetTab, output, isActiveTab) {
  if (!targetTab || !output) return;
  targetTab.messagesHtml = output.innerHTML;
  if (!isActiveTab) {
    targetTab.hasUnread = true;
    _sednarRenderChatTabs();
  } else if (targetTab.messagesHtml && targetTab.sessionId) {
    _sednarSyncActiveTabMessagesHtml();
  }
}

function _sednarScheduleProgressSnapshot(targetTab, output, isActiveTab, immediate) {
  if (immediate) _sednarRegroupTranscript(output, { lastTurnOnly: true });
  else _sednarScheduleRegroup(output);
  const tabId = targetTab && (targetTab.sessionId || targetTab.id);
  if (immediate) {
    if (tabId && _sednarProgressSnapshotTimersByTab[tabId]) {
      clearTimeout(_sednarProgressSnapshotTimersByTab[tabId]);
      delete _sednarProgressSnapshotTimersByTab[tabId];
    }
    _sednarFlushProgressSnapshot(targetTab, output, isActiveTab);
    return;
  }
  if (!tabId) return;
  if (_sednarProgressSnapshotTimersByTab[tabId]) {
    clearTimeout(_sednarProgressSnapshotTimersByTab[tabId]);
  }
  _sednarProgressSnapshotTimersByTab[tabId] = setTimeout(function() {
    delete _sednarProgressSnapshotTimersByTab[tabId];
    _sednarFlushProgressSnapshot(targetTab, output, isActiveTab);
  }, 1500);
}

function handleSednarProgress(data) {
  if (!data) return;
  const sessionId = data.session_id || "";
  const turnId = data.turn_id || "";
  const seq = Number(data.seq || 0);
  const targetTab = sednarChatTabs.find(function(t) { return t.sessionId === data.session_id; })
    || _sednarFindBackgroundChatTab(data.session_id);
  const isCostEvent = data.status === "complete" || data.type === "usage";
  if (!targetTab || (!targetTab.agentRunning && !isCostEvent)) return;
  if (sessionId && turnId) {
    const activeTurnId = _sednarActiveTurnIdBySession[sessionId];
    if (activeTurnId && activeTurnId !== turnId) return;
    _sednarActiveTurnIdBySession[sessionId] = turnId;
  }
  if (sessionId && seq) {
    const seqKey = turnId ? (sessionId + ":" + turnId) : sessionId;
    const lastSeq = _sednarLastProgressSeqBySession[seqKey] || 0;
    if (seq <= lastSeq) return;
    _sednarLastProgressSeqBySession[seqKey] = seq;
  }

  const isActiveTab = _sednarIsActiveTab(targetTab);
  if (typeof window._sednarNotifyProgress === "function") {
    try { window._sednarNotifyProgress(data); } catch (e) {}
  }
  if (data.status === "complete") {
    const completeCost = Number(data.cost_usd || 0);
    if (completeCost > 0) {
      const turnUsageKey = sessionId && turnId ? (sessionId + ":" + turnId) : "";
      const priorTurnCost = turnUsageKey && targetTab._usageCostByTurn ? Number(targetTab._usageCostByTurn[turnUsageKey] || 0) : 0;
      const missingCost = completeCost - priorTurnCost;
      if (missingCost > 0.0000001) {
        targetTab.costUsd = (targetTab.costUsd || 0) + missingCost;
        if (isActiveTab) _sednarUpdateChatCostDisplay(targetTab, { animate: true });
      }
    }
    targetTab._turnStreamComplete = true;
  } else if (data.status === "progress" && data.type === "usage") {
    const promptTokens = Number(data.prompt_tokens || 0);
    const contextLimit = Number(data.context_tokens || 0);
    if (promptTokens > 0 && contextLimit > 0) {
      targetTab.contextUsed = promptTokens;
      targetTab.contextLimit = contextLimit;
      targetTab.contextBreakdown = data.context_breakdown && typeof data.context_breakdown === "object" ? data.context_breakdown : null;
      targetTab.contextCompactAt = Number(data.compact_at || 0);
      targetTab.contextModel = String(data.context_model || "");
      targetTab.contextCached = Number(data.cached_tokens || 0);
      if (isActiveTab) _sednarUpdateContextRing(targetTab);
    }
    const usageCost = Number(data.cost_usd || 0);
    if (usageCost > 0) {
      targetTab.costUsd = (targetTab.costUsd || 0) + usageCost;
      if (sessionId && turnId) {
        const usageKey = sessionId + ":" + turnId;
        targetTab._usageCostByTurn = targetTab._usageCostByTurn || {};
        targetTab._usageCostByTurn[usageKey] = Number(targetTab._usageCostByTurn[usageKey] || 0) + usageCost;
      }
      if (isActiveTab) _sednarUpdateChatCostDisplay(targetTab, { animate: true });
    }
    return;
  }

  const output = _sednarGetOutputForTab(targetTab);
  if (!output) return;

  _sednarWithTabContext(targetTab, function() {
    if (isActiveTab) {
      if (data.session_id !== sednarAgentSessionId) return;
      if (!_sednarChatOutputBelongsToTab(getSednarChatOutput(), targetTab)) return;
    }

    if (data.status === "complete") {
      _sednarScheduleProgressSnapshot(targetTab, output, isActiveTab, true);
      return;
    }
    if (data.status !== "progress") return;

    const progressType = data.type || "shimmer";

    if (
      (targetTab._answerStreaming || targetTab._turnStreamComplete) &&
      progressType !== "permission_request"
    ) {
      return;
    }

    const message = data.message || "";
    const tool = data.tool || "";
    const args = data.args || {};

    if (progressType === "permanent") {
      return;
    } else if (progressType === "diff_block") {
      _sednarCommitLiveNarration(output, targetTab);
      _sednarFinalizeRunningActivity(_sednarIsFileEditTool(_sednarLastTool) ? { remove: true } : { pastTense: true }, output);
      appendSednarDiffBlock({
        file_name: data.file_name,
        diff_html: message,
        additions: data.additions || 0,
        deletions: data.deletions || 0,
        absolute_path: data.absolute_path || "",
        created: !!data.created,
      }, output);
    } else if (progressType === "plan_created") {
      const planFile = data.plan_file || "";
      const planTitle = data.plan_title || message || "Plan";
      targetTab.planFile = planFile;
      if (planFile) {
        _sednarFinalizeRunningActivity({ pastTense: true }, output);
        _sednarAppendPlanCard({ file: planFile, title: planTitle, overview: data.overview || "" }, output, targetTab);
        if (isActiveTab && _sednarSettingsGet("planAutoOpen")) {
          try { window.openSednarPlanTab(planFile, planTitle); } catch (e) {}
        }
      }
    } else if (progressType === "compaction") {
      _sednarResolveRunningActivityEl(output);
      if (_sednarRunningActivityEl) {
        const text = _sednarRunningActivityEl.querySelector(".sednar-activity-text");
        const label = String(text && text.textContent ? text.textContent : "").trim();
        if (/^Compacting conversation history\b/i.test(label) || /^Compacted conversation history\b/i.test(label)) return;
      }
      _sednarFinalizeRunningActivity(undefined, output);
      _sednarHideStatusRow();
      _sednarLastTool = "compaction";
      _sednarLastToolArgs = { forced: !!data.forced };
      _sednarLastToolLabel = "Compacting conversation history";
      _sednarAppendActivityParts({
        verb: "Compacted",
        detail: "conversation history",
        meta: data.forced ? "context limit" : "",
        shimmer: true,
      }, true, output);
    } else if (progressType === "model_resolved") {
      return;
    } else if (progressType === "agent_thinking") {
      _sednarHideStatusRow();
      _sednarStepNarrationEl = null;
      _sednarRemovePendingToolLines(output);
      _sednarSettleRunningTerminalCards(output);
      _sednarCancelThoughtStreamFlush();
      _sednarPendingThoughtContent = "";
      _sednarStreamingThoughtContentEl = null;
      const thinkingLabel = message && !/^Thinking$/i.test(message.trim()) ? message : "Thinking";
      if (_sednarRunningActivityEl && _sednarIsThinkingLine()) {
        _sednarThinkingStartMs = Date.now();
        _sednarLastToolLabel = thinkingLabel;
        _sednarUpdateThinkingLineLabel();
        _sednarCleanupStaleThinkingLines(output, _sednarRunningActivityEl);
        _sednarStartThinkingTicker();
        return;
      }
      if (_sednarAdoptRunningThinking(output, thinkingLabel)) {
        _sednarThinkingStartMs = Date.now();
        _sednarStartThinkingTicker();
        return;
      }
      _sednarThinkingStartMs = Date.now();
      _sednarLastTool = "attempt_completion";
      _sednarLastToolArgs = {};
      _sednarFinalizeRunningActivity(undefined, output);
      _sednarLastToolLabel = thinkingLabel;
      if (message && !/^Thinking$/i.test(message.trim())) {
        _sednarAppendActivityParts(_sednarParseActivityParts("attempt_completion", {}, message), true, output);
      } else {
        _sednarAppendActivityParts({ verb: "Thinking", detail: "", meta: "" }, true, output);
      }
      _sednarStartThinkingTicker();
    } else if (progressType === "agent_thinking_delta") {
      if (/^Retrying\b/i.test(String(_sednarLastToolLabel || "").trim())) {
        _sednarLastToolLabel = "Thinking";
        _sednarThinkingStartMs = Date.now();
        _sednarStartThinkingTicker();
      }
      if (!_sednarIsThinkingLine()) {
        _sednarLastTool = "attempt_completion";
        _sednarLastToolLabel = "Thinking";
        if (!_sednarThinkingStartMs) _sednarThinkingStartMs = Date.now();
        _sednarStartThinkingTicker();
      } else if (_sednarLastToolLabel !== "Thinking") {
        _sednarLastToolLabel = "Thinking";
        _sednarStartThinkingTicker();
      }
      _sednarAppendThoughtDelta(data.delta || "");
    } else if (progressType === "agent_thinking_done") {
      _sednarPendingDurationS = data.duration_s || null;
      _sednarPendingDurationMs = data.duration_ms || null;
      _sednarFinalizeThoughtActivity(data.thought_content || "", output, {
        answerPending: !!data.answer_pending,
      });
      if (data.narration) _sednarAppendNarration(data.narration, output, targetTab);
    } else if (progressType === "content_delta") {
      if (isActiveTab) _sednarAppendAnswerDelta(data.delta || "", output, targetTab);
    } else if (progressType === "content_done") {
      _sednarSettleLiveContent(data, output, targetTab, isActiveTab);
    } else if (progressType === "content_retract") {
      if (isActiveTab) _sednarDropLiveAnswerPreamble();
      if (_sednarStepNarrationEl) {
        const row = _sednarStepNarrationEl.closest(".sednar-narration-row");
        if (row && row.parentNode) row.parentNode.removeChild(row);
        _sednarStepNarrationEl = null;
      }
      _sednarRemovePendingToolLines(output);
    } else if (progressType === "tool_call_pending") {
      _sednarShowPendingToolCall(data, output, targetTab);
    } else if (progressType === "answer_delta") {
      if (isActiveTab) _sednarAppendAnswerDelta(data.delta || "", output, targetTab);
    } else if (progressType === "answer_done") {
      if (isActiveTab) {
        _sednarFinalizeLiveAnswer(data.answer || "", output, targetTab);
      } else {
        targetTab._answerStreamedText = data.answer || "";
        _sednarResetAnswerLiveStream();
      }
    } else if (progressType === "tool_call") {
      if (tool === "todo_write") {
        _sednarLastTool = tool;
        _sednarLastToolArgs = args;
        return;
      }
      _sednarCommitLiveNarration(output, targetTab);
      _sednarRemovePendingToolLines(output);
      _sednarFinalizeRunningActivity(undefined, output);
      _sednarSettleRunningTerminalCards(output);
      _sednarLastTool = tool;
      _sednarLastToolArgs = args;
      _sednarLastToolLabel = message;
      _sednarHideStatusRow();
      if (tool === "run_command") {
        _sednarStartTerminalCard(args, output, targetTab);
        return;
      }
      if (tool === "spawn_subagent") {
        _sednarAgentsAddRow(output, {
          id: data.tool_call_id || "",
          title: args.title || String(message || "").replace(/^Subagent:\s*/, ""),
          goal: args.goal || "",
          state: "running",
        });
        _sednarAutoScroll(output);
        return;
      }
      if (tool === "edit_file" && args && args.file_path) {
        const stepsContainer = _sednarEnsureAgentStepsRow(output);
        _sednarClearTransientEditFailure(args.file_path, stepsContainer);
      }
      const parts = _sednarParseActivityParts(tool, args, message);
      _sednarAppendActivityParts(parts, true, output);
    } else if (progressType === "tool_result") {
      if (SEDNAR_TREE_MUTATING_TOOLS.has(tool)) _sednarScheduleSilentTreeRefresh();
      if (tool === "todo_write") {
        _sednarHideStatusRow();
        if (!targetTab._turnStreamComplete) _sednarShowImmediateThinking(output);
        return;
      }
      if (tool === "run_command") {
        const result = data.result || {};
        const card = _sednarRunningTerminalCard(output);
        if (card) {
          _sednarFinishTerminalCard(card, result);
        } else if (result.command || (data.args && data.args.command)) {
          _sednarAppendLoadedCommandBlock(result.command || data.args.command, result.output || result.error || "", result.exit_code, output, {
            description: data.args && data.args.description,
          });
        }
        _sednarHideStatusRow();
        if (!targetTab._turnStreamComplete) _sednarShowImmediateThinking(output);
        return;
      }
      if (tool === "spawn_subagent") {
        _sednarAgentsFinishRow(output, data.tool_call_id || "", data.result || {}, data.args || {});
        _sednarHideStatusRow();
        if (!targetTab._turnStreamComplete) _sednarShowImmediateThinking(output);
        return;
      }
      if (tool === "ask_question") {
        _sednarClearQuestionRequest(targetTab);
        if (message) _sednarLastToolLabel = message;
      }
      const errorMessage = data.error_full || message;
      if (data.error && errorMessage && _sednarRunningActivityEl && _sednarIsFileEditTool(tool)) {
        _sednarRecordEditFailure(
          data.args || _sednarLastToolArgs,
          errorMessage,
          data.error_kind,
          output
        );
      } else {
        _sednarFinalizeRunningActivity({ pastTense: !data.error }, output);
        if (data.error && errorMessage) {
          if (_sednarIsFileEditTool(tool)) {
            _sednarRecordEditFailure(
              data.args || _sednarLastToolArgs,
              errorMessage,
              data.error_kind,
              output
            );
          } else {
            const full = String(errorMessage);
            const isResolutionMiss = /(not found|no such|does(?:n'?t| not) exist|no matches?\b|path outside|path traversal)/i.test(full);
            if (!isResolutionMiss) {
              const parts = {
                verb: "Failed",
                detail: _sednarTruncateMiddle(full, 140),
                meta: "",
                isError: true,
                fullErrorTitle: full,
              };
              _sednarAppendActivityParts(parts, false, output);
            }
          }
        }
      }
      _sednarHideStatusRow();
      if (!targetTab._turnStreamComplete && tool !== "attempt_completion") {
        _sednarShowImmediateThinking(output);
      }
    } else if (progressType === "subagent_update") {
      _sednarAgentsApplyUpdate(output, data);
      return;
    } else if (progressType === "todo_update") {
      if (data.plan_file) {
        _sednarUpdateBuildTodos(output, data.plan_file, data.todos || []);
        _sednarRefreshPlanTodosView(data.plan_file, data.todos || []);
      }
      return;
    } else if (
      progressType === "goal_blocked" ||
      progressType === "goal_completed"
    ) {
      return;
    } else if (progressType === "permission_request") {
      _sednarFinalizeRunningActivity(undefined, output);
      _sednarHideStatusRow();
      _sednarShowPermissionRequest(data, output, targetTab);
    } else if (progressType === "question_request") {
      _sednarShowQuestionRequest(data, targetTab);
    } else if (progressType === "question_closed") {
      _sednarClearQuestionRequest(targetTab, data.request_id || "");
    } else if (progressType === "permission_expired") {
      const requestId = data.request_id || "";
      if (targetTab && targetTab.pendingPermissionRequestId === requestId) targetTab.pendingPermissionRequestId = "";
      _sednarClearPermissionRequest(requestId);
      _sednarResolvePermissionRow(requestId, false, output, "Permission expired");
    } else if (progressType === "agent_status") {
      const statusMsg = String(message || "").trim();
      if (/retrying model/i.test(statusMsg)) {
        _sednarThinkingStartMs = Date.now();
        _sednarPendingDurationS = null;
        _sednarPendingDurationMs = null;
        _sednarLastToolLabel = "Retrying model…";
        _sednarStopThinkingTicker();
        _sednarResolveRunningActivityEl();
        if (_sednarRunningActivityEl) {
          const textEl = _sednarRunningActivityEl.querySelector(".sednar-activity-text");
          if (textEl) textEl.textContent = "Retrying model…";
        }
      }
      return;
    } else if (message && !_sednarIsGenericStatusMessage(message)) {
      _sednarShowShimmer(message, output);
    } else {
      _sednarShowTyping(undefined, output);
    }
  });

  _sednarScheduleProgressSnapshot(targetTab, output, isActiveTab, false);
}

function initSednarAgentSocket() {
  _sednarBindPlanCardsOnce();
  if (window._sednarAgentSocket) return;
  _sednarBindThoughtTogglesOnce();
  _sednarBindDiffFileNameClicksOnce();
  _sednarBindTerminalCardsOnce();
  _sednarBindAgentsCardOnce();
  window._sednarAgentSocket = (typeof socket !== "undefined" && socket) ? socket : io.connect(location.protocol + "//" + location.host);
  window._sednarAgentSocket.on("sednar_progress", handleSednarProgress);
  if (!window._sednarCommandBound) {
    window._sednarCommandBound = true;
    window._sednarAgentSocket.on("lazie_command_stream", _sednarHandleCommandStream);
  }
}

function _sednarParseDiffLineHint(diffHtml) {
  const html = String(diffHtml || "");
  const startM = html.match(/data-start-line="(\d+)"/);
  if (!startM) return "";
  const wrappers = html.match(/diff-block-wrapper/g) || [];
  const endM = html.match(/data-end-line="(\d+)"/);
  const start = startM[1];
  if (wrappers.length === 1 && endM && endM[1] !== start) return "L" + start + "-" + endM[1];
  return "L" + start;
}

function _sednarDiffRowsHtml(diffHtml) {
  const tpl = document.createElement("div");
  tpl.innerHTML = String(diffHtml || "");
  const blocks = Array.from(tpl.querySelectorAll(".diff-block-wrapper"));
  const groups = blocks.length ? blocks : [tpl];
  const rows = [];
  const types = [];
  let widest = 1;
  groups.forEach(function(block, blockIndex) {
    const lines = Array.from(block.querySelectorAll(".diff-line-row, .diff-line-wrapper"))
      .filter(function(el) { return !el.querySelector(".diff-line-row"); });
    if (!lines.length) return;
    if (blockIndex > 0 && rows.length) {
      rows.push('<div class="ui-default-diff__separator"><span>\u22ef</span></div>');
      types.push("separator");
    }
    lines.forEach(function(line) {
      const wrap = line.closest(".diff-line-wrapper") || line;
      const has = function(sel) { return line.matches(sel) || wrap.matches(sel) || !!line.querySelector(sel); };
      const type = has(".diff-line-added-row, .diff-line-added-wrapper, .diff-line-sign-added, .diff-line-added") ? "added"
        : has(".diff-line-deleted-row, .diff-line-deleted-wrapper, .diff-line-sign-deleted, .diff-line-deleted") ? "removed"
          : "unchanged";
      const numEl = line.querySelector(".diff-line-number-inline");
      const num = numEl ? numEl.textContent.trim() : "";
      widest = Math.max(widest, num.length);
      const codeEl = line.querySelector(".diff-line-content");
      const code = codeEl ? codeEl.innerHTML : _sednarEscapeHtml(line.textContent || "");
      const sign = type === "added" ? "+" : (type === "removed" ? "-" : "\u00a0");
      rows.push('<div class="ui-default-diff__line" data-type="' + type + '">' +
        '<div class="ui-default-diff__gutter"><span class="ui-default-diff__line-number">' + _sednarEscapeHtml(num) + "</span>" +
        '<span class="ui-default-diff__line-indicator">' + sign + "</span></div>" +
        '<div class="ui-default-diff__line-content">' + (code || " ") + "</div></div>");
      types.push(type);
    });
  });
  if (!rows.length) return "";
  const firstChange = types.findIndex(function(t) { return t === "added" || t === "removed"; });
  const previewStart = Math.max(0, firstChange - 1);
  for (let i = 0; i < previewStart; i++) {
    rows[i] = rows[i].replace(/^<div class="ui-default-diff__(line|separator)"/, '<div data-preview="before" class="ui-default-diff__$1"');
  }
  return '<div class="ui-default-diff" style="--ui-default-diff-line-number-width:' + widest + 'ch">' + rows.join("") + "</div>";
}

function _sednarBuildDiffBlockHtml({ fileName, absolutePath, fileIcon, additions, deletions, diffContent, diffBlockId, lineHint, isNewFile }) {
  const safeFullPath = _sednarEscapeHtml(fileName);
  const baseName = String(fileName || "").split("/").pop() || fileName;
  const openPath = absolutePath || fileName;
  const safeFilePathAttr = _sednarEscapeHtml(openPath).replace(/"/g, "&quot;");
  const lineMetaAttr = lineHint ? ' data-line-meta="' + _sednarEscapeHtml(lineHint).replace(/"/g, "&quot;") + '"' : "";
  const rows = _sednarDiffRowsHtml(diffContent) || '<div class="ui-default-diff">' + String(diffContent || "") + "</div>";
  const stats = (additions ? '<span class="ui-edit-tool-call__additions">+' + additions + "</span>" : "") +
    (deletions ? '<span class="ui-edit-tool-call__deletions">-' + deletions + "</span>" : "");
  const expanded = (rows.match(/data-type="/g) || []).length <= SEDNAR_AUTO_EXPAND_DIFF_LINES;
  const expandedAttr = expanded ? "true" : "false";
  return '<div class="sednar-diff-block ui-edit-tool-call' + (expanded ? " is-expanded" : "") + '" data-file-name="' + _sednarEscapeHtml(fileName).replace(/"/g, "&quot;") + '" data-additions="' + (additions || 0) + '" data-deletions="' + (deletions || 0) + '">' +
    '<div class="sednar-diff-header-row ui-edit-tool-call__header" data-file-path="' + safeFilePathAttr + '"' + lineMetaAttr + ' title="' + safeFullPath + '">' +
    (fileIcon ? '<img class="ui-edit-tool-call__icon" src="' + _sednarEscapeHtml(fileIcon).replace(/"/g, "&quot;") + '" alt="" aria-hidden="true" draggable="false">' : "") +
    '<span class="ui-edit-tool-call__action">' + (isNewFile ? "Created" : "Edited") + "</span>" +
    '<span class="sednar-diff-file-name-link ui-edit-tool-call__filename" data-file-path="' + safeFilePathAttr + '"' + lineMetaAttr + ">" + _sednarEscapeHtml(baseName) + "</span>" +
    (stats ? '<span class="ui-edit-tool-call__stats">' + stats + "</span>" : "") +
    '<button type="button" class="ui-edit-tool-call__expand" aria-expanded="' + expandedAttr + '" aria-label="Show diff" data-edit-expand>' + _sednarIcon("chevron-right", { size: "sm" }) + "</button>" +
    "</div>" +
    '<div id="' + diffBlockId + '-content" class="sednar-diff-content ui-edit-tool-call__content"><div class="ui-edit-tool-call__scroll">' + rows + "</div></div>" +
    '<button type="button" class="ui-tool-call-card__expand-button" aria-expanded="' + expandedAttr + '" aria-label="Show full diff" data-edit-expand>' +
    '<span class="ui-tool-call-card__expand-icon">' + _sednarIcon("chevron-down", { size: "sm" }) + "</span></button>" +
    "</div>";
}

function _sednarToggleEditCard(block) {
  const open = !block.classList.contains("is-expanded");
  block.classList.toggle("is-expanded", open);
  block.querySelectorAll("[data-edit-expand]").forEach(function(btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function _sednarBindDiffFileNameClicksOnce() {
  if (window._sednarDiffFileNameClicksBound) return;
  window._sednarDiffFileNameClicksBound = true;
  document.addEventListener("click", function(e) {
    const expand = e.target.closest ? e.target.closest("#sednar-chat-messages [data-edit-expand]") : null;
    if (expand) {
      e.preventDefault();
      e.stopPropagation();
      _sednarToggleEditCard(expand.closest(".ui-edit-tool-call"));
      return;
    }
    const editCard = e.target.closest ? e.target.closest("#sednar-chat-messages .ui-edit-tool-call") : null;
    if (editCard && !e.target.closest(".sednar-diff-file-name-link")) {
      const selected = window.getSelection ? String(window.getSelection()) : "";
      if (!selected) {
        e.preventDefault();
        e.stopPropagation();
        _sednarToggleEditCard(editCard);
      }
      return;
    }
    const label = e.target.closest
      ? e.target.closest(".sednar-diff-file-name-link, .sednar-activity-file-link, .sednar-md-file-link, .ui-edit-tool-call__header, .ui-tool-call-line--clickable")
      : null;
    if (!label || !label.closest("#sednar-chat-messages, #ide-plan-body")) return;
    const source = label.hasAttribute("data-file-path") ? label : label.querySelector("[data-file-path]");
    const filePath = source && source.getAttribute("data-file-path");
    if (!filePath) return;
    e.preventDefault();
    e.stopPropagation();
    showIDEPanel("editor");
    const meta = String(source.getAttribute("data-line-meta") || "").trim();
    const m = meta.match(/^L(\d+)/i);
    const lineNumber = m ? _sednarNormalizeLineNumber(m[1]) : null;
    openFileInEditorFromPath(filePath, lineNumber ? { lineNumber: lineNumber } : {});
  });
}
_sednarBindDiffFileNameClicksOnce();

function appendSednarDiffBlock(data, container) {
  const out = container || getSednarChatOutput();
  if (!out) return;
  _sednarBindDiffFileNameClicksOnce();
  const fileName = data.file_name || "file";
  const diffRow = document.createElement("div");
  diffRow.className = "chat-row sednar-stream-msg sednar-diff-row";
  diffRow.setAttribute("data-step-id", _sednarNextStepId());
  const diffBlockId = "sednar-diff-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  const diffHtml = data.diff_html || "";
  const lineHint = _sednarParseDiffLineHint(diffHtml);
  diffRow.innerHTML = '<div class="chat-msg assistant sednar-plain-msg">' + _sednarBuildDiffBlockHtml({
    fileName: fileName,
    absolutePath: data.absolute_path || "",
    fileIcon: _sednarFileIcon(fileName),
    additions: Number(data.additions) || 0,
    deletions: Number(data.deletions) || 0,
    diffContent: diffHtml,
    diffBlockId: diffBlockId,
    lineHint: lineHint,
    isNewFile: !!data.created,
  }) + "</div>";
  _sednarRemoveTransientThought(out);
  _sednarAppendChatRow(out, diffRow);
  _sednarScheduleRegroup(out);
  _sednarAutoScroll(out);
  _sednarSyncActiveTabMessagesHtml();
  if (data.absolute_path) refreshSednarFileFromDisk(data.absolute_path);
  _sednarSchedulePendingChangesRefresh();
}

let _sednarChangesFiles = [];
let _sednarChangesFetchSeq = 0;
let _sednarChangesRefreshTimer = null;
let _sednarChangesBusy = false;
let _sednarChangesBarBound = false;

function _sednarChangesRequest(path, extra) {
  const tab = _sednarGetActiveChatTab();
  const sessionId = tab && tab.sessionId;
  if (!sessionId || !sednarProjectPath) return Promise.resolve(null);
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({
      project_path: sednarProjectPath,
      session_id: sessionId,
      workspace: _sednarCurrentWorkspacePayload(),
    }, extra || {})),
  }).then(function(resp) { return resp.json(); });
}

function _sednarRefreshPendingChanges() {
  const seq = ++_sednarChangesFetchSeq;
  _sednarChangesRequest("/sednar/session/changes").then(function(data) {
    if (seq !== _sednarChangesFetchSeq) return;
    _sednarRenderChangesBar(data && data.success ? (data.files || []) : []);
  }).catch(function() {});
}

function _sednarSchedulePendingChangesRefresh() {
  if (_sednarChangesRefreshTimer) clearTimeout(_sednarChangesRefreshTimer);
  _sednarChangesRefreshTimer = setTimeout(function() {
    _sednarChangesRefreshTimer = null;
    _sednarRefreshPendingChanges();
  }, 250);
}

function _sednarChangesFileRowHtml(file) {
  const abs = String(file.path || "");
  const rel = _sednarWorkspaceRepoPath(abs) || abs;
  const name = _sednarBasename(rel);
  const dir = rel.slice(0, Math.max(0, rel.length - name.length)).replace(/\/$/, "");
  const icon = _sednarFileIcon(name);
  const stats = (file.additions ? `<span class="sednar-changes-added">+${file.additions}</span>` : "") +
    (file.deletions ? `<span class="sednar-changes-deleted">-${file.deletions}</span>` : "");
  const status = file.created ? "Created" : (file.deleted ? "Deleted" : "");
  const pathAttr = _sednarEscapeHtml(abs).replace(/"/g, "&quot;");
  const canUndo = file.can_undo !== false;
  return `<div class="sednar-changes-file-row">` +
    `<button type="button" class="sednar-changes-file${file.deleted ? " is-deleted" : ""}" data-changes-action="open" data-changes-path="${pathAttr}" title="${_sednarEscapeHtml(rel).replace(/"/g, "&quot;")}">` +
    `<img class="sednar-changes-file-icon" src="${_sednarEscapeHtml(icon).replace(/"/g, "&quot;")}" alt="">` +
    `<span class="sednar-changes-file-name">${_sednarEscapeHtml(name)}</span>` +
    (dir ? `<span class="sednar-changes-file-dir">${_sednarEscapeHtml(dir)}</span>` : "") +
    (status ? `<span class="sednar-changes-file-status">${status}</span>` : "") +
    `<span class="sednar-changes-stats">${stats}</span></button>` +
    `<span class="sednar-changes-file-actions">` +
    (canUndo ? `<button type="button" class="sednar-changes-file-btn" data-changes-action="undo-file" data-changes-path="${pathAttr}" title="Undo changes to ${_sednarEscapeHtml(name).replace(/"/g, "&quot;")}" aria-label="Undo changes to ${_sednarEscapeHtml(name).replace(/"/g, "&quot;")}">${_SEDNAR_REVERT_ICON_SVG}</button>` : "") +
    `<button type="button" class="sednar-changes-file-btn" data-changes-action="keep-file" data-changes-path="${pathAttr}" title="Keep changes to ${_sednarEscapeHtml(name).replace(/"/g, "&quot;")}" aria-label="Keep changes to ${_sednarEscapeHtml(name).replace(/"/g, "&quot;")}"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"></path></svg></button>` +
    `</span></div>`;
}

function _sednarSetChangesExpanded(bar, expanded) {
  const list = document.getElementById("sednar-changes-list");
  const toggle = bar && bar.querySelector(".sednar-changes-toggle");
  if (!bar || !list) return;
  bar.classList.toggle("is-expanded", !!expanded);
  list.hidden = !expanded;
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function _sednarRenderChangesBar(files) {
  _sednarChangesFiles = Array.isArray(files) ? files : [];
  const bar = document.getElementById("sednar-changes-bar");
  if (!bar) return;
  const count = _sednarChangesFiles.length;
  const tab = _sednarGetActiveChatTab();
  const running = !!(tab && tab.agentRunning);
  bar.classList.toggle("is-agent-running", running);
  bar.classList.toggle("has-files", count > 0);
  const label = bar.querySelector(".sednar-changes-count");
  const labelMode = running ? "running" : "files:" + count;
  if (label && label.getAttribute("data-mode") !== labelMode) {
    label.setAttribute("data-mode", labelMode);
    label.innerHTML = running
      ? 'Generating<span class="sednar-gen-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>'
      : count + (count === 1 ? " File" : " Files");
  }
  const toggle = bar.querySelector(".sednar-changes-toggle");
  if (toggle) toggle.disabled = !count;
  const list = document.getElementById("sednar-changes-list");
  if (list) _sednarMorph(list, _sednarChangesFiles.map(_sednarChangesFileRowHtml).join(""));
  bar.querySelectorAll("[data-changes-action]").forEach(function(btn) {
    const action = btn.getAttribute("data-changes-action");
    if (action === "stop") btn.hidden = !running;
    else if (action === "undo" || action === "keep") btn.hidden = running || !count;
    else if (action === "review") btn.hidden = !count;
    if (action === "undo" || action === "keep" || action === "undo-file" || action === "keep-file") {
      btn.disabled = running || (action === "undo" && !_sednarChangesFiles.some(function(f) { return f.can_undo; }));
    }
  });
  if (!count) _sednarSetChangesExpanded(bar, false);
  _sednarBindChangesBarOnce();
  _sednarSyncComposerStack();
}

function _sednarSyncComposerStack() {
  const stack = document.getElementById("sednar-composer-stack");
  if (!stack) return;
  const queue = document.getElementById("sednar-queue-bar");
  const status = document.getElementById("sednar-changes-bar");
  const tab = _sednarGetActiveChatTab();
  const hasQueue = !!(queue && !queue.hidden);
  if (status) status.hidden = !_sednarChangesFiles.length && !(tab && tab.agentRunning && hasQueue);
  const hasStatus = !!(status && !status.hidden);
  stack.hidden = !hasQueue && !hasStatus;
  stack.classList.toggle("has-queue", hasQueue);
  stack.classList.toggle("has-status", hasStatus);
  if (!hasQueue) _sednarCloseQueueMenu();
}

function _sednarReloadChangedFiles(result) {
  const r = result || {};
  (r.restored || []).forEach(function(path) { refreshSednarFileFromDisk(path); });
  (r.removed || []).forEach(function(path) {
    const key = _sednarResolveOpenFileKey(path);
    if (key) closeFile(key);
  });
  if ((r.restored || []).length || (r.removed || []).length) _sednarRefreshIdeTree();
}

function _sednarRunChangesAction(action, paths) {
  if (_sednarChangesBusy) return;
  const activeTab = _sednarGetActiveChatTab();
  if (activeTab && activeTab.agentRunning) {
    _sednarShowIdeToast("Wait for the agent to finish, or stop it first.");
    return;
  }
  _sednarChangesBusy = true;
  const bar = document.getElementById("sednar-changes-bar");
  if (bar) bar.classList.add("is-busy");
  const extra = paths && paths.length ? { paths: paths } : null;
  _sednarSessionPost("/sednar/session/changes/" + action, extra).then(function(data) {
    if (action !== "undo") return;
    _sednarReloadChangedFiles(data);
    const failed = data.failed || [];
    const done = (data.restored || []).length + (data.removed || []).length;
    if (failed.length) {
      return _sednarShowErrorDialog(
        "Couldn't undo " + failed.length + " file" + (failed.length === 1 ? "" : "s"),
        done ? "The other " + done + " file" + (done === 1 ? " was" : "s were") + " put back." : "No files were changed.",
        failed.join("\n")
      );
    }
  }).catch(function(err) {
    return _sednarShowErrorDialog(
      action === "undo" ? "Couldn't undo the changes" : "Couldn't keep the changes",
      (err && err.message) || "Unknown error.",
      (err && err.detail) || ""
    );
  }).finally(function() {
    _sednarChangesBusy = false;
    if (bar) bar.classList.remove("is-busy");
    _sednarRefreshPendingChanges();
  });
}

function _sednarBindChangesBarOnce() {
  if (_sednarChangesBarBound) return;
  const bar = document.getElementById("sednar-changes-bar");
  if (!bar) return;
  _sednarChangesBarBound = true;
  bar.addEventListener("click", function(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-changes-action]") : null;
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const action = btn.getAttribute("data-changes-action");
    if (action === "toggle") {
      _sednarSetChangesExpanded(bar, !bar.classList.contains("is-expanded"));
    } else if (action === "stop") {
      window.stopSednarAgent();
    } else if (action === "open") {
      const path = btn.getAttribute("data-changes-path");
      if (path && !btn.classList.contains("is-deleted")) {
        showIDEPanel("editor");
        openFileInEditorFromPath(path);
      }
    } else if (action === "review") {
      _sednarSetChangesExpanded(bar, true);
      const openable = _sednarChangesFiles.filter(function(f) { return !f.deleted; }).slice(0, 12);
      if (openable.length) showIDEPanel("editor");
      openable.forEach(function(f) { openFileInEditorFromPath(f.path); });
    } else if (action === "undo" || action === "keep") {
      _sednarRunChangesAction(action);
    } else if (action === "undo-file" || action === "keep-file") {
      const path = btn.getAttribute("data-changes-path");
      if (path) _sednarRunChangesAction(action === "undo-file" ? "undo" : "keep", [path]);
    }
  });
}

function _sednarNormalizePath(filePath) {
  if (!filePath) return "";
  let p = String(filePath).trim().replace(/\\/g, "/");
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

function _sednarResolveOpenFileKey(absPath) {
  if (!absPath) return null;
  const normalized = _sednarNormalizePath(absPath);
  if (ideOpenFiles[normalized]) return normalized;
  if (ideOpenFiles[absPath]) return absPath;
  const keys = Object.keys(ideOpenFiles);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (_sednarNormalizePath(key) === normalized) return key;
  }
  const lower = normalized.toLowerCase();
  for (let i = 0; i < keys.length; i++) {
    if (_sednarNormalizePath(keys[i]).toLowerCase() === lower) return keys[i];
  }
  return null;
}

function _sednarApplyFileContentToOpenTab(filePath, content) {
  if (!filePath || !ideOpenFiles[filePath]) return false;
  const fileInfo = ideOpenFiles[filePath];
  const nextContent = content != null ? content : "";
  fileInfo.content = nextContent;
  fileInfo.originalContent = nextContent;
  fileInfo.modified = false;
  if (fileInfo.model) {
    fileInfo.model.setValue(nextContent);
  }
  const codeEditor = document.getElementById("ide-code-editor");
  if (ideActiveFile === filePath && codeEditor && !fileInfo.model) {
    codeEditor.value = nextContent;
  }
  if (ideActiveFile === filePath && window.ideEditor && fileInfo.model) {
    try {
      window.ideEditor.setModel(fileInfo.model);
    } catch (e) {

    }
  }
  updateOpenFilesList();
  return true;
}

function refreshSednarFileFromDisk(absPath) {
  if (!absPath) return;
  const openKey = _sednarResolveOpenFileKey(absPath);
  if (!openKey) return;
  _sednarIdeSocketRequest(
    "ide_read_file", { path: absPath },
    "ide_file_content",
    function(data) { return data && data.path === absPath; }
  ).then(function(result) {
    const data = result.data;
    if (!data.error && data.content !== undefined) {
      const resolvedPath = _sednarResolveOpenFileKey(data.path || absPath) || openKey;
      _sednarApplyFileContentToOpenTab(resolvedPath, data.content);
    }
  });
}

function _sednarResetTurnState() {
  _sednarStopThinkingTicker();
  _sednarLastToolLabel = "";
  _sednarLastTool = "";
  _sednarLastToolArgs = {};
  _sednarRunningActivityEl = null;
  _sednarThinkingStartMs = null;
  _sednarPendingDurationS = null;
  _sednarPendingDurationMs = null;
  _sednarCancelThoughtStreamFlush();
  _sednarPendingThoughtContent = "";
  _sednarStreamingThoughtContentEl = null;
  _sednarStatusRow = null;
  _sednarStatusMsg = null;
  _sednarCurrentUserRow = null;
  _sednarAssistantStreamEl = null;
}

const _SEDNAR_MCP_ICON_SVG = _sednarIcon("plug", { size: "lg" });

function _sednarUpdateMcpToggle() {
  const toggle = document.getElementById("sednar-mcp-toggle");
  const panel = document.getElementById("sednar-mcp-panel");
  if (!toggle) return;
  const count = sednarMcpSelectedServers.size;
  toggle.innerHTML = _SEDNAR_MCP_ICON_SVG + (count ? `<span class="sednar-mcp-toggle-badge">${count}</span>` : "");
  toggle.setAttribute("aria-label", count ? "MCP servers (" + count + " selected)" : "MCP servers");
  toggle.classList.toggle("is-active", count > 0);
  toggle.setAttribute("aria-expanded", panel && panel.style.display !== "none" ? "true" : "false");
}

function _sednarMcpDiagnosticsText(server) {
  if (!server) return "No MCP server selected.";
  return JSON.stringify({
    name: server.name || "",
    connected: !!server.connected,
    transport: server.transport || "",
    source: server.source || "",
    config_path: server.config_path || "",
    error: server.error || "",
    diagnostics: server.diagnostics || {}
  }, null, 2);
}

function _sednarMcpDisplayName(name) {
  return String(name || "");
}

function _sednarApplyMcpStatusPayload(payload) {
  if (!payload || !Array.isArray(payload.servers)) return;
  sednarMcpServers = payload.servers;
  const availableServers = new Set(sednarMcpServers.map(function(server) { return server.name; }).filter(Boolean));
  let changed = false;
  Array.from(sednarMcpSelectedServers).forEach(function(name) {
    if (!availableServers.has(name)) {
      sednarMcpSelectedServers.delete(name);
      changed = true;
    }
  });
  if (changed) _sednarPersistMcpSelection();
}

function _sednarFindMcpServer(name) {
  return sednarMcpServers.find(function(server) {
    return server && server.name === name;
  }) || null;
}

function openSednarMcpToolsDialog(serverName) {
  _sednarSettingsMcpFocus = serverName || "";
  openSednarSettings("mcp");
}
window.openSednarMcpToolsDialog = openSednarMcpToolsDialog;

async function runSednarMcpAction(action, serverName) {
  const actionName = String(action || "").trim();
  const activeServerName = serverName || "";
  const server = _sednarFindMcpServer(activeServerName);
  const mcpProjectPath = _sednarWorkspaceRefForMcp();
  if (actionName === "copy-diagnostics") {
    _sednarCopyToClipboard(_sednarMcpDiagnosticsText(server), "Copied MCP diagnostics");
    return;
  }
  if (!mcpProjectPath) {
    _sednarShowIdeToast("Open a project before managing MCP servers.");
    return;
  }
  try {
    const resp = await fetch("/sednar-mcp/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: mcpProjectPath, workspace: _sednarCurrentWorkspacePayload(), action: actionName, server_name: activeServerName, enabled_servers: Array.from(sednarMcpSelectedServers) })
    });
    const payload = await resp.json();
    if (payload.status) _sednarApplyMcpStatusPayload(payload.status);
    if (payload.error) _sednarShowIdeToast(payload.error);
    else _sednarShowIdeToast(activeServerName ? "Reconnected " + _sednarMcpDisplayName(activeServerName) : "MCP servers reloaded");
  } catch (err) {
    _sednarShowIdeToast("MCP action failed: " + (err && err.message ? err.message : String(err)));
  }
  _sednarRenderMcpServers();
}
window.runSednarMcpAction = runSednarMcpAction;

function _sednarRenderMcpServers() {
  const list = document.getElementById("sednar-mcp-list");
  const filter = document.getElementById("sednar-mcp-filter");
  _sednarRefreshSettingsMcpIfVisible();
  if (!list) return;
  _sednarBindMcpPopoverOnce(list);
  const query = (filter && filter.value ? filter.value : "").toLowerCase();
  const servers = sednarMcpServers.filter(function(server) {
    if (!query) return true;
    const tools = Array.isArray(server.tools) ? server.tools : [];
    return String(server.name || "").toLowerCase().indexOf(query) !== -1 ||
      String(server.source || "").toLowerCase().indexOf(query) !== -1 ||
      tools.some(function(tool) {
        return String(tool.name || "").toLowerCase().indexOf(query) !== -1 || String(tool.description || "").toLowerCase().indexOf(query) !== -1;
      });
  });
  if (!servers.length) {
    list.innerHTML = '<div class="sednar-mcp-empty">' + (query ? "No servers or tools match." : "No MCP servers yet.") + "</div>";
    _sednarUpdateMcpToggle();
    return;
  }
  const disabledTools = _sednarMcpDisabledTools();
  list.innerHTML = servers.map(function(server) {
    const name = String(server.name || "");
    const esc = _sednarEscapeHtml(name);
    const state = _sednarMcpServerState(server);
    const on = sednarMcpSelectedServers.has(name);
    const offCount = ((disabledTools[name]) || []).length;
    let meta = _sednarMcpStateLabel(server, state);
    if (offCount && state === "ok") meta += " · " + offCount + " off";
    return '<div class="sednar-mcp-pop-row' + (on ? " is-on" : "") + (server.config_disabled ? " is-disabled" : "") + '" data-mcp-row="' + esc + '" role="button" tabindex="0" title="' + _sednarEscapeHtml(server.error || _sednarMcpSourceLabel(server)) + '">' +
      '<span class="sednar-mcp-dot is-' + state + '" aria-hidden="true"></span>' +
      '<span class="sednar-mcp-pop-name">' + _sednarEscapeHtml(_sednarMcpDisplayName(name)) + "</span>" +
      '<span class="sednar-mcp-pop-meta">' + _sednarEscapeHtml(meta) + "</span>" +
      '<label class="lc-switch is-small" title="' + (on ? "Turn off" : "Turn on") + '"><input type="checkbox" data-mcp-toggle="' + esc + '"' + (on ? " checked" : "") + (server.config_disabled ? " disabled" : "") + ' aria-label="Use ' + esc + '"><span class="lc-switch-track"><span class="lc-switch-thumb"></span></span></label>' +
    "</div>";
  }).join("");
  _sednarUpdateMcpToggle();
}
window._sednarRenderMcpServers = _sednarRenderMcpServers;

function _sednarBindMcpPopoverOnce(list) {
  if (list._sednarMcpBound) return;
  list._sednarMcpBound = true;
  list.addEventListener("change", function(e) {
    const name = e.target && e.target.getAttribute ? e.target.getAttribute("data-mcp-toggle") : "";
    if (name) _sednarSetMcpServerEnabled(name, !!e.target.checked);
  });
  list.addEventListener("click", function(e) {
    if (e.target.closest && e.target.closest(".lc-switch")) return;
    const row = e.target.closest ? e.target.closest("[data-mcp-row]") : null;
    if (!row || row.classList.contains("is-disabled")) return;
    e.preventDefault();
    const name = row.getAttribute("data-mcp-row");
    _sednarSetMcpServerEnabled(name, !sednarMcpSelectedServers.has(name));
  });
  list.addEventListener("keydown", function(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest ? e.target.closest("[data-mcp-row]") : null;
    if (!row || row.classList.contains("is-disabled")) return;
    e.preventDefault();
    const name = row.getAttribute("data-mcp-row");
    _sednarSetMcpServerEnabled(name, !sednarMcpSelectedServers.has(name));
  });
}

function toggleSednarMcpPanel(forceOpen) {
  const panel = document.getElementById("sednar-mcp-panel");
  if (!panel) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.style.display === "none";
  panel.style.display = shouldOpen ? "flex" : "none";
  _sednarUpdateMcpToggle();
  if (shouldOpen) {
    if (!sednarMcpServers.length) refreshSednarMcpStatus();
    else _sednarRenderMcpServers();
  }
}
window.toggleSednarMcpPanel = toggleSednarMcpPanel;
if (!window._sednarMcpPanelDismissBound) {
  window._sednarMcpPanelDismissBound = true;
  document.addEventListener("click", function(e) {
    const panel = document.getElementById("sednar-mcp-panel");
    const toggle = document.getElementById("sednar-mcp-toggle");
    if (!panel || panel.style.display === "none") return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.indexOf(panel) !== -1 || (toggle && path.indexOf(toggle) !== -1)) return;
    if ((panel.contains(e.target)) || (toggle && toggle.contains(e.target))) return;
    toggleSednarMcpPanel(false);
  });
  document.addEventListener("keydown", function(e) {
    if (e.key !== "Escape") return;
    const panel = document.getElementById("sednar-mcp-panel");
    if (panel && panel.style.display !== "none") toggleSednarMcpPanel(false);
  });
}

async function refreshSednarMcpStatus(options) {
  const opts = options || {};
  const list = document.getElementById("sednar-mcp-list");
  const requestSeq = ++_sednarMcpStatusRequestSeq;
  const workspaceKey = _sednarMcpSelectionStorageKey();
  const mcpProjectPath = _sednarWorkspaceRefForMcp();
  const hasExplicitProbeList = Array.isArray(opts.probeServers);
  const probeServers = hasExplicitProbeList ? opts.probeServers : (_sednarMcpStatusLoadedWithoutProbe ? Array.from(sednarMcpSelectedServers || []) : []);
  if (!mcpProjectPath) {
    if (list) list.innerHTML = '<div class="sednar-mcp-empty">Open a project to load MCP servers.</div>';
    _sednarUpdateMcpToggle();
    return;
  }
  if (list && (!opts.preserveList || !sednarMcpServers.length)) list.innerHTML = '<div class="sednar-mcp-empty">Loading MCP servers...</div>';
  try {
    const resp = await fetch("/sednar-mcp/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: mcpProjectPath, workspace: _sednarCurrentWorkspacePayload(), enabled_servers: probeServers })
    });
    const payload = await resp.json();
    if (requestSeq !== _sednarMcpStatusRequestSeq) return;
    if (workspaceKey !== _sednarMcpSelectionStorageKey()) return;
    _sednarApplyMcpStatusPayload(payload);
    if (!probeServers.length) _sednarMcpStatusLoadedWithoutProbe = true;
  } catch (err) {
    if (requestSeq !== _sednarMcpStatusRequestSeq) return;
    if (workspaceKey !== _sednarMcpSelectionStorageKey()) return;
    sednarMcpServers = [];
    _sednarShowIdeToast("Could not load MCP servers: " + String(err));
  }
  _sednarRenderMcpServers();
  if (opts.hydrateSelected && !probeServers.length) {
    const selectedServers = Array.from(sednarMcpSelectedServers || []).filter(Boolean);
    if (selectedServers.length) {
      const scheduleHydration = typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : function(cb) { setTimeout(cb, 1); };
      scheduleHydration(function() {
        if (requestSeq !== _sednarMcpStatusRequestSeq) return;
        if (workspaceKey !== _sednarMcpSelectionStorageKey()) return;
        refreshSednarMcpStatus({ probeServers: selectedServers, preserveList: true });
      });
    }
  }
}
window.refreshSednarMcpStatus = refreshSednarMcpStatus;

async function refreshSednarMcpConnections() {
  const mcpProjectPath = _sednarWorkspaceRefForMcp();
  if (mcpProjectPath) {
    try {
      await fetch("/sednar-mcp/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_path: mcpProjectPath, workspace: _sednarCurrentWorkspacePayload(), enabled_servers: Array.from(sednarMcpSelectedServers || []) }) });
    } catch (err) {}
  }
  refreshSednarMcpStatus();
}
window.refreshSednarMcpConnections = refreshSednarMcpConnections;

async function openSednarMcpConfig() {
  if (!sednarProjectPath) {
    _sednarShowIdeToast("Open a project before editing MCP config.");
    return;
  }
  try {
    const resp = await fetch("/sednar-mcp/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_path: sednarProjectPath }) });
    const payload = await resp.json();
    if (!resp.ok || !payload.path) throw new Error(payload.error || "Unable to create MCP config");
    openFileInEditorFromPath(payload.path);
  } catch (err) {
    _sednarShowIdeToast("Couldn't open MCP config: " + (err && err.message ? err.message : String(err)));
  }
}
window.openSednarMcpConfig = openSednarMcpConfig;

function _sednarInitChatInput(inputEl) {
  if (typeof window.getSednarComposerState === "function") {
    const state = window.getSednarComposerState();
    const hasAttachments = (state.attachments || []).length > 0;
    const hasText = !!(state.text || "").trim() || (state.segments || []).some(function(s) {
      return s && s.type === "file";
    });
    if (!hasText && !hasAttachments) return;
    if (typeof window.areSednarAttachmentsReady === "function" && hasAttachments && !window.areSednarAttachmentsReady()) return;
    window.sendSednarAgentMessage(undefined);
    return;
  }
  if (!inputEl) return;
  const msg = String(inputEl.value != null ? inputEl.value : (inputEl.innerText || "")).trim();
  const hasAttachments = (window.sednarPendingAttachments || []).length > 0;
  if (!msg && !hasAttachments) return;
  if (typeof window.areSednarAttachmentsReady === "function" && hasAttachments && !window.areSednarAttachmentsReady()) return;
  window.sendSednarAgentMessage(msg || undefined);
}
window._sednarInitChatInput = _sednarInitChatInput;


const SEDNAR_SETTINGS_STORAGE_KEY = "sednar_settings_v1";
const _SEDNAR_SETTING_DEFAULTS = {
  autoRunQueue: true,
  requireApproval: false,
  webTools: false,
  conversationDensity: "detailed",
  stepGrouping: "grouped",
  terminalFontSize: 13,
  terminalCursorStyle: "bar",
  terminalCursorBlink: true,
  terminalScrollback: 5000,
};

// Settings are kept on the server (~/.sednar/settings.json). localStorage is a mirror, so the first paint
// and a server that is briefly away still see the last values; values from before the server kept them are
// moved there on the first load.
let _sednarServerSettings = null;
let _sednarSettingsPending = {};
let _sednarSettingsSaveTimer = null;

function _sednarSettingsLocal() {
  try { return JSON.parse(localStorage.getItem(SEDNAR_SETTINGS_STORAGE_KEY) || "{}") || {}; } catch (e) { return {}; }
}

function _sednarSettingsMirror(all) {
  try { localStorage.setItem(SEDNAR_SETTINGS_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
}

function _sednarSettingsAll() {
  const stored = _sednarServerSettings || _sednarSettingsLocal();
  return Object.assign({}, _SEDNAR_SETTING_DEFAULTS, stored);
}

function _sednarSettingsGet(key) {
  return _sednarSettingsAll()[key];
}

function _sednarSettingsFlush() {
  _sednarSettingsSaveTimer = null;
  const updates = _sednarSettingsPending;
  _sednarSettingsPending = {};
  if (!Object.keys(updates).length) return Promise.resolve();
  return fetch("/sednar/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: updates }),
  }).then(function(resp) { return resp.json(); }).then(function(data) {
    if (!data || !data.success) throw new Error((data && data.error) || "Could not save settings");
    const rejected = Object.keys(data.rejected || {});
    if (rejected.length) _sednarShowIdeToast("Setting not saved: " + rejected[0] + " (" + data.rejected[rejected[0]] + ")");
  }).catch(function(err) {
    if (window.console && console.warn) console.warn("Sednar settings save failed", err);
  });
}

function _sednarSettingsSet(key, value) {
  const stored = Object.assign({}, _sednarServerSettings || _sednarSettingsLocal());
  if (value === null || value === undefined) delete stored[key];
  else stored[key] = value;
  if (_sednarServerSettings) _sednarServerSettings = stored;
  _sednarSettingsMirror(stored);
  _sednarSettingsPending[key] = value === undefined ? null : value;
  if (_sednarSettingsSaveTimer) clearTimeout(_sednarSettingsSaveTimer);
  _sednarSettingsSaveTimer = setTimeout(_sednarSettingsFlush, 250);
  if (/^(editor|terminal)/.test(String(key))) _sednarApplyEditorTerminalSettings();
}

function _sednarLoadServerSettings() {
  return fetch("/sednar/settings").then(function(resp) { return resp.json(); }).then(function(data) {
    if (!data || !data.success) return;
    const server = data.settings || {};
    const local = _sednarSettingsLocal();
    const missing = {};
    Object.keys(local).forEach(function(key) { if (!(key in server)) missing[key] = local[key]; });
    _sednarServerSettings = Object.assign({}, server, missing);
    if (Object.keys(missing).length) {
      Object.assign(_sednarSettingsPending, missing);
      _sednarSettingsFlush();
    }
    _sednarSettingsMirror(_sednarServerSettings);
    _sednarApplyEditorTerminalSettings();
    _sednarApplyPanelSizes();
    if (_sednarSettingsVisible()) _sednarRenderSettingsPage();
  }).catch(function() {});
}

function _sednarApplyPanelSizes() {
  const sidebar = document.getElementById("ide-sidebar");
  const explorer = Number(_sednarSettingsGet("explorerWidth")) || 0;
  if (sidebar && explorer >= 150 && explorer <= 700) sidebar.style.width = explorer + "px";
  const agent = document.getElementById("sednar-agent-panel");
  const chat = Number(_sednarSettingsGet("chatPanelWidth")) || 0;
  if (agent && chat >= 280) agent.style.width = chat + "px";
  const terminal = document.getElementById("ide-terminal-panel");
  const height = Number(_sednarSettingsGet("terminalHeight")) || 0;
  if (terminal && height >= 100 && terminal.style.display !== "none") terminal.style.height = height + "px";
  if (window.ideEditor) setTimeout(function() { try { window.ideEditor.layout(); } catch (_) {} }, 50);
}

function _sednarTerminalOptionsFromSettings() {
  return {
    fontSize: Number(_sednarSettingsGet("terminalFontSize")) || 13,
    cursorStyle: ["bar", "block", "underline"].indexOf(_sednarSettingsGet("terminalCursorStyle")) >= 0 ? _sednarSettingsGet("terminalCursorStyle") : "bar",
    cursorBlink: _sednarSettingsGet("terminalCursorBlink") !== false,
    scrollback: Math.max(100, Math.min(100000, Number(_sednarSettingsGet("terminalScrollback")) || 5000)),
  };
}

function _sednarApplyEditorTerminalSettings() {
  if (typeof window._sednarApplyEditorSettings === "function") window._sednarApplyEditorSettings();
  if (typeof ideTerminalTabs !== "undefined") {
    const opts = _sednarTerminalOptionsFromSettings();
    ideTerminalTabs.forEach(function(tab) {
      const term = tab && tab.terminal;
      if (!term) return;
      try {
        if (term.options) Object.assign(term.options, opts);
        else Object.keys(opts).forEach(function(k) { term.setOption(k, opts[k]); });
        if (tab.fitAddon && typeof tab.fitAddon.fit === "function") tab.fitAddon.fit();
      } catch (e) {}
    });
  }
}

document.addEventListener("DOMContentLoaded", _sednarLoadServerSettings);


function _sednarComposerPlainText() {
  const input = document.getElementById("sednar-chat-input");
  if (!input) return "";
  return String(input.value != null ? input.value : (input.innerText || "")).trim();
}

function _sednarClearComposer() {
  if (typeof window.clearSednarComposer === "function") {
    window.clearSednarComposer();
  } else {
    const input = document.getElementById("sednar-chat-input");
    if (input) {
      if (input.value != null) {
        input.value = "";
        input.style.height = "auto";
      } else {
        input.textContent = "";
        input.classList.add("is-empty");
      }
    }
  }
  _sednarSyncComposerDraftState();
}

function _sednarComposerHasDraft() {
  if (typeof window.getSednarComposerState === "function") {
    try {
      const state = window.getSednarComposerState() || {};
      return !!String(state.text || "").trim() || (state.attachments || []).length > 0 ||
        (state.segments || []).some(function(s) { return s && s.type === "file"; });
    } catch (e) {}
  }
  return !!_sednarComposerPlainText();
}

function _sednarSyncComposerDraftState() {
  const tab = _sednarGetActiveChatTab();
  const busy = !!(tab && tab.agentRunning);
  const hasDraft = busy && _sednarComposerHasDraft();
  document.querySelectorAll('.chatbot-composer[data-sidebar-section="sednar"]').forEach(function(el) {
    el.classList.toggle("has-queue-draft", hasDraft);
    const send = el.querySelector(".chatbot-composer-send-btn");
    if (!send) return;
    send.style.display = busy && !hasDraft ? "none" : "";
    send.title = busy ? "Queue message (Enter) · Send now (⌘/Ctrl+Enter)" : "Send";
    send.setAttribute("aria-label", busy ? "Queue message" : "Send");
  });
}

function focusSednarComposer() {
  const input = document.getElementById("sednar-chat-input");
  if (!input) return;
  toggleSednarAgentPane(true);
  input.focus();
  if (input.isContentEditable && window.getSelection) {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
window.focusSednarComposer = focusSednarComposer;


const SEDNAR_QUEUE_STORAGE_PREFIX = "sednar_queue_v1:";

function _sednarTabQueue(tab) {
  if (!tab) return [];
  if (!Array.isArray(tab.queuedMessages)) tab.queuedMessages = _sednarLoadQueue(tab);
  return tab.queuedMessages;
}

function _sednarQueueStorageKey(tab) {
  const project = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(sednarProjectPath);
  if (!project || !tab || !tab.sessionId) return "";
  return SEDNAR_QUEUE_STORAGE_PREFIX + project + ":" + tab.sessionId;
}

function _sednarLoadQueue(tab) {
  const key = _sednarQueueStorageKey(tab);
  if (!key) return [];
  try {
    const items = JSON.parse(_sednarStorageGet(key) || "[]");
    if (!Array.isArray(items)) return [];
    const restored = items.filter(function(item) { return item && item.id && (item.text || "").trim(); });
    if (restored.length) tab.queuePaused = true;
    return restored;
  } catch (e) {
    return [];
  }
}

function _sednarPersistQueue(tab) {
  const key = _sednarQueueStorageKey(tab);
  if (!key) return;
  const items = _sednarTabQueue(tab)
    .filter(function(item) { return !(item.attachments || []).length; })
    .map(function(item) {
      return { id: item.id, text: item.text, displayPayload: item.displayPayload, mode: item.mode, options: item.options, createdAt: item.createdAt };
    });
  if (items.length) _sednarStorageSet(key, JSON.stringify(items));
  else _sednarStorageRemove(key);
}

function _sednarNewQueueId() {
  return "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _sednarCaptureComposerMessage(presetMessage, options) {
  const composerState = typeof window.getSednarComposerState === "function"
    ? window.getSednarComposerState()
    : { text: _sednarComposerPlainText(), segments: [], attachments: [] };
  const attachments = typeof window.getSednarApiAttachments === "function"
    ? window.getSednarApiAttachments()
    : (composerState.attachments || []).slice();
  if (typeof window.areSednarAttachmentsReady === "function" && attachments.length && !window.areSednarAttachmentsReady()) {
    _sednarShowIdeToast("Wait for the attachments to finish loading.");
    return null;
  }
  const text = String(presetMessage != null ? presetMessage : (composerState.text || "")).trim();
  const hasInlineFiles = (composerState.segments || []).some(function(s) { return s && s.type === "file"; });
  if (!text && !attachments.length && !hasInlineFiles) return null;
  const displayPayload = typeof window.serializeSednarDisplayPayload === "function"
    ? window.serializeSednarDisplayPayload(composerState)
    : { text: text, segments: [], attachments: composerState.attachments || [] };
  if (!displayPayload.text && text) displayPayload.text = text;
  const opts = options || {};
  return {
    id: _sednarNewQueueId(),
    text: text,
    composerState: composerState,
    displayPayload: displayPayload,
    attachments: attachments,
    mode: opts.mode || window.sednarChatMode || "agent",
    options: { planFile: opts.planFile || "", planTitle: opts.planTitle || "" },
    createdAt: Date.now(),
  };
}

function _sednarQueueFromComposer(tab, presetMessage, options) {
  const item = _sednarCaptureComposerMessage(presetMessage, options);
  if (!item) return null;
  _sednarTabQueue(tab).push(item);
  tab.queueCollapsed = false;
  _sednarClearComposer();
  _sednarPersistQueue(tab);
  _sednarRenderQueueBar();
  return item;
}

const _SEDNAR_QUEUE_ICONS = {
  send: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13.25V3"></path><path d="M3.75 7.25 8 3l4.25 4.25"></path></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 4.25h10.5"></path><path d="M6 4.25V2.75h4v1.5"></path><path d="M4 4.25l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"></path><path d="M6.6 6.75v4.5M9.4 6.75v4.5"></path></svg>',
  remove: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
  chevron: '<svg class="sednar-queue-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5.1 6.6 8 9.5 10.9 6.6"></polyline></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"></circle><circle cx="8" cy="8" r="1.25"></circle><circle cx="12.5" cy="8" r="1.25"></circle></svg>',
  link: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M6.79 9.25H7.25A3 3 0 0 0 7.25 3.25H4.75A3 3 0 0 0 4.75 9.25"></path><path d="M9.21 6.75H8.75A3 3 0 0 0 8.75 12.75H11.25A3 3 0 0 0 11.25 6.75"></path></svg>',
  folder: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"></path></svg>',
  clip: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"></path></svg>',
};

const _SEDNAR_QUEUE_URL_RE = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/gi;

function _sednarQueueChipHtml(kind, label, title) {
  let icon = _SEDNAR_QUEUE_ICONS[kind === "folder" ? "folder" : "link"];
  if (kind === "file") {
    icon = '<img class="sednar-queue-chip-icon" src="' + _sednarEscapeHtml(_sednarFileIcon(label)).replace(/"/g, "&quot;") + '" alt="">';
  }
  return '<span class="sednar-queue-chip is-' + kind + '" title="' + _sednarEscapeHtml(title || label).replace(/"/g, "&quot;") + '">' +
    icon + '<span class="sednar-queue-chip-label">' + _sednarEscapeHtml(label) + "</span></span>";
}

function _sednarQueueLinkifiedHtml(text) {
  const value = String(text || "");
  let html = "";
  let last = 0;
  value.replace(_SEDNAR_QUEUE_URL_RE, function(url, offset) {
    html += _sednarEscapeHtml(value.slice(last, offset));
    html += _sednarQueueChipHtml("link", url.replace(/^https?:\/\//i, "").replace(/\/$/, ""), url);
    last = offset + url.length;
    return url;
  });
  return html + _sednarEscapeHtml(value.slice(last));
}

function _sednarQueueTextHtml(item) {
  const payload = item.displayPayload || {};
  const segments = Array.isArray(payload.segments) && payload.segments.length
    ? payload.segments
    : ((item.composerState && item.composerState.segments) || []);
  let html = "";
  if (segments.some(function(s) { return s && (s.type === "file" || s.type === "folder"); })) {
    html = segments.map(function(s) {
      if (!s) return "";
      if (s.type === "file" || s.type === "folder") {
        const path = String(s.path || s.value || s.name || "");
        const name = String(s.name || s.label || _sednarBasename(path) || path);
        const isFolder = s.type === "folder" || !!(s.isDir || s.is_dir) || s.kind === "folder";
        return _sednarQueueChipHtml(isFolder ? "folder" : "file", name, path);
      }
      return _sednarQueueLinkifiedHtml(s.text != null ? s.text : (s.value || ""));
    }).join("");
  }
  if (!html.trim()) html = _sednarQueueLinkifiedHtml(String(item.text || "").trim());
  if (!html.trim()) {
    const count = (item.attachments || []).length;
    html = '<span class="sednar-queue-muted">' + count + " attachment" + (count === 1 ? "" : "s") + "</span>";
  }
  return html;
}

function _sednarRenderQueueBar() {
  const bar = document.getElementById("sednar-queue-bar");
  if (!bar) return;
  _sednarBindQueueBarOnce(bar);
  const tab = _sednarGetActiveChatTab();
  const queue = _sednarTabQueue(tab);
  if (!queue.length) {
    bar.hidden = true;
    bar.innerHTML = "";
    _sednarSyncComposerStack();
    return;
  }
  const running = !!(tab && tab.agentRunning);
  const paused = !!(tab && tab.queuePaused);
  const collapsed = !!(tab && tab.queueCollapsed);
  const auto = !!_sednarSettingsGet("autoRunQueue");
  const waiting = !running && !paused && !auto;
  const note = paused ? "Paused" : (waiting ? "Waiting for you" : "");
  bar.hidden = false;
  bar.classList.toggle("is-collapsed", collapsed);
  bar.classList.toggle("is-paused", paused);
  const head =
    '<div class="sednar-queue-head">' +
      '<button type="button" class="sednar-queue-toggle lc-btn" data-queue-action="toggle" aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        _SEDNAR_QUEUE_ICONS.chevron + '<span class="sednar-queue-count">' + queue.length + " Queued</span>" +
        (note ? '<span class="sednar-queue-note">· ' + note + "</span>" : "") +
      "</button>" +
      (paused || waiting ? '<button type="button" class="sednar-queue-head-btn lc-btn" data-queue-action="resume">' + (paused ? "Resume" : "Send next") + "</button>" : "") +
      '<button type="button" class="sednar-queue-more lc-btn" data-queue-action="menu" title="Queue options" aria-label="Queue options" aria-haspopup="menu" aria-expanded="false">' + _SEDNAR_QUEUE_ICONS.more + "</button>" +
    "</div>";
  const items = queue.map(function(item) {
    const mode = item.mode && item.mode !== "agent" ? '<span class="sednar-queue-mode">' + _sednarEscapeHtml(item.mode.charAt(0).toUpperCase() + item.mode.slice(1)) + "</span>" : "";
    const attached = (item.attachments || []).length;
    const clips = attached && String(item.text || "").trim() ? '<span class="sednar-queue-clip" title="' + attached + " attachment" + (attached === 1 ? "" : "s") + '">' + _SEDNAR_QUEUE_ICONS.clip + attached + "</span>" : "";
    return '<div class="sednar-queue-item" role="listitem" draggable="true" data-queue-id="' + _sednarEscapeHtml(item.id) + '">' +
      '<span class="sednar-queue-dot" title="Drag to reorder" aria-hidden="true"></span>' +
      '<span class="sednar-queue-text" data-queue-action="edit" role="button" tabindex="0" title="Edit in the composer">' + _sednarQueueTextHtml(item) + mode + clips + "</span>" +
      '<span class="sednar-queue-actions">' +
        '<button type="button" class="sednar-queue-btn lc-btn" data-queue-action="send" title="Send now' + (running ? " (stops the current turn)" : "") + '" aria-label="Send now">' + _SEDNAR_QUEUE_ICONS.send + "</button>" +
        '<button type="button" class="sednar-queue-btn lc-btn" data-queue-action="remove" title="Remove from the queue" aria-label="Remove">' + _SEDNAR_QUEUE_ICONS.trash + "</button>" +
      "</span>" +
    "</div>";
  }).join("");
  _sednarMorph(bar, head + '<div class="sednar-queue-list" role="list" aria-label="Queued messages">' + items + "</div>");
  _sednarSyncComposerStack();
}

function _sednarCloseQueueMenu() {
  const menu = document.getElementById("sednar-queue-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const more = document.querySelector('#sednar-queue-bar [data-queue-action="menu"]');
  if (more) more.setAttribute("aria-expanded", "false");
}

function _sednarToggleQueueMenu(anchor) {
  const stack = document.getElementById("sednar-composer-stack");
  const tab = _sednarGetActiveChatTab();
  if (!stack || !tab) return;
  let menu = document.getElementById("sednar-queue-menu");
  if (menu && !menu.hidden) {
    _sednarCloseQueueMenu();
    return;
  }
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "sednar-queue-menu";
    menu.className = "sednar-queue-menu theme-transition";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    stack.appendChild(menu);
    menu.addEventListener("click", function(e) {
      const btn = e.target.closest ? e.target.closest("[data-queue-menu]") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      _sednarRunQueueMenuAction(btn.getAttribute("data-queue-menu"));
    });
    document.addEventListener("mousedown", function(e) {
      const open = document.getElementById("sednar-queue-menu");
      if (!open || open.hidden) return;
      if (open.contains(e.target) || (e.target.closest && e.target.closest('[data-queue-action="menu"]'))) return;
      _sednarCloseQueueMenu();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") _sednarCloseQueueMenu();
    });
  }
  const paused = !!tab.queuePaused;
  const auto = !!_sednarSettingsGet("autoRunQueue");
  menu.innerHTML =
    '<button type="button" class="sednar-queue-menu-item lc-btn" role="menuitem" data-queue-menu="send-next">Send next now</button>' +
    '<button type="button" class="sednar-queue-menu-item lc-btn" role="menuitem" data-queue-menu="' + (paused ? "resume" : "pause") + '">' + (paused ? "Resume queue" : "Pause queue") + "</button>" +
    '<button type="button" class="sednar-queue-menu-item lc-btn" role="menuitemcheckbox" aria-checked="' + auto + '" data-queue-menu="auto">' +
      "<span>Run automatically</span>" + (auto ? _SEDNAR_QUEUE_ICONS.check : "") + "</button>" +
    '<div class="sednar-queue-menu-sep" role="separator"></div>' +
    '<button type="button" class="sednar-queue-menu-item lc-btn is-danger" role="menuitem" data-queue-menu="clear">Clear queue</button>';
  const stackRect = stack.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  menu.style.top = Math.round(anchorRect.bottom - stackRect.top + 4) + "px";
  menu.style.right = Math.max(4, Math.round(stackRect.right - anchorRect.right)) + "px";
  menu.hidden = false;
  anchor.setAttribute("aria-expanded", "true");
  const first = menu.querySelector("button");
  if (first) first.focus();
}

function _sednarRunQueueMenuAction(action) {
  const tab = _sednarGetActiveChatTab();
  _sednarCloseQueueMenu();
  if (!tab) return;
  const queue = _sednarTabQueue(tab);
  if (action === "send-next" && queue.length) {
    _sednarSendQueuedNow(tab, queue[0].id);
  } else if (action === "pause") {
    tab.queuePaused = true;
    _sednarRenderQueueBar();
  } else if (action === "resume") {
    tab.queuePaused = false;
    _sednarRenderQueueBar();
    _sednarMaybeRunQueue(tab);
  } else if (action === "auto") {
    const auto = !_sednarSettingsGet("autoRunQueue");
    _sednarSettingsSet("autoRunQueue", auto);
    _sednarRenderQueueBar();
    if (_sednarSettingsVisible("agent")) _sednarRenderSettingsPage();
    if (auto && !tab.queuePaused) _sednarMaybeRunQueue(tab);
  } else if (action === "clear") {
    tab.queuedMessages = [];
    tab.queuePaused = false;
    _sednarPersistQueue(tab);
    _sednarRenderQueueBar();
  }
}

function _sednarQueueItemIndex(tab, id) {
  return _sednarTabQueue(tab).findIndex(function(item) { return item.id === id; });
}

function _sednarEditQueuedMessage(tab, id) {
  const queue = _sednarTabQueue(tab);
  const index = _sednarQueueItemIndex(tab, id);
  if (index < 0) return;
  const item = queue[index];
  const draft = _sednarComposerHasDraft() ? _sednarCaptureComposerMessage() : null;
  if (draft) queue.splice(index, 1, draft);
  else queue.splice(index, 1);
  _sednarSetComposerText(item.text || "");
  _sednarPersistQueue(tab);
  _sednarRenderQueueBar();
  _sednarSyncComposerDraftState();
  focusSednarComposer();
}

function _sednarSendQueuedNow(tab, id) {
  const queue = _sednarTabQueue(tab);
  const index = _sednarQueueItemIndex(tab, id);
  if (index < 0 || !tab) return;
  const item = queue.splice(index, 1)[0];
  tab.queuePaused = false;
  _sednarPersistQueue(tab);
  _sednarRenderQueueBar();
  const run = function() {
    if (!_sednarIsActiveTab(tab)) _sednarSwitchChatTab(tab.id);
    window.sendSednarAgentMessage(item.text, Object.assign({}, item.options || {}, { mode: item.mode, queuedItem: item }));
  };
  if (!tab.agentRunning) {
    run();
    return;
  }
  const done = tab._turnDone || Promise.resolve();
  tab._suppressQueueOnce = true;
  _sednarAbortTabTurn(tab);
  _sednarClearQuestionRequest(tab);
  tab.buildingPlanFile = "";
  _sednarSyncPlanCardButtons();
  _setSednarChatBusy(false);
  sednarAgentRunning = false;
  done.then(function() { setTimeout(run, 0); });
}

function _sednarMaybeRunQueue(tab) {
  if (!tab || tab.agentRunning || tab.queuePaused) return;
  const queue = _sednarTabQueue(tab);
  if (!queue.length) return;
  if (!_sednarIsActiveTab(tab)) {
    tab.queueWaiting = true;
    return;
  }
  tab.queueWaiting = false;
  _sednarSendQueuedNow(tab, queue[0].id);
}

function _sednarAfterTurnQueue(tab, failed) {
  if (!tab) return;
  if (tab._suppressQueueOnce) {
    tab._suppressQueueOnce = false;
    _sednarRenderQueueBar();
    return;
  }
  const queue = _sednarTabQueue(tab);
  if (failed && queue.length) tab.queuePaused = true;
  _sednarRenderQueueBar();
  _sednarSyncComposerDraftState();
  if (!queue.length || tab.queuePaused || !_sednarSettingsGet("autoRunQueue")) return;
  setTimeout(function() { _sednarMaybeRunQueue(tab); }, 250);
}

let _sednarQueueDragId = "";

function _sednarBindQueueBarOnce(bar) {
  if (!bar || bar._sednarQueueBound) return;
  bar._sednarQueueBound = true;
  bar.addEventListener("click", function(e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-queue-action]") : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const tab = _sednarGetActiveChatTab();
    if (!tab) return;
    const action = btn.getAttribute("data-queue-action");
    const itemEl = btn.closest(".sednar-queue-item");
    const id = itemEl ? itemEl.getAttribute("data-queue-id") : "";
    if (action === "toggle") {
      tab.queueCollapsed = !tab.queueCollapsed;
      _sednarRenderQueueBar();
    } else if (action === "menu") {
      _sednarToggleQueueMenu(btn);
    } else if (action === "resume") {
      tab.queuePaused = false;
      _sednarRenderQueueBar();
      _sednarMaybeRunQueue(tab);
    } else if (action === "send" && id) {
      _sednarSendQueuedNow(tab, id);
    } else if (action === "edit" && id) {
      _sednarEditQueuedMessage(tab, id);
    } else if (action === "remove" && id) {
      const index = _sednarQueueItemIndex(tab, id);
      if (index >= 0) _sednarTabQueue(tab).splice(index, 1);
      if (!_sednarTabQueue(tab).length) tab.queuePaused = false;
      _sednarPersistQueue(tab);
      _sednarRenderQueueBar();
    }
  });
  bar.addEventListener("keydown", function(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const text = e.target && e.target.closest ? e.target.closest('.sednar-queue-text[data-queue-action="edit"]') : null;
    const itemEl = text && text.closest(".sednar-queue-item");
    const tab = _sednarGetActiveChatTab();
    if (!itemEl || !tab) return;
    e.preventDefault();
    _sednarEditQueuedMessage(tab, itemEl.getAttribute("data-queue-id"));
  });
  bar.addEventListener("dragstart", function(e) {
    const itemEl = e.target && e.target.closest ? e.target.closest(".sednar-queue-item") : null;
    if (!itemEl) return;
    _sednarQueueDragId = itemEl.getAttribute("data-queue-id") || "";
    itemEl.classList.add("is-dragging");
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", _sednarQueueDragId); } catch (err) {}
  });
  bar.addEventListener("dragover", function(e) {
    if (!_sednarQueueDragId) return;
    const itemEl = e.target && e.target.closest ? e.target.closest(".sednar-queue-item") : null;
    e.preventDefault();
    bar.querySelectorAll(".sednar-queue-item").forEach(function(el) { el.classList.remove("drop-before", "drop-after"); });
    if (!itemEl || itemEl.getAttribute("data-queue-id") === _sednarQueueDragId) return;
    const rect = itemEl.getBoundingClientRect();
    itemEl.classList.add(e.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
  });
  bar.addEventListener("drop", function(e) {
    if (!_sednarQueueDragId) return;
    e.preventDefault();
    const tab = _sednarGetActiveChatTab();
    const target = bar.querySelector(".sednar-queue-item.drop-before, .sednar-queue-item.drop-after");
    if (tab && target) {
      const queue = _sednarTabQueue(tab);
      const from = _sednarQueueItemIndex(tab, _sednarQueueDragId);
      if (from >= 0) {
        const moved = queue.splice(from, 1)[0];
        let to = _sednarQueueItemIndex(tab, target.getAttribute("data-queue-id"));
        if (target.classList.contains("drop-after")) to += 1;
        queue.splice(Math.max(0, to), 0, moved);
        _sednarPersistQueue(tab);
      }
    }
    _sednarQueueDragId = "";
    _sednarRenderQueueBar();
  });
  bar.addEventListener("dragend", function() {
    _sednarQueueDragId = "";
    bar.querySelectorAll(".sednar-queue-item").forEach(function(el) { el.classList.remove("is-dragging", "drop-before", "drop-after"); });
  });
}

function _sednarComposerMenuOpen() {
  return ["sednar-mention-menu", "sednar-slash-menu"].some(function(id) {
    const menu = document.getElementById(id);
    return !!(menu && menu.style.display !== "none" && menu.offsetParent !== null);
  });
}

function _sednarBindQueueKeysOnce() {
  const composer = document.getElementById("sednar-chat-composer");
  if (!composer || composer._sednarQueueKeysBound) return;
  composer._sednarQueueKeysBound = true;
  composer.addEventListener("keydown", function(e) {
    if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.altKey) return;
    if (!e.target || e.target.id !== "sednar-chat-input") return;
    const tab = _sednarGetActiveChatTab();
    if (!tab || !tab.agentRunning || tab.pendingQuestion || _sednarComposerMenuOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const item = _sednarQueueFromComposer(tab);
    if (item && (e.metaKey || e.ctrlKey)) {
      const queue = _sednarTabQueue(tab);
      queue.splice(queue.indexOf(item), 1);
      queue.unshift(item);
      _sednarSendQueuedNow(tab, item.id);
    }
  }, true);
  composer.addEventListener("input", _sednarSyncComposerDraftState);
}

window.stopSednarAgent = function() {
  const tab = _sednarGetActiveChatTab();
  if (tab) {
    if (tab.agentRunning && _sednarTabQueue(tab).length) tab.queuePaused = true;
    _sednarAbortTabTurn(tab);
    _sednarClearQuestionRequest(tab);
    tab.buildingPlanFile = "";
    _sednarSyncPlanCardButtons();
  }
  _setSednarChatBusy(false);
  sednarAgentRunning = false;
  renderSednarRecentSessions();
};

window.sendSednarAgentMessage = async function(presetMessage, options) {
  const tab = _sednarGetActiveChatTab();
  if (tab && tab.pendingQuestion) {
    _sednarSubmitQuestions(false);
    return;
  }
  const turnOptions = options || {};
  const queued = turnOptions.queuedItem || null;
  if (tab && tab.agentRunning && !queued) {
    _sednarQueueFromComposer(tab, presetMessage, turnOptions);
    return;
  }
  if (!tab || tab.agentRunning) return;
  if (_sednarLlmSettings && !(_sednarLlmSettings.providers || []).some(function(p) { return p.configured; })) {
    _sednarModalConfirm({
      title: "Add an API key to start chatting",
      message: "Sednar needs a model provider. Add a key for Gemini, OpenAI, Anthropic or another provider in Settings > Models.",
      confirmText: "Open Models settings",
    }).then(function(ok) { if (ok) window.openSednarSettings("models"); });
    return;
  }
  const turnMode = turnOptions.mode || (queued && queued.mode) || window.sednarChatMode || "agent";

  const turnPlanFile = turnOptions.planFile
    || (turnMode === "plan" ? (tab.planFile || "") : "");
  const composerState = queued
    ? (queued.composerState || { text: queued.text, segments: [], attachments: [] })
    : (typeof window.getSednarComposerState === "function"
      ? window.getSednarComposerState()
      : { text: _sednarComposerPlainText(), segments: [], attachments: [] });
  const apiAttachments = queued
    ? (queued.attachments || []).slice()
    : (typeof window.getSednarApiAttachments === "function"
      ? window.getSednarApiAttachments()
      : (composerState.attachments || []).slice());
  const hasAttachments = apiAttachments.length > 0;
  if (!queued && typeof window.areSednarAttachmentsReady === "function" && hasAttachments && !window.areSednarAttachmentsReady()) return;
  let displayQuestion = String(presetMessage != null ? presetMessage : (composerState.text || "")).trim();
  let question = displayQuestion;
  if (!question && hasAttachments && typeof window.buildChatAttachmentPrompt === "function") {
    question = window.buildChatAttachmentPrompt(apiAttachments);
    displayQuestion = displayQuestion || question;
  }
  const hasInlineFiles = (composerState.segments || []).some(function(s) {
    return s && s.type === "file";
  });
  if (!question && !hasAttachments && !hasInlineFiles) return;
  const displayPayload = queued && queued.displayPayload
    ? Object.assign({}, queued.displayPayload)
    : (typeof window.serializeSednarDisplayPayload === "function"
      ? window.serializeSednarDisplayPayload(composerState)
      : { text: displayQuestion, segments: [], attachments: composerState.attachments || [] });
  if (!displayPayload.text && displayQuestion) displayPayload.text = displayQuestion;
  const buildPlanFile = turnMode === "agent" ? String(turnOptions.planFile || "") : "";
  if (buildPlanFile) displayPayload.plan_build = { file: buildPlanFile, title: turnOptions.planTitle || "" };
  if (!sednarProjectPath) {
    alert("Open a project folder first.");
    return;
  }
  const turnSessionId = sednarAgentSessionId;
  if (turnSessionId) {
    delete _sednarLastProgressSeqBySession[turnSessionId];
    delete _sednarActiveTurnIdBySession[turnSessionId];
  }
  toggleSednarAgentPane(true);
  _sednarShowChatContainer();
  _sednarUpdateActiveChatTabTitle(displayQuestion || question);
  _sednarUpsertPendingSession(
    turnSessionId,
    _sednarTruncateTabTitle(displayQuestion || question, 120)
  );
  tab.agentRunning = true;
  tab._turnProjectPath = sednarProjectPath;
  tab._turnStateKey = _sednarWorkspaceStateKey() || _sednarNormalizeProjectKey(sednarProjectPath);
  tab.buildingPlanFile = buildPlanFile;
  tab._turnStreamComplete = false;
  tab._answerStreaming = false;
  tab._assistantStreamRow = null;
  let turnFailed = false;
  let resolveTurnDone = null;
  tab._turnDone = new Promise(function(resolve) { resolveTurnDone = resolve; });
  sednarAgentRunning = true;
  renderSednarRecentSessions();
  _sednarRenderProjectTabs();
  if (!queued) _sednarClearComposer();
  if (typeof window.updateSednarComposerSendState === "function") {
    window.updateSednarComposerSendState();
  }
  const out = getSednarChatOutput();
  if (!out) {
    tab.agentRunning = false;
    sednarAgentRunning = false;
    return;
  }
  _sednarMarkChatOutputForTab(out, tab);
  const getStreamOut = function() {
    return _sednarGetTabStreamOutput(tab) || out;
  };
  _sednarResetTurnState();
  _sednarClearWelcomePlaceholder(out);
  _sednarSettleRunningTerminalCards(out, { keepEmpty: true });
  let urow = _sednarRenderPlanBuildRow(out, displayPayload);
  if (!urow && typeof window.renderSednarUserMessage === "function") {
    urow = window.renderSednarUserMessage(out, displayPayload);
  }
  _sednarSyncPlanCardButtons(out);
  if (!urow) {
    urow = document.createElement("div");
    urow.className = "chat-row sednar-user-row";
    urow.innerHTML = `<div class="chat-msg user"><span class="sednar-user-text">${_sednarEscapeHtml(displayQuestion || question)}</span></div>`;
    out.appendChild(urow);
  }
  _sednarCurrentUserRow = urow;
  urow.setAttribute("data-turn-started", String(Date.now()));  // for "Worked for …" once the turn ends
  _sednarScheduleUserMessageCollapseState(out);
  _sednarSaveTurnCtxToTab(tab);
  tab.messagesHtml = out.innerHTML;
  tab.chatStarted = true;
  _sednarChatStarted = true;
  _sednarSyncComposerPlaceholder();
  _sednarScrollChatToBottom(out);
  _setSednarChatBusy(true);
  initSednarAgentSocket();
  _sednarResetAnswerLiveStream();
  _sednarShowImmediateThinking(undefined, { bootstrap: true });
  _sednarSaveTurnCtxToTab(tab);
  _sednarScrollChatToBottom(out);
  let fullText = "";
  let lastRenderedAnswer = "";
  let assistantRow = null;
  tab._assistantStreamRow = null;
  const ensureAssistantRow = function() {
    const streamOut = getStreamOut();
    if (!streamOut) return null;
    if (assistantRow && assistantRow.parentNode === streamOut) {
      return assistantRow.querySelector(".sednar-stream-msg") || assistantRow.querySelector(".chat-msg.assistant");
    }
    if (tab._assistantStreamRow && tab._assistantStreamRow.parentNode === streamOut) {
      assistantRow = tab._assistantStreamRow;
      return assistantRow.querySelector(".sednar-stream-msg") || assistantRow.querySelector(".chat-msg.assistant");
    }
    assistantRow = document.createElement("div");
    assistantRow.className = "chat-row sednar-assistant-row";
    assistantRow.innerHTML = '<div class="chat-msg assistant sednar-stream-msg sednar-plain-msg"></div>';

    streamOut.appendChild(assistantRow);
    tab._assistantStreamRow = assistantRow;
    if (_sednarIsActiveTab(tab)) {
      _sednarAssistantStreamEl = assistantRow.querySelector(".sednar-stream-msg");
    }
    return assistantRow.querySelector(".sednar-stream-msg");
  };
  const finalizeAssistantAnswerRow = function() {
    if (!assistantRow) return;
    const msgEl = assistantRow.querySelector(".chat-msg.assistant");
    if (msgEl) msgEl.classList.remove("sednar-stream-msg");
    if (tab._assistantStreamRow === assistantRow) tab._assistantStreamRow = null;
    if (_sednarAssistantStreamEl === msgEl) _sednarAssistantStreamEl = null;
  };
  const flushAnswerMarkdown = function() {
    const msgEl = ensureAssistantRow();
    if (msgEl) {
      _sednarRenderAssistantMarkdown(msgEl, fullText);
      lastRenderedAnswer = fullText;
    }
    const streamOut = getStreamOut();
    if (streamOut) tab.messagesHtml = streamOut.innerHTML;
    _sednarAutoScroll(streamOut);
  };
  if (tab.abortController) {
    try { tab.abortController.abort(); } catch (e) {}
  }
  tab.abortController = new AbortController();
  if (_sednarIsActiveTab(tab)) {
    _sednarChatAbortController = tab.abortController;
  }
  try {
    initSednarAgentSocket();
    const agentSock = window._sednarAgentSocket;
    const socketId = (agentSock && agentSock.id) || (typeof socket !== "undefined" && socket && socket.id) || "";
    const resp = await fetch("/sednar-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: tab.abortController.signal,
      body: JSON.stringify({
        project_path: sednarProjectPath,
        question: question,
        attachments: apiAttachments,
        session_id: turnSessionId,
        socket_id: socketId || undefined,
        model: _sednarChatModel(),
        display_payload: displayPayload,
        mode: turnMode,
        plan_file: turnPlanFile || undefined,
        enable_mcp_tools: sednarMcpSelectedServers.size > 0,
        mcp_servers: Array.from(sednarMcpSelectedServers),
        mcp_disabled_tools: _sednarMcpDisabledToolsForRequest(),
        require_permissions: !!_sednarSettingsGet("requireApproval"),
        enable_web_tools: _sednarSettingsGet("webTools") ? true : undefined,
        workspace: _sednarCurrentWorkspacePayload(),
      }),
    });
    const payload = await resp.json();
    const streamOut = getStreamOut();
    const isVisibleTab = _sednarIsActiveTab(tab);
    if (!resp.ok || payload.error) {
      turnFailed = true;
      tab._answerStreaming = true;
      fullText = payload.error || "Sednar request failed.";
      if (isVisibleTab) {
        _sednarStopThinkingTicker();
        _sednarFinalizeRunningActivity();
        _sednarHideStatusRow();
      }
      flushAnswerMarkdown();
    } else {
      tab._answerStreaming = true;
      tab._turnStreamComplete = true;
      fullText = payload.answer || "";
      if (isVisibleTab) {
        _sednarStopThinkingTicker();
        _sednarFinalizeRunningActivity();
        _sednarHideStatusRow();
      }
      if (payload.session_title && sednarChatTabs.indexOf(tab) === -1) {
        tab.title = _sednarTruncateTabTitle(payload.session_title);
      } else if (payload.session_title) {
        _sednarUpsertPendingSession(turnSessionId, payload.session_title);
        const titleTab = sednarChatTabs.find(function(t) { return t.sessionId === turnSessionId; });
        if (titleTab) {
          titleTab.title = _sednarTruncateTabTitle(payload.session_title);
        }
        if (isVisibleTab) {
          _sednarUpdateActiveChatTabTitle(payload.session_title, true);
        }
        renderSednarRecentSessions();
      }
      flushAnswerMarkdown();
      finalizeAssistantAnswerRow();
    }
    if (streamOut) {
      tab.messagesHtml = streamOut.innerHTML;
      if (_sednarIsActiveTab(tab)) {
        _sednarAutoScroll(streamOut);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      turnFailed = true;
      const msgEl = ensureAssistantRow();
      if (msgEl) msgEl.textContent = "Error: " + (err.message || String(err));
      _sednarSyncTabStreamOutput(tab);
    }
  } finally {
    if (_sednarIsActiveTab(tab)) {
      _sednarStopThinkingTicker();
    }
    tab._turnStreamComplete = true;
    tab._answerStreaming = false;
    tab.abortController = null;
    tab.agentRunning = false;
    tab.buildingPlanFile = "";
    _sednarClearQuestionRequest(tab);
    if (_sednarIsActiveTab(tab)) _sednarSyncPlanCardButtons();
    if (_sednarIsActiveTab(tab)) {
      _sednarChatAbortController = null;
      _sednarClearPendingToolSteps();
    }
    _sednarSyncGlobalRunningFromActiveTab();
    _sednarRenderChatTabs();
    try {
      _sednarSyncTabStreamOutput(tab);
      const persistOut = _sednarIsActiveTab(tab)
        ? getSednarChatOutput()
        : (tab._backgroundOutput || null);
      if (persistOut) {
        _sednarMarkTurnsFinished(persistOut);
        _sednarFinalizeDomForSnapshot(persistOut);
        tab.messagesHtml = persistOut.innerHTML;
      } else if (tab._backgroundOutput) {
        tab.messagesHtml = tab._backgroundOutput.innerHTML;
      }
      if (tab.messagesHtml && tab.sessionId) {
        delete _sednarLastProgressSeqBySession[tab.sessionId];
        delete _sednarActiveTurnIdBySession[tab.sessionId];
        tab.chatStarted = true;
        const backgroundEntry = _sednarBackgroundEntryForTab(tab);
        if (backgroundEntry) {
          _sednarPersistBackgroundProjectChats(backgroundEntry, tab);
        } else if (tab._turnProjectPath) {
          _sednarPersistChatSnapshot(tab._turnProjectPath, tab, tab._turnStateKey);
        }
      }
      if (_sednarIsActiveTab(tab)) {
        if (fullText && _sednarAssistantStreamEl && fullText !== lastRenderedAnswer) {
          _sednarRenderAssistantMarkdown(_sednarAssistantStreamEl, fullText);
          lastRenderedAnswer = fullText;
        }
        const liveOut = getSednarChatOutput();
        _sednarAutoScroll(liveOut);
      } else {
        tab.hasUnread = true;
      }
      if (sednarProjectPath) renderSednarRecentSessions();
      _sednarRenderChatTabs();
      if (_sednarIsActiveTab(tab)) _sednarSchedulePendingChangesRefresh();
    } catch (cleanupErr) {
      if (window.console && console.warn) console.warn("Sednar chat cleanup failed", cleanupErr);
    }
    if (resolveTurnDone) resolveTurnDone();
    _sednarAfterTurnQueue(tab, turnFailed);
  }
};

function _sednarBindUserMessageCollapseOnce() {
  const out = getSednarChatOutput();
  if (!out || out.dataset.userCollapseBound === "1") return;
  out.dataset.userCollapseBound = "1";
  out.addEventListener("click", function(e) {
    const msg = e.target && e.target.closest ? e.target.closest(".chat-row.sednar-user-row .chat-msg.user") : null;
    if (!msg) return;
    const row = msg.closest(".chat-row.sednar-user-row");
    if (!row || !row.classList.contains("is-collapsible")) return;
    row.classList.toggle("is-expanded");
  });
}

document.addEventListener("DOMContentLoaded", function() {
  const el = document.getElementById("sednar-chat-input");
  const chatOut = getSednarChatOutput();
  if (chatOut) chatOut.setAttribute("data-density", _sednarConversationDensity());
  _sednarBindChatScrollWheel();
  _sednarBindUserMessageCollapseOnce();
  _sednarBindThoughtTogglesOnce();
  _sednarBindDiffFileNameClicksOnce();
  _sednarBindTerminalCardsOnce();
  _sednarBindPlanCardsOnce();
  _sednarWatchModelLabelOnce();
  _sednarFetchFxRateOnce();
  _sednarBindQueueKeysOnce();
  if (!el) return;

  (function() {
    const approve = document.getElementById("sednar-permission-toolbar-approve");
    const deny = document.getElementById("sednar-permission-toolbar-deny");
    if (!approve || !deny) return;

    function submit(approved) {
      const tab = _sednarGetActiveChatTab();
      const reqId = tab ? String(tab.pendingPermissionRequestId || "") : "";
      if (!tab || !reqId) return;
      _sednarSubmitPermissionDecision(reqId, approved);
    }

    approve.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      submit(true);
    });
    deny.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      submit(false);
    });

    _sednarSetPermissionToolbarVisible(false);
  })();

  if (typeof window.initSednarComposerInput === "function") {
    window.initSednarComposerInput();
  }
});

window.sednarChatMode = localStorage.getItem(SEDNAR_CHAT_MODE_STORAGE_KEY) || "agent";

function _sednarApplyChatModeToUI() {
  const modeDef = SEDNAR_CHAT_MODES.find(function(m) {
    return m.value === window.sednarChatMode;
  }) || SEDNAR_CHAT_MODES[0];
  const trigger = document.querySelector("[data-sednar-mode-trigger]");
  if (trigger) trigger.setAttribute("data-mode", modeDef.value);
  const label = document.querySelector("[data-sednar-mode-label]");
  if (label) label.textContent = modeDef.label;
  const iconEl = document.querySelector(".chatbot-composer-mode-icon");
  if (iconEl) {
    iconEl.outerHTML = _sednarGetModeIconHtml(modeDef.value, "chatbot-composer-mode-icon");
  }
  _sednarSyncComposerPlaceholder();
}

function _sednarSyncComposerPlaceholder() {
  const input = document.getElementById("sednar-chat-input");
  const composer = document.getElementById("sednar-chat-composer");
  if (!input || (composer && composer.classList.contains("has-pending-questionnaire"))) return;
  const modeDef = SEDNAR_CHAT_MODES.find(function(m) {
    return m.value === window.sednarChatMode;
  }) || SEDNAR_CHAT_MODES[0];
  const placeholder = _sednarChatStarted ? SEDNAR_FOLLOWUP_PLACEHOLDER : (modeDef.placeholder || SEDNAR_COMPOSER_PLACEHOLDER);
  if ("placeholder" in input) {
    input.placeholder = placeholder;
  }
  input.setAttribute("data-placeholder", placeholder);
}

function _sednarEnsureModeDropdown() {
  let el = document.getElementById("sednar-chat-mode-dropdown");
  if (el) {
    if (el.style.position !== "fixed") {
      el.setAttribute("style", _SEDNAR_MODE_DROPDOWN_STYLE);
    }
    return el;
  }
  el = document.createElement("div");
  el.id = "sednar-chat-mode-dropdown";
  el.className = "airflow-dropdown-opaque chatbot-model-dropdown sednar-chat-mode-dropdown";
  el.setAttribute("style", _SEDNAR_MODE_DROPDOWN_STYLE);
  el.setAttribute("role", "listbox");
  el.setAttribute("aria-label", "Select mode");
  el.innerHTML =
    '<div id="sednar-chat-mode-dropdown-list" class="chatbot-model-dropdown-list" style="flex:1;overflow-y:auto;max-height:320px;"></div>';
  document.body.appendChild(el);
  return el;
}

function _sednarRenderModeDropdownList() {
  const list = document.getElementById("sednar-chat-mode-dropdown-list");
  if (!list) return;
  const checkSvg =
    '<svg class="sednar-mode-dropdown-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"></polyline></svg>';
  list.innerHTML = SEDNAR_CHAT_MODES.map(function(mode) {
    const isSelected = mode.value === window.sednarChatMode;
    return (
      '<div class="chatbot-model-dropdown-item sednar-mode-dropdown-item theme-transition' +
      (isSelected ? " is-selected" : "") +
      '" data-mode-value="' + mode.value + '" role="option" aria-selected="' + (isSelected ? "true" : "false") + '">' +
      '<span class="sednar-mode-dropdown-item-icon">' + _sednarGetModeIconHtml(mode.value) + "</span>" +
      "<span>" + mode.label + "</span>" +
      checkSvg +
      "</div>"
    );
  }).join("");
  list.querySelectorAll(".sednar-mode-dropdown-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      const nextMode = item.getAttribute("data-mode-value");
      if (!nextMode) return;
      window.sednarChatMode = nextMode;
      localStorage.setItem(SEDNAR_CHAT_MODE_STORAGE_KEY, nextMode);
      _sednarApplyChatModeToUI();
      window.closeSednarModeDropdown();
      _sednarRenderModeDropdownList();
    });
  });
}

window.closeSednarModeDropdown = function() {
  const dropdown = document.getElementById("sednar-chat-mode-dropdown");
  const trigger = document.querySelector("[data-sednar-mode-trigger]");
  if (dropdown) {
    dropdown.classList.remove("is-open");
    dropdown.style.setProperty("display", "none", "important");
  }
  if (trigger) {
    trigger.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }
};

window.toggleSednarModeDropdown = function(trigger) {
  const dropdown = _sednarEnsureModeDropdown();
  if (!dropdown || !trigger) return;
  const wasOpen = dropdown.classList.contains("is-open") && trigger.classList.contains("is-open");
  window.closeSednarModeDropdown();
  if (wasOpen) return;
  if (typeof window.closeChatbotModelDropdown === "function") {
    window.closeChatbotModelDropdown();
  }
  _sednarRenderModeDropdownList();
  const rect = trigger.getBoundingClientRect();
  dropdown.style.setProperty("display", "flex", "important");
  dropdown.classList.add("is-open");
  dropdown.style.left = rect.left + "px";
  dropdown.style.minWidth = Math.max(rect.width, 180) + "px";
  dropdown.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  dropdown.style.zIndex = "10050";
  trigger.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
};

const _SEDNAR_MODEL_VARIANT_RE = /^(.*?\S)\s+((?:(?:high|medium|low|minimal|max|fast|thinking)\b\s*)+)$/i;

function _sednarStyleModelLabel(label) {
  if (!label || label.querySelector(".sednar-model-variant")) return;
  const m = String(label.textContent || "").match(_SEDNAR_MODEL_VARIANT_RE);
  if (!m) return;
  const variant = document.createElement("span");
  variant.className = "sednar-model-variant";
  variant.textContent = m[2].trim();
  label.textContent = m[1] + " ";
  label.appendChild(variant);
}

function _sednarWatchModelLabelOnce() {
  const label = document.querySelector("#sednar-chat-composer [data-chatbot-model-label]");
  if (!label || label._sednarWatched) return;
  label._sednarWatched = true;
  _sednarStyleModelLabel(label);
  new MutationObserver(function() { _sednarStyleModelLabel(label); })
    .observe(label, { childList: true, characterData: true, subtree: true });
}

let _sednarModeSelectorBound = false;

window.initSednarModeSelector = function() {
  _sednarApplyChatModeToUI();
  _sednarWatchModelLabelOnce();
  if (!_sednarLlmSettings) _sednarLoadLlmSettings();
  if (_sednarModeSelectorBound) return;
  const trigger = document.querySelector("[data-sednar-mode-trigger]");
  if (!trigger) return;
  _sednarModeSelectorBound = true;
  _sednarEnsureModeDropdown();
  trigger.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.toggleSednarModeDropdown(trigger);
  });
  trigger.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      window.toggleSednarModeDropdown(trigger);
    }
  });
  if (!window._sednarModeDropdownGlobalBound) {
    window._sednarModeDropdownGlobalBound = true;
    document.addEventListener("click", function(e) {
      const dropdown = document.getElementById("sednar-chat-mode-dropdown");
      if (!dropdown || !dropdown.classList.contains("is-open")) return;
      if (e.target.closest("#sednar-chat-mode-dropdown") || e.target.closest("[data-sednar-mode-trigger]")) return;
      window.closeSednarModeDropdown();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") window.closeSednarModeDropdown();
    });
  }
};

(function() {
  let isResizingSidebar = false;
  let startX = 0;
  let startWidth = 0;
  let editorStartWidth = 0;
  let rafId = null;
  const EDITOR_MIN_WIDTH = 160;
  const divider = document.getElementById("ide-sidebar-divider");
  const handle = document.getElementById("ide-sidebar-divider-handle");
  const sidebar = document.getElementById("ide-sidebar");
  if (!divider || !sidebar) return;
  // Panel sizes are settings (explorerWidth, terminalHeight, chatPanelWidth), so they follow you to a new
  // browser profile; the old localStorage keys are read once when there is no setting yet.
  let savedSidebar = Number(_sednarSettingsGet("explorerWidth")) || 0;
  if (!savedSidebar) {
    try { savedSidebar = parseInt(localStorage.getItem("sednarSidebarWidth") || "", 10) || 0; } catch (e) {}
  }
  if (savedSidebar >= 150 && savedSidebar <= 700) sidebar.style.width = savedSidebar + "px";
  divider.onmousedown = function(e) {
    if (e.button !== 0) return;
    isResizingSidebar = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    const editorEl = document.getElementById("ide-main-container");
    editorStartWidth = editorEl ? editorEl.offsetWidth : 700;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    sidebar.style.transition = "none";
    e.preventDefault();
  };
  const handleSidebarMove = function(e) {
    if (!isResizingSidebar) return;
    if (rafId) cancelAnimationFrame(rafId);
    // Grow into the editor only while it keeps EDITOR_MIN_WIDTH.
    const room = startWidth + editorStartWidth - EDITOR_MIN_WIDTH;
    const newWidth = Math.max(150, Math.min(700, room, startWidth + (e.clientX - startX)));
    rafId = requestAnimationFrame(() => {
      sidebar.style.width = newWidth + "px";
      rafId = null;
    });
    e.preventDefault();
  };
  const stopSidebarResizing = function() {
    if (!isResizingSidebar) return;
    isResizingSidebar = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    sidebar.style.transition = "";
    _sednarSettingsSet("explorerWidth", sidebar.offsetWidth);
    if (window.ideEditor) {
      setTimeout(function() { try { window.ideEditor.layout(); } catch (_) {} }, 50);
    }
  };
  document.addEventListener("mousemove", handleSidebarMove, { passive: false });
  document.addEventListener("mouseup", stopSidebarResizing);
})();

(function() {
  let isResizingTerminal = false;
  let rafId = null;
  const divider = document.getElementById("ide-terminal-divider");
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const mainContainer = document.getElementById("ide-main-container");
  if (!divider || !terminalPanel || !mainContainer) return;
  divider.onmousedown = function(e) {
    if (e.button !== 0) return;
    isResizingTerminal = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    terminalPanel.style.transition = "none";
    e.preventDefault();
  };
  const handleTerminalMove = function(e) {
    if (!isResizingTerminal) return;
    if (rafId) cancelAnimationFrame(rafId);
    const containerRect = mainContainer.getBoundingClientRect();
    const mouseY = e.clientY - containerRect.top;
    const newHeight = Math.max(100, Math.min(containerRect.height - 100, containerRect.height - mouseY));
    rafId = requestAnimationFrame(() => {
      terminalPanel.style.height = newHeight + "px";
      if (ideFitAddon) try { ideFitAddon.fit(); } catch (e) {}
      rafId = null;
    });
    e.preventDefault();
  };
  const stopTerminalResizing = function() {
    if (!isResizingTerminal) return;
    isResizingTerminal = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    terminalPanel.style.transition = "";
    _sednarSettingsSet("terminalHeight", terminalPanel.offsetHeight);
  };
  document.addEventListener("mousemove", handleTerminalMove, { passive: false });
  document.addEventListener("mouseup", stopTerminalResizing);
})();

(function() {
  let isResizingAgent = false;
  let rafId = null;
  const SEDNAR_AGENT_DEFAULT_WIDTH = 420;
  const divider = document.getElementById("ide-agent-divider");
  const agentPanel = document.getElementById("sednar-agent-panel");
  if (!divider || !agentPanel) return;
  let agentWidth = SEDNAR_AGENT_DEFAULT_WIDTH;
  let savedAgent = Number(_sednarSettingsGet("chatPanelWidth")) || 0;
  if (!savedAgent) {
    try { savedAgent = parseInt(localStorage.getItem("sednarAgentWidth") || "", 10) || 0; } catch (e) {}
  }
  if (savedAgent >= 280) agentWidth = savedAgent;
  agentPanel.style.width = agentWidth + "px";
  window._sednarAgentDefaultWidthApplied = true;
  divider.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    isResizingAgent = true;
    const startX = e.clientX;
    const startW = agentPanel.offsetWidth;
    const editorEl = document.getElementById("ide-main-container");
    const editorStartW = editorEl ? editorEl.offsetWidth : 0;
    divider.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    agentPanel.style.transition = "none";
    function onMove(ev) {
      if (!isResizingAgent) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(function() {
        const w = startW - (ev.clientX - startX);
        // Grow into the editor only while it keeps 160px.
        const maxW = editorEl ? startW + editorStartW - 160 : 1000;
        agentPanel.style.width = Math.max(280, Math.min(maxW, w)) + "px";
        rafId = null;
      });
      ev.preventDefault();
    }
    function onUp() {
      if (!isResizingAgent) return;
      isResizingAgent = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      divider.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      agentPanel.style.transition = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      _sednarSettingsSet("chatPanelWidth", agentPanel.offsetWidth);
      if (window.ideEditor) {
        setTimeout(function() { try { window.ideEditor.layout(); } catch (_) {} }, 50);
      }
    }
    document.addEventListener("mousemove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
})();

(function() {
  const row = document.getElementById("ide-main-row");
  const bar = document.getElementById("ide-hscroll");
  const thumb = bar && bar.querySelector(".ide-hscroll-thumb");
  if (!row || !bar || !thumb) return;
  let frame = 0;
  let drag = null;
  function overflow() {
    if (getComputedStyle(row).overflowX === "hidden") return 0;
    return Math.max(0, row.scrollWidth - row.clientWidth);
  }
  function update() {
    frame = 0;
    const extra = overflow();
    bar.hidden = extra < 1;
    if (bar.hidden) return;
    const track = bar.clientWidth;
    const size = Math.max(24, Math.round(track * row.clientWidth / row.scrollWidth));
    thumb.style.width = size + "px";
    thumb.style.transform = "translateX(" + Math.round((track - size) * row.scrollLeft / extra) + "px)";
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  row.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(row);
    Array.from(row.children).forEach(function(child) { observer.observe(child); });
  }
  bar.addEventListener("pointerdown", function(e) {
    const extra = overflow();
    if (!extra || e.button > 0) return;
    const track = bar.getBoundingClientRect();
    const knob = thumb.getBoundingClientRect();
    const room = Math.max(1, track.width - knob.width);
    if (e.clientX < knob.left || e.clientX > knob.right) {
      const left = Math.min(Math.max(e.clientX - track.left - knob.width / 2, 0), room);
      row.scrollLeft = left / room * extra;
    }
    drag = { x: e.clientX, start: row.scrollLeft, ratio: extra / room };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("is-dragging");
    e.preventDefault();
  });
  bar.addEventListener("pointermove", function(e) {
    if (drag) row.scrollLeft = drag.start + (e.clientX - drag.x) * drag.ratio;
  });
  function endDrag() {
    drag = null;
    bar.classList.remove("is-dragging");
  }
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
  schedule();
})();


function _sednarOpenImageLightbox(src, title, info) {
  const modal = document.getElementById("sednarImageViewerModal");
  if (!modal) {
    window.open(src, "_blank", "noopener");
    return;
  }
  const img = document.getElementById("sednar-image-viewer-img");
  const name = document.getElementById("sednar-image-viewer-title");
  const size = document.getElementById("sednar-image-viewer-info");
  if (img) img.src = src;
  if (name) name.textContent = title || "";
  if (size) size.textContent = info || "";
  modal.style.display = "flex";
  requestAnimationFrame(function() { modal.classList.add("is-open"); });
}

if (typeof window.closeSednarImageViewer !== "function") {
  window.closeSednarImageViewer = function() {
    const modal = document.getElementById("sednarImageViewerModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.style.display = "none";
  };
}

// Images sent with a message open in the image viewer. Delegated from the
// document so restored chat sessions work too; captured and stopped so the
// click doesn't also expand or collapse a long message.
document.addEventListener("click", function(e) {
  const wrap = e.target && e.target.closest ? e.target.closest("#sednar-chat-messages .sednar-image-thumb-wrap") : null;
  const img = wrap && wrap.querySelector("img.sednar-image-thumb");
  if (!img || !img.getAttribute("src")) return;
  e.preventDefault();
  e.stopPropagation();
  const size = img.naturalWidth ? img.naturalWidth + " × " + img.naturalHeight : "";
  _sednarOpenImageLightbox(img.getAttribute("src"), img.getAttribute("alt") || "Image", size);
}, true);

document.addEventListener("keydown", function(e) {
  if (e.key !== "Escape") return;
  const modal = document.getElementById("sednarImageViewerModal");
  if (modal && modal.style.display !== "none" && modal.classList.contains("is-open")) window.closeSednarImageViewer();
});


const SEDNAR_SETTINGS_TAB_KEY = "sednar://settings";
const _SEDNAR_SETTINGS_TAB_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
);

const _SEDNAR_SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="6"></rect><circle cx="16" cy="12" r="2.5"></circle></svg>' },
  { id: "appearance", label: "Appearance", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r="1.2"></circle><circle cx="17.5" cy="10.5" r="1.2"></circle><circle cx="8.5" cy="7.5" r="1.2"></circle><circle cx="6.5" cy="12.5" r="1.2"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2c3 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z"></path></svg>' },
  { id: "agent", label: "Agent", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"></rect><path d="M12 8V4H8"></path><path d="M2 14h2M20 14h2M9 13v2M15 13v2"></path></svg>' },
  { id: "harness", label: "Harness", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.34 19a10 10 0 1 1 17.32 0"></path><path d="M12 14l4-4"></path></svg>' },
  { id: "plan", label: "Plan mode", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><rect x="9" y="3" width="6" height="4" rx="1"></rect><path d="M9 12l2 2 4-4"></path></svg>' },
  { id: "memory", label: "Memory", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2z"></path></svg>' },
  { id: "languages", label: "Languages", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6l-6 6 6 6"></path><path d="M16 6l6 6-6 6"></path><path d="M14 4l-4 16"></path></svg>' },
  { id: "models", label: "Models", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6" rx="1"></rect><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"></path></svg>' },
  { id: "terminal", label: "Terminal", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><polyline points="7 9 10 12 7 15"></polyline><line x1="12" y1="15" x2="16" y2="15"></line></svg>' },
  { id: "rules", label: "Rules", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12h-5M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path></svg>' },
  { id: "mcp", label: "MCP", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6"></path><path d="M6 8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"></path><path d="M12 17v5"></path></svg>' },
  { id: "indexing", label: "Indexing", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"></ellipse><path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"></path><path d="M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"></path></svg>' },
];

let _sednarSettingsSection = "general";
let _sednarSettingsRules = null;
let _sednarSettingsMcpExpanded = {};
let _sednarSettingsMcpFocus = "";

window.openSednarSettings = function(section) {
  if (section && _SEDNAR_SETTINGS_SECTIONS.some(function(s) { return s.id === section; })) {
    _sednarSettingsSection = section;
  }
  if (!ideOpenFiles[SEDNAR_SETTINGS_TAB_KEY]) {
    ideOpenFiles[SEDNAR_SETTINGS_TAB_KEY] = {
      isSettings: true,
      path: SEDNAR_SETTINGS_TAB_KEY,
      name: "Settings",
      content: "",
      originalContent: "",
      modified: false,
    };
  }
  toggleSednarMcpPanel(false);
  switchToFile(SEDNAR_SETTINGS_TAB_KEY);
  if (_sednarSettingsSection === "mcp" && !sednarMcpServers.length) refreshSednarMcpStatus({ probeServers: Array.from(sednarMcpSelectedServers) });
};

function _sednarShowSettingsSurface() {
  const view = document.getElementById("ide-settings-view");
  if (!view) return;
  ["ide-editor-placeholder", "ide-monaco", "ide-code-editor"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  _sednarHidePlanSurface();
  if (window.ideEditor) {
    try { window.ideEditor.setModel(null); } catch (e) {}
  }
  view.style.display = "flex";
  _sednarRenderSettings();
}

function _sednarHideSettingsSurface() {
  const view = document.getElementById("ide-settings-view");
  if (view) view.style.display = "none";
}

function _sednarSettingsVisible(section) {
  const view = document.getElementById("ide-settings-view");
  return !!(view && view.style.display !== "none" && (!section || _sednarSettingsSection === section));
}

function _sednarRenderSettings() {
  const view = document.getElementById("ide-settings-view");
  if (!view) return;
  _sednarBindSettingsOnce(view);
  const nav = _SEDNAR_SETTINGS_SECTIONS.map(function(s) {
    const active = s.id === _sednarSettingsSection && !String(window._sednarSettingsQuery || "").trim();
    return '<button type="button" class="sednar-settings-nav-item lc-btn' + (active ? " is-active" : "") + '" data-settings-section="' + s.id + '" title="' + s.label + '" aria-label="' + s.label + '"' + (active ? ' aria-current="page"' : "") + ">" +
      s.icon + "<span>" + s.label + "</span></button>";
  }).join("");
  const query = String(window._sednarSettingsQuery || "");
  const search = '<div class="sednar-settings-search"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
    '<input type="search" data-settings-search placeholder="Search settings" value="' + _sednarEscapeHtml(query).replace(/"/g, "&quot;") + '" aria-label="Search settings" spellcheck="false" autocomplete="off"></div>';
  const pageHtml = view.querySelector("#sednar-settings-page") ? view.querySelector("#sednar-settings-page").innerHTML : "";
  _sednarMorph(view,
    '<nav class="sednar-settings-nav" aria-label="Settings sections">' + search + nav + "</nav>" +
    '<div class="sednar-settings-main"><div class="sednar-settings-page" id="sednar-settings-page">' + pageHtml + "</div></div>");
  _sednarRenderSettingsPage();
}

function _sednarSettingsRenderers() {
  return {
    general: _sednarSettingsGeneralHtml,
    appearance: window._sednarSettingsAppearanceHtml,
    agent: _sednarSettingsAgentHtml,
    harness: window._sednarSettingsHarnessHtml,
    plan: window._sednarSettingsPlanHtml,
    memory: window._sednarSettingsMemoryHtml,
    languages: window._sednarSettingsLanguagesHtml,
    models: _sednarSettingsModelsHtml,
    terminal: _sednarSettingsTerminalHtml,
    rules: _sednarSettingsRulesHtml,
    mcp: _sednarSettingsMcpHtml,
    indexing: _sednarSettingsIndexingHtml,
    account: window._sednarSettingsAccountHtml,
  };
}

function _sednarRenderSettingsPage() {
  const page = document.getElementById("sednar-settings-page");
  if (!page) return;
  const main = page.parentElement;
  const keepScroll = main ? main.scrollTop : 0;
  const query = String(window._sednarSettingsQuery || "").trim();
  const render = query && window._sednarSettingsSearchHtml
    ? function() { return window._sednarSettingsSearchHtml(query); }
    : _sednarSettingsRenderers()[_sednarSettingsSection] || _sednarSettingsGeneralHtml;
  _sednarMorph(page, render());
  if (main && Math.abs(main.scrollTop - keepScroll) > 1) main.scrollTop = keepScroll;
  if (_sednarSettingsSection === "rules" && _sednarSettingsRules === null) _sednarLoadSettingsRules();
  if (_sednarSettingsSection === "mcp" && _sednarSettingsMcpFocus) {
    const card = page.querySelector('[data-mcp-card="' + CSS.escape(_sednarSettingsMcpFocus) + '"]');
    _sednarSettingsMcpFocus = "";
    if (card) {
      card.classList.add("is-focused");
      card.scrollIntoView({ block: "nearest" });
    }
  }
}

function _sednarSettingSwitchHtml(key, title, desc) {
  const on = !!_sednarSettingsGet(key);
  return '<div class="sednar-settings-row"><div class="sednar-settings-row-text"><div class="sednar-settings-row-title">' + title + "</div>" +
    (desc ? '<div class="sednar-settings-row-desc">' + desc + "</div>" : "") + "</div>" +
    '<label class="lc-switch"><input type="checkbox" data-setting="' + key + '"' + (on ? " checked" : "") + ' aria-label="' + _sednarEscapeHtml(title) + '"><span class="lc-switch-track"><span class="lc-switch-thumb"></span></span></label></div>';
}

function _sednarSettingsRowHtml(title, desc, controlHtml) {
  return '<div class="sednar-settings-row"><div class="sednar-settings-row-text"><div class="sednar-settings-row-title">' + title + "</div>" +
    (desc ? '<div class="sednar-settings-row-desc">' + desc + "</div>" : "") + "</div>" +
    '<div class="sednar-settings-row-control">' + (controlHtml || "") + "</div></div>";
}

function _sednarSettingsButton(label, action, extra, primary) {
  return '<button type="button" class="lc-btn sednar-settings-btn' + (primary ? " is-primary" : "") + '" data-settings-action="' + action + '"' + (extra || "") + ">" + label + "</button>";
}

function _sednarShortPath(path) {
  const p = String(path || "");
  const home = _sednarBrowserHomePath || "";
  if (home && home !== "~" && (p === home || p.indexOf(home + "/") === 0)) return "~" + p.slice(home.length);
  const m = p.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/);
  if (m) return "~" + (m[2] || "");
  return p;
}

function _sednarSettingsPathHtml(path, suffix) {
  const full = String(path || "");
  return '<span class="sednar-settings-path" title="' + _sednarEscapeHtml(full) + '">‎' +
    _sednarEscapeHtml(_sednarShortPath(full)) + (suffix ? _sednarEscapeHtml(suffix) : "") + "‎</span>";
}

function _sednarProjectDisplayName(path) {
  const name = String(path || "").split(/[\\/]/).filter(Boolean).pop() || String(path || "");
  return name.replace(/\.(sednar-workspace(\.json)?|code-workspace)$/i, "");
}

function _sednarSettingsGeneralHtml() {
  const project = sednarProjectPath;
  const folders = (sednarWorkspaceFolders || []).length;
  let html = '<h2 class="sednar-settings-h">General</h2><div class="sednar-settings-group">';
  html += _sednarSettingsRowHtml(
    "Project",
    project ? _sednarSettingsPathHtml(project) : "No project open",
    _sednarSettingsButton("Open…", "open-project") + _sednarSettingsButton("Clone…", "clone")
  );
  html += _sednarSettingsRowHtml(
    "Workspace folders",
    project ? folders + " folder" + (folders === 1 ? "" : "s") + (sednarWorkspacePath ? _sednarSettingsPathHtml(sednarWorkspacePath) : "") : "Open a project to add folders",
    project ? _sednarSettingsButton("Manage…", "workspace-manager") : ""
  );
  html += "</div>";
  html += '<h3 class="sednar-settings-subh">Folder browser</h3><div class="sednar-settings-group">';
  html += _sednarSettingSwitchHtml("showHiddenFiles", "Show hidden files", "List dotfiles and hidden folders when opening a project.");
  html += "</div>";
  const recents = getSednarRecentProjects();
  html += '<h3 class="sednar-settings-subh">Recent projects</h3><div class="sednar-settings-group">';
  if (!recents.length) {
    html += '<div class="sednar-settings-empty">Projects you open appear here.</div>';
  } else {
    html += recents.map(function(path) {
      const esc = _sednarEscapeHtml(path);
      const active = _sednarRecentEntryIsActive(path);
      return '<div class="sednar-settings-row is-compact"><button type="button" class="lc-btn sednar-settings-link-row" data-settings-action="open-recent" data-path="' + esc + '" title="' + esc + '">' +
        '<span class="sednar-settings-row-title">' + _sednarEscapeHtml(_sednarProjectDisplayName(path)) + (active ? ' <span class="sednar-settings-badge">Open</span>' : "") + "</span>" +
        '<span class="sednar-settings-row-desc">' + _sednarSettingsPathHtml(path) + "</span></button>" +
        '<button type="button" class="lc-btn sednar-settings-icon-btn" data-settings-action="remove-recent" data-path="' + esc + '" title="Remove from recents and delete its chats" aria-label="Remove ' + esc + '">' + _SEDNAR_QUEUE_ICONS.remove + "</button></div>";
    }).join("");
  }
  html += "</div>";
  if (typeof window._sednarSettingsGeneralExtraHtml === "function") html += window._sednarSettingsGeneralExtraHtml();
  return html;
}

function _sednarSettingsNumberHtml(key, title, desc, min, max, step, unit) {
  const value = Number(_sednarSettingsGet(key));
  return _sednarSettingsRowHtml(title, desc,
    '<input type="number" class="sednar-settings-number" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + _sednarEscapeHtml(String(value)) +
      '" data-setting-number="' + key + '" aria-label="' + _sednarEscapeHtml(title) + '">' + (unit ? " " + unit : ""));
}

function _sednarSettingsChoiceHtml(key, title, desc, choices) {
  const current = String(_sednarSettingsGet(key));
  const seg = choices.map(function(c) {
    return '<button type="button" class="lc-btn' + (c.value === current ? " is-active" : "") + '" data-settings-action="set-choice" data-setting-key="' + key + '" data-value="' + c.value + '" role="radio" aria-checked="' + (c.value === current) + '">' + c.label + "</button>";
  }).join("");
  return _sednarSettingsRowHtml(title, desc, '<div class="lc-segmented" role="radiogroup" aria-label="' + _sednarEscapeHtml(title) + '">' + seg + "</div>");
}

function _sednarSettingsTerminalHtml() {
  let html = '<h2 class="sednar-settings-h">Terminal</h2><div class="sednar-settings-group">';
  html += _sednarSettingsNumberHtml("terminalFontSize", "Font size", "Text size in the terminal.", 9, 32, 1, "px");
  html += _sednarSettingsChoiceHtml("terminalCursorStyle", "Cursor", "Shape of the terminal cursor.",
    [{ value: "bar", label: "Bar" }, { value: "block", label: "Block" }, { value: "underline", label: "Underline" }]);
  html += _sednarSettingSwitchHtml("terminalCursorBlink", "Blinking cursor", "Blink the cursor while the terminal has focus.");
  html += _sednarSettingsNumberHtml("terminalScrollback", "Scrollback", "Lines the terminal keeps above the screen.", 100, 100000, 100, "lines");
  html += "</div>";
  return html;
}

function _sednarSettingsAgentHtml() {
  const mode = window.sednarChatMode || "agent";
  const seg = SEDNAR_CHAT_MODES.map(function(m) {
    return '<button type="button" class="lc-btn' + (m.value === mode ? " is-active" : "") + '" data-settings-action="set-mode" data-mode="' + m.value + '" role="radio" aria-checked="' + (m.value === mode) + '">' + m.label + "</button>";
  }).join("");
  let html = '<h2 class="sednar-settings-h">Agent</h2><div class="sednar-settings-group">';
  html += _sednarSettingsRowHtml("Default mode", "Agent edits and runs commands, Plan writes a plan first, Ask only reads.", '<div class="lc-segmented" role="radiogroup" aria-label="Default mode">' + seg + "</div>");
  html += _sednarSettingSwitchHtml("requireApproval", "Ask before edits, commands, and MCP tools", "The agent waits for your approval before it writes a file, runs a command, or calls an MCP tool. Destructive commands (rm -rf, git reset --hard, force push) always ask.");
  html += _sednarSettingSwitchHtml("webTools", "Web search and fetch", "Let the agent search the web and read pages. It can always do this when you ask for it in your message.");
  html += "</div>";
  html += '<h3 class="sednar-settings-subh">More agent settings</h3><div class="sednar-settings-group">';
  html += _sednarSettingsRowHtml("Display and limits", "Conversation display is under Appearance, and step limits, retries and safety rails under Harness.",
    _sednarSettingsButton("Harness", "goto-section", ' data-section="harness"'));
  html += "</div>";
  html += '<h3 class="sednar-settings-subh">Queued messages</h3><div class="sednar-settings-group">';
  html += _sednarSettingSwitchHtml("autoRunQueue", "Run queued messages automatically", "Messages you send while the agent works start one after another when each turn ends. Turn off to send each one yourself.");
  html += _sednarSettingsRowHtml("Keys", "Enter queues a message while the agent works · ⌘/Ctrl+Enter stops the turn and sends it now · Stop pauses the queue.", "");
  html += "</div>";
  if (typeof window._sednarSettingsAgentExtraHtml === "function") html += window._sednarSettingsAgentExtraHtml();
  return html;
}

let _sednarLlmSettings = null;
let _sednarLlmSettingsLoading = false;

function _sednarLoadLlmSettings() {
  if (_sednarLlmSettingsLoading) return;
  _sednarLlmSettingsLoading = true;
  fetch("/sednar/llm/settings").then(function(r) { return r.json(); }).then(function(data) {
    if (data && data.success) _sednarLlmSettings = data;
  }).catch(function() {}).finally(function() {
    _sednarLlmSettingsLoading = false;
    _sednarSyncComposerModels();
    if (_sednarSettingsVisible("models")) _sednarRenderSettingsPage();
  });
}

function _sednarSaveLlmSettings(payload, toast) {
  return fetch("/sednar/llm/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data.success) throw new Error((data && data.error) || "Could not save");
      _sednarLlmSettings = data;
      _sednarSyncComposerModels();
      if (toast) _sednarShowIdeToast(toast);
      if (_sednarSettingsVisible("models")) _sednarRenderSettingsPage();
      return data;
    })
    .catch(function(err) { _sednarShowIdeToast(err.message || String(err)); });
}

function _sednarChatModel() {
  if (_sednarLlmSettings && _sednarLlmSettings.best_auto) return "auto";
  return typeof window.getSednarAiModel === "function" ? window.getSednarAiModel() : undefined;
}

// Composer dropdown: Auto plus the selected provider's models.
function _sednarSyncComposerModels() {
  document.body.classList.toggle("sednar-best-auto", !!(_sednarLlmSettings && _sednarLlmSettings.best_auto));
  const models = (_sednarLlmSettings && _sednarLlmSettings.models) || [];
  window.SEDNAR_MODEL_OPTIONS = [{ value: "auto", label: "Auto" }].concat(models.map(function(m) {
    return { value: m.value, label: m.label + (m.vision === false ? " (text)" : "") };
  }));
  const current = typeof window.getSednarAiModel === "function" ? window.getSednarAiModel() : "auto";
  const known = window.SEDNAR_MODEL_OPTIONS.some(function(o) { return o.value === current; });
  if (!known && typeof window.setChatbotModelValue === "function") window.setChatbotModelValue("auto");
  else if (typeof window.initChatbotModelSelectors === "function") window.initChatbotModelSelectors();
}

function _sednarSettingsModelsHtml() {
  if (!_sednarLlmSettings) _sednarLoadLlmSettings();
  const st = _sednarLlmSettings;
  const tab = _sednarGetActiveChatTab();
  const used = tab ? Number(tab.contextUsed || 0) : 0;
  const limit = tab ? Number(tab.contextLimit || 0) : 0;
  const cost = tab ? Number(tab.costUsd || 0) : 0;
  let html = '<h2 class="sednar-settings-h">Models</h2>';
  if (!st) return html + '<div class="sednar-settings-group"><div class="sednar-settings-empty">Loading model settings…</div></div>';

  const bestToggle = '<label class="lc-switch"><input type="checkbox" data-llm-toggle="best_auto"' + (st.best_auto ? " checked" : "") +
    ' aria-label="Best model auto pick"><span class="lc-switch-track"><span class="lc-switch-thumb"></span></span></label>';
  const labelOf = function(value) {
    if (!value) return "none";
    const i = value.indexOf(":");
    const p = i > 0 ? _sednarLlmProvider(value.slice(0, i)) : null;
    return _sednarEscapeHtml((p && p.label ? p.label + " · " : "") + value.slice(i + 1));
  };
  html += '<div class="sednar-settings-group">';
  html += _sednarSettingsRowHtml("Best model auto pick", "Picks the best model from every provider with a key, and hides the model menu in chat.", bestToggle);
  html += "</div>";

  // One row per provider: key status, key buttons, and which one chat uses.
  html += '<h3 class="sednar-settings-subh">Providers</h3><div class="sednar-settings-group">';
  st.providers.forEach(function(p) {
    const isDefault = !st.best_auto && p.id === st.provider && p.configured;
    let ctl = "";
    if (!st.best_auto && p.configured && !isDefault) ctl += _sednarSettingsButton("Make default", "llm-default", ' data-provider="' + p.id + '"');
    ctl += _sednarSettingsButton(p.configured ? "Change key…" : "Add key…", "llm-key", ' data-provider="' + p.id + '"');
    if (p.configured) ctl += _sednarSettingsButton("Remove", "llm-clear", ' data-provider="' + p.id + '"');
    const title = _sednarEscapeHtml(p.label) + (isDefault ? ' <span class="sednar-settings-badge">Default</span>' : "");
    html += _sednarSettingsRowHtml(title, p.configured ? "Key saved (" + _sednarEscapeHtml(p.key_preview) + ")" : "No key", ctl);
  });
  html += "</div>";

  if (st.best_auto) {
    if (st.large_model) {
      html += '<div class="sednar-settings-group">' + _sednarSettingsRowHtml("Auto picks",
        "Hard tasks: " + labelOf(st.large_model) + ". Quick tasks: " + labelOf(st.fast_model) + ".",
        _sednarSettingsButton("Test", "llm-test")) + "</div>";
    }
  } else if (st.models.length && st.providers.some(function(p) { return p.id === st.provider && p.configured; })) {
    const names = st.models.map(function(m) { return _sednarEscapeHtml(m.label) + (m.vision === false ? " (text only)" : ""); }).join(", ");
    const byId = function(id) {
      const bare = String(id || "").replace(/^[a-z]+:/, "");
      const m = st.models.find(function(x) { return x.id === id || x.id === bare; });
      return m ? _sednarEscapeHtml(m.label) : labelOf(id);
    };
    let desc = names + ". Auto uses " + byId(st.large_model) + " for hard tasks and " + byId(st.fast_model) + " for quick ones";
    if (st.code_model && st.code_model !== st.fast_model) desc += ", and " + byId(st.code_model) + " for code changes";
    desc += ".";
    if (st.models.some(function(m) { return m.vision === false; })) {
      desc += st.image_model
        ? " Requests with images go to a model that reads them; a text-only model you pick gets them described by " + byId(st.image_model) + "."
        : " No model here reads images, so image attachments need a key for a provider whose models do.";
    }
    html += '<div class="sednar-settings-group">' + _sednarSettingsRowHtml("Chat models", desc,
      _sednarSettingsButton("Test", "llm-test")) + "</div>";
  } else {
    html += '<div class="sednar-settings-group"><div class="sednar-settings-empty">Add a key to a provider above to start chatting.</div></div>';
  }

  html += '<h3 class="sednar-settings-subh">This chat</h3><div class="sednar-settings-group">';
  html += _sednarSettingsRowHtml("Context", limit ? used.toLocaleString() + " of " + limit.toLocaleString() + " tokens (" + Math.round((used / limit) * 100) + "%)" : "Shown after the first reply.", "");
  html += _sednarSettingsRowHtml("Cost", cost > 0 ? "$" + cost.toFixed(cost < 0.01 ? 4 : 2) + " estimated" : "No usage yet.", "");
  html += "</div>";
  return html;
}

function _sednarLlmProvider(id) {
  return ((_sednarLlmSettings && _sednarLlmSettings.providers) || []).find(function(p) { return p.id === id; }) || { id: id, label: id };
}

function _sednarHandleLlmAction(action, btn) {
  const pid = btn.getAttribute("data-provider") || "";
  const p = _sednarLlmProvider(pid);
  if (action === "llm-key") {
    _sednarModalPrompt({
      title: p.label + " API key",
      message: (p.key_url ? "Get a key at " + p.key_url + ". " : "") + "It is saved on this computer, readable only by you.",
      placeholder: p.key_hint || "API key",
      inputType: "password",
      confirmText: "Save key",
    }).then(function(key) {
      if (key == null || !String(key).trim()) return;
      _sednarShowIdeToast("Checking key…");
      _sednarSaveLlmSettings({ provider: pid, api_key: String(key).trim() }, p.label + " key saved");
    });
  } else if (action === "llm-default") {
    _sednarSaveLlmSettings({ provider: pid }, "Chat now uses " + p.label);
  } else if (action === "llm-clear") {
    _sednarModalConfirm({ title: "Remove the " + p.label + " key?", message: "Chats can no longer use its models until you add a key again.", confirmText: "Remove", danger: true }).then(function(ok) {
      if (ok) _sednarSaveLlmSettings({ provider: pid, clear: true }, p.label + " key removed");
    });
  } else if (action === "llm-test") {
    const model = _sednarChatModel() || "auto";
    _sednarShowIdeToast("Testing " + model + "…");
    fetch("/sednar/llm/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model }) })
      .then(function(r) { return r.json(); })
      .then(function(data) { _sednarShowIdeToast(data && data.success ? "Model replied: " + (data.reply || "(empty)") : "Test failed: " + ((data && data.error) || "unknown error")); })
      .catch(function(err) { _sednarShowIdeToast("Test failed: " + (err.message || err)); });
  }
}

function _sednarSettingsRulesHtml() {
  let html = '<h2 class="sednar-settings-h">Rules</h2><p class="sednar-settings-lead">The agent reads AGENTS.md, CLAUDE.md, and .claude/rules/*.md from the project (and parent folders up to the git root) at the start of every turn.</p><div class="sednar-settings-group">';
  if (!sednarProjectPath) {
    html += '<div class="sednar-settings-empty">Open a project to see its rules.</div>';
  } else if (_sednarSettingsRules === null) {
    html += '<div class="sednar-settings-empty">Looking for rule files…</div>';
  } else if (!_sednarSettingsRules.length) {
    html += _sednarSettingsRowHtml("No rule files", "Add AGENTS.md to tell the agent how to build, test, and style code in this project.", _sednarSettingsButton("Create AGENTS.md", "create-rule", "", true));
  } else {
    html += _sednarSettingsRules.map(function(rule) {
      const esc = _sednarEscapeHtml(rule.path);
      return _sednarSettingsRowHtml(
        _sednarEscapeHtml(rule.name),
        _sednarSettingsPathHtml(rule.path) + Number(rule.chars || 0).toLocaleString() + " characters",
        _sednarSettingsButton("Open", "open-file", ' data-path="' + esc + '"')
      );
    }).join("");
  }
  html += "</div>";
  return html;
}

function _sednarLoadSettingsRules() {
  if (!sednarProjectPath) return;
  fetch("/sednar/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: sednarProjectPath, workspace: _sednarCurrentWorkspacePayload() }),
  }).then(function(resp) { return resp.json(); }).then(function(data) {
    _sednarSettingsRules = data && data.success ? (data.files || []) : [];
  }).catch(function() {
    _sednarSettingsRules = [];
  }).finally(function() {
    if (_sednarSettingsVisible("rules")) _sednarRenderSettingsPage();
  });
}

const _SEDNAR_EXT_NAMES = {
  ".py": "Python", ".pyi": "Python stubs", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JSX",
  ".ts": "TypeScript", ".tsx": "TSX", ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".json": "JSON", ".md": "Markdown",
  ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".sh": "Shell", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".kt": "Kotlin", ".swift": "Swift", ".rb": "Ruby", ".php": "PHP", ".c": "C", ".h": "C header", ".cpp": "C++",
  ".cs": "C#", ".sql": "SQL", ".svg": "SVG", ".png": "PNG", ".jpg": "JPEG", ".txt": "Text", "(no ext)": "No extension",
};

function _sednarFormatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + " GB";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

function _sednarTimeAgo(epochSeconds) {
  const t = Number(epochSeconds) || 0;
  if (!t) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

// Label, a bar for its share of the largest, and the count.
function _sednarIndexBarsHtml(entries, labelOf, unit) {
  const max = entries.reduce(function(m, e) { return Math.max(m, e[1]); }, 0) || 1;
  return '<div class="sednar-index-bars">' + entries.map(function(e) {
    return '<div class="sednar-index-bar-row"><span class="sednar-index-bar-label">' + labelOf(e[0]) + "</span>" +
      '<span class="sednar-index-bar"><span style="width:' + Math.max(2, Math.round((e[1] / max) * 100)) + '%"></span></span>' +
      '<span class="sednar-index-bar-num">' + Number(e[1]).toLocaleString() + (unit ? " " + unit : "") + "</span></div>";
  }).join("") + "</div>";
}

function _sednarSettingsIndexingHtml() {
  const esc = _sednarEscapeHtml;
  let html = '<h2 class="sednar-settings-h">Indexing</h2><p class="sednar-settings-lead">The codebase index powers file search, symbol lookup, and the project layout the agent sees. It updates as files change.</p>';
  const count = function(n, noun) { return Number(n).toLocaleString() + " " + noun + (n === 1 ? "" : "s"); };
  if (!sednarProjectPath) return html + '<div class="sednar-settings-group"><div class="sednar-settings-empty">Open a project to index it.</div></div>';
  const d = sednarIndexDetails;
  const reindex = _sednarSettingsButton(sednarIndexReady ? "Re-index" : "Indexing…", "reindex", sednarIndexReady ? "" : " disabled");

  // Summary: the totals, and when it last ran.
  let stats = '<div class="sednar-index-stats">' +
    '<div><strong>' + (sednarIndexReady ? Number(sednarIndexFileCount).toLocaleString() : "…") + "</strong><span>files</span></div>" +
    '<div><strong>' + (sednarIndexReady ? Number(sednarIndexSymbolCount).toLocaleString() : "…") + "</strong><span>symbols</span></div>" +
    '<div><strong>' + (d ? _sednarFormatBytes(d.total_bytes) : "…") + "</strong><span>indexed</span></div></div>";
  let sub = !sednarIndexReady ? "Indexing…" : d && d.indexed_at ? "Updated " + _sednarTimeAgo(d.indexed_at) : "";
  if (sednarIndexTruncated && d) sub += (sub ? " · " : "") + "Large project: the file list stops at " + Number(d.max_files).toLocaleString() + " files; search still covers everything.";
  html += '<div class="sednar-settings-group sednar-index-summary"><div class="sednar-index-summary-main">' + stats +
    (sub ? '<div class="sednar-index-sub">' + esc(sub) + "</div>" : "") + "</div>" + reindex + "</div>";
  if (!d) return html;

  const extEntries = Array.isArray(d.ext_counts) ? d.ext_counts : [];
  if (extEntries.length) {
    html += '<h3 class="sednar-settings-subh">File types</h3><div class="sednar-settings-group sednar-index-group">' +
      _sednarIndexBarsHtml(extEntries, function(ext) { return esc(_SEDNAR_EXT_NAMES[ext] || ext); }, "") + "</div>";
  }
  const dirEntries = Array.isArray(d.dir_counts) ? d.dir_counts : [];
  if (dirEntries.length) {
    html += '<h3 class="sednar-settings-subh">Folders</h3><div class="sednar-settings-group sednar-index-group">' +
      _sednarIndexBarsHtml(dirEntries, function(dir) { return dir ? '<span class="sednar-index-mono">' + esc(dir) + "</span>" : "Project root"; }, "") + "</div>";
  }
  const symEntries = Array.isArray(d.symbol_languages) ? d.symbol_languages : [];
  html += '<h3 class="sednar-settings-subh">Symbols</h3><div class="sednar-settings-group sednar-index-group">' +
    '<p class="sednar-index-note">Functions, classes and methods in Python, JavaScript and TypeScript files, for go-to-symbol and find references.</p>' +
    (symEntries.length ? _sednarIndexBarsHtml(symEntries, function(ext) { return esc(_SEDNAR_EXT_NAMES[ext] || ext); }, "") : "") + "</div>";

  if (sednarIndexFolders.length > 1) {
    html += '<h3 class="sednar-settings-subh">Workspace folders</h3><div class="sednar-settings-group">' + sednarIndexFolders.map(function(f) {
      return _sednarSettingsRowHtml(esc(f.name), _sednarSettingsPathHtml(f.path) + count(f.file_count || 0, "file") + " · " + count(f.symbol_count || 0, "symbol") + (f.truncated ? " · capped" : ""), "");
    }).join("") + "</div>";
  }

  html += '<h3 class="sednar-settings-subh">Not indexed</h3><div class="sednar-settings-group sednar-index-group"><p class="sednar-index-note">' +
    "Anything your .gitignore excludes, hidden folders, " + esc((d.skip_dirs || []).filter(function(n) { return n.charAt(0) !== "."; }).join(", ")) +
    ", compiled and archive files, and files over " + _sednarFormatBytes(d.max_file_bytes) + ".</p></div>";
  return html;
}

const SEDNAR_MCP_DISABLED_TOOLS_PREFIX = "sednar_mcp_disabled_tools_v1:";
const _SEDNAR_MCP_CHIP_LIMIT = 24;

function _sednarMcpDisabledToolsKey() {
  const identity = _sednarMcpWorkspaceIdentity();
  return identity ? SEDNAR_MCP_DISABLED_TOOLS_PREFIX + identity : "";
}

function _sednarMcpDisabledTools() {
  const key = _sednarMcpDisabledToolsKey();
  if (!key) return {};
  try {
    const parsed = JSON.parse(_sednarStorageGet(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function _sednarSaveMcpDisabledTools(map) {
  const key = _sednarMcpDisabledToolsKey();
  if (!key) return;
  const clean = {};
  Object.keys(map || {}).forEach(function(server) {
    const tools = (map[server] || []).filter(Boolean);
    if (tools.length) clean[server] = tools;
  });
  if (Object.keys(clean).length) _sednarStorageSet(key, JSON.stringify(clean));
  else _sednarStorageRemove(key);
}

function _sednarMcpDisabledToolsForRequest() {
  const map = _sednarMcpDisabledTools();
  const out = {};
  sednarMcpSelectedServers.forEach(function(server) {
    if (map[server] && map[server].length) out[server] = map[server].slice();
  });
  return Object.keys(out).length ? out : undefined;
}

function _sednarToggleMcpTool(server, tool) {
  const map = _sednarMcpDisabledTools();
  const list = map[server] || [];
  const index = list.indexOf(tool);
  if (index >= 0) list.splice(index, 1);
  else list.push(tool);
  map[server] = list;
  _sednarSaveMcpDisabledTools(map);
}

function _sednarMcpServerState(server) {
  if (server.config_disabled) return "disabled";
  if (!sednarMcpSelectedServers.has(server.name)) return "off";
  if (server.error) return "error";
  return server.connected ? "ok" : "pending";
}

function _sednarMcpStateLabel(server, state) {
  const tools = Number(server.tool_count || 0);
  if (state === "disabled") return "Disabled in config";
  if (state === "off") return tools ? tools + " tools · off" : "Off";
  if (state === "error") return "Error";
  if (state === "pending") return "Connecting…";
  return tools === 1 ? "1 tool" : tools + " tools";
}

function _sednarMcpSourceLabel(server) {
  if (server.builtin) return "Built in";
  const path = _sednarShortPath(server.config_path || "");
  const where = server.source === "project" && server.folder_name ? server.folder_name + " · " : "";
  return where + path;
}

function _sednarMcpServerCardHtml(server) {
  const name = String(server.name || "");
  const esc = _sednarEscapeHtml(name);
  const state = _sednarMcpServerState(server);
  const enabled = sednarMcpSelectedServers.has(name);
  const off = new Set((_sednarMcpDisabledTools()[name]) || []);
  const tools = Array.isArray(server.tools) ? server.tools : [];
  const expanded = !!_sednarSettingsMcpExpanded[name];
  const shown = expanded ? tools : tools.slice(0, _SEDNAR_MCP_CHIP_LIMIT);
  let chips = shown.map(function(tool) {
    const toolName = String(tool.name || "");
    const isOff = off.has(toolName);
    const tip = (isOff ? "Turned off · click to turn on" : "Click to turn off") + (tool.description ? " — " + tool.description : "");
    return '<button type="button" class="lc-btn sednar-mcp-chip' + (isOff ? " is-off" : "") + '" data-settings-action="mcp-tool" data-server="' + esc + '" data-tool="' + _sednarEscapeHtml(toolName) + '" title="' + _sednarEscapeHtml(tip) + '" aria-pressed="' + (!isOff) + '">' + _sednarEscapeHtml(toolName) + "</button>";
  }).join("");
  if (tools.length > shown.length) {
    chips += '<button type="button" class="lc-btn sednar-mcp-chip is-more" data-settings-action="mcp-more" data-server="' + esc + '">+' + (tools.length - shown.length) + " more</button>";
  }
  const offCount = tools.filter(function(t) { return off.has(String(t.name || "")); }).length;
  const endpointText = server.transport === "stdio" ? (server.command_line || server.command || "") : (server.url || "");
  const endpoint = '<div class="sednar-mcp-card-line"><span class="sednar-mcp-card-key">' +
    (server.transport === "stdio" ? "Command" : _sednarEscapeHtml(String(server.transport || "http").toUpperCase())) +
    '</span><code title="' + _sednarEscapeHtml(endpointText) + '">' + _sednarEscapeHtml(endpointText) + "</code></div>";
  const source = server.builtin
    ? "<span>Built in</span>"
    : _sednarSettingsPathHtml(server.config_path || "", server.source === "project" && server.folder_name ? " · " + server.folder_name : "");
  const error = server.error && state === "error"
    ? '<div class="sednar-mcp-card-error"><div class="sednar-mcp-card-error-text">' + _sednarEscapeHtml(String(server.error).slice(0, 600)) + "</div>" +
      (server.hint ? '<div class="sednar-mcp-card-hint">' + _sednarEscapeHtml(server.hint) + "</div>" : "") +
      '<button type="button" class="lc-btn sednar-settings-link" data-settings-action="mcp-copy" data-server="' + esc + '">Copy diagnostics</button></div>'
    : "";
  const toolsBlock = tools.length
    ? '<div class="sednar-mcp-card-tools"><span class="sednar-mcp-card-key">Tools' + (offCount ? " · " + offCount + " off" : "") + '</span><div class="sednar-mcp-chips">' + chips + "</div></div>"
    : (state === "off" ? '<div class="sednar-mcp-card-note">Turn the server on to load its tools.</div>' : "");
  return '<div class="sednar-mcp-card is-' + state + '" data-mcp-card="' + esc + '">' +
    '<div class="sednar-mcp-card-head">' +
      '<span class="sednar-mcp-dot is-' + state + '" aria-hidden="true"></span>' +
      '<span class="sednar-mcp-card-name">' + _sednarEscapeHtml(_sednarMcpDisplayName(name)) + "</span>" +
      '<span class="sednar-mcp-card-state">' + _sednarEscapeHtml(_sednarMcpStateLabel(server, state)) + "</span>" +
      '<span class="sednar-mcp-card-actions">' +
        '<label class="lc-switch" title="' + (server.config_disabled ? "Disabled in its config file" : (enabled ? "Turn off" : "Turn on")) + '"><input type="checkbox" data-mcp-toggle="' + esc + '"' + (enabled ? " checked" : "") + (server.config_disabled ? " disabled" : "") + ' aria-label="Use ' + esc + '"><span class="lc-switch-track"><span class="lc-switch-thumb"></span></span></label>' +
        '<button type="button" class="lc-btn sednar-settings-icon-btn" data-settings-action="mcp-restart" data-server="' + esc + '" title="Reconnect" aria-label="Reconnect ' + esc + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.9L4 8.5"></path><path d="M4 4v4.5h4.5"></path><path d="M4 13a8 8 0 0 0 14.9 3.9l1.1-1.4"></path><path d="M20 20v-4.5h-4.5"></path></svg></button>' +
        (server.config_path && !server.builtin ? '<button type="button" class="lc-btn sednar-settings-icon-btn" data-settings-action="mcp-edit" data-server="' + esc + '" title="Edit its config file" aria-label="Edit ' + esc + ' config"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>' : "") +
        (server.editable ? '<button type="button" class="lc-btn sednar-settings-icon-btn" data-settings-action="mcp-remove" data-server="' + esc + '" title="Remove" aria-label="Remove ' + esc + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg></button>' : "") +
      "</span>" +
    "</div>" +
    '<div class="sednar-mcp-card-body">' + toolsBlock + endpoint +
      '<div class="sednar-mcp-card-line is-muted"><span class="sednar-mcp-card-key">Source</span>' + source + "</div>" +
      error +
    "</div></div>";
}

function _sednarSettingsMcpHtml() {
  let html = '<div class="sednar-settings-head-row"><h2 class="sednar-settings-h">MCP Servers</h2><div class="sednar-settings-head-actions">' +
    _sednarSettingsButton("Refresh", "mcp-refresh") +
    _sednarSettingsButton('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add new MCP server', "mcp-add", "", true) +
    "</div></div>" +
    '<p class="sednar-settings-lead">Model Context Protocol servers give the agent more tools. Turn a server on to offer its tools to the agent, and click a tool to turn it off. Servers are read from .mcp.json and .vscode/mcp.json in the project, and from ~/.claude.json, and Sednar\'s own config.</p>';
  if (!sednarProjectPath) {
    return html + '<div class="sednar-settings-group"><div class="sednar-settings-empty">Open a project to manage its MCP servers.</div></div>';
  }
  const servers = sednarMcpServers || [];
  if (!servers.length) {
    return html + '<div class="sednar-settings-group"><div class="sednar-settings-empty">Loading MCP servers…</div></div>';
  }
  return html + '<div class="sednar-mcp-cards">' + servers.map(_sednarMcpServerCardHtml).join("") + "</div>";
}

function _sednarRefreshSettingsMcpIfVisible() {
  if (_sednarSettingsVisible("mcp")) _sednarRenderSettingsPage();
}

function _sednarSetMcpServerEnabled(name, enabled) {
  if (!name) return;
  if (enabled) sednarMcpSelectedServers.add(name);
  else sednarMcpSelectedServers.delete(name);
  _sednarPersistMcpSelection();
  _sednarUpdateMcpToggle();
  _sednarRenderMcpServers();
  if (enabled) refreshSednarMcpStatus({ probeServers: Array.from(sednarMcpSelectedServers), preserveList: true });
}

async function _sednarMcpServerRequest(path, body) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({
      project_path: _sednarWorkspaceRefForMcp(),
      workspace: _sednarCurrentWorkspacePayload(),
      enabled_servers: Array.from(sednarMcpSelectedServers),
    }, body || {})),
  });
  const payload = await resp.json().catch(function() { return {}; });
  if (!resp.ok || !payload.success) throw new Error(payload.error || "Request failed (HTTP " + resp.status + ")");
  if (payload.status) _sednarApplyMcpStatusPayload(payload.status);
  return payload;
}

async function _sednarRemoveMcpServer(name) {
  const ok = await _sednarModalConfirm({ title: "Remove " + name + "?", message: "It is deleted from its config file.", confirmText: "Remove", danger: true });
  if (!ok) return;
  try {
    await _sednarMcpServerRequest("/sednar-mcp/servers/remove", { name: name });
    sednarMcpSelectedServers.delete(name);
    _sednarPersistMcpSelection();
    _sednarShowIdeToast("Removed " + name);
  } catch (err) {
    _sednarShowIdeToast(err.message || String(err));
  }
  _sednarRenderMcpServers();
}

function _sednarBindSettingsOnce(view) {
  if (view._sednarSettingsBound) return;
  view._sednarSettingsBound = true;
  view.addEventListener("keydown", function(e) {
    const input = e.target;
    if (e.key !== "Escape" || !input || !input.hasAttribute || !input.hasAttribute("data-settings-search") || !input.value) return;
    e.stopPropagation();
    input.value = "";
    window._sednarSettingsQuery = "";
    _sednarRenderSettings();
  });
  view.addEventListener("click", function(e) {
    const sectionBtn = e.target.closest ? e.target.closest("[data-settings-section]") : null;
    if (sectionBtn) {
      e.preventDefault();
      window._sednarSettingsQuery = "";
      _sednarSettingsSection = sectionBtn.getAttribute("data-settings-section");
      if (_sednarSettingsSection === "rules") _sednarSettingsRules = null;
      _sednarRenderSettings();
      if (_sednarSettingsSection === "mcp") refreshSednarMcpStatus({ probeServers: Array.from(sednarMcpSelectedServers), preserveList: true });
      return;
    }
    const btn = e.target.closest ? e.target.closest("[data-settings-action]") : null;
    if (!btn) return;
    e.preventDefault();
    const action = btn.getAttribute("data-settings-action");
    const path = btn.getAttribute("data-path") || "";
    const server = btn.getAttribute("data-server") || "";
    if (typeof window._sednarHandleSettingsActionExt === "function" && window._sednarHandleSettingsActionExt(action, btn)) return;
    if (action === "open-project") openSednarProjectBrowser();
    else if (action === "clone") openSednarCloneDialog();
    else if (action === "workspace-manager") openSednarWorkspaceManager();
    else if (action === "open-recent" && path) {
      _sednarOpenProjectOrWorkspace(path);
      setTimeout(_sednarRenderSettingsPage, 300);
    } else if (action === "remove-recent" && path) {
      _sednarModalConfirm({ title: "Remove " + _sednarProjectDisplayName(path) + " from recents?", message: "Its saved chats and memory are deleted too. Files in the folder are not touched.", confirmText: "Remove", danger: true }).then(function(ok) {
        if (!ok) return;
        removeSednarRecentProject(path);
        _sednarRenderSettingsPage();
      });
    } else if (action === "goto-section") {
      window._sednarSettingsQuery = "";
      _sednarSettingsSection = btn.getAttribute("data-section") || "general";
      _sednarRenderSettings();
    } else if (action === "set-mode") {
      const mode = btn.getAttribute("data-mode") || "agent";
      window.sednarChatMode = mode;
      try { localStorage.setItem(SEDNAR_CHAT_MODE_STORAGE_KEY, mode); } catch (err) {}
      _sednarApplyChatModeToUI();
      _sednarRenderSettingsPage();
    } else if (action === "set-choice") {
      _sednarSettingsSet(btn.getAttribute("data-setting-key"), btn.getAttribute("data-value"));
      _sednarRenderSettingsPage();
    } else if (action === "set-density") {
      _sednarSettingsSet("conversationDensity", btn.getAttribute("data-density") || "detailed");
      _sednarApplyConversationDensity();
      _sednarRenderSettingsPage();
    } else if (action === "set-step-grouping") {
      _sednarSettingsSet("stepGrouping", btn.getAttribute("data-grouping") || "grouped");
      _sednarApplyConversationDensity();
      _sednarRenderSettingsPage();
    } else if (action.indexOf("llm-") === 0) {
      _sednarHandleLlmAction(action, btn);
    } else if (action === "change-model") {
      const trigger = document.querySelector("[data-chatbot-model-trigger]");
      if (trigger) trigger.click();
    } else if (action === "open-file" && path) {
      openFileInEditorFromPath(path);
    } else if (action === "create-rule") {
      fetch("/sednar/rules/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_path: sednarProjectPath }) })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (!data || !data.success) throw new Error((data && data.error) || "Could not create AGENTS.md");
          _sednarSettingsRules = null;
          _sednarScheduleSilentTreeRefresh();
          openFileInEditorFromPath(data.path);
        })
        .catch(function(err) { _sednarShowIdeToast(err.message || String(err)); });
    } else if (action === "reindex") {
      btn.disabled = true;
      btn.textContent = "Indexing…";
      sednarIndexReady = false;
      fetch("/sednar/index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_path: sednarProjectPath, workspace: _sednarCurrentWorkspacePayload(), force: true }) })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data && data.success) _sednarApplyIndexResult(data);
        })
        .catch(function() {})
        .finally(function() { if (_sednarSettingsVisible("indexing")) _sednarRenderSettingsPage(); });
    } else if (action === "mcp-add") {
      openSednarMcpAddDialog();
    } else if (action === "mcp-refresh") {
      refreshSednarMcpConnections();
    } else if (action === "mcp-restart" && server) {
      if (!sednarMcpSelectedServers.has(server)) _sednarSetMcpServerEnabled(server, true);
      else runSednarMcpAction("restart", server);
    } else if (action === "mcp-edit" && server) {
      const found = _sednarFindMcpServer(server);
      if (found && found.config_path) openFileInEditorFromPath(found.config_path);
    } else if (action === "mcp-remove" && server) {
      _sednarRemoveMcpServer(server);
    } else if (action === "mcp-copy" && server) {
      _sednarCopyToClipboard(_sednarMcpDiagnosticsText(_sednarFindMcpServer(server)), "Copied MCP diagnostics");
    } else if (action === "mcp-more" && server) {
      _sednarSettingsMcpExpanded[server] = true;
      _sednarRenderSettingsPage();
    } else if (action === "mcp-tool" && server) {
      _sednarToggleMcpTool(server, btn.getAttribute("data-tool") || "");
      _sednarRenderMcpServers();  // refreshes the settings page too when it is showing
    }
  });
  view.addEventListener("input", function(e) {
    const input = e.target;
    if (input && typeof window._sednarHandleSettingsInputExt === "function") window._sednarHandleSettingsInputExt(input);
  });
  view.addEventListener("change", function(e) {
    const input = e.target;
    if (input && input.getAttribute && input.getAttribute("data-llm-toggle") === "best_auto") {
      _sednarSaveLlmSettings({ best_auto: !!input.checked });
      return;
    }
    if (input && input.getAttribute && typeof window._sednarHandleSettingsChangeExt === "function" && window._sednarHandleSettingsChangeExt(input)) return;
    if (!input || input.tagName !== "INPUT") return;
    const numberKey = input.getAttribute("data-setting-number");
    if (numberKey) {
      const number = Number(input.value);
      const min = Number(input.getAttribute("min")), max = Number(input.getAttribute("max"));
      if (!Number.isFinite(number) || number < min || number > max) {
        _sednarShowIdeToast("Enter a number from " + min + " to " + max + ".");
        _sednarRenderSettingsPage();
        return;
      }
      _sednarSettingsSet(numberKey, number);
      return;
    }
    const setting = input.getAttribute("data-setting");
    if (setting) {
      _sednarSettingsSet(setting, !!input.checked);
      if (setting === "showHiddenFiles") {
        // Settings > General is the one place for it; an open folder browser follows at once.
        const search = document.getElementById("sednar-finder-search");
        if (typeof window.sednarBrowserFilterList === "function" && search) window.sednarBrowserFilterList(search.value);
      }
      if (setting === "autoRunQueue") {
        _sednarRenderQueueBar();
        const tab = _sednarGetActiveChatTab();
        if (input.checked && tab && !tab.queuePaused) _sednarMaybeRunQueue(tab);
      }
      return;
    }
    const server = input.getAttribute("data-mcp-toggle");
    if (server) _sednarSetMcpServerEnabled(server, !!input.checked);
  });
}


function _sednarCurDialog(id, innerHtml) {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = id;
    overlay.className = "sednar-dialog-overlay theme-transition";
    overlay.hidden = true;
    document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", function(e) {
      if (e.target === overlay && !overlay.classList.contains("is-busy")) overlay.hidden = true;
    });
    overlay.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && !overlay.classList.contains("is-busy")) {
        e.stopPropagation();
        overlay.hidden = true;
      }
    });
  }
  overlay.innerHTML = innerHtml;
  overlay.classList.remove("is-busy");
  overlay.hidden = false;
  return overlay;
}

function _sednarDialogError(overlay, message) {
  const el = overlay.querySelector(".sednar-dialog-error");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

function _sednarParseKeyValueLines(text, separator) {
  const out = {};
  String(text || "").split("\n").forEach(function(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    const index = trimmed.indexOf(separator);
    if (index <= 0) return;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + separator.length).trim();
  });
  return out;
}

function _sednarFormField(form, name) {
  return form.elements.namedItem(name);
}

function openSednarMcpAddDialog() {
  if (!sednarProjectPath) {
    _sednarShowIdeToast("Open a project before adding MCP servers.");
    return;
  }
  toggleSednarMcpPanel(false);
  const overlay = _sednarCurDialog("sednar-mcp-add-dialog",
    '<form class="sednar-dialog" role="dialog" aria-modal="true" aria-labelledby="sednar-mcp-add-title" novalidate>' +
      '<div class="sednar-dialog-title" id="sednar-mcp-add-title">Add MCP server</div>' +
      '<label class="sednar-field"><span>Name</span><input name="name" placeholder="github" autocomplete="off" spellcheck="false"></label>' +
      '<div class="sednar-field"><span>Type</span><div class="lc-segmented" data-group="type">' +
        '<button type="button" class="lc-btn is-active" data-value="stdio">Command</button>' +
        '<button type="button" class="lc-btn" data-value="http">HTTP</button>' +
        '<button type="button" class="lc-btn" data-value="sse">SSE</button>' +
      "</div></div>" +
      '<label class="sednar-field" data-for="stdio"><span>Command</span><input name="command" placeholder="npx" autocomplete="off" spellcheck="false"></label>' +
      '<label class="sednar-field" data-for="stdio"><span>Arguments</span><input name="args" placeholder="-y @modelcontextprotocol/server-github" autocomplete="off" spellcheck="false"></label>' +
      '<label class="sednar-field" data-for="stdio"><span>Environment <em>one KEY=value per line</em></span><textarea name="env" rows="3" placeholder="GITHUB_TOKEN=${env:GITHUB_TOKEN}" spellcheck="false"></textarea></label>' +
      '<label class="sednar-field" data-for="http sse" hidden><span>URL</span><input name="url" placeholder="https://example.com/mcp" autocomplete="off" spellcheck="false"></label>' +
      '<label class="sednar-field" data-for="http sse" hidden><span>Headers <em>one Name: value per line</em></span><textarea name="headers" rows="3" placeholder="Authorization: Bearer ${env:API_TOKEN}" spellcheck="false"></textarea></label>' +
      '<div class="sednar-field"><span>Save to</span><div class="lc-segmented" data-group="scope">' +
        '<button type="button" class="lc-btn is-active" data-value="project">This project</button>' +
        '<button type="button" class="lc-btn" data-value="global">All projects</button>' +
      "</div></div>" +
      '<div class="sednar-dialog-error" role="alert" hidden></div>' +
      '<div class="sednar-dialog-actions">' +
        '<button type="button" class="lc-btn sednar-settings-btn" data-dialog="cancel">Cancel</button>' +
        '<button type="submit" class="lc-btn sednar-settings-btn is-primary">Add server</button>' +
      "</div>" +
    "</form>");
  const form = overlay.querySelector("form");
  const state = { type: "stdio", scope: "project" };
  overlay.querySelectorAll(".lc-segmented").forEach(function(group) {
    group.addEventListener("click", function(e) {
      const btn = e.target.closest("[data-value]");
      if (!btn) return;
      e.preventDefault();
      group.querySelectorAll("[data-value]").forEach(function(b) { b.classList.toggle("is-active", b === btn); });
      state[group.getAttribute("data-group")] = btn.getAttribute("data-value");
      if (group.getAttribute("data-group") === "type") {
        overlay.querySelectorAll("[data-for]").forEach(function(field) {
          field.hidden = field.getAttribute("data-for").split(" ").indexOf(state.type) === -1;
        });
      }
    });
  });
  overlay.querySelector('[data-dialog="cancel"]').addEventListener("click", function() { overlay.hidden = true; });
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    const name = _sednarFormField(form, "name").value.trim();
    if (!name) {
      _sednarDialogError(overlay, "Give the server a name.");
      return;
    }
    const spec = { type: state.type };
    if (state.type === "stdio") {
      spec.command = _sednarFormField(form, "command").value.trim();
      spec.args = _sednarFormField(form, "args").value.trim();
      spec.env = _sednarParseKeyValueLines(_sednarFormField(form, "env").value, "=");
    } else {
      spec.url = _sednarFormField(form, "url").value.trim();
      spec.headers = _sednarParseKeyValueLines(_sednarFormField(form, "headers").value, ":");
    }
    overlay.classList.add("is-busy");
    _sednarDialogError(overlay, "");
    try {
      await _sednarMcpServerRequest("/sednar-mcp/servers/add", { name: name, scope: state.scope, server: spec });
      overlay.hidden = true;
      _sednarShowIdeToast("Added " + name);
      _sednarSetMcpServerEnabled(name, true);
      _sednarSettingsMcpFocus = name;
      if (_sednarSettingsVisible()) _sednarSettingsSection = "mcp";
      openSednarSettings("mcp");
    } catch (err) {
      _sednarDialogError(overlay, err.message || String(err));
    } finally {
      overlay.classList.remove("is-busy");
    }
  });
  setTimeout(function() { _sednarFormField(form, "name").focus(); }, 30);
}
window.openSednarMcpAddDialog = openSednarMcpAddDialog;

function _sednarDefaultCloneParent() {
  const recent = getSednarRecentProjects().find(function(p) { return !_sednarIsWorkspaceFilePath(p); });
  if (recent) return recent.replace(/[\\/][^\\/]+[\\/]?$/, "") || "~";
  return "~";
}

function openSednarCloneDialog() {
  const overlay = _sednarCurDialog("sednar-clone-dialog",
    '<form class="sednar-dialog" role="dialog" aria-modal="true" aria-labelledby="sednar-clone-title" novalidate>' +
      '<div class="sednar-dialog-title" id="sednar-clone-title">Clone repository</div>' +
      '<label class="sednar-field"><span>Repository URL</span><input name="url" placeholder="https://github.com/org/repo.git" autocomplete="off" spellcheck="false"></label>' +
      '<div class="sednar-field"><span>Clone into</span><div class="sednar-inline"><input name="parent" autocomplete="off" spellcheck="false"><button type="button" class="lc-btn sednar-settings-btn" data-dialog="browse">Browse…</button></div></div>' +
      '<div class="sednar-dialog-error" role="alert" hidden></div>' +
      '<div class="sednar-dialog-actions">' +
        '<button type="button" class="lc-btn sednar-settings-btn" data-dialog="cancel">Cancel</button>' +
        '<button type="submit" class="lc-btn sednar-settings-btn is-primary" data-dialog="submit">Clone</button>' +
      "</div>" +
    "</form>");
  const form = overlay.querySelector("form");
  _sednarFormField(form, "parent").value = _sednarDefaultCloneParent();
  overlay.querySelector('[data-dialog="cancel"]').addEventListener("click", function() { overlay.hidden = true; });
  overlay.querySelector('[data-dialog="browse"]').addEventListener("click", function() {
    overlay.hidden = true;
    window.openSednarFolderBrowser(function(path) {
      overlay.hidden = false;
      if (path) _sednarFormField(form, "parent").value = path;
      _sednarFormField(form, "url").focus();
    }, _sednarFormField(form, "parent").value || "~");
  });
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    const url = _sednarFormField(form, "url").value.trim();
    if (!url) {
      _sednarDialogError(overlay, "Paste the repository URL.");
      return;
    }
    const submit = overlay.querySelector('[data-dialog="submit"]');
    overlay.classList.add("is-busy");
    submit.textContent = "Cloning…";
    _sednarDialogError(overlay, "");
    try {
      const resp = await fetch("/sednar/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, parent_dir: _sednarFormField(form, "parent").value.trim() || "~" }),
      });
      const data = await resp.json().catch(function() { return {}; });
      if (!resp.ok || !data.success) throw new Error(data.error || "git clone failed");
      overlay.hidden = true;
      setSednarProject(data.path);
      _sednarShowIdeToast("Cloned into " + _sednarShortPath(data.path));
    } catch (err) {
      _sednarDialogError(overlay, err.message || String(err));
    } finally {
      overlay.classList.remove("is-busy");
      submit.textContent = "Clone";
    }
  });
  setTimeout(function() { _sednarFormField(form, "url").focus(); }, 30);
}
window.openSednarCloneDialog = openSednarCloneDialog;

function openSednarNewProjectDialog() {
  const overlay = _sednarCurDialog("sednar-new-project-dialog",
    '<form class="sednar-dialog" role="dialog" aria-modal="true" aria-labelledby="sednar-new-project-title" novalidate>' +
      '<div class="sednar-dialog-title" id="sednar-new-project-title">New project</div>' +
      '<label class="sednar-field"><span>Project name</span><input name="name" placeholder="my-project" autocomplete="off" spellcheck="false"></label>' +
      '<div class="sednar-field"><span>Create in</span><div class="sednar-inline"><input name="parent" autocomplete="off" spellcheck="false"><button type="button" class="lc-btn sednar-settings-btn" data-dialog="browse">Browse…</button></div></div>' +
      '<div class="sednar-dialog-error" role="alert" hidden></div>' +
      '<div class="sednar-dialog-actions">' +
        '<button type="button" class="lc-btn sednar-settings-btn" data-dialog="cancel">Cancel</button>' +
        '<button type="submit" class="lc-btn sednar-settings-btn is-primary" data-dialog="submit">Create</button>' +
      "</div>" +
    "</form>");
  const form = overlay.querySelector("form");
  _sednarFormField(form, "parent").value = _sednarDefaultCloneParent();
  overlay.querySelector('[data-dialog="cancel"]').addEventListener("click", function() { overlay.hidden = true; });
  overlay.querySelector('[data-dialog="browse"]').addEventListener("click", function() {
    overlay.hidden = true;
    window.openSednarFolderBrowser(function(path) {
      overlay.hidden = false;
      if (path) _sednarFormField(form, "parent").value = path;
      _sednarFormField(form, "name").focus();
    }, _sednarFormField(form, "parent").value || "~");
  });
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    const name = _sednarFormField(form, "name").value.trim();
    if (!name) {
      _sednarDialogError(overlay, "Enter a project name.");
      return;
    }
    const submit = overlay.querySelector('[data-dialog="submit"]');
    overlay.classList.add("is-busy");
    submit.textContent = "Creating…";
    _sednarDialogError(overlay, "");
    try {
      const resp = await fetch("/sednar/new-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, parent_dir: _sednarFormField(form, "parent").value.trim() || "~" }),
      });
      const data = await resp.json().catch(function() { return {}; });
      if (!resp.ok || !data.success) throw new Error(data.error || "Could not create the project.");
      overlay.hidden = true;
      setSednarProject(data.path);
      _sednarShowIdeToast("Created " + _sednarShortPath(data.path));
    } catch (err) {
      _sednarDialogError(overlay, err.message || String(err));
    } finally {
      overlay.classList.remove("is-busy");
      submit.textContent = "Create";
    }
  });
  setTimeout(function() { _sednarFormField(form, "name").focus(); }, 30);
}
window.openSednarNewProjectDialog = openSednarNewProjectDialog;


function _sednarRenderWelcomeRecents() {
  const wrap = document.getElementById("sednar-welcome-recent");
  const list = document.getElementById("sednar-welcome-recent-list");
  if (!wrap || !list) return;
  const items = getSednarRecentProjects().slice(0, 6);
  wrap.hidden = !items.length;
  list.innerHTML = items.map(function(path) {
    const esc = _sednarEscapeHtml(path);
    const parent = _sednarShortPath(path.replace(/[\\/][^\\/]+[\\/]?$/, "") || path);
    return '<button type="button" class="sednar-welcome-recent-item lc-btn" data-path="' + esc + '" title="' + esc + '">' +
      '<span class="sednar-welcome-recent-name">' + _sednarEscapeHtml(_sednarProjectDisplayName(path)) + "</span>" +
      '<span class="sednar-welcome-recent-path">' + _sednarEscapeHtml(parent) + "</span></button>";
  }).join("");
  if (!list._sednarBound) {
    list._sednarBound = true;
    list.addEventListener("click", function(e) {
      const item = e.target.closest ? e.target.closest("[data-path]") : null;
      if (!item) return;
      e.preventDefault();
      _sednarOpenProjectOrWorkspace(item.getAttribute("data-path"));
    });
  }
}


// ---------------------------------------------------------------------------------------------------
// In-place DOM patching. Re-rendering a panel by replacing its innerHTML throws away focus, the caret,
// a half-typed value, scroll positions and running animations, and makes the whole panel flash. These
// patch the existing nodes to match the new markup instead: same tag at the same place is updated,
// anything else is inserted or removed. Elements with data-key are matched by key, so a list that gains
// or loses an item keeps the other items' nodes.
function _sednarMorph(target, html) {
  if (!target) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html == null ? "" : html);
  _sednarMorphChildren(target, tpl.content);
}

function _sednarMorphKey(node) {
  return node.nodeType === 1 ? (node.getAttribute("data-key") || node.id || "") : "";
}

function _sednarMorphCompatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  if (a.tagName !== b.tagName) return false;
  if (a.tagName === "INPUT" && (a.getAttribute("type") || "text") !== (b.getAttribute("type") || "text")) return false;
  return true;
}

function _sednarMorphChildren(fromEl, toEl) {
  if (fromEl.hasAttribute && fromEl.hasAttribute("data-morph-skip")) return;
  const byKey = new Map();
  for (let n = fromEl.firstChild; n; n = n.nextSibling) {
    const k = _sednarMorphKey(n);
    if (k && !byKey.has(k)) byKey.set(k, n);
  }
  const placed = new Set();
  let cursor = fromEl.firstChild;
  const wanted = Array.from(toEl.childNodes);
  for (let i = 0; i < wanted.length; i++) {
    const want = wanted[i];
    const key = _sednarMorphKey(want);
    let have = null;
    if (key) {
      if (byKey.has(key)) { have = byKey.get(key); byKey.delete(key); }
    } else {
      // An old node that nothing new matches is skipped, so the nodes after it can still be reused.
      while (cursor && (placed.has(cursor) || (!_sednarMorphKey(cursor) && !_sednarMorphCompatible(cursor, want)))) cursor = cursor.nextSibling;
      if (cursor && !_sednarMorphKey(cursor)) have = cursor;
    }
    if (have) {
      if (have !== cursor) fromEl.insertBefore(have, cursor);
      else cursor = have.nextSibling;
      _sednarMorphNode(have, want);
      placed.add(have);
    } else {
      fromEl.insertBefore(want, cursor);  // adopted, not cloned: listeners the renderer attached stay with it
      placed.add(want);
    }
  }
  // Whatever was not matched is gone from the new markup.
  Array.from(fromEl.childNodes).forEach(function(n) { if (!placed.has(n)) fromEl.removeChild(n); });
}

const _SEDNAR_MORPH_LIVE_PROPS = { value: true, checked: true, selected: true };

function _sednarMorphNode(from, to) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.data !== to.data) from.data = to.data;
    return;
  }
  if (from.nodeType !== 1) return;
  const focused = document.activeElement === from;
  // Attributes: add or update what the new markup has, drop what it lacks.
  const seen = new Set();
  for (let i = 0; i < to.attributes.length; i++) {
    const attr = to.attributes[i];
    seen.add(attr.name);
    if (focused && (attr.name === "value" || attr.name === "checked")) continue;
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
  for (let i = from.attributes.length - 1; i >= 0; i--) {
    const name = from.attributes[i].name;
    if (!seen.has(name) && !(focused && (name === "value" || name === "checked"))) from.removeAttribute(name);
  }
  // Form state follows the markup unless the user is in that control right now.
  if (!focused) {
    if (from.tagName === "INPUT") {
      const type = (from.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        const checked = to.hasAttribute("checked");
        if (from.checked !== checked) from.checked = checked;
      } else {
        const value = to.getAttribute("value") || "";
        if (from.value !== value) from.value = value;
      }
    } else if (from.tagName === "TEXTAREA") {
      if (from.value !== to.textContent) from.value = to.textContent;
      return;
    } else if (from.tagName === "SELECT") {
      _sednarMorphChildren(from, to);
      const chosen = to.querySelector("option[selected]");
      if (chosen && from.value !== chosen.value) from.value = chosen.value;
      return;
    }
  } else if (from.tagName === "TEXTAREA" || from.tagName === "INPUT") {
    return;
  }
  if (from.tagName === "SCRIPT" || from.tagName === "STYLE") {
    if (from.textContent !== to.textContent) from.textContent = to.textContent;
    return;
  }
  _sednarMorphChildren(from, to);
}
