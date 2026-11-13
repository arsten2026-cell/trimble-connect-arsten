// Arsten: ONE Trimble Connect 3D-viewer extension that holds all Arsten panels as tabs (user, 13.11.2026:
// "make one app which we open and it has those in").
//
// How: this page connects to Trimble Connect once and re-exposes that Workspace API to the panels, which run unchanged
// in iframes inside it (TrimbleConnectWorkspace.expose; Connect events are forwarded to them). Each panel still does its
// own access check; the tabs shown here follow the same roles (shared/arsten-access.js):
//   Бетон (Pour status), Етикети (Pour tags), Бет. елементи (Cast unit tags)  -> app "execution"   (admin, GC)
//   Стомана (Assembly status)                                                 -> app "assembly"    (admin, GC, designers)
//   Приемане (acceptance)                                                     -> app "acceptance"  (admin, GC, designers)
//   Напредък (Project status)                                                 -> app "projectStatus" (admin, GC, client)
// A tab's panel is loaded the first time it is opened and then kept, so switching back is instant.
(function () {
  "use strict";
  const BASE = "https://arsten2026-cell.github.io/";
  const TABS = [
    { id: "pour", app: "execution", url: "trimble-connect-pour-status/index.html", bg: "Бетон", en: "Concrete" },
    { id: "accept", app: "acceptance", url: "trimble-connect-acceptance/index.html", bg: "Приемане", en: "Acceptance" },
    { id: "steel", app: "assembly", url: "trimble-connect-assembly-status/index.html", bg: "Стомана", en: "Steel" },
    { id: "progress", app: "projectStatus", url: "trimble-connect-project-status/index.html", bg: "Напредък", en: "Progress" },
    { id: "pourtags", app: "execution", url: "trimble-connect-pour-tags/index.html", bg: "Етикети тактове", en: "Pour tags" },
    { id: "cutags", app: "execution", url: "trimble-connect-castunit-tags/index.html", bg: "Бет. елементи", en: "Cast units" },
  ];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // language: the one chosen inside the panels (same site, same storage), Bulgarian by default
  let lang = (() => { try { return localStorage.getItem("arsten.pourStatus.lang") || localStorage.getItem("arsten.acceptance.lang") || "bg"; } catch { return "bg"; } })();
  const L2 = (b, e) => (lang === "bg" ? b : e);
  const state = { api: null, access: null, tabs: [], active: null, loaded: new Set() };
  const setStatus = (t, bad) => { const s = $("status"); s.hidden = !t; s.textContent = t || ""; s.className = "status" + (bad ? " bad" : ""); };

  let tokens = null;
  function onEvent(event, data) {
    if (tokens) tokens.onEvent(event, data);
    // every Connect event goes on to the panels (selection, model changes, access token, ...)
    try { TrimbleConnectWorkspace.sendEventToAllClients(event, data); } catch (e) { console.error(e); }
  }

  function render() {
    $("tabs").innerHTML = state.tabs.map((t) => `<button data-tab="${t.id}" class="${state.active === t.id ? "on" : ""}">${esc(lang === "bg" ? t.bg : t.en)}</button>`).join("");
    for (const t of state.tabs) {
      let f = document.getElementById("f_" + t.id);
      if (state.active === t.id && !f) {
        f = document.createElement("iframe");
        f.id = "f_" + t.id;
        f.src = t.local || BASE + t.url + "?shell=1";
        f.allow = "camera; clipboard-write";
        $("frames").appendChild(f);
      }
      if (f) f.hidden = state.active !== t.id;
    }
  }
  function open(id) {
    state.active = id;
    try { localStorage.setItem("arsten.shell.tab", id); } catch {}
    render();
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) open(b.dataset.tab); });

  // Local test only (test/host.html on localhost): one probe tab, no access check.
  const PROBE = /^localhost$|^127\.0\.0\.1$/.test(location.hostname) && /[?&]probe\b/.test(location.search);

  async function start(api) {
    state.api = api;
    // the panels connect to this page as if it were Trimble Connect
    TrimbleConnectWorkspace.expose(api);
    if (PROBE) { state.tabs = [{ id: "probe", app: "execution", url: "", bg: "Проба", en: "Probe", local: "test/probe.html" }]; setStatus(""); open("probe"); return; }
    tokens = ArstenAccess.tokenGetter(api);
    const access = await ArstenAccess.check({ api, getToken: tokens.getToken, app: "execution" });
    state.access = access;
    if (access.role === "unknown") {
      // right after "Allow extension" Connect's first token can be refused (401): offer a retry instead of a dead end
      ArstenAccess.renderDenied(document.body, lang, access);
      const b = document.createElement("button"); b.className = "retry"; b.textContent = L2("Опитай пак", "Try again"); b.onclick = () => location.reload();
      document.body.appendChild(b);
      return;
    }
    if (access.role === "none") { ArstenAccess.renderDenied(document.body, lang, access); return; }
    state.tabs = TABS.filter((t) => ArstenAccess.allows(t.app, access.role) || (t.app === "acceptance" && ArstenAccess.can(access, "approve")));
    if (!state.tabs.length) { ArstenAccess.renderDenied(document.body, lang, access); return; }
    setStatus("");
    let first = null;
    try { first = localStorage.getItem("arsten.shell.tab"); } catch {}
    open(state.tabs.some((t) => t.id === first) ? first : state.tabs[0].id);
  }
  window.ArstenShell = { state, TABS };

  if (window.parent === window) { setStatus("Not inside Trimble Connect. Add this extension to a project and open it from the 3D viewer side panel.", true); return; }
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => setStatus("Could not connect to Trimble Connect: " + ((e && e.message) || e), true));
})();
