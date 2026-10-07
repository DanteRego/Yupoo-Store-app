package main

import (
	"encoding/json"
	"errors"
	"io"
	"math/rand"
	"net/http"
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
//
// Stores with a password: Yupoo keeps the password you typed in a cookie called "indexlockcode" and
// sends it with every page. The check does the same with the password saved for that store
// (library.json "storePasswords"). Stores it can't read are listed in "storeLocked", which the
// Library shows as "🔒 Needs a password" with a button to enter it.

// NewCheckStatus is what the Library page shows about the check.
type NewCheckStatus struct {
	Running  bool   `json:"running"`
	Stores   int    `json:"stores"`  // how many stores to look through
	Done     int    `json:"done"`    // how many are finished
	Store    string `json:"store"`   // the store being looked at now
	Found    int    `json:"found"`   // new items found this time
	First    int    `json:"first"`   // stores checked for the first time (nothing to compare with yet)
	Skipped  int    `json:"skipped"` // stores whose page couldn't be opened
	Locked   int    `json:"locked"`  // stores that showed no items (they need a password)
	Failed   bool   `json:"failed"`  // Yupoo stopped answering, so the rest waits for next time
	Started  int64  `json:"started"`
	Finished int64  `json:"finished"`
}

type NewChecker struct {
	mu      sync.Mutex
	lib     *Library
	crawl   *Crawler
	st      NewCheckStatus
	queued  []string // stores to check after the running check (e.g. a password was just entered)
	fetched bool     // a page has been read already, so wait before the next one
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

// Start checks the given store addresses, or every store when hosts is nil. If a check is already
// running, the given stores are checked when it gets to the end.
func (c *NewChecker) Start(hosts []string) NewCheckStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.st.Running {
		c.queued = append(c.queued, hosts...)
		return c.st
	}
	c.st = NewCheckStatus{Running: true, Started: time.Now().UnixMilli()}
	c.fetched = false
	if hosts == nil {
		hosts = c.lib.storeHosts()
	}
	go c.run(hosts)
	return c.st
}

// Pages read per store at most in one check (a store adding more than this between two
// openings of the app is very unlikely).
const newCheckMaxPages = 30

func (c *NewChecker) run(hosts []string) {
	for len(hosts) > 0 {
		c.update(func(s *NewCheckStatus) { s.Stores += len(hosts) })
		if !c.checkStores(hosts) {
			break // Yupoo stopped answering
		}
		c.mu.Lock()
		hosts, c.queued = c.queued, nil
		c.mu.Unlock()
	}
	c.mu.Lock()
	c.queued = nil
	c.st.Running, c.st.Store, c.st.Finished = false, "", time.Now().UnixMilli()
	c.mu.Unlock()
}

// checkStores looks through the given stores one by one. It returns false if Yupoo stopped answering.
func (c *NewChecker) checkStores(hosts []string) bool {
	failsInARow := 0
	for _, host := range hosts {
		store := strings.Split(host, ".")[0]
		c.update(func(s *NewCheckStatus) { s.Store = store })
		mark, known := c.lib.newCheckMark(host)
		cookie := ""
		if pw := c.lib.StorePassword(store); pw != "" {
			cookie = "indexlockcode=" + encodeURIComponent(pw)
		}
		list := &url.URL{Scheme: "https", Host: host, Path: "/categories"}
		top, prevSig, maxPage, failed, locked := mark, "", 0, false, false
		for page := 1; page <= newCheckMaxPages; page++ {
			if !c.lib.hasHost(host) {
				break // the store was removed from the library meanwhile
			}
			// Go slowly so Yupoo doesn't block you (1.5–2.5 seconds between pages), and never at
			// the same time as "Save whole store".
			if c.fetched {
				time.Sleep(1500*time.Millisecond + time.Duration(rand.Intn(1000))*time.Millisecond)
			}
			for c.crawl.Status().Running {
				time.Sleep(3 * time.Second)
			}
			c.fetched = true
			body, err := fetchPage(pageURLFor(list, page), "https://"+host+"/", cookie)
			if err != nil {
				failed = true
				break
			}
			found := extractAlbums(body, host)
			if page == 1 {
				maxPage = detectMaxPage(body)
				// Nothing on the first page: the store needs a password (or the saved one has
				// changed), so it can't be checked.
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
				return false
			}
		} else {
			failsInARow = 0
			c.lib.setStoreLocked(store, locked)
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
	return true
}

// ---------- store passwords ----------

// encodeURIComponent writes a password the way Yupoo's own page puts it in its cookie.
func encodeURIComponent(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }

var errWrongPassword = errors.New("wrong password")

// checkStorePassword asks Yupoo whether pw is the password for store (the same question
// Yupoo's own password box asks). needs is false when the store has no password at all.
func checkStorePassword(store, pw string) (needs, valid bool, err error) {
	u := "https://" + store + ".x.yupoo.com/api/web/users/" + url.PathEscape(store) + "?password=" + url.QueryEscape(pw)
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return false, false, err
	}
	req.Header.Set("Referer", "https://"+store+".x.yupoo.com/categories")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0")
	req.Header.Set("Accept", "application/json")
	res, err := crawlClient.Do(req)
	if err != nil {
		return false, false, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return false, false, errors.New(res.Status)
	}
	var r struct {
		Data struct {
			NeedPassWord  bool `json:"needPassWord"`
			PasswordValid bool `json:"passwordValid"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&r); err != nil {
		return false, false, err
	}
	return r.Data.NeedPassWord, r.Data.PasswordValid, nil
}

// EnterStorePassword is the Library's "Enter password": checks it with Yupoo, saves it if it's
// right, and checks that store for new items straight away. An empty password forgets it.
func (a *App) EnterStorePassword(store, pw string) error {
	store, pw = strings.ToLower(strings.TrimSpace(store)), strings.TrimSpace(pw)
	if store == "" {
		return errors.New("which store?")
	}
	if pw == "" {
		a.lib.SetStorePassword(store, "")
		return nil
	}
	needs, valid, err := checkStorePassword(store, pw)
	if err != nil {
		return errors.New("Couldn't reach Yupoo to check the password: " + err.Error())
	}
	if needs && !valid {
		return errWrongPassword
	}
	a.lib.SetStorePassword(store, pw)
	if host := a.lib.hostOf(store); host != "" {
		a.check.Start([]string{host})
	}
	return nil
}

// RememberTypedPassword is called when you open a store page in the app that has Yupoo's password
// cookie: the password you typed in Yupoo's own box is saved too, so the check can use it. The
// cookie may belong to another store, so it's only saved after Yupoo says it's right for this one.
func (a *App) RememberTypedPassword(store, pw string) {
	store, pw = strings.ToLower(strings.TrimSpace(store)), strings.TrimSpace(pw)
	if store == "" || pw == "" || a.lib.StorePassword(store) == pw || a.lib.hostOf(store) == "" {
		return
	}
	a.pwMu.Lock()
	tried := a.pwTried[store+"\x00"+pw]
	if a.pwTried == nil {
		a.pwTried = map[string]bool{}
	}
	a.pwTried[store+"\x00"+pw] = true
	a.pwMu.Unlock()
	if tried {
		return
	}
	needs, valid, err := checkStorePassword(store, pw)
	if err != nil || !needs || !valid {
		return
	}
	a.lib.SetStorePassword(store, pw)
	if a.lib.storeIsLocked(store) {
		a.check.Start([]string{a.lib.hostOf(store)})
	}
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

// hostOf is a store's address (e.g. bohaosports -> bohaosports.x.yupoo.com), or "" if it isn't in the library.
func (l *Library) hostOf(store string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, a := range l.data.Albums {
		if strings.EqualFold(a.Store, store) && strings.HasSuffix(strings.ToLower(a.Host), ".x.yupoo.com") {
			return strings.ToLower(a.Host)
		}
	}
	return ""
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

func (l *Library) StorePassword(store string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.data.StorePasswords[strings.ToLower(store)]
}

// SetStorePassword saves a store's password ("" forgets it).
func (l *Library) SetStorePassword(store, pw string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	store = strings.ToLower(store)
	if pw == "" {
		delete(l.data.StorePasswords, store)
	} else {
		l.data.StorePasswords[store] = pw
	}
	l.scheduleSave()
}

func (l *Library) storeIsLocked(store string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, ok := l.data.StoreLocked[strings.ToLower(store)]
	return ok
}

func (l *Library) setStoreLocked(store string, locked bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	store = strings.ToLower(store)
	_, was := l.data.StoreLocked[store]
	if locked && !was {
		l.data.StoreLocked[store] = time.Now().UnixMilli()
	} else if !locked && was {
		delete(l.data.StoreLocked, store)
	} else {
		return
	}
	l.scheduleSave()
}

// LockedStore is one entry in the Library's "🔒 Needs a password" list.
type LockedStore struct {
	Store string `json:"store"`
	Host  string `json:"host"`
	Saved bool   `json:"saved"` // a password is saved, but it didn't work (the store changed it)
}

// lockedStores lists the stores the check couldn't read (l.mu must be held).
func (l *Library) lockedStores() []LockedStore {
	out := []LockedStore{}
	if len(l.data.StoreLocked) == 0 {
		return out
	}
	hosts, names := map[string]string{}, map[string]string{}
	for _, a := range l.data.Albums {
		s := strings.ToLower(a.Store)
		if _, ok := l.data.StoreLocked[s]; ok && hosts[s] == "" {
			hosts[s], names[s] = a.Host, a.Store
		}
	}
	for s := range l.data.StoreLocked {
		if hosts[s] == "" {
			continue // no longer in the library
		}
		_, saved := l.data.StorePasswords[s]
		out = append(out, LockedStore{Store: names[s], Host: hosts[s], Saved: saved})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Store < out[j].Store })
	return out
}

// MarkSeen takes items off the New Additions page (they stay in the library). This is the only
// thing that takes an item off: until you mark it as seen it stays there, also after restarting.
// Returns when each item had been found, so Undo can put them back.
func (l *Library) MarkSeen(keys []string) map[string]int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	was := map[string]int64{}
	for _, k := range keys {
		if a := l.data.Albums[k]; a != nil && a.NewAt != 0 {
			was[k] = a.NewAt
			a.NewAt = 0
		}
	}
	if len(was) > 0 {
		l.scheduleSave()
	}
	return was
}

// MarkUnseen puts items back on the New Additions page (Undo after "Mark as seen").
func (l *Library) MarkUnseen(items map[string]int64) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for k, at := range items {
		if a := l.data.Albums[k]; a != nil && at > 0 {
			a.NewAt = at
			n++
		}
	}
	if n > 0 {
		l.scheduleSave()
	}
	return n
}
