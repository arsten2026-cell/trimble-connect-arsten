// Arsten / MULTIPLAN – "Етапи" (stages): named model sets or saved Connect views per tool, chosen before a tool opens
// (user, 15.11.2026: "I can select a view or a model that will stay there until I change … I should be able to add a second one").
// A stage: {id, tool, name, kind: "models"|"view", models: [{id, name}], viewId, viewName}.
// Stored ONCE per project, shared by everyone: pset library CIP/Монолитно, definition "stages",
// link frn:entity:ARSTENSTAGES-{projectId}, prop "json". Only 00_ADMIN and 02.1-EXECUTION PROJECT MANAGER can edit
// (library access: the Stages definition is Edit for those two groups, Read for everyone else);
// everyone else reads. localStorage is used only by the local test page.
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.ArstenStages = lib;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LIB_NAMES = ["CIP/Монолитно", "Arsten Pour Status"];
  const DEF_ID = "stages";
  const link = (projectId) => `frn:entity:ARSTENSTAGES-${projectId}`;
  /** withoutHistory (round 15, M2): the definition as it was before week 4, used only to check that an old definition
   *  exists when adding "history" to it was refused. */
  function definition(withoutHistory) {
    const S = { type: "string" };
    // "history" (B-Admin 9, week 4): the last HISTORY_MAX earlier versions. Also in AM_TEMPLATE. Round 18 M1: an
    // existing definition without it gets it only on the first save / restore by a stages manager (never on load).
    const fields = [["json", S, "Stages (JSON) / Етапи"], ["updated", S, "Updated / Обновено"], ["by", S, "By / От"]];
    if (!withoutHistory) fields.push(["history", S, "History (JSON) / История"]);
    const props = {}, labels = {}, order = {};
    fields.forEach(([k, s, l], i) => { props[k] = s; labels[k] = l; order[k] = String(i); });
    return { id: DEF_ID, name: "Stages / Етапи (Arsten / MULTIPLAN)", description: "Named model sets and views per tool, chosen before a tool opens.", schema: { props },
      i18n: { "en-US": { name: "Stages / Етапи", props: labels }, "__prop-order__": { name: "__prop-order__", props: order } } };
  }

  // a stage applies to several tools: {tools: ["pour", "steel", ...]}; older records had one "tool"
  const toolsOf = (s) => (Array.isArray(s.tools) ? s.tools : s.tool ? [s.tool] : []);
  const parse = (s) => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.filter((x) => x && x.id && x.name && toolsOf(x).length).map((x) => Object.assign({}, x, { tools: toolsOf(x) })) : []; } catch { return []; } };
  const forTool = (stages, tool) => stages.filter((s) => toolsOf(s).includes(tool));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- history (B-Admin 9, week 4) ----------
  // Each save keeps the version it replaces in the same record, field "history": a JSON array, newest first, of
  // {json, updated, by} (the earlier "json" string exactly as stored), at most HISTORY_MAX entries and HISTORY_BYTES
  // UTF-8 bytes in all (oldest dropped first). "Върни тази версия" saves an old list as a normal change, so the
  // replaced list goes into the history too (a restore can be undone the same way).
  // Round 15, M1: the pset service's string limit is not documented. Was 60 000 JS characters (Cyrillic is 2 bytes
  // each, so up to ~120 KB); now ~20 KB counted in UTF-8 bytes. HISTORY_CHARS stays as an alias for older callers.
  const HISTORY_MAX = 10, HISTORY_BYTES = 20000, HISTORY_CHARS = HISTORY_BYTES;
  /** Length of s in UTF-8 bytes (TextEncoder; a counting fallback where it is missing). */
  function utf8Len(s) {
    s = String(s);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  /** History entries from the stored string (bad entries dropped): [{json, updated, by, stages}]. */
  function parseHistory(s) {
    let a = [];
    try { a = JSON.parse(s || "[]"); } catch { return []; }
    return (Array.isArray(a) ? a : []).filter((e) => e && typeof e.json === "string")
      .map((e) => ({ json: e.json, updated: String(e.updated || ""), by: String(e.by || ""), stages: parse(e.json) }));
  }
  /** The new history string after replacing the version prev {json, updated, by}. Unchanged when prev has no stages
   *  record yet (first save) or its json equals the newest entry, or when nextJson equals prev (nothing replaced). */
  function pushHistory(historyStr, prev, nextJson) {
    const list = parseHistory(historyStr).map(({ json, updated, by }) => ({ json, updated, by }));
    if (prev && typeof prev.json === "string" && prev.json !== nextJson && !(list[0] && list[0].json === prev.json)) {
      list.unshift({ json: prev.json, updated: String(prev.updated || ""), by: String(prev.by || "") });
    }
    let out = list.slice(0, HISTORY_MAX);
    // oldest dropped first; the newest goes too when it alone is over the cap (round 15, M1)
    while (out.length && utf8Len(JSON.stringify(out)) > HISTORY_BYTES) out = out.slice(0, -1);
    return JSON.stringify(out);
  }
  /** True when this version {json, updated, by} alone is over HISTORY_BYTES, so it can never be kept in the history
   *  (pushHistory drops it). Round 17 L5: the app tells a user with the stages right once. */
  function historyTooBig(json, updated, by) {
    if (typeof json !== "string" || !json) return false;
    // cheap first: at most 6 bytes per UTF-16 unit once stringified (an escaped lone surrogate), so a short list is never over
    if ((json.length + String(updated || "").length + String(by || "").length) * 6 + 100 <= HISTORY_BYTES) return false;
    return utf8Len(JSON.stringify([{ json, updated: String(updated || ""), by: String(by || "") }])) > HISTORY_BYTES;
  }
  /** A stored "updated" (UTC "YYYY-MM-DD HH:MM", from toISOString) in local time and the shared date format:
   *  ArstenI18n.fmtDate with time when it is loaded ("17.11.2026 09:30" / "17 Nov 2026 09:30"), else
   *  "2026-11-17 09:30". Not a time: the text as stored (round 15, L5). */
  function fmtUpdated(updated, lang) {
    const t = String(updated == null ? "" : updated);
    const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)(:\d\d(?:\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/.exec(t.trim());
    const d = m ? new Date(`${m[1]}T${m[2]}${m[3] || ":00"}${m[4] || "Z"}`) : null;
    if (!d || isNaN(d)) return t;
    const I = (typeof self !== "undefined" && self.ArstenI18n) || (typeof globalThis !== "undefined" && globalThis.ArstenI18n) || null;
    if (I && typeof I.fmtDate === "function") return I.fmtDate(d, lang === "en" ? "en" : "bg", { time: true });
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** A version as a short line: "17.11.2026 09:30 · Иван · 4 етапа: А, Б, В, Г …" (local time, L5). */
  function describeVersion(e, lang) {
    const bg = lang !== "en", n = e.stages.length, names = e.stages.map((x) => x.name);
    return `${e.updated ? fmtUpdated(e.updated, lang) : "?"} · ${e.by || "?"} · ${n} ${bg ? (n === 1 ? "етап" : "етапа") : n === 1 ? "stage" : "stages"}`
      + (n ? ": " + names.slice(0, 4).join(", ") + (n > 4 ? " …" : "") : "");
  }

  /** What to load / unload for a model stage. models = viewer.getModels() rows {id, name, state}.
   *  Returns {load: ids not yet loaded, unload: ids loaded but not in the stage, missing: stage models no longer there}. */
  function plan(stage, models) {
    const want = new Set((stage.models || []).map((m) => m.id));
    const byId = new Map((models || []).map((m) => [m.id, m]));
    return {
      load: [...want].filter((id) => byId.has(id) && byId.get(id).state !== "loaded"),
      unload: (models || []).filter((m) => m.state === "loaded" && !want.has(m.id)).map((m) => m.id),
      missing: (stage.models || []).filter((m) => !byId.has(m.id)),
    };
  }
  /** Live test 18.11.2026: the stage of `list` whose models are exactly what the viewer has loaded now (nothing to load,
   *  unload or find), or null. A tile click then opens the tool at once instead of asking for the stage again (each tool
   *  asked, even right after the stage was loaded for another tool). A saved-view stage never counts (its camera and
   *  filters cannot be compared). */
  function loadedStage(list, models) {
    for (const s of list || []) {
      if (s.kind === "view" || !(s.models || []).length) continue;
      const p = plan(s, models);
      if (!p.load.length && !p.unload.length && !p.missing.length) return s;
    }
    return null;
  }
  /**
   * Folder tree of the project's model files. folders: [{id, name, parent}], files: [{id, name, parent, ...}].
   * Only folders that contain a model file (at any depth) are kept; folders first, both sorted by name.
   * @returns [{type: "folder", id, name, children: [...]} | {type: "file", ...file}]  (children of the top level)
   */
  function tree(folders, files) {
    const node = new Map(folders.map((f) => [f.id, { type: "folder", id: f.id, name: f.name, parent: f.parent, children: [] }]));
    const roots = [];
    const attach = (n, parent) => { const p = node.get(parent); if (p) p.children.push(n); else roots.push(n); };
    for (const n of node.values()) attach(n, n.parent);
    for (const f of files) attach(Object.assign({ type: "file" }, f), f.parent);
    const prune = (list) => list.filter((n) => n.type === "file" || (n.children = prune(n.children)).length)
      .sort((a, b) => (a.type !== b.type ? (a.type === "folder" ? -1 : 1) : String(a.name).localeCompare(String(b.name))));
    let top = prune(roots);
    // the project root folder itself is not shown: start at its children
    while (top.length === 1 && top[0].type === "folder" && !top[0].parent) top = top[0].children;
    return top;
  }

  /** One-line description of a stage for its tile. */
  function describe(stage, lang) {
    const bg = lang !== "en";
    if (stage.kind === "view") return (bg ? "Изглед: " : "View: ") + (stage.viewName || "?");
    const n = (stage.models || []).length;
    return (bg ? (n === 1 ? "Модел: " : "Модели: ") : (n === 1 ? "Model: " : "Models: ")) + (stage.models || []).map((m) => m.name).join(", ");
  }

  /** Storage: pset (shared by everyone in the project). localStorage (this browser only) is used ONLY for the local
   *  test page (local = true): in a real project a failing shared store makes the stages read-only with an error
   *  (review round 2: managers saved into their own browser without noticing). client = PsetClient or null.
   *  canWrite (round 11, L3): the user's "stages" capability. false = read only: the definition is not touched and
   *  nothing is ever written. Left out = decided by the server, as before (other panels' copies). */
  function store({ client, projectId, user, local, canWrite }) {
    const key = `arsten.stages.${projectId}`;
    let lib = null, shared = false, writable = false, error = "", history = [];
    // round 15, M2: true when the definition exists but adding "history" to it was refused (403: an old project and a
    // user who may edit the records but not the definition). The stages stay editable; saves leave "history" out.
    let historyOff = false;
    // round 18 M1: opening the shell never writes to a project. load() only checks the definition as it was before
    // week 4 (create-if-missing, as every panel does on a new project) and notes whether "history" is in it. When it
    // is not, historyPending is set and the field is added by the first save / restore (a write the manager asked
    // for); a 403 there turns historyOff on (the round 15 M2 path).
    let historyPending = false;
    // round 17 L5: the stored list alone is over HISTORY_BYTES - the next save cannot keep it as an earlier version
    let tooBig = false;
    return {
      get shared() { return shared; },
      get writable() { return writable; },
      /** the history is not kept on this project yet (definition without "history", M2); the app tells the user once */
      get historyOff() { return historyOff; },
      /** the definition has no "history" yet; the first save / restore adds it (round 18 M1). Nothing to tell the user. */
      get historyPending() { return historyPending && !historyOff; },
      /** the current stage list is too large to be kept as a history entry (round 17 L5); the app tells the user once */
      get historyTooBig() { return tooBig && !historyOff; },
      /** why the stages are not available / not saveable ("" when fine) */
      get error() { return error; },
      /** earlier versions, newest first (B-Admin 9): [{json, updated, by, stages}] as last read or written */
      get history() { return history; },
      async load() {
        error = "";
        if (client && !local) {
          try {
            const found = await client.findLibrary(projectId, LIB_NAMES);
            // no library (or a passing 403/404 that findLibrary swallows): an error, so a refresh keeps the list on
            // screen instead of emptying it (review round 3, L3)
            if (!found.lib) { const e = new Error("no-library"); e.code = "no-library"; throw e; }
            lib = found.lib;
            writable = false;
            if (canWrite !== false) {
              // round 18 M1: only the pre-week-4 definition - on an existing project nothing is missing, so nothing is
              // sent; on a new project it is created (deliberate, as before). "history" is never added to an existing one here.
              try {
                const r = await client.ensureDefinition(lib.id, definition(true));
                writable = true;
                if (!historyOff) {
                  const props = r && r.def && r.def.schema && r.def.schema.props;
                  historyPending = !(props && "history" in props);
                  // a definition this load just created (new project): completed now, as part of that creation
                  if (historyPending && r && r.created) {
                    try { await client.ensureDefinition(lib.id, definition(false)); historyPending = false; }
                    catch (e) { console.warn("stages: new definition created without \"history\"; the first save adds it", e); }
                  }
                }
              } catch (e) { if (e.status !== 403) throw e; }   // may not create / check it: read only, as before
            }
            const got = await client.readMany(lib.id, DEF_ID, [link(projectId)]);
            shared = true;
            history = parseHistory((got.get(link(projectId)) || {}).history);
            { const r = got.get(link(projectId)) || {}; tooBig = historyTooBig(r.json == null ? "" : String(r.json), r.updated, r.by); }
            // A read never writes (round 11, L3): no empty record on a new project. The first save creates the record
            // (see save) so that it still carries a version against a second manager (round 3, M4).
            return parse((got.get(link(projectId)) || {}).json);
          } catch (e) {
            console.warn("stages: shared store not available", e);
            writable = false; shared = false; lib = null; error = (e && e.message) || String(e);
            throw e;
          }
        }
        writable = true;
        try {
          history = parseHistory(localStorage.getItem(key + ".history"));
          tooBig = historyTooBig(localStorage.getItem(key) || "", localStorage.getItem(key + ".updated"), user || "?");
          return parse(localStorage.getItem(key));
        } catch { return []; }
      },
      /**
       * change(currentList) -> new list. Reads the record with its version and writes with that version (PATCH, never
       * delete + re-create): if someone else saved in between, the server refuses (412/409) and the change is
       * applied again on top of their list. change may throw to refuse (e.g. the stage was deleted meanwhile).
       */
      async save(change) {
        const L = lib;   // a refresh failing meanwhile resets `lib`; this save keeps the library it started with (round 4, L4)
        if (shared && L) {
          if (!writable) { const e = new Error("stages are read only"); e.status = 403; throw e; }
          // round 18 M1: the first deliberate save / restore adds "history" to an old definition. Refused (403): saved
          // without history from now on (round 15 M2). Another error: this save goes without history; the next one tries again.
          let noHistoryNow = false;
          if (historyPending && !historyOff) {
            try { await client.ensureDefinition(L.id, definition(false)); historyPending = false; }
            catch (e) {
              noHistoryNow = true;
              if (e.status === 403) { historyOff = true; historyPending = false; console.warn("stages: the definition has no \"history\" and may not be extended (403); saving without history", e); }
              else console.warn("stages: adding \"history\" to the definition failed; this save goes without history", e);
            }
          }
          for (let attempt = 0; ; attempt++) {
            let cur = await client.readOne(L.id, DEF_ID, link(projectId));
            // First save on a new project (round 11, L3; replaces the empty record that load used to write): create the
            // record WITHOUT "json" - a blind merge that cannot erase stages another manager saved meanwhile - then read
            // it back, so the real write below carries a version and a concurrent save is refused and re-applied (M4).
            if (!cur && attempt === 0) {
              await client.writeIfUnchanged(L.id, DEF_ID, link(projectId), { updated: new Date().toISOString().slice(0, 16).replace("T", " "), by: user || "?" });
              cur = await client.readOne(L.id, DEF_ID, link(projectId));
            }
            const list = parse(cur && cur.props ? cur.props.json : "");
            let next;
            // a refusal carries the list as it is stored now, so the screen can show it (round 4, L1)
            try { next = change(list); } catch (e) { e.current = list; throw e; }
            const props = { json: JSON.stringify(next), updated: new Date().toISOString().slice(0, 16).replace("T", " "), by: user || "?" };
            // the replaced version joins the history (B-Admin 9); computed from THIS read, so a refused write (412)
            // recomputes it from the fresh record on the retry and no version is lost or doubled
            const cp = (cur && cur.props) || {};
            if (!historyOff && !noHistoryNow) props.history = pushHistory(cp.history, cp.json != null ? { json: String(cp.json), updated: cp.updated, by: cp.by } : null, props.json);
            try {
              try { await client.writeIfUnchanged(L.id, DEF_ID, link(projectId), props, cur ? cur.v : undefined); }
              catch (e) {
                // M1: a value or body too large for the service (400 / 413) must never block editing the stages: the
                // same write once more WITHOUT "history" (the stored history stays as it was)
                if ((e.status === 400 || e.status === 413) && "history" in props) {
                  console.warn("stages: save with history refused (" + e.status + "); saved without history", e);
                  delete props.history;
                  await client.writeIfUnchanged(L.id, DEF_ID, link(projectId), props, cur ? cur.v : undefined);
                } else throw e;
              }
            }
            catch (e) { if ((e.status === 412 || e.status === 409) && attempt < 3) continue; throw e; }
            // Without a version (the very first save, or a service that returns none) the write is a plain merge: two
            // managers creating the first stages at the same moment would overwrite each other. Read back and apply
            // the change again on top of what is stored (review round 3, M4).
            if (!cur || cur.v === undefined || cur.v === null) {
              const back = await client.readOne(L.id, DEF_ID, link(projectId));
              if (back && back.props && back.props.json !== props.json && attempt < 3) continue;
            }
            history = parseHistory("history" in props ? props.history : cp.history);
            tooBig = historyTooBig(props.json, props.updated, props.by);
            return next;
          }
        }
        if (!local) throw new Error(error || "stages store not loaded");
        let cur = [];
        try { cur = parse(localStorage.getItem(key)); } catch {}
        let next;
        try { next = change(cur); } catch (e) { e.current = cur; throw e; }
        try {
          const prevJson = localStorage.getItem(key);
          const h = pushHistory(localStorage.getItem(key + ".history"), prevJson != null ? { json: prevJson, updated: localStorage.getItem(key + ".updated") || "", by: user || "?" } : null, JSON.stringify(next));
          localStorage.setItem(key, JSON.stringify(next));
          localStorage.setItem(key + ".updated", new Date().toISOString().slice(0, 16).replace("T", " "));
          localStorage.setItem(key + ".history", h);
          history = parseHistory(h);
          tooBig = historyTooBig(JSON.stringify(next), localStorage.getItem(key + ".updated"), user || "?");
        } catch {}
        return next;
      },
      /** "Върни тази версия": the version's stages saved as a normal change (versioned write, retried on a conflict);
       *  the list it replaces goes into the history. entry: one of history. Returns the new list. */
      restore(entry) {
        if (!entry || typeof entry.json !== "string") return Promise.reject(new Error("no such version"));
        return this.save(() => parse(entry.json));
      },
    };
  }

  return { LIB_NAMES, DEF_ID, HISTORY_MAX, HISTORY_BYTES, HISTORY_CHARS, utf8Len, historyTooBig, fmtUpdated, parseHistory, pushHistory, describeVersion, link, definition, parse, forTool, toolsOf, newId, plan, loadedStage, tree, describe, store };
});
