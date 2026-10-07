//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"unsafe"
)

// mainWindow is the app window, so the folder picker opens on top of it (set in main_windows.go).
var mainWindow uintptr

const canPickFolders = true

// pickFolder shows Windows' "Browse for folder" box. It returns "" if you cancel.
func pickFolder(title string) (string, error) {
	type result struct {
		path string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		// The folder box needs its own thread set up for Windows' COM.
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		ole32 := syscall.NewLazyDLL("ole32.dll")
		ole32.NewProc("OleInitialize").Call(0)
		defer ole32.NewProc("OleUninitialize").Call()

		shell32 := syscall.NewLazyDLL("shell32.dll")
		display := make([]uint16, syscall.MAX_PATH)
		t, _ := syscall.UTF16PtrFromString(title)
		bi := struct {
			owner       uintptr
			root        uintptr
			displayName *uint16
			title       *uint16
			flags       uint32
			callback    uintptr
			lParam      uintptr
			image       int32
		}{owner: mainWindow, displayName: &display[0], title: t,
			flags: 0x0001 | 0x0010 | 0x0040} // only folders | edit box | new-style dialog
		pidl, _, _ := shell32.NewProc("SHBrowseForFolderW").Call(uintptr(unsafe.Pointer(&bi)))
		if pidl == 0 {
			ch <- result{}
			return
		}
		defer ole32.NewProc("CoTaskMemFree").Call(pidl)
		buf := make([]uint16, 32768)
		ok, _, _ := shell32.NewProc("SHGetPathFromIDListEx").Call(pidl, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0)
		if ok == 0 {
			ch <- result{err: errors.New("that place isn't a normal folder — please pick a folder on a drive")}
			return
		}
		ch <- result{path: syscall.UTF16ToString(buf)}
	}()
	r := <-ch
	return r.path, r.err
}

// openFolder shows a folder in File Explorer.
func openFolder(dir string) error {
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return errors.New("that folder doesn't exist yet")
	}
	return exec.Command("explorer.exe", dir).Start()
}
