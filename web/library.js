// Kit Library app — the library page: every kit you've saved, from every store, in one place.
const TOKEN = document.querySelector('meta[name="kit-token"]').content;
const PAGE_SIZE = 120;

const S = {
  lib: { albums: {} }, aliases: {}, myTeams: {}, settings: { autoSave: true },
  team: "", store: "", kit: "", q: "", teamQ: "", sort: "team", shown: PAGE_SIZE
};
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

let toastTimer = null;
function toast(msg) {
  const t = $(".toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4500);
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
  matcher = YO_buildMatcher(allAliases());
  cache.clear();
}
const all = () => Object.values(S.lib.albums);
// Names learned with ✎ Team, plus your my-teams.txt list (which wins).
const allAliases = () => Object.assign({}, S.aliases, S.myTeams);

function info(a) {
  const ck = a.key + "|" + a.title;
  let p = cache.get(ck);
  if (!p) { p = YO_parse(a.title, matcher); cache.set(ck, p); }
  if (a.team) {
    const q = Object.assign({}, p, { team: a.team, edited: true });
    q.english = YO_english(q);
    return q;
  }
  return p;
}

// ---------- sidebar ----------
function teamMatches(team, q) {
  if (!q) return true;
  if (team.toLowerCase().includes(q)) return true;
  if ((YO_TEAMS[team] || []).some((a) => a.toLowerCase().includes(q))) return true;
  const al = allAliases();
  return Object.keys(al).some((a) => al[a] === team && a.toLowerCase().includes(q));
}
const item = (attr, val, label, n, active, extra, openUrl) =>
  `<div class="item ${active ? "on" : ""} ${extra || ""}" role="button" tabindex="0" data-${attr}="${esc(val)}"><span class="name">${esc(label)}</span>` +
  (openUrl ? `<a class="open" href="${esc(openUrl)}" title="Open this store">open ↗</a>` : "") +
  `<span class="c">${n}</span></div>`;

function renderTeams() {
  const inStore = all().filter((a) => !S.store || a.store === S.store);
  const counts = new Map(); let unsorted = 0;
  inStore.forEach((a) => {
    const t = info(a).team;
    if (t) counts.set(t, (counts.get(t) || 0) + 1); else unsorted++;
  });
  const q = S.teamQ.toLowerCase().trim();
  let html = "";
  if (!q) {
    html += item("team", "", "All teams", inStore.length, S.team === "");
    if (unsorted) html += item("team", "__unsorted", "⚠ Unsorted", unsorted, S.team === "__unsorted", "warn");
  }
  [...counts.keys()].sort((a, b) => a.localeCompare(b)).filter((t) => teamMatches(t, q))
    .forEach((t) => { html += item("team", t, t, counts.get(t), S.team === t); });
  if (q && !html) html = `<div class="summary" style="padding:4px 10px">No team matches “${esc(S.teamQ)}”.</div>`;
  $(".teams").innerHTML = html;
}

function renderStores() {
  const counts = new Map(), hosts = new Map();
  all().forEach((a) => { counts.set(a.store, (counts.get(a.store) || 0) + 1); hosts.set(a.store, a.host); });
  let html = item("store", "", "All stores", all().length, S.store === "");
  [...counts.keys()].sort().forEach((s) => {
    html += item("store", s, s, counts.get(s), S.store === s, "", "https://" + hosts.get(s) + "/albums");
  });
  $(".stores").innerHTML = html;
}

function renderKitOptions() {
  const kits = new Set(); let none = false;
  all().forEach((a) => { const k = info(a).kit; if (k) kits.add(k); else none = true; });
  const order = ["Home", "Away", "Second Away", "Third", "Goalkeeper", "Training", "Pre-Match"];
  const sel = $(".kit");
  sel.innerHTML = `<option value="">Any kit type</option>` +
    [...kits].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => `<option>${esc(k)}</option>`).join("") +
    (none ? `<option value="—">No kit type in title</option>` : "");
  sel.value = S.kit;
  if (sel.value !== S.kit) S.kit = "";
}

