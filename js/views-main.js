// 화면: 홈(대시보드), 기록(매매 목록 + 입력 폼)
import { state, saveNow, toast, openModal, closeModal, confirmModal, registerView, render, go } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import { uid, todayStr, esc, fmtMoney, fmtSigned, fmtPct, fmtQty, fmtFx, pctClass, quarterOf, bindKrArrowStep, bindThousands, bindCap, numOf, setNum } from './util.js';
import * as Dbx from './dropbox.js';
import * as Lock from './lock.js';
import { sparkline, lineChart, bindCharts } from './chart.js';

// ---------- 홈 ----------
// 보유 평가액 카드의 금액 가리기. 앱을 열 때마다 가린 상태로 시작한다(저장하지 않음).
let heroHidden = true;
function holdPeriod(from, to) {
  if (!from || !to) return '–';
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1), days = d2 - d1;
  if (days < 0) { months -= 1; days += new Date(y2, m2 - 1, 0).getDate(); }
  if (months >= 12) return `${Math.floor(months / 12)}년${months % 12 ? ` ${months % 12}개월` : ''}`;
  if (months >= 1) return `${months}개월${days ? ` ${days}일` : ''}`;
  return `${Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5))}일`;
}
export function openCashModal(focusCur = 'KRW') {
  const log = E.cashLog(state);
  const latest = log[log.length - 1] || null;
  const today = todayStr();
  const m = openModal(`
    <h2>현금 잔액</h2>
    <p class="small muted" data-note style="margin-top:-6px;">매수·매도·입출금·환전·배당을 기록하면 잔액이 그만큼 자동으로 바뀝니다.
    증권사 잔액과 다르면 여기에 실제 잔액을 넣으세요 — 넣은 값이 기준이 됩니다.
    ${log.length
      ? '기준일부터 새 값이 적용되고, 늘거나 준 만큼은 입출금으로 보아 수익에서 제외합니다.'
      : '<b>처음 입력한 날짜부터</b> 현금이 평가액(총자산·수익률)에 포함되고, 그 전 구간은 보유 주식만 합산합니다.'}</p>
    <form id="cash-quick">
      <div class="form-grid">
        <label class="fld full">기준일
          <input type="date" name="date" max="${today}" value="${today}" required>
        </label>
        <label class="fld">원화 현금 (원)
          <input name="cashKRW" type="text" inputmode="numeric" value="${latest?.KRW ?? ''}" placeholder="0">
        </label>
        <label class="fld">달러 현금 ($)
          <input name="cashUSD" type="text" inputmode="decimal" value="${latest?.USD ?? ''}" placeholder="0">
        </label>
      </div>
      <p class="hint" style="margin:2px 0 0;">비워두면 0으로 봅니다. 입력 이력 확인·삭제는 <a href="#/settings">설정</a>에서.</p>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" class="btn" data-x="cancel">취소</button>
        <button type="submit" class="btn primary">저장</button>
      </div>
    </form>`);
  const form = m.querySelector('#cash-quick');
  // 세 자리 콤마 — type="number"로는 브라우저가 콤마를 아예 못 받으므로 text로 두고 직접 서식을 입힌다.
  // 값을 읽을 땐 반드시 numOf() (parseFloat("1,234")는 1이 된다).
  [form.cashKRW, form.cashUSD].forEach(el => bindThousands(el));
  const target = focusCur === 'USD' ? form.cashUSD : form.cashKRW;
  target.focus(); target.select();
  m.querySelector('[data-x=cancel]').onclick = closeModal;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const parse = el => { if (String(el.value).trim() === '') return 0; const n = numOf(el); return (isNaN(n) || n < 0) ? null : n; };
    const krw = parse(form.cashKRW), usd = parse(form.cashUSD);
    if (krw === null || usd === null) { toast('현금은 0 이상의 숫자로 입력하세요'); return; }
    Store.setCash(state, form.date.value, krw, usd);
    saveNow(); closeModal(); render();
    toast(`${form.date.value} 기준 현금 잔액을 저장했습니다`);
  });
}

