// Yupoo Library — the item sorter: works out what each item is (Category › Subcategory) from its title.
// Plain browser JavaScript, loaded after teams.js.
//
// To add a category or subcategory: add it to YO_CATEGORIES (the order here is the order in the Library).
// To teach the sorter a new word: add a line to YO_CATEGORY_WORDS, e.g.  ["拖鞋", "Shoes", "Slides & Sandals"].
// Words are checked from top to bottom and the first one found in the title wins,
// so put very specific words (like 足球鞋 = football boots) above general ones (like 鞋 = shoe).

var YO_CATEGORIES = [
  { name: "Shirts", subs: ["Football Kit", "Fashion Jersey", "T-Shirt", "Polo", "Sweater", "Hoodie", "Jacket", "Blank Teamwear", "Other Shirts"] },
  { name: "Bottoms", subs: ["Shorts", "Pants", "Other Bottoms"] },
  { name: "Shoes", subs: ["Football Boots", "Running Shoes", "Basketball Shoes", "Training Shoes", "Sneakers",
    "Hiking & Trail", "Slides & Sandals", "Boots", "Other Shoes"] },
  { name: "Bags & Accessories", subs: ["Bags", "Hats", "Socks", "Other Accessories"] },
  { name: "Other", subs: ["Size Charts"] }
];

// Categories where a football team makes sense (team, season, kit type and extras are only shown for these).
var YO_CLOTHING = ["Shirts", "Bottoms"];

