// Yupoo Library — Firefox add-on: loaded first on the add-on's own pages (Library, Catalog).
// The shared page code (web/shared.js) sees YL_EXT and talks to the add-on's background script
// instead of the Windows app's server. Files (CSV, backups) are saved through Firefox's downloads.
"use strict";

(() => {
  async function send(method, path, body) {
    const r = await browser.runtime.sendMessage({ type: "api", method, path, body });
    if (!r) throw new Error("The add-on didn't answer. Try reloading the page.");
    if (!r.ok) throw new Error(r.error || "Something went wrong");
    return r.data;
  }

  // Saves text as a file in your Downloads folder.
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // A backup is either the add-on's own .json file, or a .zip from the Windows app
  // (only its library.json is used; the add-on shows photos straight from Yupoo).
  async function readBackup(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return JSON.parse(await unzipFile(bytes, "library.json"));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // A small .zip reader: finds one file and unpacks it.
  async function unzipFile(b, wanted) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error("That .zip file looks damaged.");
    const count = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
      if (name === wanted) {
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const raw = b.subarray(start, start + size);
        if (method === 0) return new TextDecoder().decode(raw);
        if (method !== 8) throw new Error("This backup uses a kind of .zip the add-on can't open.");
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error("That file isn't a Yupoo Library backup.");
  }

  const today = () => new Date().toISOString().slice(0, 10);

  window.YL_EXT = {
    pages: { library: "library.html", catalog: "catalog.html" },
    async call(method, path, body) {
      if (path === "/api/save-file") {
        download(body.name, body.content, "text/csv;charset=utf-8");
        return { path: "your Downloads folder" };
      }
      if (path === "/api/backup") {
        const d = await send("GET", "/api/backup-data");
        download(`yupoo-library-backup-${today()}.json`, JSON.stringify(d), "application/json");
        return { path: "your Downloads folder" };
      }
      if (path === "/api/restore") return send("POST", "/api/restore", await readBackup(body));
      return send(method, path, body);
    }
  };

  // "Save whole store" progress (crawlbar.js) and the add-on's Library address.
  window.__kitBridge = {
    inBrowser: true,
    libraryUrl: browser.runtime.getURL("library.html"),
    settings: () => send("GET", "/api/state").then((s) => s.settings),
    crawl: (act, opts) => browser.runtime.sendMessage({ type: "crawl", act, opts: opts || {} })
  };
})();