function vHome() {
  if (!state.trades.length) {
    return `
      <div class="view-title">${esc(state.settings.fundName || 'PROJ210')}</div>
      <p class="view-desc">나는 이 펀드의 매니저이고, 유일한 고객도 나다.</p>
      <div class="card">
        <h3>아직 기록이 없습니다</h3>
        <p class="small muted" style="margin:6px 0 0;">
          이 앱은 매매의 <b>결과</b>가 아니라 <b>판단</b>을 기록하고, 시간이 지난 뒤 그 판단을 채점합니다.<br><br>
          · <b>만약</b> — 지수만 샀다면·예금만 했다면 지금 얼마인가<br>
          · <b>회상</b> — 판 뒤 그 주식은 어떻게 됐나, 물타기는 지수보다 나았나<br>
          · <b>홀딩 일지</b> — 흔들린 순간이 신호였나 소음이었나<br>
          · <b>주주 서한</b> — 분기마다 나에게 쓰는 운용보고서<br>
          · <b>복기</b> — 기록 전체를 넘겨 심문받기
        </p>
        <div class="btn-row">
          <button class="btn primary" data-act="first-trade">첫 매매 기록하기</button>
        </div>
      </div>`;
  }

  const pf = E.portfolio(state);
  const ln = E.loanStatus(state);

  const alerts = [];
  if (!pf.cashTracked) alerts.push(`<div class="notice">현금 잔액이 아직 입력되지 않아 <b>보유 주식만</b> 합산하고 있습니다 — <a href="#/settings">설정</a>에서 원화·달러 잔액을 넣으면 총자산·수익률에 반영됩니다.</div>`);
  if (!Lock.hasPin()) alerts.push(`<div class="warnbox">앱 잠금(PIN)이 설정되지 않았습니다 — <a href="#/settings">설정</a>에서 PIN을 설정하세요.</div>`);
  if (!Dbx.connected()) alerts.push(`<div class="notice">아직 이 기기에만 저장 중 — <a href="#/settings">설정</a>에서 Dropbox를 연결하면 PC·폰 간 동기화됩니다.</div>`);
  const q = quarterOf(todayStr());
  if (!state.letters.some(l => l.period === q)) alerts.push(`<div class="notice">이번 분기(${q}) <a href="#/letters">주주 서한</a>을 아직 쓰지 않았습니다.</div>`);
  if (state.pendingSymbols.length) alerts.push(`<div class="warnbox">시세 미등록 종목: ${state.pendingSymbols.map(esc).join(', ')} — <a href="#/settings">설정</a>에서 등록 방법 확인</div>`);

  // 수수료·세금 차감 보기 — 지금 전부 판다면 실제로 손에 남는 금액 기준으로 바꿔 본다.
  // 설정 한 칸(netOfFees)에 담아 두고 홈·종목 화면이 같은 값을 따른다.
  const netFee = !!state.settings.netOfFees;
  const cut = (v, c) => netFee ? v - (c || 0) : v;
  // 수익률도 평가액과 같은 기준이어야 한다 — 한쪽만 차감하면 표가 앞뒤가 안 맞는다
  const rowRet = r => netFee ? (r.cost > 0 ? (r.value - r.sellCost) / r.cost - 1 : null) : r.ret;

  const holdRows = pf.rows.map(r => `
    <tr class="row-link" data-sym="${esc(r.symbol)}">
      <td class="nm-cell"><b class="nm" title="${esc(r.name)}">${esc(r.name)}</b> <span class="chev">›</span><br><span class="muted small">${esc(r.symbol)}</span></td>
      <td class="spark-cell">${sparkline(P.recentAdj(r.symbol), { up: (rowRet(r) ?? 0) >= 0 })}</td>
      <td class="num ${pctClass(rowRet(r))}">${fmtPct(rowRet(r))}</td>
      <td class="num">${fmtQty(r.qty)}주<br><span class="muted small">${fmtMoney(r.avgPrice, r.cur)}</span></td>
      <td class="num">${fmtMoney(r.cost, r.cur)}<br><span class="muted small">${(r.costWeight * 100).toFixed(1)}%</span></td>
      <td class="num">${fmtMoney(cut(r.value, r.sellCost), r.cur)}<br><span class="muted small">${(r.weight * 100).toFixed(1)}%</span></td>
      <td class="num">${holdPeriod(r.holdSince, pf.date)}<br><span class="muted small">${r.holdSince.slice(2).replace(/-/g, '.')}.~</span></td>
    </tr>`).join('');
  // 현금 잔액 — 사용자가 직접 입력한 값만 (앱은 매도 대금을 현금으로 추정하지 않는다).
  const cashRow = (label, amt, curc) => `
    <tr class="row-link" data-cash="${curc}">
      <td class="nm-cell"><b class="nm">${label}</b> <span class="chev">›</span><br><span class="muted small">${pf.cashTracked ? esc(pf.cashAsOf.slice(2).replace(/-/g, '.')) + '.' : '미입력 — 눌러서 설정'}</span></td>
      <td class="spark-cell">–</td>
      <td class="num">–</td>
      <td class="num">–</td>
      <td class="num">–</td>
      <td class="num">${fmtMoney(amt, curc)}</td>
      <td class="num">–</td>
    </tr>`;
  const cashRows = cashRow('원화 현금', pf.cash.KRW, 'KRW') + cashRow('달러 현금', pf.cash.USD, 'USD');

  // 투입 원금·평가 금액·수익률: 통화별로 분리 (달러는 환산하지 않고 그대로).
  // 세 줄이 같은 기준이라 위아래로 읽힌다 — 투입 원금 → 평가 금액 → 그 둘의 비율(수익률).
  const sK = pf.sleeves.KRW, sU = pf.sleeves.USD;
  const bothCur = sK.has && sU.has;
  // 통화별 금액을 "₩X + $Y"로. 한 통화만 쓰면 그 통화만 나온다.
  const money = (v, cur = 'KRW') => heroHidden ? (cur === 'USD' ? '$••••' : '₩•••••') : fmtMoney(v, cur);
  const byCur = (krw, usd) => [sK.has ? money(krw) : null,
                               sU.has ? money(usd, 'USD') : null].filter(Boolean).join(' + ') || money(0);
  const depStr = byCur(pf.depositKRW, pf.depositUSD);
  const valStr = byCur(cut(sK.value, sK.sellCost), cut(sU.value, sU.sellCost));   // 평가 금액 = 보유 주식 + 현금 (수익률과 같은 기준)
  // 뺀 돈이 있으면 따로 보여 준다 — 안 그러면 '원금 > 평가'인데 수익률은 +라 앞뒤가 안 맞아 보인다
  const hasOut = (sK.withdrawn || 0) > 0 || (sU.withdrawn || 0) > 0;
  const outStr = byCur(sK.withdrawn || 0, sU.withdrawn || 0);
  // 순투입 = 넣은 돈 − 뺀 돈. 수익률의 분모라 화면에 드러내야 앞뒤가 맞는다.
  const netStr = byCur(sK.net || 0, sU.net || 0);

  // 수익률도 같은 기준으로 — 수수료·세금을 뺀 평가액으로 다시 계산한다(넣은 돈·뺀 돈은 그대로).
  const retOf = s => !netFee ? s.ret
    : (s.net > 1e-6 ? (cut(s.value, s.sellCost) + s.withdrawn - s.contributed) / s.net : null);
  const retK = retOf(sK), retU = retOf(sU);
  const retAll = !netFee ? pf.ret
    : (pf.netIn > 0 ? (cut(pf.totalKRW, pf.sellCostKRW) + pf.withdrawn - pf.deposits) / pf.netIn : null);
  const retParts = [];
  if (sK.has && retK != null) retParts.push(`₩ <b class="${pctClass(retK)}">${fmtPct(retK)}</b>`);
  if (sU.has && retU != null) retParts.push(`$ <b class="${pctClass(retU)}">${fmtPct(retU)}</b>`);
  if (bothCur && retAll != null) retParts.push(`합 <b class="${pctClass(retAll)}">${fmtPct(retAll)}</b> <span class="muted">(환영향0)</span>`);

  // 제목 줄: 현금이 들어갔는지 + 달러가 있으면 환율. 현금 미입력이면 사실대로 '미포함'.
  const heroNote = [
    pf.cashTracked ? '현금 포함' : '현금 미포함',
    netFee ? '수수료·세금 차감' : null,
    sU.has && pf.fx ? `환율 ${fmtFx(pf.fx)}` : null,
  ].filter(Boolean).join(' · ');

  return `
    ${alerts.join('')}
    <div class="card hero">
      <div class="row"><span class="muted small">보유 평가액 (${heroNote})</span></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="big">${money(cut(pf.totalKRW, pf.sellCostKRW))}</div>
        <button type="button" class="btn small" id="hero-eye" style="margin-left:auto; flex:none;" aria-pressed="${heroHidden ? 'false' : 'true'}">${heroHidden ? '금액 보기' : '금액 가리기'}</button>
      </div>
      <dl class="hero-facts">
        <dt>넣은 돈</dt><dd>${depStr}</dd>
        ${hasOut ? `<dt>뺀 돈</dt><dd>${outStr}</dd>` : ''}
        ${hasOut ? `<dt>순투입</dt><dd>${netStr}</dd>` : ''}
        <dt>평가</dt><dd>${valStr}</dd>
        <dt data-note-anchor>결산</dt><dd>${retParts.join(' · ') || '–'}</dd>
      </dl>
      <label class="small" style="display:flex; align-items:center; gap:7px; margin-top:10px; cursor:pointer;">
        <input type="checkbox" id="net-fees" style="width:auto; margin:0;" ${netFee ? 'checked' : ''}>
        <span>수수료·세금 빼고 보기 ${netFee && pf.sellCostKRW > 0
          ? `<b>(−${money(pf.sellCostKRW)})</b>`
          : '<span class="muted">— 지금 전부 팔면 드는 비용</span>'}</span>
      </label>
      <p class="small muted" data-note style="margin:6px 0 0;">지금 보유 종목을 <b>전부 판다고 가정</b>하고 수수료·세금을 뺍니다(토스증권 기준).
      국내는 수수료 0.015% + 매도 세금 0.20%(유가증권 거래세 0.05%+농특세 0.15%, 코스닥 거래세 0.20%),
      미국은 수수료 0.1% + SEC Fee(매도대금의 0.00206%와 $0.01 중 큰 값)입니다.
      현금과 이미 판 기록에는 영향이 없고, 실제로 팔아 달러를 원화로 바꾸면 환전 수수료가 더 듭니다.</p>
      ${hasOut ? `<p class="small muted" data-note style="margin:6px 0 0;">수익률은 <b>실제로 넣고 뺀 돈</b> 기준입니다 —
      (평가 + 뺀 돈 − 넣은 돈) ÷ <b>순투입</b>. 같은 돈이 들락거려도 분모가 부풀지 않습니다.</p>` : ''}
    </div>
    ${ln ? `<a href="#/cost" class="card loan-card" style="display:block; text-decoration:none; color:inherit;">
      <div class="trade-head">
        <b>대출 이자</b>
        <span class="muted small">${ln.openAccts.length}건 · 잔액 ${fmtMoney(ln.balance)} · 평균 연 ${ln.wRate.toFixed(2)}%</span>
        <span class="amt" style="color:var(--warn-ink);">이번 달 ${fmtMoney(ln.monthly)}</span>
      </div>
      <div class="trade-meta">
        <span>누적 이자 ${fmtMoney(ln.cumulative)}</span>
        <span>이자 차감 후 실질 손익 <b class="${pctClass(ln.netProfit)}">${fmtMoney(ln.netProfit)}</b></span>
        <span style="margin-left:auto; color:var(--sub);">›</span>
      </div>
    </a>` : ''}
    <div class="card">
      <h3>보유 종목</h3>
      <div class="tbl-wrap"><table class="tbl hold-tbl">
        <tr><th>종목</th><th class="num">그래프</th><th class="num">수익률</th><th class="num">수량<br><span class="muted">(평단가)</span></th><th class="num">매입액<br><span class="muted">(매입비중)</span></th><th class="num">평가액<br><span class="muted">(평가비중)</span></th><th class="num">보유기간</th></tr>
        ${holdRows || '<tr><td colspan="7" class="muted">보유 중인 종목이 없습니다</td></tr>'}${cashRows}
      </table></div>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-act="buy">매수 기록</button>
      <button class="btn" data-act="sell">매도 기록</button>
      <button class="btn" data-act="diary">일지 쓰기</button>
    </div>`;
}
vHome.bind_ = (root) => {
  root.querySelectorAll('.row-link[data-sym]').forEach(tr => tr.addEventListener('click', () => go('symbol/' + encodeURIComponent(tr.dataset.sym))));
  root.querySelectorAll('.row-link[data-cash]').forEach(tr => tr.addEventListener('click', () => openCashModal(tr.dataset.cash)));
  root.querySelector('[data-act=first-trade]')?.addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=buy]')?.addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=sell]')?.addEventListener('click', () => openTradeForm('sell'));
  root.querySelector('[data-act=diary]')?.addEventListener('click', () => go('diary'));
  root.querySelector('#hero-eye')?.addEventListener('click', () => { heroHidden = !heroHidden; render(); });
  root.querySelector('#net-fees')?.addEventListener('change', e => {
    state.settings.netOfFees = e.target.checked;
    state.settings.updatedAt = Date.now();
    saveNow(); render();
  });
};
registerView('home', vHome);

