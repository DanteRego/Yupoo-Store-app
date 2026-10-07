// Yupoo Library app — the library page: every item you've saved, from every store, in one place.
// Shared pieces (talking to the app, item names, photos, collections) are in shared.js.
const PER_PAGE_CHOICES = [60, 120, 240];
const savedPerPage = (() => { try { return +localStorage.getItem("perPage"); } catch (e) { return 0; } })();

// The Library's own filters, added to the shared S.
// view: "" = every item, "new" = the ✨ New Additions page (items the start-up check found).
Object.assign(S, { view: "", cat: "", team: "", store: "", kit: "", season: "", extra: "", q: "", sort: "team",
  page: 1, perPage: PER_PAGE_CHOICES.indexOf(savedPerPage) !== -1 ? savedPerPage : 120 });
// The items the current page is about: everything, or only the new additions.
const inView = () => (S.view === "new" ? all().filter((a) => a.newAt) : all());
// The dropdown filters above the items. "f" is the name of the filter in S.
const FILTERS = [
  { f: "cat", label: "Category", any: "Any category" },
  { f: "brand", label: "Brand", any: "Any brand" },
  { f: "team", label: "Team", any: "Any team" },
  { f: "season", label: "Season", any: "Any season" },
  { f: "kit", label: "Kit type", any: "Any kit type" },
  { f: "extra", label: "Extras", any: "Any extras" },
  { f: "store", label: "Store", any: "Any store" }
];
let openDD = ""; // which dropdown is open right now

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
    `<button class="ren" data-rename-store="${esc(val)}" title="Rename this store">✎</button>` +
    `<button class="ren" data-delete-store="${esc(val)}" title="Remove this store and everything saved from it">🗑</button>` : "") +
  (openUrl ? `<a class="open" href="${esc(openUrl)}" title="Open this store">open ↗</a>` : "") +
  `<span class="c">${n}</span></div>`;

// Categories, with their subcategories underneath (only the ones that have items).
function renderCats() {
  const inStore = inView().filter((a) => !S.store || a.store === S.store);
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
      ? `<button class="chev ${open ? "open" : ""}" data-chev="${esc(top)}" title="${t(open ? "Hide subcategories" : "Show subcategories")}">▸</button>`
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
  inView().forEach((a) => { counts.set(a.store, (counts.get(a.store) || 0) + 1); hosts.set(a.store, a.host); });
  // Keep the store you picked visible (e.g. on New Additions after its new items were marked as seen).
  const picked = S.store && !counts.has(S.store) && all().find((a) => a.store === S.store);
  if (picked) { counts.set(S.store, 0); hosts.set(S.store, picked.host); }
  let html = item("store", "", "All stores", inView().length, S.store === "");
  [...counts.keys()].sort((a, b) => storeName(a).localeCompare(storeName(b))).forEach((s) => {
    html += item("store", s, storeName(s), counts.get(s), S.store === s, "", "https://" + hosts.get(s) + "/categories", true);
  });
  $(".stores").innerHTML = html;
}

// ---------- ✨ New Additions ----------
// A few seconds after the app opens, it looks through your stores for items they've added since
// last time (newcheck.go). Those items show on the New Additions page until you mark them as seen.
let newCheck = null, newCheckTimer = null;

// The "✨ New Additions" entry at the top of the sidebar, with how many new items there are.
function renderNewItem() {
  const n = all().filter((a) => a.newAt).length;
  const busy = newCheck && newCheck.running;
  $(".newlist").innerHTML = `<div class="item newadd ${S.view === "new" ? "on" : ""} ${n ? "has" : ""}" role="button" tabindex="0" data-view="new"
    title="${esc(busy ? L("Checking your stores for new items…", "正在检查店铺的新品…") : t("Items your stores added since you last opened the app"))}">
    <span class="name">${t("✨ New Additions")}${busy ? ` <span class="spinning">⟳</span>` : ""}</span><span class="c">${n}</span></div>` +
    lockedList();
}

// "🔒 Needs a password": stores the check can't look into until you type their password.
function lockedList() {
  const locked = S.locked || [];
  if (!locked.length) return "";
  return `<div class="locked"><div class="lockhead" title="${esc(t("The check can't see inside these stores without their password"))}">${L(`🔒 Needs a password (${locked.length})`, `🔒 需要密码（${locked.length}）`)}</div>` +
    locked.map((s) => `<div class="lockrow"><span class="name" title="${esc(s.saved ? L("The saved password stopped working — the store may have changed it", "保存的密码失效了——店铺可能改了密码") : s.host)}">${esc(storeName(s.store))}${s.saved ? ` <span class="warnmark">⚠</span>` : ""}</span>` +
      `<button data-store-pw="${esc(s.store)}">${t(s.saved ? "New password" : "Enter password")}</button></div>`).join("") + `</div>`;
}

async function enterStorePassword(store) {
  const s = (S.locked || []).find((x) => x.store === store) || { store, saved: false };
  const input = prompt(L(`Password for “${storeName(store)}”\n\nThis store is locked with a password (the supplier gives it to you). Type it here so the app can check this store for new items too.` +
    (s.saved ? "\n\nThe password saved before stopped working — the store may have changed it." : ""),
    `“${storeName(store)}”的密码\n\n这个店铺设了密码（供应商会告诉你）。在这里输入，应用就能检查这个店铺的新品。` +
    (s.saved ? "\n\n之前保存的密码失效了——店铺可能改了密码。" : "")), "");
  if (input === null || !input.trim()) return;
  toast(L("Checking the password with Yupoo…", "正在向 Yupoo 验证密码…"));
  try {
    newCheck = await call("POST", "/api/store-password", { store, password: input.trim() });
  } catch (e) {
    toast(e.message === "wrong password"
      ? L(`That isn't the right password for “${storeName(store)}”. Check it with the supplier and try again.`, `“${storeName(store)}”的密码不对。请向供应商确认后再试。`)
      : L("Couldn't save the password: ", "无法保存密码：") + e.message);
    return;
  }
  toast(L(`Password saved — checking “${storeName(store)}” now.`, `密码已保存——正在检查“${storeName(store)}”。`));
  renderNewItem(); renderNewHead();
  pollNewCheck();
}

