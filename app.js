// Arsten / MULTIPLAN: ONE Trimble Connect 3D-viewer extension that holds all Arsten / MULTIPLAN tools (user, 13.11.2026).
//
// Start screen: a tile per tool (its icon on top, its name below). Tools the user may use are in colour and open on a
// click; the others are grey with "Нямате достъп". Inside a tool a thin bar has "⌂ Начало" (back to the tiles) and the
// tool's name. A tool that was opened stays loaded, so going home and back is instant.
//
// How: this page connects to Trimble Connect once and re-exposes that Workspace API to the tools, which run unchanged
// in iframes inside it (TrimbleConnectWorkspace.expose; Connect events are forwarded to them). Each tool still does its
// own access check; the tiles follow the same roles (shared/arsten-access.js):
//   Монолитен бетон (Pour status), Етикети тактове (Pour tags), Бет. елементи (Cast unit tags) -> "execution"   (admin, GC)
//   Стомана (Assembly status)                                                       -> "assembly"    (admin, GC, designers)
//   Авторски надзор (acceptance)                                                           -> "acceptance"  (admin, GC, designers)
//   Статус (Project status)                                                       -> "projectStatus" (admin, GC, client)
(function () {
  "use strict";
  const BASE = "https://arsten2026-cell.github.io/";
  const TOOLS = [
    { id: "pour", app: "execution", repo: "trimble-connect-pour-status", bg: "Монолитен бетон", en: "Cast-in-place concrete", sub: ["Тактове, снимки, заявки", "Pours, photos, requests"] },
    { id: "accept", app: "acceptance", repo: "trimble-connect-acceptance", bg: "Авторски надзор", en: "Design supervision", sub: ["Приемане на кофраж и армировка", "Formwork and rebar acceptance"] },
    { id: "steel", app: "assembly", repo: "trimble-connect-assembly-status", bg: "Стомана", en: "Steel", sub: ["Монтаж, доставки, болтове", "Erection, deliveries, bolts"] },
    { id: "progress", app: "projectStatus", repo: "trimble-connect-project-status", bg: "Статус", en: "Status", sub: ["Напредък на проекта", "Project progress"] },
    { id: "pourtags", app: "execution", repo: "trimble-connect-pour-tags", bg: "Етикети тактове", en: "Pour tags", sub: ["Номера на тактовете", "Pour numbers"] },
    { id: "cutags", app: "execution", repo: "trimble-connect-castunit-tags", bg: "Бетонови елементи", en: "Cast units", sub: ["Марки и армировка", "Marks and rebar"] },
  ];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // language: the one chosen inside the tools (same site, same storage), Bulgarian by default
  let lang = (() => { try { return localStorage.getItem("arsten.pourStatus.lang") || localStorage.getItem("arsten.acceptance.lang") || "bg"; } catch { return "bg"; } })();
  const L2 = (b, e) => (lang === "bg" ? b : e);
  const state = { api: null, access: null, tools: TOOLS, allowed: new Set(), view: "home" };
  const setStatus = (t, bad) => { const s = $("status"); s.hidden = !t; s.textContent = t || ""; s.className = "status" + (bad ? " bad" : ""); };
  const name = (t) => (lang === "bg" ? t.bg : t.en);

  let tokens = null;
  function onEvent(event, data) {
    if (tokens) tokens.onEvent(event, data);
    // every Connect event goes on to the tools (selection, model changes, access token, ...)
    try { TrimbleConnectWorkspace.sendEventToAllClients(event, data); } catch (e) { console.error(e); }
  }

  function render() {
    const home = state.view === "home";
    $("home").hidden = !home;
    $("bar").hidden = home;
    $("frames").hidden = home;   // the start screen gets the whole height
    if (home) {
      $("tiles").innerHTML = state.tools.map((t) => {
        const ok = state.allowed.has(t.id);
        const icon = t.icon || BASE + t.repo + "/icon.svg";
        return `<button class="tile${ok ? "" : " off"}" data-open="${t.id}"${ok ? "" : ` disabled title="${esc(L2("Нямате достъп", "No access"))}"`}>
          <img src="${esc(icon)}" alt=""><b>${esc(name(t))}</b><span>${esc(ok ? t.sub[lang === "bg" ? 0 : 1] : L2("Нямате достъп", "No access"))}</span></button>`;
      }).join("");
    } else {
      const t = state.tools.find((x) => x.id === state.view);
      $("barName").textContent = t ? name(t) : "";
      $("btnHome").textContent = "⌂ " + L2("Начало", "Home");
    }
    for (const t of state.tools) {
      let f = document.getElementById("f_" + t.id);
      if (state.view === t.id && !f) {
        f = document.createElement("iframe");
        f.id = "f_" + t.id;
        f.src = t.local || BASE + t.repo + "/index.html?shell=1";
        f.allow = "camera; clipboard-write";
        $("frames").appendChild(f);
      }
      if (f) f.hidden = state.view !== t.id;
    }
  }
  function open(id) {
    if (id !== "home" && !state.allowed.has(id)) return;
    state.view = id;
    render();
  }
  $("tiles").addEventListener("click", (e) => { const b = e.target.closest("button[data-open]"); if (b && !b.disabled) open(b.dataset.open); });
  $("btnHome").onclick = () => open("home");

  // Local test only (test/host.html on localhost): one probe tool, no access check.
  const PROBE = /^localhost$|^127\.0\.0\.1$/.test(location.hostname) && /[?&]probe\b/.test(location.search);

  async function start(api) {
    state.api = api;
    // the tools connect to this page as if it were Trimble Connect
    TrimbleConnectWorkspace.expose(api);
    if (PROBE) {
      state.tools = [{ id: "probe", app: "execution", repo: "", bg: "Проба", en: "Probe", sub: ["тест", "test"], local: "test/probe.html", icon: "icon.svg" }].concat(TOOLS.map((t) => Object.assign({}, t, { icon: "icon.svg" })));
      state.allowed = new Set(["probe"]);
      setStatus(""); render(); return;
    }
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
    state.allowed = new Set(TOOLS.filter((t) => ArstenAccess.allows(t.app, access.role) || (t.app === "acceptance" && ArstenAccess.can(access, "approve"))).map((t) => t.id));
    if (!state.allowed.size) { ArstenAccess.renderDenied(document.body, lang, access); return; }
    setStatus("");
    render();
  }
  window.ArstenShell = { state, TOOLS, open };

  if (window.parent === window) { setStatus("Not inside Trimble Connect. Add this extension to a project and open it from the 3D viewer side panel.", true); return; }
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => setStatus("Could not connect to Trimble Connect: " + ((e && e.message) || e), true));
})();
