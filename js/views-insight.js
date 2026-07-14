// 화면: 평행우주, 개입 점수, 홀딩 일지
import { state, saveNow, toast, registerView, render, confirmModal, openModal, closeModal } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import { uid, todayStr, esc, fmtMoney, fmtPct, fmtQty, pctClass } from './util.js';
import { lineChart, moneyShort } from './chart.js';

const C = {
  actual: '#0f9d6a', neverSell: '#c8871a', kospi: '#8a8a8a', sp500: '#8b5cc9', bank: '#3b7ea1', deposits: '#b0b0b0',
};

// ---------- 평행우주 ----------
function vWorlds() {
  const w = E.worlds(state);
  if (!w) {
    return `<div class="view-title">평행우주</div>
      <p class="view-desc">매매 기록이 생기면, "다르게 했다면 지금 얼마인가"를 자동 계산합니다.</p>
      <div class="empty">아직 매수 기록이 없습니다</div>`;
  }
  const li = w.dates.length - 1;
  const rows = [
    ['실제의 나', w.actual[li], C.actual, '기록한 그대로. 매도 대금은 현금으로 보관'],
    ['손 안 댄 나', w.neverSell[li], C.neverSell, '한 번 산 뒤 지금까지 한 번도 팔지 않음'],
    ['코스피만 산 나', w.kospi[li], C.kospi, '같은 날 같은 금액으로 코스피 지수만 매수'],
    ['S&P500만 산 나', w.sp500[li], C.sp500, '같은 날 같은 금액으로 S&P500만 매수'],
    ['정기예금만 한 나', w.bank[li], C.bank, `같은 날 같은 금액을 연 ${w.rate}% 정기예금에 (설정에서 금리 변경)`],
  ];
  const dep = w.deposits[li];
  const best = Math.max(...rows.map(r => r[1]));

  const chart = lineChart({
    labels: w.dates,
    series: [
      { label: '실제의 나', color: C.actual, values: w.actual },
      { label: '손 안 댄 나', color: C.neverSell, values: w.neverSell },
      { label: '코스피만', color: C.kospi, values: w.kospi },
      { label: 'S&P500만', color: C.sp500, values: w.sp500 },
      { label: '정기예금만', color: C.bank, values: w.bank },
      { label: '투입 원금', color: C.deposits, values: w.deposits, dash: true },
    ],
  });

  const diff = w.actual[li] - w.neverSell[li];
  const verdict = Math.abs(diff) < dep * 0.005
    ? '지금까지의 매도 판단은 결과적으로 큰 차이를 만들지 않았습니다.'
    : diff > 0
      ? `당신의 매도 판단은 지금까지 <b class="up">${fmtMoney(diff)}</b>만큼 가치를 <b>지켰습니다</b>.`
      : `한 번도 팔지 않았다면 지금 <b class="down">${fmtMoney(-diff)}</b>이 더 있었을 것입니다. 판다는 행위가 그만큼을 <b>깎았습니다</b>.`;

  return `
    <div class="view-title">평행우주</div>
    <p class="view-desc">같은 매수를 한 네 명의 나. 계좌 잔고는 누구나 보지만, 대안과의 차이는 아무도 보여주지 않습니다.</p>
    <div class="card">${chart}</div>
    <div class="card">
      <h3>현재 가치 (투입 원금 ${fmtMoney(dep)})</h3>
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>세계</th><th class="num">현재 가치</th><th class="num">수익률</th><th class="num">실제의 나 대비</th></tr>
        ${rows.map(([label, v, color, note]) => `
          <tr>
            <td><span class="sw" style="background:${color}; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px;"></span><b>${label}</b>${v === best ? ' <span style="color:var(--accent);">★</span>' : ''}<br><span class="muted small">${note}</span></td>
            <td class="num">${fmtMoney(v)}</td>
            <td class="num ${pctClass(v / dep - 1)}">${fmtPct(dep > 0 ? v / dep - 1 : null)}</td>
            <td class="num ${pctClass(v - rows[0][1])}">${label === '실제의 나' ? '—' : fmtMoney(v - rows[0][1])}</td>
          </tr>`).join('')}
      </table></div>
      <p class="small" style="margin-bottom:0;">${verdict}</p>
      <p class="hint">가정: 모든 매수는 새 돈 · 배당 재투자 · 매도 대금은 무이자 현금 · 달러는 당일 환율 환산 · 정기예금은 연 ${w.rate}% 복리(세전). 세계 간 조건은 동일하므로 비교는 공정합니다.</p>
    </div>
    <p class="small muted" style="margin:0 2px;">매도·물타기 하나하나의 채점은 <a href="#/actions">개입 점수</a>에서.</p>`;
}
registerView('worlds', vWorlds);

