package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Album is one saved kit.
type Album struct {
	Key       string `json:"key"`
	Host      string `json:"host"`
	Store     string `json:"store"`
	ID        string `json:"id"`
	Title     string `json:"title"`
	Cover     string `json:"cover"`
	Count     int    `json:"count,omitempty"`
	Link      string `json:"link"`
	Team      string `json:"team,omitempty"`
	FirstSeen int64  `json:"firstSeen"`
	LastSeen  int64  `json:"lastSeen"`
}

// AlbumIn is what a Yupoo page sends when it sees a kit.
type AlbumIn struct {
	Host  string `json:"host"`
	Store string `json:"store"`
	ID    string `json:"id"`
	Title string `json:"title"`
	Cover string `json:"cover"`
	Count int    `json:"count"`
	Link  string `json:"link"`
}

type Settings struct {
	AutoSave bool `json:"autoSave"`
}

type libraryFile struct {
	Albums   map[string]*Album `json:"albums"`
	Aliases  map[string]string `json:"aliases"`
	Settings Settings          `json:"settings"`
	// StoreNames holds your own names for stores (original store name -> your name).
	StoreNames map[string]string `json:"storeNames,omitempty"`
}

type thumbJob struct{ key, host, cover string }

type Library struct {
	mu        sync.Mutex
	dir       string
	thumbDir  string
	data      libraryFile
	version   int64
	saveTimer *time.Timer
	thumbs    chan thumbJob
}

func OpenLibrary(dir, thumbDir string) (*Library, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(thumbDir, 0o755); err != nil {
		return nil, err
	}
	l := &Library{dir: dir, thumbDir: thumbDir, thumbs: make(chan thumbJob, 20000)}
	l.moveOldThumbs()
	l.data = libraryFile{Albums: map[string]*Album{}, Aliases: map[string]string{}, Settings: Settings{AutoSave: true}}
	if b, err := os.ReadFile(l.file()); err == nil {
		if err := json.Unmarshal(b, &l.data); err != nil {
			// Keep the unreadable file aside instead of overwriting it.
			_ = os.Rename(l.file(), l.file()+".broken-"+time.Now().Format("20060102-150405"))
		}
	}
	if l.data.Albums == nil {
		l.data.Albums = map[string]*Album{}
	}
	if l.data.Aliases == nil {
		l.data.Aliases = map[string]string{}
	}
	if l.data.StoreNames == nil {
		l.data.StoreNames = map[string]string{}
	}
	l.ensureMyTeamsFile()
	go l.thumbWorker()
	// Fetch any snapshots that are still missing from earlier sessions.
	for _, a := range l.data.Albums {
		l.queueThumb(a)
	}
	return l, nil
}