// ---------- 매매 기록 아이템 (기록 페이지·종목 페이지 공용) ----------
function tradeItemHtml(t, r, { link = true } = {}) {
  const cur = P.currencyOf(t.symbol);
  const amt = t.price * t.qty;
  const nameHtml = link
    ? `<a class="nm" href="#/symbol/${encodeURIComponent(t.symbol)}">${esc(t.name || t.symbol)} <span class="chev">›</span></a>`
    : `<span class="nm">${esc(t.name || t.symbol)}</span>`;
  // 메타 칩(매도이유·실현·보유·감정 등) — 있을 때만 한 줄 추가한다. 버튼은 제목줄로 올려
  // 메모 없는 매매가 불필요하게 세 줄로 늘어나지 않게 한다(빈 줄 = 행 높이 낭비).
  const chips = [];
  if (t.side === 'buy') {
    if (t.sellPlan) chips.push(`<span title="${esc(t.sellPlan)}">매도 조건 있음</span>`);
  } else {
    if (t.sellReasonType) chips.push(`<span class="tag">${esc(t.sellReasonType)}</span>`);
    if (r && r.ret != null) chips.push(`<span class="${pctClass(r.ret)}">실현 ${fmtPct(r.ret)}</span>`);
    if (r && r.holdDays != null) chips.push(`<span>보유 ${Math.round(r.holdDays)}일</span>`);
  }
  for (const e of (t.emotions || [])) chips.push(`<span class="tag">${esc(e)}</span>`);
  return `
    <div class="trade-item" data-id="${t.id}">
      <div class="trade-head">
        <span class="tag ${t.side}">${t.side === 'buy' ? '매수' : '매도'}</span>
        ${nameHtml}
        <span class="dt">${t.date}</span>
        ${t.sample ? '<span class="tag warn">예시</span>' : ''}
        ${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}
        <span class="amt">${fmtQty(t.qty)}주 @ ${fmtMoney(t.price, cur)} <span class="muted">· ${fmtMoney(amt, cur)}</span></span>
        <span class="acts">
          <button class="btn small" data-edit="${t.id}">수정</button>
          <button class="btn small danger" data-del="${t.id}">삭제</button>
        </span>
      </div>
      ${t.reason ? `<div class="trade-body">${esc(t.reason)}</div>` : ''}
    </div>`;
}
function bindTradeItems(root) {
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const t = state.trades.find(x => x.id === b.dataset.edit);
    if (t) openTradeForm(t.side, t);
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const t = state.trades.find(x => x.id === b.dataset.del);
    if (!t) return;
    const ok = await confirmModal({
      title: '기록 삭제',
      body: `${t.date} ${t.name || t.symbol} ${t.side === 'buy' ? '매수' : '매도'} ${t.qty}주 기록을 삭제합니다.\n삭제하면 복기 데이터도 함께 사라집니다.`
        + cashLinkText(Store.cashLinkOf(state, t.id)),
      okLabel: '삭제', danger: true,
    });
    if (!ok) return;
    const back = Store.revertCash(state, t.id);
    Store.removeItem(state, 'trades', t.id);
    saveNow(); render(); toast(back ? '삭제했습니다 — 현금 잔액도 되돌렸습니다' : '삭제했습니다');
  }));
}

// ---------- 현금 잔액 연동 표시 공용 ----------
const CUR_NAME = { KRW: '원화', USD: '달러' };
function cashLineHtml(plan, curs) {
  if (plan.skip === 'none') return '<span class="muted">현금 잔액을 아직 입력하지 않아 잔액은 바꾸지 않습니다.</span>';
  if (plan.skip === 'later') return `<span class="muted">${plan.laterDate}에 입력한 잔액이 있어 잔액은 바꾸지 않습니다 — 그 잔액에 이미 반영됐다고 봅니다.</span>`;
  const show = curs.filter(c => plan.delta[c] || plan.short[c]);
  if (!show.length) {
    return `현금 잔액 ${curs.map(c => `${CUR_NAME[c]} <b>${fmtMoney(plan.before[c], c)}</b>`).join(' · ')}
      <span class="muted">— 저장하면 금액만큼 함께 바뀝니다</span>`;
  }
  const short = show.filter(c => plan.short[c]).map(c => `${CUR_NAME[c]} ${fmtMoney(plan.short[c], c)}`).join(' · ');
  return `현금 잔액 ${show.map(c => `${CUR_NAME[c]} <b>${fmtMoney(plan.before[c], c)} → ${fmtMoney(plan.after[c], c)}</b>`).join(' · ')}
    <span class="muted">(${plan.date} 기준으로 함께 기록)</span>`
    + (short ? `<br><span style="color:var(--warn-ink);">잔액이 ${short} 모자라 0에서 멈춥니다 — 다른 통화로 결제됐다면 환전도 기록하세요.</span>` : '');
}
// 지우기 확인창에 붙일 한 줄 (연동돼 있지 않으면 빈 문자열)
function cashLinkText(link) {
  if (!link) return '';
  const parts = Object.entries(link.d).filter(([, v]) => v)
    .map(([c, v]) => `${CUR_NAME[c]} ${v > 0 ? '−' : '+'}${fmtMoney(Math.abs(v), c)}`);
  return parts.length ? `\n현금 잔액도 함께 되돌립니다: ${parts.join(', ')}` : '';
}
// 저장 알림 꼬리 — 바뀐 통화의 새 잔액
const cashToast = plan => (!plan || plan.skip) ? ''
  : ' — 현금 잔액 ' + ['KRW', 'USD'].filter(c => plan.delta[c]).map(c => fmtMoney(plan.after[c], c)).join(' · ');

// ---------- 기록 ----------
const CAP_SLACK = { KRW: 100, USD: 0.05 };
// '전액'은 한도를 넘지 않게 내림한다
const floorCur = (v, cur) => cur === 'USD' ? Math.floor(v * 100 + 1e-6) / 100 : Math.floor(v + 1e-6);
const md = d => d.slice(5).replace('-', '/');
// 출금·환전 한도 — 이 날짜 전 마지막 입력 잔액 + 그 뒤 기록된 돈의 흐름 (engine.cashAvailable)
function cashCap(date, cur, stage, what) {
  const av = E.cashAvailable(state, date, { stage });
  if (!av) return { max: null, note: `이 날짜 전에 입력한 현금 잔액이 없어 ${what} 한도를 계산할 수 없습니다 — 설정에서 현금 잔액을 먼저 입력하세요.` };
  return {
    max: av[cur],
    basis: `${md(av.basisDate)} 입력 잔액에 그 뒤 기록을 반영한 금액`,
    fmt: v => fmtMoney(floorCur(v, cur), cur),
    slack: CAP_SLACK[cur],
    fill: v => floorCur(v, cur),
  };
}

// ---------- 현금 입출금 폼 ----------
function openCashMoveForm() {
  const today = todayStr();
  const m = openModal(`
    <h2>현금 입출금</h2>
    <form id="mv-form">
      <div class="form-grid">
        <label class="fld">날짜
          <input type="date" name="date" max="${today}" value="${today}" required>
        </label>
        <label class="fld">구분
          <select name="kind">
            <option value="out">출금 (펀드 밖으로)</option>
            <option value="in">입금 (펀드로)</option>
          </select>
        </label>
        <label class="fld">통화
          <select name="cur">
            <option value="KRW">원화</option>
            <option value="USD">달러</option>
          </select>
        </label>
        <label class="fld">금액
          <input name="amount" type="text" inputmode="decimal" autocomplete="off" required>
          <span class="muted small" data-cap style="display:none; margin-top:4px; font-weight:400;"></span>
        </label>
        <label class="fld full">메모 (선택)
          <input name="note" maxlength="60" placeholder="예: 생활비로 인출">
        </label>
        <label class="fld full" style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="notmine" style="width:auto; margin:0;">
          <span>내 자본이 아닙니다 <span class="muted small">— 남의 돈을 잠시 맡아 계좌에 둔 경우</span></span>
        </label>
      </div>
      <p class="small" data-keep id="mv-cash" style="margin:8px 0 0;"></p>
      <p class="hint" style="margin:8px 0 0;">출금은 투입 원금에서 빠지고, 입금은 더해집니다.
      수익률은 이 돈이 오간 것 때문에 좋아지거나 나빠지지 않습니다 — 자본 이동이지 손익이 아니니까요.<br>
      <b>'내 자본이 아닙니다'</b>를 켜면 원금·출금에는 넣지 않고 장부의 현금만 맞춥니다. 그 돈으로 결제된
      내 매수가 '밖에서 새로 들어온 돈'으로 잘못 잡히는 것을 막아 줍니다.</p>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" type="button" data-x="cancel">취소</button>
        <button class="btn primary" type="submit">저장</button>
      </div>
    </form>`);
  m.querySelector('[data-x=cancel]').addEventListener('click', closeModal);
  const mf = m.querySelector('#mv-form');
  bindThousands(mf.amount);
  // 출금은 그 통화로 쓸 수 있는 현금까지만. 입금은 상한이 없다.
  const cap = bindCap(mf.amount, mf.querySelector('[data-cap]'),
    () => mf.kind.value === 'out' ? cashCap(mf.date.value, mf.cur.value, 'out', '출금') : null);
  ['kind', 'cur', 'date'].forEach(n => mf[n].addEventListener('change', cap.refresh));
  // 저장하면 현금 잔액이 어떻게 바뀌는지 미리 보여 준다 (입출금 ↔ 잔액 연동)
  const cashLine = m.querySelector('#mv-cash');
  const syncCashLine = () => {
    const plan = Store.planMoveCash(state, { date: mf.date.value, kind: mf.kind.value, cur: mf.cur.value, amount: numOf(mf.amount) || 0 });
    cashLine.innerHTML = cashLineHtml(plan, [mf.cur.value]);
  };
  ['kind', 'cur', 'date'].forEach(n => mf[n].addEventListener('change', syncCashLine));
  mf.amount.addEventListener('input', syncCashLine);
  syncCashLine();
  mf.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const amount = numOf(f.amount);
    if (!(amount > 0)) { toast('금액을 입력하세요'); return; }
    if (cap.over()) { toast(cap.message(), 4200); f.amount.focus(); return; }
    const mv = {
      id: uid(), date: f.date.value, kind: f.kind.value, cur: f.cur.value,
      amount, note: f.note.value.trim(),
      ...(f.notmine.checked ? { capital: false } : {}),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.cashMoves = [...(state.cashMoves || []), mv];
    const plan = Store.applyMoveCash(state, mv);
    saveNow(); closeModal(); render();
    const label = f.kind.value === 'out' ? '출금' : '입금';
    toast(`${label}을 기록했습니다` + cashToast(plan), 3200);
  });
}

