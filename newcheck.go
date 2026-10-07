package main

import (
	"encoding/json"
	"errors"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
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
	Running  bool   `json:"running"`  // reading Yupoo pages right now (checking or filling in)
	Checking bool   `json:"checking"` // the new-items check is running (not just filling in)
	Stores   int    `json:"stores"`   // how many stores to look through
	Done     int    `json:"done"`     // how many are finished
	Store    string `json:"store"`    // the store being looked at now
	Found    int    `json:"found"`    // new items found by the last check
	First    int    `json:"first"`    // stores checked for the first time (nothing to compare with yet)
	Skipped  int    `json:"skipped"`  // stores whose page couldn't be opened
	Locked   int    `json:"locked"`   // stores that showed no items (they need a password)
	Failed   bool   `json:"failed"`   // Yupoo stopped answering, so the rest waits for a while
	Started  int64  `json:"started"`  // when the app started looking (this session)
	Finished int64  `json:"finished"` // when the last new-items check finished (this session)
	// LastCheck is when the last complete new-items check was (also from earlier sessions);
	// NextCheck is when the next automatic one is due (every 2 hours).
	LastCheck int64 `json:"lastCheck"`
	NextCheck int64 `json:"nextCheck"`
	// Filling in stores that weren't completely saved.
	Unfinished int    `json:"unfinished"` // stores that aren't completely saved yet
	FillStore  string `json:"fillStore"`  // the store being filled in now
	FillPage   int    `json:"fillPage"`   // the page it's on
	FillPages  int    `json:"fillPages"`  // how many pages that store has
	Filled     int    `json:"filled"`     // items added by filling in (this session)
}

// How often the new-items check runs by itself. "⟳ Check now" runs it at any time.
const newCheckEvery = 2 * time.Hour

type NewChecker struct {
	mu       sync.Mutex
	lib      *Library
	crawl    *Crawler
	st       NewCheckStatus
	queued   []string      // stores to check soon (e.g. a password was just entered)
	checkNow bool          // "⟳ Check now" was pressed
	wake     chan struct{} // wakes the worker up when it's waiting
	fetched  bool          // a page has been read already, so wait before the next one
}

func NewNewChecker(lib *Library, crawl *Crawler) *NewChecker {
	return &NewChecker{lib: lib, crawl: crawl, wake: make(chan struct{}, 1)}
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

func (c *NewChecker) poke() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// Start: with nil, "⟳ Check now" — check every store for new items right away (if it's filling in a
// store, it stops after the page it's on, checks, then carries on filling). With store addresses
// (e.g. a password was just entered), checks just those, also right away.
func (c *NewChecker) Start(hosts []string) NewCheckStatus {
	c.mu.Lock()
	if hosts == nil {
		if !c.st.Checking {
			c.checkNow = true
		}
	} else {
		c.queued = append(c.queued, hosts...)
	}
	st := c.st
	c.mu.Unlock()
	c.poke()
	return st
}

// Pages read per store at most in one check (a store adding more than this between two
// checks is very unlikely).
const newCheckMaxPages = 30

// Run is the background worker, started once when the app opens. First it fills in stores that
// aren't completely saved; the new-items check runs when it's due (every 2 hours, between stores
// being filled in) or right away when you press "⟳ Check now".
func (c *NewChecker) Run() {
	last := c.lib.lastNewCheck()
	c.update(func(s *NewCheckStatus) {
		s.Started, s.LastCheck = time.Now().UnixMilli(), last
		s.NextCheck = c.nextDue(last)
	})
	for {
		c.update(func(s *NewCheckStatus) { s.Running = true })
		ok := c.runQueued()
		// Filling in comes first; only "Check now" goes ahead of it.
		if ok && c.checkDue(true) {
			ok = c.newItemsCheck()
		}
		for ok {
			host := c.lib.nextStoreToFill()
			c.update(func(s *NewCheckStatus) { s.Unfinished = c.lib.countStoresToFill() })
			if host == "" {
				break
			}
			ok = c.fillStore(host)
			// Between stores: an automatic check that came due, or anything asked for meanwhile.
			if ok && c.checkDue(false) {
				ok = c.newItemsCheck()
			}
		}
		// Every store filled in: now the automatic check, if it's due. It can find stores that need
		// filling in (e.g. the first time), so go round again afterwards.
		if ok && c.checkDue(false) {
			if ok = c.newItemsCheck(); ok {
				continue
			}
		}
		// Nothing to do: wait until the next check is due, or until "Check now" / a password.
		// If Yupoo stopped answering, try again in 15 minutes.
		wait := time.Until(time.UnixMilli(c.Status().NextCheck))
		if !ok {
			wait = 15 * time.Minute
		}
		c.mu.Lock()
		c.st.Running, c.st.Store, c.st.FillStore = false, "", ""
		c.mu.Unlock()
		if wait < time.Second {
			wait = time.Second
		}
		select {
		case <-c.wake:
		case <-time.After(wait):
		}
		c.update(func(s *NewCheckStatus) { s.Failed = false })
	}
}

func (c *NewChecker) nextDue(last int64) int64 {
	if last == 0 {
		return time.Now().UnixMilli()
	}
	return time.UnixMilli(last).Add(newCheckEvery).UnixMilli()
}

// checkDue: "Check now" was pressed, or (unless onlyAsked) 2 hours have passed since the last check.
func (c *NewChecker) checkDue(onlyAsked bool) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.checkNow {
		return true
	}
	return !onlyAsked && time.Now().UnixMilli() >= c.st.NextCheck
}