var YO_CATEGORY_WORDS = [
  // ---- Size charts (pictures of a size table, not something to buy)
  ["尺寸表", "Other", "Size Charts"], ["尺码表", "Other", "Size Charts"], ["尺码对照", "Other", "Size Charts"],
  ["size chart", "Other", "Size Charts"],

  // ---- Shoes: football boots first, because their titles often also say 针织 (knit) etc.
  ["足球鞋", "Shoes", "Football Boots"], ["球鞋足球", "Shoes", "Football Boots"], ["钉鞋", "Shoes", "Football Boots"],
  ["碎钉", "Shoes", "Football Boots"], ["草钉", "Shoes", "Football Boots"], ["长钉", "Shoes", "Football Boots"],
  ["football boots", "Shoes", "Football Boots"], ["soccer", "Shoes", "Football Boots"],
  ["mercurial", "Shoes", "Football Boots"], ["phantom gx", "Shoes", "Football Boots"], ["phantom 6", "Shoes", "Football Boots"],
  ["phantom luna", "Shoes", "Football Boots"], ["phantom gt", "Shoes", "Football Boots"], ["predator", "Shoes", "Football Boots"],
  ["tiempo", "Shoes", "Football Boots"], ["copa pure", "Shoes", "Football Boots"], ["copa mundial", "Shoes", "Football Boots"],
  ["morelia", "Shoes", "Football Boots"],

  ["篮球鞋", "Shoes", "Basketball Shoes"], ["篮球", "Shoes", "Basketball Shoes"], ["basketball", "Shoes", "Basketball Shoes"],
  ["lebron", "Shoes", "Basketball Shoes"], ["kobe", "Shoes", "Basketball Shoes"], ["g.t. cut", "Shoes", "Basketball Shoes"],
  ["gt cut", "Shoes", "Basketball Shoes"], ["sabrina", "Shoes", "Basketball Shoes"], ["giannis", "Shoes", "Basketball Shoes"],
  ["hyperdunk", "Shoes", "Basketball Shoes"], ["curry", "Shoes", "Basketball Shoes"], ["harden", "Shoes", "Basketball Shoes"], ["luka", "Shoes", "Basketball Shoes"],

  ["徒步", "Shoes", "Hiking & Trail"], ["登山", "Shoes", "Hiking & Trail"], ["越野", "Shoes", "Hiking & Trail"],
  ["terrex", "Shoes", "Hiking & Trail"], ["ACG", "Shoes", "Hiking & Trail"], ["gore-tex", "Shoes", "Hiking & Trail"],
  ["GTX", "Shoes", "Hiking & Trail"], ["mafate", "Shoes", "Hiking & Trail"], ["speedgoat", "Shoes", "Hiking & Trail"],
  ["trail", "Shoes", "Hiking & Trail"], ["salomon", "Shoes", "Hiking & Trail"], ["萨洛蒙", "Shoes", "Hiking & Trail"],
  ["cloudvista", "Shoes", "Hiking & Trail"], ["wildhorse", "Shoes", "Hiking & Trail"], ["norda", "Shoes", "Hiking & Trail"],
  ["north face", "Shoes", "Hiking & Trail"], ["北面", "Shoes", "Hiking & Trail"],

  ["跑鞋", "Shoes", "Running Shoes"], ["跑步", "Shoes", "Running Shoes"], ["慢跑", "Shoes", "Running Shoes"],
  ["running", "Shoes", "Running Shoes"], ["runner", "Shoes", "Running Shoes"], ["昂跑", "Shoes", "Running Shoes"],
  ["hoka", "Shoes", "Running Shoes"], ["clifton", "Shoes", "Running Shoes"], ["bondi", "Shoes", "Running Shoes"],
  ["pegasus", "Shoes", "Running Shoes"], ["vomero", "Shoes", "Running Shoes"], ["invincible", "Shoes", "Running Shoes"],
  ["vaporfly", "Shoes", "Running Shoes"], ["alphafly", "Shoes", "Running Shoes"], ["zoomx", "Shoes", "Running Shoes"],
  ["ultraboost", "Shoes", "Running Shoes"], ["ultra boost", "Shoes", "Running Shoes"], ["supernova", "Shoes", "Running Shoes"],
  ["adizero", "Shoes", "Running Shoes"], ["kayano", "Shoes", "Running Shoes"], ["nimbus", "Shoes", "Running Shoes"],
  ["novablast", "Shoes", "Running Shoes"], ["cloudswift", "Shoes", "Running Shoes"], ["cloudmonster", "Shoes", "Running Shoes"],
  ["cloudtilt", "Shoes", "Running Shoes"], ["cloudboom", "Shoes", "Running Shoes"], ["hyperboost", "Shoes", "Running Shoes"],
  ["brooks", "Shoes", "Running Shoes"], ["glycerin", "Shoes", "Running Shoes"], ["journey run", "Shoes", "Running Shoes"], ["adistar", "Shoes", "Running Shoes"], ["cloud", "Shoes", "Running Shoes"],

  ["训练鞋", "Shoes", "Training Shoes"], ["metcon", "Shoes", "Training Shoes"],

  ["拖鞋", "Shoes", "Slides & Sandals"], ["凉鞋", "Shoes", "Slides & Sandals"], ["洞洞鞋", "Shoes", "Slides & Sandals"],
  ["slide", "Shoes", "Slides & Sandals"], ["slides", "Shoes", "Slides & Sandals"], ["sandal", "Shoes", "Slides & Sandals"],
  ["sandals", "Shoes", "Slides & Sandals"], ["birkenstock", "Shoes", "Slides & Sandals"], ["博肯", "Shoes", "Slides & Sandals"],
  ["crocs", "Shoes", "Slides & Sandals"],

  ["马丁靴", "Shoes", "Boots"], ["雪地靴", "Shoes", "Boots"], ["靴", "Shoes", "Boots"], ["boots", "Shoes", "Boots"],
  ["timberland", "Shoes", "Boots"], ["ugg", "Shoes", "Boots"], ["卡特", "Shoes", "Boots"],

  ["板鞋", "Shoes", "Sneakers"], ["休闲鞋", "Shoes", "Sneakers"], ["帆布鞋", "Shoes", "Sneakers"], ["老爹鞋", "Shoes", "Sneakers"],
  ["空军", "Shoes", "Sneakers"], ["sneaker", "Shoes", "Sneakers"], ["sneakers", "Shoes", "Sneakers"],
  ["dunk", "Shoes", "Sneakers"], ["air force", "Shoes", "Sneakers"], ["af1", "Shoes", "Sneakers"],
  ["jordan", "Shoes", "Sneakers"], ["AJ1", "Shoes", "Sneakers"], ["air max", "Shoes", "Sneakers"],
  ["blazer", "Shoes", "Sneakers"], ["cortez", "Shoes", "Sneakers"], ["samba", "Shoes", "Sneakers"],
  ["gazelle", "Shoes", "Sneakers"], ["campus", "Shoes", "Sneakers"], ["spezial", "Shoes", "Sneakers"],
  ["superstar", "Shoes", "Sneakers"], ["stan smith", "Shoes", "Sneakers"], ["forum", "Shoes", "Sneakers"],
  ["yeezy", "Shoes", "Sneakers"], ["new balance", "Shoes", "Sneakers"], ["converse", "Shoes", "Sneakers"],
  ["vans", "Shoes", "Sneakers"], ["old skool", "Shoes", "Sneakers"], ["golden goose", "Shoes", "Sneakers"],
  ["blazerlow", "Shoes", "Sneakers"], ["sambae", "Shoes", "Sneakers"], ["foamposite", "Shoes", "Sneakers"],
  ["shox", "Shoes", "Sneakers"], ["moon shoe", "Shoes", "Sneakers"], ["initiator", "Shoes", "Sneakers"],
  ["mind 001", "Shoes", "Sneakers"], ["sb force", "Shoes", "Sneakers"], ["speedcat", "Shoes", "Sneakers"],
  ["v2k", "Shoes", "Sneakers"], ["v5 rnr", "Shoes", "Sneakers"], ["chunky liner", "Shoes", "Sneakers"],
  ["lv trainer", "Shoes", "Sneakers"], ["tilted", "Shoes", "Sneakers"], ["bapesta", "Shoes", "Sneakers"],
  ["bapestatolow", "Shoes", "Sneakers"], ["ozweego", "Shoes", "Sneakers"], ["adimule", "Shoes", "Sneakers"],
  ["taekwondo", "Shoes", "Sneakers"], ["air monarch", "Shoes", "Sneakers"], ["trainer", "Shoes", "Sneakers"],
  ["trainers", "Shoes", "Sneakers"], ["court borough", "Shoes", "Sneakers"],

  ["球鞋", "Shoes", "Other Shoes"], ["运动鞋", "Shoes", "Other Shoes"], ["鞋", "Shoes", "Other Shoes"],
  ["shoes", "Shoes", "Other Shoes"], ["shoe", "Shoes", "Other Shoes"],

  // ---- Bags & accessories (包 on its own also means "packaging", so only full bag words)
  ["双肩包", "Bags & Accessories", "Bags"], ["背包", "Bags & Accessories", "Bags"], ["斜挎包", "Bags & Accessories", "Bags"],
  ["手提包", "Bags & Accessories", "Bags"], ["腰包", "Bags & Accessories", "Bags"], ["钱包", "Bags & Accessories", "Bags"],
  ["backpack", "Bags & Accessories", "Bags"], ["bag", "Bags & Accessories", "Bags"],
  ["帽子", "Bags & Accessories", "Hats"], ["棒球帽", "Bags & Accessories", "Hats"], ["渔夫帽", "Bags & Accessories", "Hats"],
  ["cap", "Bags & Accessories", "Hats"], ["hat", "Bags & Accessories", "Hats"], ["beanie", "Bags & Accessories", "Hats"],
  ["袜", "Bags & Accessories", "Socks"], ["socks", "Bags & Accessories", "Socks"],

  // ---- Clothing
  ["卫衣", "Shirts", "Hoodie"], ["连帽", "Shirts", "Hoodie"], ["hoodie", "Shirts", "Hoodie"],
  ["毛衣", "Shirts", "Sweater"], ["针织衫", "Shirts", "Sweater"], ["sweater", "Shirts", "Sweater"],
  ["jumper", "Shirts", "Sweater"], ["sweatshirt", "Shirts", "Sweater"],
  ["羽绒", "Shirts", "Jacket"], ["外套", "Shirts", "Jacket"], ["夹克", "Shirts", "Jacket"], ["风衣", "Shirts", "Jacket"],
  ["棉服", "Shirts", "Jacket"], ["jacket", "Shirts", "Jacket"], ["windbreaker", "Shirts", "Jacket"], ["coat", "Shirts", "Jacket"],
  ["POLO", "Shirts", "Polo"], ["P O L O", "Shirts", "Polo"], ["PO", "Shirts", "Polo"], ["翻领", "Shirts", "Polo"],
  ["反领", "Shirts", "Polo"],
  // Casual shirts (休闲 = casual, 圆领 = crew neck). Above the fashion-jersey words, so a casual lotus tee is a T-shirt.
  ["圆领", "Shirts", "T-Shirt"], ["休闲", "Shirts", "T-Shirt"],
  // Blank teamwear for custom printing (空白版 = blank version, 卡尔美 = Kelme, 涤盖涤 = a teamwear fabric).
  ["空白版", "Shirts", "Blank Teamwear"], ["空白", "Shirts", "Blank Teamwear"], ["光板", "Shirts", "Blank Teamwear"],
  ["卡尔美", "Shirts", "Blank Teamwear"], ["kelme", "Shirts", "Blank Teamwear"], ["涤盖涤", "Shirts", "Blank Teamwear"],
  ["joma", "Shirts", "Blank Teamwear"], ["荷马", "Shirts", "Blank Teamwear"],
  // Fashion / lifestyle jerseys (Adidas lotus 荷花 jacquard 提花, the Oasis 绿洲 collab, city editions).
  ["荷花", "Shirts", "Fashion Jersey"], ["提花", "Shirts", "Fashion Jersey"], ["绿洲", "Shirts", "Fashion Jersey"],
  ["oasis", "Shirts", "Fashion Jersey"], ["ADoasis", "Shirts", "Fashion Jersey"], ["首尔限量", "Shirts", "Fashion Jersey"],
  ["城市限量", "Shirts", "Fashion Jersey"],
  ["球裤", "Bottoms", "Shorts"], ["短裤", "Bottoms", "Shorts"], ["shorts", "Bottoms", "Shorts"],
  ["长裤", "Bottoms", "Pants"], ["卫裤", "Bottoms", "Pants"], ["运动裤", "Bottoms", "Pants"], ["pants", "Bottoms", "Pants"],
  ["trousers", "Bottoms", "Pants"], ["joggers", "Bottoms", "Pants"], ["裤", "Bottoms", "Other Bottoms"],
  ["球衣", "Shirts", "Football Kit"], ["足球服", "Shirts", "Football Kit"], ["jersey", "Shirts", "Football Kit"],
  ["训练服", "Shirts", "Football Kit"], ["主场", "Shirts", "Football Kit"], ["客场", "Shirts", "Football Kit"],
  ["二客", "Shirts", "Football Kit"], ["三客", "Shirts", "Football Kit"], ["特别版", "Shirts", "Football Kit"],
  ["纪念版", "Shirts", "Football Kit"], ["C罗", "Shirts", "Football Kit"], ["梅西", "Shirts", "Football Kit"],
  ["内马尔", "Shirts", "Football Kit"], ["足球", "Shirts", "Football Kit"],
  ["T恤", "Shirts", "T-Shirt"], ["t-shirt", "Shirts", "T-Shirt"], ["tee", "Shirts", "T-Shirt"],

  // ---- Brands that (in these stores) mostly mean shoes. They come after the clothing words,
  // so "Gucci 卫衣" is still a hoodie.
  ["adidas originals", "Shoes", "Sneakers"], ["louis vuitton", "Shoes", "Sneakers"], ["路易威登", "Shoes", "Sneakers"],
  ["dior", "Shoes", "Sneakers"], ["迪奥", "Shoes", "Sneakers"], ["gucci", "Shoes", "Sneakers"], ["ggcc", "Shoes", "Sneakers"],
  ["gg-cc", "Shoes", "Sneakers"], ["mlb", "Shoes", "Sneakers"], ["prada", "Shoes", "Sneakers"], ["fendi", "Shoes", "Sneakers"],
  ["bottega veneta", "Shoes", "Sneakers"], ["off-white", "Shoes", "Sneakers"], ["maison margiela", "Shoes", "Sneakers"],
  ["margiela", "Shoes", "Sneakers"], ["raf simons", "Shoes", "Sneakers"], ["rick owens", "Shoes", "Sneakers"],
  ["rickowens", "Shoes", "Sneakers"], ["loro piana", "Shoes", "Sneakers"], ["moncler", "Shoes", "Sneakers"],
  ["sacai", "Shoes", "Sneakers"], ["boss", "Shoes", "Sneakers"], ["bape", "Shoes", "Sneakers"],
  ["amiri", "Shoes", "Sneakers"], ["lanvin", "Shoes", "Sneakers"], ["givenchy", "Shoes", "Sneakers"],
  ["valentino", "Shoes", "Sneakers"], ["爱马仕", "Shoes", "Sneakers"], ["hermes", "Shoes", "Sneakers"],
  ["balenciaga", "Shoes", "Sneakers"], ["巴黎世家", "Shoes", "Sneakers"], ["mcqueen", "Shoes", "Sneakers"], ["麦昆", "Shoes", "Sneakers"]
];