// ---------- 배당·이자 기록 폼 ----------
// 매매가 아닌 수입. 원금에는 넣지 않고 장부의 현금만 늘린다.
function openIncomeForm() {
  const today = todayStr();
  const m = openModal(`
    <h2>배당·이자 기록</h2>
    <form id="inc-form">
      <div class="form-grid">
        <label class="fld">받은 날
          <input type="date" name="date" max="${today}" value="${today}" required>
        </label>
        <label class="fld">종류
          <select name="kind">
            <option>배당</option>
            <option>이자</option>
            <option>기타</option>
          </select>
        </label>
        <label class="fld">통화
          <select name="cur">
            <option value="KRW">원화</option>
            <option value="USD">달러</option>
          </select>
        </label>
        <label class="fld">받은 금액 <span class="muted small">— 세후</span>
          <input name="amount" type="text" inputmode="decimal" autocomplete="off" required>
        </label>
        <label class="fld full">종목 (선택)
          <input name="name" maxlength="40" placeholder="예: 코카콜라">
        </label>
        <label class="fld full">메모 (선택)
          <input name="note" maxlength="60" placeholder="예: 3분기 배당">
        </label>
      </div>
      <p class="small" data-keep id="inc-cash" style="margin:8px 0 0;"></p>
      <p class="hint" style="margin:8px 0 0;">배당·이자는 <b>원금(넣은 돈)에 들어가지 않습니다</b> — 자본이 아니라 수익이니까요.
      대신 장부의 현금이 늘어, 그 돈으로 산 주식이 '밖에서 새로 들어온 돈'으로 잘못 잡히지 않습니다.</p>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" type="button" data-x="cancel">취소</button>
        <button class="btn primary" type="submit">저장</button>
      </div>
    </form>`);
  m.querySelector('[data-x=cancel]').addEventListener('click', closeModal);
  const inf = m.querySelector('#inc-form');
  bindThousands(inf.amount);
  // 저장하면 현금 잔액이 어떻게 바뀌는지 미리 보여 준다
  const incLine = m.querySelector('#inc-cash');
  const syncIncCash = () => {
    const d = E.cashDeltaOf('income', { cur: inf.cur.value, amount: numOf(inf.amount) || 0 });
    incLine.innerHTML = cashLineHtml(Store.planCash(state, inf.date.value || today, d), [inf.cur.value]);
  };
  ['cur', 'date'].forEach(n => inf[n].addEventListener('change', syncIncCash));
  inf.amount.addEventListener('input', syncIncCash);
  syncIncCash();
  inf.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const amount = numOf(f.amount);
    if (!(amount > 0)) { toast('받은 금액을 입력하세요'); return; }
    const r = {
      id: uid(), date: f.date.value, cur: f.cur.value, amount,
      kind: f.kind.value, name: f.name.value.trim(), note: f.note.value.trim(),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.incomes = [...(state.incomes || []), r];
    const plan = Store.applyCash(state, r.id, r.date, E.cashDeltaOf('income', r));
    saveNow(); closeModal(); render();
    toast('배당·이자를 기록했습니다' + cashToast(plan), 3200);
  });
}

