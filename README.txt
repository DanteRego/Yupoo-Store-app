YUPOO LIBRARY for Windows
=========================

Paste a Yupoo link, browse inside the app, and every item you see is saved into
one library on your PC with a photo. Football kits also get English names,
team, season and kit type.

UPDATES
  Each time it opens, the app checks for a newer version and asks before updating.
  Updating only replaces the program — your saved items, collections and settings stay.

STARTING IT
1. Unzip, then double-click YupooLibrary.exe. No install needed.
2. The first time, Windows may say "Windows protected your PC" because the app
   isn't from a known publisher. Click "More info" -> "Run anyway".
   If Windows Security says the file "contains a virus or potentially unwanted software",
   that's a false alarm common for small unsigned apps: open Windows Security ->
   Virus & threat protection -> Protection history, pick the YupooLibrary.exe entry ->
   Actions -> Allow on device. (Only do this for a copy from the official GitHub release.)
3. Needs Windows 10 or 11 (it uses Microsoft Edge's built-in WebView2).

USING IT
- Paste a Yupoo link (e.g. shida-tiyu888.x.yupoo.com/albums) in the box at the
  top of the library and press Open.
- Browse normally. The green bar at the bottom shows how many items were saved
  from each page.
    Back              - go back a page
    Save whole store  - saves every page of that supplier's catalog. It keeps
                        going if you leave the store: the progress moves to a
                        card in the bottom-right corner (– shrinks it, click the
                        round badge to bring it back, Open store goes back)
                        (about 2 seconds per page so Yupoo doesn't block you)
    Library           - back to your library
- ⚙ Settings (top right): language (English / 中文), where cover photos are kept
  (Browse… to pick another folder; your photos are moved there for you), and where
  your library and exports are saved, with "Open folder" buttons.
- Pasting a link for a store you already have? The box tells you straight away
  ("Already in your library … — 1,234 items"), so you don't open it twice.
- In the library:
    Categories - what each item is (Shirts › Football Kit, Shoes › Sneakers…);
               ▸ opens or folds a category's subcategories
               🏷 on a card changes one item; 🏷 next to a store sets what
               that store sells (used when a title doesn't say)
    ☑ Select - bulk edit: click items to tick them (Shift+click ticks a run,
               or "Select all matching"), then "Move to…" a category.
               Undo appears for 15 seconds afterwards.
    Stores   - narrow to one supplier; "open" jumps back into that store,
               ✎ gives the store your own name, 🗑 removes the store and
               everything saved from it (asks first)
    Filters  - the dropdowns above the items (category, brand, team, season, kit type, extras,
               store) each have a search box; Team searches English or Chinese
               ("liv" or "利物浦") and only applies to clothing
    Sort     - "Brand A–Z" groups everything by brand with a heading per brand;
               the normal sort groups shoes by brand and clothing by team
    ✎ Team   - fix anything under "Unsorted"; it can learn that spelling
    🗑       - remove an item
    Export CSV / Backup - saved to your Downloads folder
    Restore  - load a backup .zip (adds anything that's missing)
    Untick "Auto-save while browsing" to pause; the green bar then offers
    "Save this page" instead.

- The Catalog (📒 Catalog at the top of the library; ⧉ opens it in its own window):
    your own collections of items, e.g. a "Wishlist" of things to order later.
    ☆ on a card   - add that item to a collection (or make a new one); turns ★ gold
    ☑ Select      - tick several items, then "☆ Add to collection"
    In the Catalog: notes per item (size, quantity…), ✕ takes an item out (Undo),
    ✎ rename / 🗑 delete a collection (the items stay in your library),
    Export CSV saves the list you're looking at.
    📤 Export to share saves a collection as a file you can send to anyone with
    the app; they open it with 📥 Import a shared collection (on the left).

WHERE YOUR DATA LIVES
  %APPDATA%\YupooLibrary\library.json       your items
  %APPDATA%\YupooLibrary\thumbs\            photo snapshots
  (or M:\Yupoo Library\Thumbnails when the M: drive is plugged in)
  %APPDATA%\YupooLibrary\thumb-errors.log   recent photo download failures, for troubleshooting
Nothing is sent anywhere; the app only talks to Yupoo.
