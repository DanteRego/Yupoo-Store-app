// Kit Organizer — dictionary + title parser.
// To add a team or a supplier's nickname for one, add it to the list below.
// Longer names automatically win over shorter ones (e.g. 国际米兰 beats 米兰).

var YO_TEAMS = {
  // ---------- England / Scotland ----------
  "Manchester United": ["曼联", "曼彻斯特联", "曼聯", "Man Utd", "Man United", "MUFC"],
  "Manchester City": ["曼城", "曼彻斯特城", "Man City"],
  "Liverpool": ["利物浦", "LW", "LWP"],
  "Arsenal": ["阿森纳", "阿仙奴", "兵工厂", "啊森纳"],
  "Chelsea": ["切尔西", "车路士"],
  "Tottenham": ["热刺", "托特纳姆", "Spurs"],
  "West Ham": ["西汉姆联", "西汉姆", "韦斯特汉姆"],
  "Newcastle United": ["纽卡斯尔联", "纽卡斯尔", "纽卡斯", "纽卡", "Newcastle"],
  "Aston Villa": ["阿斯顿维拉", "维拉"],
  "Everton": ["埃弗顿"],
  "Leeds United": ["利兹联", "利兹", "Leeds"],
  "Leicester City": ["莱斯特城", "莱斯特", "Leicester"],
  "Nottingham Forest": ["诺丁汉森林", "诺丁汉"],
  "Blackburn Rovers": ["布莱克本", "Blackburn"],
  "Southampton": ["南安普顿"],
  "Wolves": ["狼队", "伍尔弗汉普顿"],
  "Brighton": ["布莱顿"],
  "Crystal Palace": ["水晶宫"],
  "Fulham": ["富勒姆"],
  "Sunderland": ["桑德兰"],
  "Middlesbrough": ["米德尔斯堡"],
  "Celtic": ["凯尔特人"],
  "Cork City": ["科克城"],
  "Rangers": ["格拉斯哥流浪者", "流浪者"],
  "Sheffield Wednesday": ["谢菲尔德星期三", "谢周三", "谢周"],
  "Portsmouth": ["朴茨茅斯"],
  "Birmingham City": ["伯明翰"],
  "Wrexham": ["雷克瑟姆"],
  "Derby County": ["德比郡"],
  "Hull City": ["赫尔城"],
  "Stoke City": ["斯托克城"],
  "QPR": ["女王公园巡游者"],
  "Plymouth Argyle": ["普利茅斯"],

  // ---------- Spain ----------
  "Barcelona": ["巴塞罗那", "巴萨", "巴塞", "巴赛", "Barca", "FC Barcelona"],
  "Real Madrid": ["皇家马德里", "皇马", "银河战舰", "王马"],
  "Atletico Madrid": ["马德里竞技", "马竞", "马竟", "Atletico"],
  "Valencia": ["瓦伦西亚"],
  "Sevilla": ["塞维利亚"],
  "Real Betis": ["皇家贝蒂斯", "贝蒂斯", "Betis", "贝帝斯"],
  "Athletic Bilbao": ["毕尔巴鄂竞技", "毕尔巴鄂"],
  "Villarreal": ["比利亚雷亚尔", "黄色潜水艇"],
  "Deportivo La Coruna": ["拉科鲁尼亚", "拉克鲁尼亚", "科鲁尼亚", "拉科", "Deportivo"],
  "Real Sociedad": ["皇家社会"],
  "Malaga": ["马拉加"],
  "Celta Vigo": ["塞尔塔"],
  "Real Valladolid": ["巴拉多利德", "巴利亚多利德"],
  "Tenerife": ["特内里费"],
  "Granada": ["格拉纳达"],
  "Real Zaragoza": ["萨拉戈萨"],
  "Cordoba": ["科尔多瓦", "科尔瓦多"],
  "Elche": ["埃尔切"],
  "Las Palmas": ["拉斯帕尔马斯", "拉斯帕耳马斯"],
  "Sporting Gijon": ["希洪竞技"],
  "Rayo Vallecano": ["巴列卡诺"],
  "Osasuna": ["奥萨苏纳"],

  // ---------- Italy ----------
  "Juventus": ["尤文图斯", "尤文", "Juve"],
  "AC Milan": ["AC米兰", "米兰", "AC"],
  "Inter Milan": ["国际米兰", "国米", "Inter"],
  "Roma": ["罗马", "AS Roma"],
  "Lazio": ["拉齐奥"],
  "Napoli": ["那不勒斯"],
  "Fiorentina": ["佛罗伦萨", "费伦天拿"],
  "Parma": ["帕尔马"],
  "Atalanta": ["亚特兰大"],
  "Sampdoria": ["桑普多利亚", "桑普"],
  "Venezia": ["威尼斯"],
  "Genoa": ["热那亚"],
  "Palermo": ["巴勒莫"],

  // ---------- Germany ----------
  "Bayern Munich": ["拜仁慕尼黑", "拜仁", "Bayern"],
  "Borussia Dortmund": ["多特蒙德", "多特", "Dortmund", "BVB"],
  "Bayer Leverkusen": ["勒沃库森", "药厂", "Leverkusen"],
  "Schalke 04": ["沙尔克04", "沙尔克", "Schalke"],
  "Hamburg": ["汉堡"],
  "Werder Bremen": ["云达不莱梅", "不莱梅"],
  "RB Leipzig": ["莱比锡红牛", "莱比锡", "Leipzig"],
  "FC Koln": ["科隆"],
  "Eintracht Frankfurt": ["法兰克福"],
  "Kaiserslautern": ["凯泽斯劳滕", "凯泽斯劳腾"],
  "Nurnberg": ["纽伦堡"],
  "Hannover 96": ["汉诺威"],
  "St. Pauli": ["圣保利"],
  "Hertha Berlin": ["柏林赫塔", "赫塔"],
  "Borussia Monchengladbach": ["门兴格拉德巴赫", "门兴"],
  "Wolfsburg": ["沃尔夫斯堡"],
  "Karlsruher SC": ["卡尔斯鲁厄"],
  "Arminia Bielefeld": ["比勒费尔德"],
  "Preussen Munster": ["明斯特普鲁士", "明斯特"],

  // ---------- France ----------
  "Paris Saint-Germain": ["巴黎圣日耳曼", "大巴黎", "巴黎", "PSG"],
  "Marseille": ["马赛", "马塞"],
  "Lyon": ["里昂"],
  "Monaco": ["摩纳哥"],
  "Lille": ["里尔"],
  "Lens": ["朗斯"],
  "Auxerre": ["欧塞尔"],

  // ---------- Rest of Europe ----------
  "Ajax": ["阿贾克斯", "贾克斯"],
  "FC Copenhagen": ["哥本哈根"],
  "PSV": ["埃因霍温"],
  "Feyenoord": ["费耶诺德"],
  "Benfica": ["本菲卡"],
  "Porto": ["波尔图"],
  "Sporting CP": ["葡萄牙体育", "里斯本竞技", "里斯本", "Sporting"],
  "Galatasaray": ["加拉塔萨雷", "加拉塔雷", "加拉塔"],
  "Fenerbahce": ["费内巴切"],
  "Trabzonspor": ["特拉布宗"],
  "Olympiacos": ["奥林匹亚科斯"],

  // ---------- Americas / Asia ----------
  "Boca Juniors": ["博卡青年", "博卡"],
  "River Plate": ["河床"],
  "Santos": ["桑托斯", "桑拖斯"],
  "Atletico Mineiro": ["竞技米内罗", "米内罗"],
  "Millonarios": ["百万富翁"],
  "Tigres UANL": ["老虎"],
  "New York Red Bulls": ["纽约红牛"],
  "Sao Paulo": ["圣保罗"],
  "Club America": ["墨西哥美洲", "美洲"],
  "Colo-Colo": ["科洛科洛", "科洛"],
  "Universidad de Chile": ["智利大学"],
  "Flamengo": ["弗拉门戈", "佛拉门戈", "弗拉明戈"],
  "Corinthians": ["科林蒂安", "科林帝安"],
  "Palmeiras": ["帕尔梅拉斯"],
  "Inter Miami": ["迈阿密国际", "迈阿密"],
  "LA Galaxy": ["洛杉矶银河", "银河"],
  "Al Nassr": ["利雅得胜利", "利雅得"],
  "Al Hilal": ["利雅得新月", "新月"],
  "Al Ittihad": ["吉达联合"],
  "Al Ahli": ["吉达国民"],
  "Al Ahly": ["阿赫利"],
  "Cruz Azul": ["蓝十字"],
  "Monterrey": ["蒙特雷"],
  "Toluca": ["托卢卡"],
  "Chivas": ["芝华士", "瓜达拉哈拉"],
  "Vasco da Gama": ["达伽马"],
  "Gremio": ["格雷米奥"],
  "Cruzeiro": ["克鲁塞罗", "克鲁赛罗"],
  "Bahia": ["巴伊亚"],
  "Botafogo": ["博塔弗戈"],
  "Fluminense": ["弗鲁米嫩塞", "米嫩塞"],
  "Atletico Nacional": ["国民竞技"],
  "Universidad Catolica": ["天主教大学", "天主教"],

  // ---------- National teams ----------
  "Brazil": ["巴西"],
  "Argentina": ["阿根廷"],
  "France": ["法国"],
  "Germany": ["德国"],
  "West Germany": ["西德"],
  "Italy": ["意大利"],
  "Spain": ["西班牙"],
  "England": ["英格兰"],
  "Portugal": ["葡萄牙"],
  "Netherlands": ["荷兰", "Holland"],
  "Belgium": ["比利时"],
  "Croatia": ["克罗地亚"],
  "Scotland": ["苏格兰"],
  "Wales": ["威尔士"],
  "Republic of Ireland": ["爱尔兰", "Ireland"],
  "Northern Ireland": ["北爱尔兰"],
  "Denmark": ["丹麦"],
  "Sweden": ["瑞典"],
  "Norway": ["挪威"],
  "Switzerland": ["瑞士"],
  "Austria": ["奥地利"],
  "Poland": ["波兰"],
  "Turkey": ["土耳其"],
  "Greece": ["希腊"],
  "Czech Republic": ["捷克"],
  "Romania": ["罗马尼亚"],
  "Soviet Union": ["苏联", "USSR"],
  "Yugoslavia": ["南斯拉夫"],
  "USA": ["美国"],
  "Mexico": ["墨西哥"],
  "Canada": ["加拿大"],
  "Colombia": ["哥伦比亚"],
  "Uruguay": ["乌拉圭"],
  "Chile": ["智利"],
  "Peru": ["秘鲁"],
  "Japan": ["日本"],
  "South Korea": ["韩国"],
  "China": ["中国"],
  "Australia": ["澳大利亚"],
  "Saudi Arabia": ["沙特"],
  "Nigeria": ["尼日利亚"],
  "Cameroon": ["喀麦隆"],
  "Senegal": ["塞内加尔", "塞纳河加尔"],
  "Algeria": ["阿尔及利亚"],
  "Ivory Coast": ["科特迪瓦"],
  "DR Congo": ["刚果", "钢果"],
  "Morocco": ["摩洛哥"],
  "Ghana": ["加纳"],
  "Jamaica": ["牙买加"],
  "Egypt": ["埃及"],
  "Albania": ["阿尔巴尼亚"],
  "Cape Verde": ["佛得角"],
  "Bosnia and Herzegovina": ["波黑"],
  "Curacao": ["库拉索"],
  "South Africa": ["南非"],
  "Venezuela": ["委内瑞拉"],
  "Palestine": ["巴勒斯坦"],

  // ---------- Not a team ----------
  "Iron Maiden": ["铁娘子"]
};