// ---------- 환전 기록 폼 ----------
function openExchangeForm() {
  const today = todayStr();
  const m = openModal(`
    <h2>환전 기록</h2>
    <form id="fx-form">
      <div class="form-grid">
        <label class="fld">날짜
          <input type="date" name="date" max="${today}" value="${today}" required>
        </label>
        <label class="fld">방향
          <select name="from">
            <option value="KRW">원화 → 달러</option>
            <option value="USD">달러 → 원화</option>
          </select>
        </label>
        <label class="fld">보낸 금액 <span class="muted small" data-fxcur>(원)</span> <span class="muted small">— 수수료 포함</span>
          <input name="amount" type="text" inputmode="decimal" autocomplete="off" required>
          <span class="muted small" data-cap style="display:none; margin-top:4px; font-weight:400;"></span>
        </label>
        <label class="fld">적용 환율 (원/달러)
          <input name="rate" type="text" inputmode="decimal" autocomplete="off" required placeholder="예: 1,385.5">
        </label>
        <label class="fld">그중 수수료 <span class="muted small" data-fxcur2>(원)</span> <span class="muted small">— 참고용</span>
          <input name="fee" type="text" inputmode="decimal" autocomplete="off" placeholder="0">
        </label>
        <label class="fld full">메모 (선택)
          <input name="note" maxlength="60" placeholder="예: 통합증거금 자동환전">
        </label>
      </div>
      <div class="notice" style="margin:10px 0 0;">받게 되는 금액: <b data-fxgot>–</b>
        <span class="small" data-note>보낸 금액 ÷ 적용 환율입니다. 증권사 화면의 금액과 같은지 확인해 주세요 — 다르면 환율을 조정하시면 됩니다.
        수수료는 적용 환율에 이미 녹아 있으므로 계산에서 빼지 않고, 기록으로만 남깁니다.</span></div>
      <p class="small" data-keep id="fx-cash" style="margin:8px 0 0;"></p>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" type="button" data-x="cancel">취소</button>
        <button class="btn primary" type="submit">저장</button>
      </div>
    </form>`);
  m.querySelector('[data-x=cancel]').addEventListener('click', closeModal);
  const f = m.querySelector('#fx-form');
  const got = m.querySelector('[data-fxgot]');

  const preview = () => {
    const c = E.exchangeCalc({ from: f.from.value, amount: numOf(f.amount), rate: numOf(f.rate), fee: numOf(f.fee) });
    const unit = c.from === 'KRW' ? '(원)' : '($)';
    m.querySelector('[data-fxcur]').textContent = unit;
    m.querySelector('[data-fxcur2]').textContent = unit;
    got.textContent = c.got != null && c.sent > 0 ? fmtMoney(c.got, c.to) : '–';
    // 저장하면 두 통화의 현금 잔액이 어떻게 바뀌는지
    const d = E.cashDeltaOf('fx', { from: f.from.value, amount: numOf(f.amount) || 0, rate: numOf(f.rate) || 0 });
    m.querySelector('#fx-cash').innerHTML = cashLineHtml(Store.planCash(state, f.date.value || today, d), ['KRW', 'USD']);
  };
  [f.amount, f.rate, f.fee].forEach(el => bindThousands(el));
  ['from', 'amount', 'rate', 'fee'].forEach(n => f[n].addEventListener('input', preview));
  f.from.addEventListener('change', preview);
  // 보낸 금액은 보내는 통화로 쓸 수 있는 현금까지만 (환전은 그날 매수·출금보다 먼저 일어난다)
  const cap = bindCap(f.amount, f.querySelector('[data-cap]'), () => cashCap(f.date.value, f.from.value, 'fx', '환전'));
  ['from', 'date'].forEach(n => f[n].addEventListener('change', cap.refresh));
  f.date.addEventListener('change', preview);
  // 그날 시장 환율을 미리 채워 둔다 — 실제 적용 환율은 여기서 스프레드만큼 벌어진다
  f.date.addEventListener('change', () => {
    const r = P.fxOn(f.date.value);
    if (r && !f.rate.value) { f.rate.placeholder = `그날 시장환율 ${fmtFx(r)}`; }
  });
  const r0 = P.fxOn(today);
  if (r0) f.rate.placeholder = `그날 시장환율 ${fmtFx(r0)}`;
  preview();

  f.addEventListener('submit', e => {
    e.preventDefault();
    const c = E.exchangeCalc({ from: f.from.value, amount: numOf(f.amount), rate: numOf(f.rate), fee: numOf(f.fee) });
    if (!(c.sent > 0)) { toast('보낸 금액을 입력하세요'); return; }
    if (cap.over()) { toast(cap.message(), 4200); f.amount.focus(); return; }
    if (!(c.rate > 0)) { toast('적용 환율을 입력하세요'); return; }
    if (c.fee > c.sent) { toast('수수료가 보낸 금액보다 큽니다'); return; }
    const x = {
      id: uid(), date: f.date.value, from: c.from,
      amount: c.sent, rate: c.rate, fee: c.fee,
      note: f.note.value.trim(),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.exchanges = [...(state.exchanges || []), x];
    const plan = Store.applyCash(state, x.id, x.date, E.cashDeltaOf('fx', x));
    saveNow(); closeModal(); render();
    toast(`환전을 기록했습니다 — ${fmtMoney(c.got, c.to)} 수령` + (plan.skip ? '' : ` · 현금 잔액 ${fmtMoney(plan.after.KRW, 'KRW')} · ${fmtMoney(plan.after.USD, 'USD')}`), 3600);
  });
}

function vTrades() {
  const trades = E.sortedTrades(state).reverse();
  const { realized } = E.replay(E.sortedTrades(state));
  const retBySell = new Map(realized.map(r => [r.sell.id, r]));
  const items = trades.map(t => tradeItemHtml(t, retBySell.get(t.id))).join('');

  const gap = E.cashGap(state);
  const mvItems = E.cashMoveLog(state).slice().reverse().map(mv => {
    const out = mv.kind === 'out';
    return `
    <li>
      <div class="trade-head">
        <span class="tag ${out ? 'sell' : 'buy'}">${out ? '출금' : '입금'}</span>
        ${mv.capital === false ? '<span class="tag" style="margin-left:4px;">내 자본 아님</span>' : ''}
        <span class="dt muted small" style="margin-left:6px;">${mv.date}</span>
        <span class="amt small ${out ? 'down' : 'up'}">${out ? '-' : '+'}${fmtMoney(mv.amount, mv.cur)}</span>
      </div>
      ${mv.note ? `<div class="trade-body">${esc(mv.note)}</div>` : ''}
      <div class="trade-meta"><span style="margin-left:auto;"><button class="btn small danger" data-delmv="${mv.id}">삭제</button></span></div>
    </li>`;
  }).join('');

  const inc = E.incomeTotals(state);
  const incItems = inc.rows.slice().reverse().map(r => `
    <li>
      <div class="trade-head">
        <span class="tag buy">${esc(r.kind || '기타')}</span>
        <span class="dt muted small" style="margin-left:6px;">${r.date}${r.name ? ` · ${esc(r.name)}` : ''}</span>
        <span class="amt small up">+${fmtMoney(r.amount, r.cur)}</span>
      </div>
      ${r.note ? `<div class="trade-body">${esc(r.note)}</div>` : ''}
      <div class="trade-meta"><span style="margin-left:auto;"><button class="btn small danger" data-delinc="${r.id}">삭제</button></span></div>
    </li>`).join('');

  const fxs = E.exchangeLog(state).slice().reverse();
  const fxItems = fxs.map(x => {
    const c = E.exchangeCalc(x);
    return `
    <li>
      <div class="trade-head">
        <b>${c.from === 'KRW' ? '원화 → 달러' : '달러 → 원화'}</b>
        <span class="dt muted small">${x.date} · 적용환율 ${fmtFx(c.rate)}${c.fee ? ` · 수수료 ${fmtMoney(c.fee, c.from)}` : ''}</span>
        <span class="amt small">${fmtMoney(c.sent, c.from)} → ${c.got != null ? fmtMoney(c.got, c.to) : '–'}</span>
      </div>
      ${x.note ? `<div class="trade-body">${esc(x.note)}</div>` : ''}
      <div class="trade-meta"><span style="margin-left:auto;"><button class="btn small danger" data-delfx="${x.id}">삭제</button></span></div>
    </li>`;
  }).join('');

  return `
    <div class="view-title">매매 기록</div>
    <p class="view-desc">결과가 아니라 판단을 남기는 곳. 팔 때는 살 때의 기록과 대조합니다.</p>
    <div class="btn-row" style="margin:0 0 12px; flex-wrap:wrap;">
      <button class="btn primary" data-act="buy">매수 기록</button>
      <button class="btn" data-act="sell">매도 기록</button>
      <button class="btn" data-act="mv2">입출금</button>
      <button class="btn" data-act="fx2">환전</button>
      <button class="btn" data-act="inc2">배당·이자</button>
    </div>
    ${gap ? `<div class="notice" style="margin:0 0 12px;">
      <b>${gap.date} 입력하신 현금 잔액이 앱 장부와 다릅니다.</b>
      ${Math.abs(gap.KRW) > 1000 ? `원화 <b class="${pctClass(gap.KRW)}">${fmtSigned(gap.KRW)}</b> ` : ''}
      ${Math.abs(gap.USD) > 1 ? `달러 <b class="${pctClass(gap.USD)}">${fmtMoney(gap.USD, 'USD')}</b>` : ''}
      <br><span class="small">인출·입금하신 것이라면 위 <b>입출금</b>에 기록해 주세요.</span>
    </div>` : ''}
    <div class="card">
      ${items || '<div class="empty">아직 기록이 없습니다</div>'}
    </div>
    <div class="card">
      <h3>현금 입출금</h3>
      <p class="small muted" data-note style="margin:4px 0 0;">
        펀드 밖으로 뺀 돈과 새로 넣은 돈입니다. <b>앱은 잔액 차이를 보고 인출을 넘겨짚지 않습니다</b> —
        여기에 남긴 기록만 투입 원금에 반영됩니다.
      </p>
      <div class="btn-row" style="margin:8px 0 0;"><button class="btn small primary" data-act="mv">입출금 기록</button></div>
      ${mvItems ? `<ul class="list-plain">${mvItems}</ul>` : '<div class="empty">아직 입출금 기록이 없습니다</div>'}
    </div>
    <div class="card">
      <h3>배당·이자 <span class="muted small">— 매매가 아닌 수입</span></h3>
      <p class="small muted" data-note style="margin:4px 0 0;">
        배당금·예탁금 이자·대여료처럼 <b>판 것도 아닌데 들어온 돈</b>입니다.
        원금(넣은 돈)에는 넣지 않습니다 — 자본이 아니라 수익이니까요.
      </p>
      ${inc.count ? `<div class="notice" style="margin:8px 0 0;">지금까지 받은 배당·이자
        <b>${[inc.sum.KRW ? fmtMoney(inc.sum.KRW) : null, inc.sum.USD ? fmtMoney(inc.sum.USD, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0)}</b>
        <span class="muted small">· ${inc.count}건</span></div>` : ''}
      <div class="btn-row" style="margin:8px 0 0;"><button class="btn small primary" data-act="inc">배당·이자 기록</button></div>
      ${incItems ? `<ul class="list-plain">${incItems}</ul>` : '<div class="empty">아직 배당·이자 기록이 없습니다</div>'}
    </div>
    <div class="card">
      <h3>환전 내역 <span class="muted small">— 선택 입력</span></h3>
      <p class="small muted" data-note style="margin:4px 0 0;">
        안 넣어도 됩니다. 그때는 앱이 <b>매수 시점의 시장 환율</b>로 환전했다고 보고 계산합니다.
        실제 적용 환율과 수수료를 넣으면 그 기록이 우선해 원금이 더 정확해집니다.
      </p>
      <div class="btn-row" style="margin:8px 0 0;"><button class="btn small primary" data-act="fx">환전 기록</button></div>
      ${fxItems ? `<ul class="list-plain">${fxItems}</ul>` : '<div class="empty">아직 환전 기록이 없습니다</div>'}
    </div>`;
}
vTrades.bind_ = (root) => {
  root.querySelector('[data-act=buy]').addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=sell]').addEventListener('click', () => openTradeForm('sell'));
  // 매매 기록이 수백 건이면 아래 카드는 한참 스크롤해야 보인다 — 상단에도 같은 버튼을 둔다.
  root.querySelectorAll('[data-act=mv], [data-act=mv2]').forEach(b => b.addEventListener('click', () => openCashMoveForm()));
  root.querySelectorAll('[data-act=fx2]').forEach(b => b.addEventListener('click', () => openExchangeForm()));
  root.querySelectorAll('[data-act=inc], [data-act=inc2]').forEach(b => b.addEventListener('click', () => openIncomeForm()));
  root.querySelectorAll('[data-delinc]').forEach(b => b.addEventListener('click', async () => {
    const r = (state.incomes || []).find(x => x.id === b.dataset.delinc);
    if (!r) return;
    if (!await confirmModal({
      title: '이 배당·이자 기록을 지울까요?',
      body: `${r.date} · ${r.kind || '기타'} ${fmtMoney(r.amount, r.cur)}` + cashLinkText(Store.cashLinkOf(state, r.id)),
      okLabel: '지우기', danger: true,
    })) return;
    const back = Store.revertCash(state, r.id);
    Store.removeItem(state, 'incomes', b.dataset.delinc);
    saveNow(); render(); toast(back ? '지웠습니다 — 현금 잔액도 되돌렸습니다' : '지웠습니다');
  }));
  root.querySelectorAll('[data-delmv]').forEach(b => b.addEventListener('click', async () => {
    const mv = (state.cashMoves || []).find(x => x.id === b.dataset.delmv);
    if (!mv) return;
    if (!await confirmModal({
      title: `이 ${mv.kind === 'out' ? '출금' : '입금'} 기록을 지울까요?`,
      body: `${mv.date} · ${fmtMoney(mv.amount, mv.cur)}\n\n지우면 그만큼 투입 원금이 되돌아갑니다.` + cashLinkText(Store.cashLinkOf(state, mv.id)),
      okLabel: '지우기', danger: true,
    })) return;
    const back = Store.revertCash(state, mv.id);
    Store.removeItem(state, 'cashMoves', b.dataset.delmv);
    saveNow(); render(); toast(back ? '지웠습니다 — 현금 잔액도 되돌렸습니다' : '지웠습니다');
  }));
  root.querySelector('[data-act=fx]').addEventListener('click', () => openExchangeForm());
  root.querySelectorAll('[data-delfx]').forEach(b => b.addEventListener('click', async () => {
    const x = (state.exchanges || []).find(e => e.id === b.dataset.delfx);
    if (!x) return;
    const c = E.exchangeCalc(x);
    if (!await confirmModal({
      title: '이 환전 기록을 지울까요?',
      body: `${x.date} · ${fmtMoney(c.sent, c.from)} → ${c.got != null ? fmtMoney(c.got, c.to) : '–'}\n\n지우면 그 환전은 다시 '매수 시점 시장 환율'로 자동 계산됩니다.`
        + cashLinkText(Store.cashLinkOf(state, x.id)),
      okLabel: '지우기', danger: true,
    })) return;
    const back = Store.revertCash(state, x.id);
    Store.removeItem(state, 'exchanges', b.dataset.delfx);
    saveNow(); render(); toast(back ? '지웠습니다 — 현금 잔액도 되돌렸습니다' : '지웠습니다');
  }));
  bindTradeItems(root);
};
registerView('trades', vTrades);

// ---------- 종목 상세 (보유 종목 클릭 시) ----------
function vSymbol(symbol) {
  const netFee = !!state.settings.netOfFees;   // 홈에서 켠 '수수료·세금 빼고 보기'를 그대로 따른다
  const symTrades = E.sortedTrades(state).filter(t => t.symbol === symbol).reverse();
  if (!symbol || !symTrades.length) {
    return `
      <div class="view-title">종목</div>
      <div class="empty">${esc(symbol || '')} 매매 기록이 없습니다</div>
      <div class="btn-row"><a class="btn" href="#/home">← 홈으로</a></div>`;
  }
  const name = symTrades.find(t => t.name)?.name || symbol;
  const cur = P.currencyOf(symbol);
  const { realized } = E.replay(E.sortedTrades(state));
  const retBySell = new Map(realized.map(r => [r.sell.id, r]));
  const symRealized = realized.filter(r => r.sell.symbol === symbol);
  const realizedPnl = symRealized.reduce((s, r) => s + r.pnl, 0);
  const realizedCost = symRealized.reduce((s, r) => s + r.costSum, 0);
  const pf = E.portfolio(state);
  const pos = pf.rows.find(r => r.symbol === symbol);
  const last = P.last(symbol);
  const frozen = P.frozenSince(symbol);

  const stat = (k, v, cls = '') => `<tr><td class="muted">${k}</td><td class="num ${cls}"><b>${v}</b></td></tr>`;
  // 수수료·세금을 빼고 보는 중이면 수익률도 그 기준으로
  const posRet = !pos ? null
    : (netFee ? (pos.cost > 0 ? (pos.value - pos.sellCost) / pos.cost - 1 : null) : pos.ret);
  const summary = `
    <div class="tbl-wrap"><table class="tbl">
      ${pos ? `
        ${stat('보유 수량', fmtQty(pos.qty) + '주')}
        ${stat('평균 단가', fmtMoney(pos.avgPrice ?? (pos.cost / pos.qty), cur))}
        ${stat('평가액', fmtMoney(pos.value - (netFee ? pos.sellCost : 0), cur))}
        ${netFee ? stat('예상 수수료·세금', `−${fmtMoney(pos.sellCost, cur)}`) : ''}
        ${stat('평가손익', `${fmtMoney(pos.value - (netFee ? pos.sellCost : 0) - pos.cost, cur)} (${fmtPct(posRet)})`, pctClass(posRet))}
      ` : stat('보유', '없음 (전량 매도)')}
      ${symRealized.length ? stat('실현 손익', `${fmtMoney(realizedPnl, cur)}${realizedCost > 0 ? ` (${fmtPct(realizedPnl / realizedCost)})` : ''}`, pctClass(realizedPnl)) : ''}
    </table></div>`;

  const items = symTrades.map(t => tradeItemHtml(t, retBySell.get(t.id), { link: false })).join('');

  // 주가 차트 — 첫 매수일부터 지금까지. 선에 커서를 올리면 그날 종가가, 매매한 날엔 그 내역도 뜬다.
  const firstBuyDate = symTrades.length ? symTrades[symTrades.length - 1].date : null;
  const ser = P.seriesFrom(symbol, firstBuyDate);
  const priceChart = ser.values.length > 1 ? lineChart({
    labels: ser.labels,
    height: 260,
    format: v => fmtMoney(v, cur),
    series: [{ label: '종가', color: 'var(--accent)', values: ser.values }],
    points: symTrades.map(t => ({
      date: t.date,
      color: t.side === 'buy' ? 'var(--up)' : 'var(--down)',
      label: `${t.side === 'buy' ? '매수' : '매도'} ${fmtQty(t.qty)}주 @ ${fmtMoney(t.price, cur)}`,
    })),
  }) : '';

  return `
    <div class="view-title">${esc(name)}</div>
    <p class="view-desc" data-keep>${esc(symbol)}${last ? ` · 현재가 ${fmtMoney(last.close, cur)} <span class="muted">(${P.lastStamp(symbol)})</span>` : ' · 시세 없음'}${frozen ? ` <span class="tag warn">${frozen}부터 시세 멈춤</span>` : ''}</p>
    ${priceChart ? `<div class="card">
      <h3>주가 (${esc(firstBuyDate)} 첫 매수 이후)</h3>
      ${priceChart}
      <p class="hint">선 위에 커서를 올리면 <b>그날 날짜와 종가</b>가 보입니다. 점은 내가 매매한 날입니다
      (<span class="up">●</span> 매수 / <span class="down">●</span> 매도) — 그 점에 올리면 수량·단가도 함께 뜹니다.
      ${ser.split ? '<br><b>주의:</b> 이 구간에 액면분할·병합이 있어 선이 그 지점에서 끊겨 보입니다(실제 종가 그대로 그리기 때문).' : ''}</p>
    </div>` : ''}
    <div class="card"><h3>현황</h3>${summary}
      <div class="btn-row">
        <button class="btn primary" data-act="sym-buy" data-sym="${esc(symbol)}">매수 기록</button>
        ${pos ? `<button class="btn" data-act="sym-sell" data-sym="${esc(symbol)}">매도 기록</button>` : ''}
      </div>
    </div>
    <div class="card"><h3>매매 기록 (${symTrades.length}건)</h3>${items}</div>
    <div class="btn-row"><button class="btn" data-act="back">← 뒤로</button></div>`;
}
vSymbol.bind_ = (root) => {
  bindCharts(root);
  bindTradeItems(root);
  // 이 종목이 미리 골라진 매수·매도 창
  root.querySelector('[data-act=sym-buy]')?.addEventListener('click', e => openTradeForm('buy', null, { symbol: e.currentTarget.dataset.sym }));
  root.querySelector('[data-act=sym-sell]')?.addEventListener('click', e => openTradeForm('sell', null, { symbol: e.currentTarget.dataset.sym }));
  // 온 곳(기록·홈 등)으로 되돌아간다. 히스토리가 없으면 홈.
  root.querySelector('[data-act=back]')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else go('home');
  });
};
registerView('symbol', vSymbol);

