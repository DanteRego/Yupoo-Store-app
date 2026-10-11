package main

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "image/gif"
	_ "image/png"
)

// Saved cover photos are at most thumbMax pixels on their longest side, at JPEG quality thumbQuality.
// 280 px / 70 looks the same on a card (cards are ~200–250 px wide) and is about half the size of the
// old 360 px / 80. Photos saved the old way are shrunk once, in the background (shrinkOldThumbs).
const (
	thumbMax     = 280
	thumbQuality = 70
)

// thumbWorker downloads each kit's cover once and keeps a small copy on disk.
func (l *Library) thumbWorker() {
	client := &http.Client{Timeout: 25 * time.Second}
	for job := range l.thumbs {
		p := l.thumbPath(job.key)
		if _, ok := l.findThumb(filepath.Base(p)); ok {
			continue
		}
		for {
			waitWhileBlocked()
			data, err := fetchImage(client, job.cover, "https://"+job.host+"/")
			if errors.Is(err, errPhotoBlocked) {
				// Yupoo's photo server is refusing us: pause, then try the same photo again
				// (instead of racing through the list, which keeps the block going).
				l.logThumbErr(job, err)
				photoBlockedFor()
				continue
			}
			if err != nil {
				l.logThumbErr(job, err)
				time.Sleep(500 * time.Millisecond)
				break
			}
			photoAllowed()
			writeThumb(p, makeThumb(data))
			break
		}
		time.Sleep(250 * time.Millisecond) // gentle: about 4 photos a second (too fast gets blocked)
	}
}

// ---------- when Yupoo's photo server blocks us ----------
// Yupoo's photos are behind a security service (Tencent Cloud EdgeOne). If it decides there are too
// many requests, it answers with a "Restricted Access" page (请求已被站点的安全策略拦截) instead of the
// photo. Then all photo downloads pause — 2 minutes at first, doubling up to 30 — and try again.

var errPhotoBlocked = errors.New("Yupoo's photo server blocked the request (Restricted Access)")

var (
	blockMu      sync.Mutex
	blockedUntil time.Time
	blockPause   time.Duration
)

func photoBlockedFor() {
	blockMu.Lock()
	if blockPause == 0 {
		blockPause = 2 * time.Minute
	} else if blockPause < 30*time.Minute {
		blockPause *= 2
		if blockPause > 30*time.Minute {
			blockPause = 30 * time.Minute
		}
	}
	blockedUntil = time.Now().Add(blockPause)
	blockMu.Unlock()
}

func photoAllowed() {
	blockMu.Lock()
	blockPause = 0
	blockMu.Unlock()
}

// PhotoBlockedUntil is when photo downloads are allowed again (zero time = not blocked). For the check-up.
func PhotoBlockedUntil() time.Time {
	blockMu.Lock()
	defer blockMu.Unlock()
	if time.Now().After(blockedUntil) {
		return time.Time{}
	}
	return blockedUntil
}

func waitWhileBlocked() {
	if until := PhotoBlockedUntil(); !until.IsZero() {
		time.Sleep(time.Until(until))
	}
}

func writeThumb(p string, out []byte) {
	f, err := os.CreateTemp(filepath.Dir(p), "dl-*.tmp")
	if err != nil {
		return
	}
	_, err = f.Write(out)
	f.Close()
	if err != nil || os.Rename(f.Name(), p) != nil {
		_ = os.Remove(f.Name())
	}
}

var (
	onDemandClient = &http.Client{Timeout: 25 * time.Second}
	onDemandSlots  = make(chan struct{}, 4)
)

// EnsureThumb returns a kit's saved photo. If the background downloader hasn't
// reached it yet, the photo is fetched right away so the library never waits.
func (l *Library) EnsureThumb(name string) ([]byte, error) {
	name = unsafeChars.ReplaceAllString(name, "_")
	p, ok := l.findThumb(name)
	if ok {
		if b, err := os.ReadFile(p); err == nil {
			return b, nil
		}
	}
	p = filepath.Join(l.ThumbDir(), name)
	if b, err := os.ReadFile(p); err == nil {
		return b, nil
	}
	var job *thumbJob
	l.mu.Lock()
	for _, a := range l.data.Albums {
		if a.Cover != "" && unsafeChars.ReplaceAllString(a.Key, "_") == name {
			job = &thumbJob{a.Key, a.Host, a.Cover}
			break
		}
	}
	l.mu.Unlock()
	if job == nil {
		return nil, os.ErrNotExist
	}
	onDemandSlots <- struct{}{}
	defer func() { <-onDemandSlots }()
	if b, err := os.ReadFile(p); err == nil { // the downloader may have just finished it
		return b, nil
	}
	// While Yupoo is blocking photo downloads, don't ask again (it only makes the block last longer).
	if !PhotoBlockedUntil().IsZero() {
		return nil, errPhotoBlocked
	}
	data, err := fetchImage(onDemandClient, job.cover, "https://"+job.host+"/")
	if errors.Is(err, errPhotoBlocked) {
		l.logThumbErr(*job, err)
		photoBlockedFor()
	}
	if err != nil {
		return nil, err
	}
	photoAllowed()
	out := makeThumb(data)
	writeThumb(p, out)
	return out, nil
}

