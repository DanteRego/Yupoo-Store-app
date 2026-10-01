# Kit Library — notes for Claude Code

A Windows app (Go + Microsoft Edge WebView2) that saves kits from Yupoo supplier
catalogs into one local library, with English names, team, season and kit type.
The owner is new to programming: explain changes in plain words and keep steps simple.

## Build and try a change
- Run `build.bat` (or: `go build -trimpath -ldflags "-H windowsgui -s -w" -o KitLibrary.exe .`).
- Dependencies are in `vendor/`, so no download is needed. Don't delete `vendor/`.
- After building, the owner opens KitLibrary.exe to try the change.

## Where things are
- `web/teams.js` — team dictionary (Chinese/slang → English), kit types (主场 = Home…), extras (长袖 = Long Sleeve…) and the title parser. Most "this kit is sorted wrong" fixes go here.
- `web/library.html`, `web/library.js` — the Library page (filters, cards, CSV, backup).
- `web/capture.js` — runs on Yupoo pages inside the app: reads albums, the green bar, "Save whole store".
- `store.go` — the saved library (`%APPDATA%\KitLibrary\library.json`), backup/restore, `my-teams.txt`.
- `thumbs.go` — downloads and shrinks cover photos (Yupoo needs a Referer header).
- `server.go` — local web server + API the Library page calls (token-protected).
- `main_windows.go` — the app window; `main_other.go` — Mac/Linux test mode (library only).

## Rules
- Never change the format of `library.json` in a way that loses the owner's saved kits.
  Add fields; don't rename or remove them.
- Teams are worked out from titles every time the library opens, so dictionary fixes
  apply to already-saved kits automatically.
- Yupoo blocks fast scraping: keep the 1.5–2.5 s delay between pages in "Save whole store".
- `web/teams.js` is also used by the old Firefox add-on; it must stay plain browser JavaScript.
