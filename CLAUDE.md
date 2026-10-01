# Yupoo Library — notes for Claude Code

A Windows app (Go + Microsoft Edge WebView2) that saves items from Yupoo supplier
catalogs into one local library. It started as "Kit Library" for football kits; football
kits get English names, team, season and kit type. The owner is adding stores that sell
other things too (clothes, shoes, all sorts of categories), so new features and wording
should work for any item, not only kits.
The owner is new to programming: explain changes in plain words and keep steps simple.

## Build and try a change
- Run `build.bat` (or: `go build -trimpath -ldflags "-H windowsgui -s -w" -o YupooLibrary.exe .`).
- Dependencies are in `vendor/`, so no download is needed. Don't delete `vendor/`.
- After building, the owner opens YupooLibrary.exe to try the change.

## Where things are
- `web/categories.js` — the item sorter: decides what each item is (Category › Subcategory, e.g. Shoes › Sneakers) from words in its title, then the store's 🏷 default, then shoe sizes, then "a team was found" (= Football Kit). Most "this item is in the wrong category" fixes go here (add a word to `YO_CATEGORY_WORDS`; order matters, first match wins). Beware short Chinese words hiding inside longer ones (刺客 is inside 热刺客场 = Tottenham away; 巴黎 is inside 巴黎世家 = Balenciaga).
- `web/teams.js` — team dictionary (Chinese/slang → English), kit types (主场 = Home…), extras (长袖 = Long Sleeve…) and the title parser. Most "this kit is sorted wrong" fixes go here.
- `web/library.html`, `web/library.js` — the Library page (sidebar, searchable dropdown filters, cards, store renaming, "☑ Select" bulk category edit with Undo, CSV, backup).
- `web/capture.js` — runs on Yupoo pages inside the app: reads albums, the green bar (starts/stops "Save whole store" and shows its progress on that store).
- `crawl.go` — "Save whole store" itself. Runs inside the app so it keeps going while the owner browses elsewhere; reads store pages with its own small reader (same rules as `extractAlbums` in capture.js — keep the two in step). One store at a time.
- `web/crawlbar.js` — loaded on every page (Yupoo and Library): the bottom-right progress card, which shrinks to a round badge with "–".
- `store.go` — the saved library (`%APPDATA%\YupooLibrary\library.json`), backup/restore, `my-teams.txt`, your store names.
- `thumbs.go` — downloads and shrinks cover photos (Yupoo needs a Referer header).
- `server.go` — local web server + API the Library page calls (token-protected); data folder locations
  (moves the old `KitLibrary` / `M:\Kit Library` folders to the new names on first start).
- `main_windows.go` — the app window; `main_other.go` — Mac/Linux test mode (library only).
- App icon: `Icon Yupoo.ico`. `build.bat` turns it into `rsrc_windows_amd64.syso` with `tools/makeicon` (no downloads), which Go builds into the .exe; the window uses it via `IconId: 1`. Don't set the icon by editing the .exe — the next build replaces it.
- Internal names like `kitSave`, `X-Kit-Token` and `KIT_DATA_DIR` are leftovers from the old name; the owner never sees them.

## Rules
- Never change the format of `library.json` in a way that loses the owner's saved items.
  Add fields; don't rename or remove them.
- The Library sorts by what an item is first (category); team, season, kit type and extras only apply to clothing (`YO_CLOTHING`), so shoes never get a team.
- Categories and teams are worked out from titles every time the library opens, so dictionary fixes
  apply to already-saved items automatically.
- Yupoo blocks fast scraping: keep the 1.5–2.5 s delay between pages in "Save whole store" (in `crawl.go`).
- `web/teams.js` is also used by the old Firefox add-on; it must stay plain browser JavaScript.
