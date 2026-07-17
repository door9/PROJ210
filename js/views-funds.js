// 화면: 2ⁿ (펀드 세대) — 지금 굴리는 펀드의 청산, 청산한 펀드의 열람
//
// 청산한 펀드의 숫자는 여기서 **다시 계산하지 않는다.** 청산하는 순간 engine.fundSummary가
// 만들어 archive.summary에 얼려 둔 값을 그대로 읽는다. 시세는 계속 움직이므로, 다시 계산하면
// 볼 때마다 "그때 얼마로 끝냈나"가 달라져 기록이 아니게 된다.
import { state, saveNow, toast, openModal, closeModal, confirmModal, registerView, render, go } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import { todayStr, daysBetween, esc, fmtMoney, fmtPct, fmtQty, fmtFx, pctClass } from './util.js';

const genLabel = n => `${n}세대`;
const spanText = (from, to) => `${from || '?'} ~ ${to}`;
const daysText = (from, to) => (from ? `${daysBetween(from, to).toLocaleString('ko-KR')}일` : '');

// ---------- 청산 모달 ----------
function openCloseModal() {
  const today = todayStr();
  const from = E.fundStart(state);
  const pf = E.portfolio(state);
  const ln = E.loanStatus(state);
  const openLoans = ln ? ln.openAccts.length : 0;
  const gen = (state.archives || []).length + 1;
  const name = state.settings.fundName || 'PROJ210';

  const packing = [
    `매매 ${state.trades.length}건`,
    state.diary.length ? `일지 ${state.diary.length}건` : null,
    state.letters.length ? `서한 ${state.letters.length}편` : null,
    (state.watchlist || []).length ? `관심 ${state.watchlist.length}건` : null,
    (state.swaps || []).length ? `교체 고민 ${state.swaps.length}건` : null,
    (state.loans || []).length ? `대출 ${state.loans.length}건` : null,
    E.cashLog(state).length ? `현금 입력 ${E.cashLog(state).length}건` : null,
  ].filter(Boolean).join(' · ');

  const m = openModal(`
    <h2>펀드 청산</h2>
    <p class="small muted" style="margin-top:-6px;">
      <b>${esc(name)}</b>(${genLabel(gen)})의 기록을 통째로 보관하고, 빈 장부로 새 펀드를 시작합니다.
      보관된 기록은 <b>2ⁿ</b>에서 언제든 열어 볼 수 있고, 청산 시점의 성적은 그대로 얼려 둡니다.
      잘못 눌렀다면 새 펀드에 기록을 남기기 전까지 되돌릴 수 있습니다.
    </p>
    <div class="notice">보관 대상: ${packing || '없음'}</div>
    ${pf.rows.length ? `<div class="warnbox">
      <b>보유 중인 종목이 ${pf.rows.length}개 남아 있습니다</b> (${pf.rows.map(r => esc(r.name)).join(', ')}).<br>
      청산 시점 평가액으로 함께 보관됩니다. 실제로 계속 들고 갈 종목이라면, 새 펀드에서 매수 기록을 다시 남기세요 —
      그래야 새 펀드의 원금·수익률이 맞습니다.</div>` : ''}
    ${openLoans ? `<div class="warnbox">
      <b>미상환 대출 ${openLoans}건</b>이 함께 보관됩니다. 새 펀드에서도 이자를 추적하려면 비용 화면에서 다시 등록하세요.</div>` : ''}
    <form id="close-fund">
      <div class="form-grid">
        <label class="fld">청산일
          <input type="date" name="to" max="${today}" min="${from || ''}" value="${today}" required>
        </label>
        <label class="fld">청산하는 펀드 이름
          <input name="name" value="${esc(name)}" required>
        </label>
        <label class="fld full">청산 메모 — 왜 여기서 끝내는가 <span class="muted small">(선택)</span>
          <textarea name="note" rows="2" placeholder="예: 2년 동안의 방식이 나와 안 맞았다. 종목 수를 줄이고 다시 시작한다."></textarea>
        </label>
      </div>
      <p class="hint" style="margin:10px 0 0;">운용 기간은 <b>${esc(spanText(from, today))}</b>으로 기록됩니다(청산일을 바꾸면 그에 맞게).</p>
      <h3 style="margin:16px 0 8px; font-size:14px;">새로 시작할 펀드</h3>
      <div class="form-grid">
        <label class="fld">이름
          <input name="newName" value="${esc(name)}" required>
        </label>
        <label class="fld">시작일
          <input type="date" name="newInception" value="${today}" required>
        </label>
      </div>
      <div class="btn-row" style="justify-content:flex-end; margin-top:14px;">
        <button type="button" class="btn" data-x="cancel">취소</button>
        <button type="submit" class="btn danger">청산하고 새로 시작</button>
      </div>
    </form>`);

  m.querySelector('[data-x=cancel]').onclick = closeModal;
  // 청산일을 바꾸면 새 펀드 시작일도 따라간다 (따로 만질 수도 있게 값만 맞춰 준다)
  const f = m.querySelector('#close-fund');
  f.to.addEventListener('change', () => { f.newInception.value = f.to.value; });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const to = f.to.value;
    if (!to || to > today) { toast('청산일을 확인하세요'); return; }
    if (from && to < from) { toast(`청산일이 펀드 시작일(${from})보다 빠릅니다`); return; }
    // 청산일 뒤에 기록이 남아 있으면 그 기록은 어느 펀드 것도 아니게 된다 — 먼저 정리해야 한다
    const after = state.trades.filter(t => t.date > to);
    if (after.length) {
      toast(`청산일 이후 매매 기록이 ${after.length}건 있습니다 — 청산일을 ${after.map(t => t.date).sort().pop()} 이후로 잡으세요`, 4600);
      return;
    }
    const closeName = f.name.value.trim() || name;
    const ok = await confirmModal({
      title: '정말 청산합니까?',
      body: `${closeName} (${spanText(from, to)})\n\n지금까지의 기록이 2ⁿ으로 옮겨지고 장부가 비워집니다.\n청산 시점의 성적은 그대로 얼려 보관됩니다.`,
      okLabel: '청산', danger: true,
    });
    if (!ok) return;

    const summary = E.fundSummary(state, to);
    Store.closeFund(state, {
      name: closeName,
      from: from || to,
      to,
      note: f.note.value.trim(),
      summary,
      newName: f.newName.value.trim() || closeName,
      newInception: f.newInception.value || to,
    });
    saveNow(); closeModal(); go('funds'); render();
    toast(`${closeName}을(를) 청산했습니다. 새 펀드를 시작합니다.`, 4000);
  });
}

