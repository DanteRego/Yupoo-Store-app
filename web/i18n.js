// Yupoo Library — languages: English (the default) and 中文 (Chinese). Loaded first on every page.
//
// Two ways text gets translated:
//   1. Fixed labels (buttons, menus, headings, category names…) are looked up in I18N_ZH below and
//      swapped automatically wherever they appear on the page — also in parts drawn later.
//   2. Messages with numbers or names in them are written in both languages where they're made:
//        L(`Moved ${n} items`, `已移动 ${n} 件`)
// To fix a translation, change it here (1) or next to the English text in the page's code (2).
// The language is chosen on the ⚙ Settings page and saved in the app's settings.

// The app writes your language into each page (<meta name="kit-lang">); localStorage is a fallback.
let LANG = (() => {
  const m = document.querySelector('meta[name="kit-lang"]');
  if (m && /^(en|zh)$/.test(m.content)) return m.content;
  try { return localStorage.getItem("lang") === "zh" ? "zh" : "en"; } catch (e) { return "en"; }
})();

// English text, or its Chinese version when the app is in Chinese.
function L(en, zh) { return LANG === "zh" && zh != null ? zh : en; }
// A fixed label from the dictionary.
function t(en) { return (LANG === "zh" && I18N_ZH[en]) || en; }
// A category like "Shoes › Sneakers".
function tCat(path) { return String(path).split(" › ").map(t).join(" › "); }
// Numbers in the usual style for the language.
function num(n) { return Number(n || 0).toLocaleString(LANG === "zh" ? "zh-CN" : undefined); }