func fetchImage(client *http.Client, url, referer string) ([]byte, error) {
	if r := os.Getenv("KIT_TEST_REWRITE"); r != "" { // used only by the test suite
		if parts := strings.SplitN(r, "=>", 2); len(parts) == 2 {
			url = strings.Replace(url, parts[0], parts[1], 1)
		}
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	// Yupoo only serves photos to its own pages, so say where we came from.
	req.Header.Set("Referer", referer)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
	t0 := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return nil, netErr(url, err, time.Since(t0))
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 15<<20))
	took := time.Since(t0)
	ct := http.DetectContentType(b)
	// A web page instead of a photo (status 567 or even 200) is Yupoo's security service blocking us.
	if res.StatusCode == 567 || strings.HasPrefix(ct, "text/html") {
		e := describe(url, res, b, took, "a web page came back instead of the photo (most likely Yupoo's security service blocking)")
		e.Blocked = true
		return nil, e
	}
	if res.StatusCode != 200 {
		return nil, describe(url, res, b, took, "the photo server answered with an error")
	}
	if err != nil || len(b) == 0 {
		return nil, describe(url, res, b, took, "the photo came back empty or cut off")
	}
	if len(ct) < 6 || ct[:6] != "image/" {
		return nil, describe(url, res, b, took, "what came back isn't a picture ("+ct+")")
	}
	return b, nil
}

// makeThumb shrinks JPEG/PNG/GIF covers; other formats (e.g. WebP) are kept as they are.
func makeThumb(data []byte) []byte {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return data
	}
	scale := float64(thumbMax) / float64(max(w, h))
	if scale >= 1 {
		scale = 1
	}
	nw, nh := max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	// Box filter: average every source pixel that falls inside each target pixel.
	for y := 0; y < nh; y++ {
		y0 := b.Min.Y + y*h/nh
		y1 := max(y0+1, b.Min.Y+(y+1)*h/nh)
		for x := 0; x < nw; x++ {
			x0 := b.Min.X + x*w/nw
			x1 := max(x0+1, b.Min.X+(x+1)*w/nw)
			var r, g, bl, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA()
					r += uint64(cr)
					g += uint64(cg)
					bl += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i] = uint8(r / n >> 8)
			dst.Pix[i+1] = uint8(g / n >> 8)
			dst.Pix[i+2] = uint8(bl / n >> 8)
			dst.Pix[i+3] = uint8(a / n >> 8)
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return data
	}
	return out.Bytes()
}

// ---------- shrinking photos saved at the old, bigger size ----------

// ThumbShrink is the progress of shrinkOldThumbs (shown on the Settings page).
type ThumbShrink struct {
	Running  bool  `json:"running"`
	Done     int   `json:"done"`   // photos looked at
	Total    int   `json:"total"`  // photos in the folder
	Shrunk   int   `json:"shrunk"` // photos made smaller
	Saved    int64 `json:"saved"`  // bytes saved
	Finished bool  `json:"finished"`
}

var (
	shrinkMu sync.Mutex
	shrinkSt ThumbShrink
)

func (l *Library) ThumbShrinkStatus() ThumbShrink {
	shrinkMu.Lock()
	defer shrinkMu.Unlock()
	return shrinkSt
}

// shrinkOldThumbs goes through the photos folder once and re-saves any photo bigger than thumbMax at
// the new size (library.json "thumbsShrunkTo" remembers it's done). It runs slowly in the background
// and stops if the photos folder is being moved; it carries on next time the app opens.
func (l *Library) shrinkOldThumbs() {
	l.mu.Lock()
	done := l.data.ThumbsShrunkTo == thumbMax
	l.mu.Unlock()
	if done {
		return
	}
	time.Sleep(20 * time.Second) // let the app settle first
	dir := l.ThumbDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	shrinkMu.Lock()
	shrinkSt = ThumbShrink{Running: true, Total: len(entries)}
	shrinkMu.Unlock()
	for i, e := range entries {
		if l.ThumbMoveStatus().Running || l.ThumbDir() != dir {
			shrinkMu.Lock()
			shrinkSt.Running = false
			shrinkMu.Unlock()
			return // the photos are being moved: try again next time
		}
		if !e.IsDir() && !strings.HasSuffix(e.Name(), ".tmp") {
			p := filepath.Join(dir, e.Name())
			if f, err := os.Open(p); err == nil {
				cfg, _, err := image.DecodeConfig(f)
				f.Close()
				if err == nil && max(cfg.Width, cfg.Height) > thumbMax {
					if data, err := os.ReadFile(p); err == nil {
						if small := makeThumb(data); len(small) < len(data) {
							writeThumb(p, small)
							shrinkMu.Lock()
							shrinkSt.Shrunk++
							shrinkSt.Saved += int64(len(data) - len(small))
							shrinkMu.Unlock()
						}
					}
					time.Sleep(5 * time.Millisecond) // gentle: the app stays smooth meanwhile
				}
			}
		}
		shrinkMu.Lock()
		shrinkSt.Done = i + 1
		shrinkMu.Unlock()
	}
	l.mu.Lock()
	l.data.ThumbsShrunkTo = thumbMax
	l.scheduleSave()
	l.mu.Unlock()
	shrinkMu.Lock()
	shrinkSt.Running, shrinkSt.Finished = false, true
	shrinkMu.Unlock()
}

// logThumbErr notes a failed photo download in the app log (app-log.txt), with full details.
// While Yupoo is blocking, the same problem is written only once a minute, not once per photo.
func (l *Library) logThumbErr(job thumbJob, err error) {
	logEvent("photos", "%s: %v", job.key, err)
}
