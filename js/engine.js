// 계산 엔진: 포트폴리오, 평행우주, 개입 점수, 헌법 검사, 서한/AI 데이터 팩
//
// 회계 가정(단순함을 위해 고정, UI에 명시):
//  - 평가액 = 그 시점 보유 주식 + 그 시점 현금. 현금은 사용자가 직접 입력한 값만 쓴다
//    (settings.cashLog). 매도 대금을 앱이 현금으로 추정하지 않는다 — 실제 계좌 잔액은
//    입출금·환전·이자 때문에 앱이 알 수 없고, 추정치를 자산에 얹으면 거짓말이 된다.
//  - 보유분 평가는 수정종가(배당·분할·병합 반영) 성장배수 × 매수원가. 즉 배당 재투자 가정.
//  - 달러 자산은 해당일 환율로 원화 환산.

import * as P from './prices.js';
import { addMonthsStr, addDaysStr, todayStr, daysBetween, quarterRange, prevQuarter, quarterOf, fmtMoney, fmtPct } from './util.js';

export function sortedTrades(state) {
  return [...state.trades].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt - b.createdAt));
}

function unitCost(buy) {
  return (buy.price * buy.qty + (buy.fee || 0)) / buy.qty;
}

// FIFO 재생: upto 날짜까지의 보유 lot과 실현 손익
export function replay(trades, upto = null) {
  const open = [];       // {t, qtyLeft}
  const realized = [];   // {sell, parts, costSum, proceeds, pnl, ret, holdDays}
  for (const t of trades) {
    if (upto && t.date > upto) break;
    if (t.side === 'buy') {
      open.push({ t, qtyLeft: t.qty });
    } else {
      let need = t.qty, costSum = 0, wDays = 0;
      const parts = [];
      for (const lot of open) {
        if (lot.t.symbol !== t.symbol || lot.qtyLeft <= 0) continue;
        const take = Math.min(need, lot.qtyLeft);
        lot.qtyLeft -= take; need -= take;
        costSum += unitCost(lot.t) * take;
        wDays += daysBetween(lot.t.date, t.date) * take;
        parts.push({ buy: lot.t, qty: take });
        if (need <= 0) break;
      }
      const matched = t.qty - need;
      const proceeds = t.price * t.qty - (t.fee || 0);
      realized.push({
        sell: t, parts, costSum, proceeds,
        pnl: proceeds - costSum,
        ret: costSum > 0 ? (proceeds - costSum) / costSum : null,
        holdDays: matched > 0 ? wDays / matched : null,
        oversold: need > 0.000001,
      });
    }
  }
  return { open: open.filter(l => l.qtyLeft > 0.000001), realized };
}

export function heldQty(state, symbol, date) {
  const { open } = replay(sortedTrades(state), date);
  return open.filter(l => l.t.symbol === symbol).reduce((s, l) => s + l.qtyLeft, 0);
}

// lot의 특정일 평가액(자기 통화). 시세 없으면 원가 유지.
function lotValue(lot, date) {
  const cost = unitCost(lot.t) * lot.qtyLeft;
  const g = P.growth(lot.t.symbol, lot.t.date, date);
  return { cur: P.currencyOf(lot.t.symbol), cost, value: g ? cost * g : cost, hasPrice: !!g };
}

// 통화별 순 투입 원금 = 밖에서 새로 끌어온 돈. 매수는 같은 통화의 앞선 매도 대금으로 먼저
// 충당한 것으로 보므로, 팔고 다시 사는 것이 원금을 부풀리지 않는다(재투자분 이중계상 방지).
//
// 여기 나오는 pool은 '재투자 가능한 매도 대금'을 추적하는 내부 장부일 뿐, 계좌의 현금 잔액이
// 아니다(사용자가 뺐을 수도, 더 넣었을 수도 있다). 자산으로 쓰지 말 것 — 현금은 cashOn()이 답한다.
// trades는 날짜순.
function capitalFlow(trades, upto) {
  const pool = { KRW: 0, USD: 0 };
  const netCap = { KRW: 0, USD: 0 };
  for (const t of trades) {
    if (t.date > upto) break;
    const cur = P.currencyOf(t.symbol);
    if (t.side === 'buy') {
      const cost = t.price * t.qty + (t.fee || 0);
      const fromPool = Math.min(pool[cur], cost);
      pool[cur] -= fromPool;
      netCap[cur] += cost - fromPool;
    } else {
      pool[cur] += t.price * t.qty - (t.fee || 0);
    }
  }
  return { pool, netCap };
}

