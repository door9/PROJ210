// 회계 불변식. 여기가 초록이면 계산 규칙이 예전과 같다는 뜻이다.
import { test, eq, near, ok } from './run.js';
import * as E from '../js/engine.js';
import * as Store from '../js/store.js';
import { mergeAll } from '../js/sync.js';
import { blank, buy, sell, move, fx, income, cash, seed } from './fixture.js';

// ── 1. 환전은 통화 사이 이동일 뿐, 밖에서 온 돈이 아니다 ──────────────────────
// 원화가 줄고 달러가 그만큼 늘 뿐 합산 원금은 그대로여야 한다.
test('환전은 합산 투입 원금을 바꾸지 않는다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'KRW', 1000000);
  const a = E.capitalLedger(s);
  fx(s, '2026-01-05', 'KRW', 1000000, 1000);      // 100만원 → $1,000
  const b = E.capitalLedger(s);
  near(a.netCap.KRW + a.netCap.USD * 1000, b.netCap.KRW + b.netCap.USD * 1000, 0.01, '합산 원금');
  near(b.netCap.KRW, 0, 0.01, '환전 뒤 원화 원금');
  near(b.netCap.USD, 1000, 0.01, '환전 뒤 달러 원금');
});

// ── 2. 같은 날 사건 순서: 입금 → 매도 → 환전 → 매수 → 출금 → 현금 입력 ────────
// 매도를 환전 뒤에 두면 매수 대금을 새 돈으로 센다.
test('같은 날 판 돈으로 산 것은 새 돈이 아니다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 1000);
  buy(s, '2026-01-02', 'AAA', 100, 10);           // $1,000 어치
  sell(s, '2026-02-02', 'AAA', 120, 10);          // $1,200 회수
  buy(s, '2026-02-02', 'BBB', 20, 60);            // 같은 날 $1,200 재매수
  const l = E.capitalLedger(s);
  near(l.netCap.USD, 1000, 0.01, '순투입 달러');
  eq(l.events.filter(e => e.src === 'trade' && e.amt > 0).length, 0, '새 돈으로 센 매수 건수');
});

// ── 3. 배당·이자는 수익이지 자본이 아니다 ────────────────────────────────────
// 없으면 그 돈으로 산 주식이 '밖에서 들어온 돈'으로 잡혀 원금이 부푼다.
test('배당으로 산 주식은 투입 원금을 늘리지 않는다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 1000);
  income(s, '2026-01-05', 'USD', 200);
  buy(s, '2026-01-06', 'AAA', 100, 12);            // $1,200 = 원금 1,000 + 배당 200
  const l = E.capitalLedger(s);
  near(l.netCap.USD, 1000, 0.01, '순투입 달러(배당 제외)');
});

// ── 4. 매도해도 이동평균 단가는 변하지 않는다 ────────────────────────────────
// 원가 비율을 평가액에 곱하면 수익률이 틀어진다.
test('일부 매도 뒤에도 평균 단가가 유지된다', () => {
  seed();
  const s = blank();
  buy(s, '2026-01-02', 'AAA', 100, 10);
  buy(s, '2026-01-02', 'AAA', 120, 10);            // 평단 110
  near(E.avgUnitCost(s, 'AAA'), 110, 0.01, '매도 전 평단');
  sell(s, '2026-02-02', 'AAA', 200, 5);
  near(E.avgUnitCost(s, 'AAA'), 110, 0.01, '매도 후 평단');
  near(E.heldQty(s, 'AAA', '2026-02-02'), 15, 1e-9, '보유 수량');
});

// ── 5. 넣어 두고 안 산 돈 ────────────────────────────────────────────────────
// 넣어 두고 안 산 돈이 분자에만 들어가면 수익률이 부푼다.
test('입금해 두고 안 산 돈이 수익률을 부풀리지 않는다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 2000);
  buy(s, '2026-01-02', 'AAA', 100, 10);            // $1,000만 사용
  cash(s, '2026-01-02', 0, 1000);                  // 남은 $1,000을 현금으로 선언
  const l = E.capitalLedger(s);
  near(l.netCap.USD, 2000, 0.01, '순투입은 넣은 2,000 그대로');
  const pf = E.portfolio(s, '2026-01-02');
  near(pf.ret, 0, 1e-6, '산 날의 수익률은 0');
});

