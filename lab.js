/* 回测实验室页面脚本。只用 ES2017 以内的写法（不用 ?. ?? 对象展开 async/await），所有文字都用 textContent 写入。 */
(function () {
  'use strict';

  // ------------------------------------------------------------ 状态
  var STORE_KEY = 'timingLab.schemes.v1';
  var TRIAL_KEY = 'timingLab.trials';
  var TOKEN_KEY = 'timingLab.token';
  var S = {
    meta: null, catalog: [], lookup: {}, groups: [], presets: [], token: '',
    tab: 'cond', cond: null, regime: null,
    settings: { targets: ['WA'], horizons: [5, 20, 60], start: '', end: '' },
    charts: {}, regimeView: { target: 'WA', h: 20 }
  };
  var OPS = [['<', '低于'], ['<=', '不高于'], ['>', '高于'], ['>=', '不低于'], ['==', '等于'], ['between', '介于']];
  var OP_CN = {}; OPS.forEach(function (o) { OP_CN[o[0]] = o[1]; });
  // 输入框里显示的数 = 存储值 × k
  var UNITS = {
    pct: { k: 100, s: '%' }, pctpt: { k: 1, s: '%' }, pp: { k: 1, s: '个百分点' }, bp: { k: 100, s: 'bp' },
    yi: { k: 1e-8, s: '亿元' }, yi_native: { k: 1, s: '亿元' }, yi_share: { k: 1, s: '亿份' }, x: { k: 1, s: '倍' },
    ratio: { k: 1, s: '' }, pt: { k: 1, s: '点' }, sigma: { k: 1, s: 'σ' }, count: { k: 1, s: '家' }, days: { k: 1, s: '交易日' },
    k_person: { k: 0.1, s: '万人' }, label: { k: 1, s: '' }, score: { k: 1, s: '分' }, num: { k: 1, s: '' },
    f_pct: { k: 100, s: '%分位' }, f_ratio: { k: 100, s: '%' }, f_chg: { k: 100, s: '%' }, f_pp: { k: 100, s: '个百分点' },
    f_flag: { k: 1, s: '（1=是，0=否）' }, f_level: { k: 1, s: '级' }, f_times: { k: 1, s: '次' }, f_yi: { k: 1, s: '亿元' }, f_num: { k: 1, s: '' }
  };
  var KNOWN_ST = ['bull', 'overheat', 'range', 'bottom_repair', 'bear', 'panic', 'none'];
  var PALETTE = ['#2f5fd0', '#8e44ad', '#16a085', '#b9770e', '#5d6d7e', '#c0392b', '#1e8449', '#a04000', '#2874a6', '#7d3c98'];

  // ------------------------------------------------------------ 小工具
  function $(id) { return document.getElementById(id); }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null) { return; }
      if (k === 'text') { e.textContent = v; } else if (k === 'class') { e.className = v; } else if (k === 'on') {
        Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      } else if (k === 'style') { e.style.cssText = v; } else if (k in e && k !== 'list') { e[k] = v; } else { e.setAttribute(k, v); }
    });
    (Array.isArray(kids) ? kids : (kids === undefined || kids === null ? [] : [kids])).forEach(function (c) {
      if (c === null || c === undefined || c === false) { return; }
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function clear(e) { while (e.firstChild) { e.removeChild(e.firstChild); } return e; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pct(x, d) { return x === null || x === undefined ? '—' : (x * 100).toFixed(d === undefined ? 0 : d) + '%'; }
  function ret(x) { return x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
  function num(x) {
    if (x === null || x === undefined || isNaN(x)) { return '—'; }
    var a = Math.abs(x);
    return a >= 1e4 ? x.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : (a >= 100 ? x.toFixed(1) : (a >= 1 ? x.toFixed(2) : x.toPrecision(3)));
  }
  function banner(msg, kind) {
    var b = $('banner');
    b.textContent = msg || '';
    b.className = msg ? 'banner ' + (kind || 'err') : 'banner';
    if (msg && kind === 'ok') { setTimeout(function () { if (b.textContent === msg) { banner(''); } }, 4000); }
  }
  function hash(s) { var x = 5381; for (var i = 0; i < s.length; i++) { x = ((x << 5) + x + s.charCodeAt(i)) | 0; } return String(x >>> 0); }
  function b64e(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) { s += '='; } return decodeURIComponent(escape(atob(s))); }
  function download(name, text, type) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function readFile(accept, cb) {
    var inp = h('input', { type: 'file', accept: accept, style: 'display:none' });
    inp.addEventListener('change', function () {
      var f = inp.files[0]; if (!f) { return; }
      if (f.size > 200000) { banner('文件太大'); return; }
      var r = new FileReader(); r.onload = function () { cb(String(r.result)); }; r.readAsText(f, 'utf-8');
    });
    document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 60000);
  }
  // 网页版（GitHub Pages）没有后台：lab_static.js 设 window.LAB_STATIC，数据从同目录的 JSON 读，计算用 lab_engine.js
  var STATIC = !!window.LAB_STATIC;
  var ENG = null, LM = null, CORE_P = null, IX_P = null;
  function loadJSON(u) {
    return fetch(u).then(function (r) { if (!r.ok) { throw new Error('数据文件加载失败（' + r.status + '）：' + u); } return r.json(); });
  }
  function ensureCore() {
    if (!CORE_P) {
      CORE_P = loadJSON('lab_core.json').then(function (c) { ENG.setCore(c); }, function (e) { CORE_P = null; throw e; });
    }
    return CORE_P;
  }
  function ensureIx() {
    if (!IX_P) {
      banner('正在加载四个指数的数据（约 2MB），首次使用需要几秒…', 'ok');
      IX_P = loadJSON('lab_ix.json').then(function (x) { ENG.setIx(x); banner(''); }, function (e) { IX_P = null; throw e; });
    }
    return IX_P;
  }
  function condsIn(kind, sc) {
    var out = [];
    var add = function (g) { out = out.concat(g.required || [], (g.optional && g.optional.items) || []); };
    if (kind === 'regime') { Object.keys((sc && sc.states) || {}).forEach(function (k) { add(sc.states[k] || {}); }); } else if (sc) { add(sc); }
    return out;
  }
  function staticApi(path, body) {
    var compute = function (kind, fn) {
      return ensureCore().then(function () {
        if (condsIn(kind, body.scheme).some(function (c) { return /^ix/.test(String(c.src)); })) { return ensureIx(); }
      }).then(function () {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try { resolve(fn()); } catch (e) { reject(new Error(e.scheme ? e.message : '计算出错：' + e.message)); }
          }, 0);
        });
      });
    };
    if (path === '/api/meta') { return Promise.resolve(LM.meta); }
    if (path === '/api/catalog') { return Promise.resolve(LM.catalog); }
    if (path === '/api/presets') { return Promise.resolve(LM.presets); }
    if (path === '/api/backtest/conditions') { return compute('conditions', function () { return ENG.runConditions(body.scheme, body.settings); }); }
    if (path === '/api/backtest/regime') { return compute('regime', function () { return ENG.runRegime(body.scheme, body.settings); }); }
    if (path === '/api/export/yaml') { return ensureCore().then(function () { return { yaml: ENG.toYaml(body.kind, body.scheme) }; }); }
    if (path === '/api/import/yaml') { return ensureCore().then(function () { return ENG.fromText(body.text); }); }
    return Promise.reject(new Error('网页版不支持：' + path));
  }
  function api(path, body) {
    if (STATIC) { return staticApi(path, body); }
    var opt = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
    if (S.token) { opt.headers['X-Lab-Token'] = S.token; }
    if (body) { opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && j.need_token) { askToken(); }
        if (!r.ok) { throw new Error(j.error || ('请求失败（' + r.status + '）')); }
        return j;
      });
    });
  }
  function askToken() {
    var t = window.prompt('这个回测实验室设了访问口令，请输入（向维护者索取）：', '');
    if (t) { S.token = t; try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* 忽略 */ } location.reload(); }
  }
  function stColor(key, i) { return KNOWN_ST.indexOf(key) >= 0 ? 'var(--st-' + key + ')' : PALETTE[i % PALETTE.length]; }
  function stColorHex(key, i) {
    if (KNOWN_ST.indexOf(key) >= 0) { return getComputedStyle(document.documentElement).getPropertyValue('--st-' + key).trim() || '#999'; }
    return PALETTE[i % PALETTE.length];
  }

  // ------------------------------------------------------------ 指标与单位
  function metaOf(c) { return S.lookup[c.src + '|' + c.id] || null; }
  function unitOf(c) {
    if (c.field === 'pct') { return { k: 100, s: '%分位' }; }
    var m = metaOf(c);
    return UNITS[(m && m.unit) || 'num'] || UNITS.num;
  }
  function showVal(m, v, field) {
    if (v === null || v === undefined) { return '—'; }
    if (field === 'pct') { return pct(v) + '分位'; }
    var u = UNITS[m.unit] || UNITS.num;
    if (m.unit === 'label' && m.labels) { var key = String(Math.round(v)); return m.labels[key] || key; }
    if (m.unit === 'f_flag') { return v >= 0.5 ? '是' : '否'; }
    return num(v * u.k) + u.s;
  }
  function condName(c, states) {
    if (c.src === 'ok') {
      var p = c.id.split(':');
      return '近 ' + p[1] + ' 日“' + ((states && states[p[0]]) || p[0]) + '”的条件曾全部满足';
    }
    var m = metaOf(c);
    return m ? m.name : (c.src + '/' + c.id + '（数据里已没有这一项）');
  }
  function newCondFrom(m) {
    var field = m.has_pct ? 'pct' : 'value';
    var th = field === 'pct' ? 0.1 : (m.value === null || m.value === undefined ? 0 : Number(m.value.toPrecision(3)));
    if (m.unit === 'f_flag') { return { src: m.src, id: m.id, field: 'value', op: '==', th: 1, text: '', info: false }; }
    return { src: m.src, id: m.id, field: field, op: '<', th: th, text: '', info: false };
  }

  // ------------------------------------------------------------ 选指标
  var pickerCb = null;
  function openPicker(cb) {
    pickerCb = cb;
    $('picker').hidden = false;
    $('picker-q').value = '';
    renderPicker();
    $('picker-q').focus();
  }
  function closePicker() { $('picker').hidden = true; pickerCb = null; }
  function renderPicker() {
    var q = $('picker-q').value.trim().toLowerCase();
    var g = $('picker-group').value;
    var list = clear($('picker-list'));
    var n = 0;
    S.catalog.forEach(function (m) {
      if (g && m.group !== g) { return; }
      var hay = (m.name + ' ' + m.id + ' ' + (m.l3 || '') + ' ' + m.dim_cn + ' ' + m.group).toLowerCase();
      if (q && hay.indexOf(q) < 0) { return; }
      if (n++ > 400) { return; }
      var cur = '当前 ' + showVal(m, m.value, 'value') + (m.pct !== null && m.pct !== undefined ? '，' + pct(m.pct) + '分位' : '') +
        (m.value_date && m.value_date !== S.meta.asof ? '（' + m.value_date + '）' : '');
      list.appendChild(h('div', { class: 'pick', title: m.l3 || '', on: { click: function () { var cb = pickerCb; closePicker(); if (cb) { cb(m); } } } }, [
        h('span', { class: 'grow' }, [h('strong', { text: m.name }), h('div', { class: 'small muted', text: cur + ' · 自 ' + m.start })]),
        h('span', { class: 'g', text: m.group + ' · ' + m.dim_cn })
      ]));
    });
    if (!n) { list.appendChild(h('div', { class: 'muted', style: 'padding:8px', text: '没有找到匹配的指标。' })); }
  }

  // ------------------------------------------------------------ 条件编辑
  function condRow(c, onChange, onDelete, states) {
    var m = metaOf(c);
    var u = unitOf(c);
    var wrap = h('div', { class: 'cond' });
    var head = h('div', { class: 'row' }, [
      h('span', { class: 'name grow', text: condName(c, states), title: c.src === 'ok' ? '' : '点击更换指标',
        on: { click: function () { if (c.src === 'ok') { return; } openPicker(function (nm) { var nc = newCondFrom(nm); Object.keys(nc).forEach(function (k) { c[k] = nc[k]; }); onChange(true); }); } } }),
      c.info ? h('span', { class: 'pill', style: 'background:var(--muted)', text: '只展示' }) : null,
      h('button', { type: 'button', class: 'btn small danger', text: '删除', on: { click: onDelete } })
    ]);
    wrap.appendChild(head);
    if (c.src === 'ok') { return wrap; }
    var desc = c.text ? h('div', { class: 'small muted', text: '口径：' + c.text }) : null;
    if (desc) { wrap.appendChild(desc); }
    var ctl = h('div', { class: 'row' });
    if (m && m.has_pct) {
      var fs = h('select', { on: { change: function () { c.text = ''; c.field = fs.value; c.th = c.field === 'pct' ? (c.op === 'between' ? [0.05, 0.2] : 0.1) : (m.value === null ? 0 : Number(Number(m.value).toPrecision(3))); if (c.op === 'between' && !Array.isArray(c.th)) { c.th = [c.th, c.th]; } onChange(true); } } },
        [h('option', { value: 'pct', text: '历史分位' }), h('option', { value: 'value', text: '原始值' })]);
      fs.value = c.field; ctl.appendChild(fs);
    }
    var os = h('select', { on: { change: function () {
      var was = c.op; c.op = os.value; c.text = '';
      if (c.op === 'between' && was !== 'between') { c.th = [c.th, c.th]; } else if (c.op !== 'between' && was === 'between') { c.th = c.th[0]; }
      onChange(true);
    } } }, OPS.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    os.value = c.op; ctl.appendChild(os);
    function inp(get, set) {
      var e = h('input', { type: 'number', step: 'any', value: String(Number((get() * u.k).toPrecision(6))),
        on: { change: function () { var v = parseFloat(e.value); if (isNaN(v)) { banner('阈值要填数字'); return; } set(v / u.k); c.text = ''; if (desc) { desc.textContent = ''; } onChange(false); } } });
      return e;
    }
    if (c.op === 'between') {
      ctl.appendChild(inp(function () { return c.th[0]; }, function (v) { c.th[0] = v; }));
      ctl.appendChild(h('span', { text: '至' }));
      ctl.appendChild(inp(function () { return c.th[1]; }, function (v) { c.th[1] = v; }));
    } else {
      ctl.appendChild(inp(function () { return c.th; }, function (v) { c.th = v; }));
    }
    ctl.appendChild(h('span', { class: 'small muted', text: u.s }));
    wrap.appendChild(ctl);
    if (m) {
      var now = '当前 ' + showVal(m, m.value, 'value') + (m.pct !== null && m.pct !== undefined ? '，处于 ' + pct(m.pct) + ' 分位' : '');
      wrap.appendChild(h('div', { class: 'now', text: now + (m.value_date ? '（' + m.value_date + '）' : '') }));
    }
    return wrap;
  }

  function groupEditor(g, rerender, states, okChoices) {
    var box = h('div');
    function sec(title, list, extra) {
      box.appendChild(h('div', { class: 'sec-title' }, [h('span', { text: title }), extra || null]));
      list.forEach(function (c, i) {
        box.appendChild(condRow(c, function (full) { if (full) { rerender(); } }, function () { list.splice(i, 1); rerender(); }, states));
      });
      var add = h('div', { class: 'row' }, [h('button', { type: 'button', class: 'btn small ghost', text: '＋ 添加指标', on: { click: function () {
        openPicker(function (m) { if (list.length >= S.meta.limits.conds) { banner('一组最多 ' + S.meta.limits.conds + ' 条条件'); return; } list.push(newCondFrom(m)); rerender(); });
      } } })]);
      if (okChoices && okChoices.length) {
        var sel = h('select', {}, okChoices.map(function (k) { return h('option', { value: k, text: '近N日“' + states[k] + '”曾满足' }); }));
        var nIn = h('input', { type: 'number', min: 1, max: 250, value: 20 });
        add.appendChild(sel); add.appendChild(nIn);
        add.appendChild(h('button', { type: 'button', class: 'btn small ghost', text: '＋ 添加', on: { click: function () {
          list.push({ src: 'ok', id: sel.value + ':' + Math.max(1, parseInt(nIn.value, 10) || 20), field: 'value', op: '==', th: 1, text: '', info: false }); rerender();
        } } }));
      }
      box.appendChild(add);
    }
    sec('必须全部满足', g.required);
    if (!g.optional) { g.optional = { items: [], min: 0 }; }
    var counted = g.optional.items.filter(function (c) { return !c.info; }).length;
    var minIn = h('input', { type: 'number', min: 0, max: counted, value: g.optional.min,
      on: { change: function () { g.optional.min = Math.max(0, Math.min(counted, parseInt(minIn.value, 10) || 0)); } } });
    sec('可选条件', g.optional.items, h('span', { class: 'small muted' }, ['（至少满足 ', minIn, ' 项）']));
    return box;
  }

  // ------------------------------------------------------------ 回测设置（两个页签共用）
  function settingsBlock() {
    var st = S.settings;
    var box = h('div');
    box.appendChild(h('div', { class: 'sec-title', text: '回测设置' }));
    var tg = h('div', { class: 'row' }, [h('span', { class: 'small muted', text: '标的' })]);
    S.meta.targets.forEach(function (t) {
      var cb = h('input', { type: 'checkbox', checked: st.targets.indexOf(t.key) >= 0, on: { change: function () {
        var i = st.targets.indexOf(t.key);
        if (cb.checked && i < 0) { st.targets.push(t.key); } else if (!cb.checked && i >= 0) { st.targets.splice(i, 1); }
      } } });
      tg.appendChild(h('label', {}, [cb, t.name]));
    });
    box.appendChild(tg);
    var hz = h('div', { class: 'row' }, [h('span', { class: 'small muted', text: '持有期' })]);
    S.meta.horizons.forEach(function (x) {
      var cb = h('input', { type: 'checkbox', checked: st.horizons.indexOf(x) >= 0, on: { change: function () {
        var i = st.horizons.indexOf(x);
        if (cb.checked && i < 0) { st.horizons.push(x); st.horizons.sort(function (a, b) { return a - b; }); } else if (!cb.checked && i >= 0) { st.horizons.splice(i, 1); }
      } } });
      hz.appendChild(h('label', {}, [cb, x + ' 日']));
    });
    box.appendChild(hz);
    var s0 = h('input', { type: 'date', value: st.start, min: S.meta.start, max: S.meta.end, on: { change: function () { st.start = s0.value; } } });
    var s1 = h('input', { type: 'date', value: st.end, min: S.meta.start, max: S.meta.end, on: { change: function () { st.end = s1.value; } } });
    box.appendChild(h('div', { class: 'row' }, [h('span', { class: 'small muted', text: '区间' }), s0, '至', s1,
      h('span', { class: 'small muted', text: '（留空 = 全部历史，' + S.meta.start + ' 起）' })]));
    return box;
  }

  function actionsBlock(kind) {
    var row = h('div', { class: 'row', style: 'margin-top:12px' });
    row.appendChild(h('button', { type: 'button', class: 'btn', text: '运行回测', on: { click: function () { run(kind); } } }));
    row.appendChild(h('button', { type: 'button', class: 'btn ghost', text: '保存到本机', on: { click: function () { saveLocal(kind); } } }));
    row.appendChild(h('button', { type: 'button', class: 'btn ghost', text: '复制分享链接', on: { click: function () { share(kind); } } }));
    var more = h('select', { on: { change: function () {
      var v = more.value; more.value = '';
      if (v === 'ej') { download(schemeOf(kind).name + '.json', JSON.stringify({ kind: kind === 'cond' ? 'conditions' : 'regime', scheme: schemeOf(kind), settings: S.settings }, null, 2), 'application/json'); }
      if (v === 'ij') { readFile('.json,application/json', function (t) { try { var o = JSON.parse(t); loadAny(o.kind, o.scheme, o.settings); } catch (e) { banner('不是有效的方案文件：' + e.message); } }); }
      if (v === 'ey') { exportYaml(kind); }
      if (v === 'iy') { readFile('.yaml,.yml,text/yaml', function (t) { api('/api/import/yaml', { text: t }).then(function (o) { loadAny(o.kind, o.scheme); banner('已导入', 'ok'); }).catch(function (e) { banner(e.message); }); }); }
    } } }, [h('option', { value: '', text: '更多…' }), h('option', { value: 'ej', text: '导出方案文件（JSON）' }), h('option', { value: 'ij', text: '导入方案文件（JSON）' }),
      h('option', { value: 'ey', text: '导出 YAML（提交正式采纳用）' }), h('option', { value: 'iy', text: '导入 YAML' })]);
    row.appendChild(more);
    return row;
  }

  function presetBlock(kind, onLoad) {
    var list = S.presets.filter(function (p) { return p.kind === (kind === 'cond' ? 'conditions' : 'regime'); });
    var sel = h('select', {}, [h('option', { value: '', text: '载入模板…' })].concat(list.map(function (p, i) { return h('option', { value: String(i), text: p.name }); })));
    sel.addEventListener('change', function () { if (sel.value !== '') { onLoad(clone(list[+sel.value].scheme)); } });
    return sel;
  }

  function savedList(kind) {
    var all = loadSaved().filter(function (x) { return x.kind === kind; });
    var box = h('div');
    box.appendChild(h('div', { class: 'sec-title', text: '我的方案（保存在本机浏览器）' }));
    if (!all.length) { box.appendChild(h('div', { class: 'small muted', text: '还没有保存过方案。' })); }
    all.forEach(function (x) {
      box.appendChild(h('div', { class: 'saved' }, [
        h('span', { class: 'grow', text: x.scheme.name }), h('span', { class: 'small muted', text: x.saved_at }),
        h('button', { type: 'button', class: 'btn small ghost', text: '载入', on: { click: function () { loadAny(kind === 'cond' ? 'conditions' : 'regime', clone(x.scheme), x.settings); } } }),
        h('button', { type: 'button', class: 'btn small danger', text: '删除', on: { click: function () {
          if (!window.confirm('删除本机保存的方案“' + x.scheme.name + '”？')) { return; }
          writeSaved(loadSaved().filter(function (y) { return y.id !== x.id; })); render();
        } } })
      ]));
    });
    return box;
  }

  // ------------------------------------------------------------ 条件回测：编辑区
  function blankCond() { return { name: '我的条件', required: [], optional: { items: [], min: 0 }, persist: 1, gap: 10 }; }
  function renderCondEditor() {
    var g = S.cond;
    var box = clear($('cond-editor'));
    var nm = h('input', { class: 'grow', value: g.name, on: { change: function () { g.name = nm.value; } } });
    box.appendChild(h('div', { class: 'row' }, [h('strong', { text: '方案名称' }), nm]));
    box.appendChild(h('div', { class: 'row' }, [presetBlock('cond', function (s) { S.cond = s; if (S.cond.persist === undefined) { S.cond.persist = 1; S.cond.gap = 10; } renderCondEditor(); }),
      h('button', { type: 'button', class: 'btn small danger', text: '清空', on: { click: function () { S.cond = blankCond(); renderCondEditor(); } } })]));
    box.appendChild(groupEditor(g, renderCondEditor));
    var ps = h('input', { type: 'number', min: 1, max: 60, value: g.persist || 1, on: { change: function () { g.persist = parseInt(ps.value, 10) || 1; } } });
    var gp = h('input', { type: 'number', min: 1, max: 250, value: g.gap || 10, on: { change: function () { g.gap = parseInt(gp.value, 10) || 10; } } });
    box.appendChild(h('div', { class: 'row' }, ['连续满足', ps, '日才算触发；相隔不超过', gp, '个交易日的触发算同一次事件']));
    box.appendChild(settingsBlock());
    box.appendChild(actionsBlock('cond'));
    box.appendChild(savedList('cond'));
  }

  // ------------------------------------------------------------ 状态体系：编辑区
  function stateNames(sc) { var o = {}; Object.keys(sc.states).forEach(function (k) { o[k] = sc.states[k].name; }); o.none = '未满足任何状态'; return o; }
  function renderRegimeEditor() {
    var box = clear($('regime-editor'));
    var top = h('div', { class: 'row' }, [presetBlock('regime', function (s) { S.regime = s; renderRegimeEditor(); }),
      h('button', { type: 'button', class: 'btn small ghost', text: '新建空白', on: { click: function () {
        S.regime = { name: '我的状态体系', states: {}, priority: [], default: 'none', confirm_days: { none: 1 }, bottom_repair_lookback: null }; renderRegimeEditor();
      } } })]);
    box.appendChild(top);
    var sc = S.regime;
    if (!sc) { box.appendChild(h('p', { class: 'muted', text: '先载入一个模板（框架原文、v1 修改建议），或新建空白体系。' })); return; }
    var nm = h('input', { class: 'grow', value: sc.name, on: { change: function () { sc.name = nm.value; } } });
    box.appendChild(h('div', { class: 'row' }, [h('strong', { text: '体系名称' }), nm]));
    box.appendChild(h('p', { class: 'small muted', text: '每天按优先级从高到低检查，第一个“条件全部满足”的状态就是当天的状态；都不满足时为“' +
      (sc.default === 'none' ? '未满足任何状态' : sc.states[sc.default].name) + '”。连续确认天数 > 1 时，新状态要连续满足这么多天才切换。' }));
    var names = stateNames(sc);
    var keys = Object.keys(sc.states);
    keys.forEach(function (k, idx) {
      var spec = sc.states[k];
      var isDefault = k === sc.default;
      var pi = sc.priority.indexOf(k);
      var card = h('div', { class: 'state-card', style: 'border-left-color:' + stColor(k, idx) });
      var sn = h('input', { value: spec.name, on: { change: function () { spec.name = sn.value; } } });
      var cd = h('input', { type: 'number', min: 1, max: 60, value: (sc.confirm_days || {})[k] || 1, title: '连续确认天数',
        on: { change: function () { sc.confirm_days = sc.confirm_days || {}; sc.confirm_days[k] = parseInt(cd.value, 10) || 1; } } });
      var head = h('div', { class: 'row' }, [sn, h('span', { class: 'small muted', text: k }), h('span', { class: 'grow' }),
        isDefault ? h('span', { class: 'small muted', text: '默认状态' }) : h('span', { class: 'small muted', text: '优先级 ' + (pi + 1) }),
        isDefault ? null : h('button', { type: 'button', class: 'btn small ghost', text: '↑', title: '提高优先级', on: { click: function () { if (pi > 0) { sc.priority.splice(pi, 1); sc.priority.splice(pi - 1, 0, k); renderRegimeEditor(); } } } }),
        isDefault ? null : h('button', { type: 'button', class: 'btn small ghost', text: '↓', title: '降低优先级', on: { click: function () { if (pi < sc.priority.length - 1) { sc.priority.splice(pi, 1); sc.priority.splice(pi + 1, 0, k); renderRegimeEditor(); } } } }),
        h('button', { type: 'button', class: 'btn small danger', text: '删除状态', on: { click: function () {
          if (!window.confirm('删除状态“' + spec.name + '”？')) { return; }
          delete sc.states[k]; sc.priority = sc.priority.filter(function (x) { return x !== k; });
          if (sc.default === k) { sc.default = 'none'; }
          Object.keys(sc.states).forEach(function (o) {
            var s2 = sc.states[o];
            s2.required = s2.required.filter(function (c) { return !(c.src === 'ok' && c.id.split(':')[0] === k); });
            s2.optional.items = s2.optional.items.filter(function (c) { return !(c.src === 'ok' && c.id.split(':')[0] === k); });
          });
          renderRegimeEditor();
        } } })]);
      card.appendChild(head);
      card.appendChild(h('div', { class: 'row small' }, ['连续确认', cd, '日']));
      if (spec.framework) { card.appendChild(h('div', { class: 'small muted', text: '框架原文：' + spec.framework })); }
      card.appendChild(groupEditor(spec, renderRegimeEditor, names, keys.slice(0, idx)));
      box.appendChild(card);
    });
    box.appendChild(h('div', { class: 'row' }, [h('button', { type: 'button', class: 'btn small ghost', text: '＋ 添加状态', on: { click: function () {
      if (Object.keys(sc.states).length >= S.meta.limits.states) { banner('最多 ' + S.meta.limits.states + ' 个状态'); return; }
      var i = 1; while (sc.states['s' + i]) { i++; }
      sc.states['s' + i] = { name: '新状态' + i, required: [], optional: { items: [], min: 0 } };
      sc.priority.push('s' + i); renderRegimeEditor();
    } } })]));
    if (sc.default === 'none') {
      var cdn = h('input', { type: 'number', min: 1, max: 60, value: (sc.confirm_days || {}).none || 1,
        on: { change: function () { sc.confirm_days = sc.confirm_days || {}; sc.confirm_days.none = parseInt(cdn.value, 10) || 1; } } });
      box.appendChild(h('div', { class: 'row small' }, ['“未满足任何状态”连续确认', cdn, '日']));
    }
    if (sc.states.bottom_repair) {
      var lb = h('input', { type: 'number', min: 1, max: 500, value: sc.bottom_repair_lookback || '', placeholder: '不要求',
        on: { change: function () { sc.bottom_repair_lookback = lb.value ? parseInt(lb.value, 10) : null; } } });
      box.appendChild(h('div', { class: 'row small' }, ['底部修复须在最近', lb, '个交易日内出现过熊市主跌或恐慌出清（留空 = 不要求）']));
    }
    box.appendChild(settingsBlock());
    box.appendChild(actionsBlock('regime'));
    box.appendChild(savedList('regime'));
  }

  // ------------------------------------------------------------ 运行
  function schemeOf(kind) { return kind === 'cond' ? S.cond : S.regime; }
  function countTrial(kind) {
    var arr = [];
    try { arr = JSON.parse(sessionStorage.getItem(TRIAL_KEY) || '[]'); } catch (e) { arr = []; }
    var k = hash(kind + JSON.stringify(schemeOf(kind)));
    if (arr.indexOf(k) < 0) { arr.push(k); try { sessionStorage.setItem(TRIAL_KEY, JSON.stringify(arr)); } catch (e) { /* 忽略 */ } }
    return arr.length;
  }
  function run(kind) {
    if (!schemeOf(kind)) { banner('先载入或新建一个方案'); return; }
    var target = kind === 'cond' ? $('cond-result') : $('regime-result');
    clear(target).appendChild(h('div', { class: 'card muted', text: '计算中…' }));
    banner('');
    var path = kind === 'cond' ? '/api/backtest/conditions' : '/api/backtest/regime';
    return api(path, { scheme: schemeOf(kind), settings: S.settings }).then(function (r) {
      var n = countTrial(kind);
      if (kind === 'cond') { renderCondResult(r, n); } else { renderRegimeResult(r, n); }
    }).catch(function (e) { clear(target).appendChild(h('div', { class: 'card', text: '' }, [h('div', { class: 'warn', text: e.message })])); });
  }

  // ------------------------------------------------------------ 条件回测：结果
  function diffClass(win, base) { if (win === null || base === null || win === undefined || base === undefined) { return ''; } return win - base >= 0.03 ? 'up' : (win - base <= -0.03 ? 'dn' : ''); }
  function trialNote(n) { return h('div', { class: 'caveat', text: '本次已试过 ' + n + ' 套不同的条件。试得越多，越容易碰巧找到“历史上好看”的组合。' }); }
  function renderCondResult(r, trials) {
    var box = clear($('cond-result'));
    var sm = r.summary;
    var tk = r.primary.target, hh = String(r.primary.h);
    var main = r.stats[tk][hh];
    var kp = h('div', { class: 'kpis' });
    kp.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v ' + (sm.today ? 'up' : ''), text: sm.today ? '已触发' : '未触发' }),
      h('div', { class: 'l', text: sm.today ? ('截至 ' + r.asof + '，已连续 ' + sm.streak + ' 日') : ('最近一次：' + (sm.last || '从未')) })]));
    kp.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v', text: String(sm.days) + ' 天' }),
      h('div', { class: 'l', text: '触发天数（可判断 ' + sm.base_days + ' 天）' })]));
    kp.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v', text: String(main.ep || 0) + ' 次' }), h('div', { class: 'l', text: '独立事件（相隔 >' + r.scheme.gap + ' 日）' })]));
    if (main.n) {
      kp.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v ' + diffClass(main.win, main.base_win), text: pct(main.win) }),
        h('div', { class: 'l', text: '此后 ' + hh + ' 日' + r.targets[tk] + '上涨概率（平时 ' + pct(main.base_win) + '，区间 ' + pct(main.lo) + '–' + pct(main.hi) + '）' })]));
    }
    var c1 = h('div', { class: 'card' }, [h('h3', { text: r.scheme.name }), kp]);
    r.warnings.forEach(function (w) { c1.appendChild(h('div', { class: 'warn', text: w })); });
    c1.appendChild(h('div', { class: 'caveat', text: r.caveat }));
    c1.appendChild(trialNote(trials));
    box.appendChild(c1);
    // 表格
    var tbl = h('table');
    tbl.appendChild(h('tr', {}, ['标的 · 持有期', '触发天数', '事件', '上涨概率', '平时', '95% 区间', '按事件', '中位收益', '最差10%收益', '期间浮亏中位', '样本内', '样本外'].map(function (t) { return h('th', { text: t }); })));
    Object.keys(r.stats).forEach(function (t) {
      Object.keys(r.stats[t]).forEach(function (hk) {
        var s = r.stats[t][hk];
        var i = s.is || {}, o = s.oos || {};
        tbl.appendChild(h('tr', {}, [
          h('td', { text: r.targets[t] + ' · ' + hk + ' 日' }), h('td', { text: String(s.n) }), h('td', { text: String(s.ep) }),
          h('td', { class: diffClass(s.win, s.base_win), text: pct(s.win) }), h('td', { text: pct(s.base_win) }),
          h('td', { text: s.n ? pct(s.lo) + '–' + pct(s.hi) : '—' }), h('td', { class: diffClass(s.ep_win, s.base_win), text: pct(s.ep_win) }),
          h('td', { text: ret(s.median) }), h('td', { text: ret(s.p10) }), h('td', { text: ret(s.mae) }),
          h('td', { class: diffClass(i.win, i.base_win), text: i.n ? pct(i.win) + ' / ' + pct(i.base_win) + '（' + i.ep + '次）' : '—' }),
          h('td', { class: diffClass(o.win, o.base_win), text: o.n ? pct(o.win) + ' / ' + pct(o.base_win) + '（' + o.ep + '次）' : '—' })
        ]));
      });
    });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '触发之后市场怎么走（T+1 收盘买入）' }), h('div', { class: 'tw' }, tbl),
      h('div', { class: 'small muted', text: '红色：比平时高 3 个百分点以上；绿色：低 3 个百分点以上。样本内 ≤2021、样本外 ≥2022，格式为“触发后 / 平时”。' })]));
    // 图
    var ch = h('div', { class: 'chart tall', id: 'cond-chart' });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: r.targets[tk] + '走势与触发日' }), ch]));
    drawCondChart(ch, r);
    // 今天
    var ul = h('table');
    ul.appendChild(h('tr', {}, ['条件', '类型', '当前', '是否满足'].map(function (t) { return h('th', { text: t }); })));
    r.checklist.forEach(function (c) {
      ul.appendChild(h('tr', {}, [h('td', { text: c.text, style: 'white-space:normal' }), h('td', { text: c.kind }), h('td', { text: c.value + (c.date && c.date !== r.asof ? '（' + c.date + '）' : '') }),
        h('td', { class: c.ok ? 'ok-y' : 'ok-n', text: c.ok ? '✓ 满足' : '✗ 不满足' })]));
    });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '今天（' + r.asof + '）逐条情况' }), h('div', { class: 'tw' }, ul)]));
    // 逐年与事件
    var yt = h('table');
    yt.appendChild(h('tr', {}, ['年份', '触发天数', '事件', '按事件上涨概率（' + hh + '日）', '当年平时'].map(function (t) { return h('th', { text: t }); })));
    r.yearly.forEach(function (y) { yt.appendChild(h('tr', {}, [h('td', { text: String(y.year) }), h('td', { text: String(y.days) }), h('td', { text: String(y.ep) }), h('td', { class: diffClass(y.ep_win, y.base_win), text: pct(y.ep_win) }), h('td', { text: pct(y.base_win) })])); });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '逐年分布' }), h('div', { class: 'tw' }, yt)]));
    var et = h('table');
    var hs = r.settings.horizons;
    et.appendChild(h('tr', {}, ['事件开始', '持续触发天数'].concat(hs.map(function (x) { return x + '日收益'; })).concat(hs.map(function (x) { return x + '日内最大浮亏'; })).map(function (t) { return h('th', { text: t }); })));
    r.events.slice().reverse().forEach(function (e) {
      et.appendChild(h('tr', {}, [h('td', { text: e.date }), h('td', { text: String(e.days) })]
        .concat(hs.map(function (x) { var v = e['r' + x]; return h('td', { class: v > 0 ? 'up' : (v < 0 ? 'dn' : ''), text: v === null ? '未满' : ret(v) }); }))
        .concat(hs.map(function (x) { return h('td', { text: e['mae' + x] === null ? '—' : ret(e['mae' + x]) }); }))));
    });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '每次事件（' + r.targets[tk] + '，最近在前）' }), h('div', { class: 'tw', style: 'max-height:420px;overflow-y:auto' }, et)]));
  }

  function chartOf(el) {
    if (typeof window.echarts === 'undefined') { el.appendChild(h('div', { class: 'muted', text: '图表库没有加载，图表无法显示。' })); return null; }
    if (S.charts[el.id]) { S.charts[el.id].dispose(); }
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var c = window.echarts.init(el, dark ? 'dark' : null);
    S.charts[el.id] = c;
    return c;
  }
  function drawCondChart(el, r) {
    var c = chartOf(el); if (!c) { return; }
    try {
      var d = r.chart, hits = [], starts = [];
      d.hit.forEach(function (v, i) { if (v) { hits.push([d.dates[i], d.close[i]]); } });
      d.starts.forEach(function (i) { starts.push([d.dates[i], d.close[i]]); });
      c.setOption({
        backgroundColor: 'transparent', animation: false,
        tooltip: { trigger: 'axis' }, legend: { data: ['收盘', '触发日', '事件开始'], top: 0 },
        grid: { left: 50, right: 16, top: 30, bottom: 60 },
        xAxis: { type: 'category', data: d.dates, boundaryGap: false },
        yAxis: { type: 'value', scale: true },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10 }],
        series: [
          { name: '收盘', type: 'line', data: d.close, showSymbol: false, lineStyle: { width: 1.2, color: '#5d6d7e' } },
          { name: '触发日', type: 'scatter', data: hits, symbolSize: 4, itemStyle: { color: '#d9363e', opacity: 0.6 } },
          { name: '事件开始', type: 'scatter', data: starts, symbol: 'triangle', symbolSize: 9, itemStyle: { color: '#d9363e' } }
        ]
      });
    } catch (e) { el.textContent = '图表绘制失败：' + e.message; }
  }

  // ------------------------------------------------------------ 状态体系：结果
  function renderRegimeResult(r, trials) {
    S.lastRegime = r;
    var box = clear($('regime-result'));
    var cur = r.current;
    var ci = r.order.indexOf(cur.state);
    var none = r.coverage.filter(function (c) { return c.state === 'none'; })[0];
    var kp = h('div', { class: 'kpis' }, [
      h('div', { class: 'kpi' }, [h('div', { class: 'v' }, [h('span', { class: 'pill', style: 'font-size:15px;background:' + stColor(cur.state, ci), text: cur.name })]),
        h('div', { class: 'l', text: '截至 ' + cur.date + '，自 ' + cur.since + ' 起' })]),
      h('div', { class: 'kpi' }, [h('div', { class: 'v', text: none ? pct(none.share) : '—' }), h('div', { class: 'l', text: '未满足任何状态的天数占比' })]),
      h('div', { class: 'kpi' }, [h('div', { class: 'v', text: String(r.valid_days) }), h('div', { class: 'l', text: '可判定的交易日' })])
    ]);
    if (r.agree.same !== null && r.agree.same !== undefined) {
      kp.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v', text: pct(r.agree.same) }), h('div', { class: 'l', text: '与框架原文逐日相同的比例' })]));
    }
    var c1 = h('div', { class: 'card' }, [h('h3', { text: r.scheme.name }), kp]);
    var bar = h('div', { class: 'covbar' });
    var leg = h('div', { class: 'legend' });
    r.coverage.forEach(function (c, i) {
      if (c.share) { bar.appendChild(h('i', { style: 'width:' + (c.share * 100) + '%;background:' + stColor(c.state, i), title: c.name + ' ' + pct(c.share, 1) })); }
      leg.appendChild(h('span', {}, [h('i', { style: 'background:' + stColor(c.state, i) }), c.name + ' ' + pct(c.share, 1) + '（' + c.days + ' 天）']));
    });
    c1.appendChild(bar); c1.appendChild(leg);
    c1.appendChild(h('div', { class: 'caveat', text: r.caveat }));
    c1.appendChild(trialNote(trials));
    box.appendChild(c1);
    var ch = h('div', { class: 'chart tall', id: 'regime-chart' });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: r.targets[r.settings.targets[0]] + '走势与每日状态' }), ch]));
    drawRegimeChart(ch, r);
    // 各状态之后
    var vt = S.regimeView;
    if (!r.stats[vt.target]) { vt.target = r.settings.targets[0]; }
    if (r.settings.horizons.indexOf(vt.h) < 0) { vt.h = r.settings.horizons[0]; }
    var tSel = h('select', { on: { change: function () { vt.target = tSel.value; renderRegimeResult(r, trials); } } }, Object.keys(r.stats).map(function (k) { return h('option', { value: k, text: r.targets[k] }); }));
    tSel.value = vt.target;
    var hSel = h('select', { on: { change: function () { vt.h = +hSel.value; renderRegimeResult(r, trials); } } }, r.settings.horizons.map(function (x) { return h('option', { value: String(x), text: x + ' 日' }); }));
    hSel.value = String(vt.h);
    var st = h('table');
    st.appendChild(h('tr', {}, ['状态', '天数', '段数', '上涨概率', '按段', '中位收益', '最差10%收益', '年化波动中位', '最大回撤中位', '最差10%回撤'].map(function (t) { return h('th', { text: t }); })));
    r.stats[vt.target].filter(function (x) { return x.h === vt.h; }).forEach(function (x) {
      st.appendChild(h('tr', {}, [h('td', { text: x.name }), h('td', { text: String(x.days) }), h('td', { text: String(x.episodes) }),
        h('td', { class: x.state === '全部' ? '' : diffClass(x.win, x.base_win), text: pct(x.win) }), h('td', { text: pct(x.ep_win) }), h('td', { text: ret(x.median) }),
        h('td', { text: ret(x.p10) }), h('td', { text: pct(x.vol) }), h('td', { text: ret(x.mdd_med) }), h('td', { text: ret(x.mdd_p10) })]));
    });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '各状态之后市场怎么走' }), h('div', { class: 'row' }, [tSel, hSel]), h('div', { class: 'tw' }, st),
      h('div', { class: 'small muted', text: '按天统计，T+1 收盘买入；“按段”只取每段状态的第一天。红/绿：比全部日子高/低 3 个百分点以上。' })]));
    // 今天逐条
    var ck = h('div', { class: 'card' }, [h('h3', { text: '今天（' + cur.date + '）各状态的条件' })]);
    r.checklist.forEach(function (s) {
      var det = h('details', { open: s.state === cur.state });
      det.appendChild(h('summary', {}, [s.name + '：' + (s.ok ? '全部满足' : '必要条件满足 ' + s.n_req + '/' + s.n_req_all)]));
      var t = h('table');
      s.items.forEach(function (it) { t.appendChild(h('tr', {}, [h('td', { text: it.text, style: 'white-space:normal' }), h('td', { text: it.kind }), h('td', { text: it.value }), h('td', { class: it.ok ? 'ok-y' : 'ok-n', text: it.ok ? '✓' : '✗' })])); });
      det.appendChild(h('div', { class: 'tw' }, t));
      ck.appendChild(det);
    });
    box.appendChild(ck);
    // 对照与检查
    var at = h('table');
    at.appendChild(h('tr', {}, ['本方案', '框架原文', '天数'].map(function (t) { return h('th', { text: t }); })));
    r.agree.table.forEach(function (x) { at.appendChild(h('tr', {}, [h('td', { text: x.mine }), h('td', { text: x.official }), h('td', { text: String(x.days) })])); });
    var sn = h('table');
    sn.appendChild(h('tr', {}, ['日期', '事件', '按常识应为', '本方案判定'].map(function (t) { return h('th', { text: t }); })));
    r.sanity.forEach(function (x) { sn.appendChild(h('tr', {}, [h('td', { text: x.date }), h('td', { text: x.event, style: 'white-space:normal' }), h('td', { text: x.expect }), h('td', { text: x.got })])); });
    var du = h('table');
    du.appendChild(h('tr', {}, ['状态', '出现段数', '平均持续(日)', '最长(日)'].map(function (t) { return h('th', { text: t }); })));
    r.durations.forEach(function (x) { du.appendChild(h('tr', {}, [h('td', { text: x.name }), h('td', { text: x.count === null ? '0' : String(x.count) }), h('td', { text: x.mean === null ? '—' : String(x.mean) }), h('td', { text: x.max === null ? '—' : String(x.max) })])); });
    box.appendChild(h('div', { class: 'card' }, [h('h3', { text: '合理性检查' }), h('div', { class: 'tw' }, sn),
      h('h4', { text: '持续时间' }), h('div', { class: 'tw' }, du), h('h4', { text: '与框架原文的逐日对照（天数最多的 20 种组合）' }), h('div', { class: 'tw' }, at)]));
  }
  function drawRegimeChart(el, r) {
    var c = chartOf(el); if (!c) { return; }
    try {
      var d = r.timeline;
      var colors = r.order.map(function (k, i) { return stColorHex(k, i); });
      var band = d.state.map(function (s) { return s === null ? { value: 0 } : { value: 1, itemStyle: { color: colors[s] } }; });
      c.setOption({
        backgroundColor: 'transparent', animation: false,
        tooltip: { trigger: 'axis', formatter: function (ps) {
          var i = ps[0].dataIndex, s = d.state[i];
          return d.dates[i] + '<br>收盘 ' + d.close[i] + '<br>' + (s === null ? '数据不足' : r.names[r.order[s]]);
        } },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: [{ left: 50, right: 16, top: 16, height: '62%' }, { left: 50, right: 16, top: '76%', height: '8%' }],
        xAxis: [{ type: 'category', data: d.dates, boundaryGap: false, axisLabel: { show: false } }, { type: 'category', data: d.dates, gridIndex: 1, boundaryGap: true }],
        yAxis: [{ type: 'value', scale: true }, { type: 'value', gridIndex: 1, max: 1, show: false }],
        dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], height: 18, bottom: 6 }],
        series: [
          { type: 'line', data: d.close, showSymbol: false, lineStyle: { width: 1.2, color: '#5d6d7e' } },
          { type: 'bar', data: band, xAxisIndex: 1, yAxisIndex: 1, barCategoryGap: 0, barWidth: '100%' }
        ]
      });
    } catch (e) { el.textContent = '图表绘制失败：' + e.message; }
  }

  // ------------------------------------------------------------ 保存、分享、导入导出
  function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; } }
  function writeSaved(a) { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); } catch (e) { banner('浏览器不允许本机保存：' + e.message); } }
  function saveLocal(kind) {
    var sc = schemeOf(kind);
    if (!sc) { banner('没有可保存的方案'); return; }
    var name = window.prompt('保存为：', sc.name);
    if (!name) { return; }
    sc.name = name;
    var all = loadSaved().filter(function (x) { return !(x.kind === kind && x.scheme.name === name); });
    var d = new Date();
    all.unshift({ id: String(Date.now()), kind: kind, scheme: clone(sc), settings: clone(S.settings), saved_at: d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) });
    writeSaved(all.slice(0, 50));
    render();
    banner('已保存到本机浏览器：' + name, 'ok');
  }
  function share(kind) {
    var sc = schemeOf(kind);
    if (!sc) { banner('没有可分享的方案'); return; }
    var url = location.origin + location.pathname + '#s=' + b64e(JSON.stringify({ k: kind, s: sc, st: S.settings }));
    var done = function () { banner('分享链接已复制。对方打开后会看到同一套方案并自动运行。', 'ok'); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(url).then(done, function () { window.prompt('复制下面的链接：', url); }); } else { window.prompt('复制下面的链接（Ctrl+C）：', url); }
  }
  function exportYaml(kind) {
    var sc = schemeOf(kind);
    if (!sc) { banner('没有可导出的方案'); return; }
    api('/api/export/yaml', { kind: kind === 'cond' ? 'conditions' : 'regime', scheme: sc }).then(function (o) {
      download((sc.name || '方案') + '.yaml', o.yaml, 'text/yaml');
    }).catch(function (e) { banner(e.message); });
  }
  function loadAny(kind, scheme, settings) {
    if (!scheme || (kind !== 'conditions' && kind !== 'regime' && kind !== 'cond')) { banner('方案内容不完整'); return; }
    if (settings && typeof settings === 'object') {
      S.settings = { targets: settings.targets || ['WA'], horizons: settings.horizons || [5, 20, 60], start: settings.start || '', end: settings.end || '' };
    }
    if (kind === 'regime') { S.regime = scheme; go('regime'); } else {
      if (!scheme.optional) { scheme.optional = { items: [], min: 0 }; }
      S.cond = scheme; go('cond');
    }
    render();
  }

  // ------------------------------------------------------------ 方案对比
  function renderCompare() {
    var box = clear($('compare-editor'));
    box.appendChild(h('h3', { text: '方案对比（从“我的方案”里最多选 3 个，用当前的回测设置）' }));
    var all = loadSaved();
    var picked = [];
    if (!all.length) { box.appendChild(h('p', { class: 'muted', text: '还没有保存过方案。在“条件回测”或“状态体系”里点“保存到本机”后，就能在这里对比。' })); return; }
    all.forEach(function (x) {
      var cb = h('input', { type: 'checkbox', on: { change: function () {
        if (cb.checked) { if (picked.length >= 3) { cb.checked = false; banner('最多选 3 个'); return; } picked.push(x); } else { picked = picked.filter(function (y) { return y !== x; }); }
      } } });
      box.appendChild(h('label', { class: 'saved' }, [cb, h('span', { class: 'grow', text: x.scheme.name }), h('span', { class: 'small muted', text: (x.kind === 'cond' ? '条件' : '状态体系') + ' · ' + x.saved_at })]));
    });
    box.appendChild(settingsBlock());
    box.appendChild(h('button', { type: 'button', class: 'btn', text: '对比', on: { click: function () { runCompare(picked); } } }));
  }
  function runCompare(picked) {
    var out = clear($('compare-result'));
    if (!picked.length) { banner('先勾选要对比的方案'); return; }
    out.appendChild(h('div', { class: 'card muted', text: '计算中…' }));
    var jobs = picked.map(function (x) {
      return api(x.kind === 'cond' ? '/api/backtest/conditions' : '/api/backtest/regime', { scheme: x.scheme, settings: S.settings })
        .then(function (r) { return { x: x, r: r }; }, function (e) { return { x: x, err: e.message }; });
    });
    Promise.all(jobs).then(function (res) {
      clear(out);
      var conds = res.filter(function (o) { return o.x.kind === 'cond'; });
      var regs = res.filter(function (o) { return o.x.kind !== 'cond'; });
      if (conds.length) {
        var t = h('table');
        t.appendChild(h('tr', {}, [h('th', { text: '指标' })].concat(conds.map(function (o) { return h('th', { text: o.x.scheme.name }); }))));
        var rows = [['今天', function (r) { return r.summary.today ? '已触发' : '未触发'; }], ['触发天数', function (r) { return String(r.summary.days); }],
          ['独立事件', function (r) { var s = r.stats[r.primary.target][String(r.primary.h)]; return String(s.ep); }]];
        S.settings.targets.forEach(function (tk) {
          S.settings.horizons.forEach(function (hh) {
            rows.push([tk + '|' + hh, function (r) { var s = (r.stats[tk] || {})[String(hh)]; return s && s.n ? pct(s.win) + ' / ' + pct(s.base_win) + '（样本外 ' + pct((s.oos || {}).win) + '）' : '—'; }]);
          });
        });
        rows.forEach(function (row) {
          var lab = row[0].indexOf('|') > 0 ? (S.meta.targets.filter(function (t) { return t.key === row[0].split('|')[0]; })[0].name + ' ' + row[0].split('|')[1] + '日上涨概率 / 平时') : row[0];
          t.appendChild(h('tr', {}, [h('td', { text: lab })].concat(conds.map(function (o) { return h('td', { text: o.err ? o.err : row[1](o.r) }); }))));
        });
        out.appendChild(h('div', { class: 'card' }, [h('h3', { text: '条件回测对比' }), h('div', { class: 'tw' }, t)]));
      }
      if (regs.length) {
        var t2 = h('table');
        t2.appendChild(h('tr', {}, [h('th', { text: '' })].concat(regs.map(function (o) { return h('th', { text: o.x.scheme.name }); }))));
        t2.appendChild(h('tr', {}, [h('td', { text: '今天' })].concat(regs.map(function (o) { return h('td', { text: o.err ? o.err : o.r.current.name }); }))));
        t2.appendChild(h('tr', {}, [h('td', { text: '未满足任何状态' })].concat(regs.map(function (o) {
          if (o.err) { return h('td', { text: '—' }); }
          var n = o.r.coverage.filter(function (c) { return c.state === 'none'; })[0]; return h('td', { text: n ? pct(n.share) : '无此项' });
        }))));
        t2.appendChild(h('tr', {}, [h('td', { text: '与框架原文逐日相同' })].concat(regs.map(function (o) { return h('td', { text: o.err ? '—' : pct(o.r.agree.same) }); }))));
        t2.appendChild(h('tr', {}, [h('td', { text: '合理性检查（符合/全部）' })].concat(regs.map(function (o) {
          if (o.err) { return h('td', { text: '—' }); }
          var ok = o.r.sanity.filter(function (s) { return s.expect.split('/').indexOf(s.got) >= 0; }).length;
          return h('td', { text: ok + ' / ' + o.r.sanity.length });
        }))));
        var tk = S.settings.targets[0], hh = S.settings.horizons.indexOf(20) >= 0 ? 20 : S.settings.horizons[0];
        regs.forEach(function (o) {
          if (o.err) { return; }
          o.r.stats[tk].filter(function (x) { return x.h === hh && x.state !== '全部'; }).forEach(function (x) {
            t2.appendChild(h('tr', {}, [h('td', { text: o.x.scheme.name + ' · ' + x.name })].concat(regs.map(function (p) {
              return h('td', { text: p === o ? pct(x.win) + '（' + x.days + '天）' : '' });
            }))));
          });
        });
        out.appendChild(h('div', { class: 'card' }, [h('h3', { text: '状态体系对比（各状态之后 ' + hh + ' 日上涨概率）' }), h('div', { class: 'tw' }, t2)]));
      }
    });
  }

  // ------------------------------------------------------------ 口径说明
  function renderHelp() {
    var box = clear($('help'));
    var P = function (t) { return h('p', { text: t }); };
    var L = function (items) { return h('ul', {}, items.map(function (t) { return h('li', { text: t }); })); };
    box.appendChild(h('h3', { text: '回测实验室怎么算' }));
    box.appendChild(L([
      '数据：每日流程已经算好的指标读数和近 5 年滚动分位（估值 10 年），全部只用当天及以前的数据；判定特征与看板“市场状态”用的完全相同。数据截至 ' + S.meta.asof + '。',
      '收益：T 日收盘后才知道条件是否满足，所以按 T+1 收盘买入，持有 5/20/60 日；“期间浮亏”是持有期内最低收盘相对买入价。',
      '事件：相隔不超过“事件间隔”（默认 10 个交易日）的触发日算同一次事件；“按事件”只取每次事件的第一天。',
      '95% 区间：Wilson 区间，样本量按 max(事件数, 天数/持有期) 计，避免重叠的持有期把样本量算大。',
      '样本内外：2021 年及以前为样本内，2022 年以后为样本外。两者方向相反时页面会提示。',
      '状态体系：直接调用看板的判定引擎，载入“框架原文”模板时，结果与看板“市场状态”逐日相同。'
    ]));
    box.appendChild(h('h3', { text: '读结果时要注意' }));
    box.appendChild(L([
      '条件是看过历史之后设定的，历史胜率天然偏高；试的组合越多越容易碰巧找到好看的结果。优先看样本外和事件数。',
      '事件少于 ' + S.meta.few_ep + ' 次时，结论很不稳定；区间宽于 30 个百分点时，“上涨概率”的差别可能只是运气。',
      '上涨概率高不等于收益高，请同时看中位收益、最差 10% 收益和期间浮亏。',
      '这里的结果不构成买卖建议；看板也不出仓位。'
    ]));
    box.appendChild(h('h3', { text: '保存、分享、正式采纳' }));
    box.appendChild(L([
      '“保存到本机”存在你自己的浏览器里，换电脑或清理浏览器数据后会丢失；要长期保存请用“导出方案文件（JSON）”。',
      '“复制分享链接”把整套方案放在链接里，同事打开就能看到同一套方案并自动运行。',
      '想把某套方案正式写进看板的判定标准：用“导出 YAML”，连同你的理由交给维护者。',
      '需要新的数据（例如万得里的某个序列）：告诉维护者名称和口径，接入后会自动出现在“选择指标”里。'
    ]));
    box.appendChild(P(S.meta.caveat));
  }

  // ------------------------------------------------------------ 页签与启动
  function go(tab) {
    S.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('on', v.id === 'view-' + tab); });
    render();
    Object.keys(S.charts).forEach(function (k) { if (S.charts[k]) { S.charts[k].resize(); } });
  }
  function render() {
    if (!S.meta) { return; }
    if (S.tab === 'cond') { renderCondEditor(); } else if (S.tab === 'regime') { renderRegimeEditor(); } else if (S.tab === 'compare') { renderCompare(); } else { renderHelp(); }
  }
  function fromHash() {
    var m = /#s=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) { return false; }
    try {
      var o = JSON.parse(b64d(m[1]));
      if (o.st) { S.settings = { targets: o.st.targets || ['WA'], horizons: o.st.horizons || [5, 20, 60], start: o.st.start || '', end: o.st.end || '' }; }
      if (o.k === 'regime') { S.regime = o.s; go('regime'); run('regime'); } else { S.cond = o.s; if (!S.cond.optional) { S.cond.optional = { items: [], min: 0 }; } go('cond'); run('cond'); }
      history.replaceState(null, '', location.pathname);
      return true;
    } catch (e) { banner('分享链接已损坏，无法打开：' + e.message); return false; }
  }
  function start() {
    try { S.token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { S.token = ''; }
    var qt = /[?&]token=([^&#]+)/.exec(location.search);
    if (qt) { S.token = decodeURIComponent(qt[1]); try { sessionStorage.setItem(TOKEN_KEY, S.token); } catch (e) { /* 忽略 */ } history.replaceState(null, '', location.pathname + location.hash); }
    S.cond = blankCond();
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-tab')); }); });
    $('picker-close').addEventListener('click', closePicker);
    $('picker').addEventListener('click', function (e) { if (e.target === $('picker')) { closePicker(); } });
    $('picker-q').addEventListener('input', renderPicker);
    $('picker-group').addEventListener('change', renderPicker);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('picker').hidden) { closePicker(); } });
    window.addEventListener('hashchange', function () { if (S.meta) { fromHash(); } });
    window.addEventListener('resize', function () { Object.keys(S.charts).forEach(function (k) { if (S.charts[k]) { S.charts[k].resize(); } }); });
    var boot = STATIC ? loadJSON('lab_meta.json').then(function (lm) {
      if (typeof window.LabEngine === 'undefined') { throw new Error('回测引擎没有加载成功，请刷新页面'); }
      LM = lm; ENG = window.LabEngine.create(lm.meta, lm.catalog);
      ensureCore().catch(function (e) { banner(e.message); });     // 提前在后台加载历史数据，点“运行”时就不用等
    }) : Promise.resolve();
    boot.then(function () { return Promise.all([api('/api/meta'), api('/api/catalog'), api('/api/presets')]); }).then(function (res) {
      S.meta = res[0]; S.catalog = res[1]; S.presets = res[2];
      S.catalog.forEach(function (m) { S.lookup[m.src + '|' + m.id] = m; if (S.groups.indexOf(m.group) < 0) { S.groups.push(m.group); } });
      var gs = $('picker-group');
      gs.appendChild(h('option', { value: '', text: '全部来源' }));
      S.groups.forEach(function (g) { gs.appendChild(h('option', { value: g, text: g })); });
      $('asof').textContent = '数据截至 ' + S.meta.asof + (S.meta.has_index_features ? '' : '（四指数的指数级指标尚未生成）');
      if (!fromHash()) { render(); }
    }).catch(function (e) { banner('加载失败：' + e.message); });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