// ---- 현금: 사용자가 직접 입력한 잔액 -------------------------------------------
// settings.cashLog = [{date, KRW, USD}] — 입력할 때마다 한 줄씩 쌓인다.
// 특정 시점의 현금 = 그 날짜 이하 마지막 입력값. 첫 입력 전에는 현금 0(= 주식만 합산).
export function cashLog(state) {
  return [...(state.settings?.cashLog || [])].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// 그 시점에 적용 중인 입력 한 줄 (없으면 null). 값이 언제 넣은 것인지 표시할 때도 쓴다.
export function cashEntryOn(state, date) {
  let cur = null;
  for (const e of cashLog(state)) {
    if (e.date > date) break;
    cur = e;
  }
  return cur;
}

export function cashOn(state, date) {
  const e = cashEntryOn(state, date);
  return { KRW: e?.KRW || 0, USD: e?.USD || 0 };
}

// 현금을 직접 입력하기 시작한 날 (이 날부터 현금이 평가액에 포함된다). 미입력이면 null.
export function cashSince(state) {
  return cashLog(state)[0]?.date || null;
}

// ---- 포트폴리오 ------------------------------------------------------------
export function portfolio(state, date = null) {
  const d = date || todayStr();
  const trades = sortedTrades(state);
  const { open, realized } = replay(trades, d);

  const bySym = new Map();
  for (const lot of open) {
    const v = lotValue(lot, d);
    const sym = lot.t.symbol;
    if (!bySym.has(sym)) bySym.set(sym, { symbol: sym, name: lot.t.name || sym, cur: v.cur, qty: 0, cost: 0, value: 0, firstBuy: lot.t.date, hasPrice: v.hasPrice });
    const r = bySym.get(sym);
    r.qty += lot.qtyLeft; r.cost += v.cost; r.value += v.value;
    if (lot.t.date < r.firstBuy) r.firstBuy = lot.t.date;
    r.hasPrice = r.hasPrice && v.hasPrice;
  }
  const rows = [...bySym.values()].map(r => ({
    ...r,
    valueKRW: P.toKRW(r.value, r.cur, d),
    ret: r.cost > 0 ? r.value / r.cost - 1 : null,
    lastClose: P.closeOn(r.symbol, d),
  }));
  const investedKRW = rows.reduce((s, r) => s + (r.valueKRW || 0), 0);
  rows.forEach(r => r.weight = investedKRW > 0 ? (r.valueKRW || 0) / investedKRW : 0);
  rows.sort((a, b) => (b.valueKRW || 0) - (a.valueKRW || 0));

  // 통화별 순 투입 원금 (투입 원금은 환산하지 않고 통화 그대로 집계)
  const { netCap } = capitalFlow(trades, d);

  // 보유 종목 평가액(통화별, 현지 통화)
  const hold = { KRW: 0, USD: 0 };
  for (const r of rows) hold[r.cur] = (hold[r.cur] || 0) + r.value;

  // 현금: 사용자가 직접 입력한 그 시점 잔액 (첫 입력 전이면 0 = 주식만 합산)
  const cashEntry = cashEntryOn(state, d);
  const cash = { KRW: cashEntry?.KRW || 0, USD: cashEntry?.USD || 0 };
  const since = cashSince(state);
  const cashTracked = !!cashEntry;

  const fx = P.fxOn(d);
  // 통화별 슬리브(보유 주식 + 현금) 수익률 — 환율 개입 없이 통화 내부에서만 계산
  const sleeves = {};
  for (const cur of ['KRW', 'USD']) {
    const value = (hold[cur] || 0) + cash[cur];
    const cost = netCap[cur];
    sleeves[cur] = { cost, value, ret: cost > 0 ? value / cost - 1 : null, has: cost > 0 || value > 1e-6 };
  }

  const cashKRW = cash.KRW + (P.toKRW(cash.USD, 'USD', d) || 0);
  const totalKRW = investedKRW + cashKRW;
  // 합산 원가(현재 환율 환산) → 합산 수익률은 환율 손익을 제외한 순수 자산 성과
  // (환전 시점 환율을 추적하지 않으므로 실제 환차익은 계산 불가 → 원가·평가를 같은 현재 환율로 환산)
  const costKRWnow = netCap.KRW + (P.toKRW(netCap.USD, 'USD', d) || 0);

  return {
    date: d, rows, cash, cashKRW, investedKRW, totalKRW, fx, sleeves,
    depositKRW: netCap.KRW, depositUSD: netCap.USD,
    holdKRW: hold.KRW || 0, holdUSD: hold.USD || 0, cashUSD: cash.USD,
    cashTracked,                    // 그 시점에 적용 중인 현금 입력이 있는가 (없으면 현금 0으로 계산 중)
    cashSince: since,               // 처음 입력한 날 (이 날부터 현금이 평가액에 포함)
    cashAsOf: cashEntry?.date || null, // 지금 쓰이는 값을 넣은 날 (표시용 — cashSince와 다를 수 있다)
    deposits: costKRWnow,           // 합산 원가(현재 환율) — 단일 KRW 지표 소비자용
    profit: totalKRW - costKRWnow,  // 합산 손익(환율 영향 제외)
    ret: costKRWnow > 0 ? (totalKRW - costKRWnow) / costKRWnow : null,
    realized,
  };
}

// 밖에서 새로 끌어온 돈만 뽑아낸다 — 매도 대금으로 다시 산 것은 새 투입이 아니다.
// 이걸 안 하면 팔고 사기를 반복한 횟수만큼 '투입 원금'이 불어나, 평행우주의 지수·예금
// 세계가 실제로는 넣은 적 없는 돈까지 굴린 것처럼 부풀려진다. [{date, cur, amt, amtKRW}]
export function externalContributions(trades) {
  const pool = { KRW: 0, USD: 0 };
  const ev = [];
  for (const t of trades) {
    const cur = P.currencyOf(t.symbol);
    if (t.side === 'buy') {
      const cost = t.price * t.qty + (t.fee || 0);
      const fromPool = Math.min(pool[cur], cost);
      pool[cur] -= fromPool;
      const ext = cost - fromPool;
      if (ext > 1e-9) ev.push({ date: t.date, cur, amt: ext, amtKRW: P.toKRW(ext, cur, t.date) || 0 });
    } else {
      pool[cur] += t.price * t.qty - (t.fee || 0);
    }
  }
  return ev;
}

// ---- 평행우주 ---------------------------------------------------------------
export function worlds(state) {
  const trades = sortedTrades(state);
  const buys = trades.filter(t => t.side === 'buy');
  if (!buys.length) return null;
  const start = buys[0].date;
  const end = todayStr();

  // 날짜 그리드: 시작~오늘, 약 200~300개 지점 + 거래일
  const span = Math.max(1, daysBetween(start, end));
  const step = Math.max(2, Math.round(span / 220));
  const set = new Set([start, end]);
  for (let i = step; i < span; i += step) set.add(addDaysStr(start, i));
  for (const t of trades) set.add(t.date);
  const dates = [...set].sort();

  // 모든 세계는 "밖에서 새로 넣은 돈"만 굴린다 — 실제의 나와 조건을 맞춰야 비교가 공정하다
  const contribs = externalContributions(trades);

  // 지수 세계의 매입 단위 미리 계산
  const kUnits = [], sUnits = [];
  for (const c of contribs) {
    const k = P.closeOn('^KS11', c.date);
    if (k) kUnits.push({ date: c.date, units: c.amtKRW / k });
    const fx = P.fxOn(c.date);
    const amtUSD = c.cur === 'USD' ? c.amt : (fx ? c.amtKRW / fx : 0);
    const s = P.closeOn('^GSPC', c.date);
    if (s) sUnits.push({ date: c.date, units: amtUSD / s });
  }

  const rate = (state.settings?.depositRate ?? 3) / 100; // 정기예금 가정 금리(연, 복리)
  const out = { dates, deposits: [], actual: [], kospi: [], sp500: [], bank: [], rate: rate * 100 };
  for (const d of dates) {
    // 투입 원금 + 예금 세계(같은 날 같은 금액을 연 rate% 복리로)
    let dep = 0, bank = 0;
    for (const c of contribs) {
      if (c.date > d) break;
      dep += c.amtKRW;
      bank += c.amtKRW * Math.pow(1 + rate, daysBetween(c.date, d) / 365);
    }
    out.deposits.push(dep);
    out.bank.push(bank);

    // 실제의 나 = 보유 종목 평가액 + 그 시점 현금(직접 입력한 값, 미입력 구간은 0)
    const { open } = replay(trades, d);
    let v = 0;
    for (const lot of open) {
      const lv = lotValue(lot, d);
      v += P.toKRW(lv.value, lv.cur, d) || 0;
    }
    const c = cashOn(state, d);
    v += (c.KRW || 0) + (P.toKRW(c.USD, 'USD', d) || 0);
    out.actual.push(v);

    // 지수만 산 나
    let kv = 0;
    const kIdx = P.closeOn('^KS11', d);
    if (kIdx) for (const u of kUnits) { if (u.date <= d) kv += u.units * kIdx; }
    out.kospi.push(kv);
    let sv = 0;
    const sIdx = P.closeOn('^GSPC', d);
    const fx = P.fxOn(d);
    if (sIdx && fx) for (const u of sUnits) { if (u.date <= d) sv += u.units * sIdx * fx; }
    out.sp500.push(sv);
  }
  return out;
}

// ---- 개입 점수 ---------------------------------------------------------------
// 매도 채점: "판 뒤 그 주식이 어떻게 됐나" (수정종가 기준)
// 잘한 매도인지 아닌지는 판정하지 않는다 — 판 돈을 어디에 썼는지·왜 팔았는지를 모르는 채로
// "지금 오르면 이른 매도"라고 부르는 건 채점이 아니라 뒷북이다. 변화만 보여주고 판단은 사용자 몫.
export const SELL_HORIZONS = [1, 3, 6, 12];

export function sellScores(state) {
  const trades = sortedTrades(state);
  const { realized } = replay(trades);
  const today = todayStr();
  const rows = realized.map(r => {
    const sym = r.sell.symbol;
    const horizon = {};
    for (const m of SELL_HORIZONS) {
      const d = addMonthsStr(r.sell.date, m);
      horizon['m' + m] = d <= today ? P.growth(sym, r.sell.date, d) : null;
    }
    horizon.now = P.growth(sym, r.sell.date);
    return {
      r, sym, name: r.sell.name || sym, horizon,
      year: r.sell.date.slice(0, 4),
      // 거래정지·상장폐지로 시세가 멈춘 종목: '현재까지'가 사실은 그 날짜까지다
      frozenSince: P.frozenSince(sym),
    };
  });
  const scored = rows.filter(x => x.horizon.now != null);
  const avgNow = scored.length ? scored.reduce((s, x) => s + (x.horizon.now - 1), 0) / scored.length : null;
  return { rows, agg: { count: scored.length, avgMissed: avgNow } };
}

// 물타기 감지 + 채점: 보유 중 평단보다 싸게 추가 매수 → 이후 성과 vs 지수
export function avgDownBuys(state) {
  const trades = sortedTrades(state);
  const rows = [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t.side !== 'buy') continue;
    const { open } = replay(trades.slice(0, i), t.date);
    const lots = open.filter(l => l.t.symbol === t.symbol);
    const qty = lots.reduce((s, l) => s + l.qtyLeft, 0);
    if (qty <= 0) continue;
    const avg = lots.reduce((s, l) => s + unitCost(l.t) * l.qtyLeft, 0) / qty;
    if (t.price >= avg) continue;
    const bench = P.currencyOf(t.symbol) === 'KRW' ? '^KS11' : '^GSPC';
    const g = P.growth(t.symbol, t.date);
    const gb = P.growth(bench, t.date);
    rows.push({ t, avgBefore: avg, growth: g, benchGrowth: gb, delta: (g != null && gb != null) ? g - gb : null });
  }
  const scored = rows.filter(x => x.delta != null);
  const avgDelta = scored.length ? scored.reduce((s, x) => s + x.delta, 0) / scored.length : null;
  return { rows, agg: { count: rows.length, avgDelta } };
}

