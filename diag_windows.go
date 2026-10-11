//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Windows details for the check-up's technical section: Windows version, free disk space, the
// user's language and the system proxy (the built-in browser uses it; the app's own downloads don't).

func osVersion() string {
	type osVersionInfo struct {
		size, major, minor, build, platform uint32
		csd                                 [128]uint16
	}
	v := osVersionInfo{size: uint32(unsafe.Sizeof(osVersionInfo{}))}
	proc := syscall.NewLazyDLL("ntdll.dll").NewProc("RtlGetVersion")
	if proc.Find() != nil {
		return "Windows (version unknown)"
	}
	_, _, _ = proc.Call(uintptr(unsafe.Pointer(&v)))
	name := "Windows 10"
	if v.major == 10 && v.build >= 22000 {
		name = "Windows 11"
	} else if v.major < 10 {
		name = fmt.Sprintf("Windows %d.%d", v.major, v.minor)
	}
	return fmt.Sprintf("%s (build %d)", name, v.build)
}

// diskFree is the free space on the drive that holds path.
func diskFree(path string) (free uint64, ok bool) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, false
	}
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), 0, 0)
	return free, r != 0
}

func userLocale() string {
	buf := make([]uint16, 85)
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultLocaleName")
	if r, _, _ := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// systemProxy is the proxy set in Windows' Internet settings ("" = none).
func systemProxy() string {
	var k syscall.Handle
	path, _ := syscall.UTF16PtrFromString(`Software\Microsoft\Windows\CurrentVersion\Internet Settings`)
	if syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, path, 0, syscall.KEY_READ, &k) != nil {
		return ""
	}
	defer syscall.RegCloseKey(k)
	readDword := func(name string) uint32 {
		n, _ := syscall.UTF16PtrFromString(name)
		var v, typ uint32
		size := uint32(4)
		if syscall.RegQueryValueEx(k, n, nil, &typ, (*byte)(unsafe.Pointer(&v)), &size) != nil {
			return 0
		}
		return v
	}
	readString := func(name string) string {
		n, _ := syscall.UTF16PtrFromString(name)
		buf := make([]uint16, 512)
		var typ uint32
		size := uint32(len(buf) * 2)
		if syscall.RegQueryValueEx(k, n, nil, &typ, (*byte)(unsafe.Pointer(&buf[0])), &size) != nil {
			return ""
		}
		return syscall.UTF16ToString(buf)
	}
	auto := readString("AutoConfigURL")
	if readDword("ProxyEnable") == 1 {
		return readString("ProxyServer")
	}
	if auto != "" {
		return "automatic script " + auto
	}
	return ""
}