const I18N_ZH = {
  // header & general
  "Yupoo Library": "Yupoo 图库", "Refresh": "刷新", "Open": "打开", "📒 Wishlist": "📒 愿望清单", "⧉": "⧉",
  "Auto-save while browsing": "浏览时自动保存", "Export CSV": "导出 CSV", "Backup": "备份", "Restore": "恢复", "Export Saved Data": "导出保存的数据", "Your saved data": "你保存的数据", "Import": "导入",
  "Save your whole library and photos as a .zip file": "把整个图库和图片存成一个 .zip 文件", "Save a spreadsheet (CSV) of every item": "把每件商品存成一个表格（CSV）",
  "Add the items from an exported .zip file": "把导出的 .zip 文件里的商品加回来",
  "⬆ Check for updates": "⬆ 检查更新", "⚙ Settings": "⚙ 设置", "◀ Library": "◀ 图库", "⧉ New window": "⧉ 新窗口",
  "🌓 Auto": "🌓 自动", "🌙 Dark": "🌙 深色", "☀️ Light": "☀️ 浅色",
  "Paste a Yupoo link, e.g. shida-tiyu888.x.yupoo.com/albums": "粘贴 Yupoo 链接，例如 shida-tiyu888.x.yupoo.com/albums",
  "Show items saved since this page was opened (e.g. from Save whole store)": "显示打开本页后新保存的商品（例如“保存整个店铺”）",
  "Your collections of saved items": "你保存的商品收藏夹", "Open the Wishlist in its own window": "在新窗口打开愿望清单",
  "See if a newer version of Yupoo Library is out": "看看 Yupoo 图库有没有新版本", "Light / dark mode": "浅色 / 深色模式",
  "Settings: language, photos folder…": "设置：语言、图片文件夹…",
  // sidebar
  "Categories": "分类", "Stores": "店铺", "All items": "全部商品", "All stores": "全部店铺", "open ↗": "打开 ↗",
  "Rename this store": "重命名这个店铺", "Remove this store and everything saved from it": "删除这个店铺和从它保存的所有内容",
  "Drag to resize — double-click for the normal width": "拖动调整宽度——双击恢复默认宽度",
  "Show subcategories": "显示子分类", "Hide subcategories": "隐藏子分类",
  // ✨ New Additions
  "✨ New Additions": "✨ 新上架", "Items your stores added since you last opened the app": "上次打开应用之后店铺新上架的商品", "Items your stores have added (checked every 2 hours)": "店铺新上架的商品（每 2 小时检查一次）",
  "⟳ Check now": "⟳ 立即检查", "Look through your stores for new items again": "再检查一次店铺的新品", "◀ All items": "◀ 全部商品",
  "Take these items off New Additions (they stay in your library)": "把这些商品移出新上架（它们仍在图库里）", "NEW": "新",
  "Seen it — take it off New Additions (it stays in your library)": "看过了——移出新上架（仍在图库里）", "Show": "查看",
  "Enter password": "输入密码", "New password": "新密码",
  "The check can't see inside these stores without their password": "没有密码，检查功能看不到这些店铺里的商品",
  // filters & sorting
  "Search items — name, team, season, store or Chinese title": "搜索商品——名称、球队、赛季、店铺或中文标题",
  "Any category": "全部分类", "Any brand": "全部品牌", "Any team": "全部球队", "Any season": "全部赛季",
  "Any kit type": "全部球衣类型", "Any extras": "全部附加", "Any store": "全部店铺",
  "Category": "分类", "Brand": "品牌", "Team": "球队", "Season": "赛季", "Kit type": "球衣类型", "Extras": "附加", "Store": "店铺",
  "Category, then brand / team": "按分类，再按品牌 / 球队", "Brand A–Z": "品牌 A–Z", "Season: newest first": "赛季：从新到旧",
  "Season: oldest first": "赛季：从旧到新", "Recently saved": "最近保存", "✕ Clear filters": "✕ 清除筛选",
  "☑ Select": "☑ 多选", "☑ Selecting…": "☑ 选择中…", "Select several items to move them to a category at once": "一次选择多个商品，批量改分类或加入收藏",
  "Search…": "搜索…", "Search stores…": "搜索店铺…", "No brand in title": "标题里没有品牌", "No team": "没有球队", "No season": "没有赛季",
  "No kit type": "没有球衣类型", "No extras": "没有附加", "⚠ Kits with no team": "⚠ 没识别出球队的球衣",
  "60 per page": "每页 60", "120 per page": "每页 120", "240 per page": "每页 240", "Items per page": "每页显示数量",
  "Previous page": "上一页", "Next page": "下一页", "Pages": "页码",
  // cards
  "Open album ↗": "打开相册 ↗", "✎ Team": "✎ 球队", "Set the team": "设置球队", "Change what this item is": "修改这个商品的分类",
  "Remove from library": "从图库删除", "your pick": "你的选择", "your fix": "你的修改", "photos": "张图片",
  "Add to a collection (Wishlist)": "加入收藏夹（愿望清单）",
  // select bar
  "Clear": "清除", "Move to… ▾": "移动到… ▾", "Search or type a new category…": "搜索或输入新分类…",
  "☆ Add to collection ▾": "☆ 加入收藏夹 ▾", "Let sorter decide": "让系统自动分类", "🗑 Remove": "🗑 删除", "Done": "完成",
  "Add the selected items to a collection in your Wishlist": "把选中的商品加入收藏夹",
  "Forget your picks and let the item sorter decide again": "忘记你的选择，让系统重新自动分类",
  "Undo": "撤销", "Open album": "打开相册",
  // categories
  "Shirts": "上衣", "Football Kit": "球衣", "Fashion Jersey": "时尚球衣", "T-Shirt": "T恤", "Polo": "Polo衫", "Sweater": "毛衣",
  "Hoodie": "卫衣", "Jacket": "外套", "Blank Teamwear": "空白队服", "Other Shirts": "其他上衣",
  "Bottoms": "下装", "Shorts": "短裤", "Pants": "长裤", "Other Bottoms": "其他下装",
  "Shoes": "鞋", "Football Boots": "足球鞋", "Running Shoes": "跑鞋", "Basketball Shoes": "篮球鞋", "Training Shoes": "训练鞋",
  "Sneakers": "运动休闲鞋", "Hiking & Trail": "徒步越野鞋", "Slides & Sandals": "拖鞋凉鞋", "Boots": "靴子", "Other Shoes": "其他鞋",
  "Bags & Accessories": "包和配饰", "Bags": "包", "Hats": "帽子", "Socks": "袜子", "Other Accessories": "其他配饰",
  "Other": "其他", "Size Charts": "尺码表",
  "Basketball Jersey": "篮球服", "Other Sports Jersey": "其他运动球衣", "Tracksuit": "运动套装",
  "Watches": "手表", "Glasses": "眼镜", "Jewelry": "首饰", "Belts": "腰带", "Scarves": "围巾",
  // kit types & extras
  "Home": "主场", "Away": "客场", "Second Away": "第二客场", "Third": "第三", "Goalkeeper": "守门员", "Training": "训练服",
  "Pre-Match": "赛前服", "Long Sleeve": "长袖", "Retro": "复古", "Kids": "童装", "Fan Version": "球迷版", "Player Version": "球员版",
  // Catalog
  "Wishlist": "愿望清单", "Collections": "收藏夹", "＋ New collection": "＋ 新建收藏夹", "📥 Import a shared collection": "📥 导入别人分享的收藏夹",
  "✎ Rename": "✎ 重命名", "📤 Export to share": "📤 导出分享", "🗑 Delete collection": "🗑 删除收藏夹",
  "Search this collection — name, team, store, note…": "在这个收藏夹里搜索——名称、球队、店铺、备注…",
  "Recently added": "最近添加", "Oldest first": "最早添加", "Name A–Z": "名称 A–Z", "All collected items": "全部收藏的商品",
  "Your Wishlist": "你的愿望清单", "Add a note — size, quantity, price…": "添加备注——尺码、数量、价格…", "Rename": "重命名",
  "Delete this collection": "删除这个收藏夹", "Change which collections it's in": "修改它所在的收藏夹",
  "Back to the Library (your place there is kept)": "返回图库（会回到你离开时的位置）",
  "Open a collection file someone sent you (made with 📤 Export to share)": "打开别人发给你的收藏夹文件（用“📤 导出分享”生成）",
  "Save this collection as a file you can send to someone else with Yupoo Library": "把这个收藏夹存成文件，发给也在用 Yupoo 图库的人",
  "Start a Wishlist": "新建愿望清单", "Go to the Library": "去图库", "Search or name a new collection…": "搜索或输入新收藏夹名称…",
  "Add to collection": "加入收藏夹",
  // Settings
  "Settings": "设置", "Language": "语言", "Photos folder": "图片文件夹", "Where things are saved": "文件保存位置",
  "About": "关于", "Browse…": "浏览…", "📂 Open folder": "📂 打开文件夹", "Use this folder": "使用这个文件夹",
  "Cancel": "取消", "Use the default folder": "使用默认文件夹",
  // green bar & progress card
  "Save whole store": "保存整个店铺", "Stop": "停止", "Library": "图库", "Save this page": "保存本页", "◀ Back": "◀ 返回",
  "Open store": "打开店铺", "Close this message": "关闭这条消息", "Shrink": "缩小", "Close": "关闭"
};

