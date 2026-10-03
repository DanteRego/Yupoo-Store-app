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
  history.replaceState(null, "", PAGES.catalog + (id ? "#" + encodeURIComponent(id) : ""));
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
  $(".count").textContent = S.collections.length ? `${plural(S.collections.length, "collection")} · ${plural(allKeys.size, "item")}` : "";
}

function renderGrid() {
  const c = current();
  $(".colname").textContent = c ? c.name : S.collections.length ? "All collected items" : "Your Catalog";
  document.querySelectorAll(".needcol").forEach((b) => { b.hidden = !c; });
  $('[data-act="csv"]').hidden = !S.collections.length;
  $(".filters").hidden = !S.collections.length;

  if (!S.collections.length) {
    $(".colsub").textContent = "";
    $(".summary").textContent = "";
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Make your first collection</strong>
      Collections are your own lists of items from the Library — for example a <b>Wishlist</b> of things to order later.
      <ol>
        <li>Press <b>Start a Wishlist</b> below (or <b>＋ New collection</b> on the left).</li>
        <li>In the Library, click <b>☆</b> on any item to add it — or <b>☑ Select</b> several and use <b>☆ Add to collection</b>.</li>
        <li>Come back here to see them, add notes like size or quantity, and export the list.</li>
      </ol>
      <p><button class="more" data-act="wishlist">Start a Wishlist</button></p></div>`;
    return;
  }
  const all = entries(), list = filteredEntries();
  const stores = new Set(all.map((e) => S.lib.albums[e.key] && S.lib.albums[e.key].store).filter(Boolean));
  $(".colsub").textContent = `${plural(all.length, "item")}${stores.size ? ` · from ${plural(stores.size, "store")}` : ""}`;
  $(".summary").textContent = list.length !== all.length ? `Showing ${list.length} of ${all.length}` : "";
  if (!all.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Nothing in “${esc(c ? c.name : "your collections")}” yet</strong>
      In the Library, click <b>☆</b> on any item and choose this collection — or <b>☑ Select</b> several items and use <b>☆ Add to collection</b>.
      <p><button class="more" data-act="library">Go to the Library</button></p></div>`;
    return;
  }
  if (!list.length) {
    $(".grid").innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing here matches “${esc(S.q)}”.</div>`;
    return;
  }
  $(".grid").innerHTML = list.map(card).join("");
  document.querySelectorAll("img[data-key]").forEach((img) => loadThumb(img));
}

function card(e) {
  const a = S.lib.albums[e.key];
  const c = current();
  if (!a) {
    return `<div class="card gone"><span class="img"></span><div class="meta">
      <div class="en">An item you've removed from the Library</div>
      <div class="row">${c ? `<button data-uncollect="${esc(e.key)}">✕ Take out</button>` : ""}</div></div></div>`;
  }
  const p = info(a);
  return `<div class="card" data-card="${esc(a.key)}">
    <a class="img" href="${esc(a.link)}" data-album>
      <img data-key="${esc(a.key)}" data-cover="${esc(a.cover || "")}" alt="" loading="lazy">
      ${a.count ? `<span class="n">${a.count} photos</span>` : ""}
    </a>
    <div class="meta">
      <div class="catline ${p.category === "Other" ? "unsorted" : ""}">${esc(p.catPath)}${p.brand ? ` · <span class="brand">${esc(p.brand)}</span>` : ""}</div>
      <div class="en">${esc(p.english)}</div>
      ${p.english !== a.title ? `<div class="zh">${esc(a.title)}</div>` : ""}
      <div class="src">${esc(storeName(a.store))} · added ${esc(fmtDate(e.added))}</div>
      ${c ? `<input class="note" data-note="${esc(a.key)}" value="${esc(e.note)}" placeholder="Add a note — size, quantity, price…" maxlength="500">`
          : `<div class="src">In: ${e.cols.map((x) => esc(x.name)).join(", ")}</div>`}
      <div class="row">
        <a href="${esc(a.link)}" data-album>Open album ↗</a>
        <button class="star on" data-collect="${esc(a.key)}" title="Change which collections it's in">★</button>
        ${c ? `<button data-uncollect="${esc(a.key)}" title="Take it out of “${esc(c.name)}”">✕</button>` : ""}
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
    const input = prompt("Name your new collection:", S.collections.length ? "" : "Wishlist");
    if (input === null) return;
    name = input;
  }
  if (!name.trim()) return;
  try {
    const res = await call("POST", "/api/collections/create", { name });
    await loadCollections();
    selectCollection(res.collection.id);
    toast(`Made “${res.collection.name}”. Add items to it from the Library with ☆.`);
  } catch (e) { toast(e.message); }
}

async function renameCollection(id) {
  const c = S.collections.find((x) => x.id === id); if (!c) return;
  const input = prompt("Rename this collection:", c.name);
  if (input === null || !input.trim() || input.trim() === c.name) return;
  try { await call("POST", "/api/collections/rename", { id, name: input }); } catch (e) { toast(e.message); return; }
  await loadCollections();
  render();
}

async function deleteCollection(id) {
  const c = S.collections.find((x) => x.id === id); if (!c) return;
  if (!confirm(`Delete the collection “${c.name}”?\n\nIts ${plural(c.items.length, "item")} stay in your Library — only this list (and its notes) goes.`)) return;
  await call("POST", "/api/collections/delete", { id });
  await loadCollections();
  if (S.colId === id) S.colId = null;
  render();
  toast(`Deleted “${c.name}”.`);
}

async function takeOut(key) {
  const c = current(); if (!c) return;
  const old = c.items.find((it) => it.key === key);
  await call("POST", "/api/collections/remove", { id: c.id, keys: [key] });
  await loadCollections();
  render();
  toast(`Took it out of “${c.name}”.`, "Undo", async () => {
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
  } catch (e) { toast("Couldn't save the note: " + e.message); }
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
    toast(`Saved ${plural(rows.length - 1, "item")} to ${res.path}`);
  } catch (e) { toast("Couldn't save the CSV: " + e.message); }
}

// Opening an album from the Catalog's own window shows it in the main app window,
// so this window stays on your list.
function openAlbum(url) {
  if (isOwnWindow) {
    try { window.opener.location.href = url; window.opener.focus(); toast("Opened in the main window."); return; } catch (e) {}
  }
  location.href = url;
}
function goToLibrary() {
  if (isOwnWindow) {
    try { window.opener.location.href = PAGES.library; window.opener.focus(); return; } catch (e) {}
  }
  location.href = PAGES.library;
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
  else if (b.dataset.act === "csv") exportCsv();
  else if (b.dataset.act === "library") goToLibrary();
  else if (b.dataset.act === "newwin") openCatalog(true, S.colId);
});
// Notes save when you leave the box or press Enter.
document.addEventListener("change", (e) => { if (e.target.matches(".note")) saveNote(e.target); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".note")) e.target.blur(); });
$(".q").addEventListener("input", (e) => { S.q = e.target.value; renderGrid(); });
$(".sort").addEventListener("change", (e) => { S.sort = e.target.value; renderGrid(); });
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
}).catch((e) => toast("Couldn't load your Catalog: " + e.message));
