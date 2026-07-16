// 화면: 홈(대시보드), 기록(매매 목록 + 입력 폼)
import { state, saveNow, toast, openModal, closeModal, confirmModal, registerView, render, go, triggerRefresh } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import { uid, todayStr, esc, fmtMoney, moneyKorean, fmtPct, fmtQty, pctClass, quarterOf } from './util.js';
import * as Dbx from './dropbox.js';
import * as Lock from './lock.js';

// ---------- 홈 ----------
// 글귀 서랍에서 랜덤 한 문장
function quoteCard() {
  const qs = state.quotes || [];
  if (!qs.length) return '';
  const q = qs[Math.floor(Math.random() * qs.length)];
  return `
    <div class="card quote-card">
      <div class="q-text">${esc(q.text)}</div>
      <div class="q-foot">
        <span class="q-src">${q.source ? '— ' + esc(q.source) : ''}</span>
        <span class="q-tools">
          <button class="btn small" data-act="requote" title="다른 글귀 보기">↻</button>
          <a class="btn small" href="#/quotes">서랍</a>
        </span>
      </div>
    </div>`;
}

function vHome() {
  if (!state.trades.length) {
    return `
      <div class="view-title">${esc(state.settings.fundName || 'PROJ210')}</div>
      <p class="view-desc">나는 이 펀드의 매니저이고, 유일한 고객도 나다.</p>
      ${quoteCard()}
      <div class="card">
        <h3>아직 기록이 없습니다</h3>
        <p class="small muted" style="margin:6px 0 0;">
          이 앱은 매매의 <b>결과</b>가 아니라 <b>판단</b>을 기록하고, 시간이 지난 뒤 그 판단을 채점합니다.<br><br>
          · <b>평행우주</b> — 지수만 샀다면·예금만 했다면 지금 얼마인가<br>
          · <b>개입 점수</b> — 내 매도·물타기가 돈을 벌었나 까먹었나<br>
          · <b>홀딩 일지</b> — 흔들린 순간이 신호였나 소음이었나<br>
          · <b>투자 헌법</b> — 내 원칙을 어겼는지 자동 감시, 원칙 자체도 검증<br>
          · <b>주주 서한</b> — 분기마다 나에게 쓰는 운용보고서<br>
          · <b>AI 복기</b> — 기록 전체를 넘겨 심문받기
        </p>
        <div class="btn-row">
          <button class="btn primary" data-act="first-trade">첫 매매 기록하기</button>
        </div>
      </div>`;
  }

  const pf = E.portfolio(state);
  const w = E.worlds(state);
  const li = w ? w.dates.length - 1 : -1;
  const ln = E.loanStatus(state);

  const alerts = [];
  if (!Lock.hasPin()) alerts.push(`<div class="warnbox">앱 잠금(PIN)이 설정되지 않았습니다 — <a href="#/settings">설정</a>에서 PIN을 설정하세요.</div>`);
  if (!Dbx.connected()) alerts.push(`<div class="notice">아직 이 기기에만 저장 중 — <a href="#/settings">설정</a>에서 Dropbox를 연결하면 PC·폰 간 동기화됩니다.</div>`);
  const q = quarterOf(todayStr());
  if (!state.letters.some(l => l.period === q)) alerts.push(`<div class="notice">이번 분기(${q}) <a href="#/letters">주주 서한</a>을 아직 쓰지 않았습니다.</div>`);
  if (state.pendingSymbols.length) alerts.push(`<div class="warnbox">시세 미등록 종목: ${state.pendingSymbols.map(esc).join(', ')} — <a href="#/settings">설정</a>에서 등록 방법 확인</div>`);
  const vio = E.violations(state);
  if (vio.length) alerts.push(`<div class="warnbox">투자 헌법 위반 ${vio.length}건 — <a href="#/rules">헌법</a>에서 확인</div>`);

  const holdRows = pf.rows.map(r => `
    <tr class="row-link" data-sym="${esc(r.symbol)}">
      <td><b>${esc(r.name)}</b> <span class="chev">›</span><br><span class="muted small">${esc(r.symbol)}</span></td>
      <td class="num">${fmtQty(r.qty)}주</td>
      <td class="num">${fmtMoney(r.value, r.cur)}<br><span class="muted small">${(r.weight * 100).toFixed(1)}%</span></td>
      <td class="num ${pctClass(r.ret)}">${fmtPct(r.ret)}</td>
    </tr>`).join('');
  // 매도 후 현금(재투자 안 한 잔여) — 통화별로 포트폴리오에 표시
  const cashRow = (label, amt, curc) => `
    <tr>
      <td><b>${label}</b><br><span class="muted small">매도 대금 · 미투자</span></td>
      <td class="num">–</td>
      <td class="num">${fmtMoney(amt, curc)}</td>
      <td class="num">–</td>
    </tr>`;
  const cashRows = [
    pf.cash.KRW > 1 ? cashRow('원화 현금', pf.cash.KRW, 'KRW') : '',
    pf.cashUSD > 0.01 ? cashRow('달러 현금', pf.cashUSD, 'USD') : '',
  ].join('');
  const hasHoldingsOrCash = pf.rows.length || cashRows;

  // 투입 원금·수익률: 통화별로 분리 (달러는 환산하지 않고 그대로)
  const sK = pf.sleeves.KRW, sU = pf.sleeves.USD;
  const depStr = [pf.depositKRW > 0 ? fmtMoney(pf.depositKRW) : null,
                  pf.depositUSD > 0 ? fmtMoney(pf.depositUSD, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0);
  const retParts = [];
  if (sK.has && sK.ret != null) retParts.push(`원화 <b class="${pctClass(sK.ret)}">${fmtPct(sK.ret)}</b>`);
  if (sU.has && sU.ret != null) retParts.push(`달러 <b class="${pctClass(sU.ret)}">${fmtPct(sU.ret)}</b>`);
  const bothCur = sK.has && sU.has;

  return `
    <div class="view-title">${esc(state.settings.fundName || 'PROJ210')} <button class="btn small" data-act="refresh" title="시세 지금 갱신" style="vertical-align:2px;">↻ 시세</button></div>
    <p class="view-desc">기준일 ${pf.date} · 배당 재투자 가정 · 달러는 당일 환율 환산</p>
    ${quoteCard()}
    ${alerts.join('')}
    <div class="card hero">
      <div class="row"><span>투입 원금 ${depStr}</span></div>
      <div class="big">${fmtMoney(pf.totalKRW)}</div>
      <div class="row">
        <span>${retParts.join(' · ')}</span>
        ${bothCur && pf.ret != null ? `<span class="muted">· 합산 <b class="${pctClass(pf.ret)}">${fmtPct(pf.ret)}</b> (환율 영향 제외)</span>` : ''}
      </div>
      ${bothCur ? `<div class="row muted small">현재 평가액: 원화 ${fmtMoney(pf.holdKRW + pf.cash.KRW)} + 달러 ${fmtMoney(pf.holdUSD + pf.cashUSD, 'USD')}${pf.fx ? ` · 환율 ₩${Math.round(pf.fx).toLocaleString()}` : ''}</div>` : ''}
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
    ${w ? `<div class="kpis">
      <div class="kpi"><div class="k">코스피만 샀다면</div><div class="v">${moneyKorean(w.kospi[li])}</div><div class="s ${pctClass(w.kospi[li] - w.actual[li])}">실제 대비 ${fmtMoney(w.kospi[li] - w.actual[li])}</div></div>
      <div class="kpi"><div class="k">S&P500만 샀다면</div><div class="v">${moneyKorean(w.sp500[li])}</div><div class="s ${pctClass(w.sp500[li] - w.actual[li])}">실제 대비 ${fmtMoney(w.sp500[li] - w.actual[li])}</div></div>
      <div class="kpi"><div class="k">예금만 했다면 (연 ${w.rate}%)</div><div class="v">${moneyKorean(w.bank[li])}</div><div class="s ${pctClass(w.bank[li] - w.actual[li])}">실제 대비 ${fmtMoney(w.bank[li] - w.actual[li])}</div></div>
    </div>
    <p class="small muted" style="margin:6px 2px 14px;">자세한 곡선은 <a href="#/worlds">평행우주</a>에서.</p>` : ''}
    <div class="card">
      <h3>보유 종목</h3>
      ${hasHoldingsOrCash ? `<div class="tbl-wrap"><table class="tbl">
        <tr><th>종목</th><th class="num">수량</th><th class="num">평가액</th><th class="num">수익률</th></tr>
        ${holdRows}${cashRows}</table></div>` : `<div class="empty">보유 종목이 없습니다</div>`}
    </div>
    <div class="btn-row">
      <button class="btn primary" data-act="buy">매수 기록</button>
      <button class="btn" data-act="sell">매도 기록</button>
      <button class="btn" data-act="diary">일지 쓰기</button>
    </div>`;
}
vHome.bind_ = (root) => {
  root.querySelectorAll('.row-link[data-sym]').forEach(tr => tr.addEventListener('click', () => go('symbol/' + encodeURIComponent(tr.dataset.sym))));
  root.querySelector('[data-act=requote]')?.addEventListener('click', render);
  root.querySelector('[data-act=refresh]')?.addEventListener('click', triggerRefresh);
  root.querySelector('[data-act=first-trade]')?.addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=buy]')?.addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=sell]')?.addEventListener('click', () => openTradeForm('sell'));
  root.querySelector('[data-act=diary]')?.addEventListener('click', () => go('diary'));
};
registerView('home', vHome);

