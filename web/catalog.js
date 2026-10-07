// Yupoo Library app — the Catalog: your own collections of saved items (e.g. "Wishlist"),
// each item with a note for things like size or quantity. Shared pieces are in shared.js.
// It can run in the main window or in a window of its own ("⧉ New window").

// colId = the collection you're looking at ("" = everything in any collection).
Object.assign(S, { colId: null, q: "", sort: "added" });
const isOwnWindow = !!(window.opener && !window.opener.closed);

const current = () => S.collections.find((c) => c.id === S.colId) || null;

function chooseStartingCollection() {
  const fromLink = decodeURIComponent(location.hash.slice(1));
  let remembered = "";
  try { remembered = localStorage.getItem("catalogCol") || ""; } catch (e) {}
  const ok = (id) => id === "" || S.collections.some((c) => c.id === id);
  if (fromLink && ok(fromLink)) S.colId = fromLink;
  else if (S.colId !== null && ok(S.colId)) return;
  else if (remembered && ok(remembered)) S.colId = remembered;
  else S.colId = S.collections.length ? S.collections[0].id : "";
}

function selectCollection(id) {
  S.colId = id;
  try { localStorage.setItem("catalogCol", id); } catch (e) {}
  history.replaceState(null, "", "/catalog" + (id ? "#" + encodeURIComponent(id) : ""));
  render();
  $("main").scrollTop = 0;
}

// The entries to show: one per item, with its note (in one collection) or the collections it's in (in "All").
function entries() {
  const c = current();
  if (c) return c.items.map((it) => ({ key: it.key, added: it.added, note: it.note || "", cols: [c] }));
  const byKey = new Map();
  S.collections.forEach((col) => col.items.forEach((it) => {
    const e = byKey.get(it.key) || { key: it.key, added: 0, note: "", cols: [] };
    e.added = Math.max(e.added, it.added);
    e.cols.push(col);
    byKey.set(it.key, e);
  }));
  return [...byKey.values()];
}

