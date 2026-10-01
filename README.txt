KIT LIBRARY for Windows
=======================

Paste a Yupoo link, browse inside the app, and every kit you see is saved into
one library on your PC: English names, team, season, kit type and a photo.

STARTING IT
1. Unzip, then double-click KitLibrary.exe. No install needed.
2. The first time, Windows may say "Windows protected your PC" because the app
   isn't from a known publisher. Click "More info" -> "Run anyway".
3. Needs Windows 10 or 11 (it uses Microsoft Edge's built-in WebView2).

USING IT
- Paste a Yupoo link (e.g. shida-tiyu888.x.yupoo.com/albums) in the box at the
  top of the library and press Open.
- Browse normally. The green bar at the bottom shows how many kits were saved
  from each page.
    Back              - go back a page
    Save whole store  - saves every page of that supplier's catalog
                        (about 2 seconds per page so Yupoo doesn't block you)
    Library           - back to your library
- In the library:
    Teams    - search in English or Chinese ("liv" or "利物浦"), across all stores
    Stores   - narrow to one supplier; "open" jumps back into that store
    ✎ Team   - fix anything under "Unsorted"; it can learn that spelling
    🗑       - remove a kit
    Export CSV / Backup - saved to your Downloads folder
    Restore  - load a backup .zip (adds anything that's missing)
    Untick "Auto-save while browsing" to pause; the green bar then offers
    "Save this page" instead.

WHERE YOUR DATA LIVES
  %APPDATA%\KitLibrary\library.json   your kits
  %APPDATA%\KitLibrary\thumbs\        photo snapshots
Nothing is sent anywhere; the app only talks to Yupoo.
