/* Trading Desk demo: live crypto from Binance's public market-data host (Coinbase Exchange as fallback),
   daily stock candles baked from Yahoo Finance at build time, three bots (scanner, recommender, backtester),
   a profile + disclaimer entry screen and a settings page saved in localStorage. */
(function () {
  const LC = window.LightweightCharts, S = window.Strategy;
  const $ = (id) => document.getElementById(id);
  const BIN = 'https://data-api.binance.vision/api/v3', BIN_WS = 'wss://data-stream.binance.vision/ws/';
  const CB = 'https://api.exchange.coinbase.com';
  const CRYPTO = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' };
  const SCAN_CRYPTO = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'LTC', 'BNB', 'SUI', 'TRX', 'DOT', 'PEPE'];
  const ET = { timeZone: 'America/New_York' };
  const state = { stocks: null, cSym: 'BTC', sSym: 'SPY', ws: null, cSeries: null, feed: 'binance', scan: 'crypto', crypto24: [], recSym: 'MSFT', btcHourly: null };

  // ---------- formatting (tabular, signed, like a broker screen) ----------
  const fmt = (v, d) => { if (v == null || isNaN(v)) return '-'; if (d == null) d = Math.abs(v) >= 1 ? 2 : (Math.abs(v) >= 0.01 ? 4 : 8);
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const pct = (v, d = 2) => (v > 0 ? '+' : '') + fmt(v, d) + '%';
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const big = (v) => v >= 1e9 ? fmt(v / 1e9, 1) + 'B' : v >= 1e6 ? fmt(v / 1e6, 1) + 'M' : v >= 1e3 ? fmt(v / 1e3, 0) + 'K' : fmt(v, 0);
  const dayLabel = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const shortDay = (t) => typeof t === 'number' ? new Date(t * 1000).toLocaleString('en-US', Object.assign({ month: 'short', day: 'numeric', hour: 'numeric' }, ET))
    : new Date(t + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });

  // ---------- storage ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const DEFAULTS = { favs: ['SPY', 'AAPL', 'TSLA', 'NVDA', 'BTC'], cats: { risers: true, penny: true, crypto: true, volume: false, news: false, options: false },
    tg: true, tgUser: '', dc: false, dcUser: '', freq: 'instant', risk: 'Balanced' };
  const CATS = [['risers', 'Highest risers'], ['penny', 'Penny stocks on the rise'], ['crypto', 'Crypto movers'], ['volume', 'Volume spikes'], ['news', 'Market news'], ['options', 'Options ideas']];
  let settings = Object.assign({}, DEFAULTS, load('td.settings', {}));

  // ---------- charts ----------
  function makeChart(el, opts) {
    return LC.createChart(el, Object.assign({ autoSize: true,
      layout: { background: { type: 'solid', color: '#121419' }, textColor: 'rgba(232,234,237,.6)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,.04)' }, horzLines: { color: 'rgba(255,255,255,.04)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.08)' }, timeScale: { borderColor: 'rgba(255,255,255,.08)' },
      crosshair: { mode: 0 } }, opts || {}));
  }
  const etTick = (t) => typeof t === 'number' ? new Date(t * 1000).toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, ET)).replace(' AM', 'a').replace(' PM', 'p') : null;
  const etFull = (t) => typeof t === 'number' ? new Date(t * 1000).toLocaleString('en-US', Object.assign({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, ET)) + ' ET' : t;
  const candleOpts = { upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' };

  // ---------- live crypto ----------
  let cChart, cSeries;
  function setLive(on, txt) { const l = document.querySelector('.live'); l.classList.toggle('on', on); $('liveTxt').textContent = txt; }
  async function loadCrypto(sym) {
    state.cSym = sym; if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
    clearInterval(state.poll);
    if (!cChart) { cChart = makeChart($('cChart'), { localization: { timeFormatter: etFull }, timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,.08)', tickMarkFormatter: (t) => etTick(t) } }); cSeries = cChart.addCandlestickSeries(candleOpts); }
    try {
      const k = await (await fetch(`${BIN}/klines?symbol=${CRYPTO[sym]}&interval=1m&limit=240`)).json();
      if (!Array.isArray(k)) throw new Error('bad');
      const bars = k.map(x => ({ time: Math.floor(x[0] / 1000), open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
      cSeries.setData(bars); cChart.timeScale().fitContent(); state.feed = 'binance';
      $('cSym').textContent = sym + ' / USDT'; $('cSrc').textContent = '1-minute candles, streaming live from Binance public market data';
      showCryptoQuote(bars.at(-1).close);
      const ws = new WebSocket(BIN_WS + CRYPTO[sym].toLowerCase() + '@kline_1m'); state.ws = ws;
      ws.onopen = () => setLive(true, 'Live');
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data).k; if (!m || state.cSym !== sym) return;
        const bar = { time: Math.floor(m.t / 1000), open: +m.o, high: +m.h, low: +m.l, close: +m.c }; cSeries.update(bar); showCryptoQuote(bar.close); state.ticks = (state.ticks || 0) + 1; window.__ticks = state.ticks; };
      ws.onerror = () => fallbackPoll(sym);
    } catch (e) { await coinbase(sym); }
  }
  async function fallbackPoll(sym) { if (state.cSym !== sym) return; await coinbase(sym); }
  async function coinbase(sym) { // Coinbase Exchange public candles, polled every 5 s
    const pull = async () => { const k = await (await fetch(`${CB}/products/${sym}-USD/candles?granularity=60`)).json();
      const bars = k.map(x => ({ time: x[0], low: x[1], high: x[2], open: x[3], close: x[4] })).reverse().slice(-240);
      cSeries.setData(bars); showCryptoQuote(bars.at(-1).close); window.__ticks = (window.__ticks || 0) + 1; };
    try { await pull(); cChart.timeScale().fitContent(); state.feed = 'coinbase'; $('cSym').textContent = sym + '-USD';
      $('cSrc').textContent = '1-minute candles from Coinbase Exchange, refreshed every 5 seconds'; setLive(true, 'Live');
      state.poll = setInterval(() => pull().catch(() => setLive(false, 'Reconnecting')), 5000);
    } catch (e) { setLive(false, 'Feed offline'); }
  }
  function showCryptoQuote(px) {
    $('cPx').textContent = fmt(px);
    const t = state.crypto24.find(x => x.sym === state.cSym);
    if (t) { const ch = (px / t.open - 1) * 100; $('cChg').textContent = pct(ch) + ' 24h'; $('cChg').className = 'chg mono ' + cls(ch);
      $('cHL').textContent = 'H ' + fmt(t.high) + '  L ' + fmt(t.low) + '  Vol $' + big(t.quoteVol); }
    document.title = state.cSym + ' ' + fmt(px) + ' | Trading Desk';
  }
  async function loadCrypto24() {
    try { const syms = encodeURIComponent(JSON.stringify(SCAN_CRYPTO.map(s => s + 'USDT')));
      const r = await (await fetch(`${BIN}/ticker/24hr?symbols=${syms}`)).json();
      state.crypto24 = r.map(x => ({ sym: x.symbol.replace('USDT', ''), last: +x.lastPrice, chg: +x.priceChangePercent, open: +x.openPrice, high: +x.highPrice, low: +x.lowPrice, quoteVol: +x.quoteVolume }));
      state.scanAt = new Date();
    } catch (e) { state.crypto24 = []; }
    if (state.scan === 'crypto') renderScan();
  }

  // ---------- stocks (baked daily candles) ----------
  let sChart, sSeries, sF, sS;
  function renderStock(sym) {
    state.sSym = sym; const c = state.stocks.tickers[sym].candles;
    if (!sChart) { sChart = makeChart($('sChart')); sSeries = sChart.addCandlestickSeries(candleOpts);
      sF = sChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      sS = sChart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); }
    const view = c.slice(-180); sSeries.setData(view);
    const f = S.sma(c.map(b => b.close), 9), s = S.sma(c.map(b => b.close), 21), off = c.length - view.length;
    sF.setData(view.map((b, i) => ({ time: b.time, value: f[i + off] })).filter(p => p.value != null));
    sS.setData(view.map((b, i) => ({ time: b.time, value: s[i + off] })).filter(p => p.value != null));
    sChart.timeScale().fitContent();
    const last = c.at(-1), prev = c.at(-2), ch = (last.close / prev.close - 1) * 100;
    $('sSym').textContent = sym; $('sPx').textContent = fmt(last.close); $('sChg').textContent = pct(ch) + ' on the day'; $('sChg').className = 'chg mono ' + cls(ch);
  }

  // ---------- scanner bot ----------
  function stockRows() {
    return Object.entries(state.stocks.tickers).map(([t, v]) => { const c = v.candles, l = c.at(-1), p = c.at(-2);
      const avgVol = c.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20;
      return { t, name: v.name, px: l.close, chg: (l.close / p.close - 1) * 100, volX: l.volume / avgVol, dollarVol: l.close * l.volume,
        chg5: (l.close / c.at(-6).close - 1) * 100 }; });
  }
  function renderScan() {
    const k = state.scan, tbl = $('scanTbl'), note = $('scanNote'); let rows = [], head = '';
    if (k === 'crypto') {
      rows = [...state.crypto24].sort((a, b) => b.chg - a.chg).slice(0, 8);
      head = '<tr><th>Coin</th><th>Price</th><th>24h</th><th>24h vol</th></tr>';
      tbl.innerHTML = head + rows.map(r => `<tr><td class="tk">${r.sym}</td><td class="n">${fmt(r.last)}</td><td class="n ${cls(r.chg)}">${pct(r.chg)}</td><td class="n">$${big(r.quoteVol)}</td></tr>`).join('');
      $('scanSub').textContent = 'Top 24h movers of ' + SCAN_CRYPTO.length + ' coins, rescans every 30 s';
      note.textContent = state.scanAt ? 'Last scan ' + state.scanAt.toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit', second: '2-digit' }, ET)) + ' ET from Binance public market data.' : '';
      return;
    }
    const all = stockRows(); const asOf = dayLabel(state.stocks.asOf);
    if (k === 'risers') { rows = all.sort((a, b) => b.chg - a.chg).slice(0, 8); $('scanSub').textContent = 'Highest risers, last full session';
      note.textContent = 'Watchlist of ' + all.length + ' stocks, daily close ' + asOf + '.'; }
    if (k === 'penny') { rows = all.filter(r => r.px < 5).sort((a, b) => b.chg5 - a.chg5).slice(0, 8); $('scanSub').textContent = 'Under $5 and moving, ranked by 5-day change';
      note.textContent = 'Penny-stock screen on the same watchlist, daily close ' + asOf + '.'; }
    if (k === 'volume') { rows = all.sort((a, b) => b.volX - a.volX).slice(0, 8); $('scanSub').textContent = 'Volume vs its 20-day average';
      note.textContent = 'A spike = 3x normal volume with at least $5M traded. Daily close ' + asOf + '.'; }
    head = k === 'volume' ? '<tr><th>Ticker</th><th>Close</th><th>Day</th><th>Vol x</th></tr>' : k === 'penny' ? '<tr><th>Ticker</th><th>Close</th><th>Day</th><th>5-day</th></tr>' : '<tr><th>Ticker</th><th>Close</th><th>Day</th><th>$ vol</th></tr>';
    tbl.innerHTML = head + rows.map(r => `<tr><td><span class="tk">${r.t}</span><span class="nm">${r.name}</span></td><td class="n">${fmt(r.px)}</td><td class="n ${cls(r.chg)}">${pct(r.chg)}</td>` +
      (k === 'volume' ? `<td class="n ${r.volX >= 3 && r.dollarVol >= 5e6 ? 'up' : ''}">${fmt(r.volX, 1)}x</td>` : k === 'penny' ? `<td class="n ${cls(r.chg5)}">${pct(r.chg5, 1)}</td>` : `<td class="n">$${big(r.dollarVol)}</td>`) + '</tr>').join('');
  }

  // ---------- recommender + backtester bots (same example rule) ----------
  let btChart, btLine;
  async function candlesFor(sym) {
    if (sym !== 'BTC') return state.stocks.tickers[sym].candles;
    if (!state.btcHourly) { const k = await (await fetch(`${BIN}/klines?symbol=BTCUSDT&interval=1h&limit=1000`)).json();
      state.btcHourly = k.map(x => ({ time: Math.floor(x[0] / 1000), open: +x[1], high: +x[2], low: +x[3], close: +x[4] })); }
    return state.btcHourly;
  }
  async function renderRec() {
    const sym = state.recSym; const c = await candlesFor(sym); const r = S.backtest(c); const n = r.now;
    const isBtc = sym === 'BTC', unit = isBtc ? 'hour' : 'day', period = isBtc ? shortDay(r.from) + ' to ' + shortDay(r.to) + ' ET' : dayLabel(r.from).replace(/^\w+, /, '') + ' to ' + dayLabel(r.to).replace(/^\w+, /, '');
    const rr = (n.target - n.entry) / (n.entry - n.stop);
    const since = r.open ? (isBtc ? shortDay(r.open.date) : dayLabel(r.open.date)) : null;
    $('recBody').innerHTML = (n.bull
      ? `<div class="sig long">Long setup on ${sym}${since ? ', signal fired ' + since : ''}</div>`
      : `<div class="sig flat">No long setup on ${sym} right now. Waiting for the 9-${unit} average to cross back above the 21-${unit}.</div>`) +
      `<div class="nums"><div class="num"><div class="k">Entry</div><div class="v">${fmt(n.entry)}</div></div><div class="num"><div class="k">Stop</div><div class="v down">${fmt(n.stop)}</div></div><div class="num"><div class="k">Target</div><div class="v up">${fmt(n.target)}</div></div></div>` +
      `<div class="kv"><span>Trade type</span><span>${n.bull ? (isBtc ? 'Long spot, intraday to a few days' : 'Swing long: shares, or a call 30+ days out') : 'Stand aside'}</span></div>` +
      `<div class="kv"><span>Win rate (backtest)</span><span><span class="wr">${fmt(r.winRate * 100, 1)}%</span> &middot; ${r.wins} of ${r.trades.length} trades</span></div>` +
      `<div class="kv"><span>Reward to risk</span><span class="mono">${fmt(rr, 1)} : 1</span></div>` +
      `<div class="kv"><span>Strategy</span><span>9/21 MA cross, ATR stop and target (example)</span></div>` +
      `<div class="size"><label>Account $<input id="acct" value="10000" inputmode="numeric"></label><label>Risk per trade %<input id="riskPct" value="1" inputmode="decimal"></label><div><div class="sub" style="margin:0 0 4px">Position size</div><div class="out" id="sizeOut"></div></div></div>`;
    const calc = () => { const a = +$('acct').value || 0, p = +$('riskPct').value || 0, per = n.entry - n.stop; const q = per > 0 ? (a * p / 100) / per : 0;
      $('sizeOut').textContent = isBtc ? fmt(q, 4) + ' BTC' : Math.floor(q) + ' shares'; };
    $('acct').oninput = calc; $('riskPct').oninput = calc; calc();

    // backtester
    $('btSub').textContent = `${sym}, ${isBtc ? 'hourly' : 'daily'} candles, ${period}. Example rule: buy when the 9-${unit} average closes above the 21-${unit}. Stop 1.5 ATR, target 3 ATR, or out when it crosses back.`;
    $('btKpis').innerHTML = `<div><span>Trades</span><b>${r.trades.length}</b></div><div><span>Wins</span><b>${r.wins}</b></div><div><span>Win rate</span><b>${fmt(r.winRate * 100, 1)}%</b></div><div><span>Return</span><b class="${cls(r.totalReturn)}">${pct(r.totalReturn * 100, 1)}</b></div>`;
    if (!btChart) { btChart = makeChart($('btChart'), { timeScale: { timeVisible: isBtc, borderColor: 'rgba(255,255,255,.08)' } });
      btLine = btChart.addAreaSeries({ lineColor: '#3b82f6', topColor: 'rgba(59,130,246,.25)', bottomColor: 'rgba(59,130,246,0)', lineWidth: 2, priceLineVisible: false }); }
    btChart.applyOptions({ timeScale: { timeVisible: isBtc } });
    btLine.setData(r.curve); btChart.timeScale().fitContent();
    const last = r.trades.slice(-6).reverse();
    $('btTbl').innerHTML = '<tr><th>In</th><th>Out</th><th>Entry</th><th>Exit</th><th>Result</th><th>Exit on</th></tr>' +
      last.map(t => `<tr><td>${shortDay(t.in)}</td><td>${shortDay(t.out)}</td><td class="n">${fmt(t.entry)}</td><td class="n">${fmt(t.exit)}</td><td class="n ${cls(t.ret)}">${pct(t.ret * 100, 1)}</td><td class="why">${t.why}</td></tr>`).join('');
    state.lastRec = { sym, r };
    renderAlerts();
  }

  // ---------- alerts preview ----------
  function renderAlerts() {
    const s = settings, rec = state.lastRec; const chans = [s.tg && 'Telegram', s.dc && 'Discord'].filter(Boolean);
    const freqTxt = { instant: 'as it happens', hourly: 'hourly digest', open: 'once at the open', close: 'once after the close' }[s.freq];
    $('alertSub').textContent = chans.length ? 'Sending to ' + chans.join(' and ') + ', ' + freqTxt : 'Alerts are off. Turn on Telegram or Discord in Settings.';
    if (rec) { const n = rec.r.now; $('alertMsg').innerHTML = `<div class="from">Trading Desk bot</div>` +
      (n.bull ? `<b>${rec.sym} long setup</b><br>Entry ${fmt(n.entry)} &middot; Stop ${fmt(n.stop)} &middot; Target ${fmt(n.target)}<br>Example strategy win rate ${fmt(rec.r.winRate * 100, 1)}% over ${rec.r.trades.length} trades.`
        : `<b>${rec.sym}: no setup yet</b><br>You'll get a message when the 9 crosses above the 21.`) +
      `<div class="muted" style="font-size:11px;margin-top:4px">Information only, not financial advice.</div><div class="t">${new Date().toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, ET))}</div>`; }
    $('alertChips').innerHTML = s.favs.map(f => `<span class="chip">${f}</span>`).join('') + CATS.filter(([k]) => s.cats[k]).map(([, l]) => `<span class="chip on">${l}</span>`).join('');
  }

  // ---------- settings ----------
  function renderFavs() { $('favChips').innerHTML = settings.favs.map(f => `<span class="chip">${f}<button type="button" data-rm="${f}" aria-label="remove">&times;</button></span>`).join(''); }
  function renderSettings() {
    renderFavs();
    $('catToggles').innerHTML = CATS.map(([k, l]) => `<label class="tgl"><input type="checkbox" data-cat="${k}" ${settings.cats[k] ? 'checked' : ''}><span class="sw"></span>${l}</label>`).join('');
    $('tgOn').checked = settings.tg; $('tgUser').value = settings.tgUser; $('dcOn').checked = settings.dc; $('dcUser').value = settings.dcUser;
    $('freq').value = settings.freq; $('risk').value = settings.risk;
  }
  function wireSettings() {
    $('favChips').onclick = (e) => { const f = e.target.dataset.rm; if (f) { settings.favs = settings.favs.filter(x => x !== f); renderFavs(); } };
    const add = () => { const v = $('favIn').value.trim().toUpperCase().replace(/[^A-Z.\-]/g, ''); if (v && !settings.favs.includes(v)) settings.favs.push(v); $('favIn').value = ''; renderFavs(); };
    $('favAdd').onclick = add; $('favIn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    $('saveBtn').onclick = () => {
      document.querySelectorAll('[data-cat]').forEach(i => settings.cats[i.dataset.cat] = i.checked);
      Object.assign(settings, { tg: $('tgOn').checked, tgUser: $('tgUser').value.trim(), dc: $('dcOn').checked, dcUser: $('dcUser').value.trim(), freq: $('freq').value, risk: $('risk').value });
      save('td.settings', settings); renderAlerts(); $('savedMsg').hidden = false; setTimeout(() => $('savedMsg').hidden = true, 1800); };
    $('resetBtn').onclick = () => { localStorage.removeItem('td.profile'); location.hash = ''; location.reload(); };
  }

  // ---------- routing ----------
  function route() {
    const v = location.hash === '#settings' ? 'settings' : 'desk';
    $('view-desk').hidden = v !== 'desk'; $('view-settings').hidden = v !== 'settings';
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
    if (v === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  function seg(id, attr, fn) { $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset[attr]); }; }

  async function startDesk() {
    $('entry').hidden = true; $('app').hidden = false;
    const p = load('td.profile', null); $('who').textContent = p ? p.name : '';
    const tick = () => $('clock').textContent = new Date().toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit', second: '2-digit' }, ET)) + ' ET';
    tick(); setInterval(tick, 1000);
    route(); window.onhashchange = route; wireSettings();
    state.stocks = await (await fetch('data/stocks.json')).json();
    $('sAsOf').textContent = 'Daily candles from Yahoo Finance, as of the ' + dayLabel(state.stocks.asOf) + ' close';
    const sel = $('recSym'); sel.innerHTML = ['MSFT', 'AAPL', 'SPY', 'QQQ', 'TSLA', 'NVDA', 'AMD', 'META', 'AMZN', 'GOOGL', 'PLTR'].map(s => `<option>${s}</option>`).join('') + '<option value="BTC">BTC (hourly)</option>';
    sel.value = state.recSym; sel.onchange = () => { state.recSym = sel.value; renderRec(); };
    seg('cSeg', 's', loadCrypto); seg('sSeg', 's', renderStock); seg('scanSeg', 'k', (k) => { state.scan = k; renderScan(); });
    renderStock('SPY'); renderRec();
    await loadCrypto24(); loadCrypto('BTC'); setInterval(loadCrypto24, 30000);
  }

  // ---------- entry ----------
  function startEntry() {
    $('entry').hidden = false; $('app').hidden = true;
    const ok = () => $('pGo').disabled = !($('pAgree').checked && $('pName').value.trim());
    $('pAgree').onchange = ok; $('pName').oninput = ok;
    $('entryForm').onsubmit = (e) => { e.preventDefault(); save('td.profile', { name: $('pName').value.trim(), exp: $('pExp').value, market: $('pMarket').value, agreedAt: new Date().toISOString(),
      disclaimer: 'Nothing here is guaranteed. This is information, not financial advice.' }); startDesk(); };
  }

  if (load('td.profile', null)) startDesk(); else startEntry();
})();
