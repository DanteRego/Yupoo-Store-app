package main

import (
	"os"
	"sync"
)

// "Export Saved Data" (Settings): writes the library + photos as a .zip in the background, so the
// Settings page can show a progress bar (it asks GET /api/backup about once a second).

type ExportStatus struct {
	Running  bool   `json:"running"`
	Done     int    `json:"done"`  // files written (library.json + photos)
	Total    int    `json:"total"` // files to write
	Path     string `json:"path"`  // where the .zip is (set when finished)
	Error    string `json:"error,omitempty"`
	Finished bool   `json:"finished"`
}

type exporter struct {
	mu sync.Mutex
	st ExportStatus
}

var export exporter

func (e *exporter) status() ExportStatus {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.st
}

// start begins an export unless one is already running; either way it returns the current status.
func (e *exporter) start(lib *Library) ExportStatus {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.st.Running {
		return e.st
	}
	p := uniquePath(downloadsDir(), "yupoo-library-"+todayStamp()+".zip")
	e.st = ExportStatus{Running: true}
	go func() {
		err := func() error {
			f, err := os.Create(p)
			if err != nil {
				return err
			}
			err = lib.WriteBackup(f, func(done, total int) {
				e.mu.Lock()
				e.st.Done, e.st.Total = done, total
				e.mu.Unlock()
			})
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				_ = os.Remove(p) // don't leave half a file behind
			}
			return err
		}()
		e.mu.Lock()
		e.st.Running, e.st.Finished = false, true
		if err != nil {
			e.st.Error = err.Error()
		} else {
			e.st.Path = p
		}
		e.mu.Unlock()
	}()
	return e.st
}
