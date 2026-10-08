// Yupoo Library — the brand finder: works out an item's brand (Nike, Adidas, Louis Vuitton…) from its title.
// Plain browser JavaScript, loaded after categories.js.
//
// To teach it a brand or another way a supplier writes one, add it to YO_BRANDS.
// Brands are checked from top to bottom and the first one found wins, so sub-brands and collabs
// that name two brands go first (Jordan before Nike: "Nike Air Jordan 1" is a Jordan).
// English words match at the start of a word, so "nike" also finds "NikeVomero"; words of 3 letters
// or fewer must stand alone ("AD" yes, "ADIDAS" no — that's matched by "adidas" itself).

var YO_BRANDS = [
  ["Jordan", ["air jordan", "jordan", "ordan", "乔丹", "aj1", "aj3", "aj4", "aj5", "aj6", "aj9", "aj11", "aj12", "aj13", "aj312", "travis scott", "travis",
    "乔1", "乔2", "乔3", "乔4", "乔5", "乔6", "乔7", "乔8", "乔9", "乔十", "乔-1", "乔 1"]],
  ["Yeezy", ["yeezy", "kanye", "椰子"]],
  // Sportswear (before the fashion houses, so "Off-White x Nike Dunk" counts as Nike)
  ["Nike", ["nike", "nnike", "ike", "nk", "nkcraft", "nikecraft", "tom sachs", "耐克", "air force", "af1", "空军", "dunk", "air max", "blazer", "cortez", "shox",
    "foamposite", "vomero", "pegasus", "zoomx", "hyperdunk", "lebron", "kobe", "g.t. cut", "metcon", "acg", "mercurial",
    "phantom gx", "phantom 6", "tiempo", "initiator", "moon shoe", "v2k", "p-6000"]],
  ["Adidas", ["adidas", "addis", "adadis", "adida", "didas", "adids", "ad", "climacool", "阿迪达斯", "阿迪", "啊迪", "三叶草", "samba", "gazelle", "spezial",
    "campus", "superstar", "stan smith", "ultraboost", "adizero", "adistar", "predator", "terrex", "hyperboost", "adimule", "taekwondo",
    "ozweego"]],
  ["New Balance", ["new balance", "ew balance", "newbalance", "nb", "新百伦"]],
  ["On", ["on running", "on cloud", "昂跑", "cloud", "the roger"]],
  ["Hoka", ["hoka", "霍卡", "clifton", "bondi", "mafate", "speedgoat"]],
  ["Puma", ["puma", "彪马", "speedcat"]],
  ["Asics", ["asics", "亚瑟士", "gel-kayano", "kayano", "gel-nyc", "gel-1130", "novablast", "nimbus"]],
  ["Onitsuka Tiger", ["onitsuka", "鬼冢虎"]],
  ["Salomon", ["salomon", "萨洛蒙", "xt-6"]],
  ["The North Face", ["the north face", "north face", "北面", "tnf"]],
  ["Brooks", ["brooks", "布鲁克斯", "glycerin"]],
  ["Saucony", ["saucony", "索康尼"]],
  ["Mizuno", ["mizuno", "美津浓"]],
  ["Reebok", ["reebok", "锐步"]],
  ["Under Armour", ["under armour", "安德玛"]],
  ["Converse", ["converse", "匡威", "chuck 70"]],
  ["Vans", ["vans", "万斯", "old skool", "ultrarange"]],
  ["Altra", ["altra", "奥创"]],
  ["Merrell", ["merrell", "迈乐"]],
  ["Norda", ["norda"]],
  ["Vibram", ["vibram", "fivefingers"]],
  ["Li-Ning", ["li-ning", "li ning", "李宁"]],
  ["Anta", ["anta", "安踏"]],
  ["Fila", ["fila", "斐乐"]],
  ["Skechers", ["skechers", "斯凯奇"]],
  // Luxury and fashion houses (often written with their Chinese names)
  ["Louis Vuitton", ["louis vuitton", "louis", "lv", "lv-", "路易威登", "驴牌"]],
  ["Dior", ["dior", "ior", "迪奥", "b30", "b33", "b28", "b27", "b22", "b23"]],
  ["Balenciaga", ["balenciaga", "巴黎世家"]],
  ["Gucci", ["gucci", "ggcc", "gg-cc", "古驰"]],
  ["Prada", ["prada", "普拉达"]],
  ["Miu Miu", ["miumiu", "miu miu", "缪缪"]],
  ["Alexander McQueen", ["alexander mcqueen", "mcqueen", "麦昆"]],
  ["Bottega Veneta", ["bottega", "葆蝶家", "bv"]],
  ["Chanel", ["chanel", "chanei", "香奈儿"]],
  ["Burberry", ["burberry", "巴宝莉"]],
  ["Supreme", ["supreme"]],
  ["Maison Mihara Yasuhiro", ["mihara", "三原康裕"]],
  ["Off-White", ["off-white", "off white", "offwhite"]],
  ["Maison Margiela", ["maison margiela", "maisonmargiela", "margiela", "马吉拉"]],
  ["Rick Owens", ["rick owens", "rickowens", "欧文斯"]],
  ["Raf Simons", ["raf simons", "raf"]],
  ["Loro Piana", ["loro piana", "loro"]],
  ["Brunello Cucinelli", ["brunello"]],
  ["Moncler", ["moncler", "盟可睐"]],
  ["Hermès", ["hermes", "hermès", "爱马仕"]],
  ["Fendi", ["fendi", "芬迪"]],
  ["Givenchy", ["givenchy", "纪梵希"]],
  ["Valentino", ["valentino", "华伦天奴"]],
  ["Golden Goose", ["golden goose", "ggdb", "金鹅"]],
  ["Amiri", ["amiri"]],
  ["Lanvin", ["lanvin", "浪凡"]],
  ["Jacquemus", ["jacquemus"]],
  ["Christian Louboutin", ["christian louboutin", "louboutin", "christian"]],
  ["Tom Ford", ["tom ford", "tomford"]],
  ["Dolce & Gabbana", ["dolce & gabbana", "dolce gabbana", "dolce gabanna", "dolce", "d&g", "dg", "杜嘉班纳"]],
  ["Versace", ["versace", "范思哲"]],
  ["Balmain", ["balmain", "巴尔曼"]],
  ["Saint Laurent", ["saint laurent", "ysl", "圣罗兰"]],
  ["Celine", ["celine", "赛琳"]],
  ["Armani", ["armani", "阿玛尼"]],
  ["Casablanca", ["casablanca"]],
  ["Marni", ["marni"]],
  ["Tod's", ["tod's", "tods"]],
  ["Premiata", ["premiata"]],
  ["Rene Caovilla", ["rene caovilla", "caovilla"]],
  ["Stussy", ["stussy", "斯图西"]],
  ["Cartier", ["cartier", "卡地亚"]],
  ["Rolex", ["rolex", "劳力士"]],
  ["Audemars Piguet", ["audemars", "爱彼"]],
  ["Ray-Ban", ["ray-ban", "rayban", "ray ban", "雷朋"]],
  ["Hugo Boss", ["hugo boss", "boss"]],
  ["Stone Island", ["stone island"]],
  ["Comme des Garçons", ["comme des", "cdg"]],
  ["Bape", ["bapesta", "bapestatolow", "bape", "a bathing ape", "猿人头"]],
  ["MLB", ["mlb"]],
  ["Alo", ["alo yoga", "alo"]],
  ["Caterpillar", ["caterpillar", "cat", "卡特"]],
  ["Timberland", ["timberland", "添柏岚", "天伯伦"]],
  ["Dr. Martens", ["dr. martens", "dr martens", "马丁"]],
  ["UGG", ["ugg"]],
  ["Birkenstock", ["birkenstock", "博肯"]],
  ["Crocs", ["crocs", "卡骆驰", "洞洞鞋"]],
  ["Kelme", ["kelme", "卡尔美"]],
  ["Joma", ["joma", "荷马"]],
  ["Umbro", ["umbro", "茵宝"]],
  ["Kappa", ["kappa", "卡帕"]],
  ["Diadora", ["diadora", "迪亚多纳"]]
];