function filteredEntries() {
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = entries().filter((e) => {
    if (!words.length) return true;
    const a = S.lib.albums[e.key];
    const p = a ? info(a) : null;
    const hay = [e.note, e.cols.map((c) => c.name).join(" "), p ? p.brand : "", a ? a.title + " " + storeName(a.store) + " " + a.store : "",
      p ? p.english + " " + p.catPath : ""].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const A = (e) => S.lib.albums[e.key];
  const name = (e) => (A(e) ? info(A(e)).english : "");
  const cmp = {
    added: (x, y) => y.added - x.added,
    oldest: (x, y) => x.added - y.added,
    cat: (x, y) => {
      const px = A(x) ? info(A(x)) : null, py = A(y) ? info(A(y)) : null;
      return (px ? YO_categoryRank(px.category, px.sub) : 99999) - (py ? YO_categoryRank(py.category, py.sub) : 99999) || name(x).localeCompare(name(y));
    },
    name: (x, y) => name(x).localeCompare(name(y)),
    brand: (x, y) => { const bx = A(x) ? info(A(x)).brand : "", by = A(y) ? info(A(y)).brand : ""; return (!bx !== !by ? (bx ? -1 : 1) : bx.localeCompare(by)) || name(x).localeCompare(name(y)); },
    store: (x, y) => (A(x) ? storeName(A(x).store) : "").localeCompare(A(y) ? storeName(A(y).store) : "") || name(x).localeCompare(name(y))
  }[S.sort];
  return list.sort(cmp);
}

// ---------- drawing ----------
function renderSidebar() {
  const allKeys = new Set();
  S.collections.forEach((c) => c.items.forEach((it) => allKeys.add(it.key)));
  let html = S.collections.length > 1 || S.colId === ""
    ? `<div class="item top ${S.colId === "" ? "on" : ""}" role="button" tabindex="0" data-col=""><span class="name">All collected items</span><span class="c">${allKeys.size}</span></div>`
    : "";
  S.collections.forEach((c) => {
    html += `<div class="item ${S.colId === c.id ? "on" : ""}" role="button" tabindex="0" data-col="${esc(c.id)}">
      <span class="name" title="${esc(c.name)}">${esc(c.name)}</span>
      <button class="ren" data-rename="${esc(c.id)}" title="Rename">✎</button>
      <button class="ren" data-delete="${esc(c.id)}" title="Delete this collection">🗑</button>
      <span class="c">${c.items.length}</span></div>`;
  });
  $(".cols").innerHTML = html;
  $(".count").textContent = S.collections.length ? L(`${plural(S.collections.length, "collection")} · ${plural(allKeys.size, "item")}`,
    `${S.collections.length} 个收藏夹 · ${allKeys.size} 件`) : "";
}

function renderGrid() {
  const c = current();
  $(".colname").textContent = c ? c.name : t(S.collections.length ? "All collected items" : "Your Catalog");
  document.querySelectorAll(".needcol").forEach((b) => { b.hidden = !c; });
  $('[data-act="csv"]').hidden = !S.collections.length;
  $(".filters").hidden = !S.collections.length;

  if (!S.collections.length) {
    $(".colsub").textContent = "";
    $(".summary").textContent = "";
    $(".grid").innerHTML = L(`<div class="empty" style="grid-column:1/-1"><strong>Make your first collection</strong>
      Collections are your own lists of items from the Library — for example a <b>Wishlist</b> of things to order later.
      <ol>
        <li>Press <b>Start a Wishlist</b> below (or <b>＋ New collection</b> on the left).</li>
        <li>In the Library, click <b>☆</b> on any item to add it — or <b>☑ Select</b> several and use <b>☆ Add to collection</b>.</li>
        <li>Come back here to see them, add notes like size or quantity, and export the list — or <b>📤 Export to share</b> it with a friend.</li>
      </ol>
      <p>Someone sent you a collection file? Open it with <b>📥 Import a shared collection</b> on the left.</p>
      <p><button class="more" data-act="wishlist">Start a Wishlist</button></p></div>`,
      `<div class="empty" style="grid-column:1/-1"><strong>新建你的第一个收藏夹</strong>
      收藏夹是你自己从图库里挑的商品清单——比如以后要下单的<b>愿望清单</b>。
      <ol>
        <li>点下面的<b>新建愿望清单</b>（或左边的<b>＋ 新建收藏夹</b>）。</li>
        <li>在图库里点任意商品上的<b>☆</b>把它加进来——或者用<b>☑ 多选</b>选几件，再点<b>☆ 加入收藏夹</b>。</li>
        <li>回到这里查看它们，添加尺码、数量等备注，导出清单——或者用<b>📤 导出分享</b>发给朋友。</li>
      </ol>
      <p>有人发给你一个收藏夹文件？用左边的<b>📥 导入别人分享的收藏夹</b>打开它。</p>
      <p><button class="more" data-act="wishlist">新建愿望清单</button></p></div>`);
    return;
  }
  const all = entries(), list = filteredEntries();
  const stores = new Set(all.map((e) => S.lib.albums[e.key] && S.lib.albums[e.key].store).filter(Boolean));
  $(".colsub").textContent = L(`${plural(all.length, "item")}${stores.size ? ` · from ${plural(stores.size, "store")}` : ""}`,
    `${all.length} 件${stores.size ? ` · 来自 ${stores.size} 个店铺` : ""}`);
  $(".summary").textContent = list.length !== all.length ? L(`Showing ${list.length} of ${all.length}`, `显示 ${list.length} 件，共 ${all.length} 件`) : "";
  if (!all.length) {
    $(".grid").innerHTML = L(`<div class="empty" style="grid-column:1/-1"><strong>Nothing in “${esc(c ? c.name : "your collections")}” yet</strong>
      In the Library, click <b>☆</b> on any item and choose this collection — or <b>☑ Select</b> several items and use <b>☆ Add to collection</b>.
      <p><button class="more" data-act="library">Go to the Library</button></p></div>`,
      `<div class="empty" style="grid-column:1/-1"><strong>“${esc(c ? c.name : "你的收藏夹")}”里还没有东西</strong>
      在图库里点任意商品上的<b>☆</b>并选择这个收藏夹——或者用<b>☑ 多选</b>选几件，再点<b>☆ 加入收藏夹</b>。
      <p><button class="more" data-act="library">去图库</button></p></div>`);
    return;
  }
  if (!list.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1">${L(`Nothing here matches “${esc(S.q)}”.`, `这里没有符合“${esc(S.q)}”的商品。`)}</div>`;
    return;
  }
  $(".grid").innerHTML = list.map(card).join("");
  document.querySelectorAll("img[data-key]").forEach(loadThumb);
}

function card(e) {
  const a = S.lib.albums[e.key];
  const c = current();
  if (!a) {
    return `<div class="card gone"><span class="img"></span><div class="meta">
      <div class="en">${L("An item you've removed from the Library", "一件你已经从图库删除的商品")}</div>
      <div class="row">${c ? `<button data-uncollect="${esc(e.key)}">${L("✕ Take out", "✕ 移出")}</button>` : ""}</div></div></div>`;
  }
  const p = info(a);
  return `<div class="card" data-card="${esc(a.key)}">
    <a class="img" href="${esc(a.link)}" data-album>
      <img data-key="${esc(a.key)}" alt="" loading="lazy">
      ${a.count ? `<span class="n">${L(`${a.count} photos`, `${a.count} 张图`)}</span>` : ""}
    </a>
    <div class="meta">
      <div class="catline ${p.category === "Other" ? "unsorted" : ""}">${esc(tCat(p.catPath))}${p.brand ? ` · <span class="brand">${esc(p.brand)}</span>` : ""}</div>
      ${LANG === "zh" ? `<div class="en">${esc(a.title)}</div>${p.english !== a.title ? `<div class="zh">${esc(p.english)}</div>` : ""}`
        : `<div class="en">${esc(p.english)}</div>${p.english !== a.title ? `<div class="zh">${esc(a.title)}</div>` : ""}`}
      <div class="src">${esc(storeName(a.store))} · ${L("added", "添加于")} ${esc(fmtDate(e.added))}</div>
      ${c ? `<input class="note" data-note="${esc(a.key)}" value="${esc(e.note)}" placeholder="${t("Add a note — size, quantity, price…")}" maxlength="500">`
          : `<div class="src">${L("In: ", "在：")}${e.cols.map((x) => esc(x.name)).join(", ")}</div>`}
      <div class="row">
        <a href="${esc(a.link)}" data-album>Open album ↗</a>
        <button class="star on" data-collect="${esc(a.key)}" title="Change which collections it's in">★</button>
        ${c ? `<button data-uncollect="${esc(a.key)}" title="${L(`Take it out of “${esc(c.name)}”`, `移出“${esc(c.name)}”`)}">✕</button>` : ""}
      </div>
    </div>
  </div>`;
}

function render() {
  chooseStartingCollection();
  renderSidebar();
  renderGrid();
}

// ---------- actions ----------
async function newCollection(name) {
  if (name === undefined) {
    const input = prompt(L("Name your new collection:", "给新收藏夹起个名字："), S.collections.length ? "" : L("Wishlist", "愿望清单"));
    if (input === null) return;
    name = input;
  }
  if (!name.trim()) return;
  try {
    const res = await call("POST", "/api/collections/create", { name });
    await loadCollections();
    selectCollection(res.collection.id);
    toast(L(`Made “${res.collection.name}”. Add items to it from the Library with ☆.`, `已新建“${res.collection.name}”。在图库里用 ☆ 把商品加进来。`));
  } catch (e) { toast(e.message); }
}

async function renameCollection(id) {
  const c = S.collections.find((x) => x.id === id); if (!c) return;
  const input = prompt(L("Rename this collection:", "重命名这个收藏夹："), c.name);
  if (input === null || !input.trim() || input.trim() === c.name) return;
  try { await call("POST", "/api/collections/rename", { id, name: input }); } catch (e) { toast(e.message); return; }
  await loadCollections();
  render();
}

async function deleteCollection(id) {
  const c = S.collections.find((x) => x.id === id); if (!c) return;
  if (!confirm(L(`Delete the collection “${c.name}”?\n\nIts ${plural(c.items.length, "item")} stay in your Library — only this list (and its notes) goes.`,
    `要删除收藏夹“${c.name}”吗？\n\n里面的 ${c.items.length} 件商品会留在图库里——只删除这个清单（和它的备注）。`))) return;
  await call("POST", "/api/collections/delete", { id });
  await loadCollections();
  if (S.colId === id) S.colId = null;
  render();
  toast(L(`Deleted “${c.name}”.`, `已删除“${c.name}”。`));
}

async function takeOut(key) {
  const c = current(); if (!c) return;
  const old = c.items.find((it) => it.key === key);
  await call("POST", "/api/collections/remove", { id: c.id, keys: [key] });
  await loadCollections();
  render();
  toast(L(`Took it out of “${c.name}”.`, `已移出“${c.name}”。`), "Undo", async () => {
    await call("POST", "/api/collections/add", { id: c.id, keys: [key] });
    if (old && old.note) await call("POST", "/api/collections/note", { id: c.id, key, note: old.note });
    await loadCollections();
    render();
  });
}

async function saveNote(input) {
  const c = current(); if (!c) return;
  const key = input.dataset.note, note = input.value.trim();
  const it = c.items.find((x) => x.key === key);
  if (!it || (it.note || "") === note) return;
  try {
    await call("POST", "/api/collections/note", { id: c.id, key, note });
    it.note = note;
    input.classList.add("saved");
    setTimeout(() => input.classList.remove("saved"), 900);
  } catch (e) { toast(L("Couldn't save the note: ", "无法保存备注：") + e.message); }
}

async function exportCsv() {
  const c = current();
  const rows = [["Name", "Category", "Subcategory", "Brand", "Team", "Season", "Kit type", "Store", c ? "Note" : "Collections", "Album link", "Original title", "Added"]];
  filteredEntries().forEach((e) => {
    const a = S.lib.albums[e.key]; if (!a) return;
    const p = info(a);
    rows.push([p.english, p.category, p.sub, p.brand, p.team || "", p.season || "", p.kit || "", storeName(a.store),
      c ? e.note : e.cols.map((x) => x.name).join(", "), a.link, a.title, fmtDate(e.added)]);
  });
  const content = "﻿" + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const fileName = (c ? c.name : "catalog").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "collection";
  try {
    const res = await call("POST", "/api/save-file", { name: `${fileName}-${today()}.csv`, content });
    toast(L(`Saved ${plural(rows.length - 1, "item")} to ${res.path}`, `已把 ${rows.length - 1} 件保存到 ${res.path}`));
  } catch (e) { toast(L("Couldn't save the CSV: ", "无法保存 CSV：") + e.message); }
}

// ---------- sharing a collection as a file ----------
// "📤 Export to share" saves the collection (its items, notes and your fixes) as a file in your Downloads.
// Anyone with Yupoo Library can open it with "📥 Import a shared collection" — they don't need the items already.
async function exportShared() {
  const c = current(); if (!c) return;
  const items = [], storeNames = {}, storeCategories = {};
  c.items.forEach((it) => {
    const a = S.lib.albums[it.key]; if (!a) return;
    items.push({ note: it.note || "", album: { host: a.host, store: a.store, id: a.id, title: a.title, cover: a.cover, count: a.count || 0,
      link: a.link, team: a.team || "", category: a.category || "" } });
    if (S.storeNames[a.store]) storeNames[a.store] = S.storeNames[a.store];
    if (S.storeCats[a.store]) storeCategories[a.store] = S.storeCats[a.store];
  });
  if (!items.length) { toast(L("There's nothing in this collection to share yet.", "这个收藏夹里还没有可分享的东西。")); return; }
  const file = { type: "yupoo-library-collection", version: 1, name: c.name, exported: Date.now(), storeNames, storeCategories, items };
  const fileName = c.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "collection";
  try {
    const res = await call("POST", "/api/save-file", { name: `${fileName}.yupoo-collection.json`, content: JSON.stringify(file, null, 1) });
    toast(L(`Saved “${c.name}” (${plural(items.length, "item")}) to ${res.path}. Send that file to anyone with Yupoo Library — they open it with 📥 Import.`,
      `已把“${c.name}”（${items.length} 件）保存到 ${res.path}。把这个文件发给也在用 Yupoo 图库的人——他们用 📥 导入 打开。`));
  } catch (e) { toast(L("Couldn't save the file: ", "无法保存文件：") + e.message); }
}

async function importShared(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast(L("That file isn't a shared Yupoo Library collection.", "这个文件不是 Yupoo 图库分享的收藏夹。")); return; }
  try {
    const res = await call("POST", "/api/import-collection", data);
    await load();
    selectCollection(res.collection.id);
    const n = res.collection.items.length;
    toast(L(`Imported “${res.collection.name}” — ${plural(n, "item")}` + (res.newItems ? `, ${res.newItems} of them new to your library.` : ", all already in your library."),
      `已导入“${res.collection.name}”——${n} 件` + (res.newItems ? `，其中 ${res.newItems} 件是图库里新增的。` : "，都已经在你的图库里了。")));
  } catch (e) { toast(e.message); }
}

// Opening an album from the Catalog's own window shows it in the main app window,
// so this window stays on your list.
function openAlbum(url) {
  if (isOwnWindow) {
    try { window.opener.location.href = url; window.opener.focus(); toast(L("Opened in the main window.", "已在主窗口打开。")); return; } catch (e) {}
  }
  location.href = url;
}
// "◀ Library" (top left): back to the Library in this same window, where your filters, page and
// scroll position are restored. (In a separate Catalog window, that window becomes a Library too.)
function goToLibrary() {
  location.href = "/";
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const album = e.target.closest("[data-album]");
  if (album) { e.preventDefault(); openAlbum(album.getAttribute("href")); return; }
  const b = e.target.closest("button, .item");
  if (!b) return;
  if (b.dataset.rename) renameCollection(b.dataset.rename);
  else if (b.dataset.delete) deleteCollection(b.dataset.delete);
  else if (b.dataset.col !== undefined) selectCollection(b.dataset.col);
  else if (b.dataset.collect) openCollectionPicker(b, [b.dataset.collect], render);
  else if (b.dataset.uncollect) takeOut(b.dataset.uncollect);
  else if (b.dataset.act === "new") newCollection();
  else if (b.dataset.act === "wishlist") newCollection("Wishlist");
  else if (b.dataset.act === "rename" && current()) renameCollection(current().id);
  else if (b.dataset.act === "delete" && current()) deleteCollection(current().id);
  else if (b.dataset.act === "share") exportShared();
  else if (b.dataset.act === "csv") exportCsv();
  else if (b.dataset.act === "library") goToLibrary();
  else if (b.dataset.act === "newwin") openCatalog(true, S.colId);
});
// Notes save when you leave the box or press Enter.
document.addEventListener("change", (e) => { if (e.target.matches(".note")) saveNote(e.target); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".note")) e.target.blur(); });
$(".q").addEventListener("input", (e) => { S.q = e.target.value; renderGrid(); });
$(".sort").addEventListener("change", (e) => { S.sort = e.target.value; renderGrid(); });
$(".importcol").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importShared(f); });
window.addEventListener("hashchange", () => { S.colId = null; render(); });

