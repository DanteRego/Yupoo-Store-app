package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed web/*
var webFiles embed.FS

type App struct {
	lib     *Library
	token   string
	baseURL string
}

func dataDir() string {
	if d := os.Getenv("KIT_DATA_DIR"); d != "" {
		return d
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "KitLibrary")
	}
	return "KitLibraryData"
}

func downloadsDir() string {
	if d := os.Getenv("KIT_DOWNLOADS_DIR"); d != "" {
		return d
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
	lib, err := OpenLibrary(dataDir())
	if err != nil {
		return nil, err
	}
	tok := make([]byte, 16)
	_, _ = rand.Read(tok)
	app := &App{lib: lib, token: hex.EncodeToString(tok)}

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
			if name == "library.html" {
				b = []byte(strings.Replace(string(b), "{{TOKEN}}", a.token, 1))
			}
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("/{$}", static("library.html", "text/html; charset=utf-8"))
	mux.HandleFunc("/teams.js", static("teams.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("/library.js", static("library.js", "text/javascript; charset=utf-8"))
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
		p := uniquePath(downloadsDir(), "kit-library-backup-"+todayStamp()+".zip")
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
