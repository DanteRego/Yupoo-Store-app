// Yupoo Library — Firefox add-on: the background script (the add-on's engine).
// It does what the Windows app's Go code does (store.go, collections.go, crawl.go, server.go):
//   - keeps your library in Firefox's add-on storage, in the same shape as the app's library.json
//   - answers the Library and Catalog pages (the same "/api/..." requests the app's server answers)
//   - runs "Save whole store" in the background, so it keeps going while you browse
//   - adds the Referer header Yupoo needs before it shows photos to the Library page
"use strict";

const STORAGE_KEY = "library";
let data = null;
let version = 0;
let saveTimer = null;

function normalize(d) {
  d = d && typeof d === "object" ? d : {};
  return {
    albums: d.albums && typeof d.albums === "object" ? d.albums : {},
    aliases: d.aliases && typeof d.aliases === "object" ? d.aliases : {},
    settings: Object.assign({ autoSave: true }, d.settings || {}),
    storeNames: d.storeNames && typeof d.storeNames === "object" ? d.storeNames : {},
    storeCategories: d.storeCategories && typeof d.storeCategories === "object" ? d.storeCategories : {},
    collections: Array.isArray(d.collections) ? d.collections : []
  };
}

const ready = browser.storage.local.get(STORAGE_KEY).then((r) => { data = normalize(r[STORAGE_KEY]); });

// Saving waits a moment so a burst of changes is written once.
function scheduleSave() {
  version++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}
function flush() {
  clearTimeout(saveTimer);
  return browser.storage.local.set({ [STORAGE_KEY]: data });
}

const trim = (s) => String(s == null ? "" : s).trim();

// ---------- the library (like store.go) ----------
function saveAlbums(list) {
  const now = Date.now();
  let added = 0;
  (Array.isArray(list) ? list : []).forEach((a) => {
    if (!a || !a.host || !a.id) return;
    const key = a.host + ":" + a.id;
    const cur = data.albums[key];
    if (!cur) {
      data.albums[key] = { key, host: a.host, store: a.store || a.host.split(".")[0], id: String(a.id), title: a.title || "",
        cover: a.cover || "", count: a.count || 0, link: a.link || "", firstSeen: now, lastSeen: now };
      added++;
    } else {
      if (a.title) cur.title = a.title;
      if (a.cover) cur.cover = a.cover;
      if (a.count > 0) cur.count = a.count;
      cur.lastSeen = now;
    }
  });
  scheduleSave();
  return { added, total: Object.keys(data.albums).length };
}

function removeAlbums(keys) {
  (keys || []).forEach((k) => { delete data.albums[k]; });
  data.collections.forEach((c) => removeFromCollection(c, keys || []));
  scheduleSave();
  return true;
}

function setMapValue(map, k, v, dropIf) {
  v = trim(v);
  if (!v || v === dropIf) delete map[k]; else map[k] = v;
  scheduleSave();
  return true;
}

// Restore: adds what's missing from a backup (the app's library.json or the add-on's backup file).
function restore(incoming) {
  if (!incoming || typeof incoming !== "object" || !incoming.albums) throw new Error("That file isn't a Yupoo Library backup.");
  let added = 0;
  Object.keys(incoming.albums).forEach((k) => {
    const a = incoming.albums[k];
    if (a && !data.albums[k]) { data.albums[k] = a; added++; }
  });
  Object.assign(data.aliases, incoming.aliases || {});
  Object.keys(incoming.storeNames || {}).forEach((k) => { if (!(k in data.storeNames)) data.storeNames[k] = incoming.storeNames[k]; });
  Object.keys(incoming.storeCategories || {}).forEach((k) => { if (!(k in data.storeCategories)) data.storeCategories[k] = incoming.storeCategories[k]; });
  (incoming.collections || []).forEach((inc) => {
    if (!inc || !inc.id) return;
    const c = data.collections.find((x) => x.id === inc.id);
    if (c) {
      const have = new Set(c.items.map((it) => it.key));
      (inc.items || []).forEach((it) => { if (!have.has(it.key)) c.items.push(it); });
    } else {
      data.collections.push({ id: inc.id, name: inc.name || "Collection", items: inc.items || [], created: inc.created || Date.now() });
    }
  });
  scheduleSave();
  return { added };
}

