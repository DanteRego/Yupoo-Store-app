//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	proc := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	_, _, _ = proc.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}

func main() {
	app, err := StartApp()
	if err != nil {
		messageBox("Yupoo Library", "Yupoo Library couldn't start:\n\n"+err.Error())
		return
	}
	defer app.lib.Flush()

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(app.lib.dir, "browser"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Yupoo Library",
			Width:  1380,
			Height: 900,
			Center: true,
			IconId: 1, // the app icon from rsrc_windows_amd64.syso (made by tools/makeicon)
		},
	})
	if w == nil {
		messageBox("Yupoo Library",
			"Yupoo Library needs Microsoft Edge WebView2, which is built into Windows 10 and 11.\n\n"+
				"If you see this, install the free \"WebView2 Runtime\" from Microsoft's website and open Yupoo Library again.")
		return
	}
	defer w.Destroy()

	_ = w.Bind("kitSave", func(in []AlbumIn) (map[string]int, error) {
		added, total := app.lib.SaveAlbums(in)
		return map[string]int{"added": added, "total": total}, nil
	})
	_ = w.Bind("kitSettings", func() Settings { return app.lib.GetSettings() })
	_ = w.Bind("kitCrawl", func(act, pageURL, cookie, mode string, min bool) CrawlReply {
		return app.crawlAction(act, pageURL, cookie, mode, min)
	})
	// A store's password typed in Yupoo's own box (capture.js reads Yupoo's cookie), so the
	// "✨ New Additions" check can read that store too.
	_ = w.Bind("kitStorePassword", func(store, pw string) { go app.RememberTypedPassword(store, pw) })
	mainWindow = uintptr(w.Window())                                 // so the folder picker (Settings) opens on top of the app
	uiLang = func() string { return app.lib.GetSettings().Language } // update messages in your language
	updatedTo = func() string { return app.lib.GetSettings().UpdatedTo }
	markUpdated = app.lib.SetUpdatedTo
	// The Library's "Check for updates" button.
	_ = w.Bind("kitCheckUpdate", func() { go offerUpdate(w, true) })
	w.Init(bridgeJS(app.baseURL) + crawlbarJS + captureJS)
	go CleanupOldVersion()   // removes the previous program left behind by an update
	go offerUpdate(w, false) // checks GitHub for a newer version (see update.go)
	w.Navigate(app.baseURL)
	w.Run()

	// After "Update now": close everything, save, then start the new version.
	if relaunchPath != "" {
		w.Destroy()
		_ = app.lib.Flush()
		_ = exec.Command(relaunchPath).Start()
		os.Exit(0)
	}
}