// ---- 투자 헌법 ---------------------------------------------------------------
export const PRINCIPLE_KINDS = {
  max_weight: { label: '한 종목 최대 비중(%)', hasParam: true, auto: true },
  min_hold_days: { label: '최소 보유 일수', hasParam: true, auto: true },
  no_avg_down: { label: '물타기 금지', hasParam: false, auto: true },
  manual: { label: '수동(매수 전 스스로 점검)', hasParam: false, auto: false },
};

// 전체 위반 목록 (자동 조항만)
export function violations(state) {
  const trades = sortedTrades(state);
  const out = [];
  const active = state.principles.filter(p => p.active);
  for (const p of active) {
    if (p.kind === 'max_weight') {
      for (const t of trades) {
        if (t.side !== 'buy') continue;
        const { open } = replay(trades, t.date);
        // 빈 포트폴리오에서의 첫 매수는 비중 100%가 불가피하므로 제외
        const others = new Set(open.filter(l => l.t.symbol !== t.symbol).map(l => l.t.symbol));
        if (!others.size) continue;
        let total = 0, mine = 0;
        for (const lot of open) {
          const lv = lotValue(lot, t.date);
          const krw = P.toKRW(lv.value, lv.cur, t.date) || 0;
          total += krw;
          if (lot.t.symbol === t.symbol) mine += krw;
        }
        if (total > 0 && mine / total > p.param / 100 + 0.005) {
          out.push({ p, trade: t, detail: `매수 후 비중 ${(mine / total * 100).toFixed(1)}% (한도 ${p.param}%)` });
        }
      }
    } else if (p.kind === 'min_hold_days') {
      const { realized } = replay(trades);
      for (const r of realized) {
        const minD = Math.min(...r.parts.map(x => daysBetween(x.buy.date, r.sell.date)));
        if (isFinite(minD) && minD < p.param) {
          out.push({ p, trade: r.sell, detail: `보유 ${minD}일 만에 매도 (최소 ${p.param}일)` });
        }
      }
    } else if (p.kind === 'no_avg_down') {
      for (const x of avgDownBuys(state).rows) {
        out.push({ p, trade: x.t, detail: `평단 ${Math.round(x.avgBefore).toLocaleString()} 아래에서 추가 매수` });
      }
    }
  }
  return out;
}

