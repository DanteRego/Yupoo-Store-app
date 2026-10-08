package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AppVersion is this build's version. When publishing an update, raise it here, build,
// and make a GitHub release with the same tag (e.g. v1.0.1) — see HOW-TO-TWEAK.txt.
const AppVersion = "2.0.0"

// updateRepo is the GitHub project the app checks for new versions on start-up.
const updateRepo = "DanteRego/Yupoo-Store-app"

// Release is a newer version found on GitHub.
type Release struct {
	Version string // e.g. "1.0.1"
	Notes   string // the release's description ("what's new")
	PageURL string // the release page on github.com
	ExeURL  string // the YupooLibrary.exe attached to the release ("" if none)
	ExeSize int64
}

func updateAPI() string {
	if u := os.Getenv("KIT_UPDATE_API"); u != "" { // used only for testing
		return u
	}
	return "https://api.github.com/repos/" + updateRepo + "/releases/latest"
}

// CheckForUpdate asks GitHub for the latest release. It returns nil (and no error) when this
// copy is already up to date or the project has no releases yet.
func CheckForUpdate() (*Release, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", updateAPI(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "YupooLibrary/"+AppVersion)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, nil // no releases published yet
	}
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("GitHub answered " + res.Status)
	}
	var r struct {
		TagName    string `json:"tag_name"`
		Body       string `json:"body"`
		HTMLURL    string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name string `json:"name"`
			Size int64  `json:"size"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&r); err != nil {
		return nil, err
	}
	if r.Draft || r.Prerelease || !isNewer(r.TagName, AppVersion) {
		return nil, nil
	}
	rel := &Release{Version: strings.TrimPrefix(strings.TrimSpace(r.TagName), "v"), Notes: strings.TrimSpace(r.Body), PageURL: r.HTMLURL}
	// Prefer an asset called YupooLibrary.exe; otherwise any .exe.
	for _, a := range r.Assets {
		if strings.EqualFold(a.Name, "YupooLibrary.exe") {
			rel.ExeURL, rel.ExeSize = a.URL, a.Size
			break
		}
		if rel.ExeURL == "" && strings.HasSuffix(strings.ToLower(a.Name), ".exe") {
			rel.ExeURL, rel.ExeSize = a.URL, a.Size
		}
	}
	return rel, nil
}

// isNewer says whether a release tag like "v1.2.0" is newer than the current version "1.1.9".
func isNewer(tag, current string) bool {
	a, b := versionParts(tag), versionParts(current)
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

func versionParts(v string) [3]int {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(strings.ToLower(v)), "v")
	for i, p := range strings.SplitN(v, ".", 3) {
		n := 0
		for _, ch := range p { // "3-beta" -> 3
			if ch < '0' || ch > '9' {
				break
			}
			n = n*10 + int(ch-'0')
		}
		out[i] = n
	}
	return out
}

// InstallUpdate downloads the new program and puts it in place of exePath. Only the program
// file is replaced: the library, collections, photos and settings live in %APPDATA%\YupooLibrary
// (and the thumbnails folder) and are never touched. The old program is kept as "<exe>.old"
// until the new one has started, so a failed update leaves the old one working.
func InstallUpdate(rel *Release, exePath string) error {
	if rel.ExeURL == "" {
		return errors.New("this release has no YupooLibrary.exe attached")
	}
	newPath, oldPath := exePath+".new", exePath+".old"
	_ = os.Remove(newPath)
	if err := download(rel.ExeURL, newPath, rel.ExeSize); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	_ = os.Remove(oldPath)
	// Windows lets a running program be renamed (but not overwritten), so: current -> .old, new -> current.
	if err := os.Rename(exePath, oldPath); err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("couldn't replace the program (is the folder read-only?): %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		_ = os.Rename(oldPath, exePath) // put the old one back
		_ = os.Remove(newPath)
		return err
	}
	return nil
}

func download(url, dest string, wantSize int64) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "YupooLibrary/"+AppVersion)
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errors.New("download failed: " + res.Status)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	n, err := io.Copy(f, io.LimitReader(res.Body, 500<<20))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if wantSize > 0 && n != wantSize {
		return fmt.Errorf("the download was incomplete (%d of %d bytes)", n, wantSize)
	}
	// A Windows program always starts with "MZ"; anything else isn't the app.
	head := make([]byte, 2)
	if f, err := os.Open(dest); err == nil {
		_, _ = io.ReadFull(f, head)
		f.Close()
	}
	if string(head) != "MZ" {
		return errors.New("the downloaded file isn't a Windows program")
	}
	return nil
}

// CleanupOldVersion removes the previous program left behind by an update. It retries for a
// little while, because the old copy may still be closing when the new one starts.
func CleanupOldVersion() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	_ = os.Remove(exe + ".new")
	for i := 0; i < 20; i++ {
		err := os.Remove(exe + ".old")
		if err == nil || os.IsNotExist(err) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// updateMessage is the question shown when a new version is found.

func trimNotes(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\r\n", "\n")
	if r := []rune(s); len(r) > 600 {
		s = string(r[:600]) + "…"
	}
	return s
}

// uiLang returns the app's language ("en" or "zh"); main_windows.go points it at your settings.
var uiLang = func() string { return "en" }

// updatedTo / markUpdated read and save Settings.UpdatedTo (main_windows.go connects them to the library).
var updatedTo = func() string { return "" }
var markUpdated = func(version string) {}

// tr picks the English or Chinese wording for the update messages.
func tr(en, zh string) string {
	if uiLang() == "zh" {
		return zh
	}
	return en
}

// updateMessage is the question shown when a new version is found.
func updateMessage(rel *Release) string {
	var b strings.Builder
	b.WriteString(tr("A new version of Yupoo Library is available: "+rel.Version+"  (you have "+AppVersion+").\n\n",
		"Yupoo Library 有新版本可用："+rel.Version+"（你现在的版本是 "+AppVersion+"）。\n\n"))
	if notes := trimNotes(rel.Notes); notes != "" {
		b.WriteString(tr("What's new:\n", "更新内容：\n") + notes + "\n\n")
	}
	b.WriteString(tr("Updating only replaces the program itself. Your saved items, collections, notes, photos and "+
		"settings are kept exactly as they are — they're stored separately and the update doesn't touch them.\n\n",
		"更新只会替换程序本身。你保存的商品、收藏夹、备注、图片和设置都会原样保留——它们单独存放，更新不会动它们。\n\n"))
	if rel.ExeURL == "" {
		b.WriteString(tr("Open the download page now?", "现在打开下载页面吗？"))
	} else {
		b.WriteString(tr("Update now? The app will restart in a few seconds.", "现在更新吗？程序会在几秒钟后重新启动。"))
	}
	return b.String()
}