// ---------- 개입 점수 ----------
function vActions() {
  const ss = E.sellScores(state);
  const ad = E.avgDownBuys(state);

  const g2p = g => g == null ? '–' : fmtPct(g - 1);
  const g2c = g => g == null ? 'flat' : pctClass(g - 1);

  const sellRows = ss.rows.map(({ r, sym, name, horizon }) => `
    <tr>
      <td><b>${esc(name)}</b><br><span class="muted small">${r.sell.date} · ${fmtQty(r.sell.qty)}주${r.sell.sample ? ' · 예시' : ''}</span></td>
      <td class="num ${g2c(horizon.m3)}">${g2p(horizon.m3)}</td>
      <td class="num ${g2c(horizon.m6)}">${g2p(horizon.m6)}</td>
      <td class="num ${g2c(horizon.m12)}">${g2p(horizon.m12)}</td>
      <td class="num ${g2c(horizon.now)}"><b>${g2p(horizon.now)}</b></td>
      <td class="num">${horizon.now == null ? '–' : horizon.now < 1 ? '<span class="tag">잘 판 매도</span>' : '<span class="tag warn">이른 매도</span>'}</td>
    </tr>`).join('');

  const adRows = ad.rows.map(x => `
    <tr>
      <td><b>${esc(x.t.name || x.t.symbol)}</b><br><span class="muted small">${x.t.date} · ${fmtQty(x.t.qty)}주 @ ${fmtMoney(x.t.price, P.currencyOf(x.t.symbol))}${x.t.sample ? ' · 예시' : ''}</span></td>
      <td class="num ${g2c(x.growth)}">${g2p(x.growth)}</td>
      <td class="num ${g2c(x.benchGrowth)}">${g2p(x.benchGrowth)}</td>
      <td class="num ${x.delta == null ? 'flat' : pctClass(x.delta)}"><b>${x.delta == null ? '–' : fmtPct(x.delta) + 'P'}</b></td>
    </tr>`).join('');

  return `
    <div class="view-title">개입 점수</div>
    <p class="view-desc">내 손이 계좌에 닿을 때마다, 그 행동이 돈을 지켰는지 깎았는지 채점합니다.</p>
    <div class="card">
      <h3>매도 채점 — 판 뒤 그 주식은 어떻게 됐나</h3>
      ${ss.rows.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>매도</th><th class="num">+3개월</th><th class="num">+6개월</th><th class="num">+12개월</th><th class="num">현재까지</th><th class="num">판정</th></tr>
        ${sellRows}
      </table></div>
      ${ss.agg.count ? `<p class="small" style="margin-bottom:0;">
        매도 ${ss.agg.count}건 중 <b>${ss.agg.good}건</b>은 판 뒤 주가가 내렸고(잘 판 매도), <b>${ss.agg.bad}건</b>은 더 올랐습니다.
        판 종목들은 매도 후 현재까지 평균 <b class="${pctClass(ss.agg.avgMissed)}">${fmtPct(ss.agg.avgMissed)}</b> 움직였습니다.
        ${ss.agg.avgMissed > 0.03 ? '→ 평균적으로 <b>일찍 파는 경향</b>이 데이터에 나타납니다.' : ss.agg.avgMissed < -0.03 ? '→ 매도 판단이 평균적으로 <b>가치를 지키고</b> 있습니다.' : ''}
      </p>` : ''}` : '<div class="empty">아직 매도 기록이 없습니다</div>'}
      <p class="hint">수치는 배당·분할 반영 기준. 주가가 판 가격보다 "내렸다"면 매도가 손실을 피한 것입니다.</p>
    </div>
    <div class="card">
      <h3>물타기 채점 — 평단 아래 추가 매수, 그 돈의 성적</h3>
      ${ad.rows.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>추가 매수</th><th class="num">이후 종목</th><th class="num">같은 기간 지수</th><th class="num">지수 대비</th></tr>
        ${adRows}
      </table></div>
      ${ad.agg.count && ad.agg.avgDelta != null ? `<p class="small" style="margin-bottom:0;">
        물타기 ${ad.agg.count}회. 그 돈을 그냥 지수에 넣었을 때와 비교해 평균 <b class="${pctClass(ad.agg.avgDelta)}">${fmtPct(ad.agg.avgDelta)}P</b>.
        ${ad.agg.avgDelta < -0.03 ? '→ 물타기가 평균적으로 <b>지수보다 못한 선택</b>이었습니다.' : ad.agg.avgDelta > 0.03 ? '→ 물타기가 지수보다 나은 결과를 냈습니다.' : ''}
      </p>` : ''}` : '<div class="empty">물타기로 분류된 매수가 없습니다</div>'}
      <p class="hint">물타기 = 이미 보유 중인 종목을 평균 단가보다 싸게 추가 매수한 것. 한국 종목은 코스피, 미국 종목은 S&P500과 비교합니다.</p>
    </div>`;
}
registerView('actions', vActions);

