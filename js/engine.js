// 계산 엔진: 포트폴리오, 평행우주, 개입 점수, 헌법 검사, 서한/AI 데이터 팩
//
// 회계 가정(단순함을 위해 고정, UI에 명시):
//  - 모든 매수는 "새 돈"으로 본다. 매도 대금은 포트폴리오 안에 무이자 현금으로 쌓인다.
//  - 보유분 평가는 수정종가(배당·분할 반영) 성장배수 × 매수원가. 즉 배당 재투자 가정.
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

  // 현금(매도 대금 누적) 및 투입 원금
  const cash = { KRW: 0, USD: 0 };
  for (const r of realized) cash[P.currencyOf(r.sell.symbol)] += r.proceeds;
  let deposits = 0;
  for (const t of trades) {
    if (t.side !== 'buy' || t.date > d) continue;
    deposits += P.toKRW(t.price * t.qty + (t.fee || 0), P.currencyOf(t.symbol), t.date) || 0;
  }
  const cashKRW = cash.KRW + (P.toKRW(cash.USD, 'USD', d) || 0);
  const totalKRW = investedKRW + cashKRW;
  return {
    date: d, rows, cash, cashKRW, investedKRW, totalKRW, deposits,
    profit: totalKRW - deposits,
    ret: deposits > 0 ? (totalKRW - deposits) / deposits : null,
    realized,
  };
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

  // 지수 세계의 매입 단위 미리 계산
  const kUnits = [], sUnits = [];
  for (const b of buys) {
    const amtCur = b.price * b.qty + (b.fee || 0);
    const cur = P.currencyOf(b.symbol);
    const amtKRW = P.toKRW(amtCur, cur, b.date) || 0;
    const k = P.closeOn('^KS11', b.date);
    if (k) kUnits.push({ date: b.date, units: amtKRW / k });
    const fx = P.fxOn(b.date);
    const amtUSD = cur === 'USD' ? amtCur : (fx ? amtKRW / fx : 0);
    const s = P.closeOn('^GSPC', b.date);
    if (s) sUnits.push({ date: b.date, units: amtUSD / s });
  }

  const rate = (state.settings?.depositRate ?? 3) / 100; // 정기예금 가정 금리(연, 복리)
  const out = { dates, deposits: [], actual: [], neverSell: [], kospi: [], sp500: [], bank: [], rate: rate * 100 };
  for (const d of dates) {
    // 투입 원금 + 정기예금 세계(같은 날 같은 금액을 연 rate% 복리로)
    let dep = 0, bank = 0;
    for (const b of buys) {
      if (b.date > d) break;
      const amt = P.toKRW(b.price * b.qty + (b.fee || 0), P.currencyOf(b.symbol), b.date) || 0;
      dep += amt;
      bank += amt * Math.pow(1 + rate, daysBetween(b.date, d) / 365);
    }
    out.deposits.push(dep);
    out.bank.push(bank);

    // 실제의 나
    const { open, realized } = replay(trades, d);
    let v = 0;
    for (const lot of open) {
      const lv = lotValue(lot, d);
      v += P.toKRW(lv.value, lv.cur, d) || 0;
    }
    for (const r of realized) v += P.toKRW(r.proceeds, P.currencyOf(r.sell.symbol), r.sell.date <= d ? d : r.sell.date) || 0;
    out.actual.push(v);

    // 손 안 댄 나: 매도 무시
    let nv = 0;
    for (const b of buys) {
      if (b.date > d) break;
      const cost = b.price * b.qty + (b.fee || 0);
      const g = P.growth(b.symbol, b.date, d);
      nv += P.toKRW(g ? cost * g : cost, P.currencyOf(b.symbol), d) || 0;
    }
    out.neverSell.push(nv);

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
export function sellScores(state) {
  const trades = sortedTrades(state);
  const { realized } = replay(trades);
  const today = todayStr();
  const rows = realized.map(r => {
    const sym = r.sell.symbol;
    const horizon = {};
    for (const m of [3, 6, 12]) {
      const d = addMonthsStr(r.sell.date, m);
      horizon['m' + m] = d <= today ? P.growth(sym, r.sell.date, d) : null;
    }
    horizon.now = P.growth(sym, r.sell.date);
    return { r, sym, name: r.sell.name || sym, horizon };
  });
  const scored = rows.filter(x => x.horizon.now != null);
  const avgNow = scored.length ? scored.reduce((s, x) => s + (x.horizon.now - 1), 0) / scored.length : null;
  const good = scored.filter(x => x.horizon.now < 1).length;
  return { rows, agg: { count: scored.length, good, bad: scored.length - good, avgMissed: avgNow } };
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

// ---- 투자 비용: 대출(마이너스통장) 이자 ----------------------------------------
// loans: 잔액 스냅샷 [{date, balance, rate(연%), kind, note}]. 각 스냅샷은 그 날부터
// 다음 스냅샷(없으면 오늘)까지 유효한 잔액·금리로 본다. 이자는 일할 계산(잔액×연율×일수/365).
export function loanStatus(state) {
  const loans = [...(state.loans || [])].sort((a, b) => a.date < b.date ? -1 : 1);
  if (!loans.length) return null;
  const today = todayStr();
  const cur = loans[loans.length - 1];
  const monthly = cur.balance * (cur.rate / 100) / 12;
  const daily = cur.balance * (cur.rate / 100) / 365;

  let cumulative = 0;
  const segs = [];
  for (let i = 0; i < loans.length; i++) {
    const from = loans[i].date;
    const to = (i + 1 < loans.length) ? loans[i + 1].date : today;
    const days = Math.max(0, daysBetween(from, to));
    const interest = loans[i].balance * (loans[i].rate / 100) * days / 365;
    cumulative += interest;
    segs.push({ ...loans[i], to, days, interest });
  }

  // 이자 비용을 반영한 실질 손익 + 레버리지가 값을 하는지(펀드 연환산 수익률 vs 대출 금리)
  const pf = portfolio(state, today);
  const trades = sortedTrades(state);
  const fundStart = trades.length ? trades[0].date : loans[0].date;
  const fundDays = Math.max(1, daysBetween(fundStart, today));
  const annualized = (pf.ret != null && pf.deposits > 0)
    ? Math.pow(1 + pf.ret, 365 / fundDays) - 1 : null;

  return {
    loans, current: cur, balance: cur.balance, rate: cur.rate,
    monthly, daily, cumulative, segs, start: loans[0].date, today,
    profit: pf.profit, netProfit: pf.profit - cumulative,
    fundRet: pf.ret, annualized,
    beatsHurdle: annualized != null ? annualized > cur.rate / 100 : null,
  };
}

// ---- 주주 서한 데이터 팩 -------------------------------------------------------
export function letterPack(state, period) {
  const today = todayStr();
  let [start, end] = quarterRange(period);
  if (end > today) end = today;
  const p0 = portfolio(state, addDaysStr(start, -1));
  const p1 = portfolio(state, end);
  const trades = sortedTrades(state).filter(t => t.date >= start && t.date <= end);
  const flows = trades.filter(t => t.side === 'buy')
    .reduce((s, t) => s + (P.toKRW(t.price * t.qty + (t.fee || 0), P.currencyOf(t.symbol), t.date) || 0), 0);
  // 단순 수익률 근사 (기초가치+기간투입 대비)
  const base = p0.totalKRW + flows;
  const ret = base > 0 ? (p1.totalKRW - p0.totalKRW - flows) / base : null;
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
  L.push(`- 투입 원금: ${fmtMoney(pf.deposits)}  / 현재 가치: ${fmtMoney(pf.totalKRW)} (수익률 ${pct(pf.ret)})`);
  if (w) {
    const last = w.dates.length - 1;
    L.push(`- 평행우주(같은 매수를 했을 때의 현재 가치): 실제 ${fmtMoney(w.actual[last])} / 한 번도 안 팔았다면 ${fmtMoney(w.neverSell[last])} / 코스피만 샀다면 ${fmtMoney(w.kospi[last])} / S&P500만 샀다면 ${fmtMoney(w.sp500[last])} / 정기예금(연 ${w.rate}%)만 했다면 ${fmtMoney(w.bank[last])}`);
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
  if (ss.agg.count) L.push(`- 매도 채점(판 뒤 그 주식의 현재까지 변화 평균): ${pct(ss.agg.avgMissed)} → ${ss.agg.avgMissed > 0 ? '평균적으로 판 뒤에 더 올랐다(일찍 파는 경향)' : '평균적으로 판 뒤에 내렸다(매도 판단이 유효)'}`);
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
    L.push(`- 현재 대출 잔액 ${fmtMoney(ln.balance)} (연 ${ln.rate}%), 이번 달 이자 약 ${fmtMoney(ln.monthly)}`);
    L.push(`- ${ln.start} 이후 누적 이자 약 ${fmtMoney(ln.cumulative)} → 이자 차감 후 실질 손익 ${fmtMoney(ln.netProfit)} (명목 ${fmtMoney(ln.profit)})`);
    if (ln.annualized != null) L.push(`- 펀드 연환산 수익률 약 ${pct(ln.annualized)} vs 대출 금리 ${ln.rate}% → 레버리지가 ${ln.beatsHurdle ? '값을 하는 중' : '비용을 못 넘고 있음'}`);
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
