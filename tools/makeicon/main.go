//go:build ignore

// makeicon turns an .ico file into rsrc_windows_amd64.syso, which Go builds into
// YupooLibrary.exe automatically, so the app keeps its icon every time it is rebuilt.
// build.bat runs it before building:  go run tools/makeicon/main.go "Icon Yupoo.ico"
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
)

type iconImage struct {
	width, height, colors, reserved byte
	planes, bitCount                uint16
	data                            []byte
}

func main() {
	src := "Icon Yupoo.ico"
	if len(os.Args) > 1 {
		src = os.Args[1]
	}
	out := "rsrc_windows_amd64.syso"
	b, err := os.ReadFile(src)
	if err != nil {
		fail("couldn't read the icon: %v", err)
	}
	images := parseICO(b)
	if err := os.WriteFile(out, buildCOFF(images), 0o644); err != nil {
		fail("couldn't write %s: %v", out, err)
	}
	fmt.Printf("Icon: %s -> %s (%d size(s))\n", src, out, len(images))
}

func fail(f string, a ...interface{}) {
	fmt.Fprintf(os.Stderr, "makeicon: "+f+"\n", a...)
	os.Exit(1)
}

func parseICO(b []byte) []iconImage {
	le := binary.LittleEndian
	if len(b) < 6 || le.Uint16(b[2:]) != 1 {
		fail("that file isn't an .ico icon")
	}
	n := int(le.Uint16(b[4:]))
	var imgs []iconImage
	for i := 0; i < n; i++ {
		e := b[6+16*i:]
		size, off := le.Uint32(e[8:]), le.Uint32(e[12:])
		if int(off+size) > len(b) {
			fail("the icon file looks damaged")
		}
		imgs = append(imgs, iconImage{e[0], e[1], e[2], e[3], le.Uint16(e[4:]), le.Uint16(e[6:]), b[off : off+size]})
	}
	if len(imgs) == 0 {
		fail("the icon file has no pictures in it")
	}
	return imgs
}

// buildCOFF writes a COFF object holding a .rsrc section with RT_ICON and RT_GROUP_ICON resources.
func buildCOFF(imgs []iconImage) []byte {
	const (
		rtIcon      = 3
		rtGroupIcon = 14
		lang        = 0x0409
	)
	le := binary.LittleEndian
	n := len(imgs)

	// The group entry that tells Windows which pictures make up the icon.
	var group bytes.Buffer
	binary.Write(&group, le, []uint16{0, 1, uint16(n)})
	for i, im := range imgs {
		group.Write([]byte{im.width, im.height, im.colors, im.reserved})
		binary.Write(&group, le, im.planes)
		binary.Write(&group, le, im.bitCount)
		binary.Write(&group, le, uint32(len(im.data)))
		binary.Write(&group, le, uint16(i+1))
	}

	// Layout: root dir, type dirs, name dirs (each with one language entry), data entries, then the data.
	dirSize := func(entries int) int { return 16 + 8*entries }
	rootOff := 0
	iconTypeOff := rootOff + dirSize(2)
	groupTypeOff := iconTypeOff + dirSize(n)
	nameOff := groupTypeOff + dirSize(1) // n icon name dirs, then 1 group name dir
	dataEntryOff := nameOff + (n+1)*dirSize(1)
	blobOff := dataEntryOff + (n+1)*16
	blobs := make([][]byte, 0, n+1)
	for _, im := range imgs {
		blobs = append(blobs, im.data)
	}
	blobs = append(blobs, group.Bytes())

	sec := make([]byte, blobOff)
	writeDir := func(at, entries int) {
		le.PutUint16(sec[at+14:], uint16(entries)) // all entries use numeric IDs
	}
	writeEntry := func(at int, id uint32, target int, isDir bool) {
		le.PutUint32(sec[at:], id)
		v := uint32(target)
		if isDir {
			v |= 0x80000000
		}
		le.PutUint32(sec[at+4:], v)
	}
	writeDir(rootOff, 2)
	writeEntry(rootOff+16, rtIcon, iconTypeOff, true)
	writeEntry(rootOff+24, rtGroupIcon, groupTypeOff, true)
	writeDir(iconTypeOff, n)
	for i := 0; i < n; i++ {
		writeEntry(iconTypeOff+16+8*i, uint32(i+1), nameOff+i*dirSize(1), true)
	}
	writeDir(groupTypeOff, 1)
	writeEntry(groupTypeOff+16, 1, nameOff+n*dirSize(1), true)
	for i := 0; i <= n; i++ {
		at := nameOff + i*dirSize(1)
		writeDir(at, 1)
		writeEntry(at+16, lang, dataEntryOff+16*i, false)
	}

	// Data entries point at the data (fixed up by the linker through relocations) and the data itself.
	var relocs []uint32
	for i, blob := range blobs {
		for len(sec)%8 != 0 {
			sec = append(sec, 0)
		}
		at := dataEntryOff + 16*i
		le.PutUint32(sec[at:], uint32(len(sec)))
		le.PutUint32(sec[at+4:], uint32(len(blob)))
		relocs = append(relocs, uint32(at))
		sec = append(sec, blob...)
	}
	for len(sec)%4 != 0 {
		sec = append(sec, 0)
	}

	const fileHdr, secHdr = 20, 40
	rawOff := fileHdr + secHdr
	relocOff := rawOff + len(sec)
	symOff := relocOff + 10*len(relocs)

	var o bytes.Buffer
	// File header (AMD64).
	binary.Write(&o, le, uint16(0x8664))
	binary.Write(&o, le, uint16(1))
	binary.Write(&o, le, uint32(0))
	binary.Write(&o, le, uint32(symOff))
	binary.Write(&o, le, uint32(1))
	binary.Write(&o, le, uint16(0))
	binary.Write(&o, le, uint16(0))
	// Section header.
	o.WriteString(".rsrc\x00\x00\x00")
	binary.Write(&o, le, []uint32{0, 0, uint32(len(sec)), uint32(rawOff), uint32(relocOff), 0})
	binary.Write(&o, le, uint16(len(relocs)))
	binary.Write(&o, le, uint16(0))
	binary.Write(&o, le, uint32(0x40000040)) // initialized data, readable
	o.Write(sec)
	// Relocations: IMAGE_REL_AMD64_ADDR32NB against the section symbol.
	for _, r := range relocs {
		binary.Write(&o, le, r)
		binary.Write(&o, le, uint32(0))
		binary.Write(&o, le, uint16(3))
	}
	// Symbol table: the .rsrc section symbol, then an empty string table.
	o.WriteString(".rsrc\x00\x00\x00")
	binary.Write(&o, le, uint32(0))
	binary.Write(&o, le, int16(1))
	binary.Write(&o, le, uint16(0))
	o.Write([]byte{3, 0})
	binary.Write(&o, le, uint32(4))
	return o.Bytes()
}
