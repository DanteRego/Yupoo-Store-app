//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

// relaunchPath is set after a successful update: main() starts it once this window has closed.
var relaunchPath string

// offerUpdate runs once, a few seconds after the app opens: if GitHub has a newer version,
// it asks whether to update, and if you say yes, downloads it, swaps it in and restarts.
// No answer is remembered: you're asked again the next time you open the app.
func offerUpdate(w webview2.WebView) {
	time.Sleep(3 * time.Second) // let the Library appear first
	rel, err := CheckForUpdate()
	if err != nil || rel == nil {
		return // offline, GitHub busy, or already up to date: say nothing
	}
	if !askYesNo(w, "Update available — Yupoo Library", updateMessage(rel)) {
		return
	}
	if rel.ExeURL == "" {
		openInBrowser(rel.PageURL)
		return
	}
	exe, err := os.Executable()
	if err == nil {
		if p, e := filepath.EvalSymlinks(exe); e == nil {
			exe = p
		}
		err = InstallUpdate(rel, exe)
	}
	if err != nil {
		showOnWindow(w, "Yupoo Library couldn't update",
			"The update didn't work, so nothing was changed — this version keeps working as before.\n\n"+
				"("+err.Error()+")\n\nYou can also download the new version yourself from:\n"+rel.PageURL, 0x30)
		return
	}
	// Close this window; main() then saves anything not written yet and starts the new version.
	relaunchPath = exe
	w.Dispatch(func() { w.Terminate() })
}

const (
	mbYesNo         = 0x04
	mbIconQuestion  = 0x20
	mbSetForeground = 0x10000
	idYes           = 6
)

// askYesNo shows a Yes/No box on top of the app window and waits for the answer.
func askYesNo(w webview2.WebView, title, text string) bool {
	answer := make(chan uintptr, 1)
	w.Dispatch(func() {
		answer <- messageBoxOn(uintptr(w.Window()), title, text, mbYesNo|mbIconQuestion|mbSetForeground)
	})
	return <-answer == idYes
}

func showOnWindow(w webview2.WebView, title, text string, icon uintptr) {
	done := make(chan struct{})
	w.Dispatch(func() {
		messageBoxOn(uintptr(w.Window()), title, text, icon|mbSetForeground)
		close(done)
	})
	<-done
}

func messageBoxOn(owner uintptr, title, text string, flags uintptr) uintptr {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	r, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(owner, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return r
}

func openInBrowser(url string) {
	verb, _ := syscall.UTF16PtrFromString("open")
	u, _ := syscall.UTF16PtrFromString(url)
	_, _, _ = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(u)), 0, 0, 1)
}
