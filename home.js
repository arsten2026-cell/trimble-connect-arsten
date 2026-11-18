// Arsten / MULTIPLAN – start screen helpers (week 3, A4): tile order, "for whom" hint, the remembered last tool / stage;
// round 12 H1: the routing of Connect events to hidden tools.
// Pure (no DOM; readSnapshot takes its fetch from the caller), so they are unit-tested in Node: node --test test/home.test.js
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
  /** Where one event goes for one tool: "live" (send now), "hold" (keep for the replay) or "drop". toolId null: a
   *  client that is not one of the shell's tool frames gets nothing, not even "extension.accessToken" (sweep 18.11.2026:
   *  it was sent live before, which handed the user's Connect token to any window that connected). */
  function routeEvent(event, toolId, visibleId) {
    if (!toolId) return "drop";
    if (alwaysLive(event) || toolId === visibleId) return "live";
    return "hold";
  }

  /** Who may use the Connect API through the shell (sweep 18.11.2026). The shell re-exposes Connect's API to its tool
   *  frames, and the Workspace library accepts a connect request from ANY window that can postMessage to the shell
   *  (another extension's iframe on the same Connect page, a page that framed or opened the shell). Such a window could
   *  then call extension.requestPermission("accesstoken") and get the user's token, as if this extension asked.
   *  o: {toolOf(client) -> tool id or null (its window is one of our f_<id> iframes), origins: allowed origins,
   *  clients: Set of accepted clients, remove(client): TrimbleConnectWorkspace.removeClient}.
   *  onConnect keeps only our own tool frames from our own origin; anything else is removed from the library's client
   *  list at once (its later requests then find no client and are answered "Not supported"). onRequest refuses every
   *  call from a client that is not (or no longer) one of ours, as a second lock. */
  function clientGate(o) {
    const ok = (c) => !!c && !!o.toolOf(c) && (o.origins || []).includes(c.origin);
    return {
      ok,
      onConnect(c) {
        // onAccept: the frame's tool has connected, so its load watch stops (sweep 18.11.2026)
        if (ok(c)) { o.clients.add(c); if (o.onAccept) { try { o.onAccept(o.toolOf(c), c); } catch {} } return; }
        o.clients.delete(c);
        try { o.remove(c); } catch {}
      },
      onRequest(c) {
        if (o.clients.has(c) && ok(c)) return undefined;   // undefined: the library runs the call as usual
        return Promise.reject(new Error("Not allowed"));
      },
    };
  }

  /** The URL of the snapshot's next page, or null when it must not be followed (sweep 18.11.2026). Same rule as
   *  arsten-backup listFolder: an absolute "next" keeps only the part after the Core API root (/tc/api/2.0/ or 2.1/)
   *  and is built on base, so the Authorization header never goes to a CDN / pre-signed storage link that a proxy or a
   *  future API change might return. A relative "next" is built on base as before. */
  function nextUrl(base, next) {
    next = String(next);
    if (!/^https?:/i.test(next)) return base + next.replace(/^\/+/, "");
    const m = /\/tc\/api\/2\.[01]\/(.*)$/.exec(next);
    return m ? base + m[1] : null;
  }

  /** Every item of the project's file tree (Core files/fs/snapshot, paged by "next"), for the stage form (sweep
   *  18.11.2026: it used a bare fetch, so a slow or stuck snapshot left "Нов етап" waiting forever and a 429 failed at
   *  once). Each page is aborted after o.ms (30 s, as arsten-access.js); a 429 / 503 is tried again up to 3 tries after
   *  Retry-After (capped 8 s) or a growing pause; a 401 once with a fresh token. Any failure throws (status 0 and
   *  timeout: true on a timeout), and the form falls back to the models in the viewer.
   *  o: {fetch, ms, tries, sleep, maxPages} (tests). */
  async function readSnapshot(base, projectId, getToken, o) {
    o = o || {};
    const f = o.fetch || ((...a) => fetch(...a));
    const ms = o.ms || 30000, tries = o.tries || 3, sleep = o.sleep || ((t) => new Promise((r) => setTimeout(r, t)));
    const items = [];
    let url = `${base}files/fs/snapshot?projectId=${encodeURIComponent(projectId)}`;
    const once = async (u, fresh) => {
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      let timer = null;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("files/fs/snapshot: timeout"), { status: 0, timeout: true }));
          try { if (ac) ac.abort(); } catch {}
        }, ms);
      });
      try {
        return await Promise.race([(async () => {
          const r = await f(u, Object.assign({ headers: { Authorization: "Bearer " + (await getToken(fresh)) } }, ac ? { signal: ac.signal } : {}));
          return { r, body: r.ok ? await r.json() : null };
        })(), late]);
      } finally { clearTimeout(timer); }
    };
    for (let guard = 0; url && guard < (o.maxPages || 50); guard++) {
      let res = null;
      for (let attempt = 0, busy = 0; !res; ) {
        const { r, body } = await once(url, attempt > 0);
        if (r.status === 401 && attempt === 0) { attempt++; continue; }
        if ((r.status === 429 || r.status === 503) && ++busy < tries) {
          let ra = null;
          try { ra = r.headers && r.headers.get ? r.headers.get("Retry-After") : null; } catch {}
          const n = Number(ra);
          await sleep(ra != null && ra !== "" && isFinite(n) && n >= 0 ? Math.min(n * 1000, 8000) : Math.min(500 * 2 ** (busy - 1), 8000));
          continue;
        }
        if (!r.ok) throw Object.assign(new Error("files/fs/snapshot: " + r.status), { status: r.status });
        res = body || {};
      }
      if (Array.isArray(res)) { items.push(...res); break; }
      items.push(...(res.items || []));
      url = res.next ? nextUrl(base, res.next) : null;
      // sweep 18.11.2026: a "next" on another host is not followed (the bearer token goes only to the Core host);
      // the caller gets what was read, marked incomplete
      if (res.next && !url) { items.complete = false; return items; }
    }
    return items;
  }

  /** Round 16 L1: does this user need the project's stages record at all? Only when they can open a tool in which a
   *  stage is used, or manage stages. allowed: the tool ids the user may open; o.manage: the "stages" capability;
   *  o.noStage: tool ids that use no stage for THIS user (Статус "progress" for a summary-only client: it shows the
   *  published summary, never the loaded models). A client-only member therefore never downloads the stages and their
   *  history (stage names, model and view names, editors' names). */
  function needsStages(allowed, o) {
    o = o || {};
    if (o.manage) return true;
    const skip = new Set(o.noStage || []);
    for (const id of allowed || []) if (!skip.has(id)) return true;
    return false;
  }

  /** The one tool to open at once, or null (sweep 18.11.2026). A member with a single usable tool and no stage screen
   *  (typically the client: only Статус, no stages read) landed on a start screen with one tile and had to tap it on
   *  every visit, one more frame load on a phone. o: {manage (may open "Етапи"), stages (needsStages answered true)}. */
  function soloTool(allowed, o) {
    o = o || {};
    const ids = [...(allowed || [])];
    if (ids.length !== 1 || o.manage || o.stages) return null;
    return ids[0];
  }

  /** The held events of a tool whose stage the shell itself just loaded, marked as such (sweep 18.11.2026). The tools
   *  wait 1.5-3 s of quiet after "viewer.onModelStateChanged", because Connect streams models in bursts; here the shell
   *  already awaited every toggleModel and the camera, so the burst is over. Each replayed onModelStateChanged with an
   *  object payload gets arstenStageLoaded: true (a copy: the held data is not changed), and one "arsten.stageLoaded"
   *  goes last, also when nothing was held (the models were already loaded), so a tool can read after a short debounce
   *  instead. Tools that know neither keep their own timing. */
  function markStageLoaded(evs, tool) {
    const out = (evs || []).map(([event, data]) => (event === "viewer.onModelStateChanged" && data && typeof data === "object" && !Array.isArray(data)
      ? [event, Object.assign({}, data, { arstenStageLoaded: true })] : [event, data]));
    out.push(["arsten.stageLoaded", { arstenStageLoaded: true, tool: tool || null }]);
    return out;
  }

  /** Sweep 18.11.2026: a tool frame that does not load (weak signal on site, DNS hiccup, page timeout) used to stay blank
   *  for the whole session, as a frame is created once. start(id) when the frame's src is set; connected(id) when one of
   *  its clients passes the gate; after o.ms (20 s) without that, onLate(id) and late(id) is true, so the shell offers
   *  "Опитай пак". stop(id): the frame is removed (retry). o: {ms, set, clear, onLate} (set / clear: timers, tests). */
  function loadWatch(o) {
    o = o || {};
    const ms = o.ms || 20000;
    const set = o.set || ((f, t) => setTimeout(f, t)), clear = o.clear || ((h) => clearTimeout(h));
    const timers = new Map(), lateSet = new Set();
    const stop = (id) => { if (timers.has(id)) { clear(timers.get(id)); timers.delete(id); } lateSet.delete(id); };
    return {
      start(id) {
        stop(id);
        timers.set(id, set(() => { timers.delete(id); lateSet.add(id); if (o.onLate) o.onLate(id); }, ms));
      },
      connected(id) { if (id != null) stop(id); },
      stop,
      late: (id) => lateSet.has(id),
      waiting: (id) => timers.has(id),
    };
  }


  /** Prefetch of a tool's files (sweep 18.11.2026). A tool frame used to download index.html and its 9-20 scripts only
   *  on the tap, so "Продължи: Монолитен бетон" on site data first waited for ~0.5 MB before the tool could even start.
   *  version.json lists every published file with its content hash, the same ?v=<hash> the built index.html uses, so
   *  these exact URLs are cache hits when the frame loads. Only scripts and stylesheets (and index.html as the shell
   *  opens it); no frame is created, so no tool reads the model before it is opened. version: {id, files}. */
  function prefetchUrls(base, repo, version) {
    if (!version || !version.id || !version.files || typeof version.files !== "object" || !repo) return [];
    const root = String(base || "") + repo + "/";
    const out = [root + "index.html?shell=1&v=" + encodeURIComponent(String(version.id))];
    for (const [file, hash] of Object.entries(version.files)) {
      if (!/^[\w.-]+\.(?:js|css)$/.test(file) || !hash) continue;   // icons and manifest: not needed to start
      out.push(root + file + "?v=" + encodeURIComponent(String(hash)));
    }
    return out;
  }
  /** Which tools to prefetch: the remembered one always (it is the likely next tap), every other allowed one only on an
   *  unmetered-looking connection (Save-Data off, not 2g/3g/cellular). conn: navigator.connection or undefined. */
  function prefetchTools(last, allowed, conn) {
    const ids = [...(allowed || [])];
    const out = last && ids.includes(last) ? [last] : [];
    const c = conn || null;
    const cheap = !!c && !c.saveData && c.type !== "cellular" && !/(?:^|-)(?:2g|3g)$/.test(String(c.effectiveType || "")) &&
      (c.type === "wifi" || c.type === "ethernet" || String(c.effectiveType || "") === "4g");
    if (cheap) for (const id of ids) if (!out.includes(id)) out.push(id);
    if (c && c.saveData) return [];   // the user asked to save data: not even the remembered tool
    return out;
  }

  /* "Как се работи / How to" on the start screen (sweep 18.11.2026). Site people on a phone do not look in Files for the
   * handbook (НАРЪЧНИК.md, AM_TEMPLATE "User guide"), so its everyday tasks are here in short, one topic per tool. Keep
   * the button names in step with the tools and with НАРЪЧНИК.md. tool: the tile that shows the topic (null: every
   * team member, never a client); client: the topic a client-only member gets instead of the team's. */
  const HELP = [
    { id: "stages", tool: "stages", bg: ["Етап (сграда, част)", ["Плочка Етапи → Нов етап.", "Име, за кои модули, модели или изглед → Запази.", "В инструмента: Етапи / Смени етапа зарежда моделите на етапа."]],
      en: ["A stage (building, part)", ["Stages tile → New stage.", "Name, for which modules, models or a view → Save.", "In a tool: Stages / Change stage loads the stage's models."]] },
    { id: "pour", tool: "pour", bg: ["Такт е излят", ["Плочка Монолитен бетон.", "Изберете такта: в модела или по номер → Избери.", "На реда на етапа: Готово (датата е днес).", "Армировката не е приета? Бутонът става Потвърди – излей: натиснете пак.", "Грешка: Премахни → Потвърди: премахни."]],
      en: ["A pour is done", ["Cast-in-place concrete tile.", "Pick the pour: in the model or by number → Select.", "On the step's row: Mark done (date is today).", "Rebar not accepted? The button turns into Confirm – poured: press again.", "Mistake: Remove → Confirm: remove."]] },
    { id: "photo", tool: "pour", bg: ["Снимка към такт", ["Първо изберете такта (без такт снимката няма къде да отиде).", "За авторски надзор: Снимката е за: Приемане – армировка / кофраж.", "📷 Снимай (телефон) или Избери снимки (компютър).", "Изчакайте „Снимката е качена ✓“."]],
      en: ["A photo for a pour", ["Pick the pour first (without one the photo has nowhere to go).", "For design supervision: Photo is for: Acceptance – rebar / formwork.", "📷 Take photo (phone) or Choose photos (computer).", "Wait for \"Photo uploaded ✓\"."]] },
    // Стомана and Авторски надзор had no topic (sweep 18.11.2026): marking an erection / a delivery and deciding a request
    // are everyday tasks of the erector, the site manager and the designer (group 4.1), who saw only the ДР topic.
    { id: "accept", tool: "accept", bg: ["Решение по заявка", ["Плочка Авторски надзор → Чакащи.", "Вижте снимките; Покажи в модела.", "Одобри / Одобри със забележки / Отхвърли → Потвърди. За забележки и отказ напишете коментар."]],
      en: ["Decide a request", ["Design supervision tile → Waiting.", "Look at the photos; Show in model.", "Approve / Approve with remarks / Reject → Confirm. Remarks and rejection need a comment."]] },
    { id: "steel", tool: "steel", bg: ["Сглобка е монтирана", ["Плочка Стомана.", "Изберете сглобките в модела или марка от таблицата.", "Монтиран: датата е днес → Отбележи (N).", "Доставка: таб Доставки → марка и брой на ред → Запиши доставка."]],
      en: ["An assembly is erected", ["Steel tile.", "Select the assemblies in the model or a mark in the table.", "Erected: date is today → Set (N).", "Delivery: Deliveries tab → mark and qty per line → Save delivery."]] },
    { id: "activities", tool: "activities", bg: ["Работа извън модела", ["Плочка Дейности.", "Какво е направено: кратко; датата е днес.", "Отметка за клиента, ако клиентът трябва да я види.", "Снимки по желание → Добави. Изчакайте „Записано ✓“."]],
      en: ["Work outside the model", ["Site activities tile.", "What was done: short; the date is today.", "Tick for the client if the client should see it.", "Photos if you like → Add. Wait for \"Saved ✓\"."]] },
    { id: "report", tool: "progress", bg: ["Седмичен отчет", ["Плочка Статус → Публикувай за клиента → Публикувай.", "Печат на седмичния отчет → „Запази като PDF“.", "Виж като клиент показва точно какво вижда клиентът."]],
      en: ["Weekly report", ["Status tile → Publish for the client → Publish.", "Print weekly report → \"Save as PDF\".", "View as client shows exactly what the client sees."]] },
    { id: "extra", tool: null, bg: ["Допълнителна работа (ДР) на чертеж", ["Data (не 3D изгледа) → ЗА СТРОИТЕЛСТВО → PDF чертежа (2D).", "Маркиране: облак, стрелка, текст около мястото.", "Количество: калибрирайте листа, после Площ или Разстояние.", "Запазете като задача (ToDo) „ДР – описание“ към групата на ръководителя на проекта. Иначе маркировката изчезва.", "Плочка Дейности → Допълнителна работа: изберете задачата в „Задача в Connect“ (или Добави над регистъра), количество, мярка, чертеж → Добави (дава номер ДР-NNN).", "Ръководителят: Одобри → Започната → Изпълнена. Регистърът и CSV: Допълнителни работи."]],
      en: ["Additional work (ДР) on a drawing", ["Data (not the 3D viewer) → ЗА СТРОИТЕЛСТВО → the PDF drawing (2D).", "Markup: cloud, arrow, text around the place.", "Quantity: calibrate the sheet, then Area or Distance.", "Save as a ToDo \"ДР – description\" for the project manager's group. Otherwise the markup is lost.", "Site activities tile → Additional work: pick the ToDo in \"Connect ToDo\" (or Add above the register), quantity, unit, drawing → Add (gives the number ДР-NNN).", "The project manager: Approve → Started → Done. The register and CSV: Additional works."]] },
    { id: "client", client: true, bg: ["Отчет за клиента", ["Плочка Статус: последният публикуван отчет.", "„Все още няма публикуван отчет“: екипът още не е публикувал.", "Не се отваря изобщо? Обадете се на екипа."]],
      en: ["Report for the client", ["Status tile: the last published report.", "\"No report has been published yet.\": the team has not published one.", "Nothing opens at all? Call the team."]] },
  ];
  /** The help topics for this user, in the tiles' order: [{id, title, steps}]. allowed: the tool ids they may open;
   *  o: {client (client-only member: the client topic alone, no internal tool names, round 11 L4), manage (Етапи), lang}. */
  function helpTopics(allowed, o) {
    o = o || {};
    const ok = new Set(allowed || []);
    if (o.manage) ok.add("stages");
    const L = o.lang === "en" ? "en" : "bg";
    return HELP.filter((h) => (o.client ? h.client === true : !h.client && (h.tool === null || ok.has(h.tool))))
      .map((h) => ({ id: h.id, title: h[L][0], steps: h[L][1].slice() }));
  }

  return { loadWatch, orderTiles, forWhom, audience, lastKey, readLast, writeLast, resumeLabel, alwaysLive, holdEvent, takeEvents, routeEvent, clientGate, readSnapshot, nextUrl, needsStages, soloTool, markStageLoaded, helpTopics, prefetchUrls, prefetchTools, _memory: memory };
});
