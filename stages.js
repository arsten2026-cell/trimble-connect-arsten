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
  function definition() {
    const S = { type: "string" };
    const fields = [["json", S, "Stages (JSON) / Етапи"], ["updated", S, "Updated / Обновено"], ["by", S, "By / От"]];
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
    let lib = null, shared = false, writable = false, error = "";
    return {
      get shared() { return shared; },
      get writable() { return writable; },
      /** why the stages are not available / not saveable ("" when fine) */
      get error() { return error; },
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
              try { await client.ensureDefinition(lib.id, definition()); writable = true; } catch (e) { if (e.status !== 403) throw e; }
            }
            const got = await client.readMany(lib.id, DEF_ID, [link(projectId)]);
            shared = true;
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
        try { return parse(localStorage.getItem(key)); } catch { return []; }
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
            try { await client.writeIfUnchanged(L.id, DEF_ID, link(projectId), props, cur ? cur.v : undefined); }
            catch (e) { if ((e.status === 412 || e.status === 409) && attempt < 3) continue; throw e; }
            // Without a version (the very first save, or a service that returns none) the write is a plain merge: two
            // managers creating the first stages at the same moment would overwrite each other. Read back and apply
            // the change again on top of what is stored (review round 3, M4).
            if (!cur || cur.v === undefined || cur.v === null) {
              const back = await client.readOne(L.id, DEF_ID, link(projectId));
              if (back && back.props && back.props.json !== props.json && attempt < 3) continue;
            }
            return next;
          }
        }
        if (!local) throw new Error(error || "stages store not loaded");
        let cur = [];
        try { cur = parse(localStorage.getItem(key)); } catch {}
        let next;
        try { next = change(cur); } catch (e) { e.current = cur; throw e; }
        try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
        return next;
      },
    };
  }

  return { LIB_NAMES, DEF_ID, link, definition, parse, forTool, toolsOf, newId, plan, tree, describe, store };
});