// Kit type: only the first match is used.
var YO_KIT = [
  ["第三客场", "Third"], ["三客", "Third"], ["第三", "Third"], ["third", "Third"],
  ["第二客场", "Second Away"], ["二客", "Second Away"],
  ["守门员", "Goalkeeper"], ["门将", "Goalkeeper"], ["goalkeeper", "Goalkeeper"], ["GK", "Goalkeeper"],
  ["训练服", "Training"], ["训练", "Training"], ["training", "Training"],
  ["赛前服", "Pre-Match"],
  ["客场", "Away"], ["away", "Away"], ["客", "Away"],
  ["主场", "Home"], ["home", "Home"], ["主", "Home"]
];

// Extras: every match is listed.
var YO_EXTRAS = [
  ["欧冠决赛", "Champions League Final"], ["欧冠", "Champions League"], ["美洲杯", "Copa America"],
  ["世界杯", "World Cup"], ["欧洲杯", "Euro"], ["决赛", "Final"],
  ["复古", "Retro"], ["retro", "Retro"],
  ["球迷版", "Fan Version"], ["fan version", "Fan Version"],
  ["球员版", "Player Version"], ["player version", "Player Version"],
  ["长袖", "Long Sleeve"], ["long sleeve", "Long Sleeve"],
  ["童装", "Kids"], ["儿童", "Kids"], ["kids", "Kids"],
  ["女装", "Women's"], ["女款", "Women's"],
  ["套装", "Kit Set"], ["球裤", "Shorts"],
  ["风衣", "Windbreaker"], ["外套", "Jacket"], ["夹克", "Jacket"], ["卫衣", "Hoodie"], ["背心", "Vest"],
  ["纪念版", "Special Edition"], ["纪念款", "Special Edition"], ["特别版", "Special Edition"], ["联名", "Collab"],
  ["休闲款", "Casual Style"], ["双面", "Reversible"], ["百年", "Centenary"], ["马拉多纳", "Maradona"], ["V领", "V-Neck"]
];

