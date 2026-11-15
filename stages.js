// Arsten / MULTIPLAN – "Етапи" (stages): named model sets or saved Connect views per tool, chosen before a tool opens
// (user, 15.11.2026: "I can select a view or a model that will stay there until I change … I should be able to add a second one").
// A stage: {id, tool, name, kind: "models"|"view", models: [{id, name}], viewId, viewName}.
// Stored ONCE per project, shared by everyone: pset library CIP/Монолитно, definition "stages",
// link frn:entity:ARSTENSTAGES-{projectId}, prop "json". Admins / the general contractor can edit (library Edit);
// everyone else reads. Without access to that library the stages are kept in this browser only.
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

  const parse = (s) => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.filter((x) => x && x.id && x.tool && x.name) : []; } catch { return []; } };
  const forTool = (stages, tool) => stages.filter((s) => s.tool === tool);
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
  /** One-line description of a stage for its tile. */
  function describe(stage, lang) {
    const bg = lang !== "en";
    if (stage.kind === "view") return (bg ? "Изглед: " : "View: ") + (stage.viewName || "?");
    const n = (stage.models || []).length;
    return (bg ? (n === 1 ? "Модел: " : "Модели: ") : (n === 1 ? "Model: " : "Models: ")) + (stage.models || []).map((m) => m.name).join(", ");
  }

  /** Storage: pset (shared) or localStorage (this browser). client = PsetClient or null. */
  function store({ client, projectId, user, local }) {
    const key = `arsten.stages.${projectId}`;
    let lib = null, shared = false, writable = false;
    return {
      get shared() { return shared; },
      get writable() { return writable; },
      async load() {
        if (client && !local) {
          try {
            const found = await client.findLibrary(projectId, LIB_NAMES);
            if (found.lib) {
              lib = found.lib;
              try { await client.ensureDefinition(lib.id, definition()); writable = true; } catch (e) { if (e.status !== 403) throw e; }
              const got = await client.readMany(lib.id, DEF_ID, [link(projectId)]);
              shared = true;
              return parse((got.get(link(projectId)) || {}).json);
            }
          } catch (e) { console.warn("stages: shared store not available", e); }
        }
        writable = true;
        try { return parse(localStorage.getItem(key)); } catch { return []; }
      },
      /** change(currentList) -> new list; re-reads first so two people adding stages do not overwrite each other. */
      async save(change) {
        if (shared && lib) {
          const got = await client.readMany(lib.id, DEF_ID, [link(projectId)]);
          const next = change(parse((got.get(link(projectId)) || {}).json));
          await client.replace(lib.id, DEF_ID, link(projectId), { json: JSON.stringify(next), updated: new Date().toISOString().slice(0, 16).replace("T", " "), by: user || "" });
          return next;
        }
        let cur = [];
        try { cur = parse(localStorage.getItem(key)); } catch {}
        const next = change(cur);
        try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
        return next;
      },
    };
  }

  return { LIB_NAMES, DEF_ID, link, definition, parse, forTool, newId, plan, describe, store };
});