// The heading on the New Additions page: what the check is doing, and the buttons.
function renderNewHead() {
  const box = $(".newhead");
  box.hidden = S.view !== "new";
  if (box.hidden) return;
  const st = newCheck || {};
  const nStores = new Set(all().map((a) => a.store)).size;
  let status;
  if (st.running) {
    status = L(`Checking your stores for new items… ${st.done} of ${st.stores} done${st.store ? ` (now: ${storeName(st.store)})` : ""}${st.found ? ` — ${st.found} new so far` : ""}.`,
      `正在检查店铺的新品…已完成 ${st.done}/${st.stores}${st.store ? `（正在检查：${storeName(st.store)}）` : ""}${st.found ? `——目前找到 ${st.found} 件` : ""}。`);
  } else if (st.finished) {
    const when = new Date(st.finished).toLocaleTimeString(LANG === "zh" ? "zh-CN" : undefined, { hour: "numeric", minute: "2-digit" });
    status = L(`Checked ${st.done} store${st.done === 1 ? "" : "s"} at ${when} — ${st.found ? `found ${st.found} new item${st.found === 1 ? "" : "s"}` : "nothing new"}.`,
      `${when} 检查了 ${st.done} 个店铺——${st.found ? `找到 ${st.found} 件新品` : "没有新品"}。`);
    if (st.first) status += " " + L(`${st.first === st.done ? "This was the first check, so there was nothing to compare with yet" : `${st.first} store${st.first === 1 ? " was" : "s were"} checked for the first time`} — from now on, items added to ${st.first === 1 ? "it" : "them"} will show up here.`,
      `${st.first === st.done ? "这是第一次检查，还没有可以比较的" : `${st.first} 个店铺是第一次检查`}——以后它们新上架的商品会显示在这里。`);
    if (st.failed) status += " " + L("Yupoo stopped answering, so some stores weren't checked — try ⟳ Check now in a few minutes.", "Yupoo 停止响应，部分店铺没有检查——过几分钟再点“⟳ 立即检查”。");
    else if (st.skipped) status += " " + L(`${st.skipped} store${st.skipped === 1 ? "" : "s"} couldn't be opened.`, `${st.skipped} 个店铺打不开。`);
    if (st.locked) status += " " + L(`${st.locked} store${st.locked === 1 ? " needs a password" : "s need a password"} — enter ${st.locked === 1 ? "it" : "them"} in the 🔒 list on the left.`,
      `${st.locked} 个店铺需要密码——请在左边的 🔒 列表里输入。`);
  } else {
    status = L(`Your ${nStores} stores are checked for new items a few seconds after the app opens.`, `应用打开几秒后，会检查你的 ${nStores} 个店铺有没有新品。`);
  }
  const n = matchingKeys.length;
  box.innerHTML = `<div class="newtitle"><h2>${t("✨ New Additions")}</h2><span class="grow"></span>
      <button data-act="check-now" ${st.running ? "disabled" : ""} title="${t("Look through your stores for new items again")}">${t("⟳ Check now")}</button>
      <button data-act="seen-all" class="primary" ${n ? "" : "disabled"} title="${t("Take these items off New Additions (they stay in your library)")}">${L(`✓ Mark ${n === inView().length ? "all" : "these"} as seen${n ? ` (${n})` : ""}`, `✓ ${n === inView().length ? "全部" : "这些"}标为已看${n ? `（${n}）` : ""}`)}</button>
      <button data-act="leave-new">${t("◀ All items")}</button></div>
    <div class="newstatus ${st.running ? "busy" : ""}">${esc(status)}</div>
    ${inView().length ? `<div class="newstatus">${L("New items stay here until you mark them as seen (✓ on a card, or the button above) — also after closing the app.",
      "新品会一直留在这里，直到你标为已看（卡片上的 ✓ 或上面的按钮）——关掉应用也不会消失。")}</div>` : ""}`;
}

function setView(view) {
  S.view = view; S.page = 1;
  // New Additions shows the newest finds first.
  if (view === "new") { S.sort = "saved"; $(".sort").value = "saved"; }
  update();
  $("main").scrollTop = 0;
}

// Reads how the check is going; keeps reading while it runs, and shows what it found when it's done.
async function pollNewCheck() {
  clearTimeout(newCheckTimer);
  let st;
  try { st = await call("GET", "/api/new-check"); } catch (e) { return; }
  const was = newCheck;
  newCheck = st;
  // New items came in, or the check finished (the 🔒 list may have changed): show it.
  if (was && (st.found > (was.found || 0) || (was.running && !st.running))) await refresh();
  else { renderNewItem(); renderNewHead(); }
  if (was && was.running && !st.running && st.found) {
    toast(L(`Found ${st.found} new item${st.found === 1 ? "" : "s"} in your stores.`, `在你的店铺里找到 ${st.found} 件新品。`),
      S.view === "new" ? null : "Show", S.view === "new" ? null : () => setView("new"));
  }
  // Before it starts (a few seconds after opening) and while it runs, look again soon.
  if (st.running || !st.started) newCheckTimer = setTimeout(pollNewCheck, st.running ? 2500 : 3000);
}

async function checkNow() {
  try { newCheck = await call("POST", "/api/new-check"); } catch (e) { toast(L("Couldn't start the check: ", "无法开始检查：") + e.message); return; }
  renderNewItem(); renderNewHead();
  pollNewCheck();
}

