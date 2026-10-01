// Yupoo Library app — the library page: every item you've saved, from every store, in one place.
const TOKEN = document.querySelector('meta[name="kit-token"]').content;
const PAGE_SIZE = 120;

const S = {
  lib: { albums: {} }, aliases: {}, myTeams: {}, settings: { autoSave: true }, storeNames: {}, storeCats: {},
  cat: "", team: "", store: "", kit: "", season: "", extra: "", q: "", sort: "team", shown: PAGE_SIZE
};
// The dropdown filters above the items. "f" is the name of the filter in S.
const FILTERS = [
  { f: "cat", label: "Category", any: "Any category" },
  { f: "team", label: "Team", any: "Any team" },
  { f: "season", label: "Season", any: "Any season" },
  { f: "kit", label: "Kit type", any: "Any kit type" },
  { f: "extra", label: "Extras", any: "Any extras" },
  { f: "store", label: "Store", any: "Any store" }
];
let openDD = ""; // which dropdown is open right now
let matcher = YO_buildMatcher({});
const cache = new Map();

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

// ---------- talking to the app ----------
async function call(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: Object.assign({ "X-Kit-Token": TOKEN }, raw ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer = null, toastAction = null;
// A message at the bottom. With actionLabel, it also gets a button (e.g. Undo) and stays a bit longer.
function toast(msg, actionLabel, action) {
  const t = $(".toast");
  t.innerHTML = esc(msg) + (actionLabel ? ` <button class="toast-act">${esc(actionLabel)}</button>` : "");
  toastAction = action || null;
  t.classList.toggle("act", !!actionLabel);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show", "act"); toastAction = null; }, actionLabel ? 15000 : 4500);
}

// ---------- data ----------
let version = -1;
async function load() {
  const d = await call("GET", "/api/state");
  version = d.version;
  S.lib = d.library || { albums: {} };
  S.aliases = d.aliases || {};
  S.myTeams = d.myTeams || {};
  S.settings = Object.assign({ autoSave: true }, d.settings || {});
  S.storeNames = d.storeNames || {};
  S.storeCats = d.storeCategories || {};
  matcher = YO_buildMatcher(allAliases());
  cache.clear();
}
const all = () => Object.values(S.lib.albums);
// Names learned with ✎ Team, plus your my-teams.txt list (which wins).
const allAliases = () => Object.assign({}, S.aliases, S.myTeams);
// Your own name for a store (set with ✎ in the Stores list), or its original name.
const storeName = (s) => S.storeNames[s] || s;

// Everything the Library knows about an item: what it is (the item sorter, categories.js) and,
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
  // Football kits get the "Liverpool 2024/25 Home" style name; everything else a tidied-up title.
  r.english = r.team || kit ? YO_english(r) : YO_cleanName(a.title);
  cache.set(ck, r);
  return r;
}

// ---------- sidebar ----------
function teamMatches(team, q) {
  if (!q) return true;
  if (team.toLowerCase().includes(q)) return true;
  if ((YO_TEAMS[team] || []).some((a) => a.toLowerCase().includes(q))) return true;
  const al = allAliases();
  return Object.keys(al).some((a) => al[a] === team && a.toLowerCase().includes(q));
}
const item = (attr, val, label, n, active, extra, openUrl, renameStore) =>
  `<div class="item ${active ? "on" : ""} ${extra || ""}" role="button" tabindex="0" data-${attr}="${esc(val)}"><span class="name" title="${esc(label)}">${esc(label)}</span>` +
  (renameStore ? `<button class="ren" data-store-cat="${esc(val)}" title="What this store sells${S.storeCats[val] ? ": " + esc(S.storeCats[val]) : ""}">🏷</button>` +
    `<button class="ren" data-rename-store="${esc(val)}" title="Rename this store">✎</button>` : "") +
  (openUrl ? `<a class="open" href="${esc(openUrl)}" title="Open this store">open ↗</a>` : "") +
  `<span class="c">${n}</span></div>`;

// Categories, with their subcategories underneath (only the ones that have items).
function renderCats() {
  const inStore = all().filter((a) => !S.store || a.store === S.store);
  const counts = new Map();
  inStore.forEach((a) => {
    const p = info(a);
    counts.set(p.category, (counts.get(p.category) || 0) + 1);
    if (p.sub) counts.set(p.catPath, (counts.get(p.catPath) || 0) + 1);
  });
  const paths = YO_categoryPaths();
  // Categories you typed yourself that aren't in categories.js still get listed.
  [...counts.keys()].forEach((k) => { if (paths.indexOf(k) === -1) paths.push(k); });
  // A main category with subcategories folds open/closed with its ▸ arrow.
  const hasSubs = new Set(paths.filter((p) => p.indexOf(" › ") !== -1 && counts.get(p)).map((p) => p.split(" › ")[0]));
  let html = item("cat", "", "All items", inStore.length, S.cat === "", "top").replace('<span class="name"', '<span class="chev-gap"></span><span class="name"');
  paths.sort((a, b) => catRank(a) - catRank(b)).forEach((path) => {
    if (!counts.get(path)) return;
    const sub = path.indexOf(" › ") !== -1;
    const top = sub ? path.split(" › ")[0] : path;
    const open = openCats.has(top);
    if (sub) { if (open) html += item("cat", path, path.split(" › ")[1], counts.get(path), S.cat === path, "sub"); return; }
    const chev = hasSubs.has(top)
      ? `<button class="chev ${open ? "open" : ""}" data-chev="${esc(top)}" title="${open ? "Hide" : "Show"} subcategories">▸</button>`
      : `<span class="chev-gap"></span>`;
    html += item("cat", path, path, counts.get(path), S.cat === path, "top").replace('<span class="name"', chev + '<span class="name"');
  });
  $(".cats").innerHTML = html;
}

// Which main categories you've opened. Remembered on this computer between visits.
const openCats = new Set((() => { try { return JSON.parse(localStorage.getItem("openCats") || "[]"); } catch (e) { return []; } })());
function setCatOpen(top, open) {
  if (open) openCats.add(top);
  else {
    openCats.delete(top);
    // Folding away the subcategory you're looking at widens the filter to the whole category.
    if (S.cat.indexOf(top + " › ") === 0) S.cat = top;
  }
  try { localStorage.setItem("openCats", JSON.stringify([...openCats])); } catch (e) {}
}
const catRank = (path) => { const [c, s] = path.split(" › "); return YO_categoryRank(c, s || ""); };

function renderStores() {
  const counts = new Map(), hosts = new Map();
  all().forEach((a) => { counts.set(a.store, (counts.get(a.store) || 0) + 1); hosts.set(a.store, a.host); });
  let html = item("store", "", "All stores", all().length, S.store === "");
  [...counts.keys()].sort((a, b) => storeName(a).localeCompare(storeName(b))).forEach((s) => {
    html += item("store", s, storeName(s), counts.get(s), S.store === s, "", "https://" + hosts.get(s) + "/albums", true);
  });
  $(".stores").innerHTML = html;
}

// ---------- dropdown filters ----------
// What an item counts as for each filter. "—" means the title doesn't say.
function vals(a, f) {
  const p = info(a);
  if (f === "cat") return p.sub ? [p.category, p.catPath] : [p.category];
  if (f === "team") return [p.team || (p.footballKit ? "__unsorted" : "—")];
  if (f === "season") return [p.season || "—"];
  if (f === "kit") return [p.kit || "—"];
  if (f === "extra") return p.extras.length ? p.extras : ["—"];
  return [a.store];
}
function optionLabel(f, v) {
  if (v === "__unsorted") return "⚠ Kits with no team";
  if (v === "—") return { team: "No team", season: "No season", kit: "No kit type", extra: "No extras" }[f];
  return f === "store" ? storeName(v) : v;
}
const KIT_ORDER = ["Home", "Away", "Second Away", "Third", "Goalkeeper", "Training", "Pre-Match"];
function optionOrder(f) {
  if (f === "cat") return (a, b) => catRank(a) - catRank(b) || a.localeCompare(b);
  if (f === "season") return (a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0) || b.localeCompare(a);
  if (f === "kit") return (a, b) => (a === "—") - (b === "—") || KIT_ORDER.indexOf(a) - KIT_ORDER.indexOf(b);
  return (a, b) => (a === "__unsorted" ? -1 : b === "__unsorted" ? 1 : 0) || (a === "—") - (b === "—") ||
    optionLabel(f, a).localeCompare(optionLabel(f, b));
}
// Typing in a dropdown's search box: teams also match their Chinese names, stores their original name.
function optionMatches(f, v, q) {
  if (!q) return true;
  if (optionLabel(f, v).toLowerCase().includes(q)) return true;
  if (f === "team" && v !== "__unsorted") return teamMatches(v, q);
  if (f === "store") return v.toLowerCase().includes(q);
  return false;
}

function renderFilters() {
  const box = $(".dds");
  if (!box.children.length) {
    box.innerHTML = FILTERS.map(({ f }) =>
      `<div class="dd" data-dd="${f}"><button class="dd-btn" data-dd-toggle="${f}"></button>` +
      `<div class="dd-panel" hidden><input type="search" placeholder="Search…" autocomplete="off"><div class="dd-list"></div></div></div>`).join("");
  }
  FILTERS.forEach(({ f, label, any }) => {
    const btn = box.querySelector(`[data-dd-toggle="${f}"]`);
    btn.textContent = S[f] ? `${label}: ${optionLabel(f, S[f])} ▾` : `${any} ▾`;
    btn.classList.toggle("on", !!S[f]);
    btn.title = btn.textContent;
    box.querySelector(`[data-dd="${f}"] .dd-panel`).hidden = openDD !== f;
  });
  if (openDD) renderOptions(openDD);
  $(".clear").hidden = !(S.q || FILTERS.some(({ f }) => S[f]));
}

// The choices in one dropdown, with how many items each would show (given the other filters).
function renderOptions(f) {
  const panel = $(`[data-dd="${f}"] .dd-panel`);
  const q = panel.querySelector("input").value.toLowerCase().trim();
  const counts = new Map(); let total = 0;
  all().forEach((a) => {
    if (!passes(a, f)) return;
    total++;
    new Set(vals(a, f)).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  });
  if (S[f] && !counts.has(S[f])) counts.set(S[f], 0); // keep your current choice visible
  const any = FILTERS.find((x) => x.f === f).any;
  let html = q ? "" : item("pick", "", any, total, !S[f]);
  [...counts.keys()].sort(optionOrder(f)).filter((v) => optionMatches(f, v, q))
    .forEach((v) => { html += item("pick", v, optionLabel(f, v), counts.get(v), S[f] === v, v === "__unsorted" ? "warn" : ""); });
  panel.querySelector(".dd-list").innerHTML = html || `<div class="summary" style="padding:4px 8px">Nothing matches “${esc(q)}”.</div>`;
}

function toggleDD(f) {
  openDD = openDD === f ? "" : f;
  if (openDD) {
    const input = $(`[data-dd="${f}"] input`);
    input.value = "";
    renderFilters();
    input.focus();
  } else renderFilters();
}

function pick(f, v) {
  S[f] = v; openDD = ""; S.shown = PAGE_SIZE;
  if (f === "cat" && v) setCatOpen(v.split(" › ")[0], true);
  update();
  $("main").scrollTop = 0;
}

// ---------- grid ----------
// Does this item pass every filter (except "skip") and the search box?
function passes(a, skip) {
  for (const { f } of FILTERS) {
    if (f !== skip && S[f] && !vals(a, f).includes(S[f])) return false;
  }
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const p = info(a);
    const hay = (p.english + " " + p.catPath + " " + a.title + " " + a.store + " " + storeName(a.store)).toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function filtered() {
  const list = all().filter((a) => passes(a));
  const sk = (a) => info(a).seasonKey;
  const byTeam = (a, b) => {
    const ta = info(a).team, tb = info(b).team;
    if (!ta !== !tb) return ta ? -1 : 1; // unsorted last
    return (ta || "").localeCompare(tb || "");
  };
  const byCat = (a, b) => { const pa = info(a), pb = info(b); return YO_categoryRank(pa.category, pa.sub) - YO_categoryRank(pb.category, pb.sub); };
  const byName = (a, b) => info(a).english.localeCompare(info(b).english);
  const cmp = {
    team: (a, b) => byCat(a, b) || byTeam(a, b) || (sk(b) || 0) - (sk(a) || 0) || byName(a, b),
    new: (a, b) => (sk(b) || 0) - (sk(a) || 0),
    old: (a, b) => (sk(a) || 9999) - (sk(b) || 9999),
    saved: (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)
  }[S.sort];
  return list.sort(cmp);
}

function renderGrid() {
  const list = filtered(), total = all().length;
  shownKeys = list.slice(0, S.shown).map((a) => a.key);
  matchingKeys = list.map((a) => a.key);
  renderSelBar();
  $(".count").textContent = total ? `${total} items · ${new Set(all().map((a) => a.store)).size} stores` : "";
  if (!total) {
    $(".summary").textContent = "";
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Your library is empty</strong>
      <ol>
        <li>Paste a Yupoo link in the box at the top and press <b>Open</b>.</li>
        <li>Browse as normal — every item you see is saved here automatically.</li>
        <li>Press <b>Save whole store</b> in the green bar to grab a supplier's entire catalog.</li>
        <li>Press <b>Library</b> in the green bar to come back here.</li>
      </ol></div>`;
    $(".more").hidden = true;
    return;
  }
  $(".summary").textContent = `Showing ${Math.min(list.length, S.shown)} of ${list.length} items` +
    (list.length !== total ? ` (${total} saved in total)` : "");
  if (!list.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1">No items match these filters.</div>`;
    $(".more").hidden = true;
    return;
  }
  $(".grid").innerHTML = list.slice(0, S.shown).map((a, i) => {
    const p = info(a);
    return `<div class="card ${sel.has(a.key) ? "picked" : ""}" data-card="${esc(a.key)}" data-i="${i}">
      <span class="tick" aria-hidden="true">✓</span>
      <a class="img" href="${esc(a.link)}">
        <img data-key="${esc(a.key)}" data-cover="${esc(a.cover || "")}" alt="" loading="lazy">
        ${a.count ? `<span class="n">${a.count} photos</span>` : ""}
      </a>
      <div class="meta">
        <div class="catline ${p.category === "Other" ? "unsorted" : ""}">${esc(p.catPath)}${p.catEdited ? ` · <span class="tag">your pick</span>` : ""}</div>
        <div class="en ${p.footballKit && !p.team ? "unsorted" : ""}">${esc(p.english)}</div>
        ${p.english !== a.title ? `<div class="zh">${esc(a.title)}</div>` : ""}
        <div class="src">${esc(storeName(a.store))} · saved ${esc(fmtDate(a.firstSeen))}${p.edited ? ` · <span class="tag">your fix</span>` : ""}</div>
        <div class="row">
          <a href="${esc(a.link)}">Open album ↗</a>
          <button data-cat-edit="${esc(a.key)}" title="Change what this item is">🏷</button>
          ${p.clothing ? `<button data-edit="${esc(a.key)}" title="Set the team">✎ Team</button>` : ""}
          <button data-remove="${esc(a.key)}" title="Remove from library">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
  $(".more").hidden = list.length <= S.shown;
  document.querySelectorAll("img[data-key]").forEach(loadThumb);
}

// ---------- bulk edit ----------
// "☑ Select" turns on select mode: click cards to tick them (Shift+click ticks a whole run),
// then use the bar at the bottom to move them all to a category at once.
let selecting = false, lastPicked = -1, mvOpen = false, shownKeys = [], matchingKeys = [];
const sel = new Set();

function setSelecting(on) {
  selecting = on;
  if (!on) { sel.clear(); mvOpen = false; }
  lastPicked = -1;
  document.body.classList.toggle("selecting", on);
  $(".selbtn").classList.toggle("on", on);
  $(".selbtn").textContent = on ? "☑ Selecting…" : "☑ Select";
  renderGrid();
}

function togglePick(card, shift) {
  const i = +card.dataset.i, key = card.dataset.card;
  if (shift && lastPicked !== -1) {
    // Shift+click: tick (or untick) everything between the last card you clicked and this one.
    const on = !sel.has(key);
    const [from, to] = i < lastPicked ? [i, lastPicked] : [lastPicked, i];
    shownKeys.slice(from, to + 1).forEach((k) => (on ? sel.add(k) : sel.delete(k)));
  } else if (sel.has(key)) sel.delete(key);
  else sel.add(key);
  lastPicked = i;
  document.querySelectorAll(".card[data-card]").forEach((c) => c.classList.toggle("picked", sel.has(c.dataset.card)));
  renderSelBar();
}

function renderSelBar() {
  const bar = $(".selbar");
  bar.hidden = !selecting;
  if (!selecting) return;
  const n = sel.size;
  $(".selcount").textContent = n ? `${n} selected` : "Click items to select them";
  $('[data-sel="page"]').textContent = `Select shown (${shownKeys.length})`;
  $('[data-sel="all"]').textContent = `Select all matching (${matchingKeys.length})`;
  $('[data-sel="all"]').hidden = matchingKeys.length <= shownKeys.length;
  bar.querySelectorAll(".needs").forEach((b) => { b.disabled = !n; });
  $(".mv .dd-panel").hidden = !mvOpen || !n;
  if (mvOpen && n) renderMoveOptions();
}

// The "Move to…" list: every category (plus ones you've made up), searchable; typing a new name offers to create it.
function renderMoveOptions() {
  const q = $(".mv input").value.trim();
  const ql = q.toLowerCase();
  const paths = YO_categoryPaths();
  all().forEach((a) => { const p = info(a).catPath; if (paths.indexOf(p) === -1) paths.push(p); });
  paths.sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
  const hits = paths.filter((p) => !ql || p.toLowerCase().includes(ql));
  let html = hits.map((p) => {
    const sub = p.indexOf(" › ") !== -1;
    return `<div class="item ${sub ? "sub" : "top"}" role="button" tabindex="0" data-move="${esc(p)}"><span class="name">${esc(sub ? p.split(" › ")[1] : p)}</span>` +
      (sub && ql ? `<span class="c">${esc(p.split(" › ")[0])}</span>` : "") + `</div>`;
  }).join("");
  const typed = q.replace(/\s*[>›]\s*/g, " › ");
  if (q && !paths.some((p) => p.toLowerCase() === typed.toLowerCase())) {
    html += `<div class="item new" role="button" tabindex="0" data-move="${esc(typed)}"><span class="name">➕ New category “${esc(typed)}”</span></div>`;
  }
  $(".mv .dd-list").innerHTML = html;
}

async function moveSelected(category) {
  const keys = [...sel];
  if (!keys.length) return;
  // Remember each item's old choice so Undo can put it back.
  const before = new Map();
  keys.forEach((k) => {
    const old = (S.lib.albums[k] && S.lib.albums[k].category) || "";
    if (!before.has(old)) before.set(old, []);
    before.get(old).push(k);
  });
  try {
    await call("POST", "/api/categories", { keys, category });
  } catch (e) { toast("Couldn't move them: " + e.message); return; }
  sel.clear(); mvOpen = false;
  await refresh();
  const where = category ? `to ${category}` : "back to the item sorter";
  toast(`Moved ${keys.length} item${keys.length === 1 ? "" : "s"} ${where}.`, "Undo", async () => {
    for (const [old, ks] of before) await call("POST", "/api/categories", { keys: ks, category: old });
    await refresh();
    toast("Undone.");
  });
}

async function removeSelected() {
  const keys = [...sel];
  if (!keys.length || !confirm(`Remove ${keys.length} item${keys.length === 1 ? "" : "s"} from your library?\n\nThis can't be undone.`)) return;
  await call("POST", "/api/remove", { keys });
  sel.clear();
  await refresh();
  toast(`Removed ${keys.length} items.`);
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

function update() { renderCats(); renderStores(); renderFilters(); renderGrid(); }
function renderAll() {
  update();
  $(".autosave").checked = S.settings.autoSave;
}
async function refresh() {
  const scroll = $("main").scrollTop;
  await load(); renderAll();
  $("main").scrollTop = scroll;
}

// ---------- actions ----------
async function editTeam(key) {
  const a = S.lib.albums[key]; if (!a) return;
  const p = info(a);
  const input = prompt(`Which team is this kit?\n\n${a.title}\n\nType the English team name (e.g. Liverpool). Leave empty to undo your fix.`, p.team || "");
  if (input === null) return;
  const name = input.trim();
  const canon = name ? (YO_canonicalTeam(name, allAliases()) || name) : "";
  const parsedTeam = YO_parse(a.title, matcher).team;
  const seg = YO_guessAlias(a.title);
  if (canon && seg && !parsedTeam && confirm(`Also treat "${seg}" as ${canon} for every item, in every store?`)) {
    S.aliases[seg] = canon;
    await call("POST", "/api/aliases", S.aliases);
  }
  await call("POST", "/api/team", { key, team: canon });
  await refresh();
}

async function removeKit(key) {
  const a = S.lib.albums[key]; if (!a) return;
  if (!confirm(`Remove this item from your library?\n\n${info(a).english}`)) return;
  await call("POST", "/api/remove", { keys: [key] });
  await refresh();
}

async function renameStore(store) {
  const input = prompt(`Rename this store\n\nOriginal name: ${store}\n\nType your own name for it. Leave empty to go back to the original name.`, storeName(store));
  if (input === null) return;
  await call("POST", "/api/store-name", { store, name: input.trim() });
  await refresh();
}

// Asks for a category: a number from the list, or a name like "Shoes › Sneakers" or just "Sneakers".
// Returns the chosen path, "" for "work it out automatically", or null if cancelled.
function chooseCategory(heading, current, emptyMeans) {
  const paths = YO_categoryPaths();
  const list = paths.map((p, i) => `${i + 1}. ${p.indexOf(" › ") !== -1 ? "      " + p.split(" › ")[1] : p}`).join("\n");
  const input = prompt(`${heading}\n\n${list}\n\nType a number, or a name. Leave empty ${emptyMeans}.`, current || "");
  if (input === null) return null;
  const t = input.trim();
  if (!t) return "";
  if (/^\d+$/.test(t) && paths[+t - 1]) return paths[+t - 1];
  const low = t.toLowerCase().replace(/\s*[>›]\s*/g, " › ");
  return paths.find((p) => p.toLowerCase() === low) ||
    paths.find((p) => p.toLowerCase().endsWith("› " + low)) ||
    t.replace(/\s*[>›]\s*/g, " › "); // a new name of your own
}

async function setItemCategory(key) {
  const a = S.lib.albums[key]; if (!a) return;
  const p = info(a);
  const how = { word: "from a word in its title", store: "from the store's 🏷 setting", sizes: "from the shoe sizes in its title",
    team: "because a team was found in its title", none: "nothing in its title said", yours: "your pick" }[p.catHow];
  const pick = chooseCategory(`What is this item?\n\n${a.title}\n\nRight now: ${p.catPath} (${how})`, a.category || p.catPath, "to let the sorter decide");
  if (pick === null) return;
  await call("POST", "/api/category", { key, category: pick });
  await refresh();
}

async function setStoreCategory(store) {
  const pick = chooseCategory(`What does ${storeName(store)} sell?\n\nUsed for this store's items when their titles don't say what they are.`,
    S.storeCats[store] || "", "for no default");
  if (pick === null) return;
  await call("POST", "/api/store-category", { store, category: pick });
  await refresh();
}

const today = () => new Date().toISOString().slice(0, 10);

async function exportCsv() {
  const rows = [["Name", "Category", "Subcategory", "Team", "Season", "Kit type", "Extras", "Store", "Original title", "Photos", "Album link", "Saved"]];
  filtered().forEach((a) => {
    const p = info(a);
    rows.push([p.english, p.category, p.sub, p.team || "", p.season || "", p.kit || "", p.extras.join(", "),
      storeName(a.store), a.title, a.count || "", a.link, fmtDate(a.firstSeen)]);
  });
  const content = "﻿" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  try {
    const res = await call("POST", "/api/save-file", { name: `yupoo-library-${today()}.csv`, content });
    toast(`Saved ${rows.length - 1} items to ${res.path}`);
  } catch (e) { toast("Couldn't save the CSV: " + e.message); }
}

async function backup() {
  toast("Making a backup…");
  try {
    const res = await call("POST", "/api/backup");
    toast(`Backup saved to ${res.path}`);
  } catch (e) { toast("Backup failed: " + e.message); }
}

async function restore(file) {
  try {
    const res = await call("POST", "/api/restore", await file.arrayBuffer(), true);
    toast(`Restore finished — ${res.added} items added.`);
    await refresh();
  } catch (e) { toast("That file isn't a Yupoo Library backup (.zip)."); }
}

function openLink(text) {
  let s = text.trim();
  if (!s) return;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (e) { u = null; }
  if (!u || !/\.yupoo\.com$/i.test(u.hostname)) { toast("That doesn't look like a Yupoo link."); return; }
  location.href = u.href;
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  if (e.target.closest(".toast-act")) { const f = toastAction; $(".toast").classList.remove("show", "act"); toastAction = null; if (f) f(); return; }
  // Select mode: clicking a card ticks it instead of opening it.
  const card = selecting && e.target.closest(".card[data-card]");
  if (card) { e.preventDefault(); togglePick(card, e.shiftKey); return; }
  if (mvOpen && !e.target.closest(".mv")) { mvOpen = false; renderSelBar(); }
  const sb = e.target.closest("[data-sel], [data-move], .mv-btn, .selbtn");
  if (sb) {
    const act = sb.dataset.sel;
    if (sb.classList.contains("selbtn")) setSelecting(!selecting);
    else if (sb.classList.contains("mv-btn")) {
      mvOpen = !mvOpen;
      $(".mv input").value = "";
      renderSelBar();
      if (mvOpen) $(".mv input").focus();
    }
    else if (sb.dataset.move !== undefined) moveSelected(sb.dataset.move);
    else if (act === "page") { shownKeys.forEach((k) => sel.add(k)); renderGrid(); }
    else if (act === "all") { matchingKeys.forEach((k) => sel.add(k)); renderGrid(); }
    else if (act === "none") { sel.clear(); renderGrid(); }
    else if (act === "auto") moveSelected("");
    else if (act === "remove") removeSelected();
    else if (act === "done") setSelecting(false);
    return;
  }
  if (e.target.closest("a.open")) return; // let "open ↗" links navigate
  // Clicking anywhere outside an open dropdown closes it.
  if (openDD && !e.target.closest(".dd")) { openDD = ""; renderFilters(); }
  const b = e.target.closest("button, .item");
  if (!b) return;
  if (b.dataset.renameStore !== undefined) renameStore(b.dataset.renameStore);
  else if (b.dataset.storeCat !== undefined) setStoreCategory(b.dataset.storeCat);
  else if (b.dataset.catEdit) setItemCategory(b.dataset.catEdit);
  else if (b.dataset.chev !== undefined) { setCatOpen(b.dataset.chev, !openCats.has(b.dataset.chev)); update(); }
  else if (b.dataset.cat !== undefined) {
    S.cat = b.dataset.cat; S.shown = PAGE_SIZE;
    if (S.cat) setCatOpen(S.cat.split(" › ")[0], true);
    update(); $("main").scrollTop = 0;
  }
  else if (b.dataset.ddToggle) toggleDD(b.dataset.ddToggle);
  else if (b.dataset.pick !== undefined) pick(b.closest("[data-dd]").dataset.dd, b.dataset.pick);
  else if (b.dataset.store !== undefined) { S.store = b.dataset.store; S.shown = PAGE_SIZE; update(); $("main").scrollTop = 0; }
  else if (b.classList.contains("clear")) {
    FILTERS.forEach(({ f }) => { S[f] = ""; });
    S.q = ""; $(".q").value = ""; S.shown = PAGE_SIZE; update();
  }
  else if (b.dataset.edit) editTeam(b.dataset.edit);
  else if (b.dataset.remove) removeKit(b.dataset.remove);
  else if (b.dataset.act === "csv") exportCsv();
  else if (b.dataset.act === "backup") backup();
  else if (b.classList.contains("more")) { S.shown += PAGE_SIZE; renderGrid(); }
});
$("form.go").addEventListener("submit", (e) => { e.preventDefault(); openLink($(".link").value); });
$(".q").addEventListener("input", (e) => { S.q = e.target.value; S.shown = PAGE_SIZE; renderFilters(); renderGrid(); });
// "Move to…" search box: typing narrows the list, Enter picks the top match, Esc closes it.
$(".mv input").addEventListener("input", renderMoveOptions);
$(".mv input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { mvOpen = false; renderSelBar(); }
  else if (e.key === "Enter") { const first = $(".mv .dd-list .item"); if (first) moveSelected(first.dataset.move); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selecting && !mvOpen && !e.target.closest("input")) setSelecting(false);
});
// Typing in a dropdown's search box narrows its list. Enter picks the top match, Esc closes it.
$(".dds").addEventListener("input", (e) => { if (openDD) renderOptions(openDD); });
$(".dds").addEventListener("keydown", (e) => {
  if (!openDD || e.target.tagName !== "INPUT") return;
  if (e.key === "Escape") { openDD = ""; renderFilters(); }
  else if (e.key === "Enter") {
    const first = $(`[data-dd="${openDD}"] .dd-list .item`);
    if (first) pick(openDD, first.dataset.pick);
  }
});
$(".sort").addEventListener("change", (e) => { S.sort = e.target.value; renderGrid(); });
$(".autosave").addEventListener("change", (e) => {
  S.settings.autoSave = e.target.checked;
  call("POST", "/api/settings", S.settings);
});
$(".restore").addEventListener("change", (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; });

// When "Save whole store" finishes (it keeps running while you're here), show the new items.
window.addEventListener("kit-crawl", (e) => {
  const { status, previous } = e.detail;
  if (previous && previous.running && !status.running && status.new) refresh();
});

load().then(renderAll).catch((e) => toast("Couldn't load your library: " + e.message));
