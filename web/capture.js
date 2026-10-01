// Yupoo Library app — runs on every Yupoo store page opened inside the app and saves the items it sees.
(() => {
  if (!/\.x\.yupoo\.com$/i.test(location.hostname)) return;
  if (window.top !== window) return;

  const start = () => {
    if (window.__kitLibraryCapture) return;
    window.__kitLibraryCapture = true;

    const bridge = window.__kitBridge;
    const HOST = location.hostname;
    const STORE = HOST.split(".")[0];

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const absUrl = (u) => {
      if (!u || u.startsWith("data:")) return "";
      if (u.startsWith("//")) return location.protocol + u;
      try { return new URL(u, location.origin).href; } catch (e) { return ""; }
    };
    const albumLink = (href) => {
      const link = new URL(href, location.origin);
      link.search = "";
      link.searchParams.set("uid", "1");
      return link.href;
    };

    // Keep everything inside the app window (Yupoo opens albums in new tabs).
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented) return;
      const t = (a.getAttribute("target") || "").toLowerCase();
      if (t && t !== "_self") {
        e.preventDefault();
        location.href = a.href;
      }
    }, true);
    const nativeOpen = window.open;
    window.open = function (url) {
      if (url) { location.href = new URL(url, location.href).href; return null; }
      return nativeOpen.apply(window, arguments);
    };

    // ---------- reading albums from a page ----------
    function extractAlbums(doc) {
      const out = new Map();
      doc.querySelectorAll('a[href*="/albums/"]').forEach((a) => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/albums\/(\d+)/);
        if (!m) return;
        const img = a.querySelector("img");
        if (!img) return;
        const id = m[1];
        const titleEl = a.querySelector('[class*="title"]') ||
          (a.parentElement && a.parentElement.querySelector('[class*="title"]'));
        const title = clean(a.getAttribute("title") || (titleEl && titleEl.textContent) ||
          img.getAttribute("alt") || a.textContent);
        const cover = absUrl(img.getAttribute("data-origin-src") || img.getAttribute("data-src") ||
          img.getAttribute("src") || "");
        const numEl = a.querySelector('[class*="photonumber"], [class*="number"]');
        const count = numEl ? parseInt(numEl.textContent, 10) || 0 : 0;
        const prev = out.get(id);
        if (!prev || (!prev.title && title)) out.set(id, { id, title, cover, count, link: albumLink(href) });
      });
      return [...out.values()];
    }

    function extractCurrentAlbum() {
      const m = location.pathname.match(/^\/albums\/(\d+)/);
      if (!m) return null;
      const titleEl = document.querySelector('[class*="gallerytitle"], [class*="albumtitle"], [class*="album__title"], h1');
      const title = clean((titleEl && titleEl.textContent) || document.title.split(/\s[|\-–]\s/)[0]);
      const imgs = [...document.querySelectorAll("img[data-origin-src], img[data-src]")];
      const first = imgs[0] || document.querySelector("main img, img");
      const cover = first ? absUrl(first.getAttribute("data-origin-src") || first.getAttribute("data-src") || first.getAttribute("src")) : "";
      if (!title) return null;
      return { id: m[1], title, cover, count: imgs.length || 0, link: albumLink(location.pathname) };
    }

    // ---------- saving ----------
    let settings = { autoSave: true };
    const sentThisPage = new Set();
    let savedThisPage = 0;

    async function save(albums, force) {
      const fresh = albums.filter((a) => force || !sentThisPage.has(a.id));
      if (!fresh.length) return { added: 0 };
      fresh.forEach((a) => sentThisPage.add(a.id));
      const res = await bridge.save(fresh.map((a) => Object.assign({ host: HOST, store: STORE }, a)));
      return res || { added: 0 };
    }

    async function captureThisPage(force) {
      const found = extractAlbums(document);
      const current = extractCurrentAlbum();
      if (current) found.push(current);
      if (!found.length) return;
      const before = sentThisPage.size;
      await save(found, force);
      savedThisPage += force ? found.length : sentThisPage.size - before;
      renderPill();
    }

    // ---------- save the whole store ----------
    let crawling = false, stopCrawl = false, crawlMsg = "";

    function pageUrl(n) {
      const keepPath = /^\/(categories|search)/.test(location.pathname);
      const u = keepPath ? new URL(location.href) : new URL("/albums", location.origin);
      u.hash = "";
      u.searchParams.set("page", n);
      return u.href;
    }
    function detectMaxPage(doc) {
      let max = 0;
      doc.querySelectorAll('a[href*="page="]').forEach((a) => {
        const m = (a.getAttribute("href") || "").match(/[?&]page=(\d+)/);
        if (m) max = Math.max(max, +m[1]);
      });
      doc.querySelectorAll('input[name="page"][max]').forEach((i) => {
        max = Math.max(max, parseInt(i.getAttribute("max"), 10) || 0);
      });
      const m = (doc.body ? doc.body.textContent : "").match(/共\s*(\d+)\s*页|of\s+(\d+)\s+pages?/i);
      if (m) max = Math.max(max, +(m[1] || m[2]));
      return max || null;
    }

    async function saveWholeStore() {
      if (crawling) { stopCrawl = true; return; }
      crawling = true; stopCrawl = false;
      let page = 1, maxPage = null, prevSig = "", newCount = 0, seen = 0;
      while (true) {
        if (stopCrawl) { crawlMsg = `Stopped — ${newCount} new items saved.`; break; }
        crawlMsg = `Saving page ${page}${maxPage ? " of " + maxPage : ""}… ${newCount} new`;
        renderPill();
        let doc;
        try {
          const res = await fetch(pageUrl(page), { credentials: "include" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          doc = new DOMParser().parseFromString(await res.text(), "text/html");
        } catch (e) {
          crawlMsg = `Yupoo stopped answering on page ${page}. Wait a minute, then try again — saved items are kept.`;
          break;
        }
        if (page === 1) maxPage = detectMaxPage(doc);
        const found = extractAlbums(doc);
        const sig = found.map((a) => a.id).join(",");
        if (!found.length || sig === prevSig) { crawlMsg = `Done — ${seen} items in this store, ${newCount} new.`; break; }
        const res = await save(found, true);
        newCount += res.added || 0;
        seen += found.length;
        if (maxPage && page >= maxPage) { crawlMsg = `Done — ${seen} items in this store, ${newCount} new.`; break; }
        if (page >= 500) break;
        prevSig = sig;
        page++;
        await sleep(1500 + Math.random() * 1000); // go slowly so Yupoo doesn't throttle
      }
      crawling = false;
      renderPill();
    }

    // ---------- the bar at the bottom ----------
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483646;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Segoe UI", -apple-system, Roboto, Arial, "Microsoft YaHei", "PingFang SC", sans-serif; }
      .pill { display: flex; align-items: center; gap: 8px; background: #1f7a4d; color: #fff; padding: 8px;
        border-radius: 999px; box-shadow: 0 4px 18px rgba(0,0,0,.28); font-size: 13px; white-space: nowrap; }
      .msg { margin: 0 6px; }
      button { cursor: pointer; border: 0; border-radius: 999px; padding: 7px 13px; font-size: 13px;
        background: rgba(255,255,255,.18); color: #fff; font-family: inherit; }
      button:hover { background: rgba(255,255,255,.3); }
      button.main { background: #fff; color: #1f7a4d; font-weight: 600; }
    </style><div class="pill">
      <button data-act="back" title="Back">◀ Back</button>
      <span class="msg"></span>
      <button data-act="page" hidden>Save this page</button>
      <button data-act="store">Save whole store</button>
      <button data-act="open" class="main">Library</button></div>`;
    const $ = (s) => shadow.querySelector(s);

    function renderPill() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      let msg;
      if (crawling || crawlMsg) msg = crawlMsg;
      else if (!settings.autoSave) msg = "Auto-save is off";
      else msg = savedThisPage ? `✓ ${savedThisPage} item${savedThisPage === 1 ? "" : "s"} saved from this page` : "Yupoo Library";
      $(".msg").textContent = msg;
      $('[data-act="store"]').textContent = crawling ? "Stop" : "Save whole store";
      $('[data-act="page"]').hidden = settings.autoSave;
    }

    shadow.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "back") history.back();
      else if (act === "open") location.href = bridge.libraryUrl;
      else if (act === "store") saveWholeStore();
      else if (act === "page") captureThisPage(true);
    });

    let moTimer = null;
    (async () => {
      try { settings = Object.assign({ autoSave: true }, await bridge.settings()); } catch (e) {}
      if (settings.autoSave) await captureThisPage(false);
      renderPill();
      new MutationObserver(() => {
        if (!settings.autoSave) return;
        clearTimeout(moTimer);
        moTimer = setTimeout(() => captureThisPage(false), 1500);
      }).observe(document.body, { childList: true, subtree: true });
    })();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
