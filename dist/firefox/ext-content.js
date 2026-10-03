// Yupoo Library — Firefox add-on: runs first on Yupoo store pages, before crawlbar.js and capture.js.
// It gives them the same "bridge" the Windows app provides, but talking to the add-on.
"use strict";

window.__kitBridge = {
  inBrowser: true,
  libraryUrl: browser.runtime.getURL("library.html"),
  save: (albums) => browser.runtime.sendMessage({ type: "save", albums }),
  settings: () => browser.runtime.sendMessage({ type: "settings" }),
  crawl: (act, opts) => browser.runtime.sendMessage({ type: "crawl", act, opts: opts || {} }),
  // The green bar's "Library" button: show the Library in this tab.
  openLibrary: () => browser.runtime.sendMessage({ type: "openLibrary" })
};
