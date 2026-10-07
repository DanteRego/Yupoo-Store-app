package main

import (
	"math/rand"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The "new additions" check: a few seconds after the app opens, it looks through every store
// already in your library for items the store has added since last time, saves them, and marks
// them so they show on the Library's "✨ New Additions" page.
//
// How it knows what's new: Yupoo gives every album a number that goes up over time, and a store's
// /categories page lists the newest albums first. So for each store the app remembers the highest
// album number it has seen (library.json "newCheck"). Next time, anything with a higher number is
// new. It reads pages until one has nothing new on it — usually just the first page per store.
// The first time a store is checked there's nothing to compare with yet, so it only notes the
// newest number (nothing is marked as new).

// NewCheckStatus is what the Library page shows about the check.
type NewCheckStatus struct {
	Running  bool   `json:"running"`
	Stores   int    `json:"stores"`  // how many stores to look through
	Done     int    `json:"done"`    // how many are finished
	Store    string `json:"store"`   // the store being looked at now
	Found    int    `json:"found"`   // new items found this time
	First    int    `json:"first"`   // stores checked for the first time (nothing to compare with yet)
	Skipped  int    `json:"skipped"` // stores whose page couldn't be opened
	Locked   int    `json:"locked"`  // stores that showed no items (closed, or need a password)
	Failed   bool   `json:"failed"`  // Yupoo stopped answering, so the rest waits for next time
	Started  int64  `json:"started"`
	Finished int64  `json:"finished"`
}

type NewChecker struct {
	mu    sync.Mutex
	lib   *Library
	crawl *Crawler
	st    NewCheckStatus
}

func NewNewChecker(lib *Library, crawl *Crawler) *NewChecker {
	return &NewChecker{lib: lib, crawl: crawl}
}

func (c *NewChecker) Status() NewCheckStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.st
}

func (c *NewChecker) update(f func(s *NewCheckStatus)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f(&c.st)
}

// Start begins a check (unless one is already running).
func (c *NewChecker) Start() NewCheckStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.st.Running {
		c.st = NewCheckStatus{Running: true, Started: time.Now().UnixMilli()}
		go c.run()
	}
	return c.st
}

// Pages read per store at most in one check (a store adding more than this between two
// openings of the app is very unlikely).
const newCheckMaxPages = 30

func (c *NewChecker) run() {
	hosts := c.lib.storeHosts()
	c.update(func(s *NewCheckStatus) { s.Stores = len(hosts) })
	fetched, failsInARow := false, 0
	for _, host := range hosts {
		c.update(func(s *NewCheckStatus) { s.Store = strings.Split(host, ".")[0] })
		mark, known := c.lib.newCheckMark(host)
		list := &url.URL{Scheme: "https", Host: host, Path: "/categories"}
		top, prevSig, maxPage, failed, locked := mark, "", 0, false, false
		for page := 1; page <= newCheckMaxPages; page++ {
			if !c.lib.hasHost(host) {
				break // the store was removed from the library meanwhile
			}
			// Go slowly so Yupoo doesn't block you (1.5–2.5 seconds between pages), and never at
			// the same time as "Save whole store".
			if fetched {
				time.Sleep(1500*time.Millisecond + time.Duration(rand.Intn(1000))*time.Millisecond)
			}
			for c.crawl.Status().Running {
				time.Sleep(3 * time.Second)
			}
			fetched = true
			body, err := fetchPage(pageURLFor(list, page), "https://"+host+"/", "")
			if err != nil {
				failed = true
				break
			}
			found := extractAlbums(body, host)
			if page == 1 {
				maxPage = detectMaxPage(body)
				// Nothing on the first page: the store is closed or needs a password (the check
				// can't type one in), so it can't be checked.
				if len(found) == 0 {
					locked = true
					break
				}
			}
			ids := make([]string, len(found))
			var fresh []AlbumIn
			for i, a := range found {
				ids[i] = a.ID
				n, err := strconv.ParseInt(a.ID, 10, 64)
				if err != nil {
					continue
				}
				if n > top {
					top = n
				}
				if known && n > mark {
					fresh = append(fresh, a)
				}
			}
			sig := strings.Join(ids, ",")
			if len(found) == 0 || sig == prevSig || !known || len(fresh) == 0 {
				break
			}
			if !c.lib.hasHost(host) {
				break
			}
			added, _ := c.lib.saveAlbums(fresh, true)
			c.update(func(s *NewCheckStatus) { s.Found += added })
			if maxPage > 0 && page >= maxPage {
				break
			}
			prevSig = sig
		}
		if failed {
			// One store's page not opening (e.g. the store was closed) is skipped; several in a
			// row means Yupoo has stopped answering, so the rest waits for next time.
			failsInARow++
			c.update(func(s *NewCheckStatus) { s.Skipped++ })
			if failsInARow >= 3 {
				c.update(func(s *NewCheckStatus) { s.Failed = true })
				break
			}
		} else {
			failsInARow = 0
		}
		if top > mark && c.lib.hasHost(host) {
			c.lib.setNewCheckMark(host, top)
		}
		c.update(func(s *NewCheckStatus) {
			s.Done++
			if locked {
				s.Locked++
			} else if !known && !failed {
				s.First++
			}
		})
	}
	c.update(func(s *NewCheckStatus) { s.Running, s.Store, s.Finished = false, "", time.Now().UnixMilli() })
}

// ---------- the library's side ----------

// storeHosts lists every store address in the library (e.g. bohaosports.x.yupoo.com), A–Z.
func (l *Library) storeHosts() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	seen := map[string]bool{}
	var out []string
	for _, a := range l.data.Albums {
		if h := strings.ToLower(a.Host); strings.HasSuffix(h, ".x.yupoo.com") && !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	sort.Strings(out)
	return out
}

func (l *Library) hasHost(host string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, a := range l.data.Albums {
		if strings.EqualFold(a.Host, host) {
			return true
		}
	}
	return false
}

func (l *Library) newCheckMark(host string) (int64, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	n, ok := l.data.NewCheck[host]
	return n, ok
}

func (l *Library) setNewCheckMark(host string, n int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data.NewCheck[host] = n
	l.scheduleSave()
}

// MarkSeen takes items off the New Additions page (they stay in the library). Returns how many.
func (l *Library) MarkSeen(keys []string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, k := range keys {
		if a := l.data.Albums[k]; a != nil && a.NewAt != 0 {
			a.NewAt = 0
			n++
		}
	}
	if n > 0 {
		l.scheduleSave()
	}
	return n
}