// ---------- collections (like collections.go) ----------
function newCollectionId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "c" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const cleanName = (s, max) => trim(String(s || "").replace(/\s+/g, " ")).slice(0, max);

function addToCollection(c, keys) {
  const have = new Set(c.items.map((it) => it.key));
  const now = Date.now();
  let n = 0;
  (keys || []).forEach((k) => {
    if (have.has(k) || !data.albums[k]) return;
    have.add(k);
    c.items.push({ key: k, added: now });
    n++;
  });
  return n;
}
function removeFromCollection(c, keys) {
  const drop = new Set(keys || []);
  const before = c.items.length;
  c.items = c.items.filter((it) => !drop.has(it.key));
  return before - c.items.length;
}

function collectionAction(act, b) {
  b = b || {};
  if (act === "create") {
    const name = cleanName(b.name, 80);
    if (!name) throw new Error("give the collection a name");
    const c = { id: newCollectionId(), name, items: [], created: Date.now() };
    const n = addToCollection(c, b.keys);
    data.collections.push(c);
    scheduleSave();
    return { collection: c, changed: n };
  }
  const c = data.collections.find((x) => x.id === b.id);
  if (!c) throw new Error("that collection doesn't exist any more");
  let n = 0;
  if (act === "rename") {
    const name = cleanName(b.name, 80);
    if (!name) throw new Error("give the collection a name");
    c.name = name;
  } else if (act === "delete") {
    data.collections = data.collections.filter((x) => x.id !== c.id);
    scheduleSave();
    return { collection: null, changed: c.items.length };
  } else if (act === "add") n = addToCollection(c, b.keys);
  else if (act === "remove") n = removeFromCollection(c, b.keys);
  else if (act === "note") {
    c.items.forEach((it) => { if (it.key === b.key) { it.note = trim(b.note).slice(0, 500); n = 1; } });
  } else throw new Error("unknown collection action");
  scheduleSave();
  return { collection: c, changed: n };
}

// ---------- the pages' requests (like server.go) ----------
function handle(method, path, body) {
  const b = body || {};
  if (method === "GET" && path === "/api/state") {
    return { library: { albums: data.albums }, aliases: data.aliases, myTeams: {}, settings: data.settings,
      storeNames: data.storeNames, storeCategories: data.storeCategories, collections: data.collections, version };
  }
  if (method === "GET" && path === "/api/collections") return data.collections;
  if (method === "GET" && path === "/api/backup-data") return data;
  if (method === "GET" && path === "/api/crawl") return crawl.st;
  if (method !== "POST") throw new Error("unknown request " + path);
  if (path.indexOf("/api/collections/") === 0) return collectionAction(path.slice("/api/collections/".length), b);
  if (path.indexOf("/api/crawl/") === 0) return crawlAction(path.slice("/api/crawl/".length), b);
  switch (path) {
    case "/api/save-albums": return saveAlbums(b);
    case "/api/team": { const a = data.albums[b.key]; if (a) { a.team = trim(b.team); scheduleSave(); } return true; }
    case "/api/category": { const a = data.albums[b.key]; if (a) { a.category = trim(b.category); scheduleSave(); } return true; }
    case "/api/categories": {
      let n = 0;
      (b.keys || []).forEach((k) => { const a = data.albums[k]; if (a) { a.category = trim(b.category); n++; } });
      scheduleSave();
      return { changed: n };
    }
    case "/api/store-name": return setMapValue(data.storeNames, b.store, b.name, b.store);
    case "/api/store-category": return setMapValue(data.storeCategories, b.store, b.category, "");
    case "/api/remove": return removeAlbums(b.keys);
    case "/api/aliases": data.aliases = b && typeof b === "object" ? b : {}; scheduleSave(); return true;
    case "/api/settings": data.settings = Object.assign({ autoSave: true }, b); scheduleSave(); return true;
    case "/api/restore": return restore(b);
  }
  throw new Error("unknown request " + path);
}