async function markSeen(keys) {
  if (!keys.length) return;
  let res;
  try { res = await call("POST", "/api/new-seen", { keys }); } catch (e) { toast(L("Couldn't mark them as seen: ", "无法标为已看：") + e.message); return; }
  await refresh();
  // Undo puts them back on New Additions (e.g. after clicking "Mark all as seen" by accident).
  toast(L(`Marked ${keys.length} item${keys.length === 1 ? "" : "s"} as seen — still in your library.`, `已把 ${keys.length} 件标为已看——它们仍在图库里。`), "Undo", async () => {
    try { await call("POST", "/api/new-unseen", { items: res.was || {} }); } catch (e) { toast(L("Couldn't undo: ", "无法撤销：") + e.message); return; }
    await refresh();
    toast(L("Undone — they're back on New Additions.", "已撤销——它们回到了新上架。"));
  });
}

// ---------- dropdown filters ----------
// What an item counts as for each filter. "—" means the title doesn't say.
function vals(a, f) {
  const p = info(a);
  if (f === "cat") return p.sub ? [p.category, p.catPath] : [p.category];
  if (f === "brand") return [p.brand || "—"];
  if (f === "team") return [p.team || (p.footballKit ? "__unsorted" : "—")];
  if (f === "season") return [p.season || "—"];
  if (f === "kit") return [p.kit || "—"];
  if (f === "extra") return p.extras.length ? p.extras : ["—"];
  return [a.store];
}
function optionLabel(f, v) {
  if (v === "__unsorted") return t("⚠ Kits with no team");
  if (v === "—") return t({ brand: "No brand in title", team: "No team", season: "No season", kit: "No kit type", extra: "No extras" }[f]);
  if (f === "cat") return tCat(v);
  if (f === "kit" || f === "extra") return t(v);
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
    btn.textContent = S[f] ? `${t(label)}: ${optionLabel(f, S[f])} ▾` : `${t(any)} ▾`;
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
  let html = q ? "" : item("pick", "", t(any), total, !S[f]);
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
  S[f] = v; openDD = ""; S.page = 1;
  if (f === "cat" && v) setCatOpen(v.split(" › ")[0], true);
  update();
  $("main").scrollTop = 0;
}

// ---------- grid ----------
// Does this item pass every filter (except "skip") and the search box?
function passes(a, skip) {
  if (S.view === "new" && !a.newAt) return false;
  for (const { f } of FILTERS) {
    if (f !== skip && S[f] && !vals(a, f).includes(S[f])) return false;
  }
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const p = info(a);
    const hay = (p.english + " " + p.catPath + " " + p.brand + " " + a.title + " " + a.store + " " + storeName(a.store)).toLowerCase();
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
  // Brand A–Z, items whose title names no brand last.
  const byBrand = (a, b) => { const x = info(a).brand, y = info(b).brand; return !x !== !y ? (x ? -1 : 1) : (x || "").localeCompare(y || ""); };
  // Clothing groups by team; everything else (shoes, bags…) by brand.
  const byTeamOrBrand = (a, b) => (info(a).clothing && info(b).clothing ? byTeam(a, b) : byBrand(a, b));
  const cmp = {
    team: (a, b) => byCat(a, b) || byTeamOrBrand(a, b) || (sk(b) || 0) - (sk(a) || 0) || byName(a, b),
    brand: (a, b) => byBrand(a, b) || byCat(a, b) || byName(a, b),
    new: (a, b) => (sk(b) || 0) - (sk(a) || 0),
    old: (a, b) => (sk(a) || 9999) - (sk(b) || 9999),
    saved: (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)
  }[S.sort];
  return list.sort(cmp);
}

