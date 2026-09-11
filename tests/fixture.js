// 검증용 가짜 장부. **개인 기록을 쓰지 않는다** — 종목명도 금액도 손으로 계산할 수 있게 지어냈다.
// 실데이터로 테스트하면 (a)기록이 저장소에 새고 (b)값이 바뀔 때마다 테스트가 깨진다.
import * as P from '../js/prices.js';

export const D = {           // 가짜 시세 [날짜, 종가, 수정종가]
  'AAA': [['2026-01-02', 100, 100], ['2026-02-02', 120, 120], ['2026-03-02', 150, 150]],
  'BBB': [['2026-01-02', 10, 10], ['2026-02-02', 20, 20], ['2026-03-02', 5, 5]],
  '111111.KS': [['2026-01-02', 1000, 1000], ['2026-02-02', 1100, 1100], ['2026-03-02', 900, 900]],
  'KRW=X': [['2026-01-02', 1000, 1000], ['2026-02-02', 1000, 1000], ['2026-03-02', 1000, 1000]],
  '^KS11': [['2026-01-02', 2000, 2000], ['2026-02-02', 2200, 2200], ['2026-03-02', 2400, 2400]],
  '^GSPC': [['2026-01-02', 5000, 5000], ['2026-02-02', 5500, 5500], ['2026-03-02', 6000, 6000]],
  'KO': [['2026-01-02', 60, 60], ['2026-02-02', 63, 63], ['2026-03-02', 66, 66]],
};
// 환율을 1,000원으로 고정해 두면 원·달러 환산이 암산으로 검산된다.
export const seed = () => P.__seedForTests(D);

let n = 0;
const id = () => 'x' + (++n);

export function blank() {
  return {
    version: 1,
    settings: { fundName: 'T', inception: null, ghRepo: '', ghPat: '', updatedAt: 0 },
    trades: [], diary: [], principles: [], letters: [], quotes: [], watchlist: [],
    swaps: [], loans: [], archives: [], virtuals: [], exchanges: [], cashMoves: [],
    incomes: [], cashLog: [], deleted: {},
  };
}

// createdAt을 넣는 순서대로 매겨 같은 날짜 안 순서를 결정적으로 만든다
export const buy = (s, date, symbol, price, qty, fee = 0) =>
  s.trades.push({ id: id(), side: 'buy', symbol, name: symbol, date, price, qty, fee, createdAt: ++n, updatedAt: n });
export const sell = (s, date, symbol, price, qty, fee = 0) =>
  s.trades.push({ id: id(), side: 'sell', symbol, name: symbol, date, price, qty, fee, createdAt: ++n, updatedAt: n });
export const move = (s, date, kind, cur, amount, capital = true) =>
  s.cashMoves.push({ id: id(), date, kind, cur, amount, capital, updatedAt: ++n });
export const fx = (s, date, from, amount, rate, fee = 0) =>
  s.exchanges.push({ id: id(), date, from, amount, rate, fee, updatedAt: ++n });
export const income = (s, date, cur, amount, kind = '배당') =>
  s.incomes.push({ id: id(), date, cur, amount, kind, name: '', note: '', updatedAt: ++n });
// 현금 입력 id는 앱과 같은 규칙(날짜에서 뽑기)을 써야 한다 — 여기서 uid를 쓰면
// 기기마다 id가 달라지는 진짜 문제를 시험이 못 잡는다.
export const cash = (s, date, KRW, USD) =>
  s.cashLog.push({ id: 'cash-' + date, date, KRW, USD, createdAt: ++n, updatedAt: n });