// 조항별 성적: 위반이 얽힌 실현 매매 vs 아닌 것의 평균 수익률
export function principleStats(state) {
  const vio = violations(state);
  const { realized } = replay(sortedTrades(state));
  const stats = new Map();
  for (const p of state.principles.filter(p => p.active && PRINCIPLE_KINDS[p.kind]?.auto)) {
    const violIds = new Set(vio.filter(v => v.p.id === p.id).map(v => v.trade.id));
    const v = [], ok = [];
    for (const r of realized) {
      if (r.ret == null) continue;
      const ids = [r.sell.id, ...r.parts.map(x => x.buy.id)];
      (ids.some(id => violIds.has(id)) ? v : ok).push(r.ret);
    }
    const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    stats.set(p.id, { violCount: violIds.size, violAvgRet: avg(v), okAvgRet: avg(ok), violN: v.length, okN: ok.length });
  }
  return stats;
}

// 저장 전 검사: 이 매매를 추가하면 자동 조항 위반이 생기는가
export function checkDraft(state, draft) {
  const clone = { ...state, trades: [...state.trades, { ...draft, id: draft.id || '__draft__' }] };
  const before = new Set(violations(state).map(v => v.p.id + '|' + v.trade.id + '|' + v.detail));
  return violations(clone).filter(v => (v.trade.id === (draft.id || '__draft__')) || !before.has(v.p.id + '|' + v.trade.id + '|' + v.detail));
}

// ---- 홀딩 일지 ---------------------------------------------------------------
export function diaryRows(state) {
  const today = todayStr();
  return [...state.diary].sort((a, b) => b.date < a.date ? -1 : 1).map(e => {
    const p0 = P.closeOn(e.symbol, e.date) ?? e.priceAtEntry ?? null;
    const gNow = P.growth(e.symbol, e.date);
    const d3 = addMonthsStr(e.date, 3);
    const g3 = d3 <= today ? P.growth(e.symbol, e.date, d3) : null;
    let verdict = null;
    if (gNow != null) {
      const chg = gNow - 1;
      if (e.urge === 'sell') {
        verdict = chg > 0.03 ? { cls: 'up', text: `참은 뒤 ${fmtPct(chg)} — 그때의 불안은 소음이었다` }
          : chg < -0.03 ? { cls: 'down', text: `이후 ${fmtPct(chg)} — 그때의 불안은 신호였다` }
          : { cls: 'flat', text: `이후 ${fmtPct(chg)} — 큰 차이 없음` };
      } else {
        verdict = chg > 0.03 ? { cls: 'up', text: `그때 샀다면 ${fmtPct(chg)}` }
          : chg < -0.03 ? { cls: 'down', text: `안 사길 잘했다 (${fmtPct(chg)})` }
          : { cls: 'flat', text: `이후 ${fmtPct(chg)} — 큰 차이 없음` };
      }
    }
    return { e, p0, gNow, g3, verdict };
  });
}