// ---------- 매매 입력 폼 ----------
function emotionChips(selected = []) {
  return Store.EMOTIONS.map(e =>
    `<span class="chip ${selected.includes(e) ? 'on' : ''}" data-emo="${esc(e)}">${esc(e)}</span>`).join('');
}

// 종목 입력칸의 추천 목록 순서. 예전엔 시세 저장소 등록 순서(사실상 무순서)라 찾기 어려웠다.
function symbolChoices() {
  const pf = E.portfolio(state);
  const held = new Map(pf.rows.map(r => [r.symbol, r]));

  // 종목별 마지막 매도일 (보유 중이 아니면 그게 곧 전량 매도 시점)
  const lastSell = new Map();
  for (const t of E.sortedTrades(state)) {
    if (t.side === 'sell') lastSell.set(t.symbol, t.date);
  }
  // 매매 기록이 있는 종목 + 시세에 등록된 종목을 모두 후보로
  const names = new Map();
  for (const t of state.trades) if (t.name) names.set(t.symbol, t.name);
  const cand = new Set([
    ...state.trades.map(t => t.symbol),
    ...P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X'),
  ]);

  const rows = [...cand].map(sym => {
    const h = held.get(sym);
    const name = P.info(sym)?.name || names.get(sym) || '';
    return {
      symbol: sym,
      name,
      rank: h ? 0 : (lastSell.has(sym) ? 1 : 2),
      costKRW: h ? (h.costKRW || 0) : 0,     // 보유분 매입액(원화)
      soldAt: lastSell.get(sym) || '',
      label: h
        ? `${name} — 보유 ${fmtQty(h.qty)}주 · 매입 ${fmtMoney(h.cost, h.cur)}`
        : (lastSell.has(sym) ? `${name} — ${lastSell.get(sym)} 전량 매도` : name),
    };
  });

  rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank === 0) return b.costKRW - a.costKRW;          // 매입액 큰 순
    if (a.rank === 1) return a.soldAt < b.soldAt ? 1 : -1;   // 최근 매도 순
    return (a.name || a.symbol).localeCompare(b.name || b.symbol, 'ko');
  });
  return rows;
}

