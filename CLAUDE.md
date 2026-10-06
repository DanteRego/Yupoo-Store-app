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
- `web/brands.js` — the brand finder: `YO_BRANDS` (brand → ways suppliers write it, incl. Chinese names and chopped spellings like "ike"/"didas"); first match in list order wins, so Jordan/Yeezy come first and sportswear comes before fashion houses (collabs like "Off-White x Nike" count as Nike). Falls back to product codes for shoes (Nike HF3255-108, Asics 1203A591-002, Adidas 货号 IH4046). Used for the Brand filter, "Brand A–Z" sort (with headings) and the default sort (shoes etc. grouped by brand, clothing by team).
- `web/teams.js` — team dictionary (Chinese/slang → English), kit types (主场 = Home…), extras (长袖 = Long Sleeve…) and the title parser. Most "this kit is sorted wrong" fixes go here.
- `web/library.html`, `web/library.js` — the Library page (sidebar, searchable dropdown filters, cards, store renaming, "☑ Select" bulk category edit with Undo, ☆ add to collection, numbered pages, sticky filter bar (`.topbar`), CSV, backup). Filters, page and scroll are saved in sessionStorage (`libraryView`) on leaving and restored on return; the Catalog does the same (`catalogView`).
- `web/catalog.html`, `web/catalog.js` — the Catalog page (`/catalog`): your collections (e.g. Wishlist) with a note per item, CSV per collection. "⧉" opens it in its own window (a WebView2 pop-up: no app bindings there, so it only uses the token API; album links open in the main window via `window.opener`). "◀ Library" (top left) always goes back to the Library in the same window.
- `web/shared.js`, `web/app.css` — code and styles both pages use (talking to the app, `info()` names/categories, photos, toast, the collection picker). Pages tell each other about changes over a `BroadcastChannel`, so two open windows stay in step.
- `collections.go` — collections in `library.json` (`"collections"`), the `/api/collections/{create,rename,delete,add,remove,note}` actions; removing an item from the Library also takes it out of collections. Sharing: the Catalog's "📤 Export to share" saves a `*.yupoo-collection.json` file (`SharedCollection`: type "yupoo-library-collection", the items' album records + notes, plus store names/🏷 store categories); "📥 Import a shared collection" sends it to `/api/import-collection`, which adds missing items to the library and makes a new collection (name gets " (2)" if taken).
- `web/capture.js` — runs on Yupoo pages inside the app: reads albums, the green bar (starts/stops "Save whole store" and shows its progress on that store).
- `crawl.go` — "Save whole store" itself. Runs inside the app so it keeps going while the owner browses elsewhere; reads store pages with its own small reader (same rules as `extractAlbums` in capture.js — keep the two in step). One store at a time.
- `web/crawlbar.js` — loaded on every page (Yupoo and Library): the bottom-right progress card, which shrinks to a round badge with "–".
- `store.go` — the saved library (`%APPDATA%\YupooLibrary\library.json`), backup/restore, `my-teams.txt`, your store names.
- `thumbs.go` — downloads and shrinks cover photos (Yupoo needs a Referer header).
- `server.go` — local web server + API the Library page calls (token-protected); data folder locations
  (moves the old `KitLibrary` / `M:\Kit Library` folders to the new names on first start).
- `main_windows.go` — the app window; `main_other.go` — Mac/Linux test mode (library only).
- `update.go`, `update_windows.go` — update check: a few seconds after opening, the app asks GitHub for the latest release of `DanteRego/Yupoo-Store-app`; if its tag (e.g. v1.0.1) is newer than `AppVersion`, a Yes/No box explains what's new and that data isn't touched. Yes downloads the release's `YupooLibrary.exe`, renames the running exe to `.old`, puts the new one in place and restarts (the new copy deletes `.old`). Raise `AppVersion` for every release (steps in HOW-TO-TWEAK.txt). `KIT_UPDATE_API` overrides the GitHub address for testing.
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