// ---- 관심 종목 ---------------------------------------------------------------
export function benchOf(symbol) {
  return P.currencyOf(symbol) === 'KRW' ? '^KS11' : '^GSPC';
}

// 각 관심 종목: 등록일에 샀다면 지금 몇 %인가 + 같은 기간 지수 + 실제 매수/기다림
export function watchRows(state) {
  const trades = sortedTrades(state);
  return [...(state.watchlist || [])].sort((a, b) => b.date < a.date ? -1 : 1).map(w => {
    const p0 = P.closeOn(w.symbol, w.date);
    const last = P.last(w.symbol);
    const gNow = P.growth(w.symbol, w.date);
    const gBench = P.growth(benchOf(w.symbol), w.date);
    const buy = trades.find(t => t.side === 'buy' && t.symbol === w.symbol && t.date >= w.date);
    const waitG = buy ? P.growth(w.symbol, w.date, buy.date) : null;
    const gSinceArchive = w.archived && w.archivedAt ? P.growth(w.symbol, w.archivedAt) : null;
    return {
      w, p0, last, gNow, gBench,
      alpha: (gNow != null && gBench != null) ? gNow - gBench : null,
      buy, waitG, gSinceArchive,
    };
  });
}

// 안목 집계: 관심 등록 종목들의 등록 후 평균 성과 vs 지수
export function watchAgg(state) {
  const rows = watchRows(state).filter(r => r.gNow != null && r.gBench != null);
  if (!rows.length) return null;
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    count: rows.length,
    avgG: avg(rows.map(r => r.gNow - 1)),
    avgBench: avg(rows.map(r => r.gBench - 1)),
    avgAlpha: avg(rows.map(r => r.alpha)),
  };
}

// 교체 시뮬: date에 fromSymbol fromQty주를 팔아 toSymbol을 샀다면 (같은 금액, 환율 반영)
export function swapRows(state) {
  return [...(state.swaps || [])].sort((a, b) => b.date < a.date ? -1 : 1).map(s => {
    const curA = P.currencyOf(s.fromSymbol), curB = P.currencyOf(s.toSymbol);
    const pa = P.closeOn(s.fromSymbol, s.date), pb = P.closeOn(s.toSymbol, s.date);
    const gA = P.growth(s.fromSymbol, s.date), gB = P.growth(s.toSymbol, s.date);
    const amtKRW = pa != null ? P.toKRW(pa * s.fromQty, curA, s.date) : null;
    const pbKRW = pb != null ? P.toKRW(pb, curB, s.date) : null;
    const qtyB = (amtKRW != null && pbKRW) ? amtKRW / pbKRW : null;
    const keptKRW = (pa != null && gA != null) ? P.toKRW(pa * s.fromQty * gA, curA) : null;
    const swapKRW = (qtyB != null && pb != null && gB != null) ? P.toKRW(qtyB * pb * gB, curB) : null;
    return {
      s, amtKRW, qtyB, keptKRW, swapKRW, gA, gB,
      delta: (keptKRW != null && swapKRW != null) ? swapKRW - keptKRW : null,
    };
  });
}

// ---- 투자 비용: 대출 이자 (계좌별 독립) ----------------------------------------
// loans: 대출 계좌 목록 [{name, balance, rate(연%), startDate, endDate(null=보유중), note}].
// 각 계좌는 startDate부터 endDate(없으면 오늘)까지 병렬로 이자가 쌓인다(잔액×연율×일수/365).
export function loanStatus(state) {
  const loans = state.loans || [];
  if (!loans.length) return null;
  const today = todayStr();

  const accounts = loans.map(l => {
    const open = !l.endDate;
    const end = l.endDate || today;
    const days = Math.max(0, daysBetween(l.startDate, end));
    return {
      ...l, open, end, days,
      interest: l.balance * (l.rate / 100) * days / 365,
      monthly: open ? l.balance * (l.rate / 100) / 12 : 0,
      daily: open ? l.balance * (l.rate / 100) / 365 : 0,
    };
  }).sort((a, b) => a.startDate < b.startDate ? -1 : 1);

  const openAccts = accounts.filter(a => a.open);
  const balance = openAccts.reduce((s, a) => s + a.balance, 0);
  const monthly = openAccts.reduce((s, a) => s + a.monthly, 0);
  const daily = openAccts.reduce((s, a) => s + a.daily, 0);
  const cumulative = accounts.reduce((s, a) => s + a.interest, 0);
  const wRate = balance > 0 ? openAccts.reduce((s, a) => s + a.balance * a.rate, 0) / balance : 0; // 잔액가중 평균금리

  // 이자 비용을 반영한 실질 손익 + 레버리지가 값을 하는지(펀드 연환산 수익률 vs 평균 대출 금리)
  const pf = portfolio(state, today);
  const trades = sortedTrades(state);
  const fundStart = trades.length ? trades[0].date : accounts[0].startDate;
  const fundDays = Math.max(1, daysBetween(fundStart, today));
  const annualized = (pf.ret != null && pf.deposits > 0)
    ? Math.pow(1 + pf.ret, 365 / fundDays) - 1 : null;

  const start = accounts.reduce((m, a) => a.startDate < m ? a.startDate : m, accounts[0].startDate);
  return {
    accounts, openAccts, balance, monthly, daily, cumulative, wRate, start, today,
    profit: pf.profit, netProfit: pf.profit - cumulative,
    fundRet: pf.ret, annualized,
    beatsHurdle: annualized != null ? annualized > wRate / 100 : null,
  };
}