// ---------- 관심 종목 ----------
function ensureTicker(symbol) {
  if (P.has(symbol)) return;
  if (!state.pendingSymbols.includes(symbol)) state.pendingSymbols.push(symbol);
  if (state.settings.ghPat && state.settings.ghRepo) {
    P.registerTicker(state.settings, symbol)
      .then(() => toast(`${symbol} 시세 등록 요청 완료 — 몇 분 뒤 자동 반영됩니다`, 3600))
      .catch(() => toast('시세 등록 요청 실패 — 설정에서 다시 시도하세요', 3600));
  } else {
    toast('시세 미등록 종목입니다. 설정에서 시세 저장소를 연결하세요.', 3200);
  }
}

function openSwapModal() {
  const pf = E.portfolio(state);
  if (!pf.rows.length) { toast('보유 종목이 있어야 교체 시뮬레이션을 만들 수 있습니다'); return; }
  const fromOpts = pf.rows.map(r =>
    `<option value="${esc(r.symbol)}" data-name="${esc(r.name)}" data-qty="${r.qty}">${esc(r.name)} — 보유 ${fmtQty(r.qty)}주</option>`).join('');
  const toOpts = [...new Set([
    ...(state.watchlist || []).map(w => w.symbol),
    ...P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X'),
  ])].filter(s => s).map(s => {
    const w = (state.watchlist || []).find(x => x.symbol === s);
    const nm = w?.name || P.info(s)?.name || s;
    return `<option value="${esc(s)}" data-name="${esc(nm)}">${esc(nm)} (${esc(s)})</option>`;
  }).join('');
  const m = openModal(`
    <h2>교체 시뮬레이션</h2>
    <p class="small muted" style="margin-top:-6px;">"이걸 팔아 저걸 샀다면"을 저장해 두면, 하지 않은 선택의 성적을 계속 채점해 줍니다.</p>
    <form id="swap-form">
      <div class="form-grid">
        <label class="fld">판다고 가정 (보유)
          <select name="from">${fromOpts}</select>
        </label>
        <label class="fld">수량
          <input type="number" name="qty" step="any" min="0" inputmode="decimal" required>
        </label>
        <label class="fld">산다고 가정
          <select name="to">${toOpts}</select>
        </label>
        <label class="fld">기준일
          <input type="date" name="date" max="${todayStr()}" value="${todayStr()}" required>
        </label>
        <label class="fld full">메모 (왜 고민했나, 왜 결국 안 했나)
          <textarea name="note" placeholder="예: 성장은 B가 좋아 보이지만, 세금과 확신 부족으로 보류."></textarea>
        </label>
      </div>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" class="btn" data-x="cancel">취소</button>
        <button type="submit" class="btn primary">저장</button>
      </div>
    </form>`);
  const form = m.querySelector('#swap-form');
  const syncQty = () => {
    const opt = form.from.selectedOptions[0];
    if (opt && !form.qty.value) form.qty.value = opt.dataset.qty;
  };
  form.from.addEventListener('change', () => { form.qty.value = ''; syncQty(); });
  syncQty();
  m.querySelector('[data-x=cancel]').onclick = closeModal;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const qty = parseFloat(form.qty.value);
    if (!(qty > 0)) { toast('수량을 확인하세요'); return; }
    const fromOpt = form.from.selectedOptions[0], toOpt = form.to.selectedOptions[0];
    if (fromOpt.value === toOpt.value) { toast('같은 종목끼리는 비교할 수 없습니다'); return; }
    state.swaps.push({
      id: uid(), date: form.date.value,
      fromSymbol: fromOpt.value, fromName: fromOpt.dataset.name, fromQty: qty,
      toSymbol: toOpt.value, toName: toOpt.dataset.name,
      note: form.note.value.trim(),
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    saveNow(); closeModal(); render(); toast('저장했습니다. 이제부터 이 가정이 채점됩니다.');
  });
}

