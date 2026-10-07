package main

import (
	"errors"
	"html"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// "Save whole store" runs here, inside the app, so it keeps going while you
// browse other pages or the Library. Only one store is saved at a time.

// CrawlStatus is what the progress bar shows. The page reads it about once a second.
type CrawlStatus struct {
	Active  bool   `json:"active"`  // there is something to show (running, or finished and not dismissed)
	Running bool   `json:"running"` // still saving
	Host    string `json:"host"`
	Store   string `json:"store"`
	Link    string `json:"link"` // where "Open store" goes
	Page    int    `json:"page"`
	MaxPage int    `json:"maxPage"`
	Seen    int    `json:"seen"`
	New     int    `json:"new"`
	Msg     string `json:"msg"` // set when finished: done / stopped / Yupoo stopped answering
	Failed  bool   `json:"failed"`
	// Kind says which finished message Msg is ("done", "stopped", "blocked", "empty"), so the pages can show it in your language.
	Kind     string `json:"kind,omitempty"`
	Started  int64  `json:"started"`
	Finished int64  `json:"finished"`
	// How the progress is being shown, so the next page can carry on the same way.
	UIMode string `json:"uiMode"` // "bar" (on the store) or "corner" (anywhere else)
	UIMin  bool   `json:"uiMin"`  // shrunk to the small round badge
}

type Crawler struct {
	mu   sync.Mutex
	lib  *Library
	st   CrawlStatus
	stop chan struct{}
}

func NewCrawler(lib *Library) *Crawler { return &Crawler{lib: lib} }

func (c *Crawler) Status() CrawlStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.st
}

// Start begins saving the store that pageURL belongs to. If pageURL is a category
// or search page, only that category or search is saved.
func (c *Crawler) Start(pageURL, cookie string) (CrawlStatus, error) {
	u, err := url.Parse(pageURL)
	// x.yupoo.com/photos/<store>/... is the same store as <store>.x.yupoo.com/...
	if err == nil && strings.EqualFold(u.Hostname(), "x.yupoo.com") {
		if m := rePhotosPath.FindStringSubmatch(u.Path); m != nil {
			rest := m[2]
			if rest == "" {
				rest = "/categories"
			}
			u = &url.URL{Scheme: "https", Host: strings.ToLower(m[1]) + ".x.yupoo.com", Path: rest, RawQuery: u.RawQuery}
		}
	}
	if err != nil || !strings.HasSuffix(strings.ToLower(u.Hostname()), ".x.yupoo.com") {
		return c.Status(), errors.New("that isn't a Yupoo store page")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.st.Running {
		return c.st, errors.New("Already saving " + c.st.Store + ". Stop it first, or wait for it to finish.")
	}
	host := strings.ToLower(u.Hostname())
	list := listURL(u)
	c.stop = make(chan struct{})
	c.st = CrawlStatus{Active: true, Running: true, Host: host, Store: strings.Split(host, ".")[0],
		Link: list.String(), Page: 1, Started: time.Now().UnixMilli(), UIMode: c.st.UIMode, UIMin: c.st.UIMin}
	go c.run(list, cookie, c.stop)
	return c.st, nil
}

func (c *Crawler) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.st.Running && c.stop != nil {
		close(c.stop)
		c.stop = nil
	}
}

// Dismiss hides a finished save's message.
func (c *Crawler) Dismiss() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.st.Running {
		c.st.Active = false
	}
}

func (c *Crawler) SetUI(mode string, min bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.st.UIMode, c.st.UIMin = mode, min
}

// CrawlReply answers every progress-bar request: the latest status, plus a message if something went wrong.
type CrawlReply struct {
	Status CrawlStatus `json:"status"`
	Error  string      `json:"error,omitempty"`
}

// crawlAction is shared by the app window and the test-mode API.
func (a *App) crawlAction(act, pageURL, cookie, mode string, min bool) CrawlReply {
	var err error
	switch act {
	case "start":
		_, err = a.crawl.Start(pageURL, cookie)
	case "stop":
		a.crawl.Stop()
	case "dismiss":
		a.crawl.Dismiss()
	case "ui":
		a.crawl.SetUI(mode, min)
	}
	r := CrawlReply{Status: a.crawl.Status()}
	if err != nil {
		r.Error = err.Error()
	}
	return r
}

func (c *Crawler) update(f func(s *CrawlStatus)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f(&c.st)
}

func (c *Crawler) finish(kind, msg string, failed bool) {
	c.update(func(s *CrawlStatus) {
		s.Running, s.Msg, s.Kind, s.Failed, s.Finished = false, msg, kind, failed, time.Now().UnixMilli()
	})
}