function renderGrid() {
  const list = filtered(), total = all().length;
  // Numbered pages: keep the page number inside the range (e.g. after a filter shrinks the list).
  const pages = Math.max(1, Math.ceil(list.length / S.perPage));
  S.page = Math.min(Math.max(1, S.page), pages);
  const start = (S.page - 1) * S.perPage, pageItems = list.slice(start, start + S.perPage);
  shownKeys = pageItems.map((a) => a.key);
  matchingKeys = list.map((a) => a.key);
  renderSelBar();
  renderNewHead();
  const viewTotal = inView().length;
  const nStores = new Set(all().map((a) => a.store)).size;
  $(".count").textContent = total ? L(`${total} items · ${nStores} stores`, `${total} 件 · ${nStores} 个店铺`) : "";
  if (!total) {
    $(".summary").textContent = "";
    $(".grid").innerHTML = L(`<div class="empty" style="grid-column:1/-1"><strong>Your library is empty</strong>
      <ol>
        <li>Paste a Yupoo link in the box at the top and press <b>Open</b>.</li>
        <li>Browse as normal — every item you see is saved here automatically.</li>
        <li>Press <b>Save whole store</b> in the green bar to grab a supplier's entire catalog.</li>
        <li>Press <b>Library</b> in the green bar to come back here.</li>
      </ol></div>`, `<div class="empty" style="grid-column:1/-1"><strong>你的图库还是空的</strong>
      <ol>
        <li>在顶部的框里粘贴一个 Yupoo 链接，然后点<b>打开</b>。</li>
        <li>像平常一样浏览——你看到的每件商品都会自动保存到这里。</li>
        <li>点绿色栏里的<b>保存整个店铺</b>，可以一次保存供应商的全部商品。</li>
        <li>点绿色栏里的<b>图库</b>回到这里。</li>
      </ol></div>`);
    renderPager(0, 0);
    return;
  }
  $(".summary").textContent = (list.length > S.perPage
    ? L(`Showing ${start + 1}–${start + pageItems.length} of ${list.length.toLocaleString()} items`, `显示第 ${start + 1}–${start + pageItems.length} 件，共 ${num(list.length)} 件`)
    : L(`${list.length.toLocaleString()} items`, `${num(list.length)} 件`)) +
    (list.length === viewTotal ? "" : S.view === "new"
      ? L(` (${viewTotal.toLocaleString()} new in total)`, `（总共 ${num(viewTotal)} 件新品）`)
      : L(` (${viewTotal.toLocaleString()} saved in total)`, `（总共保存了 ${num(viewTotal)} 件）`));
  if (!list.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1">${S.view === "new" && !viewTotal
      ? L(`<strong>Nothing new right now</strong>Each time you open the app, it looks through your ${nStores} stores for items they've added since last time. Anything it finds shows up here.`,
        `<strong>现在没有新品</strong>每次打开应用时，它都会检查你的 ${nStores} 个店铺上次之后新上架的商品。找到的都会显示在这里。`)
      : L("No items match these filters.", "没有符合这些筛选条件的商品。")}</div>`;
    renderPager(0, 0);
    return;
  }
  // Sorted by brand: a heading wherever a new brand starts ("Nike · 4,581 items").
  const brandCounts = new Map();
  if (S.sort === "brand") list.forEach((a) => { const b = info(a).brand || ""; brandCounts.set(b, (brandCounts.get(b) || 0) + 1); });
  const heading = (a, i) => {
    if (S.sort !== "brand") return "";
    const b = info(a).brand || "";
    if (i > 0 && (info(pageItems[i - 1]).brand || "") === b) return "";
    const n = brandCounts.get(b) || 0;
    return `<div class="grouphead"><span>${esc(b || t("No brand in title"))}</span><span class="c">${L(`${n.toLocaleString()} item${n === 1 ? "" : "s"}`, `${num(n)} 件`)}${i === 0 && start > 0 && (info(list[start - 1]).brand || "") === b ? L(" · continued", " · 续") : ""}</span></div>`;
  };
  $(".grid").innerHTML = pageItems.map((a, i) => {
    const p = info(a);
    return heading(a, i) + `<div class="card ${sel.has(a.key) ? "picked" : ""}" data-card="${esc(a.key)}" data-i="${i}">
      <span class="tick" aria-hidden="true">✓</span>
      <a class="img" href="${esc(a.link)}">
        <img data-key="${esc(a.key)}" data-cover="${esc(a.cover || "")}" alt="" loading="lazy">
        ${a.count ? `<span class="n">${L(`${a.count} photos`, `${a.count} 张图`)}</span>` : ""}
        ${a.newAt ? `<span class="newbadge" title="${esc(L(`New — found ${fmtDate(a.newAt)}`, `新品——发现于 ${fmtDate(a.newAt)}`))}">${t("NEW")}</span>` : ""}
      </a>
      <div class="meta">
        <div class="catline ${p.category === "Other" ? "unsorted" : ""}">${esc(tCat(p.catPath))}${p.brand ? ` · <span class="brand">${esc(p.brand)}</span>` : ""}${p.catEdited ? ` · <span class="tag">${t("your pick")}</span>` : ""}</div>
        ${cardNames(p, a)}
        <div class="src">${esc(storeName(a.store))} · ${L("saved", "保存于")} ${esc(fmtDate(a.firstSeen))}${p.edited ? ` · <span class="tag">${t("your fix")}</span>` : ""}</div>
        <div class="row">
          <a href="${esc(a.link)}">Open album ↗</a>
          ${starButton(a.key)}
          <button data-cat-edit="${esc(a.key)}" title="Change what this item is">🏷</button>
          ${p.clothing ? `<button data-edit="${esc(a.key)}" title="Set the team">✎ Team</button>` : ""}
          ${a.newAt ? `<button data-seen="${esc(a.key)}" title="Seen it — take it off New Additions (it stays in your library)">✓</button>` : ""}
          <button data-remove="${esc(a.key)}" title="Remove from library">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
  renderPager(S.page, pages);
  document.querySelectorAll("img[data-key]").forEach(loadThumb);
}

// ---------- numbered pages ----------
// "‹ 1 … 4 5 [6] 7 8 … 89 ›" — shown in the sticky bar at the top and again under the items.
function renderPager(page, pages) {
  let html = "";
  if (pages > 1) {
    const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
    const list = [...nums].sort((a, b) => a - b);
    html += `<button data-page="${page - 1}" ${page === 1 ? "disabled" : ""} title="${t("Previous page")}">‹</button>`;
    list.forEach((n, i) => {
      if (i && n - list[i - 1] > 1) html += `<span class="gap">…</span>`;
      html += `<button data-page="${n}" class="${n === page ? "on" : ""}">${n}</button>`;
    });
    html += `<button data-page="${page + 1}" ${page === pages ? "disabled" : ""} title="${t("Next page")}">›</button>`;
  }
  document.querySelectorAll(".pager").forEach((p) => { p.innerHTML = html; });
  $(".perpage").hidden = !pages;
  $(".perpage").value = String(S.perPage);
}
function goToPage(n) {
  S.page = n;
  renderGrid();
  $("main").scrollTop = 0;
}

// ---------- picking up where you left off ----------
// When you open an album (or a store) and come back, the Library returns to the same filters,
// search, page and scroll position. Kept for this app session only.
const VIEW_KEYS = ["view", "cat", "team", "store", "kit", "season", "extra", "q", "sort", "page"];
function saveView() {
  const v = { scroll: $("main").scrollTop };
  VIEW_KEYS.forEach((k) => { v[k] = S[k]; });
  try { sessionStorage.setItem("libraryView", JSON.stringify(v)); } catch (e) {}
}
function restoreView() {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem("libraryView") || "null"); } catch (e) {}
  if (!v) return 0;
  VIEW_KEYS.forEach((k) => { if (v[k] !== undefined) S[k] = v[k]; });
  $(".q").value = S.q;
  $(".sort").value = S.sort;
  return v.scroll || 0;
}