function vWatch() {
  const rows = E.watchRows(state);
  const active = rows.filter(r => !r.w.archived);
  const archived = rows.filter(r => r.w.archived);
  const agg = E.watchAgg(state);
  const swaps = E.swapRows(state);
  const today = todayStr();
  const knownList = P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X')
    .map(s => `<option value="${esc(s)}">${esc(P.info(s)?.name || '')}</option>`).join('');

  const itemHtml = (r, isArchived) => {
    const { w } = r;
    const cur = P.currencyOf(w.symbol);
    return `
    <li>
      <div class="trade-head">
        <b>${esc(w.name || w.symbol)}</b>
        <span class="dt muted small">${esc(w.symbol)} · ${w.date} 등록${w.sample ? ' · 예시' : ''}</span>
        <span class="amt small">${r.p0 != null ? `등록일 ${fmtMoney(r.p0, cur)} → ${r.last ? fmtMoney(r.last.close, cur) : '–'}` : '<span class="muted">시세 대기 중</span>'}</span>
      </div>
      ${r.gNow != null ? `
      <div class="trade-meta" style="margin-top:6px;">
        <span>그날 샀다면 <b class="${pctClass(r.gNow - 1)}">${fmtPct(r.gNow - 1)}</b></span>
        <span>같은 기간 지수 <span class="${pctClass(r.gBench - 1)}">${fmtPct(r.gBench != null ? r.gBench - 1 : null)}</span></span>
        ${r.alpha != null ? `<span>차이 <b class="${pctClass(r.alpha)}">${fmtPct(r.alpha)}</b></span>` : ''}
        ${r.buy ? `<span class="tag">${r.buy.date} 실제 매수</span>${r.waitG != null ? `<span>기다린 동안 <b class="${pctClass(r.waitG - 1)}">${fmtPct(r.waitG - 1)}</b>${r.waitG > 1.03 ? ' — 기다림이 비쌌다' : r.waitG < 0.97 ? ' — 기다린 보람이 있었다' : ''}</span>` : ''}` : ''}
        ${isArchived && r.gSinceArchive != null ? `<span>접은 뒤 <b class="${pctClass(r.gSinceArchive - 1)}">${fmtPct(r.gSinceArchive - 1)}</b>${r.gSinceArchive > 1.05 ? ' — 아쉬운 이별' : r.gSinceArchive < 0.95 ? ' — 접길 잘했다' : ''}</span>` : ''}
      </div>` : ''}
      ${w.thesis ? `<div class="trade-body">${esc(w.thesis)}</div>` : ''}
      ${w.trigger ? `<div class="trade-body" style="margin-top:2px;"><span class="tag">매수 조건</span> ${esc(w.trigger)}</div>` : ''}
      <div class="trade-meta">
        <span style="margin-left:auto; white-space:nowrap;">
          ${isArchived
            ? `<button class="btn small" data-unarch="${w.id}">다시 지켜보기</button>`
            : `<button class="btn small" data-arch="${w.id}">관심 접기</button>`}
          <button class="btn small danger" data-del="${w.id}">삭제</button>
        </span>
      </div>
    </li>`;
  };

  const swapItems = swaps.map(x => `
    <li>
      <div class="trade-head">
        <b>${esc(x.s.fromName || x.s.fromSymbol)} ${fmtQty(x.s.fromQty)}주 → ${esc(x.s.toName || x.s.toSymbol)}</b>
        <span class="dt muted small">${x.s.date} 기준${x.s.sample ? ' · 예시' : ''}${x.qtyB != null ? ` · 환산 ${fmtQty(Math.round(x.qtyB * 100) / 100)}주` : ''}</span>
      </div>
      ${x.keptKRW != null && x.swapKRW != null ? `
      <div class="trade-meta" style="margin-top:6px;">
        <span>그대로 뒀다면 <b>${fmtMoney(x.keptKRW)}</b></span>
        <span>바꿨다면 <b>${fmtMoney(x.swapKRW)}</b></span>
        <span>차이 <b class="${pctClass(x.delta)}">${fmtMoney(x.delta)}</b> ${x.delta > 0 ? '— 바꾸는 게 나았다' : x.delta < 0 ? '— 안 바꾸길 잘했다' : ''}</span>
      </div>` : '<div class="trade-meta"><span class="muted">시세 대기 중</span></div>'}
      ${x.s.note ? `<div class="trade-body">${esc(x.s.note)}</div>` : ''}
      <div class="trade-meta"><span style="margin-left:auto;"><button class="btn small danger" data-delswap="${x.s.id}">삭제</button></span></div>
    </li>`).join('');

  return `
    <div class="view-title">관심 종목</div>
    <p class="view-desc">사는 것만 판단이 아닙니다. 안 산 것, 안 바꾼 것도 판단이고 — 여기서는 그 판단도 채점받습니다.</p>
    ${agg && agg.count >= 2 ? `
    <div class="card">
      <h3>안목 점수</h3>
      <p class="small" style="margin:4px 0 0;">
        관심 등록한 ${agg.count}개 종목은 등록 후 평균 <b class="${pctClass(agg.avgG)}">${fmtPct(agg.avgG)}</b>,
        같은 기간 지수는 <b class="${pctClass(agg.avgBench)}">${fmtPct(agg.avgBench)}</b>.
        당신의 눈은 지수 대비 <b class="${pctClass(agg.avgAlpha)}">${fmtPct(agg.avgAlpha)}</b>p입니다.
      </p>
    </div>` : ''}
    <div class="card">
      <h3>관심 등록</h3>
      <form id="watch-form">
        <div class="form-grid">
          <label class="fld">종목
            <input name="symbol" list="watch-symlist" placeholder="티커 (예: 005930 또는 AAPL)" required autocomplete="off">
            <datalist id="watch-symlist">${knownList}</datalist>
          </label>
          <label class="fld">등록일
            <input type="date" name="date" max="${today}" value="${today}" required>
          </label>
          <label class="fld full">왜 눈여겨보는가 — 그리고 왜 아직 안 사는가
            <textarea name="thesis" placeholder="이 글이 나중에 이 종목에 대한 내 판단력의 증거가 됩니다."></textarea>
          </label>
          <label class="fld full">어떤 조건이 되면 살 것인가
            <textarea name="trigger" placeholder="예: 다음 분기 실적에서 마진 개선이 확인되면"></textarea>
          </label>
        </div>
        <div class="btn-row" style="justify-content:flex-end;"><button class="btn primary" type="submit">등록</button></div>
      </form>
    </div>
    <div class="card">
      <h3>지켜보는 중 ${active.length ? `(${active.length})` : ''}</h3>
      ${active.length ? `<ul class="list-plain">${active.map(r => itemHtml(r, false)).join('')}</ul>` : '<div class="empty">아직 관심 종목이 없습니다</div>'}
    </div>
    <div class="card">
      <h3>교체 시뮬레이션 — 하지 않은 선택의 성적</h3>
      <div class="btn-row" style="margin:0 0 6px;"><button class="btn primary" data-x="newswap">새 시뮬레이션</button></div>
      ${swapItems ? `<ul class="list-plain">${swapItems}</ul>` : '<div class="empty">아직 저장된 가정이 없습니다</div>'}
    </div>
    ${archived.length ? `
    <div class="card">
      <h3>접어둔 종목 (${archived.length})</h3>
      <ul class="list-plain">${archived.map(r => itemHtml(r, true)).join('')}</ul>
    </div>` : ''}`;
}
vWatch.bind_ = (root) => {
  root.querySelector('#watch-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const symbol = P.resolveSymbol(f.symbol.value);
    if (!symbol) { toast('종목을 입력하세요'); return; }
    if ((state.watchlist || []).some(w => w.symbol === symbol && !w.archived)) { toast('이미 지켜보는 종목입니다'); return; }
    state.watchlist.push({
      id: uid(), symbol, name: P.info(symbol)?.name || symbol,
      date: f.date.value, thesis: f.thesis.value.trim(), trigger: f.trigger.value.trim(),
      archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
    ensureTicker(symbol);
    saveNow(); render(); toast('등록했습니다. 오늘부터 이 판단이 채점됩니다.');
  });
  root.querySelector('[data-x=newswap]').addEventListener('click', openSwapModal);
  root.querySelectorAll('[data-arch]').forEach(b => b.addEventListener('click', () => {
    const w = state.watchlist.find(x => x.id === b.dataset.arch);
    if (w) { w.archived = true; w.archivedAt = todayStr(); w.updatedAt = Date.now(); saveNow(); render(); toast('접었습니다. 이후에도 조용히 추적합니다.'); }
  }));
  root.querySelectorAll('[data-unarch]').forEach(b => b.addEventListener('click', () => {
    const w = state.watchlist.find(x => x.id === b.dataset.unarch);
    if (w) { w.archived = false; w.updatedAt = Date.now(); saveNow(); render(); }
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '관심 종목 삭제', body: '기록과 채점이 함께 사라집니다. "관심 접기"는 기록을 남기면서 목록만 정리합니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'watchlist', b.dataset.del);
    saveNow(); render();
  }));
  root.querySelectorAll('[data-delswap]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '시뮬레이션 삭제', body: '이 가정의 채점 기록을 삭제합니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'swaps', b.dataset.delswap);
    saveNow(); render();
  }));
};
registerView('watch', vWatch);

