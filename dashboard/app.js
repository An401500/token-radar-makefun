// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable and sortable table, a
// per-protocol detail view with the model's own inputs and the protocol's farm
// plan, the peer multiples the model is priced from, and the live-token set the
// board is kept apart from. No network: every byte it shows is in data.js.
//
// THE MODEL (radar-3-peer), computed in lib/model.ts from the snapshot alone:
//   implied = TVL x peerMultiple x growthMult x maturityMult x chainMult
//   peerMultiple: median market-cap / TVL of the live-token protocols in the same
//     category (n >= 3), clamped to [0.05, 1.50]; too few live peers falls back to
//     the overall live median, taken over the live protocols in categories the
//     board itself can rank (no CEX, bridge or liquid-staking protocol prices
//     the fallback). A lending protocol is priced like lending protocols that
//     already trade, a DEX like DEXs that already trade. No name is ever
//     special-cased.
//   growthMult: 1 + clamp(change_7d, -60, +120) / 100 x 0.5
//   maturityMult: 0.6 + min(age_days, 1095) / 1095 x 0.4 (age unknown: 365 days)
//   chainMult: 1 + 0.02 x min(chains - 1, 5)
// Rows: the 40-protocol watchlist plus every other rankable protocol below the
// $50M floor (178 rows). Rankable means it records no token and passes the house's
// own exclusion rule (no Bridge / Canonical Bridge / Liquid Staking / Liquid
// Restaking / Restaked BTC / CEX, no wrapped / staked / staking word, no version
// marker, no exchange prefix), so wrapped and staked products of tokens that
// already trade never reach the board.
//
// The farm plan is the same derivation main.ts writes to board.json: category,
// chains, TVL and age decide the action, the capital, the hold and every cost
// and time. No name is special-cased, so the page and the board always agree.
//
// Views are hash-addressed, so each screenshot is reproducible:
//   #                     the board, top of the ranking
//   #detail=<slug>        one protocol's detail view
//   #cat=<category>       the board filtered to one category
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var PAGE = 25;

  var state = { q: '', category: 'all', chain: 'all', watch: false, sort: 'implied', dir: -1, page: 1, detail: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- farm plan: it arrives in each row's farm_steps, written by lib/model.ts
  // from the same derivation (category, chains, TVL and age decide the action,
  // the capital, the hold and every cost and time). The page renders the strings
  // the board carries, so the page and board.json can never drift apart; the
  // last step is the risk note.

  // ---- hash state ----
  function readHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var out = { q: '', category: 'all', chain: 'all', watch: false, sort: 'implied', dir: -1, page: 1, detail: null };
    if (!h) return out;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'q') out.q = v;
      else if (k === 'cat') out.category = v;
      else if (k === 'chain') out.chain = v;
      else if (k === 'watch') out.watch = v === '1';
      else if (k === 'sort') out.sort = v;
      else if (k === 'dir') out.dir = v === '1' ? 1 : -1;
      else if (k === 'page') out.page = Math.max(1, parseInt(v, 10) || 1);
      else if (k === 'detail') out.detail = v;
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    else {
      if (state.q) parts.push('q=' + encodeURIComponent(state.q));
      if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
      if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
      if (state.watch) parts.push('watch=1');
      if (state.sort !== 'implied' || state.dir !== -1) { parts.push('sort=' + state.sort); parts.push('dir=' + (state.dir === 1 ? '1' : '-1')); }
      if (state.page > 1) parts.push('page=' + state.page);
    }
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : '#');
  }

  // ---- filtering and sorting ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -9999 : a.change_7d; vb = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return state.dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      return state.dir * (va - vb);
    });
    return list;
  }

  // ---- renderers ----
  function header(wrap) {
    wrap.appendChild(el('header', { class: 'mast' },
      el('div', { class: 'kicker', text: 'Token launch radar · make.fun' }),
      el('h1', { text: 'Token Radar' }),
      el('p', { class: 'sub', text: 'Every protocol in the snapshot that records no token, ranked by what its token would be worth if the protocol\'s record stayed as it is — and what to do to farm each one before it launches.' }),
      el('p', { class: 'meta', html: 'Snapshot <b>' + esc(DATA.as_of) + '</b> · Source: <b>DefiLlama</b> · Floor <b>$50M TVL</b> · Model <b>' + esc(DATA.model_version) + '</b> · Implied values are this entry\'s own claim, never a promise a token is issued.' })
    ));
  }

  function stats(wrap) {
    var s = el('div', { class: 'stats' });
    [
      [String(DATA.board_size), 'ranked protocols'],
      [String(DATA.watchlist_size), 'on the watchlist'],
      [String(DATA.early_size), 'early, below the floor'],
      [usd(DATA.total_implied_usd), 'total implied value'],
      [String(DATA.live_size), 'live tokens set aside']
    ].forEach(function (pair) {
      s.appendChild(el('div', { class: 'stat' }, el('div', { class: 'v', text: pair[0] }), el('div', { class: 'l', text: pair[1] })));
    });
    wrap.appendChild(s);
  }

  function topFive(wrap) {
    wrap.appendChild(el('h2', { class: 'sec', text: 'Top five by implied value' }));
    wrap.appendChild(el('p', { class: 'lede', text: 'Click any card or row to open its detail view, with the model\'s arithmetic and the farm plan.' }));
    var grid = el('div', { class: 'top5' });
    DATA.rows.slice(0, 5).forEach(function (r) {
      grid.appendChild(el('div', { class: 'card', onclick: function () { state.detail = r.slug; state.page = 1; writeHash(); render(); window.scrollTo(0, 0); } },
        el('div', { class: 'rank', text: 'RANK #' + r.rank + (r.on_watchlist ? ' · WATCHLIST' : '') }),
        el('div', { class: 'name', text: r.name }),
        el('div', { class: 'val', text: usd(r.implied_value_usd) }),
        el('div', { class: 'det', text: 'TVL ' + usd(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · ' + (r.category || 'Other') + ' · peer ' + r.peer_multiple.toFixed(2) + '×' })
      ));
    });
    wrap.appendChild(grid);
  }

  function controls(wrap, list) {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
    var box = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search a protocol\u2026', value: state.q });
    search.addEventListener('input', function () {
      state.q = search.value; state.page = 1; writeHash(); render();
      var again = app.querySelector('input[type="search"]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    box.appendChild(search);
    var catSel = el('select', { 'aria-label': 'Category' });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })); });
    catSel.addEventListener('change', function () { state.category = catSel.value; state.page = 1; writeHash(); render(); });
    box.appendChild(catSel);
    var chainSel = el('select', { 'aria-label': 'Chain' });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })); });
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; state.page = 1; writeHash(); render(); });
    box.appendChild(chainSel);
    var chk = el('label', { class: 'chk' },
      el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, onclick: function (e) { state.watch = e.target.checked; state.page = 1; writeHash(); render(); } }),
      document.createTextNode('Watchlist only'));
    box.appendChild(chk);
    box.appendChild(el('span', { class: 'count', text: list.length + ' of ' + DATA.board_size + ' protocols' }));
    wrap.appendChild(box);
  }

  function boardTable(wrap, list) {
    var maxImp = DATA.rows[0].implied_value_usd;
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    var table = el('table', { class: 'board' });
    var head = el('tr');
    [['#', 'rank'], ['Protocol', 'name'], ['Category', 'category'], ['Chains', 'chains'], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Implied value', 'implied']].forEach(function (col) {
      var th = el('th', { text: col[0] + (state.sort === col[1] ? (state.dir === 1 ? ' ▲' : ' ▼') : ''), onclick: function () {
        if (state.sort === col[1]) state.dir = -state.dir; else { state.sort = col[1]; state.dir = col[1] === 'name' ? 1 : -1; }
        state.page = 1; writeHash(); render();
      } });
      if (col[1] === 'tvl' || col[1] === 'growth' || col[1] === 'age' || col[1] === 'implied') th.className = 'num';
      if (state.sort === col[1]) th.className += ' sorted';
      head.appendChild(th);
    });
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    slice.forEach(function (r) {
      var chg = r.change_7d;
      var row = el('tr', { onclick: function () { state.detail = r.slug; writeHash(); render(); window.scrollTo(0, 0); } },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', { html: esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') }),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (chg === null ? '' : chg >= 0 ? 'up' : 'down'), text: pct(chg) }),
        el('td', { class: 'num', text: ageFmt(r.age_days) }),
        el('td', { class: 'num imp', html: '<span class="bar" style="width:' + Math.max(2, Math.round(90 * r.implied_value_usd / maxImp)) + 'px"></span>' + esc(usd(r.implied_value_usd)) })
      );
      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    var pager = el('div', { class: 'pager' });
    pager.appendChild(el('button', { text: '← Previous', disabled: state.page <= 1 ? 'disabled' : null, onclick: function () { state.page--; writeHash(); render(); } }));
    pager.appendChild(el('span', { text: 'Page ' + state.page + ' of ' + pages }));
    pager.appendChild(el('button', { text: 'Next →', disabled: state.page >= pages ? 'disabled' : null, onclick: function () { state.page++; writeHash(); render(); } }));
    wrap.appendChild(pager);
  }

  function detailView(wrap, row) {
    var steps = row.farm_steps;
    var d = el('div', { class: 'detail' });
    d.appendChild(el('button', { class: 'back', text: '← Back to the board', onclick: function () { state.detail = null; writeHash(); render(); } }));
    d.appendChild(el('h2', { html: esc(row.name) + (row.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') }));
    d.appendChild(el('p', { class: 'sub', text: 'Rank #' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'Other') + ' · ' + row.chains.join(', ') + ' · Records no token in the snapshot.' }));
    d.appendChild(el('div', { class: 'big', html: esc(usd(row.implied_value_usd)) + ' <small>implied value — this entry\'s own claim</small>' }));
    var kv = el('div', { class: 'kv' });
    var peerLabel = row.peer_source === 'category peers'
      ? row.peer_multiple.toFixed(2) + '× · median of ' + row.peer_n + ' live peers'
      : row.peer_multiple.toFixed(2) + '× · overall median of ' + DATA.overall_peer_n + ' live protocols';
    [['TVL', usd(row.tvl_usd)], ['7-day change', pct(row.change_7d)], ['Age since listing', ageFmt(row.age_days)], ['Peer multiple', peerLabel]].forEach(function (pair) {
      kv.appendChild(el('div', {}, el('div', { class: 'k', text: pair[0] }), el('div', { class: 'v', text: pair[1] })));
    });
    d.appendChild(kv);
    d.appendChild(el('h2', { class: 'sec', text: 'How the value is built' }));
    var m = el('table', { class: 'model' });
    m.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Step' }), el('th', { class: 'num', text: 'Figure' }), el('th', { text: 'Where it comes from' }))));
    var mb = el('tbody');
    [
      ['TVL', usd(row.tvl_usd), 'Snapshot, ' + DATA.as_of],
      ['× Peer multiple (' + (row.category || 'Other') + ')', row.peer_multiple.toFixed(2) + '×', row.peer_source === 'category peers' ? 'Median market-cap / TVL of ' + row.peer_n + ' live-token protocols in this category' : 'Overall live median of ' + DATA.overall_peer_n + ' live protocols in categories the board can rank — too few live peers in this category'],
      ['× Growth multiplier', row.growth_multiplier.toFixed(2) + '×', '7-day TVL change ' + pct(row.change_7d) + ', clamped to −60%…+120%'],
      ['× Maturity multiplier', row.maturity_multiplier.toFixed(2) + '×', 'Age ' + ageFmt(row.age_days) + ' on a 0.60–1.00 scale over 3 years'],
      ['× Chain multiplier', row.chain_multiplier.toFixed(2) + '×', row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' counted']
    ].forEach(function (r) { mb.appendChild(el('tr', {}, el('td', { text: r[0] }), el('td', { class: 'num', text: r[1] }), el('td', { text: r[2] }))); });
    mb.appendChild(el('tr', { class: 'total' }, el('td', { text: '= Implied value' }), el('td', { class: 'num', text: usd(row.implied_value_usd) }), el('td', { text: 'Rounded to whole dollars' })));
    m.appendChild(mb);
    d.appendChild(m);
    d.appendChild(el('h2', { class: 'sec', text: 'How to farm it' }));
    var ol = el('ol', { class: 'farm' });
    steps.forEach(function (s, i) {
      var li = el('li', { html: esc(s) });
      if (i === steps.length - 1) li.className = 'risk';
      ol.appendChild(li);
    });
    d.appendChild(ol);
    d.appendChild(el('div', { class: 'note', text: '“Records no token” means the snapshot\'s DefiLlama record carries no market cap, CoinGecko id or symbol for this protocol. It is not proof the protocol has no token. A token may never be issued, and farming is not a promise of an airdrop.' }));
    wrap.appendChild(d);
  }

  function modelSection(wrap) {
    wrap.appendChild(el('h2', { class: 'sec', text: 'The model: priced off live peers, not a flat rate' }));
    wrap.appendChild(el('p', { class: 'lede', text: 'Implied value = TVL × peer multiple × growth × maturity × chains. The peer multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category, read off this very snapshot — a lending protocol is priced like lending protocols that already trade, a DEX like DEXs that already trade. Categories with fewer than 3 live peers fall back to the overall live median of ' + DATA.overall_peer_multiple.toFixed(2) + '×, taken over ' + DATA.overall_peer_n + ' live protocols in categories the board can rank. No protocol name is ever special-cased.' }));
    var cols = el('div', { class: 'cols' });
    var left = el('div');
    left.appendChild(el('h2', { class: 'sec', text: 'Peer multiples by category' }));
    var t = el('table', { class: 'plain' });
    t.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Multiple' }), el('th', { class: 'num', text: 'Live peers' }), el('th', { text: 'Source' }))));
    var tb = el('tbody');
    DATA.peers.forEach(function (p) {
      tb.appendChild(el('tr', {}, el('td', { text: p.category }), el('td', { class: 'num', text: p.multiple.toFixed(2) + '×' }), el('td', { class: 'num', text: String(p.n) }), el('td', { text: p.source })));
    });
    tb.appendChild(el('tr', { class: 'total' }, el('td', { text: 'Overall — the fallback' }), el('td', { class: 'num', text: DATA.overall_peer_multiple.toFixed(2) + '×' }), el('td', { class: 'num', text: String(DATA.overall_peer_n) }), el('td', { text: 'overall fallback' })));
    t.appendChild(tb);
    left.appendChild(t);
    var right = el('div');
    right.appendChild(el('h2', { class: 'sec', text: 'What the board leaves out, and why' }));
    right.appendChild(el('p', { html: 'The board holds <b>' + DATA.board_size + '</b> rows: the <b>' + DATA.watchlist_size + '</b> watchlist protocols plus <b>' + DATA.early_size + '</b> rankable protocols below the $50M floor. Every row passes the same exclusion rule the house used for the watchlist — no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX category, no whole word wrapped / staked / staking in the name, no version marker, no exchange prefix. That is what keeps WBTC, Binance staked ETH, USDT0 and other wrapped or staked products of tokens that already trade off the board. Protocols above the floor that the watchlist leaves out are left out too: the snapshot carries no parent-protocol field, so the rule cannot be re-checked for them, and the board does not guess.' }));
    right.appendChild(el('p', { html: 'The watchlist is a floor, never a ceiling: the early rows below it are the ones this radar exists to find.' }));
    cols.appendChild(left);
    cols.appendChild(right);
    wrap.appendChild(cols);
  }

  function liveSection(wrap) {
    wrap.appendChild(el('h2', { class: 'sec', text: 'Live tokens, kept apart' }));
    wrap.appendChild(el('p', { class: 'lede', text: 'These protocols already have a token that trades, so the board shows the market\'s own value for them — never a model\'s guess — and never mixes them into the ranking. They are also the peers the multiples above are priced from.' }));
    var t = el('table', { class: 'plain' });
    t.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'FDV / TVL' }))));
    var tb = el('tbody');
    DATA.live.forEach(function (p) {
      tb.appendChild(el('tr', {}, el('td', { text: p.name }), el('td', { text: p.category || 'Other' }), el('td', { class: 'num', text: usd(p.mcap_usd) }), el('td', { class: 'num', text: usd(p.tvl_usd) }), el('td', { class: 'num', text: p.fdv_tvl === null ? 'n/a' : p.fdv_tvl.toFixed(2) + '×' })));
    });
    t.appendChild(tb);
    wrap.appendChild(t);
  }

  function render() {
    state = readHash();
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    header(wrap);
    if (state.detail) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.detail) row = r; });
      if (row) { detailView(wrap, row); }
      else { wrap.appendChild(el('p', { text: 'No protocol with that slug is on the board.' })); }
      wrap.appendChild(el('footer', { html: 'Token Radar · model ' + esc(DATA.model_version) + ' · Snapshot ' + esc(DATA.as_of) + ' · Source: DefiLlama. Implied values are this entry\'s own claim.' }));
      app.appendChild(wrap);
      return;
    }
    stats(wrap);
    topFive(wrap);
    var list = filteredRows();
    controls(wrap, list);
    boardTable(wrap, list);
    modelSection(wrap);
    liveSection(wrap);
    wrap.appendChild(el('footer', { html: 'Token Radar · model ' + esc(DATA.model_version) + ' · Snapshot ' + esc(DATA.as_of) + ' · Source: DefiLlama (api.llama.fi/protocols). Implied values are this entry\'s own claim, never a promise that a token will be issued or what it will be worth. Farming can lose money; only farm what you can afford to lose.' }));
    app.appendChild(wrap);
  }

  window.addEventListener('hashchange', render);
  render();
})();