// The names on a card: in English the app's English name first and the supplier's title under it;
// in Chinese the supplier's original title first and the English name under it.
function cardNames(p, a) {
  const warn = p.footballKit && !p.team ? "unsorted" : "";
  if (LANG === "zh") {
    return `<div class="en">${esc(a.title)}</div>` + (p.english !== a.title ? `<div class="zh ${warn}">${esc(p.english)}</div>` : "");
  }
  return `<div class="en ${warn}">${esc(p.english)}</div>` + (p.english !== a.title ? `<div class="zh">${esc(a.title)}</div>` : "");
}

// The ☆ on each card: filled in gold when the item is in one of your collections.
function starButton(key) {
  const cols = collectionsOf(key);
  const tip = cols.length ? L("In: ", "在：") + cols.map((c) => c.name).join(", ") + L(" — click to change", "——点击修改") : t("Add to a collection (Catalog)");
  return `<button class="star ${cols.length ? "on" : ""}" data-collect="${esc(key)}" title="${esc(tip)}">${cols.length ? "★" : "☆"}</button>`;
}
// After a collection change, just redraw the stars (no need to reload the whole library).
function refreshStars() {
  document.querySelectorAll(".star[data-collect]").forEach((b) => { b.outerHTML = starButton(b.dataset.collect); });
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
  $(".selbtn").textContent = t(on ? "☑ Selecting…" : "☑ Select");
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
  $(".selcount").textContent = n ? L(`${n} selected`, `已选 ${n} 件`) : L("Click items to select them", "点击商品来选择");
  $('[data-sel="page"]').textContent = L(`Select shown (${shownKeys.length})`, `选择本页（${shownKeys.length}）`);
  $('[data-sel="all"]').textContent = L(`Select all matching (${matchingKeys.length})`, `选择全部符合的（${matchingKeys.length}）`);
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
  const hits = paths.filter((p) => !ql || p.toLowerCase().includes(ql) || tCat(p).toLowerCase().includes(ql));
  let html = hits.map((p) => {
    const sub = p.indexOf(" › ") !== -1;
    return `<div class="item ${sub ? "sub" : "top"}" role="button" tabindex="0" data-move="${esc(p)}"><span class="name">${esc(sub ? p.split(" › ")[1] : p)}</span>` +
      (sub && ql ? `<span class="c">${esc(p.split(" › ")[0])}</span>` : "") + `</div>`;
  }).join("");
  const typed = q.replace(/\s*[>›]\s*/g, " › ");
  if (q && !paths.some((p) => p.toLowerCase() === typed.toLowerCase())) {
    html += `<div class="item new" role="button" tabindex="0" data-move="${esc(typed)}"><span class="name">${L("➕ New category", "➕ 新分类")} “${esc(typed)}”</span></div>`;
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
  } catch (e) { toast(L("Couldn't move them: ", "无法移动：") + e.message); return; }
  sel.clear(); mvOpen = false;
  await refresh();
  const where = category ? `to ${category}` : "back to the item sorter";
  toast(L(`Moved ${keys.length} item${keys.length === 1 ? "" : "s"} ${where}.`,
    category ? `已把 ${keys.length} 件移到 ${tCat(category)}。` : `已把 ${keys.length} 件交回系统自动分类。`), "Undo", async () => {
    for (const [old, ks] of before) await call("POST", "/api/categories", { keys: ks, category: old });
    await refresh();
    toast(L("Undone.", "已撤销。"));
  });
}

async function removeSelected() {
  const keys = [...sel];
  if (!keys.length || !confirm(L(`Remove ${keys.length} item${keys.length === 1 ? "" : "s"} from your library?\n\nThis can't be undone.`,
    `要从图库删除这 ${keys.length} 件吗？\n\n删除后无法撤销。`))) return;
  await call("POST", "/api/remove", { keys });
  sel.clear();
  await refresh();
  toast(L(`Removed ${keys.length} items.`, `已删除 ${keys.length} 件。`));
}

function update() { renderNewItem(); renderCats(); renderStores(); renderFilters(); renderGrid(); }
function renderAll() {
  update();
  $(".autosave").checked = S.settings.autoSave;
}
async function refresh() {
  const scroll = $("main").scrollTop;
  await load(); renderAll();
  $("main").scrollTop = scroll;
}

// The ⟳ Refresh button: loads items saved since this page opened (e.g. by "Save whole store"
// or another window), keeping your filters, page and place.
async function refreshButton(btn) {
  if (btn.classList.contains("spin")) return;
  const before = all().length;
  btn.classList.add("spin");
  try {
    await refresh();
    const added = all().length - before;
    toast(added > 0 ? L(`${added.toLocaleString()} new item${added === 1 ? "" : "s"} — ${all().length.toLocaleString()} in your library now.`,
      `新增 ${num(added)} 件——图库现在共有 ${num(all().length)} 件。`)
      : L(`Up to date — ${all().length.toLocaleString()} items.`, `已是最新——共 ${num(all().length)} 件。`));
  } catch (e) { toast(L("Couldn't refresh: ", "无法刷新：") + e.message); }
  btn.classList.remove("spin");
}

