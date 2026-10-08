// Yupoo Library app — code shared by the Library and Catalog pages (loaded before library.js / catalog.js).
const TOKEN = document.querySelector('meta[name="kit-token"]').content;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(typeof LANG !== "undefined" && LANG === "zh" ? "zh-CN" : undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
// Today's date in your own time zone (toISOString would give the UTC date, a day off in the evening).
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "3 items" / "3 件" — the most common count in messages.
const nItems = (n) => L(plural(n, "item"), `${n} 件`);

// Everything loaded from the app. Each page adds its own fields (filters etc.) to S.
const S = {
  lib: { albums: {} }, aliases: {}, myTeams: {}, settings: { autoSave: true }, storeNames: {}, storeCats: {},
  collections: []
};
let matcher = YO_buildMatcher({});
const cache = new Map();

// ---------- talking to the app ----------
// Other open windows (e.g. the Catalog in its own window) hear about changes through this channel.
const channel = (() => { try { return new BroadcastChannel("yupoo-library"); } catch (e) { return null; } })();
function tellOtherWindows(what) { try { if (channel) channel.postMessage({ what }); } catch (e) {} }

async function call(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: Object.assign({ "X-Kit-Token": TOKEN }, raw ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (method !== "GET") tellOtherWindows(path.indexOf("/api/collections") === 0 ? "collections" : "library");
  return data;
}

// ---------- speed measurements (shown on the hidden Speed report page, /debug) ----------
// PERF.add("name", ms, n, note) records one timing; they're sent to the app in small batches.
const PERF = {
  queue: [], timer: null,
  page: location.pathname === "/" ? "library" : location.pathname.slice(1),
  add(name, ms, n, note) {
    this.queue.push({ name, ms: Math.round(ms * 10) / 10, n: n || 0, note: note || "", page: this.page, at: Date.now() });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  },
  // Times fn() and records it. Returns what fn returns.
  time(name, fn, n, note) {
    const t = performance.now();
    const r = fn();
    this.add(name, performance.now() - t, typeof n === "function" ? n(r) : n, note);
    return r;
  },
  // How long until the browser has actually drawn the result (after the code finished).
  afterPaint(cb) { requestAnimationFrame(() => setTimeout(cb, 0)); },
  flush() {
    if (!this.queue.length) return;
    const body = JSON.stringify(this.queue.splice(0));
    // Plain fetch, not call(): call() would tell other windows the library changed.
    fetch("/api/perf", { method: "POST", headers: { "X-Kit-Token": TOKEN, "Content-Type": "application/json" }, body }).catch(() => {});
  }
};
window.addEventListener("pagehide", () => PERF.flush());

let toastTimer = null, toastAction = null;
// A message at the bottom. With actionLabel, it also gets a button (e.g. Undo) and stays a bit longer.
function toast(msg, actionLabel, action) {
  const t = $(".toast");
  t.innerHTML = esc(msg) + (actionLabel ? ` <button class="toast-act">${esc(window.t ? window.t(actionLabel) : actionLabel)}</button>` : "");
  toastAction = action || null;
  t.classList.toggle("act", !!actionLabel);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show", "act"); toastAction = null; }, actionLabel ? 15000 : 4500);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".toast-act")) return;
  const f = toastAction;
  $(".toast").classList.remove("show", "act");
  toastAction = null;
  if (f) f();
});

// ---------- data ----------
// ---------- light / dark mode ----------
// The 🌓 button cycles Auto (follow Windows) → Dark → Light. The choice is saved in the app's settings;
// a copy in localStorage lets the next page show the right colours straight away.
const THEMES = { "": "🌓 Auto", dark: "🌙 Dark", light: "☀️ Light" };
// ---------- resizable sidebar ----------
// Drag the thin handle on the sidebar's right edge to make it wider (e.g. to read long store names);
// double-click it to go back to the normal width. Saved in the app's settings like the colours.
const SIDE_MIN = 180, SIDE_MAX = 640, SIDE_NORMAL = 260;
function applySidebarWidth(w) {
  w = +w || 0;
  if (w) document.documentElement.style.setProperty("--side-w", Math.max(SIDE_MIN, Math.min(SIDE_MAX, w)) + "px");
  else document.documentElement.style.removeProperty("--side-w");
  try { localStorage.setItem("sidebarWidth", String(w)); } catch (e) {}
}
async function saveSidebarWidth(w) {
  S.settings.sidebarWidth = w;
  applySidebarWidth(w);
  try { await call("POST", "/api/settings", S.settings); } catch (e) {}
}
(() => {
  const aside = document.querySelector(".body > aside");
  if (!aside) return;
  const handle = document.createElement("div");
  handle.className = "resizer";
  handle.title = t("Drag to resize — double-click for the normal width");
  aside.after(handle);
  let startX = 0, startW = 0, dragging = false;
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = aside.getBoundingClientRect().width;
    document.body.classList.add("resizing");
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    applySidebarWidth(Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, startW + e.clientX - startX))));
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing");
    saveSidebarWidth(Math.round(aside.getBoundingClientRect().width));
  });
  handle.addEventListener("dblclick", () => saveSidebarWidth(0));
  // The app already wrote your saved width into the page (server.go pageLook); the browser's memory is
  // only used when it has a value (it's empty after the app restarts, as the app's address changes).
  try { const saved = localStorage.getItem("sidebarWidth"); if (saved !== null) applySidebarWidth(+saved || 0); } catch (e) {}
})();