// ---------- grid ----------
function filtered() {
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all().filter((a) => {
    const p = info(a);
    if (S.store && a.store !== S.store) return false;
    if (S.team === "__unsorted") { if (p.team) return false; }
    else if (S.team && p.team !== S.team) return false;
    if (S.kit && (p.kit || "—") !== S.kit) return false;
    if (words.length) {
      const hay = (p.english + " " + a.title + " " + a.store).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sk = (a) => info(a).seasonKey;
  const byTeam = (a, b) => {
    const ta = info(a).team, tb = info(b).team;
    if (!ta !== !tb) return ta ? -1 : 1; // unsorted last
    return (ta || "").localeCompare(tb || "");
  };
  const cmp = {
    team: (a, b) => byTeam(a, b) || (sk(b) || 0) - (sk(a) || 0),
    new: (a, b) => (sk(b) || 0) - (sk(a) || 0),
    old: (a, b) => (sk(a) || 9999) - (sk(b) || 9999),
    saved: (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)
  }[S.sort];
  return list.sort(cmp);
}

function renderGrid() {
  const list = filtered(), total = all().length;
  $(".count").textContent = total ? `${total} kits · ${new Set(all().map((a) => a.store)).size} stores` : "";
  if (!total) {
    $(".summary").textContent = "";
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Your library is empty</strong>
      <ol>
        <li>Paste a Yupoo link in the box at the top and press <b>Open</b>.</li>
        <li>Browse as normal — every kit you see is saved here automatically.</li>
        <li>Press <b>Save whole store</b> in the green bar to grab a supplier's entire catalog.</li>
        <li>Press <b>Library</b> in the green bar to come back here.</li>
      </ol></div>`;
    $(".more").hidden = true;
    return;
  }
  $(".summary").textContent = `Showing ${Math.min(list.length, S.shown)} of ${list.length} kits` +
    (list.length !== total ? ` (${total} saved in total)` : "");
  if (!list.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1">No kits match these filters.</div>`;
    $(".more").hidden = true;
    return;
  }
  $(".grid").innerHTML = list.slice(0, S.shown).map((a) => {
    const p = info(a);
    return `<div class="card">
      <a class="img" href="${esc(a.link)}">
        <img data-key="${esc(a.key)}" data-cover="${esc(a.cover || "")}" alt="" loading="lazy">
        ${a.count ? `<span class="n">${a.count} photos</span>` : ""}
      </a>
      <div class="meta">
        <div class="en ${p.team ? "" : "unsorted"}">${esc(p.english)}</div>
        <div class="zh">${esc(a.title)}</div>
        <div class="src">${esc(a.store)} · saved ${esc(fmtDate(a.firstSeen))}${p.edited ? ` · <span class="tag">your fix</span>` : ""}</div>
        <div class="row">
          <a href="${esc(a.link)}">Open album ↗</a>
          <button data-edit="${esc(a.key)}" title="Set the team">✎ Team</button>
          <button data-remove="${esc(a.key)}" title="Remove from library">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
  $(".more").hidden = list.length <= S.shown;
  document.querySelectorAll("img[data-key]").forEach(loadThumb);
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

function renderAll() {
  renderTeams(); renderStores(); renderKitOptions(); renderGrid();
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
  if (canon && seg && !parsedTeam && confirm(`Also treat "${seg}" as ${canon} for every kit, in every store?`)) {
    S.aliases[seg] = canon;
    await call("POST", "/api/aliases", S.aliases);
  }
  await call("POST", "/api/team", { key, team: canon });
  await refresh();
}

async function removeKit(key) {
  const a = S.lib.albums[key]; if (!a) return;
  if (!confirm(`Remove this kit from your library?\n\n${info(a).english}`)) return;
  await call("POST", "/api/remove", { keys: [key] });
  await refresh();
}

const today = () => new Date().toISOString().slice(0, 10);

async function exportCsv() {
  const rows = [["English name", "Team", "Season", "Kit type", "Extras", "Store", "Original title", "Photos", "Album link", "Saved"]];
  filtered().forEach((a) => {
    const p = info(a);
    rows.push([p.english, p.team || "Unsorted", p.season || "", p.kit || "", p.extras.join(", "),
      a.store, a.title, a.count || "", a.link, fmtDate(a.firstSeen)]);
  });
  const content = "﻿" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  try {
    const res = await call("POST", "/api/save-file", { name: `kit-library-${today()}.csv`, content });
    toast(`Saved ${rows.length - 1} kits to ${res.path}`);
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
    toast(`Restore finished — ${res.added} kits added.`);
    await refresh();
  } catch (e) { toast("That file isn't a Kit Library backup (.zip)."); }
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
  if (e.target.closest("a.open")) return; // let "open ↗" links navigate
  const b = e.target.closest("button, .item");
  if (!b) return;
  if (b.dataset.team !== undefined) { S.team = b.dataset.team; S.shown = PAGE_SIZE; renderTeams(); renderGrid(); $("main").scrollTop = 0; }
  else if (b.dataset.store !== undefined) { S.store = b.dataset.store; S.team = ""; S.shown = PAGE_SIZE; renderTeams(); renderStores(); renderGrid(); $("main").scrollTop = 0; }
  else if (b.dataset.edit) editTeam(b.dataset.edit);
  else if (b.dataset.remove) removeKit(b.dataset.remove);
  else if (b.dataset.act === "csv") exportCsv();
  else if (b.dataset.act === "backup") backup();
  else if (b.classList.contains("more")) { S.shown += PAGE_SIZE; renderGrid(); }
});
$("form.go").addEventListener("submit", (e) => { e.preventDefault(); openLink($(".link").value); });
$(".teamq").addEventListener("input", (e) => { S.teamQ = e.target.value; renderTeams(); });
$(".q").addEventListener("input", (e) => { S.q = e.target.value; S.shown = PAGE_SIZE; renderGrid(); });
$(".kit").addEventListener("change", (e) => { S.kit = e.target.value; S.shown = PAGE_SIZE; renderGrid(); });
$(".sort").addEventListener("change", (e) => { S.sort = e.target.value; renderGrid(); });
$(".autosave").addEventListener("change", (e) => {
  S.settings.autoSave = e.target.checked;
  call("POST", "/api/settings", S.settings);
});
$(".restore").addEventListener("change", (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; });

load().then(renderAll).catch((e) => toast("Couldn't load your library: " + e.message));
