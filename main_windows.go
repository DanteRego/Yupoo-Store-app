//go:build windows

package main

import (
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
	w.Init(bridgeJS(app.baseURL) + captureJS)
	w.Navigate(app.baseURL)
	w.Run()
}
