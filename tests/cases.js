// 회계 불변식 — 개발일지에서 실제로 터졌던 사고들을 그대로 시험으로 굳혔다.
// 새 기능보다 이 파일이 먼저다. 여기가 초록이면 "숫자가 예전과 같다"는 뜻이다.
import { test, eq, near } from './run.js';
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
// 매도를 환전 뒤에 두었더니 "판 돈이 아직 없다"며 매수 대금을 새 돈으로 셌다(실제 사고).
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
// 원가 비율을 평가액에까지 곱했다가 수익률이 통째로 틀린 적이 있다.
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
// 1,000만 넣어 500만만 사고 500만을 현금으로 입력하면 한때 +100%로 나왔다.
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
// events에 src가 trade이면서 양수인 항목 = "밖에서 들어왔다고 앱이 지어낸 돈".
// 입출금을 제대로 넣었다면 0이어야 한다.
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
// 순액만 쓰면 출금이 분모를 깎아 실력과 무관하게 수익률이 뛴다(달러 +108% 사고).
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
// settings 안에 있던 시절엔 늦게 저장한 기기가 상대 입력을 통째로 지웠다(2026-09-08 수정).
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