var YO_SEASON_RE = /((?:18|19|20)\d{2})\s*(?:[\/\-–~]\s*(\d{4}|\d{2}))?\s*年?/;

// Short seasons some suppliers write: "2526" or "25/26" = 2025/26. Only back-to-back years count,
// so product codes like "9006" are left alone.
var YO_SHORT_SEASON_RE = /(^|[^\d])(\d{2})\s*([\/\-]?)\s*(\d{2})(?!\d)/g;
function yoShortSeason(t) {
  YO_SHORT_SEASON_RE.lastIndex = 0;
  var m;
  while ((m = YO_SHORT_SEASON_RE.exec(t))) {
    var a = parseInt(m[2], 10), b = parseInt(m[4], 10);
    if ((a + 1) % 100 === b) {
      var full = (a < 60 ? 2000 : 1900) + a;
      return { season: full + "/" + m[4], key: full, text: m[0].slice(m[1].length) };
    }
    YO_SHORT_SEASON_RE.lastIndex = m.index + 1;
  }
  return null;
}

function yoIsAscii(s) { return /^[\x00-\x7f]+$/.test(s); }
function yoBoundary(s, i, len) {
  return !/[a-z]/i.test(s.charAt(i - 1)) && !/[a-z]/i.test(s.charAt(i + len));
}
function yoFind(lowerText, term) {
  var t = term.toLowerCase(), ascii = yoIsAscii(term), i = lowerText.indexOf(t);
  while (i !== -1) {
    if (!ascii || yoBoundary(lowerText, i, t.length)) return i;
    i = lowerText.indexOf(t, i + 1);
  }
  return -1;
}
function yoSortByLength(list) {
  return list.slice().sort(function (a, b) { return b[0].length - a[0].length; });
}
var YO_KIT_SORTED = yoSortByLength(YO_KIT);
var YO_EXTRAS_SORTED = yoSortByLength(YO_EXTRAS);

