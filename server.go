package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed web/*
var webFiles embed.FS

type App struct {
	lib     *Library
	crawl   *Crawler
	check   *NewChecker
	// Store passwords already tried from Yupoo's cookie (RememberTypedPassword), so each is checked once.
	pwMu    sync.Mutex
	pwTried map[string]bool
	token   string
	baseURL string
}

func dataDir() string {
	if d := os.Getenv("KIT_DATA_DIR"); d != "" {
		return d
	}
	if d, err := os.UserConfigDir(); err == nil {
		return renamedDir(filepath.Join(d, "KitLibrary"), filepath.Join(d, "YupooLibrary"))
	}
	return "YupooLibraryData"
}

// renamedDir moves a folder from the app's old name (Kit Library) to its new name
// (Yupoo Library) the first time. If it can't be moved, the old folder keeps being used.
func renamedDir(oldDir, newDir string) string {
	if _, err := os.Stat(newDir); err == nil {
		return newDir
	}
	if _, err := os.Stat(oldDir); err != nil {
		return newDir // nothing saved yet
	}
	if err := os.MkdirAll(filepath.Dir(newDir), 0o755); err != nil {
		return oldDir
	}
	if err := os.Rename(oldDir, newDir); err != nil {
		return oldDir
	}
	return newDir
}

// thumbsDir is where cover photos are kept. They go on the M: drive when it is
// plugged in; otherwise they stay next to library.json.
func thumbsDir() string {
	if d := os.Getenv("KIT_THUMBS_DIR"); d != "" {
		return d
	}
	if st, err := os.Stat(`M:\`); err == nil && st.IsDir() {
		if renamedDir(`M:\Kit Library`, `M:\Yupoo Library`) == `M:\Kit Library` {
			return `M:\Kit Library\Thumbnails`
		}
		return `M:\Yupoo Library\Thumbnails`
	}
	return filepath.Join(dataDir(), "thumbs")
}

func downloadsDir() string {
	if d := os.Getenv("KIT_DOWNLOADS_DIR"); d != "" {
		return d
	}
	if d := systemDownloads(); d != "" {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return d
		}
	}
	if h, err := os.UserHomeDir(); err == nil {
		d := filepath.Join(h, "Downloads")
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return d
		}
	}
	return dataDir()
}

// uniquePath avoids overwriting: name.csv, name (2).csv, ...
func uniquePath(dir, name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	p := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Stat(p); err != nil {
			return p
		}
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
	}
}

// StartApp opens the library and serves the library page on a private local address.
func StartApp() (*App, error) {
	lib, err := OpenLibrary(dataDir(), thumbsDir())
	if err != nil {
		return nil, err
	}
	tok := make([]byte, 16)
	_, _ = rand.Read(tok)
	app := &App{lib: lib, crawl: NewCrawler(lib), token: hex.EncodeToString(tok)}
	app.check = NewNewChecker(lib, app.crawl)
	// A few seconds after opening: fill in stores that aren't completely saved, and check for new
	// items every 2 hours (see newcheck.go).
	go func() {
		time.Sleep(8 * time.Second)
		app.check.Run()
	}()

	addr := "127.0.0.1:0"
	if p := os.Getenv("KIT_PORT"); p != "" {
		addr = "127.0.0.1:" + p
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	app.baseURL = "http://" + ln.Addr().String() + "/"
	go func() { _ = http.Serve(ln, app.routes()) }()
	return app, nil
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	static := func(name, ctype string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := webFiles.ReadFile("web/" + name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			if strings.HasSuffix(name, ".html") {
				lang := a.lib.GetSettings().Language
				if lang != "zh" {
					lang = "en"
				}
				b = []byte(strings.NewReplacer("{{TOKEN}}", a.token, "{{LANG}}", lang).Replace(string(b)))
			}
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("/{$}", static("library.html", "text/html; charset=utf-8"))
	mux.HandleFunc("/catalog", static("catalog.html", "text/html; charset=utf-8"))
	mux.HandleFunc("/settings", static("settings.html", "text/html; charset=utf-8"))
	mux.HandleFunc("/settings.js", static("settings.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/i18n.js", static("i18n.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/teams.js", static("teams.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/categories.js", static("categories.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/brands.js", static("brands.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/library.js", static("library.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/catalog.js", static("catalog.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/shared.js", static("shared.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/app.css", static("app.css", "text/css; charset=utf-8"))
	mux.HandleFunc("/crawlbar.js", static("crawlbar.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/icon.svg", static("icon.svg", "image/svg+xml"))

	mux.HandleFunc("/thumb/{key}", func(w http.ResponseWriter, r *http.Request) {
		b, err := a.lib.EnsureThumb(r.PathValue("key"))
		if err != nil {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", http.DetectContentType(b))
		w.Header().Set("Cache-Control", "max-age=3600")
		_, _ = w.Write(b)
	})

	api := func(h func(w http.ResponseWriter, r *http.Request) (interface{}, error)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// Only the library page knows this token, so other websites can't touch your library.
			if r.Header.Get("X-Kit-Token") != a.token {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			res, err := h(w, r)
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if raw, ok := res.([]byte); ok {
				_, _ = w.Write(raw)
				return
			}
			_ = json.NewEncoder(w).Encode(res)
		}
	}
	decode := func(r *http.Request, v interface{}) error {
		return json.NewDecoder(io.LimitReader(r.Body, 50<<20)).Decode(v)
	}

	mux.HandleFunc("GET /api/state", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.lib.StateJSON()
	}))
	// "Save whole store" progress. Inside the app window, pages use the kitCrawl* bindings
	// instead (see main_windows.go); these are for the Mac/Linux test mode.
	mux.HandleFunc("GET /api/crawl", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.crawl.Status(), nil
	}))
	mux.HandleFunc("POST /api/crawl/{act}", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct {
			URL, Cookie, Mode string
			Min               bool
		}
		_ = decode(r, &in)
		return a.crawlAction(r.PathValue("act"), in.URL, in.Cookie, in.Mode, in.Min), nil
	}))
	// The "✨ New Additions" check (newcheck.go): its progress, "Check now", and "Mark as seen".
	mux.HandleFunc("GET /api/new-check", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.check.Status(), nil
	}))
	mux.HandleFunc("POST /api/new-check", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.check.Start(nil), nil
	}))
	// "🔒 Needs a password" → Enter password: checked with Yupoo, saved, then that store is checked.
	mux.HandleFunc("POST /api/store-password", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Store, Password string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		if err := a.EnterStorePassword(in.Store, in.Password); err != nil {
			return nil, err
		}
		return a.check.Status(), nil
	}))
	mux.HandleFunc("POST /api/new-seen", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Keys []string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		was := a.lib.MarkSeen(in.Keys)
		return map[string]interface{}{"changed": len(was), "was": was}, nil
	}))
	mux.HandleFunc("POST /api/new-unseen", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Items map[string]int64 }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return map[string]int{"changed": a.lib.MarkUnseen(in.Items)}, nil
	}))
	mux.HandleFunc("POST /api/save-albums", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in []AlbumIn
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		added, total := a.lib.SaveAlbums(in)
		return map[string]int{"added": added, "total": total}, nil
	}))
	mux.HandleFunc("POST /api/team", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Key, Team string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetTeam(in.Key, in.Team)
		return true, nil
	}))
	mux.HandleFunc("POST /api/store-name", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Store, Name string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetStoreName(in.Store, in.Name)
		return true, nil
	}))
	mux.HandleFunc("POST /api/category", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Key, Category string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetCategory(in.Key, in.Category)
		return true, nil
	}))
	mux.HandleFunc("POST /api/categories", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct {
			Keys     []string
			Category string
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return map[string]int{"changed": a.lib.SetCategories(in.Keys, in.Category)}, nil
	}))
	// The Catalog's collections (see collections.go).
	mux.HandleFunc("GET /api/collections", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.lib.CollectionsList(), nil
	}))
	// Importing a collection someone sent you (a file made with the Catalog's "Export").
	mux.HandleFunc("POST /api/import-collection", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in SharedCollection
		if err := decode(r, &in); err != nil {
			return nil, errors.New("That file isn't a shared Yupoo Library collection.")
		}
		c, n, err := a.lib.ImportCollection(in)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"collection": c, "newItems": n}, nil
	}))
	mux.HandleFunc("POST /api/collections/{act}", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in CollectionRequest
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		c, n, err := a.lib.CollectionAction(r.PathValue("act"), in)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"collection": c, "changed": n}, nil
	}))
	mux.HandleFunc("POST /api/store-category", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Store, Category string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetStoreCategory(in.Store, in.Category)
		return true, nil
	}))
	// ---------- the ⚙ Settings page ----------
	mux.HandleFunc("GET /api/settings-info", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		dir := a.lib.ThumbDir()
		return map[string]interface{}{
			"thumbsDir":        dir,
			"defaultThumbsDir": a.lib.DefaultThumbDir(),
			"usingDefault":     strings.EqualFold(filepath.Clean(dir), filepath.Clean(a.lib.DefaultThumbDir())),
			"photoCount":       countPhotos(dir),
			"dataDir":          a.lib.dir,
			"downloadsDir":     downloadsDir(),
			"move":             a.lib.ThumbMoveStatus(),
			"canPickFolders":   canPickFolders,
			"version":          AppVersion,
		}, nil
	}))
	mux.HandleFunc("GET /api/diagnose", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.Diagnose(), nil
	}))
	mux.HandleFunc("GET /api/thumbs-move", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		return a.lib.ThumbMoveStatus(), nil
	}))
	mux.HandleFunc("POST /api/thumbs-dir", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct {
			Dir           string
			Default, Move bool
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		if err := a.lib.SetThumbDir(in.Dir, in.Default, in.Move); err != nil {
			return nil, err
		}
		return map[string]interface{}{"thumbsDir": a.lib.ThumbDir(), "move": a.lib.ThumbMoveStatus()}, nil
	}))
	mux.HandleFunc("POST /api/pick-folder", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Title string }
		_ = decode(r, &in)
		if in.Title == "" {
			in.Title = "Choose a folder for your cover photos"
		}
		p, err := pickFolder(in.Title)
		if err != nil {
			return nil, err
		}
		return map[string]string{"path": p}, nil
	}))
	mux.HandleFunc("POST /api/open-folder", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Which string }
		_ = decode(r, &in)
		dirs := map[string]string{"thumbs": a.lib.ThumbDir(), "data": a.lib.dir, "downloads": downloadsDir()}
		dir, ok := dirs[in.Which]
		if !ok {
			return nil, errors.New("unknown folder")
		}
		return true, openFolder(dir)
	}))
	mux.HandleFunc("POST /api/remove-store", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Store string }
		if err := decode(r, &in); err != nil || in.Store == "" {
			return nil, errors.New("which store?")
		}
		return map[string]int{"removed": a.lib.RemoveStore(in.Store)}, nil
	}))
	mux.HandleFunc("POST /api/remove", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Keys []string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.Remove(in.Keys)
		return true, nil
	}))
	mux.HandleFunc("POST /api/aliases", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in map[string]string
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetAliases(in)
		return true, nil
	}))
	mux.HandleFunc("POST /api/settings", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in Settings
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		a.lib.SetSettings(in)
		return true, nil
	}))
	mux.HandleFunc("POST /api/save-file", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		var in struct{ Name, Content string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		name := filepath.Base(unsafeChars.ReplaceAllString(in.Name, "_"))
		p := uniquePath(downloadsDir(), name)
		if err := os.WriteFile(p, []byte(in.Content), 0o644); err != nil {
			return nil, err
		}
		return map[string]string{"path": p}, nil
	}))
	mux.HandleFunc("POST /api/backup", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		p := uniquePath(downloadsDir(), "yupoo-library-backup-"+todayStamp()+".zip")
		f, err := os.Create(p)
		if err != nil {
			return nil, err
		}
		err = a.lib.WriteBackup(f)
		f.Close()
		if err != nil {
			_ = os.Remove(p)
			return nil, err
		}
		return map[string]string{"path": p}, nil
	}))
	mux.HandleFunc("POST /api/restore", api(func(w http.ResponseWriter, r *http.Request) (interface{}, error) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 2<<30))
		if err != nil {
			return nil, err
		}
		n, err := a.lib.Restore(b)
		if err != nil {
			return nil, err
		}
		return map[string]int{"added": n}, nil
	}))
	return mux
}