// ---------- 목록 ----------
function vFunds() {
  const archives = [...(state.archives || [])].sort((a, b) => b.gen - a.gen);
  const today = todayStr();
  const from = E.fundStart(state);
  const gen = archives.length + 1;
  const name = state.settings.fundName || 'PROJ210';
  const hasRecords = state.trades.length > 0;
  const pf = hasRecords ? E.portfolio(state) : null;

  const live = `
    <div class="card">
      <div class="trade-head">
        <span class="tag buy">운용 중</span>
        <b style="font-size:15px;">${esc(name)}</b>
        <span class="muted small">${genLabel(gen)}</span>
        <span class="amt muted small">${from ? `${esc(spanText(from, today))} · ${daysText(from, today)}째` : '아직 시작 전'}</span>
      </div>
      ${pf ? `<dl class="hero-facts" style="margin-top:10px;">
        <dt>평가액</dt><dd>${fmtMoney(pf.totalKRW)}</dd>
        <dt>순손익</dt><dd class="${pctClass(pf.profit)}">${fmtMoney(pf.profit)}</dd>
        <dt>매매</dt><dd>${state.trades.length}건 · ${new Set(state.trades.map(t => t.symbol)).size}종목</dd>
      </dl>` : '<p class="small muted" style="margin:8px 0 0;">아직 매매 기록이 없습니다. 첫 매수를 기록하면 이 펀드가 시작됩니다.</p>'}
      <div class="btn-row">
        <button class="btn danger small" data-x="close" ${hasRecords ? '' : 'disabled'}>이 펀드 청산하기</button>
      </div>
      ${hasRecords ? '' : '<p class="hint">청산할 기록이 없습니다.</p>'}
    </div>`;

  const items = archives.map(a => {
    const s = a.summary || {};
    return `
      <li>
        <a href="#/fund/${encodeURIComponent(a.id)}" style="display:block; text-decoration:none; color:inherit;">
          <div class="trade-head">
            <span class="tag">${genLabel(a.gen)}</span>
            <b>${esc(a.name)}</b>
            <span class="dt muted small">${esc(spanText(a.from, a.to))} · ${daysText(a.from, a.to)}</span>
            <span class="amt">${fmtMoney(s.totalKRW || 0)}<br>
              <span class="small ${pctClass(s.twr ?? s.ret)}">${fmtPct(s.twr ?? s.ret)}</span></span>
          </div>
          <div class="trade-meta">
            <span>매매 ${s.counts?.trades ?? 0}건</span>
            <span>순손익 <b class="${pctClass(s.profit)}">${fmtMoney(s.profit || 0)}</b></span>
            ${a.note ? `<span class="muted">${esc(a.note.slice(0, 40))}${a.note.length > 40 ? '…' : ''}</span>` : ''}
            <span style="margin-left:auto; color:var(--sub);">›</span>
          </div>
        </a>
      </li>`;
  }).join('');

  return `
    <div class="view-title">2ⁿ</div>
    <p class="view-desc">펀드는 한 번에 하나만 굴립니다. 청산하면 그 펀드의 기록과 성적이 통째로 여기 보관되고, 빈 장부로 새 펀드가 시작됩니다.</p>
    ${live}
    <div class="card">
      <h3>청산한 펀드</h3>
      ${items ? `<ul class="list-plain">${items}</ul>` : '<div class="empty">아직 청산한 펀드가 없습니다</div>'}
    </div>`;
}
vFunds.bind_ = (root) => {
  root.querySelector('[data-x=close]')?.addEventListener('click', openCloseModal);
};
registerView('funds', vFunds);