function YO_buildMatcher(learned) {
  var list = [];
  Object.keys(YO_TEAMS).forEach(function (team) {
    list.push([team, team]);
    YO_TEAMS[team].forEach(function (a) { list.push([a, team]); });
  });
  Object.keys(learned || {}).forEach(function (a) { list.push([a, learned[a]]); });
  return yoSortByLength(list);
}

// Earliest match in the title wins; ties go to the longer name.
function YO_findTeam(text, matcher) {
  var lower = String(text).toLowerCase(), best = null;
  for (var k = 0; k < matcher.length; k++) {
    var alias = matcher[k][0], i = yoFind(lower, alias);
    if (i === -1) continue;
    if (!best || i < best.idx || (i === best.idx && alias.length > best.len)) {
      best = { idx: i, len: alias.length, team: matcher[k][1], alias: alias };
    }
  }
  return best;
}

function yoTake(text, list, out, all) {
  for (var k = 0; k < list.length; k++) {
    var lower = text.toLowerCase(), i = yoFind(lower, list[k][0]);
    if (i === -1) continue;
    if (out.indexOf(list[k][1]) === -1) out.push(list[k][1]);
    text = text.slice(0, i) + " " + text.slice(i + list[k][0].length);
    if (!all) return text;
  }
  return text;
}

