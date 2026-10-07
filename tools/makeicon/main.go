//go:build ignore

// makeicon makes rsrc_windows_amd64.syso, which Go builds into YupooLibrary.exe automatically:
//   - the app icon (from the .ico file)
//   - the program details Windows shows in Properties → Details (name, version, publisher).
//     Programs without these look suspicious to antivirus software, which can wrongly block them.
//   - a standard Windows manifest (runs as a normal user, made for Windows 10/11)
//
// build.bat (and the GitHub release workflow) run it before building:
//
//	go run tools/makeicon/main.go "Icon Yupoo.ico"
//
// The version comes from AppVersion in update.go, so it always matches the release.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

const (
	productName = "Yupoo Library"
	publisher   = "DanteRego"
	exeName     = "YupooLibrary.exe"
)

type iconImage struct {
	width, height, colors, reserved byte
	planes, bitCount                uint16
	data                            []byte
}

// resource is one item in the .exe's resource section.
type resource struct {
	typ, id uint32
	data    []byte
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
	version := readVersion()
	images := parseICO(b)

	const rtIcon, rtGroupIcon, rtVersion, rtManifest = 3, 14, 16, 24
	var res []resource
	var group bytes.Buffer
	le := binary.LittleEndian
	binary.Write(&group, le, []uint16{0, 1, uint16(len(images))})
	for i, im := range images {
		res = append(res, resource{rtIcon, uint32(i + 1), im.data})
		group.Write([]byte{im.width, im.height, im.colors, im.reserved})
		binary.Write(&group, le, im.planes)
		binary.Write(&group, le, im.bitCount)
		binary.Write(&group, le, uint32(len(im.data)))
		binary.Write(&group, le, uint16(i+1))
	}
	res = append(res, resource{rtGroupIcon, 1, group.Bytes()})
	res = append(res, resource{rtVersion, 1, versionInfo(version)})
	res = append(res, resource{rtManifest, 1, []byte(manifest(version))})

	if err := os.WriteFile(out, buildCOFF(res), 0o644); err != nil {
		fail("couldn't write %s: %v", out, err)
	}
	fmt.Printf("Resources: %s -> %s (icon with %d size(s), program details for version %s, manifest)\n", src, out, len(images), version)
}

func fail(f string, a ...interface{}) {
	fmt.Fprintf(os.Stderr, "makeicon: "+f+"\n", a...)
	os.Exit(1)
}