function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("theme", theme); } catch (e) {}
  document.querySelectorAll('[data-act="theme"]').forEach((b) => {
    b.textContent = t(THEMES[theme] || THEMES[""]);
    b.title = L("Colours: " + (theme ? theme + " mode" : "automatic (follows Windows)") + " — click to change",
      "颜色：" + (theme === "dark" ? "深色" : theme === "light" ? "浅色" : "自动（跟随 Windows）") + "——点击切换");
  });
}
async function cycleTheme() {
  const order = ["", "dark", "light"];
  const next = order[(order.indexOf(S.settings.theme || "") + 1) % order.length];
  S.settings.theme = next;
  applyTheme(next);
  try { await call("POST", "/api/settings", S.settings); } catch (e) { toast(L("Couldn't save the colour setting: ", "无法保存颜色设置：") + e.message); }
}
// Same for light/dark: the page already has your choice (data-theme from the app); the browser's memory only if set.
applyTheme((() => { try { const s = localStorage.getItem("theme"); return s !== null ? s : (document.documentElement.getAttribute("data-theme") || ""); } catch (e) { return document.documentElement.getAttribute("data-theme") || ""; } })());
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="theme"]')) cycleTheme(); });
// ⚙ Settings (in the Library and Catalog headers).
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="settings"]')) location.href = "/settings"; });

let version = -1;
let libGen = 0; // goes up every time the library is (re)loaded, so remembered lists know they're out of date
async function load() {
  const t0 = performance.now();
  const d = await call("GET", "/api/state");
  libGen++;
  PERF.add("load: download + read library data", performance.now() - t0, Object.keys((d.library || {}).albums || {}).length, "items");
  version = d.version;
  S.lib = d.library || { albums: {} };
  S.aliases = d.aliases || {};
  S.myTeams = d.myTeams || {};
  S.settings = Object.assign({ autoSave: true }, d.settings || {});
  if (useLanguage(S.settings.language)) return; // reloads the page if the language changed elsewhere
  applyTheme(S.settings.theme || "");
  applySidebarWidth(S.settings.sidebarWidth || 0);
  S.storeNames = d.storeNames || {};
  S.storeCats = d.storeCategories || {};
  // Hovering over the page title shows which version of the app this is.
  if (d.appVersion) {
    const h = document.querySelector("header h1"); if (h) h.title = L("Yupoo Library version ", "Yupoo 图库版本 ") + d.appVersion;
    const u = document.querySelector('[data-act="update"]'); if (u) u.title = L("You have version " + d.appVersion + " — see if a newer one is out", "你的版本是 " + d.appVersion + "——看看有没有新版本");
  }
  S.collections = d.collections || [];
  S.locked = d.lockedStores || []; // stores the ✨ New Additions check can't read without a password
  S.storeTotals = d.storeTotals || {}; // how many albums each store has on Yupoo (store address -> number)
  // What each item is (info) is remembered between reloads: the memory is tied to the item's title,
  // team, category and store setting, so an item that changed is worked out again anyway. Only new
  // team nicknames (✎ Team, my-teams.txt) can change everything, so only then start over.
  const teamWords = JSON.stringify(allAliases());
  // (Also start over if the memory has filled up with old versions of items, e.g. after many changes.)
  if (teamWords !== lastTeamWords || cache.size > 2 * Object.keys(S.lib.albums).length + 1000) {
    lastTeamWords = teamWords;
    matcher = YO_buildMatcher(allAliases());
    cache.clear();
  }
  // Pages that show items read back last time's results (see InfoStore), and save new ones later.
  if (PERF.page === "library" || PERF.page === "catalog") await InfoStore.preload();
  setTimeout(() => InfoStore.saveSoon(), 0);
}
let lastTeamWords = null;
async function loadCollections() {
  S.collections = (await call("GET", "/api/collections")) || [];
}
const all = () => Object.values(S.lib.albums);
// Names learned with ✎ Team, plus your my-teams.txt list (which wins).
const allAliases = () => Object.assign({}, S.aliases, S.myTeams);
// Your own name for a store (set with ✎ in the Stores list), or its original name.
const storeName = (s) => S.storeNames[s] || s;