// ---------- "Save whole store" (like crawl.go) ----------
const crawl = {
  st: { active: false, running: false, host: "", store: "", link: "", page: 0, maxPage: 0, seen: 0, new: 0,
    msg: "", failed: false, started: 0, finished: 0, uiMode: "", uiMin: false },
  stop: false,
  runId: 0
};

// The page list to walk: the category or search you were on, otherwise all albums.
function listUrl(u) {
  const out = new URL("https://" + u.host + "/albums");
  if (u.pathname.indexOf("/categories") === 0 || u.pathname.indexOf("/search") === 0) {
    out.pathname = u.pathname;
    out.search = u.search;
  }
  out.searchParams.delete("page");
  return out;
}

function crawlAction(act, o) {
  o = o || {};
  let error = "";
  if (act === "start") {
    let u = null;
    try { u = new URL(o.url || o.URL || ""); } catch (e) {}
    if (!u || !/\.x\.yupoo\.com$/i.test(u.hostname)) error = "that isn't a Yupoo store page";
    else if (crawl.st.running) error = "Already saving " + crawl.st.store + ". Stop it first, or wait for it to finish.";
    else {
      const list = listUrl(u);
      crawl.stop = false;
      crawl.runId++;
      crawl.st = { active: true, running: true, host: u.hostname.toLowerCase(), store: u.hostname.split(".")[0].toLowerCase(),
        link: list.href, page: 1, maxPage: 0, seen: 0, new: 0, msg: "", failed: false, started: Date.now(), finished: 0,
        uiMode: crawl.st.uiMode, uiMin: crawl.st.uiMin };
      runCrawl(list, crawl.runId);
    }
  } else if (act === "stop") crawl.stop = true;
  else if (act === "dismiss") { if (!crawl.st.running) crawl.st.active = false; }
  else if (act === "ui") { crawl.st.uiMode = o.mode || o.Mode || ""; crawl.st.uiMin = !!(o.min || o.Min); }
  return error ? { status: crawl.st, error } : { status: crawl.st };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function finishCrawl(msg, failed) {
  Object.assign(crawl.st, { running: false, msg, failed: !!failed, finished: Date.now() });
}

async function runCrawl(list, id) {
  const host = list.host;
  let prevSig = "", maxPage = 0, seen = 0, added = 0;
  for (let page = 1; ; page++) {
    if (crawl.stop || id !== crawl.runId) { finishCrawl(`Stopped — ${added} new items saved.`); return; }
    crawl.st.page = page;
    const u = new URL(list.href);
    u.searchParams.set("page", page);
    let doc;
    try {
      const res = await fetch(u.href, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      doc = new DOMParser().parseFromString(await res.text(), "text/html");
    } catch (e) {
      finishCrawl(`Yupoo stopped answering on page ${page}. Wait a minute, then try again — saved items are kept.`, true);
      return;
    }
    if (page === 1) { maxPage = detectMaxPage(doc); crawl.st.maxPage = maxPage; }
    const found = extractAlbums(doc, host);
    const sig = found.map((a) => a.id).join(",");
    if (!found.length || sig === prevSig) {
      if (page === 1) finishCrawl("Couldn't find any items on this store's pages.", true);
      else finishCrawl(`Done — ${seen} items in this store, ${added} new.`);
      return;
    }
    added += saveAlbums(found).added;
    seen += found.length;
    crawl.st.seen = seen;
    crawl.st.new = added;
    if ((maxPage && page >= maxPage) || page >= 500) { finishCrawl(`Done — ${seen} items in this store, ${added} new.`); return; }
    prevSig = sig;
    await sleep(1500 + Math.random() * 1000); // go slowly so Yupoo doesn't block you
  }
}

// Reading a store page — the same rules as extractAlbums in capture.js (and crawl.go).
function extractAlbums(doc, host) {
  const origin = "https://" + host, store = host.split(".")[0];
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const abs = (u) => {
    if (!u || u.indexOf("data:") === 0) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    try { return new URL(u, origin).href; } catch (e) { return ""; }
  };
  const out = new Map();
  doc.querySelectorAll('a[href*="/albums/"]').forEach((a) => {
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/albums\/(\d+)/);
    if (!m) return;
    const img = a.querySelector("img");
    if (!img) return;
    const titleEl = a.querySelector('[class*="title"]') || (a.parentElement && a.parentElement.querySelector('[class*="title"]'));
    const title = clean(a.getAttribute("title") || (titleEl && titleEl.textContent) || img.getAttribute("alt") || a.textContent);
    const cover = abs(img.getAttribute("data-origin-src") || img.getAttribute("data-src") || img.getAttribute("src") || "");
    const numEl = a.querySelector('[class*="photonumber"], [class*="number"]');
    const count = numEl ? parseInt(numEl.textContent, 10) || 0 : 0;
    const link = new URL(href, origin);
    link.search = "";
    link.searchParams.set("uid", "1");
    const prev = out.get(m[1]);
    if (!prev || (!prev.title && title)) out.set(m[1], { host, store, id: m[1], title, cover, count, link: link.href });
  });
  return [...out.values()];
}

function detectMaxPage(doc) {
  let max = 0;
  doc.querySelectorAll('a[href*="page="]').forEach((a) => {
    const m = (a.getAttribute("href") || "").match(/[?&]page=(\d+)/);
    if (m) max = Math.max(max, +m[1]);
  });
  doc.querySelectorAll('input[name="page"][max]').forEach((i) => { max = Math.max(max, parseInt(i.getAttribute("max"), 10) || 0); });
  const m = (doc.body ? doc.body.textContent : "").match(/共\s*(\d+)\s*页|of\s+(\d+)\s+pages?/i);
  if (m) max = Math.max(max, +(m[1] || m[2]));
  return max;
}

// ---------- Yupoo's photos ----------
// Yupoo only shows photos to its own pages, so requests from the add-on's pages (and its store
// reader) say they come from the store's site.
const OWN = browser.runtime.getURL("");
browser.webRequest.onBeforeSendHeaders.addListener((d) => {
  const from = d.originUrl || d.documentUrl || "";
  if (from.indexOf(OWN) !== 0) return {};
  let ref = "";
  const photo = d.url.match(/^https?:\/\/photo\.yupoo\.com\/([^/?#]+)\//i);
  if (photo) ref = "https://" + photo[1] + ".x.yupoo.com/";
  else { try { ref = new URL(d.url).origin + "/"; } catch (e) { return {}; } }
  const headers = d.requestHeaders.filter((h) => h.name.toLowerCase() !== "referer");
  headers.push({ name: "Referer", value: ref });
  return { requestHeaders: headers };
}, { urls: ["*://*.yupoo.com/*"] }, ["blocking", "requestHeaders"]);

// ---------- messages from the pages and from Yupoo tabs ----------
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object") return undefined;
  return ready.then(() => {
    try {
      switch (msg.type) {
        case "api": return { ok: true, data: handle(msg.method, msg.path, msg.body) };
        case "save": return saveAlbums(msg.albums);
        case "settings": return data.settings;
        case "crawl": return crawlAction(msg.act, msg.opts);
        case "openLibrary":
          if (sender.tab) return browser.tabs.update(sender.tab.id, { url: browser.runtime.getURL("library.html") }).then(() => true);
          return browser.tabs.create({ url: browser.runtime.getURL("library.html") }).then(() => true);
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
    return undefined;
  });
});

// The toolbar button opens the Library; the first install opens it too, as a welcome.
browser.browserAction.onClicked.addListener(() => browser.tabs.create({ url: browser.runtime.getURL("library.html") }));
browser.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") browser.tabs.create({ url: browser.runtime.getURL("library.html") });
});