// ---------- actions ----------
async function editTeam(key) {
  const a = S.lib.albums[key]; if (!a) return;
  const p = info(a);
  const input = prompt(L(`Which team is this kit?\n\n${a.title}\n\nType the English team name (e.g. Liverpool). Leave empty to undo your fix.`,
    `这件球衣是哪个球队的？\n\n${a.title}\n\n输入球队的英文名（例如 Liverpool）。留空则撤销你的修改。`), p.team || "");
  if (input === null) return;
  const name = input.trim();
  const canon = name ? (YO_canonicalTeam(name, allAliases()) || name) : "";
  const parsedTeam = YO_parse(a.title, matcher).team;
  const seg = YO_guessAlias(a.title);
  if (canon && seg && !parsedTeam && confirm(L(`Also treat "${seg}" as ${canon} for every item, in every store?`,
    `以后在所有店铺里都把“${seg}”当作 ${canon} 吗？`))) {
    S.aliases[seg] = canon;
    await call("POST", "/api/aliases", S.aliases);
  }
  await call("POST", "/api/team", { key, team: canon });
  await refresh();
}

async function removeKit(key) {
  const a = S.lib.albums[key]; if (!a) return;
  if (!confirm(L(`Remove this item from your library?\n\n${info(a).english}`, `要从图库删除这件商品吗？\n\n${a.title}`))) return;
  await call("POST", "/api/remove", { keys: [key] });
  await refresh();
}

// 🗑 next to a store: removes the store and every item saved from it (after asking).
async function removeStore(store) {
  const items = all().filter((a) => a.store === store);
  const name = storeName(store);
  const inCollections = items.filter((a) => collectionsOf(a.key).length).length;
  const crawl = window.__kitCrawl && window.__kitCrawl.status;
  const saving = !!(crawl && crawl.running && crawl.store === store);
  const msg = L(`Remove the store “${name}” from your library?\n\n` +
    `This deletes all ${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"} saved from it, and their photos.` +
    (inCollections ? `\n${inCollections} of them ${inCollections === 1 ? "is" : "are"} in your Catalog collections and will be taken out of them too.` : "") +
    (saving ? `\n\n“Save whole store” is still saving this store — it will be stopped first.` : "") +
    `\n\nThis can't be undone. (Tip: click Backup first if you might want them back.)`,
    `要从图库删除店铺“${name}”吗？\n\n` +
    `这会删除从它保存的全部 ${num(items.length)} 件商品和它们的图片。` +
    (inCollections ? `\n其中 ${inCollections} 件在你的收藏夹里，也会被移出。` : "") +
    (saving ? `\n\n“保存整个店铺”还在保存这个店铺——会先停止它。` : "") +
    `\n\n删除后无法撤销。（提示：如果以后可能还想要，先点“备份”。）`);
  if (!confirm(msg)) return;
  try {
    if (saving) {
      // Stop the save and wait for it to finish its current page, so nothing gets added back afterwards.
      await window.__kitCrawl.stop();
      for (let i = 0; i < 40 && window.__kitCrawl.status && window.__kitCrawl.status.running; i++) await new Promise((r) => setTimeout(r, 1000));
    }
    const res = await call("POST", "/api/remove-store", { store });
    if (S.store === store) S.store = "";
    S.page = 1;
    await refresh();
    toast(L(`Removed “${name}” and its ${res.removed.toLocaleString()} item${res.removed === 1 ? "" : "s"}.`, `已删除“${name}”和它的 ${num(res.removed)} 件商品。`));
  } catch (e) { toast(L("Couldn't remove the store: ", "无法删除店铺：") + e.message); }
}

async function renameStore(store) {
  const input = prompt(L(`Rename this store\n\nOriginal name: ${store}\n\nType your own name for it. Leave empty to go back to the original name.`,
    `重命名这个店铺\n\n原名：${store}\n\n输入你想用的名字。留空则恢复原名。`), storeName(store));
  if (input === null) return;
  await call("POST", "/api/store-name", { store, name: input.trim() });
  await refresh();
}

// Asks for a category: a number from the list, or a name like "Shoes › Sneakers" or just "Sneakers".
// Returns the chosen path, "" for "work it out automatically", or null if cancelled.
function chooseCategory(heading, current, emptyMeans) {
  const paths = YO_categoryPaths();
  const list = paths.map((p, i) => `${i + 1}. ${p.indexOf(" › ") !== -1 ? "      " + t(p.split(" › ")[1]) : t(p)}`).join("\n");
  const input = prompt(`${heading}\n\n${list}\n\n${L("Type a number, or a name.", "输入编号或名称。")} ${emptyMeans}`, current ? tCat(current) : "");
  if (input === null) return null;
  const typed = input.trim();
  if (!typed) return "";
  if (/^\d+$/.test(typed) && paths[+typed - 1]) return paths[+typed - 1];
  const low = typed.toLowerCase().replace(/\s*[>›]\s*/g, " › ");
  // English or Chinese names both work ("Sneakers", "运动休闲鞋", "鞋 › 运动休闲鞋").
  return paths.find((p) => p.toLowerCase() === low || tCat(p).toLowerCase() === low) ||
    paths.find((p) => p.toLowerCase().endsWith("› " + low) || tCat(p).toLowerCase().endsWith("› " + low)) ||
    typed.replace(/\s*[>›]\s*/g, " › "); // a new name of your own
}

async function setItemCategory(key) {
  const a = S.lib.albums[key]; if (!a) return;
  const p = info(a);
  const how = L({ word: "from a word in its title", store: "from the store's 🏷 setting", sizes: "from the shoe sizes in its title",
    team: "because a team was found in its title", "clothing sizes": "from the clothing sizes in its title",
    none: "nothing in its title said", yours: "your pick" }[p.catHow],
    { word: "根据标题里的词", store: "根据店铺的 🏷 设置", sizes: "根据标题里的鞋码", team: "因为标题里有球队",
      "clothing sizes": "根据标题里的衣服尺码", none: "标题里没有说明", yours: "你的选择" }[p.catHow]);
  const pick = chooseCategory(L(`What is this item?\n\n${a.title}\n\nRight now: ${p.catPath} (${how})`,
    `这件商品是什么？\n\n${a.title}\n\n现在是：${tCat(p.catPath)}（${how}）`), a.category || p.catPath,
    L("Leave empty to let the sorter decide.", "留空则让系统自动分类。"));
  if (pick === null) return;
  await call("POST", "/api/category", { key, category: pick });
  await refresh();
}