func (l *Library) file() string { return filepath.Join(l.dir, "library.json") }

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9._-]`)

func (l *Library) thumbPath(key string) string {
	return filepath.Join(l.thumbDir, unsafeChars.ReplaceAllString(key, "_"))
}

// moveOldThumbs carries photos from the old thumbs folder (next to library.json)
// into the current photo folder, so nothing has to be downloaded again.
func (l *Library) moveOldThumbs() {
	old := filepath.Join(l.dir, "thumbs")
	if filepath.Clean(old) == filepath.Clean(l.thumbDir) {
		return
	}
	entries, err := os.ReadDir(old)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
			continue
		}
		src, dst := filepath.Join(old, e.Name()), filepath.Join(l.thumbDir, e.Name())
		if _, err := os.Stat(dst); err != nil {
			b, err := os.ReadFile(src)
			if err != nil || os.WriteFile(dst, b, 0o644) != nil {
				continue // keep the old copy if it couldn't be written
			}
		}
		_ = os.Remove(src)
	}
	_ = os.Remove(old) // only removed if it is now empty
}

func (l *Library) queueThumb(a *Album) {
	if a.Cover == "" {
		return
	}
	if _, err := os.Stat(l.thumbPath(a.Key)); err == nil {
		return
	}
	select {
	case l.thumbs <- thumbJob{a.Key, a.Host, a.Cover}:
	default: // queue full; it will be retried next launch
	}
}

// ---------- saving ----------

func (l *Library) scheduleSave() {
	l.version++
	if l.saveTimer != nil {
		l.saveTimer.Stop()
	}
	l.saveTimer = time.AfterFunc(800*time.Millisecond, func() { _ = l.Flush() })
}

func (l *Library) Flush() error {
	l.mu.Lock()
	b, err := json.Marshal(l.data)
	l.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := l.file() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, l.file())
}

func (l *Library) SaveAlbums(in []AlbumIn) (added, total int) {
	now := time.Now().UnixMilli()
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, a := range in {
		if a.Host == "" || a.ID == "" {
			continue
		}
		key := a.Host + ":" + a.ID
		cur := l.data.Albums[key]
		if cur == nil {
			cur = &Album{Key: key, Host: a.Host, Store: a.Store, ID: a.ID, Title: a.Title, Cover: a.Cover,
				Count: a.Count, Link: a.Link, FirstSeen: now, LastSeen: now}
			l.data.Albums[key] = cur
			added++
		} else {
			if a.Title != "" {
				cur.Title = a.Title
			}
			if a.Cover != "" {
				cur.Cover = a.Cover
			}
			if a.Count > 0 {
				cur.Count = a.Count
			}
			cur.LastSeen = now
		}
		l.queueThumb(cur)
	}
	l.scheduleSave()
	return added, len(l.data.Albums)
}

func (l *Library) SetTeam(key, team string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if a := l.data.Albums[key]; a != nil {
		a.Team = strings.TrimSpace(team)
		l.scheduleSave()
	}
}

func (l *Library) Remove(keys []string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, k := range keys {
		delete(l.data.Albums, k)
		_ = os.Remove(l.thumbPath(k))
	}
	l.scheduleSave()
}

func (l *Library) SetAliases(a map[string]string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if a == nil {
		a = map[string]string{}
	}
	l.data.Aliases = a
	l.scheduleSave()
}

// SetStoreName gives a store your own name. An empty name goes back to the original.
func (l *Library) SetStoreName(store, name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" || name == store {
		delete(l.data.StoreNames, store)
	} else {
		l.data.StoreNames[store] = name
	}
	l.scheduleSave()
}

func (l *Library) SetSettings(s Settings) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data.Settings = s
	l.scheduleSave()
}

func (l *Library) GetSettings() Settings {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.data.Settings
}

func (l *Library) StateJSON() ([]byte, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return json.Marshal(map[string]interface{}{
		"library":    map[string]interface{}{"albums": l.data.Albums},
		"aliases":    l.data.Aliases,
		"myTeams":    l.myTeams(),
		"settings":   l.data.Settings,
		"storeNames": l.data.StoreNames,
		"version":    l.version,
	})
}

// ---------- backup / restore ----------

func (l *Library) WriteBackup(w io.Writer) error {
	if err := l.Flush(); err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	add := func(name, path string) error {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		f, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = f.Write(b)
		return err
	}
	if err := add("library.json", l.file()); err != nil {
		return err
	}
	entries, _ := os.ReadDir(l.thumbDir)
	for _, e := range entries {
		if !e.IsDir() && !strings.HasSuffix(e.Name(), ".tmp") {
			if err := add("thumbs/"+e.Name(), filepath.Join(l.thumbDir, e.Name())); err != nil {
				return err
			}
		}
	}
	return zw.Close()
}

func (l *Library) Restore(zipBytes []byte) (int, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return 0, fmt.Errorf("not a Kit Library backup")
	}
	var incoming libraryFile
	found := false
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(rc, 200<<20))
		rc.Close()
		switch {
		case f.Name == "library.json":
			if json.Unmarshal(b, &incoming) == nil {
				found = true
			}
		case strings.HasPrefix(f.Name, "thumbs/"):
			name := unsafeChars.ReplaceAllString(strings.TrimPrefix(f.Name, "thumbs/"), "_")
			p := filepath.Join(l.thumbDir, name)
			if _, err := os.Stat(p); err != nil {
				_ = os.WriteFile(p, b, 0o644)
			}
		}
	}
	if !found {
		return 0, fmt.Errorf("not a Kit Library backup")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	added := 0
	for k, a := range incoming.Albums {
		if a != nil && l.data.Albums[k] == nil {
			l.data.Albums[k] = a
			added++
		}
	}
	for k, v := range incoming.Aliases {
		l.data.Aliases[k] = v
	}
	for k, v := range incoming.StoreNames {
		if _, mine := l.data.StoreNames[k]; !mine {
			l.data.StoreNames[k] = v
		}
	}
	l.scheduleSave()
	return added, nil
}

// ---------- my-teams.txt: supplier nicknames you can add yourself ----------

const myTeamsTemplate = `# Kit Library - your own team names
#
# Add one line per name a supplier uses, like this:
#     nickname = English team name
#
# Examples (remove the # at the start to use them):
# 红军 = Liverpool
# 蓝军 = Chelsea
#
# Save this file, then reopen the Library page to see the change.
`

func (l *Library) myTeamsPath() string { return filepath.Join(l.dir, "my-teams.txt") }

func (l *Library) ensureMyTeamsFile() {
	if _, err := os.Stat(l.myTeamsPath()); err != nil {
		_ = os.WriteFile(l.myTeamsPath(), []byte(strings.ReplaceAll(myTeamsTemplate, "\n", "\r\n")), 0o644)
	}
}

func (l *Library) myTeams() map[string]string {
	out := map[string]string{}
	b, err := os.ReadFile(l.myTeamsPath())
	if err != nil {
		return out
	}
	text := strings.TrimPrefix(string(b), "\ufeff")
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		k, v := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if k != "" && v != "" {
			out[k] = v
		}
	}
	return out
}
