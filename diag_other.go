//go:build !windows

package main

import "runtime"

// Stand-ins for the Windows-only check-up details (Mac/Linux test mode).

func osVersion() string                           { return runtime.GOOS }
func diskFree(path string) (free uint64, ok bool) { return 0, false }
func userLocale() string                          { return "" }
func systemProxy() string                         { return "" }
