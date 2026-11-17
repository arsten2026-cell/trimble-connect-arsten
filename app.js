// Arsten / MULTIPLAN: ONE Trimble Connect 3D-viewer extension that holds all Arsten / MULTIPLAN tools (user, 13.11.2026).
//
// Start screen: a tile per tool (its icon on top, its name below, a line "for whom" it is). Tools the user may use are in
// colour, first, and open on a click; the others are grey with "Нямате достъп", after them. Inside a tool a thin bar has
// "⌂ Начало" (back to the tiles) and the tool's name. A tool that was opened stays loaded, so going home and back is instant.
// Week 3 A4 (17.11.2026): the tiles are drawn at once (grey until the access check is known; the stages are read as soon
// as it grants a tool, round 11 L3), the last tool + stage is remembered per user and project ("Продължи: Стомана ·
// Сграда А"), and the stage picker is skipped for a tool that has no stages. A client sees only their own tiles (L4).
//
// How: this page connects to Trimble Connect once and re-exposes that Workspace API to the tools, which run unchanged
// in iframes inside it (TrimbleConnectWorkspace.expose; Connect events are forwarded to the visible one, round 12 H1). Each tool still does its
// own access check; the tiles follow the same roles (shared/arsten-access.js):
//   Монолитен бетон (Pour status), Етикети тактове (Pour tags), Бет. елементи (Cast unit tags) -> "execution"   (admin, GC)
//   Стомана (Assembly status)                                                       -> "assembly"    (admin, GC, designers)
//   Авторски надзор (acceptance)                                                           -> "acceptance"  (admin, GC, designers)
//   Статус (Project status)                                                       -> "projectStatus" (admin, GC, client)
//   Документи (document control, plugins/arsten-docs)                              -> roles admin, GC, designers
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
    // Document control for the general contractor (plugins/arsten-docs, 16.11.2026). Its own access check uses the same
    // group mapping; "documents" is not an app kind in arsten-access.js, so the roles are listed here.
    { id: "docs", app: "documents", roles: ["admin", "gc", "designer"], repo: "arsten-connect-docs", bg: "Документи", en: "Documents", sub: ["За изпълнение, ревизии, RFI", "For construction, revisions, RFIs"] },
    { id: "admin", app: "projectAdmin", roles: ["admin"], repo: "trimble-connect-admin", bg: "Администрация", en: "Administration", sub: ["Настройка, данни, промени", "Setup, data, changes"] },
  ];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // language: one setting for all tools (A10, shared/arsten-i18n.js: localStorage "arsten.lang", same site, same storage).
  // The shell has no switch of its own: it follows the tools (storage event below); with nothing chosen yet, the Connect
  // user's language, else Bulgarian.
  const I18N = window.ArstenI18n;
  let lang = I18N ? I18N.getLang() : (() => { try { return localStorage.getItem("arsten.pourStatus.lang") || localStorage.getItem("arsten.acceptance.lang") || "bg"; } catch { return "bg"; } })();
  const L2 = (b, e) => (lang === "bg" ? b : e);
  // accessKnown: false until the access check answers (tiles grey meanwhile); stagesLoaded: the first stages read is done
  const state = { api: null, access: null, tools: TOOLS, allowed: new Set(), view: "home", accessKnown: false, denied: false,
    stages: [], store: null, stageTool: null, current: {}, form: null, busy: false, stagesLoaded: false, stagesReady: null,
    last: null, lastKey: null, opening: false };
  const ST = window.ArstenStages;
  const HOME = window.ArstenHome;
  const storage = () => { try { return window.localStorage; } catch { return null; } };
  // only 00_ADMIN and "02.1-EXECUTION PROJECT MANAGER" manage stages, in the "Етапи" module (user, 15.11.2026). Both groups
  // carry the "stages" capability; a Connect project admin outside them does not (the library lock refuses them too).
  const canManage = () => !!(PROBE || (state.access && ArstenAccess.can(state.access, "stages")));
  const canEdit = () => !!(state.store && state.store.writable && canManage());
  const STAGE_TOOLS = () => state.tools.filter((t) => t.id !== "stages" && (PROBE || !t.local));
  const setStatus = (t, bad) => { const s = $("status"); s.hidden = !t; s.textContent = t || ""; s.className = "status" + (bad ? " bad" : ""); };
  const name = (t) => (lang === "bg" ? t.bg : t.en);

  let tokens = null;
  // Connect events to the tools (review round 12, H1). Only the tool on screen gets them live; for a hidden tool the
  // last event of each type is held (HOME.holdEvent) and replayed once when it is shown again (flushHeld, from render).
  // "extension.*" (access token, session, settings, commands) still reaches every tool at once. The tools are unchanged.
  const clients = new Set();   // the tools connected to this page: {dispatcher (their window), origin, identifier}
  const held = new Map();      // tool id -> Map(event -> last data)
  /** The tool whose iframe is this client's window, or null (not one of our frames). */
  function toolOfClient(c) {
    for (const t of state.tools) {
      const f = document.getElementById("f_" + t.id);
      if (f && c && f.contentWindow === c.dispatcher) return t.id;
    }
    return null;
  }
  function sendTo(c, event, data) {
    try { TrimbleConnectWorkspace.sendEventToAllClients(event, data, { identifier: c.identifier }); } catch (e) { console.error(e); }
  }
  function onEvent(event, data) {
    if (tokens) tokens.onEvent(event, data);
    const visible = state.view;
    for (const c of clients) {
      const tool = toolOfClient(c);
      if (HOME.routeEvent(event, tool, visible) === "live") sendTo(c, event, data);
      else HOME.holdEvent(held.get(tool) || held.set(tool, new Map()).get(tool), event, data);
    }
  }
  /** Replay what a tool missed while hidden, once, now that it is on screen. */
  function flushHeld(toolId) {
    const q = held.get(toolId);
    if (!q || !q.size) return;
    const evs = HOME.takeEvents(q);
    for (const c of clients) if (toolOfClient(c) === toolId) for (const [event, data] of evs) sendTo(c, event, data);
  }

  /** "За: администратор, главен изпълнител": the roles that open a tool (the same lists the access check uses). */
  const forWhom = (t) => (t.for ? t.for[lang === "bg" ? 0 : 1] : HOME.forWhom(toolRoles(t), lang));
  function renderHome() {
    const known = state.accessKnown;
    const okOf = (t) => known && (t.id === "stages" ? canManage() : state.allowed.has(t.id));
    // until the access check answers, every tile is grey in its usual order; then the usable ones come first.
    // A client gets only their usable tiles: no names of internal tools (round 11, L4).
    let tiles = [STAGES_TILE].concat(state.tools);
    if (known && !PROBE && clientOnly(state.access)) tiles = tiles.filter(okOf);
    $("tiles").innerHTML = (known ? HOME.orderTiles(tiles, okOf) : tiles).map((t) => {
      const ok = okOf(t);
      const icon = t.icon || BASE + t.repo + "/icon.svg";
      const who = forWhom(t);
      const tip = ok ? who : known ? L2("Нямате достъп", "No access") + (who ? " – " + who : "") : L2("Проверка на правата…", "Checking access…");
      return `<button class="tile${ok ? "" : known ? " off" : " off wait"}" data-open="${t.id}"${ok ? "" : " disabled"}${tip ? ` title="${esc(tip)}"` : ""}>
        <img src="${esc(icon)}" alt=""><b>${esc(name(t))}</b><span>${esc(ok || !known ? t.sub[lang === "bg" ? 0 : 1] : L2("Нямате достъп", "No access"))}</span>${who ? `<i class="for">${esc(who)}</i>` : ""}</button>`;
    }).join("");
    // "Продължи: Стомана · Сграда А": the last tool + stage of this user in this project. Grey until access is known,
    // hidden when the tool is no longer allowed. The stage's current name once the stages are read (a deleted stage:
    // the tool alone; the click then offers the stage screen).
    const r = state.last, b = $("btnResume");
    const rt = r && state.tools.find((x) => x.id === r.tool);
    if (!rt || (known && !state.allowed.has(rt.id))) b.hidden = true;
    else {
      let stageName = r.stageId ? r.stageName : "";
      if (r.stageId && state.stagesLoaded) { const s = ST.forTool(state.stages, rt.id).find((x) => x.id === r.stageId); stageName = s ? s.name : ""; }
      b.hidden = false;
      b.disabled = !known;
      b.textContent = "▶ " + HOME.resumeLabel(name(rt), stageName, lang);
    }
    for (const t of state.tools) if (state.allowed.has(t.id)) versionOf(t);   // ask early, so opening a tool is not delayed
  }
  function render() {
    if (state.denied) return;   // the no-access message replaced the page
    const home = state.view === "home", stg = state.view === "stages";
    $("home").hidden = !home;
    $("stages").hidden = !stg;
    $("bar").hidden = home || stg;
    $("frames").hidden = home || stg;   // the start / stage screens get the whole height
    if (stg) renderStages();
    if (home) {
      renderHome();
    } else {
      const t = state.tools.find((x) => x.id === state.view);
      $("barName").textContent = t ? name(t) : "";
      $("btnHome").textContent = "⌂ " + L2("Начало", "Home");
      const cur = t && state.current[t.id];
      $("barStage").textContent = cur ? "· " + cur : "";
      $("btnStage").textContent = cur ? L2("Смени", "Change") : L2("Етапи", "Stages");
      $("btnStage").hidden = !t || !ST.forTool(state.stages, t.id).length;
    }
    for (const t of state.tools) {
      let f = document.getElementById("f_" + t.id);
      if (state.view === t.id && !f) {
        f = document.createElement("iframe");
        f.id = "f_" + t.id;
        f.allow = "camera; clipboard-write";
        $("frames").appendChild(f);
        const frame = f;
        toolUrl(t).then((u) => { if (!frame.getAttribute("src")) frame.src = u; });
      }
      if (f) f.hidden = state.view !== t.id;
    }
    if (state.view !== "home" && state.view !== "stages") flushHeld(state.view);
  }
  // Versioned tool URLs (A4, 16.11.2026): scripts/release.mjs publishes version.json per tool; loading
  // index.html?shell=1&v=<id> means a release is picked up at once instead of after GitHub Pages' ~10 min cache.
  // No version.json (older release) or no answer within 2.5 s: the plain URL, as before.
  // A failed fetch is not kept, and an answer older than a minute is asked again, so a shell left open picks up a release.
  const versions = new Map();   // tool id -> {at, p}
  function versionOf(t) {
    if (t.local) return Promise.resolve("");
    const hit = versions.get(t.id);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 2500);
    const entry = { at: Date.now(), p: null };
    entry.p = fetch(BASE + t.repo + "/version.json?nc=" + Date.now(), { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then((r) => { if (r.status === 404) entry.missing = true; return r.ok ? r.json() : null; })
      .then((v) => (v && v.id ? String(v.id) : ""))
      .catch(() => "")
      // keep a found id, and a definite 404 (a tool published without version.json, e.g. Документи: no point asking on
      // every screen); drop timeouts and other failures so the next screen asks again (round 13 L4)
      .then((id) => { if (!id && !entry.missing && versions.get(t.id) === entry) versions.delete(t.id); return id; })
      .finally(() => clearTimeout(timer));
    versions.set(t.id, entry);
    return entry.p;
  }
  async function toolUrl(t) {
    if (t.local) return t.local;
    const v = await versionOf(t);
    return BASE + t.repo + "/index.html?shell=1" + (v ? "&v=" + encodeURIComponent(v) : "");
  }
  // no group names on the start screen (round 11, L4: a client must not read "00_ADMIN")
  const STAGES_TILE = { id: "stages", bg: "Етапи", en: "Stages", sub: ["Сгради, модели, изгледи", "Buildings, models, views"], icon: "stages.svg",
    for: ["За: администратор и ръководител изпълнение", "For: admin and the execution project manager"] };
  /** The roles that open a tool (its own list, or its app kind's list in arsten-access.js). */
  const toolRoles = (t) => t.roles || (window.ArstenAccess && ArstenAccess.APPS && ArstenAccess.APPS[t.app]) || [];
  /** May this user open the tool? Any of the user's roles counts (round 11, M4 / L5: a client who is also in 4.1 is a
   *  designer too, so Авторски надзор opens here exactly when it opens inside the tool). */
  const toolAllowed = (t, access) => toolRoles(t).some((r) => ArstenAccess.hasRole(access, r));
  /** A client (no admin / GC / designer role as well) sees only the tiles they can use (round 11, L4). */
  const clientOnly = (access) => ArstenAccess.hasRole(access, "client") && !["admin", "gc", "designer"].some((r) => ArstenAccess.hasRole(access, r));
  function open(id) {
    if (id !== "home" && !state.allowed.has(id)) return;
    state.view = id;
    if (id !== "home") remember(id);
    render();
  }
  /** Remember the tool just opened and its stage (none: "Текущ модел" or no stages), per user and project. */
  function remember(tool) {
    const s = state.currentStage && state.currentStage[tool];
    state.last = s ? { tool, stageId: s.id, stageName: s.name } : { tool };
    HOME.writeLast(storage(), state.lastKey, state.last);
  }
  /** Wait (at most ms) for the first stages read, so a click right after the start screen appears still sees the
   *  stages. Returns false when the user left the start screen meanwhile or another open is running. */
  async function stagesFirstRead(ms) {
    if (state.stagesLoaded) return true;
    if (state.opening) return false;
    state.opening = true;
    setStatus(L2("Зареждане на етапите…", "Loading stages…"));
    try { await Promise.race([state.stagesReady || startStages(), new Promise((r) => setTimeout(r, ms))]); }
    finally { state.opening = false; setStatus(""); }
    return state.view === "home";
  }
  /** Start-screen click: the stage screen first when the tool has stages (Монолитен бетон and Стомана always did,
   *  user 15.11.2026; week 3 A4: only when stages exist for that tool), else the tool opens straight away. */
  async function openTool(id) {
    if (id === "stages") { if (!canManage()) return; showStages(null); return; }
    if (!state.allowed.has(id)) return;
    if (!(await stagesFirstRead(4000))) return;
    if (ST.forTool(state.stages, id).length) showStages(id);
    else open(id);
  }
  /** "Продължи": straight into the remembered tool and stage. A stage deleted meanwhile: as a tile click. */
  async function resume() {
    const r = state.last;
    if (!r || !state.accessKnown || !state.allowed.has(r.tool) || state.busy) return;
    if (!r.stageId) { open(r.tool); return; }
    if (!(await stagesFirstRead(4000))) return;
    const s = ST.forTool(state.stages, r.tool).find((x) => x.id === r.stageId);
    if (!s) { openTool(r.tool); return; }
    // already the loaded stage of that tool (went home and back): no reload, no camera move
    if (state.currentStage && state.currentStage[r.tool] && state.currentStage[r.tool].id === s.id) { open(r.tool); return; }
    state.stageTool = r.tool;
    applyStage(s);
  }
  /** The stage screen (tool = null: the "Етапи" module). Shown at once with what is known, then refreshed from the
   *  server, so stages another manager added or deleted meanwhile appear (review round 2, #14). */
  function showStages(tool) {
    state.stageTool = tool; state.form = null; state.view = "stages"; render();
    refreshStages().then(() => { if (state.view === "stages" && !state.form) render(); });
  }
  $("tiles").addEventListener("click", (e) => { const b = e.target.closest("button[data-open]"); if (b && !b.disabled) openTool(b.dataset.open); });
  $("btnResume").onclick = () => resume();
  $("btnHome").onclick = () => open("home");
  $("btnStHome").onclick = () => open("home");
  $("btnStage").onclick = () => showStages(state.view);

  // ---------- stages ----------
  function renderStages() {
    const manage = !state.stageTool;   // the "Етапи" module itself
    const t = manage ? STAGES_TILE : state.tools.find((x) => x.id === state.stageTool);
    if (!t) return;
    const list = manage ? state.stages : ST.forTool(state.stages, t.id);
    const iconOf = (s) => { const first = state.tools.find((x) => ST.toolsOf(s)[0] === x.id); return manage ? (first ? first.icon || BASE + first.repo + "/icon.svg" : "stages.svg") : t.icon || BASE + t.repo + "/icon.svg"; };
    const toolNames = (s) => ST.toolsOf(s).map((id) => { const x = state.tools.find((y) => y.id === id); return x ? name(x) : id; }).join(", ");
    $("btnStHome").textContent = "⌂ " + L2("Начало", "Home");
    $("stTitle").textContent = manage ? L2("Етапи на проекта", "Project stages") : name(t) + " – " + L2("изберете етап", "choose a stage");
    $("stTiles").innerHTML = list.map((s) => `<div class="tile stage" role="button" tabindex="0" data-stage="${esc(s.id)}">
        ${manage && canEdit() ? `<span class="ed" data-edit="${esc(s.id)}" title="${esc(L2("Промени", "Edit"))}">✎</span>` : ""}
        <img src="${esc(iconOf(s))}" alt=""><b>${esc(s.name)}</b><span>${esc(ST.describe(s, lang))}${manage ? `<br>→ ${esc(toolNames(s))}` : ""}</span></div>`).join("")
      + (manage ? "" : `<div class="tile cur" role="button" tabindex="0" data-stage="__current"><div class="plus">▶</div><b>${esc(L2("Текущ модел", "Current model"))}</b><span>${esc(L2("Без смяна на модела", "Keep what is loaded"))}</span></div>`)
      + (manage && canEdit() ? `<div class="tile add" role="button" tabindex="0" data-add="1"><div class="plus">+</div><b>${esc(L2("Нов етап", "New stage"))}</b><span>${esc(L2("Модел или изглед", "Model or view"))}</span></div>` : "")
      + (state.store && state.store.error
        ? `<div class="sub bad">${esc(L2("Етапите не са достъпни: ", "Stages are not available: ") + (state.store.error === "no-library"
            ? L2("няма достъп до библиотеката CIP/Монолитно.", "no access to the CIP/Монолитно library.") : state.store.error))}</div>`
        : manage && !canEdit() ? `<div class="sub">${esc(L2("Етапите не могат да се променят (няма права в библиотеката).", "Stages cannot be changed (no rights in the library)."))}</div>`
        : manage && state.store && state.store.historyOff ? `<div class="sub">${esc(histOffText())}</div>`
        : manage && canEdit() && state.store && state.store.historyTooBig ? `<div class="sub">${esc(histBigText())}</div>` : "");
    renderForm();
    renderHistory(manage);
  }
  // ---------- stages history (B-Admin 9, week 4): the last 10 versions, "Върни тази версия" for the stages right ----------
  function renderHistory(manage) {
    let box = $("stHist");
    if (!box) { box = document.createElement("div"); box.id = "stHist"; box.className = "form"; $("stTiles").insertAdjacentElement("afterend", box); }
    const hist = (state.store && state.store.history) || [];
    box.hidden = !(manage && canEdit() && !state.form && hist.length);
    if (box.hidden) { box.innerHTML = ""; return; }
    box.innerHTML = `<details${state.histOpen ? " open" : ""}><summary>${esc(L2(`История на етапите (последни ${hist.length})`, `Stages history (last ${hist.length})`))}</summary>
      <div class="sub">${esc(L2("Всяко записване пази предишната версия. „Върни тази версия“ я записва отново; текущата отива в историята.", "Every save keeps the previous version. \"Restore this version\" saves it again; the current one goes into the history."))}</div>
      ${hist.map((e, i) => `<div class="bar" style="align-items:center;gap:6px;margin:4px 0"><span class="sub" style="flex:1">${esc(ST.describeVersion(e, lang))}</span>
        <button class="small secondary" data-restore="${i}">${esc(L2("Върни тази версия", "Restore this version"))}</button></div>`).join("")}</details>`;
    const d = box.querySelector("details");
    d.ontoggle = () => { state.histOpen = d.open; };
    box.querySelectorAll("[data-restore]").forEach((b) => { b.onclick = () => restoreVersion(hist[+b.dataset.restore], b); });
  }
  /** Confirm on the button itself (window.confirm can be blocked in Connect's iframe), then a versioned save. */
  async function restoreVersion(entry, b) {
    if (!entry || !canEdit()) return;
    if (!b.dataset.sure) {
      b.dataset.sure = "1";
      const when = ST.fmtUpdated(entry.updated, lang);   // local time, shared date format (round 15, L5)
      b.textContent = L2(`Потвърди: ${entry.stages.length} ${entry.stages.length === 1 ? "етап" : "етапа"} от ${when}`, `Confirm: ${entry.stages.length} ${entry.stages.length === 1 ? "stage" : "stages"} from ${when}`);
      setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = L2("Върни тази версия", "Restore this version"); } }, 5000);
      return;
    }
    if (state.busy) return;
    state.busy = true;
    try {
      state.saveSeq = (state.saveSeq || 0) + 1;
      state.stages = await state.store.restore(entry);
      state.saveSeq++;
      const when = ST.fmtUpdated(entry.updated, lang);
      setStatus(L2(`Върната е версията от ${when}.`, `Restored the version of ${when}.`) + histNote()); render();
    } catch (e) { setStatus(saveError(e), true); }
    finally { state.busy = false; }
  }
  async function applyStage(stage) {
    const api = state.api, tool = state.stageTool;
    if (state.busy) return;
    state.busy = true;
    setStatus(L2("Зареждане на ", "Loading ") + stage.name + "…");
    try {
      let failed = [];
      if (stage.kind === "view") {
        await api.view.selectView(stage.viewId);
        // a saved view sets its own models: no other tool's stage can be assumed current any more (round 3, L5)
        for (const t of Object.keys(state.currentStage || {})) if (t !== tool) { delete state.current[t]; delete state.currentStage[t]; }
      } else {
        const p = ST.plan(stage, (await api.viewer.getModels()) || []);
        // no zoom while loading: one camera move at the end, after the old stage's models are gone (round 5, L8)
        if (p.load.length) await api.viewer.toggleModel(p.load, true, false);
        // a model not in the viewer's list yet can still be loaded by its file id; one at a time, so a model deleted
        // from the project does not stop the rest of the stage (review round 2, #6)
        for (const m of p.missing) {
          try { await api.viewer.toggleModel([m.id], true, false); } catch (e) { failed.push(m); }
        }
        if (p.unload.length) await api.viewer.toggleModel(p.unload, false);
        // a deleted file id may be ignored silently instead of refused: report stage models the viewer lists as not
        // loaded. Models it does not list are not reported: getModels is lazy and may not list them yet (round 4, L6)
        try {
          const now = new Map(((await api.viewer.getModels()) || []).map((m) => [m.id, m.state]));
          for (const m of stage.models || []) if (!failed.includes(m) && now.get(m.id) === "unloaded") failed.push(m);
        } catch {}
        // end in the viewer's default 3D (axon) view of what is loaded now (user, 15.11.2026): the camera used to stay
        // on the previous stage. The Workspace API has no "axon" preset; "reset" is the default 3D camera fitted to the
        // loaded models. This replaces the fit on the last load call (round 3 L4 / round 4 L7, round 5 L8).
        const okIds = (stage.models || []).filter((m) => !failed.includes(m)).map((m) => m.id);
        if (okIds.length) { try { await api.viewer.setCamera("reset", { animationTime: 400 }); } catch {} }
        // other tools' stages whose models were just unloaded are no longer current (#13)
        const want = new Set((stage.models || []).map((m) => m.id));
        for (const [t, s] of Object.entries(state.currentStage || {})) {
          if (t !== tool && s && (s.kind === "view" || (s.models || []).some((m) => !want.has(m.id)))) { delete state.current[t]; delete state.currentStage[t]; }
        }
      }
      setStatus(failed.length ? L2("Не можаха да се заредят (изтрити или преместени?): ", "Could not be loaded (deleted or moved?): ")
        + failed.map((m) => m.name).join(", ") : "", !!failed.length);
      state.current[tool] = stage.name;
      (state.currentStage || (state.currentStage = {}))[tool] = stage;
      open(tool);
    } catch (e) { setStatus(L2("Етапът не можа да се зареди: ", "Could not load the stage: ") + ((e && e.message) || e), true); }
    finally { state.busy = false; }
  }
  $("stTiles").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { e.stopPropagation(); startForm(state.stages.find((s) => s.id === ed.dataset.edit)); return; }
    const add = e.target.closest("[data-add]");
    if (add) { startForm(null); return; }
    const t = e.target.closest("[data-stage]");
    if (!t) return;
    if (t.dataset.stage === "__current") { delete state.current[state.stageTool]; if (state.currentStage) delete state.currentStage[state.stageTool]; open(state.stageTool); return; }
    const s = state.stages.find((x) => x.id === t.dataset.stage);
    if (s && !state.stageTool) { if (canEdit()) startForm(s); return; }
    if (s) applyStage(s);
  });
  $("stTiles").addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = e.target.closest("[role=button]"); if (t) t.click(); } });

  /** Every 3D model file in the project (viewer.getModels() lists only the models already in the viewer), with its
   *  folder; state from the viewer where it knows it. One Core API call (files/fs/snapshot), paged. */
  const MODEL_EXT = /\.(ifc|ifczip|trb|tekla|rvt|nwc|nwd|skp|dwg)$/i;
  async function projectModels() {
    const api = state.api;
    let inViewer = [];
    try { inViewer = (await api.viewer.getModels()) || []; } catch {}
    if (PROBE || !state.project) return inViewer.filter((m) => ["loaded", "assimilated", "unloaded"].includes(m.state));
    const base = ArstenAccess.coreBase(state.project.location);
    const items = [];
    let url = `${base}files/fs/snapshot?projectId=${encodeURIComponent(state.project.id)}`;
    for (let guard = 0; url && guard < 50; guard++) {
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        const r = await fetch(url, { headers: { Authorization: "Bearer " + (await tokens.getToken(attempt > 0)) } });
        if (r.status === 401 && attempt === 0) continue;
        if (!r.ok) throw new Error("files/fs/snapshot: " + r.status);
        res = await r.json();
      }
      if (Array.isArray(res)) { items.push(...res); break; }
      items.push(...((res && res.items) || []));
      url = res && res.next ? (/^https?:/.test(res.next) ? res.next : base + String(res.next).replace(/^\/+/, "")) : null;
    }
    const byId = new Map(items.map((x) => [x.id, x]));
    const state0 = new Map(inViewer.map((m) => [m.id, m.state]));
    const models = items.filter((x) => String(x.tp).toUpperCase() === "FILE" && !x.del && MODEL_EXT.test(x.nm || ""))
      .map((x) => ({ id: x.id, name: x.nm, parent: x.pid, folder: (byId.get(x.pid) || {}).nm || "", state: state0.get(x.id) || "unloaded" }));
    models.folders = items.filter((x) => String(x.tp).toUpperCase() === "FOLDER" && !x.del).map((x) => ({ id: x.id, name: x.nm, parent: x.pid }));
    return models;
  }

  // form: name, models (tick boxes) or a saved view
  async function startForm(stage) {
    const api = state.api;
    let models = [], views = [];
    try { models = await projectModels(); }
    catch (e) { console.warn(e); try { models = ((await api.viewer.getModels()) || []).filter((m) => ["loaded", "assimilated", "unloaded"].includes(m.state)); } catch {} }
    try { views = (await api.view.getViews()) || []; } catch {}
    state.form = { stage, models, views, kind: (stage && stage.kind) || "models", tools: stage ? ST.toolsOf(stage) : [] };
    renderForm();
  }
  function renderForm() {
    const f = state.form, box = $("stForm");
    if (!f) { box.hidden = true; box.innerHTML = ""; return; }
    const s = f.stage || {}, chosen = new Set(f.chosen || (s.models || []).map((m) => m.id));
    const known = new Set(f.models.map((m) => m.id));
    const gone = (s.models || []).filter((m) => !known.has(m.id));   // deleted / moved models of this stage (#15)
    box.hidden = false;
    box.innerHTML = `<b>${esc(f.stage ? L2("Промяна на етап", "Edit stage") : L2("Нов етап", "New stage"))}</b>
      <label>${esc(L2("Име (напр. Сграда А)", "Name (e.g. Building A)"))}</label><input type="text" id="fName" value="${esc(f.name != null ? f.name : s.name || "")}">
      <label>${esc(L2("За кои модули", "For which modules"))}</label>
      <div class="row" style="flex-wrap:wrap">${STAGE_TOOLS().map((x) => `<label><input type="checkbox" class="fTool" value="${esc(x.id)}"${(f.tools || ST.toolsOf(s)).includes(x.id) ? " checked" : ""}> ${esc(name(x))}</label>`).join("")}</div>
      <label>${esc(L2("Какво да се отваря", "What to open"))}</label>
      <div class="row"><label><input type="radio" name="fKind" value="models"${f.kind === "models" ? " checked" : ""}> ${esc(L2("Модел(и)", "Model(s)"))}</label>
        <label><input type="radio" name="fKind" value="view"${f.kind === "view" ? " checked" : ""}> ${esc(L2("Изглед", "View"))}</label></div>
      ${f.kind === "models"
        ? `<label>${esc(L2("Модели (папките на проекта)", "Models (project folders)"))}</label><div class="opts tree">${modelTree(f, chosen) || esc(L2("Няма модели.", "No models."))}</div>
           ${gone.length ? `<div class="sub bad">${esc(L2("Липсват в проекта (ще отпаднат при запис): ", "No longer in the project (dropped on save): ") + gone.map((m) => m.name).join(", "))}</div>` : ""}`
        : `<label>${esc(L2("Изглед", "View"))}</label><select id="fView">${f.views.map((v) => `<option value="${esc(v.id)}"${s.viewId === v.id ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
           ${f.views.length ? "" : `<div class="sub">${esc(L2("Няма запазени изгледи в проекта.", "No saved views in the project."))}</div>`}`}
      <div class="acts"><button id="fSave">${esc(L2("Запази", "Save"))}</button><button class="sec" id="fCancel">${esc(L2("Отказ", "Cancel"))}</button>
        ${f.stage ? `<button class="del" id="fDel">${esc(L2("Изтрий", "Delete"))}</button>` : ""}</div>`;
    // keep what was typed / ticked when switching between models and view
    const keep = () => { f.name = $("fName").value; f.tools = [...box.querySelectorAll(".fTool:checked")].map((c) => c.value);
      const ticks = box.querySelectorAll(".opts input"); if (ticks.length) f.chosen = [...ticks].filter((c) => c.checked).map((c) => c.value); };
    box.querySelectorAll("input[name=fKind]").forEach((r) => { r.onchange = () => { keep(); f.kind = r.value; renderForm(); }; });
    $("fCancel").onclick = () => { state.form = null; renderForm(); };
    $("fSave").onclick = () => saveForm().catch((e) => setStatus(saveError(e), true));
    if ($("fDel")) $("fDel").onclick = () => removeStage(f.stage).catch((e) => setStatus(saveError(e), true));
  }
  /** The project's folders with their model files, as in Connect's Models panel; folders open where a chosen model is. */
  function modelTree(f, chosen) {
    const nodes = f.models.folders ? ST.tree(f.models.folders, f.models) : f.models.map((m) => Object.assign({ type: "file" }, m));
    const has = (n) => (n.type === "file" ? chosen.has(n.id) : n.children.some(has));
    const draw = (list) => list.map((n) => n.type === "folder"
      ? `<details${has(n) ? " open" : ""}><summary>📁 ${esc(n.name)}</summary><div class="kids">${draw(n.children)}</div></details>`
      : `<label><input type="checkbox" value="${esc(n.id)}" data-name="${esc(n.name)}"${chosen.has(n.id) ? " checked" : ""}> ${esc(n.name)}${n.state === "loaded" ? ` <span style="color:var(--accent);font-size:10.5px">● ${esc(L2("зареден", "loaded"))}</span>` : ""}</label>`).join("");
    return draw(nodes);
  }
  async function saveForm() {
    const f = state.form, nm = $("fName").value.trim();
    if (!nm) return setStatus(L2("Въведете име.", "Enter a name."), true);
    const tools = [...$("stForm").querySelectorAll(".fTool:checked")].map((c) => c.value);
    if (!tools.length) return setStatus(L2("Изберете поне един модул.", "Choose at least one module."), true);
    const stage = { id: (f.stage && f.stage.id) || ST.newId(), tools, name: nm, kind: f.kind };
    if (f.kind === "models") {
      stage.models = [...$("stForm").querySelectorAll(".opts input:checked")].map((c) => ({ id: c.value, name: c.dataset.name }));
      if (!stage.models.length) return setStatus(L2("Изберете поне един модел.", "Choose at least one model."), true);
    } else {
      const sel = $("fView");
      if (!sel || !sel.value) return setStatus(L2("Изберете изглед.", "Choose a view."), true);
      stage.viewId = sel.value; stage.viewName = sel.options[sel.selectedIndex].text;
    }
    if (state.busy) return;
    state.busy = true;
    try {
      state.saveSeq = (state.saveSeq || 0) + 1;
      state.stages = await state.store.save((cur) => {
        // editing a stage another manager deleted meanwhile must not bring it back (#14)
        if (f.stage && !cur.some((x) => x.id === stage.id)) throw new Error(L2("Етапът е изтрит от друг потребител.", "The stage was deleted by someone else."));
        if (!f.stage) return cur.concat(stage);
        // ... nor silently undo another manager's edit of the same stage (round 3, L6)
        const stored = cur.find((x) => x.id === stage.id);
        const mine = Object.assign({}, stored, stage);   // a retry after our own write (round 4, L5)
        if (JSON.stringify(stored) !== JSON.stringify(f.stage) && JSON.stringify(stored) !== JSON.stringify(mine)) throw new Error(L2("Етапът е променен от друг потребител – отворете го отново.", "The stage was changed by someone else – open it again."));
        // replaced in place (keeps the order and any fields this version does not know)
        return cur.map((x) => (x.id === stage.id ? Object.assign({}, x, stage) : x));
      });
      state.saveSeq++;
      state.form = null; setStatus(L2("Етапът е запазен.", "Stage saved.") + histNote()); render();
    } catch (e) {
      if (e && e.current) { state.stages = e.current; state.form = null; render(); }   // reopen gives the stored version (round 4, L1)
      setStatus(saveError(e), true);
    }
    finally { state.busy = false; }
  }
  /** A refused save as a sentence: 403 = no Edit right on the Stages definition in the library (round 3, L2). */
  function saveError(e) {
    if (e && e.status === 403) return L2("Нямате права да променяте етапите (библиотека CIP/Монолитно, дефиниция Stages).", "You may not change stages (library CIP/Монолитно, definition Stages).");
    return (e && e.message) || String(e);
  }
  /** Delete with a confirm step on the button itself: window.confirm can be blocked inside Connect's iframe (P2). */
  async function removeStage(stage) {
    const b = $("fDel");
    if (b && !b.dataset.sure) {
      b.dataset.sure = "1";
      b.textContent = L2("Потвърди изтриване", "Confirm delete");
      setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = L2("Изтрий", "Delete"); } }, 5000);
      return;
    }
    if (state.busy) return;
    state.busy = true;
    try {
      state.saveSeq = (state.saveSeq || 0) + 1;
      state.stages = await state.store.save((cur) => cur.filter((x) => x.id !== stage.id));
      state.saveSeq++;
      if (state.currentStage) for (const t of Object.keys(state.currentStage)) if (state.currentStage[t] && state.currentStage[t].id === stage.id) { delete state.currentStage[t]; delete state.current[t]; }
      state.form = null; setStatus(histNote().trim()); render();
    } catch (e) { setStatus(saveError(e), true); }
    finally { state.busy = false; }
  }
  async function loadStages() {
    const local = PROBE;
    const client = !local && window.PsetApi ? new PsetApi.PsetClient({ region: (state.project && state.project.location) || "europe", getToken: tokens.getToken }) : null;
    // writable only with the "stages" capability (round 11, L3): a read-only member never creates or writes anything
    state.store = ST.store({ client, projectId: (state.project && state.project.id) || "probe", user: state.user, local, canWrite: canManage() });
    await refreshStages();
  }
  /** The first stages read, in the background (week 3 A4: it no longer holds back the start screen). Once. */
  function startStages() {
    if (!state.stagesReady) {
      state.stagesReady = loadStages().catch((e) => console.warn(e)).then(() => {
        state.stagesLoaded = true;
        if (!state.form && !state.busy && !state.opening) render();   // the bar's "Етапи" button, the resume label
      });
    }
    return state.stagesReady;
  }
  /** Re-read the stages. A result is dropped when a save or delete started or ended meanwhile: it would put the list
   *  from before that save back on screen (review round 3, M9). */
  async function refreshStages() {
    if (!state.store) return;
    const seq = state.saveSeq || 0;
    try { const list = await state.store.load(); if ((state.saveSeq || 0) === seq && !state.busy) state.stages = list; }
    catch (e) { console.warn(e); if (!state.stages) state.stages = []; }   // keep what was shown; the screen shows the error
    // round 15, M2: an old project whose Stages definition has no "history" and this user may not extend it: the stages
    // stay editable (saved without history); a user with the stages right is told once per session. Round 18 M1: load
    // never adds the field, so historyOff is only set by a save in this session (histNote); kept here for refreshes.
    if (state.store.historyOff && canManage() && !state.histOffTold) { state.histOffTold = true; setStatus(histOffText()); }
    else if (histBigOnce()) setStatus(histBigText());
  }
  function histOffText() {
    return L2("Историята на етапите не е включена – администратор: Администрация → Създай липсващите",
      "The stages history is not enabled – administrator: Administration → Create missing");
  }
  // round 17 L5: a stage list over the 20 KB history cap keeps no earlier versions; a user with the stages right is told
  // once per session (after a load or a save that made it so), and the Етапи screen shows it under the tiles
  function histBigText() {
    return L2("Списъкът с етапи е голям – историята не се пази", "The stage list is large – no history is kept");
  }
  /** After a save / restore / delete: " <note>." once per session when the first save just found the history refused
   *  (round 18 M1: "history" is added at the first save, not on load), else the round 17 L5 note, else "". */
  function histNote() {
    if (state.store && state.store.historyOff && canManage() && !state.histOffTold) { state.histOffTold = true; return " " + histOffText() + "."; }
    return histBigOnce() ? " " + histBigText() + "." : "";
  }
  function histBigOnce() {
    if (!state.store || !state.store.historyTooBig || !canManage() || state.histBigTold) return false;
    state.histBigTold = true;
    return true;
  }

  // Local test only (test/host.html on localhost): one probe tool, no access check.
  const PROBE = /^localhost$|^127\.0\.0\.1$/.test(location.hostname) && /[?&]probe\b/.test(location.search);

  async function start(api) {
    state.api = api;
    // the tools connect to this page as if it were Trimble Connect
    // onConnect: each tool that connects is remembered, so events can be sent to it alone (round 12, H1)
    TrimbleConnectWorkspace.expose(Object.assign({}, api, { onConnect: (c) => { if (c && c.identifier) clients.add(c); } }));
    if (PROBE) {
      state.tools = [{ id: "probe", app: "execution", repo: "", bg: "Проба", en: "Probe", sub: ["тест", "test"], local: "test/probe.html", icon: "icon.svg" }].concat(TOOLS.map((t) => Object.assign({}, t, { icon: "icon.svg" })));
      state.allowed = new Set(["probe"]);
      state.lastKey = HOME.lastKey("probe", "probe");
      state.last = HOME.readLast(storage(), state.lastKey, state.tools.map((t) => t.id));
      state.accessKnown = true;
      setStatus(""); render();
      startStages();
      return;
    }
    tokens = ArstenAccess.tokenGetter(api);
    // Week 3 A4: nothing slow before the tiles. The access check (Core API: users, groups, members) starts now and the
    // start screen stays grey until it answers; who and where come from two quick Workspace calls, for the remembered
    // tool. The stages are read the moment the access check grants some tool (round 11, L3: never before, so a member
    // without access reads nothing of the project).
    setStatus(L2("Проверка на правата…", "Checking access…"));
    const accessP = ArstenAccess.check({ api, getToken: tokens.getToken, app: "execution" });
    const whoAmI = (u) => { if (u) { state.user = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || ""; state.userId = u.id || u.email || ""; } };
    try {
      const [p, u] = await Promise.all([api.project.getProject(), api.user.getUser().catch(() => null)]);
      if (p && p.id) state.project = p;
      whoAmI(u);
    } catch {}
    if (I18N) { const l = await I18N.pickLang(api, null); if (l !== lang) { lang = l; render(); } }
    const remembered = () => {
      if (state.lastKey || !state.project || !state.userId) return;
      state.lastKey = HOME.lastKey(state.project.id, state.userId);
      state.last = HOME.readLast(storage(), state.lastKey, TOOLS.map((t) => t.id));
    };
    remembered();
    render();
    if (window.ArstenDiag) ArstenDiag.set({ panel: "Arsten / Multiplan (arsten)", projectId: state.project && state.project.id, lang: () => lang });   // round 19 M1: before the access check, so a denied screen's diagnostics name the panel (and its project)
    const access = await accessP;
    state.access = access;
    // The shell is for everyone any of its tools is for (round 11, L1): the denied text names that audience, not the
    // "execution" list the check ran with. One retry button only: renderDenied's "Провери отново" clears the access
    // cache and reloads (L2; this also covers Connect's first token being refused right after "Allow extension").
    const audience = HOME.audience(TOOLS.map(toolRoles), ArstenAccess.ROLE_ORDER);
    const denied = () => { state.denied = true; ArstenAccess.renderDenied(document.body, lang, Object.assign({}, access, { needs: audience })); };
    if (access.role === "unknown" || access.role === "none") { denied(); return; }
    state.allowed = new Set(TOOLS.filter((t) => toolAllowed(t, access)).map((t) => t.id));
    if (!state.allowed.size) { denied(); return; }
    if (!state.project) state.project = access.project || (await api.project.getProject());
    if (!state.userId) { try { whoAmI(access.user || (await api.user.getUser())); } catch {} }
    remembered();
    if (window.ArstenDiag) ArstenDiag.set({ panel: "Arsten / Multiplan (arsten)", projectId: state.project && state.project.id, redact: [state.user], lang: () => lang });   // A23
    // Round 16 L1: the stages record (with its history: stage, model and view names, editors' names) is read only when
    // this user can open a tool that uses a stage. A summary-only client (Статус without admin / GC) uses none: no read,
    // and every tile opens straight away, as with no stages.
    const summaryOnly = !["admin", "gc"].some((r) => ArstenAccess.hasRole(access, r));
    if (HOME.needsStages([...state.allowed], { manage: canManage(), noStage: summaryOnly ? ["progress"] : [] })) startStages();
    else { state.stages = []; state.stagesLoaded = true; state.stagesReady = Promise.resolve(); }
    state.accessKnown = true;
    setStatus("");
    render();
  }
  window.ArstenShell = { state, TOOLS, open, openTool, resume };

  // a tool switched the language (another document of the same origin wrote "arsten.lang"): the start screen follows
  window.addEventListener("storage", (e) => {
    if (!I18N || e.key !== I18N.KEY || (e.newValue !== "bg" && e.newValue !== "en") || e.newValue === lang) return;
    lang = e.newValue; render();
    if (window.ArstenDiag && ArstenDiag.relabel) ArstenDiag.relabel();   // round 19 L4: "Копирай диагностика" follows too
  });
  if (window.parent === window) { setStatus(I18N ? I18N.word("notInside", lang) : "Not inside Trimble Connect.", true); return; }
  // first paint: the tiles at once, grey, while Connect answers (week 3 A4)
  setStatus(I18N ? I18N.word("connecting", lang) : L2("Свързване с Trimble Connect…", "Connecting to Trimble Connect…"));
  render();
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => { if (!state.denied) $("home").hidden = !state.accessKnown; setStatus((I18N ? I18N.word("connectFail", lang) : "Could not connect to Trimble Connect") + ": " + ((e && e.message) || e), true); });
})();