// Everything the app knows about an item: what it is (the item sorter, categories.js) and,
// for clothing, the team, season, kit type and extras (teams.js).
// Each item also gets a direct shortcut to its details (infoMemo), so sorting and filtering — which ask
// for them hundreds of thousands of times — don't have to build the long label below every time.
// (Kept beside the item, not in it, so nothing extra ends up in exports or shared files.)
const infoMemo = new WeakMap();
function info(a) {
  const storeCat = S.storeCats[a.store] || "";
  const memo = infoMemo.get(a);
  if (memo && memo.s === storeCat) return memo.r;
  const ck = [a.key, a.title, a.team || "", a.category || "", storeCat].join("|");
  let r = cache.get(ck);
  if (r) { infoMemo.set(a, { s: storeCat, r }); return r; }
  const p = YO_parse(a.title, matcher);
  const c = YO_categorize(a.title, p, a.category, storeCat);
  const clothing = YO_CLOTHING.indexOf(c.category) !== -1;
  const kit = c.sub === "Football Kit";
  r = Object.assign({}, p, {
    category: c.category, sub: c.sub, catPath: c.category + (c.sub ? " › " + c.sub : ""), catHow: c.how,
    clothing, footballKit: kit, catEdited: c.how === "yours"
  });
  if (!clothing) Object.assign(r, { team: null, season: null, seasonKey: null, kit: null, extras: [] });
  // Basketball / other sports jerseys: the team list is for football (凯尔特人 is Celtic, not the Celtics).
  else if (c.sub === "Basketball Jersey" || c.sub === "Other Sports Jersey") Object.assign(r, { team: null, kit: null });
  else if (!kit) r.kit = null;
  if (clothing && a.team) Object.assign(r, { team: a.team, edited: true });
  r.brand = YO_brand(a.title, c.category);
  // Football kits get the "Liverpool 2024/25 Home" style name; everything else a tidied-up title.
  r.english = r.team || kit ? YO_english(r) : YO_cleanName(a.title);
  cache.set(ck, r);
  infoMemo.set(a, { s: storeCat, r });
  InfoStore.unsaved.push(ck);
  return r;
}

