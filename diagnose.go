package main

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// The ⚙ Settings page's "🩺 Run a check-up": tests the things the app depends on and explains
// any problem in plain words (in English and Chinese — the page shows the one you use).

type Check struct {
	Status   string `json:"status"` // "ok", "warn" or "fail"
	Name     string `json:"name"`
	NameZh   string `json:"nameZh"`
	Detail   string `json:"detail"`
	DetailZh string `json:"detailZh"`
}

type Diagnosis struct {
	Checks  []Check `json:"checks"`
	Version string  `json:"version"`
	System  string  `json:"system"`
	Time    string  `json:"time"`
}

func (a *App) Diagnose() Diagnosis {
	d := Diagnosis{Version: AppVersion, System: runtime.GOOS + "/" + runtime.GOARCH, Time: time.Now().Format("2006-01-02 15:04:05")}
	add := func(status, name, nameZh, detail, detailZh string) {
		d.Checks = append(d.Checks, Check{status, name, nameZh, detail, detailZh})
	}
	l := a.lib

	// 1. The library file.
	l.mu.Lock()
	items, cols := len(l.data.Albums), len(l.data.Collections)
	missingCover := 0
	keys := make([]string, 0, len(l.data.Albums))
	for k, al := range l.data.Albums {
		if al.Cover == "" {
			missingCover++
		}
		keys = append(keys, k)
	}
	badRefs := 0
	for _, c := range l.data.Collections {
		for _, it := range c.Items {
			if l.data.Albums[it.Key] == nil {
				badRefs++
			}
		}
	}
	l.mu.Unlock()
	if st, err := os.Stat(l.file()); err != nil {
		if items == 0 {
			add("ok", "Library file", "图库文件", "No library saved yet — it's created when you save your first item.", "还没有保存图库——保存第一件商品时会自动创建。")
		} else {
			add("fail", "Library file", "图库文件", "library.json can't be found: "+err.Error()+". Your items are only in memory — click Backup now.",
				"找不到 library.json："+err.Error()+"。你的商品目前只在内存里——请立刻点“备份”。")
		}
	} else {
		add("ok", "Library file", "图库文件",
			fmt.Sprintf("%d items, %d collections (%.1f MB, last saved %s).", items, cols, float64(st.Size())/1e6, st.ModTime().Format("Jan 2 15:04")),
			fmt.Sprintf("%d 件商品，%d 个收藏夹（%.1f MB，最近保存于 %s）。", items, cols, float64(st.Size())/1e6, st.ModTime().Format("01-02 15:04")))
	}
	if broken, _ := filepath.Glob(l.file() + ".broken-*"); len(broken) > 0 {
		add("warn", "Damaged library copies", "损坏的图库副本",
			fmt.Sprintf("%d damaged library.json file(s) were set aside at some point (in %s). Your current library is fine; these can be deleted once you're sure nothing is missing.", len(broken), l.dir),
			fmt.Sprintf("曾经有 %d 个损坏的 library.json 被放到一边（在 %s）。现在的图库没问题；确认没有缺东西后可以删掉它们。", len(broken), l.dir))
	}

	// 2. Can the app save?
	if err := writeProbe(l.dir); err != nil {
		add("fail", "Saving changes", "保存修改", "The app can't write to its data folder ("+l.dir+"): "+err.Error()+". Changes won't be saved.",
			"程序无法写入它的数据文件夹（"+l.dir+"）："+err.Error()+"。修改不会被保存。")
	} else {
		add("ok", "Saving changes", "保存修改", "The data folder can be written to.", "数据文件夹可以正常写入。")
	}

	// 3. Photos.
	tdir := l.ThumbDir()
	if strings.HasPrefix(strings.ToUpper(l.DefaultThumbDir()), `M:\`) || strings.HasPrefix(strings.ToUpper(tdir), `M:\`) {
		if _, err := os.Stat(`M:\`); err != nil {
			add("warn", "M: drive", "M: 盘", "The M: drive isn't connected, so photos are being saved next to the library instead. Plug it in and restart the app to use it again.",
				"M: 盘没有连接，所以图片暂时保存在图库旁边。插上它并重启程序即可重新使用。")
		}
	}
	if err := writeProbe(tdir); err != nil {
		add("fail", "Photos folder", "图片文件夹", "Photos can't be saved in "+tdir+": "+err.Error()+". Choose another folder above.",
			"无法在 "+tdir+" 保存图片："+err.Error()+"。请在上面换一个文件夹。")
	} else {
		have := map[string]bool{}
		if entries, err := os.ReadDir(tdir); err == nil {
			for _, e := range entries {
				have[e.Name()] = true
			}
		}
		missing := 0
		for _, k := range keys {
			if !have[unsafeChars.ReplaceAllString(k, "_")] {
				missing++
			}
		}
		missing -= missingCover // items without a cover can't have a photo
		if missing < 0 {
			missing = 0
		}
		queued := len(l.thumbs)
		switch {
		case missing == 0:
			add("ok", "Photos", "图片", fmt.Sprintf("All %d photos are saved in %s.", items-missingCover, tdir),
				fmt.Sprintf("全部 %d 张图片都保存在 %s。", items-missingCover, tdir))
		case queued > 0:
			add("ok", "Photos", "图片", fmt.Sprintf("%d photos are still downloading in the background (%d waiting). This is normal after saving a store.", missing, queued),
				fmt.Sprintf("还有 %d 张图片在后台下载（%d 张在排队）。保存店铺后这是正常的。", missing, queued))
		default:
			status := "ok"
			if missing > items/10 {
				status = "warn"
			}
			add(status, "Photos", "图片", fmt.Sprintf("%d photos aren't saved yet. They're fetched when you view them, and retried each time the app starts.", missing),
				fmt.Sprintf("还有 %d 张图片没保存。浏览时会自动下载，每次启动程序也会重试。", missing))
		}
	}
	if m := l.ThumbMoveStatus(); m.Failed > 0 {
		add("warn", "Moving photos", "搬图片", fmt.Sprintf("%d photos couldn't be moved and are still in %s.", m.Failed, m.From),
			fmt.Sprintf("有 %d 张图片没能搬走，还在 %s。", m.Failed, m.From))
	}

	// 4. Recent photo download errors (the app's own log).
	if recent, last := recentThumbErrors(filepath.Join(l.dir, "thumb-errors.log"), 24*time.Hour); recent > 0 {
		status := "ok"
		if recent >= 20 {
			status = "warn"
		}
		add(status, "Photo download errors (last 24 h)", "图片下载错误（最近 24 小时）",
			fmt.Sprintf("%d failed downloads. Latest: %s. A few are normal (Yupoo is sometimes slow); many usually means Yupoo is blocking for a while.", recent, last),
			fmt.Sprintf("%d 次下载失败。最近一次：%s。偶尔几次是正常的（Yupoo 有时很慢）；很多次通常说明 Yupoo 暂时在限制访问。", recent, last))
	} else {
		add("ok", "Photo download errors (last 24 h)", "图片下载错误（最近 24 小时）", "None.", "没有。")
	}

	// 5. Downloads folder (CSV, backups, shared collections).
	if dl := downloadsDir(); writeProbe(dl) != nil {
		add("fail", "Downloads folder", "下载文件夹", "Exports and backups can't be saved in "+dl+".", "无法在 "+dl+" 保存导出文件和备份。")
	} else {
		add("ok", "Downloads folder", "下载文件夹", "Exports and backups go to "+dl+".", "导出文件和备份会保存到 "+dl+"。")
	}

	// 6. Internet and Yupoo.
	client := &http.Client{Timeout: 10 * time.Second}
	yupooOK := false
	if req, err := http.NewRequest("GET", "https://x.yupoo.com/", nil); err == nil {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0")
		if res, err := client.Do(req); err != nil {
			add("fail", "Internet / Yupoo", "网络 / Yupoo", "Yupoo can't be reached: "+shortErr(err)+". Check your internet connection.",
				"无法连接 Yupoo："+shortErr(err)+"。请检查网络连接。")
		} else {
			res.Body.Close()
			if res.StatusCode >= 500 || res.StatusCode == 403 || res.StatusCode == 429 {
				add("warn", "Internet / Yupoo", "网络 / Yupoo", "Yupoo answered \""+res.Status+"\" — it may be busy or limiting visits. Try again later.",
					"Yupoo 返回“"+res.Status+"”——它可能很忙或在限制访问。请稍后再试。")
			} else {
				yupooOK = true
				add("ok", "Internet / Yupoo", "网络 / Yupoo", "Yupoo's website can be reached.", "可以正常连接 Yupoo 网站。")
			}
		}
	}
	// 7. Yupoo photos (they need the right Referer, like the photo downloader sends).
	if yupooOK {
		l.mu.Lock()
		var sample *Album
		for _, al := range l.data.Albums {
			if al.Cover != "" && (sample == nil || al.LastSeen > sample.LastSeen) {
				sample = al
			}
		}
		var cover, host string
		if sample != nil {
			cover, host = sample.Cover, sample.Host
		}
		l.mu.Unlock()
		if cover != "" {
			if _, err := fetchImage(client, cover, "https://"+host+"/"); err != nil {
				add("warn", "Yupoo photos", "Yupoo 图片", "A test photo couldn't be downloaded ("+shortErr(err)+"). New photos may not appear until this works again.",
					"测试图片下载失败（"+shortErr(err)+"）。在恢复之前，新图片可能不会显示。")
			} else {
				add("ok", "Yupoo photos", "Yupoo 图片", "Photos can be downloaded from Yupoo.", "可以正常从 Yupoo 下载图片。")
			}
		}
	}

	// 8. "Save whole store".
	if st := a.crawl.Status(); st.Running {
		add("ok", "Save whole store", "保存整个店铺", fmt.Sprintf("Saving %s right now (page %d).", st.Store, st.Page), fmt.Sprintf("正在保存 %s（第 %d 页）。", st.Store, st.Page))
	} else if st.Failed && st.Msg != "" {
		add("warn", "Save whole store", "保存整个店铺", "The last save of "+st.Store+" stopped early: "+st.Msg, "上次保存 "+st.Store+" 时提前停止了。")
	}

	// 9. Collections pointing at missing items.
	if badRefs > 0 {
		add("warn", "Collections", "收藏夹", fmt.Sprintf("%d collection entries point to items that are no longer in your library.", badRefs),
			fmt.Sprintf("有 %d 个收藏条目指向已经不在图库里的商品。", badRefs))
	}

	// 10. Updates (GitHub).
	if rel, err := CheckForUpdate(); err != nil {
		add("warn", "Update check", "检查更新", "GitHub couldn't be reached ("+shortErr(err)+"), so new versions can't be found right now.",
			"无法连接 GitHub（"+shortErr(err)+"），暂时无法发现新版本。")
	} else if rel != nil {
		add("warn", "Update check", "检查更新", "Version "+rel.Version+" is available — click Check for updates.", "有新版本 "+rel.Version+" 可用——请点“检查更新”。")
	} else {
		add("ok", "Update check", "检查更新", "You have the latest version ("+AppVersion+").", "你已经是最新版本（"+AppVersion+"）。")
	}

	// Problems first, then warnings, then the fine ones.
	rank := map[string]int{"fail": 0, "warn": 1, "ok": 2}
	sort.SliceStable(d.Checks, func(i, j int) bool { return rank[d.Checks[i].Status] < rank[d.Checks[j].Status] })
	return d
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

// recentThumbErrors counts photo-download failures logged within the last window, and returns the latest one.
func recentThumbErrors(path string, window time.Duration) (int, string) {
	f, err := os.Open(path)
	if err != nil {
		return 0, ""
	}
	defer f.Close()
	cutoff := time.Now().Add(-window)
	n, last := 0, ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if len(line) < 19 {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02 15:04:05", line[:19], time.Local)
		if err != nil || t.Before(cutoff) {
			continue
		}
		n++
		last = strings.TrimSpace(line)
	}
	if r := []rune(last); len(r) > 160 {
		last = string(r[:160]) + "…"
	}
	return n, last
}

func shortErr(err error) string {
	s := err.Error()
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120]) + "…"
	}
	return s
}