// The Library (maybe in the other window) changed something: keep this page in step.
if (channel) channel.onmessage = async (e) => {
  const what = e.data && e.data.what;
  if (document.activeElement && document.activeElement.matches(".note")) return; // don't interrupt typing
  if (what === "collections") await loadCollections();
  else if (what === "library") await load();
  render();
};

// Picking up where you left off: coming back from an album returns to the same search, sort and scroll.
function saveView() {
  try { sessionStorage.setItem("catalogView", JSON.stringify({ colId: S.colId, q: S.q, sort: S.sort, scroll: $("main").scrollTop })); } catch (e) {}
}
function restoreView() {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem("catalogView") || "null"); } catch (e) {}
  if (!v || v.colId !== S.colId) return 0;
  S.q = v.q || ""; S.sort = v.sort || "added";
  $(".q").value = S.q; $(".sort").value = S.sort;
  return v.scroll || 0;
}
let viewTimer = null;
$("main").addEventListener("scroll", () => {
  $(".topbar").classList.toggle("stuck", $("main").scrollTop > 4);
  clearTimeout(viewTimer);
  viewTimer = setTimeout(saveView, 250);
});
window.addEventListener("pagehide", saveView);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveView(); });

if (isOwnWindow) $('[data-act="newwin"]').hidden = true;
load().then(() => {
  chooseStartingCollection();
  const scroll = restoreView();
  render();
  $("main").scrollTop = scroll;
}).catch((e) => toast(L("Couldn't load your Catalog: ", "无法加载你的收藏目录：") + e.message));