// ---------- remembering what each item is between launches ----------
// Working out every item (team, category, brand) took most of the time when opening the Library, though
// nearly all items are the same as last time. So the results are kept in the page's own storage
// (IndexedDB, inside the app's browser folder) and read back next time. They're thrown away whenever
// the sorting rules or your team nicknames change (the "fingerprint"), so they can never be out of date.
const InfoStore = {
  db: null, unsaved: [], loaded: false,
  // A short code that changes whenever anything that decides an item's details changes.
  fingerprint() {
    const parts = [info, YO_parse, YO_categorize, YO_brand, YO_cleanName, YO_english, YO_TEAMS, YO_KIT, YO_EXTRAS,
      YO_CATEGORY_WORDS, YO_CATEGORIES, YO_CLOTHING, YO_BRANDS, YO_BRAND_CODES, YO_NBA_TEAMS, YO_JERSEY_HINT, YO_NOT_JERSEY,
      YO_SHOE_SIZES, YO_CLOTHING_SIZES, YO_SEASON_RE, allAliases()];
    const text = JSON.stringify(parts, (k, v) => (typeof v === "function" || v instanceof RegExp ? String(v) : v));
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ":" + text.length;
  },
  open() {
    return new Promise((res) => {
      try {
        const rq = indexedDB.open("yupoo-library", 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore("info"); rq.result.createObjectStore("meta"); };
        rq.onsuccess = () => res((this.db = rq.result));
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  // Fills the memory with last time's results (if the fingerprint still matches).
  async preload() {
    if (this.loaded) return;
    this.loaded = true;
    const t = performance.now();
    if (!(await this.open())) return;
    const fp = this.fingerprint();
    const db = this.db;
    const rec = (store, fn) => new Promise((res) => {
      try { const tx = db.transaction(store, "readonly"); const rq = fn(tx.objectStore(store)); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }
      catch (e) { res(null); }
    });
    const saved = await rec("meta", (s) => s.get("fingerprint"));
    if (saved !== fp) {
      // Rules changed (or first time): start afresh.
      try { const tx = db.transaction(["info", "meta"], "readwrite"); tx.objectStore("info").clear(); tx.objectStore("meta").put(fp, "fingerprint"); } catch (e) {}
      PERF.add("load: remembered item details", performance.now() - t, 0, "none (rules changed or first time)");
      return;
    }
    const rows = (await rec("info", (s) => s.getAll())) || [];
    // Only items still in the library (removed stores and old versions of items are skipped).
    let used = 0;
    rows.forEach((row) => {
      if (row && row.k && S.lib.albums[row.k.slice(0, row.k.indexOf("|"))] && !cache.has(row.k)) { cache.set(row.k, row.r); used++; }
    });
    // Mostly out of date (e.g. a big store was removed): empty the storage and save the current ones again.
    if (rows.length > 1000 && used < rows.length * 0.7) {
      try { db.transaction("info", "readwrite").objectStore("info").clear(); } catch (e) {}
      this.unsaved = [...cache.keys()];
    }
    PERF.add("load: remembered item details", performance.now() - t, used, "items");
  },
  // Writes new results a while after the page has settled, a few thousand at a time so it never stutters.
  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveChunk(), 3000);
  },
  saveChunk() {
    if (!this.db || !this.unsaved.length) return;
    const keys = this.unsaved.splice(0, 4000);
    try {
      const tx = this.db.transaction("info", "readwrite"), st = tx.objectStore("info");
      keys.forEach((k) => { const r = cache.get(k); if (r) st.put({ k, r }, k); });
      tx.oncomplete = () => { if (this.unsaved.length) setTimeout(() => this.saveChunk(), 200); };
    } catch (e) { this.unsaved = []; }
  }
};

// Photos come from the app's saved copies. If one isn't ready yet, keep retrying for a while
// (the live Yupoo photo can't be shown here, since Yupoo blocks photos outside its own pages).
function loadThumb(img, attempt) {
  attempt = attempt || 0;
  img.onload = () => { img.style.visibility = ""; img.parentElement.classList.remove("waiting"); };
  img.onerror = () => {
    img.style.visibility = "hidden";
    img.parentElement.classList.add("waiting");
    if (attempt < 12) setTimeout(() => { if (img.isConnected) loadThumb(img, attempt + 1); }, Math.min(2000 + attempt * 1500, 10000));
  };
  img.src = "/thumb/" + encodeURIComponent(img.dataset.key.replace(/[^A-Za-z0-9._-]/g, "_")) + (attempt ? "?r=" + attempt : "");
}

// ---------- collections (the Catalog) ----------
// The collections an item is in.
function collectionsOf(key) {
  return S.collections.filter((c) => c.items.some((it) => it.key === key));
}

// Opens the Catalog: in this window, or (newWindow) in a window of its own.
function openCatalog(newWindow, collectionId) {
  const url = "/catalog" + (collectionId ? "#" + encodeURIComponent(collectionId) : "");
  if (newWindow) {
    const w = window.open(url, "yupoo-catalog", "width=1240,height=860");
    if (w) { w.focus(); return; }
  }
  location.href = url;
}

// The "add to collection" pop-up, next to the button you clicked. It lists your collections with a ✓
// on the ones that already have these items; clicking one adds them (or takes them out again).
// Typing a name that doesn't exist yet offers to make a new collection.
let colpop = null;
function closeCollectionPicker() { if (colpop) { colpop.remove(); colpop = null; } }

function openCollectionPicker(anchor, keys, onChange) {
  closeCollectionPicker();
  if (!keys.length) return;
  colpop = document.createElement("div");
  colpop.className = "colpop";
  colpop.innerHTML = `<h4>${keys.length === 1 ? t("Add to collection") : L(`Add ${keys.length} items to…`, `把 ${keys.length} 件加入…`)}</h4>
    <input type="search" placeholder="${t("Search or name a new collection…")}" autocomplete="off">
    <div class="dd-list"></div>`;
  document.body.appendChild(colpop);
  const input = colpop.querySelector("input");
  // Below the button if it fits, otherwise above it.
  const place = () => {
    const r = anchor.getBoundingClientRect(), h = colpop.offsetHeight;
    colpop.style.left = Math.max(8, Math.min(r.left, innerWidth - colpop.offsetWidth - 8)) + "px";
    colpop.style.top = (r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + "px";
  };

  const render = () => {
    const q = input.value.trim(), ql = q.toLowerCase();
    let html = "";
    S.collections.filter((c) => !ql || c.name.toLowerCase().includes(ql)).forEach((c) => {
      const inIt = keys.every((k) => c.items.some((it) => it.key === k));
      html += `<div class="item ${inIt ? "in" : ""}" role="button" tabindex="0" data-col="${esc(c.id)}">
        <span class="ck">${inIt ? "✓" : ""}</span><span class="name">${esc(c.name)}</span><span class="c">${c.items.length}</span></div>`;
    });
    const suggest = q || (S.collections.length ? "" : L("Wishlist", "愿望清单"));
    if (suggest && !S.collections.some((c) => c.name.toLowerCase() === suggest.toLowerCase())) {
      html += `<div class="item new" role="button" tabindex="0" data-newcol="${esc(suggest)}"><span class="name">${L("➕ New collection", "➕ 新建收藏夹")} “${esc(suggest)}”</span></div>`;
    }
    if (!S.collections.length && !q) html += `<div class="hint">${L("Or type a name above for your first collection.", "或者在上面输入名字，新建你的第一个收藏夹。")}</div>`;
    colpop.querySelector(".dd-list").innerHTML = html;
  };

  const choose = async (el) => {
    try {
      if (el.dataset.newcol !== undefined) {
        const res = await call("POST", "/api/collections/create", { name: el.dataset.newcol, keys });
        await loadCollections();
        toast(L(`Added ${plural(keys.length, "item")} to “${res.collection.name}”.`, `已把 ${keys.length} 件加入“${res.collection.name}”。`), "Open", () => openCatalog(false, res.collection.id));
      } else {
        const c = S.collections.find((x) => x.id === el.dataset.col);
        const inIt = keys.every((k) => c.items.some((it) => it.key === k));
        await call("POST", "/api/collections/" + (inIt ? "remove" : "add"), { id: c.id, keys });
        await loadCollections();
        toast(inIt ? L(`Took ${plural(keys.length, "item")} out of “${c.name}”.`, `已把 ${keys.length} 件移出“${c.name}”。`) : L(`Added ${plural(keys.length, "item")} to “${c.name}”.`, `已把 ${keys.length} 件加入“${c.name}”。`));
      }
    } catch (e) { toast(L("Couldn't change the collection: ", "无法修改收藏夹：") + e.message); }
    closeCollectionPicker();
    if (onChange) onChange();
  };

  colpop.addEventListener("click", (e) => {
    e.stopPropagation();
    const el = e.target.closest("[data-col], [data-newcol]");
    if (el) choose(el);
  });
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCollectionPicker();
    else if (e.key === "Enter") { const first = colpop.querySelector("[data-col], [data-newcol]"); if (first) choose(first); }
  });
  render();
  place();
  input.focus();
}
document.addEventListener("click", (e) => {
  if (colpop && !e.target.closest(".colpop") && !e.target.closest("[data-collect], [data-sel='collect']")) closeCollectionPicker();
}, true);
