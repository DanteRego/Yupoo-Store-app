package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Changing where cover photos are kept (the ⚙ Settings page), optionally moving the photos
// that are already saved. The move runs in the background; photos still in the old folder
// keep showing (findThumb looks there too) until they've been moved.

// ThumbMove is the progress of moving photos to a new folder.
type ThumbMove struct {
	Running bool   `json:"running"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Failed  int    `json:"failed"`
	From    string `json:"from"`
	To      string `json:"to"`
	Message string `json:"message"`
}

func (l *Library) ThumbMoveStatus() ThumbMove {
	l.tmu.RLock()
	defer l.tmu.RUnlock()
	return l.move
}

// DefaultThumbDir is where photos go when no folder has been chosen.
func (l *Library) DefaultThumbDir() string { return l.defaultDir }

// SetThumbDir switches the photos folder. useDefault goes back to the default folder.
// With move, the photos already saved are moved from the old folder to the new one.
func (l *Library) SetThumbDir(dir string, useDefault, move bool) error {
	if useDefault {
		dir = l.defaultDir
	}
	dir = strings.TrimSpace(dir)
	if dir == "" || !filepath.IsAbs(dir) {
		return errors.New("please choose a full folder path, like D:\\Yupoo Photos")
	}
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("couldn't use that folder: %v", err)
	}
	// Make sure photos can actually be written there.
	probe := filepath.Join(dir, ".yupoo-library-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("can't save photos in that folder (is it read-only?): %v", err)
	}
	_ = os.Remove(probe)

	l.tmu.Lock()
	if l.move.Running {
		l.tmu.Unlock()
		return errors.New("photos are still being moved — wait until that's finished")
	}
	old := l.thumbDir
	same := strings.EqualFold(filepath.Clean(old), dir)
	l.thumbDir = dir
	if move && !same {
		l.moveFrom = old
		l.move = ThumbMove{Running: true, From: old, To: dir}
	}
	l.tmu.Unlock()

	l.mu.Lock()
	if useDefault {
		l.data.Settings.ThumbsDir = ""
	} else {
		l.data.Settings.ThumbsDir = dir
	}
	l.scheduleSave()
	l.mu.Unlock()

	if move && !same {
		go l.moveThumbs(old, dir)
	}
	return nil
}

func (l *Library) moveThumbs(from, to string) {
	entries, _ := os.ReadDir(from)
	var names []string
	for _, e := range entries {
		if !e.IsDir() && !strings.HasSuffix(e.Name(), ".tmp") && !strings.HasPrefix(e.Name(), ".") {
			names = append(names, e.Name())
		}
	}
	l.tmu.Lock()
	l.move.Total = len(names)
	l.tmu.Unlock()
	failed := 0
	for i, name := range names {
		src, dst := filepath.Join(from, name), filepath.Join(to, name)
		if fileExists(dst) {
			_ = os.Remove(src) // already there (e.g. downloaded meanwhile)
		} else if err := os.Rename(src, dst); err != nil {
			// A different drive can't be renamed into: copy, then delete the original.
			if err := copyFile(src, dst); err != nil {
				failed++
			} else {
				_ = os.Remove(src)
			}
		}
		if i%50 == 0 || i == len(names)-1 {
			l.tmu.Lock()
			l.move.Done, l.move.Failed = i+1, failed
			l.tmu.Unlock()
		}
	}
	_ = os.Remove(from) // removes the old folder only if it's now empty
	l.tmu.Lock()
	l.moveFrom = ""
	l.move.Running = false
	l.move.Done, l.move.Failed = len(names), failed
	if failed > 0 {
		l.moveFrom = from // keep showing the photos that stayed behind
		l.move.Message = fmt.Sprintf("Moved %d photos; %d couldn't be moved and stay in the old folder.", len(names)-failed, failed)
	} else {
		l.move.Message = fmt.Sprintf("Moved %d photos.", len(names))
	}
	l.tmu.Unlock()
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// countPhotos counts the saved photos in a folder (for the Settings page).
func countPhotos(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && !strings.HasSuffix(e.Name(), ".tmp") && !strings.HasPrefix(e.Name(), ".") {
			n++
		}
	}
	return n
}
