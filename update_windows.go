//go:build windows

package main

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

// relaunchPath is set after a successful update: main() starts it once this window has closed.
var relaunchPath string

// updateBusy stops two checks (start-up and the button) from running at the same time.
var updateBusy atomic.Bool

// offerUpdate checks GitHub for a newer version; if there is one, it asks whether to update,
// and if you say yes, downloads it, swaps it in and restarts.
// It runs a few seconds after the app opens (manual=false: says nothing unless there's an update),
// and when you click "Check for updates" (manual=true: always answers).
// No answer is remembered: you're asked again the next time you open the app.
func offerUpdate(w webview2.WebView, manual bool) {
	if !updateBusy.CompareAndSwap(false, true) {
		return
	}
	defer updateBusy.Store(false)
	if !manual {
		time.Sleep(3 * time.Second) // let the Library appear first
	}
	rel, err := CheckForUpdate()
	if err != nil {
		if manual {
			showOnWindow(w, "Yupoo Library", tr("Couldn't check for updates right now — maybe there's no internet connection, or GitHub is busy. Try again in a minute.", "现在无法检查更新——可能没有网络，或者 GitHub 太忙。请过一分钟再试。")+
				"\n\n("+err.Error()+")", 0x30)
		}
		return
	}
	if rel == nil {
		if manual {
			showOnWindow(w, "Yupoo Library", tr("You're on the latest version ("+AppVersion+").", "你已经是最新版本（"+AppVersion+"）。"), 0x40)
		}
		return
	}
	if !askYesNo(w, tr("Update available — Yupoo Library", "有可用更新 — Yupoo Library"), updateMessage(rel)) {
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
		showOnWindow(w, tr("Yupoo Library couldn't update", "Yupoo Library 无法更新"),
			tr("The update didn't work, so nothing was changed — this version keeps working as before.",
				"更新没有成功，所以什么都没有改变——当前版本照常可用。")+
				"\n\n("+err.Error()+")\n\n"+tr("You can also download the new version yourself from:", "你也可以自己从这里下载新版本：")+"\n"+rel.PageURL, 0x30)
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