async function setStoreCategory(store) {
  const pick = chooseCategory(L(`What does ${storeName(store)} sell?\n\nUsed for this store's items when their titles don't say what they are.`,
    `${storeName(store)} 卖什么？\n\n当这个店铺的商品标题没说明是什么时使用。`),
    S.storeCats[store] || "", L("Leave empty for no default.", "留空则不设默认。"));
  if (pick === null) return;
  await call("POST", "/api/store-category", { store, category: pick });
  await refresh();
}


async function exportCsv() {
  const rows = [["Name", "Category", "Subcategory", "Brand", "Team", "Season", "Kit type", "Extras", "Store", "Original title", "Photos", "Album link", "Saved"]];
  filtered().forEach((a) => {
    const p = info(a);
    rows.push([p.english, p.category, p.sub, p.brand, p.team || "", p.season || "", p.kit || "", p.extras.join(", "),
      storeName(a.store), a.title, a.count || "", a.link, fmtDate(a.firstSeen)]);
  });
  const content = "﻿" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  try {
    const res = await call("POST", "/api/save-file", { name: `yupoo-library-${today()}.csv`, content });
    toast(L(`Saved ${rows.length - 1} items to ${res.path}`, `已把 ${num(rows.length - 1)} 件保存到 ${res.path}`));
  } catch (e) { toast(L("Couldn't save the CSV: ", "无法保存 CSV：") + e.message); }
}

async function backup() {
  toast(L("Making a backup…", "正在备份…"));
  try {
    const res = await call("POST", "/api/backup");
    toast(L(`Backup saved to ${res.path}`, `备份已保存到 ${res.path}`));
  } catch (e) { toast(L("Backup failed: ", "备份失败：") + e.message); }
}

async function restore(file) {
  try {
    const res = await call("POST", "/api/restore", await file.arrayBuffer(), true);
    toast(L(`Restore finished — ${res.added} items added.`, `恢复完成——新增 ${num(res.added)} 件。`));
    await refresh();
  } catch (e) { toast(L("That file isn't a Yupoo Library backup (.zip).", "这个文件不是 Yupoo 图库的备份（.zip）。")); }
}