// ---------- 매매 기록 아이템 (기록 페이지·종목 페이지 공용) ----------
function tradeItemHtml(t, r) {
  const cur = P.currencyOf(t.symbol);
  const amt = t.price * t.qty;
  return `
    <div class="trade-item" data-id="${t.id}">
      <div class="trade-head">
        <span class="tag ${t.side}">${t.side === 'buy' ? '매수' : '매도'}</span>
        <span class="nm">${esc(t.name || t.symbol)}</span>
        <span class="dt">${t.date}</span>
        ${t.sample ? '<span class="tag warn">예시</span>' : ''}
        <span class="amt">${fmtQty(t.qty)}주 @ ${fmtMoney(t.price, cur)}<br><span class="muted small">${fmtMoney(amt, cur)}</span></span>
      </div>
      ${t.reason ? `<div class="trade-body">${esc(t.reason)}</div>` : ''}
      <div class="trade-meta">
        ${t.side === 'buy' ? `
          ${t.confidence != null ? `<span>확신도 ${t.confidence}%</span>` : ''}
          ${t.planMonths ? `<span>계획 ${t.planMonths}개월</span>` : ''}
          ${t.sellPlan ? `<span title="${esc(t.sellPlan)}">매도 조건 있음</span>` : ''}` : `
          ${t.sellReasonType ? `<span class="tag">${esc(t.sellReasonType)}</span>` : ''}
          ${r && r.ret != null ? `<span class="${pctClass(r.ret)}">실현 ${fmtPct(r.ret)}</span>` : ''}
          ${r && r.holdDays != null ? `<span>보유 ${Math.round(r.holdDays)}일</span>` : ''}`}
        ${(t.emotions || []).map(e => `<span class="tag">${esc(e)}</span>`).join('')}
        <span style="margin-left:auto;">
          <button class="btn small" data-edit="${t.id}">수정</button>
          <button class="btn small danger" data-del="${t.id}">삭제</button>
        </span>
      </div>
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
      body: `${t.date} ${t.name || t.symbol} ${t.side === 'buy' ? '매수' : '매도'} ${t.qty}주 기록을 삭제합니다.\n삭제하면 복기 데이터도 함께 사라집니다.`,
      okLabel: '삭제', danger: true,
    });
    if (!ok) return;
    Store.removeItem(state, 'trades', t.id);
    saveNow(); render(); toast('삭제했습니다');
  }));
}

// ---------- 기록 ----------
function vTrades() {
  const trades = E.sortedTrades(state).reverse();
  const { realized } = E.replay(E.sortedTrades(state));
  const retBySell = new Map(realized.map(r => [r.sell.id, r]));
  const items = trades.map(t => tradeItemHtml(t, retBySell.get(t.id))).join('');

  return `
    <div class="view-title">매매 기록</div>
    <p class="view-desc">결과가 아니라 판단을 남기는 곳. 팔 때는 살 때의 기록과 대조합니다.</p>
    <div class="btn-row" style="margin:0 0 12px;">
      <button class="btn primary" data-act="buy">매수 기록</button>
      <button class="btn" data-act="sell">매도 기록</button>
    </div>
    <div class="card">
      ${items || '<div class="empty">아직 기록이 없습니다</div>'}
    </div>`;
}
vTrades.bind_ = (root) => {
  root.querySelector('[data-act=buy]').addEventListener('click', () => openTradeForm('buy'));
  root.querySelector('[data-act=sell]').addEventListener('click', () => openTradeForm('sell'));
  bindTradeItems(root);
};
registerView('trades', vTrades);

// ---------- 종목 상세 (보유 종목 클릭 시) ----------
function vSymbol(symbol) {
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

  const stat = (k, v, cls = '') => `<tr><td class="muted">${k}</td><td class="num ${cls}"><b>${v}</b></td></tr>`;
  const summary = `
    <div class="tbl-wrap"><table class="tbl">
      ${pos ? `
        ${stat('보유 수량', fmtQty(pos.qty) + '주')}
        ${stat('평균 단가', fmtMoney(pos.cost / pos.qty, cur))}
        ${stat('평가액', fmtMoney(pos.value, cur))}
        ${stat('평가손익', `${fmtMoney(pos.value - pos.cost, cur)} (${fmtPct(pos.ret)})`, pctClass(pos.ret))}
      ` : stat('보유', '없음 (전량 매도)')}
      ${symRealized.length ? stat('실현 손익', `${fmtMoney(realizedPnl, cur)}${realizedCost > 0 ? ` (${fmtPct(realizedPnl / realizedCost)})` : ''}`, pctClass(realizedPnl)) : ''}
    </table></div>`;

  const items = symTrades.map(t => tradeItemHtml(t, retBySell.get(t.id))).join('');

  return `
    <div class="view-title">${esc(name)}</div>
    <p class="view-desc">${esc(symbol)}${last ? ` · 현재가 ${fmtMoney(last.close, cur)} <span class="muted">(${last.date})</span>` : ' · 시세 없음'}</p>
    <div class="card"><h3>현황</h3>${summary}</div>
    <div class="card"><h3>매매 기록 (${symTrades.length}건)</h3>${items}</div>
    <div class="btn-row"><a class="btn" href="#/home">← 홈으로</a></div>`;
}
vSymbol.bind_ = (root) => { bindTradeItems(root); };
registerView('symbol', vSymbol);

// ---------- 매매 입력 폼 ----------
function emotionChips(selected = []) {
  return Store.EMOTIONS.map(e =>
    `<span class="chip ${selected.includes(e) ? 'on' : ''}" data-emo="${esc(e)}">${esc(e)}</span>`).join('');
}

export function openTradeForm(side, existing = null) {
  const isBuy = side === 'buy';
  const today = todayStr();
  const t = existing || {};

  // 매도: 현재 보유 종목 목록
  let sellOptions = '';
  if (!isBuy) {
    const pf = E.portfolio(state);
    if (!pf.rows.length && !existing) { toast('보유 종목이 없습니다. 먼저 매수를 기록하세요.'); return; }
    sellOptions = pf.rows.map(r =>
      `<option value="${esc(r.symbol)}" ${t.symbol === r.symbol ? 'selected' : ''}>${esc(r.name)} (${esc(r.symbol)}) — 보유 ${fmtQty(r.qty)}주</option>`).join('');
    if (existing && !pf.rows.some(r => r.symbol === t.symbol)) {
      sellOptions += `<option value="${esc(t.symbol)}" selected>${esc(t.name || t.symbol)}</option>`;
    }
  }

  const knownList = P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X')
    .map(s => `<option value="${esc(s)}">${esc(P.info(s)?.name || '')}</option>`).join('');

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
        <label class="fld">날짜
          <input type="date" name="date" max="${today}" value="${t.date || today}" required>
        </label>
        <label class="fld">가격 (1주) <span id="cur-hint" class="muted"></span>
          <input type="number" name="price" step="any" min="0" inputmode="decimal" value="${t.price ?? ''}" required>
        </label>
        <label class="fld">수량
          <input type="number" name="qty" step="any" min="0" inputmode="decimal" value="${t.qty ?? ''}" required>
        </label>
        <label class="fld">수수료·세금 (선택)
          <input type="number" name="fee" step="any" min="0" inputmode="decimal" value="${t.fee || ''}">
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
        <label class="fld full">매도 이유
          <textarea name="reason" placeholder="위에 보이는 '살 때의 나'와 대조해서 쓰기" required>${esc(t.reason || '')}</textarea>
        </label>
        `}
        <div class="full">
          <span class="fld">지금의 감정 (해당하는 것 모두)</span>
          <div class="chips" id="emo-chips">${emotionChips(t.emotions || [])}</div>
        </div>
      </div>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" class="btn" data-x="cancel">취소</button>
        <button type="submit" class="btn primary">${existing ? '수정 저장' : '기록하기'}</button>
      </div>
    </form>`);

  const form = m.querySelector('#trade-form');
  const curHint = m.querySelector('#cur-hint');
  const nameHint = m.querySelector('#name-hint');

  function updateSymbolInfo() {
    const raw = form.symbol.value;
    if (!raw) { if (nameHint) nameHint.textContent = ''; return; }
    const sym = P.resolveSymbol(raw);
    const info = P.info(sym);
    if (info) {
      if (nameHint) nameHint.textContent = `— ${info.name}`; // 종목명 자동
      const l = P.last(sym);
      curHint.textContent = `· ${info.currency}${l ? ` · 최근 종가 ${fmtMoney(l.close, info.currency)} (${l.date})` : ''}`;
      // 날짜의 종가 자동 제안 (가격 비어 있을 때)
      if (!form.price.value) {
        const c = P.closeOn(sym, form.date.value || today);
        if (c) form.price.value = c;
      }
    } else {
      if (nameHint) nameHint.textContent = '';
      curHint.textContent = `· 시세 미등록 (${P.currencyOf(sym)} 추정) — 종목명은 시세 등록 후 자동 설정됩니다`;
    }
  }
  form.symbol.addEventListener('change', updateSymbolInfo);
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
  }
  updateSymbolInfo();

  m.querySelector('#emo-chips').addEventListener('click', e => {
    if (e.target.classList.contains('chip')) e.target.classList.toggle('on');
  });
  m.querySelector('[data-x=cancel]').onclick = closeModal;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const symbol = isBuy ? P.resolveSymbol(form.symbol.value) : form.symbol.value;
    const price = parseFloat(form.price.value);
    const qty = parseFloat(form.qty.value);
    if (!symbol || !(price > 0) || !(qty > 0)) { toast('종목·가격·수량을 확인하세요'); return; }
    const draft = {
      id: t.id || uid(),
      side, symbol,
      name: P.info(symbol)?.name || t.name || symbol, // 종목명 자동
      date: form.date.value,
      price, qty,
      fee: parseFloat(form.fee.value) || 0,
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
          .then(() => toast(`${symbol} 시세 등록 요청 완료 — 몇 분 뒤 자동 반영됩니다`, 3600))
          .catch(() => toast('시세 등록 요청 실패 — 설정에서 다시 시도하세요', 3600));
      } else {
        toast('시세 미등록 종목입니다. 설정에서 시세 저장소를 연결하세요.', 3200);
      }
    }
    saveNow(); closeModal(); render();
    toast(existing ? '수정했습니다' : (isBuy ? '매수를 기록했습니다' : '매도를 기록했습니다'));
  });
}
