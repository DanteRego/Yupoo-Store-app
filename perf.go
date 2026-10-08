package main

import (
	"os"
	"runtime"
	"sync"
	"time"
)

// The hidden "Speed report" page (/debug): timings the pages send (time to first cards, filters,
// search, drawing a page of cards…) plus a few numbers from the app itself (library.json size,
// number of items, memory). Only kept in memory while the app runs; nothing is saved.

type PerfEntry struct {
	Name string  `json:"name"`
	Ms   float64 `json:"ms"`
	N    int     `json:"n,omitempty"`    // e.g. how many cards were drawn
	Note string  `json:"note,omitempty"` // e.g. which filter
	Page string  `json:"page,omitempty"` // which page sent it
	At   int64   `json:"at"`
}

type perfLog struct {
	mu      sync.Mutex
	entries []PerfEntry
}

var perf perfLog

func (p *perfLog) add(e PerfEntry) {
	if e.At == 0 {
		e.At = time.Now().UnixMilli()
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.entries = append(p.entries, e)
	if len(p.entries) > 2000 {
		p.entries = p.entries[len(p.entries)-2000:]
	}
}

func (p *perfLog) list() []PerfEntry {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]PerfEntry(nil), p.entries...)
}

func (p *perfLog) clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.entries = nil
}

// DebugInfo is the app's own numbers for the Speed report.
func (a *App) DebugInfo() map[string]interface{} {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	size := int64(0)
	if st, err := os.Stat(a.lib.file()); err == nil {
		size = st.Size()
	}
	a.lib.mu.Lock()
	items := len(a.lib.data.Albums)
	a.lib.mu.Unlock()
	return map[string]interface{}{
		"libraryBytes": size,
		"items":        items,
		"goHeapMB":     float64(m.HeapAlloc) / (1 << 20),
		"goSysMB":      float64(m.Sys) / (1 << 20),
		"goroutines":   runtime.NumGoroutine(),
		"version":      AppVersion,
		"entries":      perf.list(),
	}
}
