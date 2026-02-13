// options.js
// Singleton helper for option tickers, reduce/flip bookkeeping, rPNL, and simple valuation.
// No state stored; singleton export for convenience.

class OptionsEngine {
  // "series-expiry-(C|P)-strike?"
  isOptionTicker(t) {
    return typeof t === 'string' && /^.+?-\d+-(C|P)(-\d+(\.\d+)?)?$/.test(t);
  }

  parseTicker(t) {
    if (!t || typeof t !== 'string') return null;
    const parts = t.split('-');
    if (parts.length < 3) return null;
    const seriesId = parts[0];
    const expiryBlock = parseInt(parts[1], 10);
    const cp = parts[2];
    const type = cp === 'C' ? 'Call' : (cp === 'P' ? 'Put' : null);
    const strike = parts[3] ? parseFloat(parts[3]) : null;
    if (!seriesId || Number.isNaN(expiryBlock) || !type) return null;
    return { seriesId, expiryBlock, type, strike, raw: t };
  }

  /**
   * Given existing signed qty and a signed delta, compute how much is closing vs flipping.
   * existing >0 long, <0 short. delta >0 buy, <0 sell.
   */
  computeReduceFlip(existingQty, deltaQty) {
    const ex = Number(existingQty) || 0;
    const d  = Number(deltaQty)    || 0;
    const after = ex + d;

    const exSide = ex > 0 ? 'LONG' : ex < 0 ? 'SHORT' : null;
    const dSide  = d  > 0 ? 'LONG' : d  < 0 ? 'SHORT' : null;

    let closedQty = 0;
    let flipQty = 0;

    if (ex !== 0 && d !== 0 && Math.sign(ex) !== Math.sign(d)) {
      closedQty = Math.min(Math.abs(ex), Math.abs(d));
      if (Math.abs(d) > Math.abs(ex)) {
        flipQty = Math.abs(d) - Math.abs(ex);
      }
    }

    const afterSide = after > 0 ? 'LONG' : after < 0 ? 'SHORT' : null;

    return { existing: ex, delta: d, after, exSide, dSide, afterSide, closedQty, flipQty };
  }

  /**
   * Realized PnL when reducing an option position.
   * Long reduce: (trade - avg) * qty
   * Short reduce: (avg - trade) * qty
   */
  rpnlForClose(exSide, closedQty, tradePrice, avgPrice) {
    const q = Number(closedQty)   || 0;
    const p = Number(tradePrice)  || 0;
    const a = Number(avgPrice)    || 0;
    if (!q || !exSide) return 0;
    return exSide === 'LONG' ? (p - a) * q : (a - p) * q;
  }

  /**
   * Intrinsic value at spot S (European payoff at mark).
   */
  intrinsic(type, K, S) {
    const k = Number(K) || 0;
    const s = Number(S) || 0;
    if (type === 'Call') return Math.max(0, s - k);
    return Math.max(0, k - s);
  }

  /**
   * Very light EU price proxy using Bachelier (normal) to avoid heavy math deps:
   * price ≈ intrinsic + v * sqrt(T) * phi(0)   (with a tiny convexity tweak)
   * where v = vol (in price units), T in years.
   * If you store a per-series vol index σ_annual (as decimal), you can use
   * a Bachelier-like proxy with v = σ_annual * S for calls; puts symmetric.
   * If vol is missing, fallback to intrinsic.
   */
  priceEUApprox(type, S, K, volAnnual, daysToExpiry) {
    const s = Number(S) || 0;
    const k = Number(K) || 0;
    const T = Math.max(0, Number(daysToExpiry || 0)) / 365;
    const iv = this.intrinsic(type, k, s);
    if (!volAnnual || !T) return iv;

    const sigma = Number(volAnnual);          // if you store as decimal (e.g. 0.6)
    const v = sigma * s;                      // price vol in Bachelier
    const noise = v * Math.sqrt(T) * 0.3989;  // ≈ φ(0) ~ 0.3989
    // keep it conservative: intrinsic plus a slice of noise
    return Math.max(iv, iv + noise);
  }

  /**
   * Maintenance for *naked* shorts (10x leverage padding, your rule of thumb).
   * Use strike/10 as generic notional for puts, and S/10 for calls (conservative).
   * You can tune this per-series if you store policy on the registry.
   */
  nakedMaintenance(type, K, S) {
    if (type === 'Call') return (Number(S) || 0) / 10; // ~10x leverage on spot notional
    return (Number(K) || 0) / 10;                      // puts on strike notional
  }

  /**
   * Mark-to-model exposure for a set of option positions (for liquidation offsets).
   * positions: [{ type:'Call'|'Put', strike, qty (signed), avgPrice?, expiryBlock }]
   * Returns total premium value (signed) at current S, using vol index and time.
   */
  mtmExposure(positions, S, volAnnual, blocksToExpiry, blocksPerDay) {
    const bpd = Math.max(1, Number(blocksPerDay || 144)); // default ~ Bitcoin-like
    const days = Math.max(0, Number(blocksToExpiry || 0) / bpd);
    let prem = 0, intr = 0;
    for (const p of (positions || [])) {
      const price = this.priceEUApprox(p.type, S, p.strike, volAnnual, days);
      prem += price * (Number(p.qty) || 0);
      intr += this.intrinsic(p.type, p.strike, S) * (Number(p.qty) || 0);
    }
    return { premium: prem, intrinsic: intr };
  }

  /**
   * Portfolio-style maintenance for an option set under one series.
   * - Baseline: 10% naked maintenance for shorts (existing rule)
   * - Offsets: vertical spread coverage reduces short maintenance by wing width/10
   *   for covered quantity at same expiry/type.
   *
   * positions: [{ type:'Call'|'Put', strike:number, qty:number, expiryBlock:number }]
   */
  portfolioMaintenance(positions, spot) {
    const byKey = new Map();
    for (const p of (positions || [])) {
      const type = p?.type;
      const expiry = Number(p?.expiryBlock || 0);
      if (!type) continue;
      const k = `${type}:${expiry}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({
        type,
        expiryBlock: expiry,
        strike: Number(p?.strike || 0),
        qty: Number(p?.qty || 0)
      });
    }

    let total = 0;

    for (const legs of byKey.values()) {
      const shorts = legs.filter((x) => x.qty < 0).map((x) => ({ ...x, rem: Math.abs(x.qty) }));
      const longs = legs.filter((x) => x.qty > 0).map((x) => ({ ...x, rem: x.qty }));

      // Naked base
      for (const s of shorts) {
        total += this.nakedMaintenance(s.type, s.strike, spot) * s.rem;
      }

      // Vertical offsets
      for (const s of shorts) {
        for (const l of longs) {
          if (s.rem <= 0 || l.rem <= 0) continue;
          if (s.type !== l.type) continue;
          // Protective wing direction:
          // - short Call protected by higher-strike long Call
          // - short Put protected by lower-strike long Put
          const protective =
            (s.type === 'Call' && l.strike > s.strike) ||
            (s.type === 'Put' && l.strike < s.strike);
          if (!protective) continue;

          const coveredQty = Math.min(s.rem, l.rem);
          const width = Math.abs(l.strike - s.strike);
          const offset = (width / 10) * coveredQty;

          total -= Math.min(
            offset,
            this.nakedMaintenance(s.type, s.strike, spot) * coveredQty
          );
          s.rem -= coveredQty;
          l.rem -= coveredQty;
        }
      }
    }

    return Math.max(0, total);
  }
}

// Export as a singleton instance.
const Options = new OptionsEngine();
module.exports = Options;