// ---------- swapping fixed labels on the page ----------
function i18nNode(root) {
  if (LANG !== "zh" || !root) return;
  if (root.nodeType === 3) {
    const raw = root.nodeValue, key = raw.trim();
    if (key && I18N_ZH[key]) root.nodeValue = raw.replace(key, I18N_ZH[key]);
    return;
  }
  if (root.nodeType !== 1) return;
  const walk = (el) => {
    for (const attr of ["title", "placeholder", "aria-label"]) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && I18N_ZH[v.trim()]) el.setAttribute(attr, I18N_ZH[v.trim()]);
    }
    for (const n of el.childNodes) {
      if (n.nodeType === 3) i18nNode(n);
      else if (n.nodeType === 1 && n.tagName !== "SCRIPT" && n.tagName !== "STYLE" && !n.isContentEditable && n.tagName !== "TEXTAREA") walk(n);
    }
  };
  walk(root);
}
let i18nObserver = null;
function applyLanguage() {
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  window.__kitLang = LANG;
  if (LANG !== "zh") return;
  i18nNode(document.body);
  if (!i18nObserver) {
    i18nObserver = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") i18nNode(m.target);
        else m.addedNodes.forEach(i18nNode);
      }
    });
    i18nObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}
// Called once the app's settings have loaded; reloads the page if the saved language differs.
function useLanguage(lang) {
  lang = lang === "zh" ? "zh" : "en";
  try { localStorage.setItem("lang", lang); } catch (e) {}
  if (lang !== LANG) { location.reload(); return true; }
  return false;
}
document.addEventListener("DOMContentLoaded", applyLanguage);
if (document.readyState !== "loading") applyLanguage();
