// Yupoo Library app — code shared by the Library and Catalog pages (loaded before library.js / catalog.js).
const TOKEN = document.querySelector('meta[name="kit-token"]').content;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(typeof LANG !== "undefined" && LANG === "zh" ? "zh-CN" : undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
const today = () => new Date().toISOString().slice(0, 10);
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
  try { applySidebarWidth(+localStorage.getItem("sidebarWidth") || 0); } catch (e) {}
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
applyTheme((() => { try { return localStorage.getItem("theme") || ""; } catch (e) { return ""; } })());
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="theme"]')) cycleTheme(); });
// ⚙ Settings (in the Library and Catalog headers).
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="settings"]')) location.href = "/settings"; });

let version = -1;
async function load() {
  const d = await call("GET", "/api/state");
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
  matcher = YO_buildMatcher(allAliases());
  cache.clear();
}
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
function info(a) {
  const storeCat = S.storeCats[a.store] || "";
  const ck = [a.key, a.title, a.team || "", a.category || "", storeCat].join("|");
  let r = cache.get(ck);
  if (r) return r;
  const p = YO_parse(a.title, matcher);
  const c = YO_categorize(a.title, p, a.category, storeCat);
  const clothing = YO_CLOTHING.indexOf(c.category) !== -1;
  const kit = c.sub === "Football Kit";
  r = Object.assign({}, p, {
    category: c.category, sub: c.sub, catPath: c.category + (c.sub ? " › " + c.sub : ""), catHow: c.how,
    clothing, footballKit: kit, catEdited: c.how === "yours"
  });
  if (!clothing) Object.assign(r, { team: null, season: null, seasonKey: null, kit: null, extras: [] });
  else if (!kit) r.kit = null;
  if (clothing && a.team) Object.assign(r, { team: a.team, edited: true });
  r.brand = YO_brand(a.title, c.category);
  // Football kits get the "Liverpool 2024/25 Home" style name; everything else a tidied-up title.
  r.english = r.team || kit ? YO_english(r) : YO_cleanName(a.title);
  cache.set(ck, r);
  return r;
}

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
