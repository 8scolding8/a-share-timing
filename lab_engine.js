/* 回测实验室网页版引擎：在浏览器里计算，与 timing/lab/engine.py 逐项同口径（tests/test_lab_static.py 用 Node 核对）。
   只用 ES2017 以内的写法。浏览器里挂在 window.LabEngine；Node 里 module.exports。 */
(function (root) {
  'use strict';

  var OPS = ['>', '>=', '<', '<=', '==', 'between'];
  var OP_CN = { '>': '高于', '>=': '不低于', '<': '低于', '<=': '不高于', '==': '等于', between: '介于' };
  var KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
  var SRC_RE = /^(ind|feat|ok|ix:[a-z0-9]+|ixfeat:[a-z0-9]+)$/;
  var NONE = 'none';
  var NONE_NAME = '未满足任何状态';

  function SchemeError(msg) { var e = new Error(msg); e.scheme = true; return e; }

  // ------------------------------------------------------------ 数值工具
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function r(x, nd) {
    if (x === null || x === undefined || !isFinite(x)) { return null; }
    nd = nd === undefined ? 4 : nd;
    return Number(Number(x).toFixed(nd));
  }
  function sorted(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function quantile(a, q) {          // pandas 默认：线性插值，忽略空值
    var s = sorted(a.filter(isNum));
    if (!s.length) { return NaN; }
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function median(a) { return quantile(a, 0.5); }
  function mean(a) { var s = 0, n = 0; a.forEach(function (x) { if (isNum(x)) { s += x; n++; } }); return n ? s / n : NaN; }
  function winRate(a) { var k = 0, n = 0; a.forEach(function (x) { if (isNum(x)) { n++; if (x > 0) { k++; } } }); return n ? k / n : NaN; }
  function wilson(k, n, z) {
    z = z || 1.96;
    if (n <= 0) { return [null, null]; }
    var p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d;
    var h = z * Math.sqrt(Math.max(p * (1 - p) / n + z * z / (4 * n * n), 0)) / d;
    return [c - h, c + h];
  }
  function episodeCount(m, gap) {     // m：布尔数组（按 j 的位置）
    var last = -1, n = 0;
    for (var i = 0; i < m.length; i++) { if (m[i]) { if (last < 0 || i - last > gap) { n++; } last = i; } }
    return n;
  }
  function episodeStarts(m, gap) {
    var out = [], last = -1;
    for (var i = 0; i < m.length; i++) { if (m[i]) { if (last < 0 || i - last > gap) { out.push(i); } last = i; } }
    return out;
  }
  function decode(o, n) {
    var a = new Float64Array(n);
    a.fill(NaN);
    if (!o) { return a; }
    for (var i = 0; i < o.v.length; i++) { var v = o.v[i]; if (v !== null) { a[o.s + i] = v; } }
    return a;
  }

  // ------------------------------------------------------------ 显示格式（与 units.fmt_value、regime_v1.fmt_cond 对应）
  function fixed(x, nd) { return Number(x).toFixed(nd); }
  function grouped(x, nd) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: nd, maximumFractionDigits: nd }); }
  function numTxt(v, nd) { return Math.abs(v) >= 1e4 ? grouped(v, nd) : fixed(v, nd); }
  function fmtValue(v, unit, labels) {
    if (!isNum(v)) { return '—'; }
    if (unit === 'label') { var key = String(Math.round(v)); return (labels && labels[key]) || key; }
    var a = v;
    if (unit === 'pct') { return fixed(a * 100, Math.abs(a) < 0.1 ? 2 : 1) + '%'; }
    if (unit === 'pctpt') { return fixed(a, 2) + '%'; }
    if (unit === 'pp') { return fixed(a, 2) + 'pp'; }
    if (unit === 'bp') { return fixed(a * 100, 0) + 'bp'; }
    if (unit === 'yi' || unit === 'yi_native' || unit === 'yi_share') {
      var y = unit === 'yi' ? a / 1e8 : a, suf = unit === 'yi_share' ? '亿份' : '亿';
      return Math.abs(y) >= 1e4 ? fixed(y / 1e4, 2) + '万' + suf : fixed(y, Math.abs(y) >= 100 ? 0 : 1) + suf;
    }
    if (unit === 'x') { return fixed(a, 1) + '倍'; }
    if (unit === 'ratio') { return fixed(a, 2); }
    if (unit === 'pt') { return numTxt(a, 1); }
    if (unit === 'sigma') { return fixed(a, 2) + 'σ'; }
    if (unit === 'count') { return fixed(a, 0) + '家'; }
    if (unit === 'days') { return fixed(a, 0) + '日'; }
    if (unit === 'k_person') { return fixed(a / 10, 1) + '万人'; }
    if (unit === 'score') { return fixed(a, 2); }
    return Math.abs(a) < 1000 ? numTxt(a, 2) : numTxt(a, 0);
  }
  function fmtCond(v, unit) {
    if (!isNum(v)) { return '—'; }
    if (unit === 'pct') { return fixed(v * 100, 0) + '%分位'; }
    if (unit === 'ratio') { return fixed(v * 100, 1) + '%'; }
    if (unit === 'chg') { return (v >= 0 ? '+' : '') + fixed(v * 100, 1) + '%'; }
    if (unit === 'pp') { return (v >= 0 ? '+' : '') + fixed(v * 100, 1) + ' 个百分点'; }
    if (unit === 'flag') { return v >= 0.5 ? '是' : '否'; }
    if (unit === 'level') { return Math.round(v) + ' 级'; }
    if (unit === 'times') { return Math.round(v) + ' 次'; }
    if (unit === 'yi') { return grouped(v, 0) + ' 亿元'; }
    return Math.abs(v) < 10 ? (v >= 0 ? '+' : '') + fixed(v, 3) : grouped(v, 0);
  }
  function fmtByUnit(v, unit, labels) { return unit && unit.indexOf('f_') === 0 ? fmtCond(v, unit.slice(2)) : fmtValue(v, unit || 'num', labels); }

  // ------------------------------------------------------------ 引擎
  function create(meta, catalog) {
    var E = { meta: meta, catalog: catalog, lookup: {}, core: null, ix: null, n: 0, cache: {}, paths: {}, risk: {} };
    catalog.forEach(function (c) { E.lookup[c.src + '|' + c.id] = c; });

    E.setCore = function (core) {
      E.core = core; E.dates = core.dates; E.n = core.dates.length; E.cache = {}; E.paths = {}; E.risk = {};
      E.closes = {};
      Object.keys(core.closes).forEach(function (k) { E.closes[k] = decode(core.closes[k], E.n); });
    };
    E.setIx = function (ix) { E.ix = ix; };
    E.needsIx = function (conds) { return conds.some(function (c) { return /^ix/.test(c.src); }); };

    function series(src, id, field) {
      var key = src + '|' + field + '|' + id;
      if (E.cache[key]) { return E.cache[key]; }
      var o;
      if (src === 'ind') { o = (field === 'pct' ? E.core.ind_p : E.core.ind_v)[id]; } else if (src === 'feat') { o = E.core.feat[id]; } else {
        var p = src.split(':'), kind = p[0], ixk = p[1];
        if (!E.ix) { throw SchemeError('四个指数的数据还没加载完，请稍后再试'); }
        o = E.ix[ixk + '|' + (kind === 'ixfeat' ? 'feat' : (field === 'pct' ? 'p' : 'v')) + '|' + id];
      }
      E.cache[key] = decode(o, E.n);
      return E.cache[key];
    }
    E.series = series;

    // ---------------- 校验（与 engine.py 的提示一致）
    function num(x, what) {
      var v = typeof x === 'number' ? x : (typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);
      if (typeof x !== 'number' && (typeof x !== 'string' || x.trim() === '' || isNaN(v))) { throw SchemeError(what + '不是数字：' + JSON.stringify(x)); }
      if (!isFinite(v)) { throw SchemeError(what + '不是有效数字'); }
      return v;
    }
    function int(x, what, lo, hi, dflt) {
      if (x === null || x === undefined || x === '') { return dflt; }
      var v = num(x, what);
      if (v !== Math.floor(v) || v < lo || v > hi) { throw SchemeError(what + '要是 ' + lo + '–' + hi + ' 之间的整数'); }
      return v;
    }
    function text(x) { return String(x || '').trim().slice(0, 120); }
    function checkCond(c, states) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) { throw SchemeError('条件格式不对'); }
      var src = String(c.src || ''), id = String(c.id || ''), field = c.field || 'value', op = c.op;
      if (!SRC_RE.test(src)) { throw SchemeError('不认识的数据来源：' + src); }
      if (OPS.indexOf(op) < 0) { throw SchemeError('不支持的比较方式：' + op); }
      if (src === 'ok') {
        var m = /^([a-z][a-z0-9_]{0,23}):(\d{1,3})$/.exec(id);
        if (!states) { throw SchemeError('“某状态近 N 日曾满足”只能用在状态体系里'); }
        if (!m || !Object.prototype.hasOwnProperty.call(states, m[1])) { throw SchemeError('“近 N 日曾满足”引用的状态 ' + id.split(':')[0] + ' 不存在，或写在了引用它的状态后面'); }
        if (+m[2] < 1) { throw SchemeError('天数至少为 1'); }
        field = 'value';
      } else {
        if (field !== 'value' && field !== 'pct') { throw SchemeError('比较对象只能是原始值或分位：' + field); }
        var meta2 = E.lookup[src + '|' + id];
        if (!meta2) { throw SchemeError('没有这个指标：' + src + ' / ' + id); }
        if (field === 'pct' && !meta2.has_pct) { throw SchemeError('“' + meta2.name + '”没有历史分位，只能比较原始值'); }
      }
      var th = c.th, ths;
      if (op === 'between') {
        if (!Array.isArray(th) || th.length !== 2) { throw SchemeError('“介于”要填下限和上限两个数'); }
        th = [num(th[0], '下限'), num(th[1], '上限')];
        if (th[0] > th[1]) { throw SchemeError('下限不能大于上限'); }
        ths = th;
      } else { th = num(th, '阈值'); ths = [th]; }
      if (field === 'pct' && ths.some(function (v) { return v < 0 || v > 1; })) { throw SchemeError('分位阈值要在 0–100% 之间'); }
      return { src: src, id: id, field: field, op: op, th: th, text: text(c.text), info: !!c.info };
    }
    function checkGroup(g, states, allowEmpty) {
      if (!g || typeof g !== 'object') { throw SchemeError('方案格式不对'); }
      var req = g.required || [], opt = g.optional || {};
      var items = (opt && typeof opt === 'object' && !Array.isArray(opt)) ? (opt.items || []) : [];
      if (!Array.isArray(req) || !Array.isArray(items)) { throw SchemeError('条件要写成列表'); }
      if (req.length + items.length > meta.limits.conds) { throw SchemeError('一组最多 ' + meta.limits.conds + ' 条条件'); }
      req = req.map(function (c) { return checkCond(c, states); });
      items = items.map(function (c) { return checkCond(c, states); });
      var counted = items.filter(function (c) { return !c.info; });
      var mn = int(opt && typeof opt === 'object' ? opt.min : null, '“几选几”的数量', 0, Math.max(counted.length, 0), Math.min(1, counted.length));
      if (!allowEmpty && !req.filter(function (c) { return !c.info; }).length && !counted.length) { throw SchemeError('至少要有一条计入判定的条件'); }
      return { name: text(g.name) || '未命名方案', required: req, optional: { items: items, min: mn },
        persist: int(g.persist, '连续满足天数', 1, 60, 1), gap: int(g.gap, '事件间隔', 1, 250, meta.ep_gap) };
    }
    function checkSettings(s) {
      s = s && typeof s === 'object' ? s : {};
      var targets = (s.targets && s.targets.length ? s.targets : ['WA']).filter(function (t) { return E.closes[t]; });
      if (!targets.length) { throw SchemeError('至少选一个回测标的'); }
      var hs = [];
      (s.horizons && s.horizons.length ? s.horizons : meta.horizons).forEach(function (h) {
        var v = parseInt(h, 10); if (meta.horizons.indexOf(v) >= 0 && hs.indexOf(v) < 0) { hs.push(v); }
      });
      hs.sort(function (a, b) { return a - b; });
      if (!hs.length) { throw SchemeError('至少选一个持有期（5、20、60 日）'); }
      var start = s.start || E.dates[0], end = s.end || E.dates[E.n - 1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) { throw SchemeError('起止日期格式不对，应为 YYYY-MM-DD'); }
      if (start >= end) { throw SchemeError('开始日期要早于结束日期'); }
      return { targets: targets.slice(0, 5), horizons: hs, start: start, end: end };
    }
    function checkRegime(sc) {
      if (!sc || typeof sc !== 'object' || !sc.states || typeof sc.states !== 'object') { throw SchemeError('状态体系要写成 {states: {键: 条件组}}'); }
      var keys = Object.keys(sc.states);
      if (keys.length < 1 || keys.length > meta.limits.states) { throw SchemeError('状态数要在 1–' + meta.limits.states + ' 个之间'); }
      var dflt = sc.default || NONE, names = {}, states = {}, total = 0;
      keys.forEach(function (k) {
        if (!KEY_RE.test(k) || k === NONE) { throw SchemeError('状态键 ' + JSON.stringify(k) + ' 不合规（小写字母开头，只含小写字母、数字、下划线）'); }
        var spec = sc.states[k] || {};
        var seen = {}; Object.keys(names).forEach(function (x) { seen[x] = names[x]; });
        var g = checkGroup(spec, seen, k === dflt);
        g.name = text(spec.name) || k;
        g.framework = text(spec.framework);
        total += g.required.length + g.optional.items.length;
        names[k] = g.name; states[k] = g;
      });
      if (total > meta.limits.total) { throw SchemeError('全部状态合计最多 ' + meta.limits.total + ' 条条件'); }
      if (dflt !== NONE && !states[dflt]) { throw SchemeError('默认状态 ' + dflt + ' 不存在'); }
      var others = keys.filter(function (k) { return k !== dflt; });
      var pri = sc.priority || others;
      if (!Array.isArray(pri) || sorted0(pri) !== sorted0(others)) { throw SchemeError('优先级要把除默认状态以外的每个状态各列一次'); }
      var cdIn = sc.confirm_days || {}, cd = {};
      keys.concat([NONE]).forEach(function (k) { cd[k] = int(cdIn[k], '“' + (names[k] || NONE_NAME) + '”的连续确认天数', 1, 60, 1); });
      var lb = sc.bottom_repair_lookback;
      if (lb !== null && lb !== undefined && lb !== '') {
        if (!states.bottom_repair) { throw SchemeError('“底部修复前须出现过熊市”只在状态里有 bottom_repair 时可用'); }
        lb = int(lb, '底部修复的回看天数', 1, 500, 120);
      } else { lb = null; }
      return { name: text(sc.name) || '未命名状态体系', states: states, priority: pri.slice(), default: dflt, confirm_days: cd, bottom_repair_lookback: lb };
    }
    function sorted0(a) { return JSON.stringify(a.slice().sort()); }

    // ---------------- 条件判断
    function colOf(c) { return c.src === 'ok' ? 'ok:' + c.id : (c.src === 'feat' ? c.id : c.src + '|' + c.field + '|' + c.id); }
    function metaOf(c) { return c.src === 'ok' ? {} : (E.lookup[c.src + '|' + c.id] || {}); }
    function fmtTh(c) {
      var m = metaOf(c);
      var f = c.field === 'pct' ? function (v) { return fixed(v * 100, 0) + '%'; } : function (v) { return fmtByUnit(v, m.unit || 'num', m.labels); };
      return c.op === 'between' ? f(c.th[0]) + '–' + f(c.th[1]) : f(c.th);
    }
    function describe(c, states) {
      if (c.text) { return c.text; }
      if (c.src === 'ok') { var p = c.id.split(':'); return '近 ' + p[1] + ' 日内“' + ((states && states[p[0]]) || p[0]) + '”的条件曾全部满足'; }
      var m = metaOf(c);
      return (m.name || c.id) + (c.field === 'pct' ? '的历史分位' : '') + OP_CN[c.op] + ' ' + fmtTh(c);
    }
    function fmtCondValue(c, v) {
      if (v === null || v === undefined || !isNum(v)) { return '—'; }
      if (c.field === 'pct') { return fixed(v * 100, 0) + '%分位'; }
      var m = metaOf(c);
      return fmtByUnit(v, m.unit || 'num', m.labels);
    }
    function frame(conds, extra) {
      var F = {};
      conds.forEach(function (c) { if (c.src !== 'ok') { F[colOf(c)] = series(c.src, c.id, c.field); } });
      (extra || []).forEach(function (k) { if (E.core.feat[k] && !F[k]) { F[k] = series('feat', k, 'value'); } });
      return F;
    }
    function cmp(x, op, th) {
      if (!isNum(x)) { return false; }
      if (op === 'between') { return x >= th[0] && x <= th[1]; }
      if (op === '>') { return x > th; } if (op === '>=') { return x >= th; } if (op === '<') { return x < th; } if (op === '<=') { return x <= th; }
      return x === th;
    }
    function condVec(F, c, oks) {
      var n = E.n, out = new Uint8Array(n), t;
      if (c.src === 'ok') {
        var p = c.id.split(':'), base = oks[p[0]], w = +p[1];
        if (!base) { return out; }
        for (t = 0; t < n; t++) {
          var mx = 0;
          for (var k = Math.max(0, t - w + 1); k <= t; k++) { if (base[k]) { mx = 1; break; } }
          out[t] = cmp(mx, c.op, c.th) ? 1 : 0;
        }
        return out;
      }
      var x = F[colOf(c)];
      for (t = 0; t < n; t++) { out[t] = cmp(x[t], c.op, c.th) ? 1 : 0; }
      return out;
    }
    function evaluateRules(F, spec) {
      var res = {}, oks = {}, n = E.n;
      Object.keys(spec).forEach(function (st) {
        var g = spec[st];
        var R = g.required.map(function (c) { return condVec(F, c, oks); });
        var O = g.optional.items.map(function (c) { return condVec(F, c, oks); });
        var counted = g.optional.items.map(function (c) { return !c.info; });
        var has = R.length > 0 || counted.some(Boolean);
        var ok = new Uint8Array(n);
        if (has) {
          for (var t = 0; t < n; t++) {
            var all = true, j;
            for (j = 0; j < R.length; j++) { if (!R[j][t]) { all = false; break; } }
            if (!all) { continue; }
            var cnt = 0;
            for (j = 0; j < O.length; j++) { if (counted[j] && O[j][t]) { cnt++; } }
            ok[t] = cnt >= g.optional.min ? 1 : 0;
          }
        }
        res[st] = { R: R, O: O, ok: ok, counted: counted, has: has };
        oks[st] = ok;
      });
      return res;
    }
    function classify(F, rc, rules) {
      var n = E.n, keys = meta.valid_keys.filter(function (k) { return F[k]; });
      var cur = null, pending = null, pendN = 0, lastBear = -1e9, states = new Array(n);
      for (var t = 0; t < n; t++) {
        var valid = keys.every(function (k) { return isNum(F[k][t]); });
        if (!valid) { states[t] = null; continue; }
        var cand = rc.default;
        for (var i = 0; i < rc.priority.length; i++) {
          var st = rc.priority[i];
          if (st === rc.default) { break; }
          if (!rules[st].ok[t]) { continue; }
          if (st === 'bottom_repair' && rc.bottom_repair_lookback && t - lastBear > rc.bottom_repair_lookback) { continue; }
          cand = st; break;
        }
        if (cur === null) { cur = cand; } else if (cand === cur) { pending = null; pendN = 0; } else {
          pendN = cand === pending ? pendN + 1 : 1;
          pending = cand;
          if (pendN >= (rc.confirm_days[cand] || 1)) { cur = cand; pending = null; pendN = 0; }
        }
        if (cur === 'bear' || cur === 'panic') { lastBear = t; }
        states[t] = cur;
      }
      return states;
    }

    // ---------------- 后续收益
    function closeIdx(key) { var c = E.closes[key], pos = []; for (var i = 0; i < E.n; i++) { if (isNum(c[i])) { pos.push(i); } } return pos; }
    function targetPaths(key) {       // signal_eval.target_paths：T+1 收盘买入
      if (E.paths[key]) { return E.paths[key]; }
      var c = E.closes[key], pos = closeIdx(key), m = pos.length, out = {};
      meta.horizons.forEach(function (h) {
        var fwd = new Float64Array(E.n).fill(NaN), mae = new Float64Array(E.n).fill(NaN);
        for (var k = 0; k + 1 + h < m; k++) {
          var entry = c[pos[k + 1]];
          fwd[pos[k]] = c[pos[k + 1 + h]] / entry - 1;
          var low = Infinity;
          for (var q = k + 2; q <= k + 1 + h; q++) { if (c[pos[q]] < low) { low = c[pos[q]]; } }
          mae[pos[k]] = Math.min(low / entry - 1, 0);
        }
        out[h] = { fwd: fwd, mae: mae };
      });
      E.paths[key] = out;
      return out;
    }
    function riskPaths(key, h) {      // regime_v1.forward_risk：收益、年化波动、最大回撤
      var k0 = key + '|' + h;
      if (E.risk[k0]) { return E.risk[k0]; }
      var c = E.closes[key], pos = closeIdx(key), m = pos.length;
      var ret = new Float64Array(E.n).fill(NaN), vol = new Float64Array(E.n).fill(NaN), mdd = new Float64Array(E.n).fill(NaN);
      for (var t = 0; t < m - 1 - h; t++) {
        var e = t + 1, p0 = c[pos[e]], peak = -Infinity, dd = 0, lr = [];
        for (var q = e; q <= e + h; q++) {
          var v = c[pos[q]];
          if (v > peak) { peak = v; }
          dd = Math.min(dd, v / peak - 1);
          if (q >= e + 1) { lr.push(Math.log(v) - Math.log(c[pos[q - 1]])); }
        }
        ret[pos[t]] = c[pos[e + h]] / p0 - 1;
        if (h > 1) { var mu = mean(lr), s2 = 0; lr.forEach(function (x) { s2 += (x - mu) * (x - mu); }); vol[pos[t]] = Math.sqrt(s2 / (lr.length - 1)) * Math.sqrt(252); }
        mdd[pos[t]] = dd;
      }
      E.risk[k0] = { ret: ret, vol: vol, mdd: mdd };
      return E.risk[k0];
    }

    // ---------------- 统计
    function hitStats(W, mask, base, path, h, gap) {
      var J = W.filter(function (i) { return base[i] && isNum(path.fwd[i]); });
      var fwdJ = J.map(function (i) { return path.fwd[i]; });
      var bw = winRate(fwdJ);
      var out = { h: h, base_n: J.length, base_win: J.length ? r(bw) : null, base_median: J.length ? r(median(fwdJ)) : null };
      var m = J.map(function (i) { return !!mask[i]; });
      var n = m.filter(Boolean).length, ep = episodeCount(m, gap);
      out.n = n; out.ep = ep;
      if (!n) { return out; }
      var sub = [], subMae = [];
      J.forEach(function (i, k) { if (m[k]) { sub.push(path.fwd[i]); subMae.push(path.mae[i]); } });
      var win = winRate(sub), nEff = Math.max(ep, n / h), ci = wilson(win * nEff, nEff);
      var ef = episodeStarts(m, gap).map(function (k) { return path.fwd[J[k]]; });
      var eci = wilson(ef.filter(function (x) { return x > 0; }).length, ef.length);
      out.win = r(win); out.lo = r(ci[0]); out.hi = r(ci[1]); out.dwin = r(win - bw);
      out.median = r(median(sub)); out.mean = r(mean(sub)); out.p10 = r(quantile(sub, 0.10)); out.p90 = r(quantile(sub, 0.90));
      out.mae = r(median(subMae)); out.mae_p10 = r(quantile(subMae, 0.10));
      out.ep_win = r(winRate(ef)); out.ep_lo = r(eci[0]); out.ep_hi = r(eci[1]); out.ep_median = r(median(ef));
      [['is', function (d) { return d < meta.oos_start; }], ['oos', function (d) { return d >= meta.oos_start; }]].forEach(function (pp) {
        var mm = [], jj = [];
        J.forEach(function (i, k) { if (pp[1](E.dates[i])) { mm.push(m[k]); jj.push(path.fwd[i]); } });
        var k2 = mm.filter(Boolean).length, hits = [];
        jj.forEach(function (x, q) { if (mm[q]) { hits.push(x); } });
        out[pp[0]] = { n: k2, ep: episodeCount(mm, gap), win: k2 ? r(winRate(hits)) : null, base_win: jj.length ? r(winRate(jj)) : null };
      });
      return out;
    }
    function warningsFor(st, first) {
      var w = [];
      if (!st.n) { return ['这段时间里条件一次都没有触发。']; }
      if (st.ep < meta.few_ep) { w.push('只有 ' + st.ep + ' 次独立事件，样本少，结论很不稳定。'); }
      if (st.lo !== null && st.hi - st.lo > meta.wide_ci) { w.push('上涨概率的 95% 区间是 ' + fixed(st.lo * 100, 0) + '%–' + fixed(st.hi * 100, 0) + '%，不确定性很大。'); }
      var i = st.is || {}, o = st.oos || {};
      if (i.win !== null && i.win !== undefined && o.win !== null && o.win !== undefined && i.base_win !== null && o.base_win !== null) {
        var di = i.win - i.base_win, dd = o.win - o.base_win;
        if (di * dd < 0 && Math.max(Math.abs(di), Math.abs(dd)) >= 0.03) {
          w.push('样本内（≤2021）比平时' + (di > 0 ? '高' : '低') + ' ' + fixed(Math.abs(di) * 100, 0) + '%，样本外（≥2022）却' + (dd > 0 ? '高' : '低') + ' ' + fixed(Math.abs(dd) * 100, 0) + '%，方向相反。');
        }
        if ((o.ep || 0) < 3) { w.push('样本外（2022 年以后）几乎没有触发，无法检验。'); }
      }
      if (first && first > '2018-12-31') { w.push('条件用到的数据从 ' + first + ' 才有，样本期较短。'); }
      return w;
    }
    function valAt(x, t) {            // 截至 t 最近一个有值的读数（90 天内）
      var lim = new Date(E.dates[t] + 'T00:00:00Z'); lim.setUTCDate(lim.getUTCDate() - 90);
      var limS = lim.toISOString().slice(0, 10);
      for (var k = t; k >= 0; k--) { if (isNum(x[k])) { return E.dates[k] >= limS ? [r(x[k], 6), E.dates[k]] : [null, null]; } }
      return [null, null];
    }
    function windowIdx(st) { var W = []; for (var i = 0; i < E.n; i++) { if (E.dates[i] >= st.start && E.dates[i] <= st.end) { W.push(i); } } return W; }
    function engGroup(g) { return { required: g.required, optional: g.optional }; }
    function targetName(k) { var t = meta.targets.filter(function (x) { return x.key === k; })[0]; return t ? t.name : k; }

    E.runConditions = function (scheme, settings) {
      var g = checkGroup(scheme), st = checkSettings(settings);
      var conds = g.required.concat(g.optional.items);
      if (E.needsIx(conds) && !E.ix) { throw SchemeError('四个指数的数据还没加载完，请稍后再试'); }
      var F = frame(conds), n = E.n, t, i;
      var res = evaluateRules(F, { sig: engGroup(g) }).sig;
      var used = conds.filter(function (c) { return !c.info; }).map(colOf);
      var evaluable = new Uint8Array(n), ok = new Uint8Array(n);
      for (t = 0; t < n; t++) {
        var e = 1;
        for (i = 0; i < used.length; i++) { if (!isNum(F[used[i]][t])) { e = 0; break; } }
        evaluable[t] = e; ok[t] = res.ok[t] && e ? 1 : 0;
      }
      if (g.persist > 1) {
        var ok2 = new Uint8Array(n), run = 0;
        for (t = 0; t < n; t++) { run = ok[t] ? run + 1 : 0; ok2[t] = run >= g.persist && evaluable[t] ? 1 : 0; }
        ok = ok2;
      }
      var W = windowIdx(st);
      var first = null;
      for (i = 0; i < W.length; i++) { if (evaluable[W[i]]) { first = E.dates[W[i]]; break; } }
      var stats = {};
      st.targets.forEach(function (tk) {
        var P = targetPaths(tk); stats[tk] = {};
        st.horizons.forEach(function (h) { stats[tk][String(h)] = hitStats(W, ok, evaluable, P[h], h, g.gap); });
      });
      var tk0 = st.targets[0], h0 = st.horizons.indexOf(20) >= 0 ? 20 : st.horizons[0], main = stats[tk0][String(h0)];
      var mb = W.map(function (i2) { return ok[i2] && evaluable[i2] ? 1 : 0; });
      var starts = [], runLen = [], last = -1;
      mb.forEach(function (v, k) { if (v) { if (last < 0 || k - last > g.gap) { starts.push(k); runLen.push(0); } runLen[runLen.length - 1]++; last = k; } });
      var P0 = targetPaths(tk0), events = [];
      starts.forEach(function (s, q) {
        var d = W[s], row = { date: E.dates[d], days: runLen[q] };
        st.horizons.forEach(function (h) { row['r' + h] = r(P0[h].fwd[d]); row['mae' + h] = r(P0[h].mae[d]); });
        events.push(row);
      });
      var yearly = [], byYear = {};
      W.forEach(function (i2, k) { var y = E.dates[i2].slice(0, 4); (byYear[y] = byYear[y] || []).push(k); });
      Object.keys(byYear).sort().forEach(function (y) {
        var ks = byYear[y], m = ks.map(function (k) { return mb[k]; });
        var stt = episodeStarts(m, g.gap), ef = stt.map(function (q) { return P0[h0].fwd[W[ks[q]]]; }).filter(isNum);
        var yb = ks.filter(function (k) { return evaluable[W[k]]; }).map(function (k) { return P0[h0].fwd[W[k]]; }).filter(isNum);
        yearly.push({ year: +y, days: m.filter(Boolean).length, ep: stt.length, ep_win: ef.length ? r(winRate(ef)) : null, base_win: yb.length ? r(winRate(yb)) : null });
      });
      var lastHit = null, streak = 0;
      for (t = n - 1; t >= 0; t--) { if (ok[t]) { lastHit = E.dates[t]; break; } }
      for (t = n - 1; t >= 0 && ok[t]; t--) { streak++; }
      var tl = n - 1, check = [];
      g.required.forEach(function (c, j) { var v = valAt(series(c.src, c.id, c.field), tl); check.push({ text: describe(c), kind: '必要', ok: !!res.R[j][tl], value: fmtCondValue(c, v[0]), date: v[1] }); });
      g.optional.items.forEach(function (c, j) { var v = valAt(series(c.src, c.id, c.field), tl); check.push({ text: describe(c), kind: c.info ? '只展示' : '可选', ok: !!res.O[j][tl], value: fmtCondValue(c, v[0]), date: v[1] }); });
      var targets = {}; st.targets.forEach(function (k) { targets[k] = targetName(k); });
      var c0 = E.closes[tk0];
      return {
        kind: 'conditions', scheme: g, settings: st, asof: meta.asof, targets: targets, primary: { target: tk0, h: h0 },
        summary: { days: W.filter(function (i2) { return ok[i2]; }).length, base_days: W.filter(function (i2) { return evaluable[i2]; }).length,
          episodes: main.ep || 0, first_date: first, today: !!ok[n - 1], streak: streak, last: lastHit,
          min: g.optional.min, n_opt: g.optional.items.filter(function (c) { return !c.info; }).length },
        stats: stats, warnings: warningsFor(main, first), caveat: meta.caveat, checklist: check, events: events.slice(-300), yearly: yearly,
        chart: { dates: W.map(function (i2) { return E.dates[i2]; }), close: W.map(function (i2) { return r(c0[i2], 2); }),
          hit: W.map(function (i2) { return ok[i2] ? 1 : 0; }), starts: starts }
      };
    };

    function runsOf(W, states) {      // regime_v1.episodes_of：先去掉空值再按连续相同分段
      var out = [];
      W.forEach(function (i) {
        var s = states[i]; if (s === null) { return; }
        var lastR = out[out.length - 1];
        if (lastR && lastR.state === s) { lastR.end = i; lastR.days++; } else { out.push({ state: s, start: i, end: i, days: 1 }); }
      });
      return out;
    }
    function stateStats(W, states, P, order, eps) {
      var rows = [];
      var J = W.filter(function (i) { return states[i] !== null && isNum(P.ret[i]); });
      var baseWin = winRate(J.map(function (i) { return P.ret[i]; }));
      order.concat(['全部']).forEach(function (st) {
        var sub = st === '全部' ? J : J.filter(function (i) { return states[i] === st; });
        if (!sub.length) { return; }
        var ret = sub.map(function (i) { return P.ret[i]; }), vol = sub.map(function (i) { return P.vol[i]; }), mdd = sub.map(function (i) { return P.mdd[i]; });
        var first = st === '全部' ? [] : eps.filter(function (e) { return e.state === st; }).map(function (e) { return e.start; });
        var epRet = first.map(function (i) { return P.ret[i]; }).filter(isNum);
        rows.push({ state: st, h: P.h, days: sub.length, episodes: st === '全部' ? eps.length : eps.filter(function (e) { return e.state === st; }).length,
          win: r(winRate(ret)), median: r(median(ret)), mean: r(mean(ret)), p10: r(quantile(ret, 0.10)), p90: r(quantile(ret, 0.90)),
          vol: r(median(vol)), mdd_med: r(median(mdd)), mdd_p10: r(quantile(mdd, 0.10)),
          ep_win: epRet.length ? r(winRate(epRet)) : null, ep_median: epRet.length ? r(median(epRet)) : null, base_win: r(baseWin) });
      });
      return rows;
    }

    E.runRegime = function (scheme, settings) {
      var rc = checkRegime(scheme), st = checkSettings(settings);
      var names = {}; Object.keys(rc.states).forEach(function (k) { names[k] = rc.states[k].name; });
      if (!names[NONE]) { names[NONE] = NONE_NAME; }
      var conds = []; Object.keys(rc.states).forEach(function (k) { conds = conds.concat(rc.states[k].required, rc.states[k].optional.items); });
      if (E.needsIx(conds) && !E.ix) { throw SchemeError('四个指数的数据还没加载完，请稍后再试'); }
      var F = frame(conds, meta.valid_keys);
      var spec = {}; Object.keys(rc.states).forEach(function (k) { spec[k] = engGroup(rc.states[k]); });
      var rules = evaluateRules(F, spec);
      var full = classify(F, rc, rules);
      var order = Object.keys(rc.states).concat(rc.default === NONE ? [NONE] : []);
      var W = windowIdx(st);
      var valid = W.filter(function (i) { return full[i] !== null; });
      var cov = {}; valid.forEach(function (i) { cov[full[i]] = (cov[full[i]] || 0) + 1; });
      var coverage = order.map(function (k) { return { state: k, name: names[k], days: cov[k] || 0, share: valid.length ? r((cov[k] || 0) / valid.length) : null }; });
      var eps = runsOf(W, full);
      var stats = {};
      st.targets.forEach(function (tk) {
        stats[tk] = [];
        st.horizons.forEach(function (h) {
          var P = riskPaths(tk, h); P.h = h;
          stateStats(W, full, P, order, eps).forEach(function (row) { row.name = names[row.state] || '全部日子'; stats[tk].push(row); });
        });
      });
      // pandas 的排列：先按 h 再按状态（与 engine.py 一致）
      var tm = order.map(function () { return order.map(function () { return 0; }); });
      for (var q = 0; q + 1 < eps.length; q++) {
        var a = order.indexOf(eps[q].state), b = order.indexOf(eps[q + 1].state);
        if (a >= 0 && b >= 0) { tm[a][b]++; }
      }
      var durations = order.map(function (k) {
        var ds = eps.filter(function (e) { return e.state === k; }).map(function (e) { return e.days; });
        return { state: k, name: names[k], count: ds.length ? ds.length : null, mean: ds.length ? r(mean(ds), 1) : null, max: ds.length ? Math.max.apply(null, ds) : null };
      });
      var off = meta.official, offState = E.core.official_state;
      var both = W.filter(function (i) { return full[i] !== null && offState[i] !== null && offState[i] !== undefined; });
      var allKnown = Object.keys(rc.states).every(function (k) { return Object.prototype.hasOwnProperty.call(off.names, k); });
      var same = both.length && allKnown ? r(both.filter(function (i) { return full[i] === off.codes[offState[i]]; }).length / both.length) : null;
      var pairs = {};
      both.forEach(function (i) { var key = full[i] + '\u0000' + off.codes[offState[i]]; pairs[key] = (pairs[key] || 0) + 1; });
      var table = Object.keys(pairs).map(function (k) { var p = k.split('\u0000'); return { mine: names[p[0]] || p[0], official: off.names[p[1]] || p[1], days: pairs[k] }; })
        .sort(function (x, y) { return y.days - x.days; }).slice(0, 20);
      var sanity = off.sanity.map(function (s) {
        var got = null, lastI = -1;
        for (var k = 0; k < E.n && E.dates[k] <= s.date; k++) { if (full[k] !== null) { lastI = k; } }
        var lim = new Date(s.date + 'T00:00:00Z'); lim.setUTCDate(lim.getUTCDate() - 5);
        if (lastI >= 0 && E.dates[lastI] >= lim.toISOString().slice(0, 10)) { got = full[lastI]; }
        return { date: s.date, event: s.event, expect: s.expect, got: got ? (names[got] || '—') : '数据不足' };
      });
      var tLast = -1; for (var k2 = E.n - 1; k2 >= 0; k2--) { if (full[k2] !== null) { tLast = k2; break; } }
      var cur = full[tLast];
      var since = eps.length && eps[eps.length - 1].state === cur ? E.dates[eps[eps.length - 1].start] : E.dates[tLast];
      var checklist = [];
      Object.keys(rc.states).forEach(function (k) {
        var rr = rules[k]; if (!rr.has) { return; }
        var g = rc.states[k], items = [];
        g.required.forEach(function (c, j) { items.push({ text: describe(c, names), kind: '必要', ok: !!rr.R[j][tLast], value: c.src === 'ok' ? '—' : fmtCondValue(c, F[colOf(c)][tLast]) }); });
        g.optional.items.forEach(function (c, j) { items.push({ text: describe(c, names), kind: c.info ? '只展示' : '可选', ok: !!rr.O[j][tLast], value: c.src === 'ok' ? '—' : fmtCondValue(c, F[colOf(c)][tLast]) }); });
        checklist.push({ state: k, name: names[k], ok: !!rr.ok[tLast], n_req: rr.R.filter(function (v) { return v[tLast]; }).length, n_req_all: g.required.length, min: g.optional.min, items: items });
      });
      var codeOf = {}; order.forEach(function (k, i) { codeOf[k] = i; });
      var targets = {}; st.targets.forEach(function (k) { targets[k] = targetName(k); });
      var c0 = E.closes[st.targets[0]];
      return {
        kind: 'regime', scheme: rc, names: names, order: order, asof: meta.asof, settings: st, targets: targets,
        current: { state: cur, name: names[cur] || cur, since: since, date: E.dates[tLast] },
        coverage: coverage, valid_days: valid.length, stats: stats, durations: durations,
        transitions: { order: order, matrix: tm }, agree: { days: both.length, same: same, table: table }, sanity: sanity,
        checklist: checklist, caveat: meta.caveat,
        timeline: { dates: W.map(function (i) { return E.dates[i]; }), state: W.map(function (i) { return full[i] === null ? null : codeOf[full[i]]; }),
          close: W.map(function (i) { return r(c0[i], 2); }) }
      };
    };

    // ---------------- 导入导出：网页版导出的“YAML”是 JSON 写法（JSON 本身就是合法的 YAML，工作站版和 PyYAML 都能读）
    E.toYaml = function (kind, scheme) {
      var doc;
      if (kind === 'regime') {
        var rc = checkRegime(scheme), states = {};
        Object.keys(rc.states).forEach(function (k) {
          var g = rc.states[k], o = { name: g.name };
          if (g.framework) { o.framework = g.framework; }
          o.required = g.required; o.optional = g.optional; states[k] = o;
        });
        doc = { kind: 'regime', name: rc.name, priority: rc.priority, default: rc.default, confirm_days: rc.confirm_days, bottom_repair_lookback: rc.bottom_repair_lookback, states: states };
      } else if (kind === 'conditions') {
        var g2 = checkGroup(scheme);
        doc = { kind: 'conditions', name: g2.name, required: g2.required, optional: g2.optional, persist: g2.persist, gap: g2.gap };
      } else { throw SchemeError('kind 只能是 conditions 或 regime'); }
      return '# 回测实验室导出的方案（数据截至 ' + meta.asof + '；网页版导出，JSON 写法，也是合法的 YAML）\n' +
        '# 条件字段：src 数据来源、id 指标、field 原始值(value)或分位(pct)、op 比较方式、th 阈值（原始值按存储口径，分位为 0–1）\n' +
        '# 正式采纳时，把这份文件交给维护者，按 config/regime.yaml 的格式写进判定标准。\n' + JSON.stringify(doc, null, 2) + '\n';
    };
    E.fromText = function (txt) {
      if (typeof txt !== 'string' || txt.length > 200000) { throw SchemeError('文件太大或格式不对'); }
      var body = txt.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
      var doc;
      try { doc = JSON.parse(body); } catch (e) { throw SchemeError('网页版只能导入网页版导出的方案文件（JSON 写法）；工作站版导出的 YAML 请在工作站版里导入'); }
      if (!doc || (doc.kind !== 'conditions' && doc.kind !== 'regime')) { throw SchemeError('不是回测实验室导出的方案（缺少 kind: conditions / regime）'); }
      var kind = doc.kind; delete doc.kind;
      if (kind === 'regime') { checkRegime(doc); } else { checkGroup(doc); }
      return { kind: kind, scheme: doc };
    };
    E.check = { cond: checkCond, group: checkGroup, regime: checkRegime, settings: checkSettings };
    return E;
  }

  var api = { create: create, decode: decode, wilson: wilson, quantile: quantile, fmtValue: fmtValue, fmtCond: fmtCond };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.LabEngine = api; }
})(typeof window !== 'undefined' ? window : this);