// newItemsCheck looks through every store for new items. False if Yupoo stopped answering.
func (c *NewChecker) newItemsCheck() bool {
	hosts := c.lib.storeHosts()
	c.mu.Lock()
	c.checkNow = false
	c.st.Checking = true
	c.st.Stores, c.st.Done, c.st.Found, c.st.First, c.st.Skipped, c.st.Locked = len(hosts), 0, 0, 0, 0, 0
	c.mu.Unlock()
	ok := c.checkStores(hosts)
	now := time.Now().UnixMilli()
	if ok {
		c.lib.setLastNewCheck(now)
	}
	c.mu.Lock()
	c.st.Checking, c.st.Store, c.st.Finished = false, "", now
	if ok {
		c.st.LastCheck = now
		c.st.NextCheck = c.nextDue(now)
	}
	c.mu.Unlock()
	return ok
}

// runQueued checks stores asked for meanwhile (e.g. a password was just entered). False if Yupoo
// stopped answering.
func (c *NewChecker) runQueued() bool {
	c.mu.Lock()
	q := c.queued
	c.queued = nil
	c.mu.Unlock()
	if len(q) == 0 {
		return true
	}
	c.mu.Lock()
	c.st.Stores, c.st.Done = len(q), 0
	c.mu.Unlock()
	return c.checkStores(q)
}

// pace waits between pages: 1.5–2.5 seconds so Yupoo doesn't block you, and never at the same
// time as "Save whole store".
func (c *NewChecker) pace() {
	if c.fetched {
		time.Sleep(1500*time.Millisecond + time.Duration(rand.Intn(1000))*time.Millisecond)
	}
	for c.crawl.Status().Running {
		time.Sleep(3 * time.Second)
	}
	c.fetched = true
}

func (c *NewChecker) cookieFor(store string) string {
	if pw := c.lib.StorePassword(store); pw != "" {
		return "indexlockcode=" + encodeURIComponent(pw)
	}
	return ""
}

// The store's total on its first page: "共3995个相册" (or "in total 3995 albums").
var reStoreTotal = regexp.MustCompile(`共\s*([0-9]+)\s*个相册|in\s+total\s+([0-9]+)\s+albums?`)

func storeTotal(body string) int {
	m := reStoreTotal.FindStringSubmatch(body)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1] + m[2])
	return n
}