func readVersion() string {
	b, err := os.ReadFile("update.go")
	if err != nil {
		return "0.0.0"
	}
	m := regexp.MustCompile(`(?m)^const AppVersion = "([^"]+)"`).FindSubmatch(b)
	if m == nil {
		return "0.0.0"
	}
	return string(m[1])
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

// ---------- program details (VERSIONINFO) ----------

func utf16z(s string) []byte {
	var b bytes.Buffer
	for _, c := range utf16.Encode([]rune(s)) {
		binary.Write(&b, binary.LittleEndian, c)
	}
	b.Write([]byte{0, 0})
	return b.Bytes()
}

func pad4(b []byte) []byte {
	for len(b)%4 != 0 {
		b = append(b, 0)
	}
	return b
}

// vnode builds one block of the version information: header, key, value, then child blocks.
func vnode(key string, value []byte, valueLen, typ uint16, children ...[]byte) []byte {
	b := make([]byte, 6)
	b = append(b, utf16z(key)...)
	b = pad4(b)
	b = append(b, value...)
	for _, c := range children {
		b = pad4(b)
		b = append(b, c...)
	}
	binary.LittleEndian.PutUint16(b[0:], uint16(len(b)))
	binary.LittleEndian.PutUint16(b[2:], valueLen)
	binary.LittleEndian.PutUint16(b[4:], typ)
	return b
}

func versionInfo(version string) []byte {
	var parts [4]uint16
	for i, p := range strings.SplitN(version, ".", 4) {
		n, _ := strconv.Atoi(strings.TrimFunc(p, func(r rune) bool { return r < '0' || r > '9' }))
		parts[i] = uint16(n)
	}
	ms := uint32(parts[0])<<16 | uint32(parts[1])
	ls := uint32(parts[2])<<16 | uint32(parts[3])
	var fixed bytes.Buffer
	binary.Write(&fixed, binary.LittleEndian, []uint32{
		0xFEEF04BD, 0x00010000, // signature, structure version
		ms, ls, ms, ls, // file version, product version
		0x3F, 0, // flags mask, flags
		0x00040004, 1, 0, // Windows NT, application, no subtype
		0, 0, // date
	})
	str := func(k, v string) []byte {
		return vnode(k, utf16z(v), uint16(len(utf16.Encode([]rune(v)))+1), 1)
	}
	table := vnode("040904B0", nil, 0, 1,
		str("CompanyName", publisher),
		str("FileDescription", productName),
		str("FileVersion", version),
		str("InternalName", "YupooLibrary"),
		str("LegalCopyright", fmt.Sprintf("© %d %s", time.Now().Year(), publisher)),
		str("OriginalFilename", exeName),
		str("ProductName", productName),
		str("ProductVersion", version),
	)
	strings_ := vnode("StringFileInfo", nil, 0, 1, table)
	var trans bytes.Buffer
	binary.Write(&trans, binary.LittleEndian, []uint16{0x0409, 0x04B0}) // US English, Unicode
	vars := vnode("VarFileInfo", nil, 0, 1, vnode("Translation", trans.Bytes(), 4, 0))
	return vnode("VS_VERSION_INFO", fixed.Bytes(), uint16(fixed.Len()), 0, strings_, vars)
}

// ---------- manifest ----------

func manifest(version string) string {
	v := version
	if strings.Count(v, ".") < 3 {
		v += strings.Repeat(".0", 3-strings.Count(v, "."))
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="DanteRego.YupooLibrary" version="` + v + `" processorArchitecture="amd64"/>
  <description>` + productName + `</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application>
  </compatibility>
</assembly>
`
}

// ---------- the COFF object with a .rsrc section ----------

// buildCOFF writes a COFF object holding a .rsrc section: a directory tree (type → id → language)
// pointing at the resources' data.
func buildCOFF(res []resource) []byte {
	const lang = 0x0409
	le := binary.LittleEndian
	sort.Slice(res, func(i, j int) bool {
		if res[i].typ != res[j].typ {
			return res[i].typ < res[j].typ
		}
		return res[i].id < res[j].id
	})
	// Group by type, keeping the sorted order.
	var types []uint32
	byType := map[uint32][]int{}
	for i, r := range res {
		if _, ok := byType[r.typ]; !ok {
			types = append(types, r.typ)
		}
		byType[r.typ] = append(byType[r.typ], i)
	}
	dirSize := func(entries int) int { return 16 + 8*entries }

	// Layout: root dir, one dir per type, one dir per resource (with its language entry), data entries, data.
	rootOff := 0
	off := rootOff + dirSize(len(types))
	typeOff := map[uint32]int{}
	for _, t := range types {
		typeOff[t] = off
		off += dirSize(len(byType[t]))
	}
	nameOff := make([]int, len(res))
	for i := range res {
		nameOff[i] = off
		off += dirSize(1)
	}
	dataEntryOff := off
	off += 16 * len(res)

	sec := make([]byte, off)
	writeDir := func(at, entries int) { le.PutUint16(sec[at+14:], uint16(entries)) }
	writeEntry := func(at int, id uint32, target int, isDir bool) {
		le.PutUint32(sec[at:], id)
		v := uint32(target)
		if isDir {
			v |= 0x80000000
		}
		le.PutUint32(sec[at+4:], v)
	}
	writeDir(rootOff, len(types))
	for i, t := range types {
		writeEntry(rootOff+16+8*i, t, typeOff[t], true)
		writeDir(typeOff[t], len(byType[t]))
		for j, ri := range byType[t] {
			writeEntry(typeOff[t]+16+8*j, res[ri].id, nameOff[ri], true)
		}
	}
	for i := range res {
		writeDir(nameOff[i], 1)
		writeEntry(nameOff[i]+16, lang, dataEntryOff+16*i, false)
	}
	var relocs []uint32
	for i, r := range res {
		for len(sec)%8 != 0 {
			sec = append(sec, 0)
		}
		at := dataEntryOff + 16*i
		le.PutUint32(sec[at:], uint32(len(sec)))
		le.PutUint32(sec[at+4:], uint32(len(r.data)))
		relocs = append(relocs, uint32(at))
		sec = append(sec, r.data...)
	}
	for len(sec)%4 != 0 {
		sec = append(sec, 0)
	}

	const fileHdr, secHdr = 20, 40
	rawOff := fileHdr + secHdr
	relocOff := rawOff + len(sec)
	symOff := relocOff + 10*len(relocs)
	var o bytes.Buffer
	binary.Write(&o, le, uint16(0x8664)) // AMD64
	binary.Write(&o, le, uint16(1))
	binary.Write(&o, le, uint32(0))
	binary.Write(&o, le, uint32(symOff))
	binary.Write(&o, le, uint32(1))
	binary.Write(&o, le, uint16(0))
	binary.Write(&o, le, uint16(0))
	o.WriteString(".rsrc\x00\x00\x00")
	binary.Write(&o, le, []uint32{0, 0, uint32(len(sec)), uint32(rawOff), uint32(relocOff), 0})
	binary.Write(&o, le, uint16(len(relocs)))
	binary.Write(&o, le, uint16(0))
	binary.Write(&o, le, uint32(0x40000040)) // initialized data, readable
	o.Write(sec)
	for _, r := range relocs { // IMAGE_REL_AMD64_ADDR32NB against the section symbol
		binary.Write(&o, le, r)
		binary.Write(&o, le, uint32(0))
		binary.Write(&o, le, uint16(3))
	}
	o.WriteString(".rsrc\x00\x00\x00")
	binary.Write(&o, le, uint32(0))
	binary.Write(&o, le, int16(1))
	binary.Write(&o, le, uint16(0))
	o.Write([]byte{3, 0})
	binary.Write(&o, le, uint32(4))
	return o.Bytes()
}