// ── 6. 장부 건강성: 앱이 지어낸 돈이 없어야 한다 ─────────────────────────────
test('입출금을 다 넣으면 지어낸 자본이 0이다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'KRW', 2000000);
  fx(s, '2026-01-02', 'KRW', 2000000, 1000);
  buy(s, '2026-01-02', 'AAA', 100, 10);
  sell(s, '2026-02-02', 'AAA', 120, 10);
  buy(s, '2026-02-02', 'BBB', 20, 50);
  const l = E.capitalLedger(s);
  eq(l.events.filter(e => e.src === 'trade' && e.amt > 0).length, 0, '지어낸 자본 건수');
});

// ── 7. 타인 자금은 현금만 맞추고 원금·출금에서 뺀다 ──────────────────────────
test('타인 자금(capital:false)은 투입 원금에 안 들어간다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 1000);
  move(s, '2026-01-03', 'in', 'USD', 500, false);   // 잠시 맡은 남의 돈
  const l = E.capitalLedger(s);
  near(l.netCap.USD, 1000, 0.01, '순투입 달러');
  near(l.pool.USD, 1500, 0.01, '현금 장부는 1,500');
});

// ── 8. 출금해도 분모가 줄어 수익률이 부풀지 않는다 ───────────────────────────
// 순액만 쓰면 출금이 분모를 깎아 수익률이 뛴다.
test('넣은 돈·뺀 돈을 따로 세어 출금이 분모를 깎지 않는다', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 1000);
  move(s, '2026-01-03', 'out', 'USD', 400);
  const l = E.capitalLedger(s);
  near(l.flow.USD.extIn, 1000, 0.01, '넣은 돈');
  near(l.flow.USD.extOut, 400, 0.01, '뺀 돈');
  near(l.netCap.USD, 600, 0.01, '순투입');
});

// ── 9. 현금 기록은 기기 간 병합에서 줄 단위로 살아남는다 ─────────────────────
// settings 안에 두면 늦게 저장한 기기가 상대 입력을 지운다.
test('두 기기에서 각각 넣은 현금 입력이 모두 살아남는다', () => {
  const base = blank();
  cash(base, '2026-01-02', 100, 1);
  const phone = JSON.parse(JSON.stringify(base));
  const pc = JSON.parse(JSON.stringify(base));
  cash(phone, '2026-01-03', 200, 2); phone.settings.updatedAt = 2000;
  cash(pc, '2026-01-04', 300, 3);    pc.settings.updatedAt = 3000;   // PC가 나중에 저장
  const m = mergeAll(pc, phone);
  eq(m.cashLog.map(e => e.date).sort(), ['2026-01-02', '2026-01-03', '2026-01-04'], '병합된 날짜');
});

// ── 10. 삭제는 tombstone으로 — 다른 기기에서 되살아나지 않는다 ───────────────
test('삭제한 기록이 동기화로 부활하지 않는다', () => {
  const s = blank();
  buy(s, '2026-01-02', 'AAA', 100, 10);
  const remote = JSON.parse(JSON.stringify(s));       // 아직 지우기 전 사본
  Store.removeItem(s, 'trades', s.trades[0].id);
  const m = mergeAll(s, remote);
  eq(m.trades.length, 0, '삭제 뒤 남은 매매');
});

// ── 11. 통화별 평가액이 합산 평가액과 맞물린다 ───────────────────────────────
// 환율 1,000원 고정이라 암산으로 검산된다.
test('원화·달러 평가액 합이 총평가액과 같다', () => {
  seed();
  const s = blank();
  buy(s, '2026-01-02', '111111.KS', 1000, 100);      // 10만원
  buy(s, '2026-01-02', 'AAA', 100, 10);              // $1,000
  const pf = E.portfolio(s, '2026-02-02');
  const krw = pf.rows.filter(r => r.cur === 'KRW').reduce((a, r) => a + r.value, 0);
  const usd = pf.rows.filter(r => r.cur === 'USD').reduce((a, r) => a + r.value, 0);
  near(krw, 110000, 1, '원화 평가액');
  near(usd, 1200, 0.01, '달러 평가액');
  near(pf.rows.reduce((a, r) => a + (r.valueKRW || 0), 0), 110000 + 1200 * 1000, 1, '합산 평가액');
});

