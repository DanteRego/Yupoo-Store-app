package main

import (
	_ "embed"
	"encoding/json"
	"time"
)

//go:embed web/capture.js
var captureJS string

//go:embed web/crawlbar.js
var crawlbarJS string

func todayStamp() string { return time.Now().Format("2006-01-02") }

// bridgeJS connects pages in the app's browser window to the app itself.
// kitSave / kitSettings / kitCrawl / kitCheckUpdate / kitStorePassword are provided by the app window (see main_windows.go).
func bridgeJS(libraryURL string) string {
	u, _ := json.Marshal(libraryURL)
	return `window.__kitBridge = {
  libraryUrl: ` + string(u) + `,
  save: function (albums) { return window.kitSave(albums); },
  settings: function () { return window.kitSettings(); },
  checkUpdate: function () { return window.kitCheckUpdate(); },
  storePassword: function (store, pw) { return window.kitStorePassword(store, pw); },
  crawl: function (act, opts) {
    opts = opts || {};
    return window.kitCrawl(act, opts.url || "", opts.cookie || "", opts.mode || "", !!opts.min);
  }
};
`
}