// Shoe sizes like "36-45", "39~46", "尺码：36 37 38" or "38 39 40 41".
var YO_SHOE_SIZES = /(?:^|[^\d.])(3[4-9]|4[0-9])(?:\.5)?\s*[-–~至到]\s*(3[5-9]|4[0-9])|(?:尺码|码数|size)\s*[:：]?\s*(3[4-9]|4[0-9])\b|(?:(?:^|\D)(?:3[4-9]|4[0-9])(?:\.5)?\s+){3}/i;

// Clothing sizes like "S-4XL", "S到4XL" or "s-3xl".
var YO_CLOTHING_SIZES = /(?:^|[^a-z])s\s*(?:-|–|~|到|至)\s*\d?x*l(?![a-z])/i;

// What an item is. "fixed" is the item's own choice (🏷 on the card) and "storeDefault" the store's (🏷 in Stores);
// both look like "Shoes › Sneakers" or just "Shoes". "parsed" is the YO_parse result for the title.
function YO_categorize(title, parsed, fixed, storeDefault) {
  var split = function (path, how) {
    var parts = String(path).split("›").map(function (s) { return s.trim(); });
    return { category: parts[0], sub: parts[1] || "", how: how };
  };
  if (fixed) return split(fixed, "yours");
  var lower = String(title || "").toLowerCase();
  // Shoe sizes in the title (36 37 38…) mean it's a shoe, so clothing words like 休闲 (casual) are skipped.
  var shoeSized = YO_SHOE_SIZES.test(title || "");
  for (var k = 0; k < YO_CATEGORY_WORDS.length; k++) {
    var w = YO_CATEGORY_WORDS[k];
    if (yoFind(lower, w[0]) === -1) continue;
    if (shoeSized && YO_CLOTHING.indexOf(w[1]) !== -1) continue;
    return { category: w[1], sub: w[2], how: "word", word: w[0] };
  }
  if (storeDefault) return split(storeDefault, "store");
  if (YO_SHOE_SIZES.test(title || "")) return { category: "Shoes", sub: "Other Shoes", how: "sizes" };
  if (parsed && (parsed.team || (parsed.season && parsed.kit))) return { category: "Shirts", sub: "Football Kit", how: "team" };
  if (YO_CLOTHING_SIZES.test(title || "")) return { category: "Shirts", sub: "Other Shirts", how: "clothing sizes" };
  return { category: "Other", sub: "", how: "none" };
}

// Every "Category" and "Category › Subcategory", in Library order.
function YO_categoryPaths() {
  var out = [];
  YO_CATEGORIES.forEach(function (c) {
    out.push(c.name);
    c.subs.forEach(function (s) { out.push(c.name + " › " + s); });
  });
  return out;
}
function YO_categoryRank(category, sub) {
  for (var i = 0; i < YO_CATEGORIES.length; i++) {
    if (YO_CATEGORIES[i].name === category) {
      var j = sub ? YO_CATEGORIES[i].subs.indexOf(sub) : -1;
      return i * 100 + (sub ? (j === -1 ? 99 : j + 1) : 0);
    }
  }
  return 9999;
}

// A tidy name for items that aren't football kits: the title without codes, sizes and filler.
function YO_cleanName(title) {
  var t = String(title || "").replace(/\.(jpe?g|png|webp)$/i, "");
  t = t.split(/货号|尺码|码数|size\s*[:：]/i)[0];
  t = t.replace(/(3[4-9]|4[0-9])(\.5)?\s*[-–~至到]\s*(3[5-9]|4[0-9])(\.5)?/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(title || "").trim();
}
