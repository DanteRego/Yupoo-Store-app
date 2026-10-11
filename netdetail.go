package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Detailed descriptions of web requests (photos, store pages, GitHub), so a failure says exactly what
// came back — answer code, kind of content, size, time taken, the page title, which server answered and
// its request ID — instead of just "not an image". Used by the downloaders, the app log and the check-up.

// FetchError is a failed request with everything we know about it.
type FetchError struct {
	URL         string
	Code        int    // HTTP answer code (0 if no answer at all)
	Status      string // e.g. "567 Unknown Status"
	ContentType string
	Size        int
	Took        time.Duration
	Server      string // e.g. "TencentEdgeOne"
	RequestID   string // the security service's request ID (EO-LOG-UUID), if any
	Title       string // the page's title, when a web page came back instead of a photo
	Snippet     string // the start of that page (spaces squeezed), to see what it is
	Blocked     bool   // Yupoo's security service refused the request
	Reason      string // short plain-words reason
	Err         error  // network error (no answer)
}

func (e *FetchError) Error() string {
	var b strings.Builder
	b.WriteString(e.Reason)
	var parts []string
	if e.Code != 0 {
		parts = append(parts, "HTTP "+e.Status)
	}
	if e.ContentType != "" {
		parts = append(parts, e.ContentType)
	}
	if e.Size > 0 {
		parts = append(parts, fmt.Sprintf("%.1f KB", float64(e.Size)/1024))
	}
	if e.Took > 0 {
		parts = append(parts, fmt.Sprintf("%d ms", e.Took.Milliseconds()))
	}
	if e.Server != "" {
		parts = append(parts, "server "+e.Server)
	}
	if e.RequestID != "" {
		parts = append(parts, "request ID "+e.RequestID)
	}
	if e.Title != "" {
		parts = append(parts, "page title “"+e.Title+"”")
	}
	if e.Err != nil {
		parts = append(parts, e.Err.Error())
	}
	if len(parts) > 0 {
		b.WriteString(" (" + strings.Join(parts, ", ") + ")")
	}
	if e.URL != "" {
		b.WriteString(" — " + e.URL)
	}
	if e.Snippet != "" && e.Blocked {
		b.WriteString(" — page starts: " + e.Snippet)
	}
	return b.String()
}

// Is lets errors.Is(err, errPhotoBlocked) recognise a block.
func (e *FetchError) Is(target error) bool { return target == errPhotoBlocked && e.Blocked }

var reTitle = regexp.MustCompile(`(?is)<title[^>]*>([^<]*)</title>`)

// describe builds a FetchError for an answer that wasn't what we wanted (body may be partial).
func describe(u string, res *http.Response, body []byte, took time.Duration, reason string) *FetchError {
	e := &FetchError{URL: u, Took: took, Reason: reason, Size: len(body)}
	if res != nil {
		e.Code, e.Status = res.StatusCode, res.Status
		e.ContentType = res.Header.Get("Content-Type")
		e.Server = res.Header.Get("Server")
		e.RequestID = firstNonEmpty(res.Header.Get("EO-LOG-UUID"), res.Header.Get("X-Nws-Log-Uuid"), res.Header.Get("X-Request-Id"))
	}
	if e.ContentType == "" && len(body) > 0 {
		e.ContentType = http.DetectContentType(body)
	}
	if strings.Contains(strings.ToLower(e.ContentType), "html") || strings.Contains(strings.ToLower(e.ContentType), "text") {
		s := strings.Join(strings.Fields(string(body)), " ")
		if r := []rune(s); len(r) > 400 {
			s = string(r[:400]) + "…"
		}
		e.Snippet = s
	}
	if m := reTitle.FindSubmatch(body); m != nil {
		e.Title = strings.TrimSpace(string(m[1]))
	}
	low := strings.ToLower(string(body))
	if e.Code == 567 || strings.Contains(strings.ToLower(e.Server), "edgeone") && e.Code >= 400 ||
		strings.Contains(low, "edgeone") || strings.Contains(low, "restricted access") || strings.Contains(string(body), "请求已被") {
		e.Blocked = true
		e.Reason = "blocked by Yupoo's security service (Tencent EdgeOne \"Restricted Access\")"
		if e.Title == "" {
			e.Title = "Restricted Access"
		}
	}
	return e
}

