//go:build !windows

package main

import "errors"

const canPickFolders = false

func pickFolder(title string) (string, error) {
	return "", errors.New("choosing a folder this way only works in the Windows app — type the path instead")
}

func openFolder(dir string) error { return errors.New("only available in the Windows app") }