// ── 12. 청산 → 복원이 기록을 잃지 않는다 ─────────────────────────────────────
test('펀드를 청산했다가 되돌리면 기록이 그대로 돌아온다', () => {
  seed();
  const s = blank();
  buy(s, '2026-01-02', 'AAA', 100, 10);
  cash(s, '2026-01-02', 0, 500);
  move(s, '2026-01-02', 'in', 'USD', 1500);
  const ar = Store.closeFund(s, { name: '1세대', from: '2026-01-01', to: '2026-02-01', note: '', summary: {}, newName: '2세대' });
  eq(s.trades.length, 0, '청산 뒤 매매');
  eq(s.cashLog.length, 0, '청산 뒤 현금 입력');
  Store.restoreFund(s, ar.id);
  eq(s.trades.length, 1, '복원 뒤 매매');
  eq(s.cashLog.length, 1, '복원 뒤 현금 입력');
  eq(s.cashMoves.length, 1, '복원 뒤 입출금');
});

// ── 13. 두 기기가 각자 같은 날짜를 넣어도 줄이 하나다 ────────────────────────
test('같은 날짜를 두 기기에서 넣어도 한 줄로 합쳐진다', () => {
  const phone = blank(), pc = blank();
  Store.setCash(phone, '2026-01-02', 100, 1);
  Store.setCash(pc, '2026-01-02', 200, 2);          // 같은 날짜, 다른 값
  pc.cashLog[0].updatedAt = phone.cashLog[0].updatedAt + 1000;   // PC가 나중에 저장
  const m = mergeAll(pc, phone);
  eq(m.cashLog.length, 1, '병합 뒤 줄 수');
  eq([m.cashLog[0].KRW, m.cashLog[0].USD], [200, 2], '나중에 저장한 값이 이긴다');
});

// ── 14. 이전 코드가 이미 생긴 중복을 걷어낸다 ───────────────────────────────
test('같은 날짜가 두 줄이면 이전 시 최신 하나만 남고 나머지는 tombstone', () => {
  const s = blank();
  s.cashLog = [
    { id: 'old-a', date: '2026-01-02', KRW: 100, USD: 1, createdAt: 1, updatedAt: 1000 },
    { id: 'old-b', date: '2026-01-02', KRW: 999, USD: 9, createdAt: 1, updatedAt: 2000 },
  ];
  Store.migrate(s);
  eq(s.cashLog.length, 1, '남은 줄 수');
  eq([s.cashLog[0].KRW, s.cashLog[0].USD], [999, 9], '최신 값이 남는다');
  eq(s.cashLog[0].id, 'cash-2026-01-02', '안정 id');
  ok(!!s.deleted['old-a'] && !!s.deleted['old-b'], '밀려난 옛 id는 tombstone으로 남는다');
});

// ── 15. 출금 한도 = 직전 입력 잔액 + 그 뒤 기록된 흐름 ──────────────────────
test('출금 한도는 직전 입력 잔액에 그 뒤 기록을 반영하고, 같은 날 입력 잔액은 무시한다', () => {
  seed();
  const s = blank();
  buy(s, '2026-01-02', 'AAA', 100, 10);
  cash(s, '2026-01-02', 0, 100);                  // 기준점: 하루 끝 $100
  sell(s, '2026-01-05', 'AAA', 120, 5);           // +$600
  move(s, '2026-01-05', 'out', 'USD', 50);        // 이미 기록된 같은 날 출금 −$50
  cash(s, '2026-01-05', 0, 9999);                 // 같은 날 입력 잔액 — 무시돼야 한다
  const av = E.cashAvailable(s, '2026-01-05');
  near(av.USD, 650, 0.01, '달러 출금 한도');
  eq(av.basisDate, '2026-01-02', '기준 날짜');
});

// ── 16. 기준점이 없으면 한도를 지어내지 않는다 ───────────────────────────────
test('이 날짜 전에 입력한 현금 잔액이 없으면 한도는 null', () => {
  seed();
  const s = blank();
  move(s, '2026-01-02', 'in', 'USD', 1000);
  cash(s, '2026-01-05', 0, 1000);                 // 같은 날 입력만 있음 — 기준점이 아니다
  eq(E.cashAvailable(s, '2026-01-05'), null, '한도');
});