// ---------- 홀딩 일지 ----------
function vDiary() {
  const pf = E.portfolio(state);
  const opts = pf.rows.map(r => `<option value="${esc(r.symbol)}">${esc(r.name)} (${esc(r.symbol)})</option>`).join('');
  const rows = E.diaryRows(state);

  const items = rows.map(({ e, p0, gNow, g3, verdict }) => {
    const name = state.trades.find(t => t.symbol === e.symbol)?.name || e.symbol;
    return `
    <li>
      <div class="trade-head">
        <span class="tag ${e.urge === 'sell' ? 'sell' : 'buy'}">${e.urge === 'sell' ? '팔고 싶었다' : '더 사고 싶었다'}</span>
        <b>${esc(name)}</b>
        <span class="dt muted small">${e.date}${e.sample ? ' · 예시' : ''}</span>
        <span class="amt small muted">${p0 ? '그날 ' + fmtMoney(p0, P.currencyOf(e.symbol)) : ''}</span>
      </div>
      ${e.note ? `<div class="trade-body">${esc(e.note)}</div>` : ''}
      <div class="trade-meta">
        ${g3 != null ? `<span>3개월 뒤 <b class="${pctClass(g3 - 1)}">${fmtPct(g3 - 1)}</b></span>` : ''}
        ${verdict ? `<span class="${verdict.cls}"><b>${verdict.text}</b></span>` : '<span class="muted">시세 데이터 없음</span>'}
        <button class="btn small danger" style="margin-left:auto;" data-del="${e.id}">삭제</button>
      </div>
    </li>`;
  }).join('');

  return `
    <div class="view-title">홀딩 일지</div>
    <p class="view-desc">투자에서 제일 어려운 건 사고파는 순간이 아니라 들고 있는 동안입니다. 흔들린 순간을 남기면, 그 감정이 신호였는지 소음이었는지 나중에 채점해 줍니다.</p>
    <div class="card">
      <h3>오늘의 기록</h3>
      ${pf.rows.length ? `
      <form id="diary-form">
        <div class="form-grid">
          <label class="fld">종목<select name="symbol">${opts}</select></label>
          <label class="fld">지금 마음은
            <select name="urge">
              <option value="sell">팔고 싶다</option>
              <option value="buy">더 사고 싶다</option>
            </select>
          </label>
          <label class="fld full">한 줄 메모 — 왜 그런 마음이 드는가
            <textarea name="note" placeholder="예: 폭락 기사가 쏟아진다. 다 팔고 도망가고 싶다." required></textarea>
          </label>
        </div>
        <div class="btn-row" style="justify-content:flex-end;"><button class="btn primary" type="submit">기록</button></div>
      </form>` : '<div class="empty">보유 종목이 있어야 일지를 쓸 수 있습니다</div>'}
    </div>
    <div class="card">
      <h3>지난 기록과 채점</h3>
      ${items ? `<ul class="list-plain">${items}</ul>` : '<div class="empty">아직 일지가 없습니다</div>'}
    </div>`;
}
vDiary.bind_ = (root) => {
  root.querySelector('#diary-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const symbol = f.symbol.value;
    state.diary.push({
      id: uid(), symbol, date: todayStr(), urge: f.urge.value,
      note: f.note.value.trim(),
      priceAtEntry: P.last(symbol)?.close ?? null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    saveNow(); render(); toast('기록했습니다. 몇 달 뒤 이 감정이 채점됩니다.');
  });
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '일지 삭제', body: '이 일지 항목을 삭제합니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'diary', b.dataset.del);
    saveNow(); render();
  }));
};
registerView('diary', vDiary);