function YO_english(r) {
  var main = [r.team || "Unsorted", r.season, r.kit].filter(Boolean).join(" ");
  return r.extras && r.extras.length ? main + " · " + r.extras.join(", ") : main;
}

function YO_parse(title, matcher) {
  var t = String(title || ""), rest = t;
  var r = { team: null, season: null, seasonKey: null, kit: null, extras: [] };
  var sm = t.match(YO_SEASON_RE);
  if (sm) {
    var y2 = sm[2];
    if (y2 && y2.length === 4) y2 = y2.slice(2);
    r.season = y2 ? sm[1] + "/" + y2 : sm[1];
    r.seasonKey = parseInt(sm[1], 10);
    rest = t.replace(sm[0], " ");
  } else {
    var short = yoShortSeason(t);
    if (short) {
      r.season = short.season;
      r.seasonKey = short.key;
      rest = t.replace(short.text, " ");
    }
  }
  rest = yoTake(rest, YO_EXTRAS_SORTED, r.extras, true);
  var tm = YO_findTeam(rest, matcher);
  if (tm) {
    r.team = tm.team;
    rest = rest.slice(0, tm.idx) + " " + rest.slice(tm.idx + tm.len);
  }
  var kits = [];
  yoTake(rest, YO_KIT_SORTED, kits, false);
  r.kit = kits[0] || null;
  r.english = YO_english(r);
  return r;
}

// For an unsorted title, guess the chunk that names the team (text after the season, before the kit type).
function YO_guessAlias(title) {
  var t = String(title || "");
  var sm = t.match(YO_SEASON_RE);
  if (sm) t = t.replace(sm[0], " ");
  t = t.trim();
  var cut = t.length;
  YO_KIT.concat(YO_EXTRAS).forEach(function (p) {
    var i = yoFind(t.toLowerCase(), p[0]);
    if (i > 0 && i < cut) cut = i;
  });
  var seg = t.slice(0, cut).split(/[\s\-_:：·,，\/|()（）【】\[\]]/)[0].trim();
  return seg.length >= 2 && seg.length <= 10 ? seg : null;
}

function YO_canonicalTeam(name, learned) {
  var n = String(name).trim().toLowerCase();
  var teams = Object.keys(YO_TEAMS);
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].toLowerCase() === n) return teams[i];
    if (YO_TEAMS[teams[i]].some(function (a) { return a.toLowerCase() === n; })) return teams[i];
  }
  var l = learned || {};
  for (var a in l) if (a.toLowerCase() === n) return l[a];
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { YO_TEAMS, YO_parse, YO_buildMatcher, YO_guessAlias, YO_canonicalTeam, YO_findTeam };
}