// ── 17. 환전은 그날 매수·출금보다 먼저 일어난다 ──────────────────────────────
// 장부 순서가 입금→매도→환전→매수→출금이므로, 환전 한도에서 같은 날 매수·출금을 빼면 과소평가된다.
test('환전 한도는 같은 날 매수·출금을 아직 빼지 않는다', () => {
  seed();
  const s = blank();
  cash(s, '2026-01-02', 0, 1000);
  buy(s, '2026-01-05', 'BBB', 20, 10);            // 같은 날 −$200
  move(s, '2026-01-05', 'out', 'USD', 100);       // 같은 날 −$100
  near(E.cashAvailable(s, '2026-01-05').USD, 700, 0.01, '출금 한도(매수·출금 뒤)');
  near(E.cashAvailable(s, '2026-01-05', { stage: 'fx' }).USD, 1000, 0.01, '환전 한도(매수·출금 전)');
});

// ── 18~21. 입출금 ↔ 현금 잔액 연동 ─────────────────────────────────────────────
// 입금을 적으면 잔액도 늘고, 지우면 되돌아가야 한다. 따로 놀면 사용자가 잔액을 한 번 더 고쳐야 했다.
const mvRec = (id, date, kind, cur, amount) => ({ id, date, kind, cur, amount });

test('입금·출금을 기록하면 최근 잔액에서 그만큼 바뀐 잔액 줄이 생기고, 지우면 줄째로 사라진다', () => {
  const s = blank();
  cash(s, '2026-01-02', 1000000, 100);
  const a = mvRec('m1', '2026-01-05', 'in', 'KRW', 500000);
  s.cashMoves.push(a); Store.applyMoveCash(s, a);
  const b = mvRec('m2', '2026-01-05', 'out', 'USD', 30);
  s.cashMoves.push(b); Store.applyMoveCash(s, b);
  const e = s.cashLog.find(x => x.date === '2026-01-05');
  eq(e.KRW, 1500000, '입금 뒤 원화'); eq(e.USD, 70, '출금 뒤 달러');
  Store.revertMoveCash(s, a);                        // 같은 날 두 건 중 먼저 것을 지운다
  eq(s.cashLog.find(x => x.date === '2026-01-05').KRW, 1000000, '입금 되돌림');
  eq(s.cashLog.find(x => x.date === '2026-01-05').USD, 70, '다른 건은 그대로');
  Store.revertMoveCash(s, b);
  eq(s.cashLog.some(x => x.date === '2026-01-05'), false, '빈 줄은 사라진다');
  ok(s.deleted['cash-2026-01-05'] > 0, 'tombstone');
  eq(E.cashOn(s, '2026-01-06').KRW, 1000000, '전 잔액이 이어진다');
});

test('뒤 날짜 잔액이 이미 있거나 잔액을 넣은 적이 없으면 잔액을 건드리지 않는다', () => {
  const s = blank();
  const a = mvRec('m1', '2026-01-05', 'in', 'KRW', 1000);
  eq(Store.applyMoveCash(s, a).skip, 'none', '기준점 없음');
  cash(s, '2026-01-10', 5000, 0);
  eq(Store.applyMoveCash(s, a).skip, 'later', '뒤늦게 적는 입금');
  eq(s.cashLog.length, 1, '줄 수 그대로'); eq(s.cashLog[0].KRW, 5000, '값 그대로');
});

test('자동 반영 뒤 잔액을 직접 고쳤으면 입출금을 지워도 그 잔액은 그대로다', () => {
  const s = blank();
  cash(s, '2026-01-02', 1000, 0);
  const a = mvRec('m1', '2026-01-05', 'in', 'KRW', 500);
  s.cashMoves.push(a); Store.applyMoveCash(s, a);
  Store.setCash(s, '2026-01-05', 1700, 0);          // 증권사 화면을 보고 직접 넣음
  eq(Store.moveCashLink(s, a), null, '연결 끊김');
  eq(Store.revertMoveCash(s, a), null, '되돌리지 않음');
  eq(s.cashLog.find(x => x.date === '2026-01-05').KRW, 1700, '직접 넣은 값 유지');
});

