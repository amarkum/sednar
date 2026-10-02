// Tooltips in the app's own theme instead of the browser's grey system ones. Any element with a title
// gets one: the title moves to data-sd-tip while the pointer (or keyboard focus) is on it, so the system
// tooltip does not show too, and comes back afterwards for screen readers and copy-paste.
(function () {
  var tip = null;
  var owner = null;
  var timer = null;

  function ensure() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "sd-tooltip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    return tip;
  }

  function place(el) {
    var r = el.getBoundingClientRect();
    var t = ensure();
    t.style.left = "0px";
    t.style.top = "0px";
    t.classList.add("is-measuring");
    var w = t.offsetWidth;
    var h = t.offsetHeight;
    t.classList.remove("is-measuring");
    var gap = 6;
    var top = r.top - h - gap;
    var below = top < 4;
    if (below) top = r.bottom + gap;
    var left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), window.innerWidth - w - 4);
    t.style.left = Math.round(left) + "px";
    t.style.top = Math.round(top) + "px";
    t.classList.toggle("is-below", below);
  }

  function show(el) {
    var text = el.getAttribute("data-sd-tip");
    if (!text) return;
    ensure().textContent = text;
    place(el);
    tip.classList.add("is-visible");
  }

  function hide() {
    clearTimeout(timer);
    if (tip) tip.classList.remove("is-visible");
    if (owner && owner.hasAttribute("data-sd-tip")) {
      owner.setAttribute("title", owner.getAttribute("data-sd-tip"));
      owner.removeAttribute("data-sd-tip");
    }
    owner = null;
  }

  function enter(e) {
    var el = e.target && e.target.closest ? e.target.closest("[title]") : null;
    if (!el || el === owner) return;
    // Code views and other places that use title for something else keep the system tooltip.
    if (el.closest(".monaco-editor, .xterm, [data-sd-tip-off]")) return;
    var text = (el.getAttribute("title") || "").trim();
    if (!text) return;
    hide();
    owner = el;
    el.setAttribute("data-sd-tip", text);
    el.removeAttribute("title");
    timer = setTimeout(function () { if (owner === el) show(el); }, e.type === "focusin" ? 0 : 350);
  }

  function leave(e) {
    if (!owner) return;
    var to = e.relatedTarget;
    if (to && owner.contains(to)) return;
    hide();
  }

  document.addEventListener("pointerover", enter, true);
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("focusin", function (e) { if (e.target && e.target.matches && e.target.matches(":focus-visible")) enter(e); }, true);
  document.addEventListener("focusout", leave, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); }, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
})();