// netErr describes a request that got no answer at all (no internet, timeout, name not found…).
func netErr(u string, err error, took time.Duration) *FetchError {
	reason := "no answer"
	s := err.Error()
	switch {
	case strings.Contains(s, "no such host"):
		reason = "the address couldn't be found (DNS)"
	case strings.Contains(s, "Timeout") || strings.Contains(s, "deadline exceeded"):
		reason = "timed out"
	case strings.Contains(s, "refused"):
		reason = "connection refused"
	case strings.Contains(s, "proxyconnect"):
		reason = "the proxy didn't answer"
	case strings.Contains(s, "certificate"):
		reason = "secure-connection (certificate) problem"
	case strings.Contains(s, "reset"):
		reason = "connection was cut off"
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return &FetchError{URL: u, Took: took, Reason: reason, Err: err}
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}

// ---------- the app log (app-log.txt next to library.json) ----------
// Problems are written here as they happen (photos, store pages, New Additions, Save whole store,
// updates, exports). The check-up summarises the last day and includes the latest lines. The same
// message is written at most once a minute, so a long block doesn't fill the log. Over 1 MB it starts
// afresh (the previous one is kept as app-log.old.txt).

var appLog struct {
	sync.Mutex
	dir  string
	last map[string]time.Time
}

func setAppLogDir(dir string) {
	appLog.Lock()
	appLog.dir, appLog.last = dir, map[string]time.Time{}
	appLog.Unlock()
}

func appLogPath() string {
	appLog.Lock()
	defer appLog.Unlock()
	if appLog.dir == "" {
		return ""
	}
	return filepath.Join(appLog.dir, "app-log.txt")
}

// logEvent writes one line: "2026-10-11 02:38:06 [photos] …".
func logEvent(area, format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	appLog.Lock()
	if appLog.dir == "" {
		appLog.Unlock()
		return
	}
	// Same area + message (ignoring the address/IDs that change every time) at most once a minute.
	key := area + "|" + strings.SplitN(msg, " (", 2)[0]
	if t, ok := appLog.last[key]; ok && time.Since(t) < time.Minute {
		appLog.Unlock()
		return
	}
	appLog.last[key] = time.Now()
	p := filepath.Join(appLog.dir, "app-log.txt")
	appLog.Unlock()
	if st, err := os.Stat(p); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(p, filepath.Join(filepath.Dir(p), "app-log.old.txt"))
	}
	line := time.Now().Format("2006-01-02 15:04:05") + " [" + area + "] " + strings.ReplaceAll(msg, "\n", " ") + "\n"
	if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		_, _ = f.WriteString(line)
		f.Close()
	}
}

// ---------- using the Windows proxy (e.g. a VPN like Clash) as a second route ----------
// The built-in browser follows the proxy set in Windows' Internet settings, but the app's own downloads
// go out directly. Where direct downloads are blocked — e.g. Yupoo's photo server in mainland China,
// or GitHub there — the same request is tried again through that proxy.

// winProxyURL is the Windows proxy as an address the app can use, or nil (none, or only a setup script).
func winProxyURL() *url.URL {
	if t := os.Getenv("KIT_TEST_PROXY"); t != "" { // used only for testing
		u, _ := url.Parse(t)
		return u
	}
	s := strings.TrimSpace(systemProxy())
	if s == "" || strings.HasPrefix(s, "automatic script") {
		return nil
	}
	addr, scheme := s, "http"
	if strings.Contains(s, "=") { // "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891"
		byKind := map[string]string{}
		for _, part := range strings.Split(s, ";") {
			if kv := strings.SplitN(strings.TrimSpace(part), "=", 2); len(kv) == 2 {
				byKind[strings.ToLower(kv[0])] = kv[1]
			}
		}
		switch {
		case byKind["https"] != "":
			addr = byKind["https"]
		case byKind["http"] != "":
			addr = byKind["http"]
		case byKind["socks"] != "":
			addr, scheme = byKind["socks"], "socks5"
		default:
			return nil
		}
	}
	if i := strings.Index(addr, "://"); i >= 0 {
		scheme, addr = addr[:i], addr[i+3:]
	}
	u, err := url.Parse(scheme + "://" + addr)
	if err != nil || u.Host == "" {
		return nil
	}
	return u
}

var proxyClients struct {
	sync.Mutex
	key string
	c   map[time.Duration]*http.Client
}

// viaWindowsProxy is a client that goes through the Windows proxy, or nil if there isn't one.
func viaWindowsProxy(timeout time.Duration) *http.Client {
	p := winProxyURL()
	if p == nil {
		return nil
	}
	proxyClients.Lock()
	defer proxyClients.Unlock()
	if proxyClients.key != p.String() {
		proxyClients.key, proxyClients.c = p.String(), map[time.Duration]*http.Client{}
	}
	if c := proxyClients.c[timeout]; c != nil {
		return c
	}
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: http.ProxyURL(p), TLSHandshakeTimeout: 15 * time.Second}}
	proxyClients.c[timeout] = c
	return c
}

// doDirectOrProxy sends a request directly and, if that gets no answer or an error answer (common for
// GitHub in mainland China), sends it again through the Windows proxy when there is one.
func doDirectOrProxy(timeout time.Duration, newReq func() (*http.Request, error)) (*http.Response, error) {
	req, err := newReq()
	if err != nil {
		return nil, err
	}
	// Direct first; give up on it after 30 s without an answer (the proxy may still work).
	direct := &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 30 * time.Second}}
	res, err := direct.Do(req)
	if err == nil && res.StatusCode < 400 || err == nil && res.StatusCode == http.StatusNotFound {
		return res, nil
	}
	c := viaWindowsProxy(timeout)
	if c == nil {
		return res, err
	}
	why := "no answer"
	if err != nil {
		why = err.Error()
	} else {
		why = res.Status
		res.Body.Close()
	}
	req2, e2 := newReq()
	if e2 != nil {
		return nil, e2
	}
	res2, err2 := c.Do(req2)
	if err2 != nil {
		return nil, fmt.Errorf("direct: %s; through the Windows proxy %s: %v", why, winProxyURL(), err2)
	}
	logEvent("network", "%s didn't work directly (%s), so it went through the Windows proxy %s (answer: %s)", req2.URL.Host, why, winProxyURL(), res2.Status)
	return res2, nil
}
