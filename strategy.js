// Example strategy shared by the page and the build script (same code both places).
// Rule "9/21 MA cross, ATR exits": go long at the next open after the 9-day average closes above the 21-day.
// Stop = entry - 1.5 x ATR(14). Target = entry + 3 x ATR(14). Also exit at the next open if the 9-day closes back below.
(function (root) {
  function sma(vals, n) { const out = []; let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; out.push(i >= n - 1 ? s / n : null); } return out; }
  function atr(c, n) { const tr = c.map((b, i) => i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close))); const out = []; let a = null; for (let i = 0; i < tr.length; i++) { if (i === n - 1) a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n; else if (i >= n) a = (a * (n - 1) + tr[i]) / n; out.push(i >= n - 1 ? a : null); } return out; }
  function backtest(c, opt) {
    opt = Object.assign({ fast: 9, slow: 21, atrN: 14, stopX: 1.5, targetX: 3 }, opt || {});
    const cl = c.map(b => b.close), f = sma(cl, opt.fast), s = sma(cl, opt.slow), a = atr(c, opt.atrN);
    const trades = []; let pos = null; let equity = 1; const curve = [];
    for (let i = 1; i < c.length; i++) {
      if (pos) {
        const b = c[i]; let exit = null, why = '';
        if (b.open <= pos.stop) { exit = b.open; why = 'stop'; }
        else if (b.open >= pos.target) { exit = b.open; why = 'target'; }
        else if (b.low <= pos.stop) { exit = pos.stop; why = 'stop'; }
        else if (b.high >= pos.target) { exit = pos.target; why = 'target'; }
        else if (pos.crossDown) { exit = b.open; why = 'cross back'; }
        if (exit != null) { const r = exit / pos.entry - 1; equity *= 1 + r; trades.push({ in: pos.date, out: b.time, entry: pos.entry, exit: +exit.toFixed(2), ret: r, why }); pos = null; }
        else if (f[i] != null && f[i] < s[i]) pos.crossDown = true;
      }
      if (!pos && f[i - 1] != null && s[i - 1] != null && f[i - 1] > s[i - 1] && f[i - 2] != null && f[i - 2] <= s[i - 2] && a[i - 1] != null) {
        const e = c[i].open; pos = { date: c[i].time, entry: e, stop: e - opt.stopX * a[i - 1], target: e + opt.targetX * a[i - 1] };
      }
      curve.push({ time: c[i].time, value: +(equity * (pos ? c[i].close / pos.entry : 1) * 100).toFixed(2) });
    }
    const wins = trades.filter(t => t.ret > 0).length;
    const last = c.length - 1;
    const bull = f[last] > s[last];
    const entry = c[last].close;
    return { opt, trades, wins, winRate: trades.length ? wins / trades.length : 0, totalReturn: equity - 1, curve, from: c[opt.slow].time, to: c[last].time, open: pos,
      now: { bull, entry, stop: entry - opt.stopX * a[last], target: entry + opt.targetX * a[last], atr: a[last], fast: f[last], slow: s[last] } };
  }
  const api = { sma, atr, backtest };
  root.Strategy = api;
})(typeof window !== "undefined" ? window : globalThis);
