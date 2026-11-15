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
  const state = { api: null, access: null, tools: TOOLS, allowed: new Set(), view: "home",
    stages: [], store: null, stageTool: null, current: {}, form: null, busy: false };
  const ST = window.ArstenStages;
  const canEdit = () => !!(state.store && state.store.writable && (PROBE || (state.access && (state.access.role === "admin" || state.access.role === "gc"))));
  const setStatus = (t, bad) => { const s = $("status"); s.hidden = !t; s.textContent = t || ""; s.className = "status" + (bad ? " bad" : ""); };
  const name = (t) => (lang === "bg" ? t.bg : t.en);

  let tokens = null;
  function onEvent(event, data) {
    if (tokens) tokens.onEvent(event, data);
    // every Connect event goes on to the tools (selection, model changes, access token, ...)
    try { TrimbleConnectWorkspace.sendEventToAllClients(event, data); } catch (e) { console.error(e); }
  }

  function render() {
    const home = state.view === "home", stg = state.view === "stages";
    $("home").hidden = !home;
    $("stages").hidden = !stg;
    $("bar").hidden = home || stg;
    $("frames").hidden = home || stg;   // the start / stage screens get the whole height
    if (stg) renderStages();
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
      const cur = t && state.current[t.id];
      $("barStage").textContent = cur ? "· " + cur : "";
      $("btnStage").textContent = cur ? L2("Смени", "Change") : L2("Етапи", "Stages");
      $("btnStage").hidden = !t || (!ST.forTool(state.stages, t.id).length && !canEdit());
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
  /** Start-screen click: a tool with stages first shows them; without stages it opens straight away. */
  function openTool(id) {
    if (!state.allowed.has(id)) return;
    if (ST.forTool(state.stages, id).length) { state.stageTool = id; state.form = null; state.view = "stages"; render(); }
    else open(id);
  }
  $("tiles").addEventListener("click", (e) => { const b = e.target.closest("button[data-open]"); if (b && !b.disabled) openTool(b.dataset.open); });
  $("btnHome").onclick = () => open("home");
  $("btnStHome").onclick = () => open("home");
  $("btnStage").onclick = () => { state.stageTool = state.view; state.form = null; state.view = "stages"; render(); };

  // ---------- stages ----------
  function renderStages() {
    const t = state.tools.find((x) => x.id === state.stageTool);
    if (!t) return;
    const list = ST.forTool(state.stages, t.id);
    const icon = t.icon || BASE + t.repo + "/icon.svg";
    $("btnStHome").textContent = "⌂ " + L2("Начало", "Home");
    $("stTitle").textContent = name(t) + " – " + L2("изберете етап", "choose a stage");
    $("stTiles").innerHTML = list.map((s) => `<div class="tile stage" role="button" tabindex="0" data-stage="${esc(s.id)}">
        ${canEdit() ? `<span class="ed" data-edit="${esc(s.id)}" title="${esc(L2("Промени", "Edit"))}">✎</span>` : ""}
        <img src="${esc(icon)}" alt=""><b>${esc(s.name)}</b><span>${esc(ST.describe(s, lang))}</span></div>`).join("")
      + `<div class="tile cur" role="button" tabindex="0" data-stage="__current"><div class="plus">▶</div><b>${esc(L2("Текущ модел", "Current model"))}</b><span>${esc(L2("Без смяна на модела", "Keep what is loaded"))}</span></div>`
      + (canEdit() ? `<div class="tile add" role="button" tabindex="0" data-add="1"><div class="plus">+</div><b>${esc(L2("Нов етап", "New stage"))}</b><span>${esc(L2("Модел или изглед", "Model or view"))}</span></div>` : "");
    renderForm();
  }
  async function applyStage(stage) {
    const api = state.api, tool = state.stageTool;
    if (state.busy) return;
    state.busy = true;
    setStatus(L2("Зареждане на ", "Loading ") + stage.name + "…");
    try {
      if (stage.kind === "view") await api.view.selectView(stage.viewId);
      else {
        const p = ST.plan(stage, (await api.viewer.getModels()) || []);
        // a model that is not in the viewer's list yet can still be loaded by its file id
        const load = p.load.concat(p.missing.map((m) => m.id));
        p.missing = [];
        if (load.length) await api.viewer.toggleModel(load, true, true);
        if (p.unload.length) await api.viewer.toggleModel(p.unload, false);
        if (p.missing.length) setStatus(L2("Липсват модели: ", "Missing models: ") + p.missing.map((m) => m.name).join(", "), true);
        else setStatus("");
      }
      if (stage.kind === "view") setStatus("");
      state.current[tool] = stage.name;
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
    if (t.dataset.stage === "__current") { delete state.current[state.stageTool]; open(state.stageTool); return; }
    const s = state.stages.find((x) => x.id === t.dataset.stage);
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
    state.form = { stage, models, views, kind: (stage && stage.kind) || "models" };
    renderForm();
  }
  function renderForm() {
    const f = state.form, box = $("stForm");
    if (!f) { box.hidden = true; box.innerHTML = ""; return; }
    const s = f.stage || {}, chosen = new Set(f.chosen || (s.models || []).map((m) => m.id));
    box.hidden = false;
    box.innerHTML = `<b>${esc(f.stage ? L2("Промяна на етап", "Edit stage") : L2("Нов етап", "New stage"))}</b>
      <label>${esc(L2("Име (напр. Сграда А)", "Name (e.g. Building A)"))}</label><input type="text" id="fName" value="${esc(f.name != null ? f.name : s.name || "")}">
      <label>${esc(L2("Какво да се отваря", "What to open"))}</label>
      <div class="row"><label><input type="radio" name="fKind" value="models"${f.kind === "models" ? " checked" : ""}> ${esc(L2("Модел(и)", "Model(s)"))}</label>
        <label><input type="radio" name="fKind" value="view"${f.kind === "view" ? " checked" : ""}> ${esc(L2("Изглед", "View"))}</label></div>
      ${f.kind === "models"
        ? `<label>${esc(L2("Модели (папките на проекта)", "Models (project folders)"))}</label><div class="opts tree">${modelTree(f, chosen) || esc(L2("Няма модели.", "No models."))}</div>`
        : `<label>${esc(L2("Изглед", "View"))}</label><select id="fView">${f.views.map((v) => `<option value="${esc(v.id)}"${s.viewId === v.id ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
           ${f.views.length ? "" : `<div class="sub">${esc(L2("Няма запазени изгледи в проекта.", "No saved views in the project."))}</div>`}`}
      <div class="acts"><button id="fSave">${esc(L2("Запази", "Save"))}</button><button class="sec" id="fCancel">${esc(L2("Отказ", "Cancel"))}</button>
        ${f.stage ? `<button class="del" id="fDel">${esc(L2("Изтрий", "Delete"))}</button>` : ""}</div>`;
    // keep what was typed / ticked when switching between models and view
    const keep = () => { f.name = $("fName").value; const ticks = box.querySelectorAll(".opts input"); if (ticks.length) f.chosen = [...ticks].filter((c) => c.checked).map((c) => c.value); };
    box.querySelectorAll("input[name=fKind]").forEach((r) => { r.onchange = () => { keep(); f.kind = r.value; renderForm(); }; });
    $("fCancel").onclick = () => { state.form = null; renderForm(); };
    $("fSave").onclick = () => saveForm().catch((e) => setStatus(((e && e.message) || e), true));
    if ($("fDel")) $("fDel").onclick = () => removeStage(f.stage).catch((e) => setStatus(((e && e.message) || e), true));
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
    const stage = { id: (f.stage && f.stage.id) || ST.newId(), tool: state.stageTool, name: nm, kind: f.kind };
    if (f.kind === "models") {
      stage.models = [...$("stForm").querySelectorAll(".opts input:checked")].map((c) => ({ id: c.value, name: c.dataset.name }));
      if (!stage.models.length) return setStatus(L2("Изберете поне един модел.", "Choose at least one model."), true);
    } else {
      const sel = $("fView");
      if (!sel || !sel.value) return setStatus(L2("Изберете изглед.", "Choose a view."), true);
      stage.viewId = sel.value; stage.viewName = sel.options[sel.selectedIndex].text;
    }
    state.stages = await state.store.save((cur) => cur.filter((x) => x.id !== stage.id).concat(stage));
    state.form = null; setStatus(L2("Етапът е запазен.", "Stage saved.")); render();
  }
  async function removeStage(stage) {
    if (!window.confirm(L2(`Да се изтрие ли етап „${stage.name}“?`, `Delete stage "${stage.name}"?`))) return;
    state.stages = await state.store.save((cur) => cur.filter((x) => x.id !== stage.id));
    state.form = null; setStatus(""); render();
  }
  async function loadStages() {
    const local = PROBE;
    const client = !local && window.PsetApi ? new PsetApi.PsetClient({ region: (state.project && state.project.location) || "europe", getToken: tokens.getToken }) : null;
    state.store = ST.store({ client, projectId: (state.project && state.project.id) || "probe", user: state.user, local });
    try { state.stages = await state.store.load(); } catch (e) { console.warn(e); state.stages = []; }
  }

  // Local test only (test/host.html on localhost): one probe tool, no access check.
  const PROBE = /^localhost$|^127\.0\.0\.1$/.test(location.hostname) && /[?&]probe\b/.test(location.search);

  async function start(api) {
    state.api = api;
    // the tools connect to this page as if it were Trimble Connect
    TrimbleConnectWorkspace.expose(api);
    if (PROBE) {
      state.tools = [{ id: "probe", app: "execution", repo: "", bg: "Проба", en: "Probe", sub: ["тест", "test"], local: "test/probe.html", icon: "icon.svg" }].concat(TOOLS.map((t) => Object.assign({}, t, { icon: "icon.svg" })));
      state.allowed = new Set(["probe"]);
      await loadStages();
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
    state.project = access.project || (await api.project.getProject());
    try { const u = access.user || (await api.user.getUser()); state.user = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || ""; } catch {}
    await loadStages();
    setStatus("");
    render();
  }
  window.ArstenShell = { state, TOOLS, open, openTool };

  if (window.parent === window) { setStatus("Not inside Trimble Connect. Add this extension to a project and open it from the 3D viewer side panel.", true); return; }
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => setStatus("Could not connect to Trimble Connect: " + ((e && e.message) || e), true));
})();