// Turns pasted text into a Yupoo store address (or null): adds https://, and switches
// x.yupoo.com/photos/<store>/... to the usual <store>.x.yupoo.com/... style.
// A store's front page or /albums goes to /categories (all categories): /albums only shows
// part of the store, /categories shows every item.
function yupooUrl(text) {
  let s = String(text || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (!/\.yupoo\.com$/i.test(u.hostname)) return null;
  const m = /^x\.yupoo\.com$/i.test(u.hostname) && u.pathname.match(/^\/photos\/([^/]+)(\/.*)?$/);
  if (m) u = new URL("https://" + m[1].toLowerCase() + ".x.yupoo.com" + (m[2] || "/") + u.search);
  if (/\.x\.yupoo\.com$/i.test(u.hostname) && /^\/(albums\/?)?$/i.test(u.pathname)) {
    u.pathname = "/categories";
    u.searchParams.delete("page");
  }
  return u;
}

// ---------- "you already have this store" ----------
// Pasting lots of links? The box tells you straight away if a store is already in your library
// (or you already opened it earlier in this session), so you don't open it twice.
function openedThisSession() {
  try { return JSON.parse(sessionStorage.getItem("openedStores") || "[]"); } catch (e) { return []; }
}
function knownStore(u) {
  if (!u || !/\.x\.yupoo\.com$/i.test(u.hostname)) return null;
  const store = u.hostname.split(".")[0].toLowerCase();
  const items = all().filter((a) => a.store.toLowerCase() === store);
  const last = items.reduce((m, a) => Math.max(m, a.firstSeen || 0), 0);
  if (items.length) return { store, count: items.length, last, name: storeName(items[0].store) };
  if (openedThisSession().indexOf(store) !== -1) return { store, count: 0, last: 0, name: store };
  return null;
}
function knownStoreText(k) {
  if (k.count) {
    return L(`Already in your library: “${k.name}” — ${k.count.toLocaleString()} item${k.count === 1 ? "" : "s"}, last added ${fmtDate(k.last)}.`,
      `图库里已经有这个店铺：“${k.name}”——${num(k.count)} 件，最近一次添加于 ${fmtDate(k.last)}。`);
  }
  return L(`You already opened “${k.name}” earlier (nothing saved from it yet).`, `你之前已经打开过“${k.name}”（还没有保存任何商品）。`);
}
function updatePasteHint() {
  const hint = $(".pastehint");
  const k = knownStore(yupooUrl($(".link").value));
  hint.hidden = !k;
  if (k) hint.textContent = "⚠ " + knownStoreText(k);
}

function openLink(text, force) {
  const u = yupooUrl(text);
  if (!String(text || "").trim()) return;
  if (!u) { toast(L("That doesn't look like a Yupoo link.", "这看起来不像 Yupoo 链接。")); return; }
  const k = knownStore(u);
  if (k && !force) {
    toast(knownStoreText(k), L("Open anyway", "仍然打开"), () => openLink(text, true));
    return;
  }
  if (/\.x\.yupoo\.com$/i.test(u.hostname)) {
    const opened = openedThisSession();
    const store = u.hostname.split(".")[0].toLowerCase();
    if (opened.indexOf(store) === -1) opened.push(store);
    try { sessionStorage.setItem("openedStores", JSON.stringify(opened)); } catch (e) {}
  }
  location.href = u.href;
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  // Select mode: clicking a card ticks it instead of opening it.
  const card = selecting && e.target.closest(".card[data-card]");
  if (card) { e.preventDefault(); togglePick(card, e.shiftKey); return; }
  if (mvOpen && !e.target.closest(".mv")) { mvOpen = false; renderSelBar(); }
  const sb = e.target.closest("[data-sel], [data-move], .mv-btn, .selbtn");
  if (sb) {
    const act = sb.dataset.sel;
    if (sb.classList.contains("selbtn")) setSelecting(!selecting);
    else if (act === "collect") openCollectionPicker(sb, [...sel], refreshStars);
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
  if (b.dataset.page) goToPage(+b.dataset.page);
  else if (b.dataset.view !== undefined) setView(S.view === b.dataset.view ? "" : b.dataset.view);
  else if (b.dataset.act === "leave-new") setView("");
  else if (b.dataset.act === "check-now") checkNow();
  else if (b.dataset.act === "seen-all") markSeen(matchingKeys.slice());
  else if (b.dataset.seen) markSeen([b.dataset.seen]);
  else if (b.dataset.storePw) enterStorePassword(b.dataset.storePw);
  else if (b.dataset.collect) openCollectionPicker(b, [b.dataset.collect], refreshStars);
  else if (b.dataset.act === "catalog") openCatalog(false);
  else if (b.dataset.act === "catalog-win") openCatalog(true);
  else if (b.dataset.renameStore !== undefined) renameStore(b.dataset.renameStore);
  else if (b.dataset.deleteStore !== undefined) removeStore(b.dataset.deleteStore);
  else if (b.dataset.storeCat !== undefined) setStoreCategory(b.dataset.storeCat);
  else if (b.dataset.catEdit) setItemCategory(b.dataset.catEdit);
  else if (b.dataset.chev !== undefined) { setCatOpen(b.dataset.chev, !openCats.has(b.dataset.chev)); update(); }
  else if (b.dataset.cat !== undefined) {
    S.cat = b.dataset.cat; S.page = 1;
    if (S.cat) setCatOpen(S.cat.split(" › ")[0], true);
    update(); $("main").scrollTop = 0;
  }
  else if (b.dataset.ddToggle) toggleDD(b.dataset.ddToggle);
  else if (b.dataset.pick !== undefined) pick(b.closest("[data-dd]").dataset.dd, b.dataset.pick);
  else if (b.dataset.store !== undefined) { S.store = b.dataset.store; S.page = 1; update(); $("main").scrollTop = 0; }
  else if (b.classList.contains("clear")) {
    FILTERS.forEach(({ f }) => { S[f] = ""; });
    S.q = ""; $(".q").value = ""; S.page = 1; update();
  }
  else if (b.dataset.edit) editTeam(b.dataset.edit);
  else if (b.dataset.remove) removeKit(b.dataset.remove);
  else if (b.dataset.act === "refresh") refreshButton(b);
  else if (b.dataset.act === "update") checkForUpdates();
  else if (b.dataset.act === "csv") exportCsv();
  else if (b.dataset.act === "backup") backup();
});
$("form.go").addEventListener("submit", (e) => { e.preventDefault(); openLink($(".link").value); });
$(".link").addEventListener("input", updatePasteHint);
$(".q").addEventListener("input", (e) => { S.q = e.target.value; S.page = 1; renderFilters(); renderGrid(); });
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
$(".sort").addEventListener("change", (e) => { S.sort = e.target.value; S.page = 1; renderGrid(); });
$(".perpage").addEventListener("change", (e) => {
  // Keep roughly the same items on screen when changing how many show per page.
  const first = (S.page - 1) * S.perPage;
  S.perPage = +e.target.value;
  S.page = Math.floor(first / S.perPage) + 1;
  try { localStorage.setItem("perPage", String(S.perPage)); } catch (err) {}
  renderGrid();
  $("main").scrollTop = 0;
});
// The filter bar sticks to the top while you scroll; it gets a shadow once the items slide under it.
let viewTimer = null;
$("main").addEventListener("scroll", () => {
  $(".topbar").classList.toggle("stuck", $("main").scrollTop > 4);
  clearTimeout(viewTimer);
  viewTimer = setTimeout(saveView, 250);
});
// Remember where you are when leaving the page (opening an album, a store, or the Catalog).
window.addEventListener("pagehide", saveView);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveView(); });
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

// The Catalog (maybe in its own window) changed something: keep this page in step.
if (channel) channel.onmessage = async (e) => {
  const what = e.data && e.data.what;
  if (what === "collections") { await loadCollections(); refreshStars(); }
  else if (what === "library") await refresh();
};

// Start up: load everything, then go back to where you were (if you were here before).
load().then(() => {
  const scroll = restoreView();
  renderAll();
  $("main").scrollTop = scroll;
  pollNewCheck(); // how the ✨ New Additions check is going
}).catch((e) => toast(L("Couldn't load your library: ", "无法加载你的图库：") + e.message));

// "⬆ Check for updates" (only inside the app window, where updating is possible).
// The app shows its own box: "Update available", "You're on the latest version", or "Couldn't check".
const updateBridge = window.__kitBridge && window.__kitBridge.checkUpdate ? window.__kitBridge : null;
if (updateBridge) $('[data-act="update"]').hidden = false;
function checkForUpdates() {
  if (!updateBridge) return;
  toast(L("Checking for updates…", "正在检查更新…"));
  try { updateBridge.checkUpdate(); } catch (e) { toast(L("Couldn't check for updates: ", "无法检查更新：") + e.message); }
}