// listURL is the page list to walk: the category or search you were on, otherwise the
// all-categories page (/categories), which lists every item — /albums only shows part of the store.
func listURL(u *url.URL) *url.URL {
	out := &url.URL{Scheme: "https", Host: u.Host, Path: "/categories"}
	if strings.HasPrefix(u.Path, "/categories") || strings.HasPrefix(u.Path, "/search") {
		out.Path, out.RawQuery = u.Path, u.RawQuery
	}
	q := out.Query()
	q.Del("page")
	out.RawQuery = q.Encode()
	return out
}

func pageURLFor(list *url.URL, n int) string {
	u := *list
	q := u.Query()
	q.Set("page", strconv.Itoa(n))
	u.RawQuery = q.Encode()
	return u.String()
}

var crawlClient = &http.Client{Timeout: 30 * time.Second}

func (c *Crawler) run(list *url.URL, cookie string, stop chan struct{}) {
	host := list.Host
	origin := "https://" + host
	prevSig := ""
	maxPage, seen, added := 0, 0, 0
	stopped := func() bool {
		select {
		case <-stop:
			c.finish("stopped", "Stopped — "+strconv.Itoa(added)+" new items saved.", false)
			return true
		default:
			return false
		}
	}
	for page := 1; ; page++ {
		if stopped() {
			return
		}
		c.update(func(s *CrawlStatus) { s.Page = page })
		body, err := fetchPage(pageURLFor(list, page), origin+"/", cookie)
		if err != nil {
			c.finish("blocked", "Yupoo stopped answering on page "+strconv.Itoa(page)+". Wait a minute, then try again — saved items are kept.", true)
			return
		}
		if page == 1 {
			maxPage = detectMaxPage(body)
			c.update(func(s *CrawlStatus) { s.MaxPage = maxPage })
		}
		found := extractAlbums(body, host)
		ids := make([]string, len(found))
		for i, a := range found {
			ids[i] = a.ID
		}
		sig := strings.Join(ids, ",")
		done := "Done — " + strconv.Itoa(seen) + " items in this store, " + strconv.Itoa(added) + " new."
		if len(found) == 0 || sig == prevSig {
			if page == 1 {
				c.finish("empty", "Couldn't find any items on this store's pages.", true)
			} else {
				c.finish("done", done, false)
			}
			return
		}
		n, _ := c.lib.SaveAlbums(found)
		added += n
		seen += len(found)
		c.update(func(s *CrawlStatus) { s.Seen, s.New = seen, added })
		if (maxPage > 0 && page >= maxPage) || page >= 500 {
			c.finish("done", "Done — "+strconv.Itoa(seen)+" items in this store, "+strconv.Itoa(added)+" new.", false)
			return
		}
		prevSig = sig
		// Go slowly so Yupoo doesn't block you (1.5–2.5 seconds between pages).
		select {
		case <-stop:
		case <-time.After(1500*time.Millisecond + time.Duration(rand.Intn(1000))*time.Millisecond):
		}
	}
}

func fetchPage(pageURL, referer, cookie string) (string, error) {
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Referer", referer)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	res, err := crawlClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", errors.New(res.Status)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 20<<20))
	return string(b), err
}

// ---------- reading a store page (same rules as capture.js) ----------

var (
	rePhotosPath   = regexp.MustCompile(`^/photos/([^/]+)(/.*)?$`)
	rePhotosPrefix = regexp.MustCompile(`^/photos/[^/]+`)
	reAnchor       = regexp.MustCompile(`(?is)<a\b([^>]*)>(.*?)</a>`)
	reAlbumID      = regexp.MustCompile(`/albums/(\d+)`)
	reImg          = regexp.MustCompile(`(?is)<img\b([^>]*)>`)
	reTitleEl      = regexp.MustCompile(`(?is)<(\w+)\b[^>]*\bclass\s*=\s*["'][^"']*title[^"']*["'][^>]*>(.*?)</(\w+)>`)
	reNumberEl     = regexp.MustCompile(`(?is)<(\w+)\b[^>]*\bclass\s*=\s*["'][^"']*number[^"']*["'][^>]*>(.*?)</(\w+)>`)
	reTag          = regexp.MustCompile(`(?s)<[^>]*>`)
	reSpaces       = regexp.MustCompile(`\s+`)
	rePageLink     = regexp.MustCompile(`[?&](?:amp;)?page=(\d+)`)
	rePageIn       = regexp.MustCompile(`(?is)<input\b[^>]*\bname\s*=\s*["']page["'][^>]*>`)
	rePageText     = regexp.MustCompile(`(?i)共\s*(\d+)\s*页|of\s+(\d+)\s+pages?`)
	attrRes        sync.Map
)