// ---- 기간(주/월/연) 수익률 ------------------------------------------------------
// 평가액 = 그 시점 보유 주식 + 그 시점 현금(직접 입력분, 첫 입력 전은 0).
// 원화 기준(달러 자산은 각 시점 환율로 환산 → 환율 변동 포함).
//
// 기중에 들어오고 나간 돈(자금 흐름):
//  - 매수 +원가, 매도 −대금. 매도 대금은 앱이 추적하지 않으므로 계좌 밖으로 나간 것으로 본다.
//    그 돈이 실제로 계좌에 남아 있었다면, 현금을 입력하는 순간 다시 들어온 것으로 잡힌다.
//    어느 쪽이든 손익으로는 잡히지 않는다 — 돈을 옮긴 것은 번 것이 아니므로.
//  - 현금 입력값의 변동 ±차액 (첫 입력 = 그동안 안 세던 현금을 자산으로 인식한 것).
function flowEvents(state) {
  const ev = [];
  for (const t of sortedTrades(state)) {
    const cur = P.currencyOf(t.symbol);
    const amt = t.side === 'buy'
      ? t.price * t.qty + (t.fee || 0)
      : -(t.price * t.qty - (t.fee || 0));
    ev.push({ date: t.date, amtKRW: P.toKRW(amt, cur, t.date) || 0 });
  }
  let prev = { KRW: 0, USD: 0 };
  for (const e of cashLog(state)) {
    const dKRW = ((e.KRW || 0) - prev.KRW) + (P.toKRW((e.USD || 0) - prev.USD, 'USD', e.date) || 0);
    if (Math.abs(dKRW) > 1e-9) ev.push({ date: e.date, amtKRW: dKRW });
    prev = { KRW: e.KRW || 0, USD: e.USD || 0 };
  }
  return ev.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// 시간가중 수익률(TWR) 계산기.
//
// 돈이 들어오고 나간 날마다 구간을 끊어 각 구간의 수익률을 따로 재고 곱한다. 이러면 "언제
// 얼마를 넣었나"가 수익률에서 완전히 빠진다 — 기말에 원금을 왕창 넣은 기간이라고 해서
// 그 돈의 손익이 작았던 기초 잔액에 나뉘어 수익률이 폭발하지 않는다(기저효과 제거).
// 순손익(번 돈) 자체는 따로 그대로 보여주므로, 둘을 같이 보면 된다.
function twrCalculator(state) {
  const flowByDate = new Map();
  for (const ev of flowEvents(state)) flowByDate.set(ev.date, (flowByDate.get(ev.date) || 0) + ev.amtKRW);
  const flowDates = [...flowByDate.keys()].sort();
  const cache = new Map(); // 같은 날짜 평가액을 여러 번 계산하지 않도록
  const valueOn = d => {
    if (!cache.has(d)) cache.set(d, portfolio(state, d).totalKRW);
    return cache.get(d);
  };
  const flowsIn = (from, to) =>
    flowDates.reduce((s, d) => (d > from && d <= to) ? s + flowByDate.get(d) : s, 0);

  // from(그 시점 평가액 fromVal)부터 to까지의 시간가중 수익률. 굴린 돈이 없던 기간은 null.
  const ret = (from, fromVal, to) => {
    let factor = 1, vPrev = fromVal, any = false;
    for (const d of flowDates) {
      if (d <= from) continue;
      if (d > to) break;
      const v = valueOn(d);
      // 그날 들어온(나간) 돈은 아직 일한 적이 없으므로 그 구간 수익에서 뺀다
      if (vPrev > 1) { factor *= (v - flowByDate.get(d)) / vPrev; any = true; }
      vPrev = v;
    }
    if (vPrev > 1) { factor *= valueOn(to) / vPrev; any = true; }
    return any ? factor - 1 : null;
  };
  return { valueOn, flowsIn, ret };
}

const pad2 = n => String(n).padStart(2, '0');
const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-based

export function periodReturns(state, unit = 'month') {
  const trades = sortedTrades(state);
  if (!trades.length) return [];
  const today = todayStr();
  const first = trades[0].date;
  const calc = twrCalculator(state);

  // 기간 말 날짜 목록(ends)과 라벨 함수
  const ends = [];
  let labelOf;
  if (unit === 'year') {
    const cy = Number(today.slice(0, 4));
    for (let y = Number(first.slice(0, 4)); y <= cy; y++) ends.push(y < cy ? `${y}-12-31` : today);
    labelOf = (s, e) => `${e.slice(0, 4)}년`;
  } else if (unit === 'week') {
    const sundayOf = ds => { const [Y, M, D] = ds.split('-').map(Number); const dt = new Date(Y, M - 1, D); dt.setDate(dt.getDate() + (7 - dt.getDay()) % 7); return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; };
    let e = sundayOf(first);
    while (e < today) { ends.push(e); e = addDaysStr(e, 7); }
    ends.push(today);
    labelOf = (s, e) => `${addDaysStr(s, 1).slice(5).replace('-', '.')}~${e.slice(5).replace('-', '.')}`;
  } else {
    let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
    const cy = Number(today.slice(0, 4)), cm = Number(today.slice(5, 7));
    while (y < cy || (y === cy && m <= cm)) {
      ends.push((y === cy && m === cm) ? today : `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`);
      if (++m > 12) { m = 1; y++; }
    }
    labelOf = (s, e) => e.slice(0, 7).replace('-', '.');
  }

  let prevEnd = addDaysStr(first, -1); // 첫 거래 전날 = 평가액 0
  let prevVal = 0;
  const rows = [];
  for (const end of ends) {
    const endVal = calc.valueOn(end);
    const contrib = calc.flowsIn(prevEnd, end);  // 기중 들어온(+)·나간(−) 돈
    const change = endVal - prevVal;             // 평가액 증감(그 돈 포함)
    const gain = change - contrib;               // 순손익(그 돈 제외 = 실제로 번 돈)
    rows.push({
      label: labelOf(prevEnd, end), start: prevEnd, end, isCurrent: end === today,
      startVal: prevVal, endVal, contrib, change, gain,
      ret: calc.ret(prevEnd, prevVal, end),
    });
    prevEnd = end; prevVal = endVal;
  }
  return rows.reverse(); // 최신 먼저
}

// ---- 주주 서한 데이터 팩 -------------------------------------------------------
export function letterPack(state, period) {
  const today = todayStr();
  let [start, end] = quarterRange(period);
  if (end > today) end = today;
  const prevEnd = addDaysStr(start, -1);
  const p0 = portfolio(state, prevEnd);
  const p1 = portfolio(state, end);
  const trades = sortedTrades(state).filter(t => t.date >= start && t.date <= end);
  // 기간 수익률과 같은 방식(시간가중)으로 분기 수익률을 낸다
  const calc = twrCalculator(state);
  const flows = calc.flowsIn(prevEnd, end);
  const ret = calc.ret(prevEnd, p0.totalKRW, end);
  const bench = {
    kospi: P.growth('^KS11', start, end),
    sp500: P.growth('^GSPC', start, end),
  };
  const vio = violations(state).filter(v => v.trade.date >= start && v.trade.date <= end);
  const diary = state.diary.filter(e => e.date >= start && e.date <= end);
  const prev = state.letters.filter(l => l.period === prevQuarter(period))[0] || null;
  return { period, start, end, p0, p1, flows, ret, bench, trades, vio, diary, prev };
}

// ---- AI 복기 데이터 팩 --------------------------------------------------------
export function aiPack(state) {
  const pf = portfolio(state);
  const w = worlds(state);
  const ss = sellScores(state);
  const ad = avgDownBuys(state);
  const vio = violations(state);
  const L = [];
  const pct = v => v == null ? '?' : (v * 100).toFixed(1) + '%';
  L.push('# 나의 매매 기록 전체 (복기용 데이터 팩)');
  L.push('');
  L.push(`생성일: ${todayStr()}  / 기준통화: KRW (달러 자산은 해당일 환율 환산)`);
  L.push('');
  L.push('## 펀드 현황');
  const depStr = [pf.depositKRW > 0 ? fmtMoney(pf.depositKRW) : null, pf.depositUSD > 0 ? fmtMoney(pf.depositUSD, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0);
  const retStr = [pf.sleeves.KRW.has ? `원화 ${pct(pf.sleeves.KRW.ret)}` : null, pf.sleeves.USD.has ? `달러 ${pct(pf.sleeves.USD.ret)}` : null].filter(Boolean).join(', ');
  L.push(`- 투입 원금: ${depStr} (통화별 분리) / 현재 가치: ${fmtMoney(pf.totalKRW)} (현재 환율 환산 합계)`);
  L.push(`- 수익률: ${retStr}${pf.sleeves.KRW.has && pf.sleeves.USD.has ? ` / 합산 ${pct(pf.ret)}(환율 영향 제외)` : ''}`);
  L.push(`- 현금: ${pf.cashTracked ? `${fmtMoney(pf.cash.KRW)} + ${fmtMoney(pf.cash.USD, 'USD')} (${pf.cashSince}부터 직접 입력, 위 현재 가치에 포함)` : '직접 입력한 적 없음 → 위 수치는 보유 주식만 합산한 것'}`);
  if (w) {
    const last = w.dates.length - 1;
    L.push(`- 평행우주(같은 매수를 했을 때의 현재 가치): 실제 ${fmtMoney(w.actual[last])} / 코스피만 샀다면 ${fmtMoney(w.kospi[last])} / S&P500만 샀다면 ${fmtMoney(w.sp500[last])} / 예금(연 ${w.rate}%)만 했다면 ${fmtMoney(w.bank[last])}`);
  }
  L.push('');
  L.push('## 보유 종목');
  for (const r of pf.rows) L.push(`- ${r.name}(${r.symbol}): ${r.qty}주, 원가 ${fmtMoney(r.cost, r.cur)}, 평가 ${fmtMoney(r.value, r.cur)} (${pct(r.ret)}), 비중 ${(r.weight * 100).toFixed(1)}%`);
  if (!pf.rows.length) L.push('- (없음)');
  L.push('');
  L.push('## 전체 매매 기록 (시간순)');
  for (const t of sortedTrades(state)) {
    L.push(`### ${t.date} ${t.side === 'buy' ? '매수' : '매도'} — ${t.name || t.symbol} (${t.symbol}) ${t.qty}주 @ ${fmtMoney(t.price, P.currencyOf(t.symbol))}`);
    if (t.side === 'buy') {
      L.push(`- 매수 이유: ${t.reason || '(기록 없음)'}`);
      if (t.confidence != null) L.push(`- 확신도: ${t.confidence}%  / 계획 보유기간: ${t.planMonths ?? '?'}개월`);
      if (t.sellPlan) L.push(`- 미리 정한 매도 조건: ${t.sellPlan}`);
    } else {
      L.push(`- 매도 이유(${t.sellReasonType || '분류 없음'}): ${t.reason || '(기록 없음)'}`);
    }
    if (t.emotions?.length) L.push(`- 그때의 감정: ${t.emotions.join(', ')}`);
  }
  L.push('');
  L.push('## 실현된 매매의 결과');
  const { realized } = replay(sortedTrades(state));
  for (const r of realized) {
    L.push(`- ${r.sell.date} ${r.sell.name || r.sell.symbol} 매도: 수익률 ${pct(r.ret)}, 평균 보유 ${r.holdDays ? Math.round(r.holdDays) + '일' : '?'}`);
  }
  if (ss.agg.count) L.push(`- 매도 ${ss.agg.count}건, 판 뒤 그 주식의 현재까지 변화 평균: ${pct(ss.agg.avgMissed)} (해석은 하지 않음 — 판 돈을 어디에 썼는지는 아래 기록에서 판단할 것)`);
  if (ad.agg.count) L.push(`- 물타기 ${ad.agg.count}회, 지수 대비 평균 ${pct(ad.agg.avgDelta)}P`);
  L.push('');
  L.push('## 흔들렸던 순간들 (홀딩 일지)');
  for (const e of state.diary) L.push(`- ${e.date} ${e.symbol} [${e.urge === 'sell' ? '팔고 싶었다' : '더 사고 싶었다'}] ${e.note}`);
  if (!state.diary.length) L.push('- (없음)');
  L.push('');
  L.push('## 안 산 판단 (관심 종목)');
  for (const r of watchRows(state)) {
    const status = r.buy ? `이후 ${r.buy.date} 실제 매수` : r.w.archived ? '관심 접음' : '계속 관망 중';
    L.push(`- ${r.w.date} 등록 ${r.w.name || r.w.symbol}: 등록 후 ${pct(r.gNow != null ? r.gNow - 1 : null)} (같은 기간 지수 ${pct(r.gBench != null ? r.gBench - 1 : null)}) — ${status}`);
    if (r.w.thesis) L.push(`  논지: ${r.w.thesis}`);
    if (r.w.trigger) L.push(`  매수 조건: ${r.w.trigger}`);
  }
  if (!(state.watchlist || []).length) L.push('- (없음)');
  L.push('');
  L.push('## 교체 고민의 기록 (하지 않은 스왑)');
  for (const x of swapRows(state)) {
    L.push(`- ${x.s.date} ${x.s.fromName || x.s.fromSymbol} ${x.s.fromQty}주 → ${x.s.toName || x.s.toSymbol}: 그대로 ${fmtMoney(x.keptKRW)}, 바꿨다면 ${fmtMoney(x.swapKRW)} (차이 ${fmtMoney(x.delta)})${x.s.note ? ' — ' + x.s.note : ''}`);
  }
  if (!(state.swaps || []).length) L.push('- (없음)');
  L.push('');
  const ln = loanStatus(state);
  if (ln) {
    L.push('## 투자 비용 (대출 이자)');
    L.push(`- 대출 계좌 ${ln.openAccts.length}개, 총 잔액 ${fmtMoney(ln.balance)} (평균 금리 연 ${ln.wRate.toFixed(2)}%), 이번 달 이자 약 ${fmtMoney(ln.monthly)}`);
    for (const a of ln.accounts) L.push(`  · ${a.name} ${fmtMoney(a.balance)} 연 ${a.rate}% (${a.startDate}~${a.open ? '보유 중' : a.endDate}) 누적이자 ${fmtMoney(a.interest)}`);
    L.push(`- ${ln.start} 이후 누적 이자 약 ${fmtMoney(ln.cumulative)} → 이자 차감 후 실질 손익 ${fmtMoney(ln.netProfit)} (명목 ${fmtMoney(ln.profit)})`);
    if (ln.annualized != null) L.push(`- 펀드 연환산 수익률 약 ${pct(ln.annualized)} vs 평균 대출 금리 ${ln.wRate.toFixed(2)}% → 레버리지가 ${ln.beatsHurdle ? '값을 하는 중' : '비용을 못 넘고 있음'}`);
    L.push('');
  }
  L.push('## 나의 투자 헌법과 위반');
  for (const p of state.principles.filter(p => p.active)) L.push(`- ${p.text}`);
  for (const v of vio) L.push(`  - 위반: ${v.trade.date} ${v.trade.name || v.trade.symbol} — ${v.detail}`);
  L.push('');
  L.push('## 과거에 나 자신에게 쓴 주주 서한');
  for (const l of [...state.letters].sort((a, b) => a.period < b.period ? -1 : 1)) {
    L.push(`### ${l.period}`);
    L.push(l.body);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('위는 한 개인투자자의 실제 매매 기록 전체입니다. 당신은 이 사람의 복기 파트너입니다. 아래를 지켜 주세요.');
  L.push('1. 칭찬으로 시작하지 말 것. 기록에서 반복되는 패턴(특히 본인이 못 보고 있을 행동 습관)을 구체적 근거와 함께 지적할 것.');
  L.push('2. 매수 이유의 "글"과 실제 "행동"이 어긋난 지점을 찾을 것 (예: 장기 보유를 말하면서 단기에 파는 것, 살 때는 사업 이야기·팔 때는 가격 이야기만 하는 것).');
  L.push('3. 감정 태그와 성과의 관계, 확신도와 실제 결과의 관계를 짚을 것.');
  L.push('4. 마지막에, 다음 분기에 지킬 행동 규칙을 딱 2개만 제안할 것. 추상적 조언 금지.');
  L.push('5. 종목 추천이나 시장 전망은 하지 말 것. 이 대화의 주제는 시장이 아니라 이 사람의 행동이다.');
  return L.join('\n');
}
