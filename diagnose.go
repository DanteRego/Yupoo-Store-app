package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// The ⚙ Settings page's "🩺 Run a check-up": tests everything the app depends on and explains any
// problem in plain words (English and Chinese — the page shows the one you use). It also collects a
// "Technical details" section — exact answers from Yupoo/GitHub (answer code, server, request ID, time
// taken), the computer's setup, what the background jobs are doing and the latest lines of the app log —
// which "📋 Copy report" includes, so a problem on someone else's computer can be worked out from it.

type Check struct {
	Status   string `json:"status"` // "ok", "warn" or "fail"
	Name     string `json:"name"`
	NameZh   string `json:"nameZh"`
	Detail   string `json:"detail"`
	DetailZh string `json:"detailZh"`
}

type Diagnosis struct {
	Checks  []Check  `json:"checks"`
	Details []string `json:"details"` // the technical section (plain English, for debugging)
	Version string   `json:"version"`
	System  string   `json:"system"`
	Time    string   `json:"time"`
}

var appStarted = time.Now()

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0"

func (a *App) Diagnose() Diagnosis {
	d := Diagnosis{Version: AppVersion, System: osVersion() + " " + runtime.GOARCH, Time: time.Now().Format("2006-01-02 15:04:05")}
	add := func(status, name, nameZh, detail, detailZh string) {
		d.Checks = append(d.Checks, Check{status, name, nameZh, detail, detailZh})
	}
	section := func(title string) { d.Details = append(d.Details, "", "== "+title+" ==") }
	detail := func(format string, args ...interface{}) { d.Details = append(d.Details, fmt.Sprintf(format, args...)) }
	l := a.lib
	s := l.GetSettings()

	// ---------- this computer ----------
	section("This computer")
	zone, offset := time.Now().Zone()
	detail("App %s, %s, %s/%s, Go %s", AppVersion, osVersion(), runtime.GOOS, runtime.GOARCH, runtime.Version())
	detail("Time zone %s (UTC%+d), language %s, app language setting %q", zone, offset/3600, firstNonEmpty(userLocale(), "unknown"), firstNonEmpty(s.Language, "en"))
	detail("App running for %s; memory %.0f MB; %d background tasks", time.Since(appStarted).Round(time.Second), memMB(), runtime.NumGoroutine())
	detail("Proxy for the app's own downloads: %s; Windows proxy (used by the built-in browser): %s",
		firstNonEmpty(os.Getenv("HTTPS_PROXY"), os.Getenv("https_proxy"), os.Getenv("HTTP_PROXY"), "none"), firstNonEmpty(systemProxy(), "none"))
	for _, f := range []struct{ name, dir string }{{"Data folder", l.dir}, {"Photos folder", l.ThumbDir()}, {"Downloads folder", downloadsDir()}} {
		if free, ok := diskFree(f.dir); ok {
			detail("%s: %s — %.1f GB free", f.name, f.dir, float64(free)/(1<<30))
			if free < 1<<30 {
				add("warn", "Disk space", "磁盘空间", fmt.Sprintf("Only %.1f GB is free on the drive with the %s (%s). Saving may fail when it runs out.", float64(free)/(1<<30), strings.ToLower(f.name), f.dir),
					fmt.Sprintf("%s所在的磁盘只剩 %.1f GB（%s）。空间用完时可能无法保存。", f.dir, float64(free)/(1<<30), f.dir))
			}
		} else {
			detail("%s: %s", f.name, f.dir)
		}
	}

	// ---------- 1. the library file ----------
	l.mu.Lock()
	items, cols := len(l.data.Albums), len(l.data.Collections)
	missingCover := 0
	keys := make([]string, 0, len(l.data.Albums))
	stores := map[string]int{}
	var newest *Album
	var samples []*Album // up to 3 recent covers from different stores, for the photo test
	for k, al := range l.data.Albums {
		if al.Cover == "" {
			missingCover++
		}
		keys = append(keys, k)
		stores[strings.ToLower(al.Host)]++
		if al.Cover != "" && (newest == nil || al.LastSeen > newest.LastSeen) {
			newest = al
		}
	}
	badRefs := 0
	for _, c := range l.data.Collections {
		for _, it := range c.Items {
			if l.data.Albums[it.Key] == nil {
				badRefs++
			}
		}
	}
	locked := len(l.data.StoreLocked)
	withPassword := len(l.data.StorePasswords)
	type gap struct {
		host        string
		have, total int
	}
	var gaps []gap
	for h, total := range l.data.StoreTotals {
		if have := stores[h]; have < total {
			gaps = append(gaps, gap{h, have, total})
		}
	}
	lastCheck := l.data.LastNewCheck
	l.mu.Unlock()
	samples = l.photoSamples(3)
	section("Library")
	if st, err := os.Stat(l.file()); err != nil {
		if items == 0 {
			add("ok", "Library file", "图库文件", "No library saved yet — it's created when you save your first item.", "还没有保存图库——保存第一件商品时会自动创建。")
		} else {
			add("fail", "Library file", "图库文件", "library.json can't be found: "+err.Error()+". Your items are only in memory — use Export Saved Data now.",
				"找不到 library.json："+err.Error()+"。你的商品目前只在内存里——请立刻点“导出保存的数据”。")
		}
		detail("library.json: missing (%v)", err)
	} else {
		add("ok", "Library file", "图库文件",
			fmt.Sprintf("%d items from %d store%s, %d collections (%.1f MB, last saved %s).", items, len(stores), map[bool]string{true: "", false: "s"}[len(stores) == 1], cols, float64(st.Size())/1e6, st.ModTime().Format("Jan 2 15:04")),
			fmt.Sprintf("%d 件商品，来自 %d 个店铺，%d 个收藏夹（%.1f MB，最近保存于 %s）。", items, len(stores), cols, float64(st.Size())/1e6, st.ModTime().Format("01-02 15:04")))
		detail("library.json: %s, %.1f MB, saved %s; %d items, %d stores, %d collections, %d items without a cover",
			l.file(), float64(st.Size())/1e6, st.ModTime().Format("2006-01-02 15:04:05"), items, len(stores), cols, missingCover)
	}
	if broken, _ := filepath.Glob(l.file() + ".broken-*"); len(broken) > 0 {
		add("warn", "Damaged library copies", "损坏的图库副本",
			fmt.Sprintf("%d damaged library.json file(s) were set aside at some point (in %s). Your current library is fine; these can be deleted once you're sure nothing is missing.", len(broken), l.dir),
			fmt.Sprintf("曾经有 %d 个损坏的 library.json 被放到一边（在 %s）。现在的图库没问题；确认没有缺东西后可以删掉它们。", len(broken), l.dir))
		detail("Damaged copies set aside: %s", strings.Join(broken, ", "))
	}

	// ---------- 2. can the app save? ----------
	if err := writeProbe(l.dir); err != nil {
		add("fail", "Saving changes", "保存修改", "The app can't write to its data folder ("+l.dir+"): "+err.Error()+". Changes won't be saved.",
			"程序无法写入它的数据文件夹（"+l.dir+"）："+err.Error()+"。修改不会被保存。")
	} else {
		add("ok", "Saving changes", "保存修改", "The data folder can be written to.", "数据文件夹可以正常写入。")
	}

	// ---------- 3. photos on disk ----------
	section("Photos")
	tdir := l.ThumbDir()
	if strings.HasPrefix(strings.ToUpper(l.DefaultThumbDir()), `M:\`) || strings.HasPrefix(strings.ToUpper(tdir), `M:\`) {
		if _, err := os.Stat(`M:\`); err != nil {
			add("warn", "M: drive", "M: 盘", "The M: drive isn't connected, so photos are being saved next to the library instead. Plug it in and restart the app to use it again.",
				"M: 盘没有连接，所以图片暂时保存在图库旁边。插上它并重启程序即可重新使用。")
		}
	}
	missing, onDisk := 0, 0
	if err := writeProbe(tdir); err != nil {
		add("fail", "Photos folder", "图片文件夹", "Photos can't be saved in "+tdir+": "+err.Error()+". Choose another folder above.",
			"无法在 "+tdir+" 保存图片："+err.Error()+"。请在上面换一个文件夹。")
	} else {
		have := map[string]bool{}
		if entries, err := os.ReadDir(tdir); err == nil {
			for _, e := range entries {
				have[e.Name()] = true
			}
			onDisk = len(entries)
		}
		for _, k := range keys {
			if !have[unsafeChars.ReplaceAllString(k, "_")] {
				missing++
			}
		}
		missing = max(0, missing-missingCover) // items without a cover can't have a photo
		queued := len(l.thumbs)
		blocked := PhotoBlockedUntil()
		switch {
		case missing == 0:
			add("ok", "Photos", "图片", fmt.Sprintf("All %d photos are saved in %s.", items-missingCover, tdir),
				fmt.Sprintf("全部 %d 张图片都保存在 %s。", items-missingCover, tdir))
		case !blocked.IsZero():
			add("warn", "Photos", "图片", fmt.Sprintf("%d photos aren't saved yet — downloads are paused because Yupoo's photo server is blocking (see “Yupoo photos”).", missing),
				fmt.Sprintf("还有 %d 张图片没保存——因为 Yupoo 图片服务器在拦截，下载已暂停（见“Yupoo 图片”）。", missing))
		case queued > 0:
			add("ok", "Photos", "图片", fmt.Sprintf("%d photos are still downloading in the background (%d waiting in line). This is normal after saving a store; about 4 are downloaded per second.", missing, queued),
				fmt.Sprintf("还有 %d 张图片在后台下载（%d 张在排队）。保存店铺后这是正常的；大约每秒下载 4 张。", missing, queued))
		default:
			status := "ok"
			if missing > items/10 {
				status = "warn"
			}
			add(status, "Photos", "图片", fmt.Sprintf("%d photos aren't saved yet. They're fetched when you view them, and retried each time the app starts.", missing),
				fmt.Sprintf("还有 %d 张图片没保存。浏览时会自动下载，每次启动程序也会重试。", missing))
		}
		detail("Folder %s: %d files; %d items still without a photo; %d waiting in the download line", tdir, onDisk, missing, queued)
		if !blocked.IsZero() {
			detail("Photo downloads PAUSED until %s (Yupoo's photo server is blocking)", blocked.Format("15:04:05"))
		} else {
			detail("Photo downloads: not paused")
		}
	}
	if m := l.ThumbMoveStatus(); m.Failed > 0 || m.Running {
		if m.Failed > 0 {
			add("warn", "Moving photos", "搬图片", fmt.Sprintf("%d photos couldn't be moved and are still in %s.", m.Failed, m.From),
				fmt.Sprintf("有 %d 张图片没能搬走，还在 %s。", m.Failed, m.From))
		}
		detail("Moving photos: running=%v, %d of %d, %d failed, from %s to %s", m.Running, m.Done, m.Total, m.Failed, m.From, m.To)
	}
	if sh := l.ThumbShrinkStatus(); sh.Running || sh.Finished {
		detail("Making photos smaller: running=%v, %d of %d checked, %d shrunk, %.0f MB saved", sh.Running, sh.Done, sh.Total, sh.Shrunk, float64(sh.Saved)/(1<<20))
	}

	// ---------- 4. downloads folder ----------
	if dl := downloadsDir(); writeProbe(dl) != nil {
		add("fail", "Downloads folder", "下载文件夹", "Exports and backups can't be saved in "+dl+".", "无法在 "+dl+" 保存导出文件和备份。")
	} else {
		add("ok", "Downloads folder", "下载文件夹", "Exports and backups go to "+dl+".", "导出文件和备份会保存到 "+dl+"。")
	}

	// ---------- 5. internet: names, Yupoo, a store page, photos, GitHub ----------
	section("Internet tests")
	for _, h := range []string{"x.yupoo.com", "photo.yupoo.com", "api.github.com"} {
		t0 := time.Now()
		ips, err := net.LookupHost(h)
		if err != nil {
			detail("Find %s: FAILED after %d ms — %v", h, time.Since(t0).Milliseconds(), err)
			add("fail", "Finding "+h, "解析 "+h, "The address "+h+" can't be found (DNS). The internet may be down, or the network is blocking it.",
				"找不到地址 "+h+"（DNS）。可能断网了，或者网络屏蔽了它。")
		} else {
			if len(ips) > 4 {
				ips = ips[:4]
			}
			detail("Find %s: %s (%d ms)", h, strings.Join(ips, ", "), time.Since(t0).Milliseconds())
		}
	}
	client := &http.Client{Timeout: 12 * time.Second}
	yupooOK := false
	if res, body, took, err := probe(client, "https://x.yupoo.com/", ""); err != nil {
		detail("Yupoo home page: %v", err)
		add("fail", "Internet / Yupoo", "网络 / Yupoo", "Yupoo can't be reached: "+shortErr(err)+". Check your internet connection.",
			"无法连接 Yupoo："+shortErr(err)+"。请检查网络连接。")
	} else {
		detail("Yupoo home page: %s", answerLine(res, body, took))
		if e := describe("https://x.yupoo.com/", res, body, took, ""); e.Blocked || res.StatusCode >= 500 || res.StatusCode == 403 || res.StatusCode == 429 {
			add("warn", "Internet / Yupoo", "网络 / Yupoo", "Yupoo answered \""+res.Status+"\" — it may be busy or limiting visits from this connection. Try again later.",
				"Yupoo 返回“"+res.Status+"”——它可能很忙，或在限制这个网络的访问。请稍后再试。")
		} else {
			yupooOK = true
			add("ok", "Internet / Yupoo", "网络 / Yupoo", "Yupoo's website can be reached.", "可以正常连接 Yupoo 网站。")
		}
	}

	// A real store page, the way "Save whole store" and New Additions read it.
	if yupooOK {
		if host := biggestUnlockedStore(stores, l); host != "" {
			u := "https://" + host + "/categories"
			cookie := ""
			if pw := l.StorePassword(strings.Split(host, ".")[0]); pw != "" {
				cookie = "indexlockcode=" + encodeURIComponent(pw)
			}
			body, err := fetchPage(u, "https://"+host+"/", cookie)
			switch {
			case errors.Is(err, errPhotoBlocked):
				detail("Store page %s: %v", u, err)
				add("warn", "Store pages", "店铺页面", "Yupoo is refusing to show store pages to this computer for now (its security service is blocking). Save whole store and New Additions will stop and try again later.",
					"Yupoo 暂时拒绝向这台电脑显示店铺页面（安全防护服务在拦截）。“保存整个店铺”和“新上架”会停下来，稍后再试。")
			case err != nil:
				detail("Store page %s: %v", u, err)
				add("warn", "Store pages", "店铺页面", "A store page couldn't be read ("+shortErr(err)+"). Save whole store and New Additions may not work right now.",
					"无法读取店铺页面（"+shortErr(err)+"）。“保存整个店铺”和“新上架”现在可能无法使用。")
			default:
				found := len(extractAlbums(body, host))
				detail("Store page %s: %d albums found on page 1, store says %d in total, %d pages", u, found, storeTotal(body), detectMaxPage(body))
				if found == 0 {
					add("warn", "Store pages", "店铺页面", "A store page opened but no items could be read from it (the store may need a password, or Yupoo changed its pages).",
						"店铺页面能打开，但读不到商品（店铺可能需要密码，或者 Yupoo 改了页面）。")
				} else {
					add("ok", "Store pages", "店铺页面", "Store pages can be read (Save whole store and New Additions work).", "可以正常读取店铺页面（“保存整个店铺”和“新上架”可用）。")
				}
			}
		}
	}

	// Photos: a few recent ones from different stores, sent the way the photo downloader sends them.
	if yupooOK && len(samples) > 0 {
		ok, blockedN := 0, 0
		var lastErr error
		for _, al := range samples {
			t0 := time.Now()
			b, err := fetchImage(client, al.Cover, "https://"+al.Host+"/")
			if err != nil {
				detail("Photo %s: %v", al.Cover, err)
				lastErr = err
				if errors.Is(err, errPhotoBlocked) {
					blockedN++
				}
				continue
			}
			ok++
			detail("Photo %s: OK, %.1f KB in %d ms", al.Cover, float64(len(b))/1024, time.Since(t0).Milliseconds())
		}
		switch {
		case blockedN > 0:
			if PhotoBlockedUntil().IsZero() { // don't make an existing pause longer
				photoBlockedFor()
			}
			when := PhotoBlockedUntil().Format("15:04")
			add("warn", "Yupoo photos", "Yupoo 图片",
				fmt.Sprintf("Yupoo's photo server is blocking this computer for now (%d of %d test photos came back as its \"Restricted Access\" page from Tencent Cloud EdgeOne). This usually happens after many photos were downloaded quickly, and is more common in mainland China. Photo downloads pause and try again at %s; photos fill in once Yupoo allows it again. Items and links are not affected.", blockedN, len(samples), when),
				fmt.Sprintf("Yupoo 的图片服务器暂时拦截了这台电脑（%d/%d 张测试图片返回了腾讯云 EdgeOne 的“请求已被拦截”页面）。通常是短时间内下载了很多图片导致的，在中国大陆更常见。图片下载会暂停，并在 %s 再试；Yupoo 放行后图片会自动补上。商品和链接不受影响。", blockedN, len(samples), when))
		case ok == 0 && lastErr != nil:
			add("warn", "Yupoo photos", "Yupoo 图片", "Test photos couldn't be downloaded ("+shortErr(lastErr)+"). New photos may not appear until this works again.",
				"测试图片下载失败（"+shortErr(lastErr)+"）。在恢复之前，新图片可能不会显示。")
		case ok < len(samples):
			add("ok", "Yupoo photos", "Yupoo 图片", fmt.Sprintf("%d of %d test photos downloaded (one may simply have been removed by the store).", ok, len(samples)),
				fmt.Sprintf("%d/%d 张测试图片下载成功（有一张可能只是被店铺删了）。", ok, len(samples)))
		default:
			add("ok", "Yupoo photos", "Yupoo 图片", "Photos can be downloaded from Yupoo.", "可以正常从 Yupoo 下载图片。")
		}
	}

	// ---------- 6. background jobs ----------
	section("Background jobs")
	if st := a.crawl.Status(); st.Running {
		add("ok", "Save whole store", "保存整个店铺", fmt.Sprintf("Saving %s right now (page %d of %d, %d new).", st.Store, st.Page, st.MaxPage, st.New), fmt.Sprintf("正在保存 %s（第 %d/%d 页，新增 %d）。", st.Store, st.Page, st.MaxPage, st.New))
		detail("Save whole store: running %s, page %d/%d, %d seen, %d new", st.Store, st.Page, st.MaxPage, st.Seen, st.New)
	} else {
		if st.Failed && st.Msg != "" {
			add("warn", "Save whole store", "保存整个店铺", "The last save of "+st.Store+" stopped early: "+st.Msg, "上次保存 "+st.Store+" 时提前停止了。")
		}
		if st.Store != "" {
			detail("Save whole store: last was %s — %s (%s)", st.Store, firstNonEmpty(st.Msg, "finished"), st.Kind)
		} else {
			detail("Save whole store: not used since the app started")
		}
	}
	nc := a.check.Status()
	switch {
	case nc.Checking:
		detail("New Additions: checking %s (%d of %d stores, %d new so far)", nc.Store, nc.Done, nc.Stores, nc.Found)
	case nc.Running && nc.FillStore != "":
		detail("New Additions: filling in %s, page %d of %d, %d items added this session", nc.FillStore, nc.FillPage, nc.FillPages, nc.Filled)
	default:
		detail("New Additions: idle")
	}
	if lastCheck > 0 {
		detail("New Additions: last full check %s, next %s; last result: %d stores, %d new, %d first-time, %d locked, %d skipped, Yupoo stopped answering=%v",
			time.UnixMilli(lastCheck).Format("2006-01-02 15:04"), time.UnixMilli(nc.NextCheck).Format("2006-01-02 15:04"), nc.Done, nc.Found, nc.First, nc.Locked, nc.Skipped, nc.Failed)
	}
	if nc.Failed {
		add("warn", "New Additions", "新上架", "The last check stopped early because Yupoo stopped answering. It tries again in 15 minutes.",
			"上次检查因为 Yupoo 停止响应而提前停止了。15 分钟后会再试。")
	}
	if locked > 0 {
		add("warn", "Locked stores", "需要密码的店铺", fmt.Sprintf("%d stores need a password before they can be checked (%d passwords saved). Enter them in the 🔒 list in the Library's sidebar.", locked, withPassword),
			fmt.Sprintf("有 %d 个店铺需要密码才能检查（已保存 %d 个密码）。请在图库侧边栏的 🔒 列表里输入。", locked, withPassword))
	}
	detail("Locked stores: %d; passwords saved: %d", locked, withPassword)
	if len(gaps) > 0 {
		sort.Slice(gaps, func(i, j int) bool { return gaps[i].total-gaps[i].have > gaps[j].total-gaps[j].have })
		var parts []string
		for i, g := range gaps {
			if i == 5 {
				parts = append(parts, fmt.Sprintf("… and %d more", len(gaps)-5))
				break
			}
			parts = append(parts, fmt.Sprintf("%s %d/%d", strings.Split(g.host, ".")[0], g.have, g.total))
		}
		detail("Stores not completely saved (%d): %s", len(gaps), strings.Join(parts, ", "))
	}
	if ex := export.status(); ex.Running || ex.Finished {
		detail("Export Saved Data: running=%v, %d of %d files, error=%q, file=%s", ex.Running, ex.Done, ex.Total, ex.Error, ex.Path)
	}
	detail("Settings: auto-save while browsing=%v, theme=%q, sidebar width=%d, photos folder setting=%q", s.AutoSave, s.Theme, s.SidebarWidth, s.ThumbsDir)

	// ---------- 7. collections ----------
	if badRefs > 0 {
		add("warn", "Collections", "收藏夹", fmt.Sprintf("%d collection entries point to items that are no longer in your library.", badRefs),
			fmt.Sprintf("有 %d 个收藏条目指向已经不在图库里的商品。", badRefs))
	}

	// ---------- 8. updates (GitHub) ----------
	if rel, err := CheckForUpdate(); err != nil {
		detail("GitHub (update check): %v", err)
		add("warn", "Update check", "检查更新", "GitHub couldn't be reached ("+shortErr(err)+"), so new versions can't be found right now. (GitHub is often slow or blocked in mainland China.)",
			"无法连接 GitHub（"+shortErr(err)+"），暂时无法发现新版本。（在中国大陆 GitHub 经常很慢或被屏蔽。）")
	} else if rel != nil && s.UpdatedTo == rel.Version {
		detail("GitHub (update check): latest release %s (installed, but labelled %s inside)", rel.Version, AppVersion)
		add("warn", "Update check", "检查更新",
			"Release "+rel.Version+" is installed, but its program says version "+AppVersion+" inside (the version number wasn't raised before it was built). It won't be offered again; the release's YupooLibrary.exe needs rebuilding with AppVersion "+rel.Version+".",
			"已安装版本 "+rel.Version+"，但它的程序内部写的是 "+AppVersion+"（编译前没有改版本号）。它不会再被反复提示；需要用 AppVersion "+rel.Version+" 重新编译发布里的 YupooLibrary.exe。")
	} else if rel != nil {
		detail("GitHub (update check): version %s available", rel.Version)
		add("warn", "Update check", "检查更新", "Version "+rel.Version+" is available — click Check for updates.", "有新版本 "+rel.Version+" 可用——请点“检查更新”。")
	} else {
		detail("GitHub (update check): up to date")
		add("ok", "Update check", "检查更新", "You have the latest version ("+AppVersion+").", "你已经是最新版本（"+AppVersion+"）。")
	}

	// ---------- 9. problems logged in the last day ----------
	section("Problems logged in the last 24 hours (app-log.txt)")
	groups, recent := recentLog(24 * time.Hour)
	total := 0
	for _, g := range groups {
		total += g.n
	}
	if total == 0 {
		add("ok", "Problems logged (last 24 h)", "记录的问题（最近 24 小时）", "None.", "没有。")
		detail("None.")
	} else {
		status := "ok"
		if total >= 20 {
			status = "warn"
		}
		top := groups[0]
		add(status, "Problems logged (last 24 h)", "记录的问题（最近 24 小时）",
			fmt.Sprintf("%d problems in %d kinds. Most common: %s (%d×). A few are normal (Yupoo is sometimes slow); many of one kind usually means Yupoo is blocking for a while. Full list in the copied report.", total, len(groups), top.label, top.n),
			fmt.Sprintf("共 %d 个问题，%d 种。最常见：%s（%d 次）。偶尔几次是正常的（Yupoo 有时很慢）；同一种很多次通常说明 Yupoo 暂时在限制访问。完整列表在复制的报告里。", total, len(groups), top.label, top.n))
		for _, g := range groups {
			detail("%d× %s (latest %s)", g.n, g.label, g.last)
		}
		detail("")
		detail("Latest lines:")
		d.Details = append(d.Details, recent...)
	}

	// Problems first, then warnings, then the fine ones.
	rank := map[string]int{"fail": 0, "warn": 1, "ok": 2}
	sort.SliceStable(d.Checks, func(i, j int) bool { return rank[d.Checks[i].Status] < rank[d.Checks[j].Status] })
	return d
}

// photoSamples picks up to n recently saved covers from different stores.
func (l *Library) photoSamples(n int) []*Album {
	l.mu.Lock()
	defer l.mu.Unlock()
	all := make([]*Album, 0, len(l.data.Albums))
	for _, a := range l.data.Albums {
		if a.Cover != "" {
			all = append(all, a)
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].LastSeen > all[j].LastSeen })
	seen := map[string]bool{}
	var out []*Album
	for _, a := range all {
		if !seen[a.Store] {
			seen[a.Store] = true
			out = append(out, a)
			if len(out) == n {
				break
			}
		}
	}
	return out
}

// biggestUnlockedStore is the store with the most items that doesn't need a password we don't have.
func biggestUnlockedStore(stores map[string]int, l *Library) string {
	best, bestN := "", 0
	for h, n := range stores {
		if strings.HasSuffix(h, ".x.yupoo.com") && n > bestN && !l.storeIsLocked(strings.Split(h, ".")[0]) {
			best, bestN = h, n
		}
	}
	return best
}

// probe makes one request and returns the answer with up to 64 KB of its body.
func probe(client *http.Client, u, referer string) (*http.Response, []byte, time.Duration, error) {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, nil, 0, err
	}
	req.Header.Set("User-Agent", browserUA)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	t0 := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return nil, nil, time.Since(t0), netErr(u, err, time.Since(t0))
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	return res, b, time.Since(t0), nil
}

// answerLine sums up an answer: "HTTP 200 OK, text/html, 41.0 KB, 312 ms, server nginx".
func answerLine(res *http.Response, body []byte, took time.Duration) string {
	e := describe(res.Request.URL.String(), res, body, took, "")
	parts := []string{"HTTP " + res.Status}
	if e.ContentType != "" {
		parts = append(parts, e.ContentType)
	}
	parts = append(parts, fmt.Sprintf("%.1f KB", float64(len(body))/1024), fmt.Sprintf("%d ms", took.Milliseconds()))
	if e.Server != "" {
		parts = append(parts, "server "+e.Server)
	}
	if e.RequestID != "" {
		parts = append(parts, "request ID "+e.RequestID)
	}
	if e.Blocked {
		parts = append(parts, "BLOCKED by Yupoo's security service")
	}
	return strings.Join(parts, ", ")
}

func memMB() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.HeapAlloc) / (1 << 20)
}

// writeProbe checks a folder exists (creating it if needed) and can be written to.
func writeProbe(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	p := filepath.Join(dir, ".yupoo-library-check")
	if err := os.WriteFile(p, []byte("ok"), 0o644); err != nil {
		return err
	}
	return os.Remove(p)
}

type logGroup struct {
	label, last string
	n           int
}

// recentLog reads app-log.txt (and the older thumb-errors.log, if any): the problems within the window
// grouped by kind (most common first), and the latest 30 lines.
func recentLog(window time.Duration) ([]logGroup, []string) {
	cutoff := time.Now().Add(-window)
	by := map[string]*logGroup{}
	var lines []string
	for _, p := range []string{appLogPath(), filepath.Join(filepath.Dir(appLogPath()), "thumb-errors.log")} {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			line := sc.Text()
			if len(line) < 19 {
				continue
			}
			t, err := time.ParseInLocation("2006-01-02 15:04:05", line[:19], time.Local)
			if err != nil || t.Before(cutoff) {
				continue
			}
			lines = append(lines, line)
			// Kind = "[area] reason" (the part before the details in brackets), without the item/store.
			rest := strings.TrimSpace(line[19:])
			label := rest
			if i := strings.Index(label, ": "); i > 0 && strings.HasPrefix(label, "[") {
				area := label[:strings.Index(label, "]")+1]
				label = area + " " + label[i+2:]
			}
			label = strings.SplitN(label, " (", 2)[0]
			if r := []rune(label); len(r) > 140 {
				label = string(r[:140]) + "…"
			}
			g := by[label]
			if g == nil {
				g = &logGroup{label: label}
				by[label] = g
			}
			g.n++
			g.last = line[11:19]
		}
		f.Close()
	}
	groups := make([]logGroup, 0, len(by))
	for _, g := range by {
		groups = append(groups, *g)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].n > groups[j].n })
	if len(lines) > 30 {
		lines = lines[len(lines)-30:]
	}
	return groups, lines
}

func shortErr(err error) string {
	s := err.Error()
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120]) + "…"
	}
	return s
}