// attr reads one attribute (e.g. href) from the inside of a tag.
func attr(tag, name string) string {
	re, ok := attrRes.Load(name)
	if !ok {
		re, _ = attrRes.LoadOrStore(name, regexp.MustCompile(`(?is)(?:^|\s)`+regexp.QuoteMeta(name)+`\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`))
	}
	m := re.(*regexp.Regexp).FindStringSubmatch(tag)
	if m == nil {
		return ""
	}
	return html.UnescapeString(m[1] + m[2] + m[3])
}

func cleanText(s string) string {
	return strings.TrimSpace(reSpaces.ReplaceAllString(html.UnescapeString(reTag.ReplaceAllString(s, " ")), " "))
}

func absURL(u, origin string) string {
	switch {
	case u == "" || strings.HasPrefix(u, "data:"):
		return ""
	case strings.HasPrefix(u, "//"):
		return "https:" + u
	case strings.HasPrefix(u, "/"):
		return origin + u
	}
	return u
}

func extractAlbums(body, host string) []AlbumIn {
	origin := "https://" + host
	store := strings.Split(host, ".")[0]
	var out []AlbumIn
	index := map[string]int{}
	for _, pos := range reAnchor.FindAllStringSubmatchIndex(body, -1) {
		m := []string{body[pos[0]:pos[1]], body[pos[2]:pos[3]], body[pos[4]:pos[5]]}
		href := attr(m[1], "href")
		// A password-locked album has no href: its link is in data-href, its title says only
		// "加密相册" (locked album), and the real name is in the album__title just after it.
		locked := href == ""
		if locked {
			href = attr(m[1], "data-href")
		}
		id := reAlbumID.FindStringSubmatch(href)
		img := reImg.FindStringSubmatch(m[2])
		if id == nil || img == nil {
			continue
		}
		title := cleanText(attr(m[1], "title"))
		if locked {
			title = ""
			after := body[pos[1]:min(len(body), pos[1]+800)]
			if end := strings.Index(after, "<a "); end != -1 {
				after = after[:end] // only up to the next album
			}
			if t := reTitleEl.FindStringSubmatch(after); t != nil {
				title = cleanText(t[2])
			}
		}
		if title == "" {
			if t := reTitleEl.FindStringSubmatch(m[2]); t != nil {
				title = cleanText(t[2])
			}
		}
		if title == "" {
			title = cleanText(attr(img[1], "alt"))
		}
		if title == "" {
			title = cleanText(m[2])
		}
		cover := attr(img[1], "data-origin-src")
		if cover == "" {
			cover = attr(img[1], "data-src")
		}
		if cover == "" {
			cover = attr(img[1], "src")
		}
		count := 0
		if n := reNumberEl.FindStringSubmatch(m[2]); n != nil {
			count, _ = strconv.Atoi(cleanText(n[2]))
		}
		link := origin + "/albums/" + id[1] + "?uid=1"
		if u, err := url.Parse(href); err == nil {
			r := (&url.URL{Scheme: "https", Host: host}).ResolveReference(u)
			r.RawQuery, r.Fragment = "uid=1", ""
			r.Path = rePhotosPrefix.ReplaceAllString(r.Path, "") // /photos/<store>/albums/1 -> /albums/1
			link = r.String()
		}
		a := AlbumIn{Host: host, Store: store, ID: id[1], Title: title, Cover: absURL(cover, origin), Count: count, Link: link}
		if i, seen := index[a.ID]; seen {
			if out[i].Title == "" && a.Title != "" {
				out[i] = a
			}
			continue
		}
		index[a.ID] = len(out)
		out = append(out, a)
	}
	return out
}

func detectMaxPage(body string) int {
	max := 0
	for _, m := range rePageLink.FindAllStringSubmatch(body, -1) {
		if n, _ := strconv.Atoi(m[1]); n > max {
			max = n
		}
	}
	for _, tag := range rePageIn.FindAllString(body, -1) {
		if n, _ := strconv.Atoi(attr(tag, "max")); n > max {
			max = n
		}
	}
	if m := rePageText.FindStringSubmatch(cleanText(body)); m != nil {
		if n, _ := strconv.Atoi(m[1] + m[2]); n > max {
			max = n
		}
	}
	return max
}