test('입출금을 지우면 그 뒤 자동으로 이어 만든 잔액 줄에서도 빠지고, 직접 넣은 줄에서 멈춘다', () => {
  const s = blank();
  cash(s, '2026-01-02', 1000, 0);
  const a = mvRec('m1', '2026-01-05', 'in', 'KRW', 500);
  s.cashMoves.push(a); Store.applyMoveCash(s, a);   // 01-05: 1,500
  const b = mvRec('m2', '2026-01-07', 'out', 'KRW', 200);
  s.cashMoves.push(b); Store.applyMoveCash(s, b);   // 01-07: 1,300 (01-05 잔액을 이어받음)
  Store.revertMoveCash(s, a);
  eq(s.cashLog.some(x => x.date === '2026-01-05'), false, '01-05 줄 사라짐');
  eq(s.cashLog.find(x => x.date === '2026-01-07').KRW, 800, '01-07에서도 빠짐');
  eq(E.cashOn(s, '2026-01-08').KRW, 800, '지금 잔액 = 1,000 − 200');
});

// ── 22. 매수·매도·환전·배당도 같은 규칙으로 잔액에 반영된다 ─────────────────────
test('매수·매도·환전·배당도 현금 잔액에 반영되고, 모자라면 0에서 멈추며 지우면 바뀐 만큼만 되돌린다', () => {
  seed();
  const s = blank();
  cash(s, '2026-01-02', 100000, 500);
  const apply = (kind, r) => Store.applyCash(s, r.id, r.date, E.cashDeltaOf(kind, r));
  apply('trade', { id: 't1', side: 'buy', symbol: 'AAA', date: '2026-02-02', price: 120, qty: 3, fee: 1 });          // −$361
  apply('trade', { id: 't2', side: 'sell', symbol: '111111.KS', date: '2026-02-02', price: 1100, qty: 10, fee: 100 }); // +₩10,900
  apply('fx', { id: 'f1', date: '2026-02-02', from: 'KRW', amount: 50000, rate: 1000 });                             // −₩50,000 +$50
  apply('income', { id: 'i1', date: '2026-02-02', cur: 'USD', amount: 2.5 });                                         // +$2.5
  const e = s.cashLog.find(x => x.date === '2026-02-02');
  eq(e.KRW, 60900, '원화'); near(e.USD, 191.5, 0.001, '달러');
  const p = apply('trade', { id: 't3', side: 'buy', symbol: 'AAA', date: '2026-02-02', price: 150, qty: 2, fee: 0 });   // −$300 > 잔액
  eq(e.USD, 0, '모자라면 0'); near(p.short.USD, 108.5, 0.001, '모자란 금액');
  Store.revertCash(s, 't3');
  near(e.USD, 191.5, 0.001, '0에서 멈춘 만큼만 되돌림');
  Store.revertCash(s, 'f1');
  eq(e.KRW, 110900, '환전 되돌림 원화'); near(e.USD, 141.5, 0.001, '환전 되돌림 달러');
});

// ── 23. 매도 수수료·세금 계산 ──────────────────────────────────────────────────
test('매도 수수료·세금 계산', () => {
  eq(E.sellCost(7000000, 'KRW'), 15050, '국내');      // 수수료 1,050 + 세금 14,000
  eq(E.sellCost(300000, 'KRW'), 645, '국내 소액');     // 45 + 600
  near(E.sellCost(15000, 'USD'), 15.31, 0.001, '미국');       // 15.00 + SEC 0.31
  near(E.sellCost(200, 'USD'), 0.21, 0.001, '미국 소액');     // 0.20 + SEC 최소 0.01
  eq(E.sellCost(0, 'KRW'), 0, '보유 없음');
});

// ── 24. 수수료·세금을 뺀 평가액은 통화별로 따로 쌓인다 ──────────────────────────
test('포트폴리오가 통화별 매도 비용을 함께 내놓는다', () => {
  seed();
  const s = blank();
  buy(s, '2026-01-02', 'AAA', 100, 10);          // 미국 — 2026-03-02 평가 $1,500
  buy(s, '2026-01-02', '111111.KS', 1000, 100);  // 국내 — 평가 ₩90,000
  const pf = E.portfolio(s, '2026-03-02');
  const us = pf.rows.find(r => r.symbol === 'AAA'), kr = pf.rows.find(r => r.symbol === '111111.KS');
  near(us.sellCost, E.sellCost(1500, 'USD'), 0.001, '미국 종목');
  eq(kr.sellCost, E.sellCost(90000, 'KRW'), '국내 종목');
  near(pf.sleeves.USD.sellCost, us.sellCost, 0.001, '달러 슬리브');
  eq(pf.sleeves.KRW.sellCost, kr.sellCost, '원화 슬리브');
  near(pf.sellCostKRW, kr.sellCost + us.sellCost * 1000, 0.01, '원화 환산 합계');
});