// ---------- 청산한 펀드 열람 ----------
function vFund(id) {
  const a = (state.archives || []).find(x => x.id === id);
  if (!a) {
    return `<div class="view-title">2ⁿ</div><div class="empty">보관된 펀드를 찾을 수 없습니다. <a href="#/funds">목록으로</a></div>`;
  }
  const s = a.summary || {};
  const snap = a.snapshot || {};
  const trades = [...(snap.trades || [])].sort((x, y) => x.date < y.date ? 1 : x.date > y.date ? -1 : 0);
  const sK = s.sleeves?.KRW, sU = s.sleeves?.USD;
  const byCur = (krw, usd) => [sK?.has ? fmtMoney(krw) : null,
                               sU?.has ? fmtMoney(usd, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0);

  const retParts = [];
  if (sK?.has && sK.ret != null) retParts.push(`₩ <b class="${pctClass(sK.ret)}">${fmtPct(sK.ret)}</b>`);
  if (sU?.has && sU.ret != null) retParts.push(`$ <b class="${pctClass(sU.ret)}">${fmtPct(sU.ret)}</b>`);
  if (sK?.has && sU?.has && s.ret != null) retParts.push(`합 <b class="${pctClass(s.ret)}">${fmtPct(s.ret)}</b> <span class="muted">(환율 영향 제외)</span>`);

  const heroNote = [
    s.cashTracked ? '현금 포함' : '현금 미포함',
    sU?.has && s.fx ? `환율 ${fmtFx(s.fx)}` : null,
  ].filter(Boolean).join(' · ');

  // 청산 시점에 남아 있던 보유 종목
  const holdRows = (s.rows || []).map(r => `
    <tr>
      <td><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.symbol)}</span></td>
      <td class="num">${fmtQty(r.qty)}주</td>
      <td class="num">${fmtMoney(r.value, r.cur)}<br><span class="muted small">${((r.weight || 0) * 100).toFixed(1)}%</span></td>
      <td class="num ${pctClass(r.ret)}">${fmtPct(r.ret)}</td>
    </tr>`).join('');

  const realRows = (s.realizedBySym || []).map(r => `
    <tr>
      <td><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.symbol)} · ${r.count}회 매도</span></td>
      <td class="num ${pctClass(r.pnl)}">${fmtMoney(r.pnl, r.cur)}</td>
      <td class="num ${pctClass(r.ret)}">${fmtPct(r.ret)}</td>
    </tr>`).join('');

  const w = s.worlds;
  const tradeItems = trades.map(t => {
    const cur = P.currencyOf(t.symbol);
    return `
      <div class="trade-item">
        <div class="trade-head">
          <span class="tag ${t.side}">${t.side === 'buy' ? '매수' : '매도'}</span>
          <span class="nm">${esc(t.name || t.symbol)}</span>
          <span class="dt">${t.date}</span>
          <span class="amt">${fmtQty(t.qty)}주 @ ${fmtMoney(t.price, cur)}</span>
        </div>
        ${t.reason ? `<div class="trade-body">${esc(t.reason)}</div>` : ''}
        ${(t.emotions || []).length || t.sellReasonType ? `<div class="trade-meta">
          ${t.sellReasonType ? `<span class="tag">${esc(t.sellReasonType)}</span>` : ''}
          ${(t.emotions || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}
        </div>` : ''}
      </div>`;
  }).join('');

  const diaryItems = [...(snap.diary || [])].sort((x, y) => x.date < y.date ? 1 : -1).map(e => `
    <li>
      <div class="trade-head">
        <span class="tag ${e.urge === 'sell' ? 'sell' : 'buy'}">${e.urge === 'sell' ? '팔고 싶었다' : '더 사고 싶었다'}</span>
        <b>${esc(trades.find(t => t.symbol === e.symbol)?.name || e.symbol)}</b>
        <span class="dt muted small">${e.date}</span>
      </div>
      ${e.note ? `<div class="trade-body">${esc(e.note)}</div>` : ''}
    </li>`).join('');

  const letterItems = [...(snap.letters || [])].sort((x, y) => x.period < y.period ? 1 : -1).map(l => `
    <div class="trade-item">
      <div class="trade-head"><b>${esc(l.period)}</b></div>
      <div class="trade-body">${esc(l.body || '')}</div>
    </div>`).join('');

  // 되돌리기는 새 펀드가 아직 백지일 때만 — 그 뒤엔 두 펀드의 기록이 섞여 버린다
  const liveEmpty = !state.trades.length && !state.diary.length && !(state.letters || []).length
    && !(state.watchlist || []).length && !(state.loans || []).length && !E.cashLog(state).length;
  const isLatest = a.gen === Math.max(...(state.archives || []).map(x => x.gen));

  return `
    <div class="view-title"><a href="#/funds" style="text-decoration:none; color:var(--sub);">2ⁿ</a> › ${esc(a.name)}</div>
    <p class="view-desc">${genLabel(a.gen)} · ${esc(spanText(a.from, a.to))} · ${daysText(a.from, a.to)} 운용 · ${a.to}에 청산</p>
    ${a.note ? `<div class="card"><h3>청산 메모</h3><div class="trade-body" style="font-size:13.5px;">${esc(a.note)}</div></div>` : ''}
    <div class="card hero">
      <div class="row"><span class="muted small">청산 시점 평가액 (${heroNote})</span></div>
      <div class="big">${fmtMoney(s.totalKRW || 0)}</div>
      <dl class="hero-facts">
        <dt>투입 원금</dt><dd>${byCur(s.depositKRW, s.depositUSD)}</dd>
        <dt>평가 금액</dt><dd>${byCur(sK?.value, sU?.value)}</dd>
        <dt>수익 결산</dt><dd>${retParts.join(' · ') || '–'}</dd>
        <dt>순손익</dt><dd class="${pctClass(s.profit)}"><b>${fmtMoney(s.profit || 0)}</b></dd>
        ${s.twr != null ? `<dt>운용 성적</dt><dd class="${pctClass(s.twr)}"><b>${fmtPct(s.twr)}</b> <span class="muted small">전 기간 시간가중(TWR)</span></dd>` : ''}
      </dl>
    </div>
    ${w ? `<div class="kpis">
      <div class="kpi"><div class="k">코스피만 샀다면</div><div class="v">${fmtMoney(w.kospi)}</div><div class="s ${pctClass(w.kospi - w.actual)}">실제 대비 ${fmtMoney(w.kospi - w.actual)}</div></div>
      <div class="kpi"><div class="k">S&P500만 샀다면</div><div class="v">${fmtMoney(w.sp500)}</div><div class="s ${pctClass(w.sp500 - w.actual)}">실제 대비 ${fmtMoney(w.sp500 - w.actual)}</div></div>
      <div class="kpi"><div class="k">예금만 했다면 (연 ${w.rate}%)</div><div class="v">${fmtMoney(w.bank)}</div><div class="s ${pctClass(w.bank - w.actual)}">실제 대비 ${fmtMoney(w.bank - w.actual)}</div></div>
    </div>
    <p class="small muted" style="margin:6px 2px 14px;">청산일(${a.to}) 기준으로 얼린 값입니다.</p>` : ''}
    ${s.loan ? `<div class="card">
      <h3>투자 비용</h3>
      <dl class="hero-facts">
        <dt>누적 이자</dt><dd>${fmtMoney(s.loan.cumulative)} <span class="muted small">대출 ${s.loan.accounts}건</span></dd>
        <dt>이자 차감 후</dt><dd class="${pctClass(s.loan.netProfit)}">${fmtMoney(s.loan.netProfit)}</dd>
      </dl>
    </div>` : ''}
    ${holdRows ? `<div class="card">
      <h3>청산 시점 보유 종목</h3>
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>종목</th><th class="num">수량</th><th class="num">평가액</th><th class="num">수익률</th></tr>
        ${holdRows}
      </table></div>
      <p class="hint">청산할 때 전량 매도하지 않고 남아 있던 종목입니다.</p>
    </div>` : ''}
    ${realRows ? `<div class="card">
      <h3>종목별 실현 손익</h3>
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>종목</th><th class="num">실현 손익</th><th class="num">수익률</th></tr>
        ${realRows}
      </table></div>
      <p class="hint">판 것만 집계합니다(원가 대비). 합계 ${fmtMoney(s.realizedPnlKRW || 0)} — 매도 시점 환율로 원화 환산.</p>
    </div>` : ''}
    <div class="card">
      <h3>남은 기록</h3>
      <details class="acc"><summary>매매 기록 ${s.counts?.trades ?? trades.length}건</summary>
        <div style="margin-top:4px;">${tradeItems || '<div class="empty">없음</div>'}</div>
      </details>
      ${diaryItems ? `<details class="acc"><summary>홀딩 일지 ${(snap.diary || []).length}건</summary>
        <ul class="list-plain" style="margin-top:4px;">${diaryItems}</ul>
      </details>` : ''}
      ${letterItems ? `<details class="acc"><summary>주주 서한 ${(snap.letters || []).length}편</summary>
        <div style="margin-top:4px;">${letterItems}</div>
      </details>` : ''}
    </div>
    ${isLatest ? `<div class="card">
      <h3>청산 되돌리기</h3>
      ${liveEmpty
        ? `<p class="small muted" style="margin:4px 0 0;">이 펀드를 다시 운용 중 상태로 되돌리고, 보관본은 지웁니다. 새 펀드에 아직 기록이 없어 되돌릴 수 있습니다.</p>
           <div class="btn-row"><button class="btn danger small" data-x="restore">되돌리기</button></div>`
        : `<p class="small muted" style="margin:4px 0 0;">새 펀드에 이미 기록이 생겨 되돌릴 수 없습니다 — 되돌리면 두 펀드의 기록이 섞입니다.</p>`}
    </div>` : ''}`;
}
vFund.bind_ = (root, id) => {
  root.querySelector('[data-x=restore]')?.addEventListener('click', async () => {
    const a = (state.archives || []).find(x => x.id === id);
    if (!a) return;
    const ok = await confirmModal({
      title: '청산 되돌리기',
      body: `${a.name} (${spanText(a.from, a.to)})을(를) 다시 운용 중 상태로 되돌립니다.\n\n보관본은 사라지고, 그 기록이 현재 펀드로 돌아옵니다.`,
      okLabel: '되돌리기', danger: true,
    });
    if (!ok) return;
    Store.restoreFund(state, id);
    saveNow(); go('funds'); render();
    toast('청산을 되돌렸습니다');
  });
};
registerView('fund', vFund);
