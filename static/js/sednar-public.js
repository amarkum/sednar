// Hosted Sednar: open the user's own sample project, hide what the hosted site turns off (terminal, MCP,
// language servers), ask for an API key until one is added, and add Settings > Account (the user icon in
// the top bar opens it).
(function () {
  var cfg = window.SEDNAR_PUBLIC;
  if (!cfg || !cfg.home) return;
  var home = String(cfg.home).replace(/\/+$/, "");
  var brand = cfg.brand || "Sednar";

  function inHome(path) {
    return typeof path === "string" && (path === home || path.indexOf(home + "/") === 0);
  }

  // Runs before sednar.js reads them: drop projects of another account, start in the sample.
  try {
    var last = localStorage.getItem("sednar_last_project");
    if (!inHome(last)) localStorage.setItem("sednar_last_project", cfg.project);
    var recent = JSON.parse(localStorage.getItem("sednar_recent_projects") || "[]");
    if (Array.isArray(recent)) {
      localStorage.setItem("sednar_recent_projects", JSON.stringify(recent.filter(function (p) {
        return inHome(typeof p === "string" ? p : p && p.path);
      })));
    }
    if (!inHome(localStorage.getItem("sednarBrowserLastPath"))) localStorage.setItem("sednarBrowserLastPath", home);
    var open = JSON.parse(localStorage.getItem("sednar_open_projects_v1") || "[]");
    if (Array.isArray(open)) {
      localStorage.setItem("sednar_open_projects_v1", JSON.stringify(open.filter(function (p) { return p && inHome(p.path); })));
    }
    var browserWs = JSON.parse(localStorage.getItem("sednar_browser_workspace") || "null");
    if (browserWs && Array.isArray(browserWs.folders) && !browserWs.folders.every(function (f) { return f && inHome(f.path); })) {
      localStorage.removeItem("sednar_browser_workspace");
    }
    // Chats and editor tabs are stored per project ("sednar_tabs_v1:/path"); another account's go.
    Object.keys(localStorage).forEach(function (key) {
      var at = key.indexOf(":/");
      if (key.indexOf("sednar") === 0 && at > 0 && !inHome(key.slice(at + 1))) localStorage.removeItem(key);
    });
  } catch (e) {}

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2), attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function toast(text) {
    if (typeof window._sednarShowIdeToast === "function") window._sednarShowIdeToast(text);
  }

  function openModels() {
    closeWelcome();
    if (typeof window.openSednarSettings === "function") window.openSednarSettings("models");
  }

  var welcome = null;
  function closeWelcome() {
    if (welcome) welcome.remove();
    welcome = null;
    try { sessionStorage.setItem("sednar_public_welcome_closed", "1"); } catch (e) {}
  }

  function showWelcome() {
    if (welcome) return;
    welcome = el("div", { class: "lc-public-welcome", role: "dialog", "aria-modal": "true", "aria-labelledby": "lc-public-title" }, [
      el("div", { class: "lc-public-card" }, [
        el("img", { class: "lc-public-logo lc-public-logo-on-dark", src: "/sednar/assets/sednar/sednar-logo-white.png", alt: "" }),
        el("img", { class: "lc-public-logo lc-public-logo-on-light", src: "/sednar/assets/sednar/sednar-logo-dark.png", alt: "" }),
        el("h2", { id: "lc-public-title", text: "Try " + brand }),
        el("p", { class: "lc-public-lead", text: "An AI coding agent that reads and edits your code, in your browser. Bring an API key from Gemini, OpenAI, Anthropic, xAI, Mistral, Groq or OpenRouter to start." }),
        el("ul", {}, [
          el("li", { text: "Your key is saved encrypted and only your account can use it. Nobody else can see it." }),
          el("li", { text: "You have your own copy of a sample project, hello-sednar, with a few bugs to fix." }),
          el("li", { text: "It edits code: there is no terminal, so the agent reads, edits and plans, but does not run anything." }),
        ]),
        el("div", { class: "lc-public-actions" }, [
          el("button", { type: "button", class: "lc-public-primary", text: "Add API key", onclick: openModels }),
          cfg.githubRepos ? el("button", { type: "button", class: "lc-public-secondary", text: "Open a GitHub repository", onclick: showRepos }) : null,
          el("button", { type: "button", class: "lc-public-secondary", text: "Look around first", onclick: closeWelcome }),
        ]),
        el("div", { class: "lc-public-links" }, [
          el("a", { class: "lc-public-source", href: "/privacy", target: "_blank", rel: "noopener", text: "Privacy" }),
          cfg.source ? el("a", { class: "lc-public-source", href: cfg.source, target: "_blank", rel: "noopener", text: "Run it on your own machine" }) : null,
        ]),
      ]),
    ]);
    welcome.addEventListener("click", function (e) { if (e.target === welcome) closeWelcome(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape" && welcome) { closeWelcome(); document.removeEventListener("keydown", onKey); }
    });
    document.body.appendChild(welcome);
    var primary = welcome.querySelector(".lc-public-primary");
    if (primary) primary.focus();
  }

  function post(url, fields) {
    var body = new URLSearchParams(Object.assign({ csrf: cfg.csrf || "" }, fields || {}));
    return fetch(url, { method: "POST", body: body, credentials: "same-origin" });
  }

  function logOut() {
    post("/logout").then(function () { window.location.href = "/login"; });
  }

  function dialog(title, children) {
    closeWelcome();
    welcome = el("div", { class: "lc-public-welcome", role: "dialog", "aria-modal": "true", "aria-labelledby": "lc-public-title" }, [
      el("div", { class: "lc-public-card" }, [el("h2", { id: "lc-public-title", text: title })].concat(children)),
    ]);
    welcome.addEventListener("click", function (e) { if (e.target === welcome) closeWelcome(); });
    document.body.appendChild(welcome);
  }

  function openProject(path) {
    closeWelcome();
    if (typeof window.setSednarProject === "function") window.setSednarProject(path);
    else window.location.reload();
  }

  function showRepos() {
    var status = el("div", { class: "lc-public-muted", role: "status", text: "Loading your repositories…" });
    var search = el("input", { type: "search", placeholder: "Search your repositories", "aria-label": "Search your repositories" });
    var list = el("ul", { class: "lc-public-repos" });
    var repos = [];
    dialog("Open a GitHub repository", [
      el("p", { class: "lc-public-lead", text: "Pick one to clone into your folder and open in the editor." }),
      search, status, list,
      el("div", { class: "lc-public-actions" }, [el("button", { type: "button", class: "lc-public-secondary", text: "Close", onclick: closeWelcome })]),
    ]);
    search.focus();

    function render() {
      var q = search.value.trim().toLowerCase();
      list.textContent = "";
      repos.filter(function (r) { return !q || r.full_name.toLowerCase().indexOf(q) >= 0; }).slice(0, 50).forEach(function (repo) {
        var meta = [repo.private ? "Private" : "Public", repo.language].filter(Boolean).join(" · ");
        list.appendChild(el("li", {}, [el("button", { type: "button", onclick: function () { cloneRepo(repo); } }, [
          el("span", { class: "lc-public-repo-name", text: repo.full_name }),
          el("span", { class: "lc-public-repo-meta", text: meta + (repo.description ? " — " + repo.description : "") }),
        ])]));
      });
      if (!list.childNodes.length && repos.length) status.textContent = "No repository matches.";
      else if (repos.length) status.textContent = "";
    }

    function cloneRepo(repo) {
      status.textContent = "Cloning " + repo.full_name + "…";
      Array.prototype.forEach.call(list.querySelectorAll("button"), function (b) { b.disabled = true; });
      fetch("/github/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: repo.full_name }) })
        .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
        .then(function (res) {
          if (res.data && res.data.success) { openProject(res.data.path); toast("Cloned " + repo.full_name); return; }
          if (res.status === 409) { openProject(home + "/" + repo.name); return; }
          status.textContent = (res.data && res.data.error) || "Could not clone it.";
          Array.prototype.forEach.call(list.querySelectorAll("button"), function (b) { b.disabled = false; });
        })
        .catch(function () { status.textContent = "Could not clone it."; });
    }

    search.addEventListener("input", render);
    fetch("/github/repos").then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.success) { status.textContent = (data && data.error) || "Could not load your repositories."; return; }
      repos = data.repos || [];
      status.textContent = repos.length ? "" : "You have no repositories yet.";
      render();
    }).catch(function () { status.textContent = "Could not load your repositories."; });
  }

  function changePassword() {
    var error = el("div", { class: "lc-public-error", role: "alert" });
    var current = el("input", { type: "password", autocomplete: "current-password", "aria-label": "Current password", placeholder: "Current password" });
    var next = el("input", { type: "password", autocomplete: "new-password", minlength: "8", "aria-label": "New password", placeholder: "New password (8 characters or more)" });
    var submit = el("button", { type: "submit", class: "lc-public-primary", text: "Change password" });
    var form = el("form", {}, [current, next, error, el("div", { class: "lc-public-actions" }, [
      submit, el("button", { type: "button", class: "lc-public-secondary", text: "Cancel", onclick: closeWelcome }),
    ])]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = "";
      post("/account/password", { current: current.value, new: next.value }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.success) { closeWelcome(); toast("Password changed. Other browsers were signed out."); return; }
        error.textContent = (data && data.error) || "Could not change the password.";
        submit.disabled = false;
      }).catch(function () { error.textContent = "Could not change the password."; submit.disabled = false; });
    });
    dialog("Change password", [el("p", { class: "lc-public-lead", text: "Your saved keys move to the new password." }), form]);
    current.focus();
  }

  function confirmDelete() {
    closeWelcome();
    var error = el("div", { class: "lc-public-error", role: "alert" });
    var password = cfg.github
      ? el("input", { type: "text", autocomplete: "off", "aria-label": "Your GitHub name", placeholder: "Type " + cfg.github + " to confirm" })
      : el("input", { type: "password", autocomplete: "current-password", "aria-label": "Password", placeholder: "Your password" });
    var submit = el("button", { type: "submit", class: "lc-public-danger", text: "Delete my account" });
    var form = el("form", {}, [password, error, el("div", { class: "lc-public-actions" }, [
      submit,
      el("button", { type: "button", class: "lc-public-secondary", text: "Cancel", onclick: closeWelcome }),
    ])]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = "";
      post("/account/delete", cfg.github ? { confirm: password.value } : { password: password.value }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.success) { window.location.href = "/signup"; return; }
        error.textContent = (data && data.error) || "Could not delete the account.";
        submit.disabled = false;
      }).catch(function () { error.textContent = "Could not delete the account."; submit.disabled = false; });
    });
    welcome = el("div", { class: "lc-public-welcome", role: "dialog", "aria-modal": "true", "aria-labelledby": "lc-public-title" }, [
      el("div", { class: "lc-public-card" }, [
        el("h2", { id: "lc-public-title", text: "Delete your account?" }),
        el("p", { class: "lc-public-lead", text: "This deletes " + (cfg.email || "your account") + ", your projects, chats and saved keys. It cannot be undone." }),
        form,
      ]),
    ]);
    document.body.appendChild(welcome);
    password.focus();
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var ACCOUNT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path></svg>';

  // Settings > Account. The rows use the Settings page's own markup, so they look like every other section.
  window._sednarSettingsAccountHtml = function () {
    function row(title, desc, control) {
      return '<div class="sednar-settings-row"><div class="sednar-settings-row-text"><div class="sednar-settings-row-title">' + title + "</div>" +
        '<div class="sednar-settings-row-desc">' + desc + '</div></div><div class="sednar-settings-row-control">' + control + "</div></div>";
    }
    function button(label, action, danger) {
      return '<button type="button" class="lc-btn sednar-settings-btn' + (danger ? " lc-public-danger-btn" : "") + '" data-account-action="' + action + '">' + label + "</button>";
    }
    function group(title, rows) {
      return '<h3 class="sednar-settings-subh">' + title + '</h3><div class="sednar-settings-group">' + rows + "</div>";
    }
    var name = cfg.email || "";
    var initial = (name.replace(/^@/, "").charAt(0) || "?").toUpperCase();
    var html = '<h2 class="sednar-settings-h">Account</h2><div class="sednar-settings-group">' +
      '<div class="sednar-settings-row lc-public-account"><span class="lc-public-avatar" aria-hidden="true">' + esc(initial) + "</span>" +
      '<div class="sednar-settings-row-text"><div class="sednar-settings-row-title">' + esc(name) + "</div>" +
      '<div class="sednar-settings-row-desc">' + (cfg.github ? "Signed in with GitHub" : "Signed in with email") + "</div></div></div></div>";
    html += group("Model API keys", row("API keys", "Saved encrypted for this account only. Add or change them in Models.", button("Open Models", "models")));
    if (cfg.githubRepos) html += group("GitHub", row("Repositories", "Clone one of your repositories into your folder and open it in the editor.", button("Open a repository…", "repos")));
    if (!cfg.github) html += group("Security", row("Password", "Your saved keys move to the new password, and your other browsers are signed out.", button("Change…", "password")));
    html += group("Session",
      row("Log out", "Ends the login in this browser. Your projects and keys stay.", button("Log out", "logout")) +
      row("About " + esc(brand), "What the hosted site does, and what it leaves out.", button("Show", "about")) +
      row("Privacy", "What " + esc(brand) + " stores and where your work goes.", button("Read", "privacy")));
    html += group("Danger zone", row("Delete account", "Deletes your account, projects, chats and saved keys at once. This cannot be undone.", button("Delete account…", "delete", true)));
    return html;
  };

  document.addEventListener("click", function (e) {
    var target = e.target && e.target.closest ? e.target.closest("[data-account-action]") : null;
    if (!target) return;
    var action = target.getAttribute("data-account-action");
    if (action === "models") openModels();
    else if (action === "repos") showRepos();
    else if (action === "password") changePassword();
    else if (action === "logout") logOut();
    else if (action === "about") showWelcome();
    else if (action === "privacy") window.open("/privacy", "_blank", "noopener");
    else if (action === "delete") confirmDelete();
  });

  function setUpSettings() {
    var off = { terminal: 1, mcp: 1, languages: 1 };
    try {
      if (typeof _SEDNAR_SETTINGS_SECTIONS !== "undefined") {
        for (var i = _SEDNAR_SETTINGS_SECTIONS.length - 1; i >= 0; i--) {
          if (off[_SEDNAR_SETTINGS_SECTIONS[i].id]) _SEDNAR_SETTINGS_SECTIONS.splice(i, 1);
        }
        if (!_SEDNAR_SETTINGS_SECTIONS.some(function (s) { return s.id === "account"; })) {
          _SEDNAR_SETTINGS_SECTIONS.unshift({ id: "account", label: "Account", icon: ACCOUNT_ICON });
        }
      }
    } catch (e) {}
    var noTerminal = function () { toast("The terminal is off on " + brand + "'s hosted site."); };
    window.toggleIDETerminal = noTerminal;
    window.showIDETerminal = noTerminal;
  }

  function keyConfigured() {
    return fetch("/sednar/llm/settings").then(function (r) { return r.json(); }).then(function (data) {
      return !!(data && (data.providers || []).some(function (p) { return p.configured; }));
    }).catch(function () { return false; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("lc-public");
    setUpSettings();
    keyConfigured().then(function (has) {
      var closed = false;
      try { closed = sessionStorage.getItem("sednar_public_welcome_closed") === "1"; } catch (e) {}
      if (!has && !closed) showWelcome();
    });
  });
})();