// checkStores looks through the given stores one by one. It returns false if Yupoo stopped answering.
func (c *NewChecker) checkStores(hosts []string) bool {
	failsInARow := 0
	for _, host := range hosts {
		store := strings.Split(host, ".")[0]
		c.update(func(s *NewCheckStatus) { s.Store = store })
		mark, known := c.lib.newCheckMark(host)
		cookie := c.cookieFor(store)
		list := &url.URL{Scheme: "https", Host: host, Path: "/categories"}
		top, prevSig, maxPage, failed, locked := mark, "", 0, false, false
		for page := 1; page <= newCheckMaxPages; page++ {
			if !c.lib.hasHost(host) {
				break // the store was removed from the library meanwhile
			}
			c.pace()
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
				// Is the whole store saved? If not, it's filled in after the quick check.
				if total := storeTotal(body); total > 0 {
					c.lib.setStoreTotal(host, total)
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

// fillStore reads every page of a store that isn't completely saved and saves what's missing
// (as ordinary items, not New Additions — they're old items you just didn't have). It notes the
// page it got to, so it carries on from there next time. False if Yupoo stopped answering.
func (c *NewChecker) fillStore(host string) bool {
	store := strings.Split(host, ".")[0]
	cookie := c.cookieFor(store)
	total := c.lib.storeTotalOf(host)
	start := 1
	if f, ok := c.lib.storeFill(host); ok && !f.Done && f.Page > 1 {
		// Carry on where it stopped. The store may have added items since, which pushes
		// everything further back, so start a little earlier (already-saved items are skipped).
		start = f.Page - 1 - max(0, total-f.Total)/100
		if start < 1 {
			start = 1
		}
	}
	list := &url.URL{Scheme: "https", Host: host, Path: "/categories"}
	c.update(func(s *NewCheckStatus) { s.FillStore, s.FillPage, s.FillPages = store, start, 0 })
	maxPage, prevSig := 0, ""
	for page := start; page <= 5000; page++ {
		if !c.lib.hasHost(host) {
			return true // removed from the library meanwhile
		}
		// Stores asked for meanwhile (e.g. a password was just entered) and "⟳ Check now" go
		// first; then filling carries on from this page.
		if !c.runQueued() {
			return false
		}
		if c.checkDue(true) && !c.newItemsCheck() {
			return false
		}
		c.update(func(s *NewCheckStatus) { s.Store = "" })
		c.pace()
		body, err := fetchPage(pageURLFor(list, page), "https://"+host+"/", cookie)
		if err != nil {
			c.update(func(s *NewCheckStatus) { s.Failed = true })
			return false // carries on from this page next time
		}
		if n := detectMaxPage(body); n > maxPage {
			maxPage = n
		}
		found := extractAlbums(body, host)
		ids := make([]string, len(found))
		for i, a := range found {
			ids[i] = a.ID
		}
		sig := strings.Join(ids, ",")
		if len(found) == 0 || sig == prevSig {
			break
		}
		added, _ := c.lib.saveAlbums(found, false)
		c.lib.setStoreFill(host, StoreFill{Page: page + 1, Total: total})
		c.update(func(s *NewCheckStatus) { s.Filled += added; s.FillPage, s.FillPages = page, maxPage })
		if maxPage > 0 && page >= maxPage {
			break
		}
		prevSig = sig
	}
	// Every page read. Some albums may still be missing (ones the reader can't see); remember how
	// many, so the store is only filled in again if more go missing.
	c.lib.setStoreFill(host, StoreFill{Done: true, Total: total, Gap: max(0, total-c.lib.countHost(host))})
	c.update(func(s *NewCheckStatus) { s.FillStore = "" })
	return true
}

// ---------- store passwords ----------

// encodeURIComponent writes a password the way Yupoo's own page puts it in its cookie.
func encodeURIComponent(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }

var (
	errWrongPassword    = errors.New("wrong password")
	errNoPasswordNeeded = errors.New("no password needed")
)

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
	if !needs {
		// The store took its password off: nothing to save, just check it again.
		a.lib.SetStorePassword(store, "")
		if host := a.lib.hostOf(store); host != "" {
			a.check.Start([]string{host})
		}
		return errNoPasswordNeeded
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

// ---------- is the whole store saved? ----------

// countHost is how many items from this store address are in the library.
func (l *Library) countHost(host string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, a := range l.data.Albums {
		if strings.EqualFold(a.Host, host) {
			n++
		}
	}
	return n
}

func (l *Library) storeTotalOf(host string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.data.StoreTotals[host]
}

func (l *Library) setStoreTotal(host string, total int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.data.StoreTotals[host] != total {
		l.data.StoreTotals[host] = total
		l.scheduleSave()
	}
}

func (l *Library) storeFill(host string) (StoreFill, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if f := l.data.StoreFill[host]; f != nil {
		return *f, true
	}
	return StoreFill{}, false
}

func (l *Library) setStoreFill(host string, f StoreFill) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data.StoreFill[host] = &f
	l.scheduleSave()
}

// nextStoreToFill is a store that isn't completely saved (smallest gap first, so small stores
// finish quickly instead of waiting behind a huge one), or "" if every store is complete.
func (l *Library) nextStoreToFill() string {
	best, bestGap := "", 0
	for _, h := range l.storeHosts() {
		if !l.needsFill(h) || l.storeIsLocked(strings.Split(h, ".")[0]) {
			continue
		}
		if gap := l.storeTotalOf(h) - l.countHost(h); best == "" || gap < bestGap {
			best, bestGap = h, gap
		}
	}
	return best
}

func (l *Library) countStoresToFill() int {
	n := 0
	for _, h := range l.storeHosts() {
		if l.needsFill(h) && !l.storeIsLocked(strings.Split(h, ".")[0]) {
			n++
		}
	}
	return n
}

func (l *Library) lastNewCheck() int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.data.LastNewCheck
}

func (l *Library) setLastNewCheck(t int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data.LastNewCheck = t
	l.scheduleSave()
}

// needsFill: Yupoo shows more albums for this store than the library has (and more are missing
// than last time every page was read — a few the reader can't see don't count every time).
func (l *Library) needsFill(host string) bool {
	total, have := l.storeTotalOf(host), l.countHost(host)
	if total == 0 || have >= total {
		return false
	}
	if f, ok := l.storeFill(host); ok && f.Done && total-have <= f.Gap {
		return false
	}
	return true
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
