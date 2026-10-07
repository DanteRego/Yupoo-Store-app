//go:build windows

package main

import "golang.org/x/sys/windows"

// systemDownloads asks Windows where your Downloads folder really is (it can be moved,
// e.g. to J:\Downloads), so CSVs, backups and shared collections land where you expect.
func systemDownloads() string {
	p, err := windows.KnownFolderPath(windows.FOLDERID_Downloads, 0)
	if err != nil {
		return ""
	}
	return p
}