// preset: 새 기록의 초기값(예: 종목 화면에서 연 경우 { symbol }) — existing과 달리 '수정'이 아니다.
export function openTradeForm(side, existing = null, preset = {}) {
  const isBuy = side === 'buy';
  const today = todayStr();
  const t = existing || preset;

  // 매도: 현재 보유 종목 목록
  let sellOptions = '';
  if (!isBuy) {
    const pf = E.portfolio(state);
    if (!pf.rows.length && !existing) { toast('보유 종목이 없습니다. 먼저 매수를 기록하세요.'); return; }
    // 매입액(원화) 많은 순 — 종목 추천 목록(symbolChoices)과 같은 기준으로 맞춘다.
    const bySize = [...pf.rows].sort((a, b) => (b.costKRW || 0) - (a.costKRW || 0));
    sellOptions = bySize.map(r =>
      `<option value="${esc(r.symbol)}" ${t.symbol === r.symbol ? 'selected' : ''}>${esc(r.name)} (${esc(r.symbol)}) — 보유 ${fmtQty(r.qty)}주 · 매입 ${fmtMoney(r.cost, r.cur)}</option>`).join('');
    if (existing && !pf.rows.some(r => r.symbol === t.symbol)) {
      sellOptions += `<option value="${esc(t.symbol)}" selected>${esc(t.name || t.symbol)}</option>`;
    }
  }

  const knownList = symbolChoices()
    .map(o => `<option value="${esc(o.symbol)}">${esc(o.label)}</option>`).join('');

  const manualPrinciples = state.principles.filter(p => p.active && p.kind === 'manual');

  const m = openModal(`
    <h2>${existing ? '기록 수정' : (isBuy ? '매수 기록' : '매도 기록')}</h2>
    <form id="trade-form">
      <div class="form-grid">
        <label class="fld full">종목 <span id="name-hint" class="muted"></span>
          ${isBuy
            ? `<input name="symbol" list="symlist" placeholder="종목 번호 또는 티커 (예: 005930 또는 AAPL)" value="${esc(t.symbol || '')}" required autocomplete="off">
               <datalist id="symlist">${knownList}</datalist>`
            : `<select name="symbol" required>${sellOptions}</select>`}
        </label>
        ${isBuy ? `
        <label class="fld full" id="mkt-row" hidden>어느 시장의 종목입니까 <span class="muted small">— 처음 기록하는 종목이라 확인이 필요합니다</span>
          <select name="market">
            <option value="">고르세요</option>
            <option value="KS">한국 · 코스피</option>
            <option value="KQ">한국 · 코스닥</option>
            <option value="US">미국</option>
          </select>
        </label>` : ''}
        <label class="fld">날짜
          <input type="date" name="date" max="${today}" value="${t.date || today}" required>
        </label>
        <label class="fld">가격 (1주) <span id="cur-hint" class="muted"></span>
          <input type="text" name="price" inputmode="decimal" autocomplete="off" value="${t.price ?? ''}" required>
        </label>
        <label class="fld">수량
          <input type="text" name="qty" inputmode="decimal" autocomplete="off" value="${t.qty ?? ''}" required>
          ${isBuy ? '' : `<span class="muted small" data-cap style="display:none; margin-top:4px; font-weight:400;"></span>`}
        </label>
        <label class="fld">수수료·세금 (선택)
          <input type="text" name="fee" inputmode="decimal" autocomplete="off" value="${t.fee || ''}">
        </label>

        ${isBuy ? `
        ${manualPrinciples.length ? `<div class="full notice"><b>매수 전 점검 (나의 헌법)</b><br>${manualPrinciples.map(p => '· ' + esc(p.text)).join('<br>')}</div>` : ''}
        <label class="fld full">왜 사는가 (선택) — 미래의 나에게 설명하기
          <textarea name="reason" placeholder="사업·가격에 대한 판단. 팔 때 이 글이 다시 나타납니다.">${esc(t.reason || '')}</textarea>
        </label>
        <label class="fld full">어떤 일이 벌어지면 팔 것인가 (선택, 미리 정하는 매도 조건)
          <textarea name="sellPlan" placeholder="예: 이 사업 논리가 깨지면 / 목표 밸류에이션 도달하면">${esc(t.sellPlan || '')}</textarea>
        </label>
        ` : `
        <div class="full" id="past-record"></div>
        <label class="fld full">지금 파는 이유는 어느 쪽에 가깝습니까
          <select name="sellReasonType">
            ${Store.SELL_REASON_TYPES.map(x => `<option ${t.sellReasonType === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </label>
        <label class="fld full">매도 이유 (선택)
          <textarea name="reason" placeholder="위에 보이는 '살 때의 나'와 대조해서 쓰기">${esc(t.reason || '')}</textarea>
        </label>
        `}
        <div class="full">
          <span class="fld">지금의 감정 (해당하는 것 모두)</span>
          <div class="chips" id="emo-chips">${emotionChips(t.emotions || [])}</div>
        </div>
      </div>
      <p class="small" data-keep id="tr-cash" style="margin:8px 0 0;"></p>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" class="btn" data-x="cancel">취소</button>
        <button type="submit" class="btn primary">${existing ? '수정 저장' : '기록하기'}</button>
      </div>
    </form>`);

  const form = m.querySelector('#trade-form');
  const curHint = m.querySelector('#cur-hint');
  const nameHint = m.querySelector('#name-hint');

  const mktRow = m.querySelector('#mkt-row');

  // 처음 보는 종목일 때만 시장을 묻는다 — 이미 아는 종목엔 칸이 나타나지 않는다.
  function syncMarketRow() {
    if (!mktRow) return;
    const raw = form.symbol.value.trim().toUpperCase();
    const need = P.needsMarket(raw);
    mktRow.hidden = !need;
    if (!need) { form.market.value = ''; return; }
    // 종목을 바꾸면 앞서 고른 값이 그대로 남지 않게 입력 모양에 맞춰 다시 잡는다.
    // 영문 티커는 KRX일 수 없으므로 미국으로 두고, 국내 코드는 반드시 직접 고르게 한다.
    if (!P.KR_CODE.test(raw)) form.market.value = 'US';
    else if (form.market.value === 'US') form.market.value = '';
  }

  // 폼이 가리키는 최종 심볼 — 시장을 골랐으면 그것을 따르고, 아니면 종전대로 추정한다
  function formSymbol() {
    return mktRow && !mktRow.hidden
      ? P.applyMarket(form.symbol.value, form.market.value)
      : P.resolveSymbol(form.symbol.value);
  }

  // 가격칸의 현재 값이 '앱이 채운 제안값'인가. 기존 기록을 고치는 중이면 사용자의 값이므로 false.
  let priceAuto = !(t.price ?? '');

  function updateSymbolInfo() {
    syncMarketRow();
    const raw = form.symbol.value;
    if (!raw) { if (nameHint) nameHint.textContent = ''; return; }
    const sym = formSymbol();
    const info = P.info(sym);
    if (info) {
      if (nameHint) nameHint.textContent = `— ${info.name}`; // 종목명 자동
      // 라벨이 길면 두 줄로 접혀 옆 칸(날짜)과 높이가 어긋난다. 통화는 금액 기호(₩·$)로
      const l = P.last(sym);
      curHint.textContent = l
        ? ` · 최근 종가 ${fmtMoney(l.close, info.currency)} (${l.date})`
        : ` · ${info.currency}`;
      // 그 날짜의 종가를 가격칸에 제안한다.
      if (!form.price.value || priceAuto) {
        const c = P.closeOn(sym, form.date.value || today);
        if (c) { setNum(form.price, c); priceAuto = true; }
      }
    } else {
      if (nameHint) nameHint.textContent = '';
      curHint.textContent = `· 시세 미등록 (${P.currencyOf(sym)} 추정) — 종목명은 시세 등록 후 자동 설정됩니다`;
    }
  }
  form.symbol.addEventListener('change', updateSymbolInfo);
  form.symbol.addEventListener('input', syncMarketRow);   // 타이핑 도중에도 칸이 바로 뜨게
  form.market?.addEventListener('change', updateSymbolInfo);
  // 사용자가 가격을 직접 건드린 순간부터는 앱이 갈아 끼우지 않는다
  form.price.addEventListener('input', () => { priceAuto = false; });
  // 세 자리마다 콤마 — 큰 숫자를 눈으로 확인하며 넣을 수 있게. 값은 numOf로 읽는다.
  [form.price, form.qty, form.fee].forEach(el => el && bindThousands(el));
  // 가격칸 방향키 — 한국 종목이면 호가 단위로, 그 외(달러 등)는 기본(±1) 동작.
  bindKrArrowStep(form.price, () => {
    const sym = formSymbol();
    return sym ? P.currencyOf(sym) : null;
  });
  if (!isBuy) {
    const renderPastRecord = () => {
      const sym = form.symbol.value;
      const { open } = E.replay(E.sortedTrades(state), form.date.value || today);
      const lots = open.filter(l => l.t.symbol === sym && l.t.id !== t.id);
      const box = m.querySelector('#past-record');
      if (!lots.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="warnbox" style="background:var(--accent-soft); color:var(--ink);">
        <b>살 때의 나는 이렇게 말했다</b><br>
        ${lots.map(l => `<div style="margin-top:6px;"><span class="muted small">${l.t.date} 매수 ${fmtQty(l.qtyLeft)}주 보유 중</span>${l.t.reason ? `<br>${esc(l.t.reason)}` : ''}${l.t.sellPlan ? `<br><span class="small">매도 조건: ${esc(l.t.sellPlan)}</span>` : ''}</div>`).join('')}
      </div>`;
    };
    form.symbol.addEventListener('change', renderPastRecord);
    form.date.addEventListener('change', renderPastRecord);
    renderPastRecord();
    // 매도 수량은 그날 보유 수량까지만 — 저장 때 이미 막고 있었지만 칸에서는 보이지 않았다.
    // 기록을 고치는 중이면 그 기록 자신은 빼고 센다.
    const qtyCap = bindCap(form.qty, form.querySelector('[data-cap]'), () => {
      const sym = form.symbol.value;
      if (!sym) return null;
      const d = form.date.value || today;
      const others = { ...state, trades: state.trades.filter(x => x.id !== t.id) };
      return { max: E.heldQty(others, sym, d), basis: `${md(d)} 기준 보유 수량`, fmt: v => fmtQty(v) + '주', slack: 1e-9 };
    });
    form.symbol.addEventListener('change', qtyCap.refresh);
    form.date.addEventListener('change', qtyCap.refresh);
  }
  updateSymbolInfo();

  // 저장하면 현금 잔액이 어떻게 바뀌는지 (새 기록). 고치는 중이면 연동돼 있는지만 알린다 —
  // 연동된 기록은 고친 값으로 잔액을 다시 맞추고, 연동 안 된 지난 기록은 잔액을 건드리지 않는다.
  const tradeCash = m.querySelector('#tr-cash');
  const syncTradeCash = () => {
    if (existing) {
      tradeCash.innerHTML = Store.cashLinkOf(state, t.id)
        ? '<span class="muted">이 기록은 현금 잔액에 함께 반영돼 있어, 고치면 잔액도 다시 맞춥니다.</span>'
        : '<span class="muted">현금 잔액과 연결되지 않은 기록이라 고쳐도 잔액은 바꾸지 않습니다.</span>';
      return;
    }
    const sym = isBuy ? formSymbol() : form.symbol.value;
    if (!sym) { tradeCash.innerHTML = ''; return; }
    const d = E.cashDeltaOf('trade', { side, symbol: sym, price: numOf(form.price) || 0, qty: numOf(form.qty) || 0, fee: numOf(form.fee) || 0 });
    tradeCash.innerHTML = cashLineHtml(Store.planCash(state, form.date.value || today, d), Object.keys(d));
  };
  ['price', 'qty', 'fee'].forEach(n => form[n].addEventListener('input', syncTradeCash));
  ['change', 'input'].forEach(ev => form.symbol.addEventListener(ev, syncTradeCash));
  form.date.addEventListener('change', syncTradeCash);
  form.market?.addEventListener('change', syncTradeCash);
  syncTradeCash();

  m.querySelector('#emo-chips').addEventListener('click', e => {
    if (e.target.classList.contains('chip')) e.target.classList.toggle('on');
  });
  m.querySelector('[data-x=cancel]').onclick = closeModal;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (isBuy) syncMarketRow();   // 저장 직전 상태로 맞춘다 (붙여넣기로 채운 경우 대비)
    if (isBuy && mktRow && !mktRow.hidden && !form.market.value) {
      toast('처음 기록하는 종목입니다. 어느 시장인지 골라 주세요', 3600);
      form.market.focus();
      return;
    }
    const symbol = isBuy ? formSymbol() : form.symbol.value;
    const price = numOf(form.price);   // 콤마를 뺀 실제 숫자 (form.price.value 직접 쓰면 안 된다)
    const qty = numOf(form.qty);
    if (!symbol || !(price > 0) || !(qty > 0)) { toast('종목·가격·수량을 확인하세요'); return; }
    const draft = {
      id: t.id || uid(),
      side, symbol,
      name: P.info(symbol)?.name || t.name || symbol, // 종목명 자동
      date: form.date.value,
      price, qty,
      fee: numOf(form.fee) || 0,
      reason: form.reason.value.trim(),
      emotions: [...m.querySelectorAll('#emo-chips .chip.on')].map(c => c.dataset.emo),
      createdAt: t.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (isBuy) {
      draft.sellPlan = form.sellPlan.value.trim();
    } else {
      draft.sellReasonType = form.sellReasonType.value;
      // 보유 수량 검증 (본인 기록 수정 시 자기 자신 제외)
      const others = { ...state, trades: state.trades.filter(x => x.id !== draft.id) };
      const held = E.heldQty(others, symbol, draft.date);
      if (qty > held + 1e-9) {
        toast(`해당일 보유 수량(${fmtQty(held)}주)보다 많이 팔 수 없습니다`);
        return;
      }
    }

    // 헌법(자동 조항) 검사
    const baseState = { ...state, trades: state.trades.filter(x => x.id !== draft.id) };
    const newVio = E.checkDraft(baseState, draft);
    if (newVio.length) {
      const ok = await confirmModal({
        title: '헌법 위반 경고',
        body: '이 매매는 당신이 정한 원칙과 충돌합니다:\n\n' + newVio.map(v => `· ${v.p.text}\n  (${v.detail})`).join('\n') + '\n\n기록은 막지 않습니다. 다만 위반으로 남습니다.',
        okLabel: '알고도 기록한다',
      });
      if (!ok) return;
    }

    const idx = state.trades.findIndex(x => x.id === draft.id);
    if (idx >= 0) state.trades[idx] = { ...state.trades[idx], ...draft };
    else state.trades.push(draft);

    // 시세 미등록 심볼: 비공개 저장소에 자동 등록 요청
    if (!P.has(symbol)) {
      if (!state.pendingSymbols.includes(symbol)) state.pendingSymbols.push(symbol);
      if (state.settings.ghPat && state.settings.ghRepo) {
        P.registerTicker(state.settings, symbol)
          .then(() => toast(`${symbol} 시세 등록 요청 완료 — 1분 안에 저장소에 들어오고, 앱을 다시 열면 보입니다`, 3600))
          .catch(() => toast('시세 등록 요청 실패 — 설정에서 다시 시도하세요', 3600));
      } else {
        toast('시세 미등록 종목입니다. 설정에서 시세 저장소를 연결하세요.', 3200);
      }
    }
    // 현금 잔액 연동 — 새 기록은 반영하고, 고친 기록은 원래 반영돼 있던 것만 고친 값으로 다시 맞춘다
    let cashPlan = null;
    if (!existing || Store.revertCash(state, draft.id)) {
      cashPlan = Store.applyCash(state, draft.id, draft.date, E.cashDeltaOf('trade', draft));
    }
    saveNow(); closeModal(); render();
    toast((existing ? '수정했습니다' : (isBuy ? '매수를 기록했습니다' : '매도를 기록했습니다')) + cashToast(cashPlan), 3200);
  });
}