function yoBrandFind(lower, alias) {
  var x = yoTerm(alias), a = x.lower, i = lower.indexOf(a); // yoTerm (teams.js) remembers the lower-case form
  var ascii = x.ascii, short = a.length <= 3;
  while (i !== -1) {
    if (!ascii) return true;
    var before = lower.charAt(i - 1), after = lower.charAt(i + a.length);
    if (!/[a-z]/.test(before) && (!short || !/[a-z0-9]/.test(after))) return true;
    i = lower.indexOf(a, i + 1);
  }
  return false;
}

// Product codes say the brand when the title doesn't (e.g. a store that only lists colour + code).
var YO_BRAND_CODES = [
  [/\b[A-Z]{2}\d{4}[- ]\d{3}\b/, "Nike"],        // Nike / Jordan style code: HF3255-108
  [/\b1[0-2]\d\dA\d{3}[- ]\d{3}\b/, "Asics"],    // Asics: 1203A591-002
  [/货号[:：]\s*[A-Z]{2}\d{4}(?![\d -])/, "Adidas"] // Adidas article number: IH4046
];

// The item's brand, or "" if the title doesn't say. Codes are only trusted for shoes.
function YO_brand(title, category) {
  var t = String(title || ""), lower = t.toLowerCase();
  for (var i = 0; i < YO_BRANDS.length; i++) {
    var b = YO_BRANDS[i];
    for (var j = 0; j < b[1].length; j++) if (yoBrandFind(lower, b[1][j])) return b[0];
  }
  if (category === "Shoes") {
    for (var k = 0; k < YO_BRAND_CODES.length; k++) if (YO_BRAND_CODES[k][0].test(t)) return YO_BRAND_CODES[k][1];
  }
  return "";
}
