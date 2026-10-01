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
// kitSave / kitSettings / kitCrawl are provided by the app window (see main_windows.go).
func bridgeJS(libraryURL string) string {
	u, _ := json.Marshal(libraryURL)
	return `window.__kitBridge = {
  libraryUrl: ` + string(u) + `,
  save: function (albums) { return window.kitSave(albums); },
  settings: function () { return window.kitSettings(); },
  crawl: function (act, opts) {
    opts = opts || {};
    return window.kitCrawl(act, opts.url || "", opts.cookie || "", opts.mode || "", !!opts.min);
  }
};
`
}
