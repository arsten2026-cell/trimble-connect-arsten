// Arsten / MULTIPLAN – start screen helpers (week 3, A4): tile order, "for whom" hint, the remembered last tool / stage;
// round 12 H1: the routing of Connect events to hidden tools.
// Pure (no DOM, no network), so they are unit-tested in Node: node --test test/home.test.js
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.ArstenHome = lib;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Usable tiles first, the others after them; each group keeps its own order (stable). */
  function orderTiles(tiles, usable) {
    const on = [], off = [];
    for (const t of tiles || []) (usable(t) ? on : off).push(t);
    return on.concat(off);
  }

  const ROLE = {
    bg: { admin: "администратор", gc: "главен изпълнител", designer: "проектант", client: "клиент", fabricator: "производител" },
    en: { admin: "admin", gc: "general contractor", designer: "designer", client: "client", fabricator: "fabricator" },
  };
  /** One line "for whom" a tool is, from the roles that open it: "За: администратор, главен изпълнител". */
  function forWhom(roles, lang) {
    const L = lang === "en" ? "en" : "bg";
    const list = (roles || []).map((r) => ROLE[L][r] || r);
    if (!list.length) return "";
    return (L === "bg" ? "За: " : "For: ") + list.join(", ");
  }

  /** Everyone at least one tool is for (round 11, L1): the union of the tools' role lists, in `order` (unknown last). */
  function audience(roleLists, order) {
    const all = [...new Set([].concat(...(roleLists || []).map((l) => l || [])))];
    const rank = (r) => { const i = (order || []).indexOf(r); return i < 0 ? 1e9 : i; };
    return all.sort((a, b) => rank(a) - rank(b));
  }

  // ---------- remembered last tool + stage, per user and project ----------
  // localStorage (this browser) with an in-memory fallback, so a blocked / full storage still remembers within the session.
  const memory = new Map();
  /** Storage key, or null when the project or the user is not known (then nothing is remembered). */
  function lastKey(projectId, userId) {
    if (!projectId || !userId) return null;
    return `arsten.shell.last.v1.${projectId}.${String(userId).toLowerCase()}`;
  }
  const clean = (v, tools) => {
    if (!v || typeof v !== "object" || typeof v.tool !== "string" || !v.tool) return null;
    if (tools && !tools.includes(v.tool)) return null;   // a tool that is no longer in the panel
    const out = { tool: v.tool };
    if (typeof v.stageId === "string" && v.stageId) { out.stageId = v.stageId; out.stageName = typeof v.stageName === "string" ? v.stageName : ""; }
    return out;
  };
  /** {tool, stageId?, stageName?} or null. storage may be null or throw on any access; tools = known tool ids (optional). */
  function readLast(storage, key, tools) {
    if (!key) return null;
    let raw = null;
    try { raw = storage ? storage.getItem(key) : null; } catch { raw = null; }
    if (raw != null) {
      try { const v = clean(JSON.parse(raw), tools); if (v) return v; } catch {}
    }
    return clean(memory.get(key), tools);
  }
  /** Remember {tool, stageId?, stageName?}. Returns true when it reached the storage, false when only the memory has it. */
  function writeLast(storage, key, value) {
    const v = clean(value);
    if (!key || !v) return false;
    memory.set(key, v);
    try { if (!storage) return false; storage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
  }

  /** "Продължи: Стомана · Сграда А" (stage part left out when there is none). */
  function resumeLabel(toolName, stageName, lang) {
    return (lang === "en" ? "Continue: " : "Продължи: ") + toolName + (stageName ? " · " + stageName : "");
  }

  // ---------- Connect events for hidden tools (review round 12, H1) ----------
  // Only the tool on screen gets Connect events live. For a hidden tool the shell keeps the LAST event of each type
  // (model, selection, ...) and replays them once when the tool is shown again, so a hidden tool does not reload or
  // repaint the viewer behind the visible one. Token / access / session events ("extension.*": accessToken,
  // sessionInvalid, userSettingsChanged, command, ...) always go to every tool at once: a hidden tool must not be left
  // with an expired token.
  /** Must this event reach every tool at once, hidden or not? */
  function alwaysLive(event) {
    return typeof event !== "string" || event.indexOf("extension.") === 0;
  }
  /** Held events of one hidden tool: event type -> last data, in the order of each type's last arrival. */
  function holdEvent(queue, event, data) {
    queue.delete(event);   // re-insert, so the type moves to the end (replay keeps the order of the last arrivals)
    queue.set(event, data);
    return queue;
  }
  /** The held events as [[event, data], ...] (oldest last-arrival first), and the queue emptied. */
  function takeEvents(queue) {
    if (!queue || !queue.size) return [];
    const out = [...queue.entries()];
    queue.clear();
    return out;
  }
  /** Where one event goes for one tool: "live" (send now) or "hold" (keep for the replay). toolId null: a client
   *  that is not one of the shell's tool frames (sent live, as before). */
  function routeEvent(event, toolId, visibleId) {
    if (alwaysLive(event) || !toolId || toolId === visibleId) return "live";
    return "hold";
  }

  return { orderTiles, forWhom, audience, lastKey, readLast, writeLast, resumeLabel, alwaysLive, holdEvent, takeEvents, routeEvent, _memory: memory };
});
