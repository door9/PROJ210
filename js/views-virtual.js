// 화면: 가상 펀드 — 실제로 사지 않은 종목을 "그때 샀다면 지금 얼마인가"로 굴려 본다.
//
// 실제 펀드(홈·기록)와 철저히 분리돼 있다. 여기에 넣은 종목은 매매 기록·수익률·2ⁿ 어디에도
// 섞이지 않는다. 다만 시세는 같은 저장소를 쓰므로, 여기서 처음 등장한 종목은 tickers.json에
// 등록 요청을 보낸다(ensureTicker) — 안 그러면 평가할 시세가 영영 없다.
import { state, saveNow, toast, openModal, closeModal, confirmModal, registerView, render } from './core.js';
import * as E from './engine.js';
import * as P from './prices.js';
import { uid, todayStr, esc, fmtMoney, fmtSigned, fmtPct, fmtQty, pctClass } from './util.js';

// 펼쳐 놓은 펀드 id (화면을 다시 그려도 유지). null이면 모두 접힘.
let openFundId = null;

// 펀드는 반드시 '지금' id로 다시 찾아 쓴다. 객체를 붙들고 있으면 안 된다 —
// Dropbox 동기화가 state.virtuals 배열을 통째로 새 객체로 갈아끼우기 때문이다
// (sync.syncNow: state[c] = merged[c]). 모달을 띄워 놓고 입력하는 사이에 동기화가 돌면
// 붙들고 있던 객체는 상태에서 떨어져 나간 고아가 되고, 거기에 넣은 매수 기록은 저장돼도
// 화면에서 사라진다. 실제로 그렇게 기록이 사라지는 문제가 있었다.
const findFund = id => (state.virtuals || []).find(v => v.id === id) || null;

// 시세가 없는 종목이면 데이터 저장소에 등록을 요청한다. 관심 종목(views-insight)과 같은 방식.
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

// 종목 입력칸의 추천 목록 — 이미 시세가 있는 종목(지수·환율 제외)
function symbolDatalist(id) {
  const opts = P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X')
    .map(s => `<option value="${esc(s)}">${esc(P.info(s)?.name || '')}</option>`).join('');
  return `<datalist id="${id}">${opts}</datalist>`;
}

// ---------- 펀드 만들기 / 이름 바꾸기 ----------
function openFundModal(fund = null) {
  const fundId = fund?.id || null;   // 객체가 아니라 id를 들고 있는다 (위 findFund 주석 참고)
  const m = openModal(`
    <h2>${fund ? '가상 펀드 수정' : '새 가상 펀드'}</h2>
    <form id="vf-form">
      <label class="fld">펀드 이름
        <input name="name" required maxlength="40" placeholder="예: 안 산 반도체" value="${esc(fund?.name || '')}">
      </label>
      <label class="fld" style="margin-top:10px;">메모 (왜 이 가정을 만드는가)
        <textarea name="note" placeholder="예: 2023년에 사려다 만 종목들. 그때 샀으면 어땠을까.">${esc(fund?.note || '')}</textarea>
      </label>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" type="button" data-x="cancel">취소</button>
        <button class="btn primary" type="submit">${fund ? '저장' : '만들기'}</button>
      </div>
    </form>`);
  m.querySelector('[data-x=cancel]').addEventListener('click', closeModal);
  m.querySelector('#vf-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) { toast('이름을 입력하세요'); return; }
    if (fundId) {
      const cur = findFund(fundId);
      if (!cur) { closeModal(); render(); toast('그 사이 펀드가 사라졌습니다'); return; }
      cur.name = name;
      cur.note = f.note.value.trim();
      cur.updatedAt = Date.now();   // 동기화가 이 변경을 이기도록 — 필수
    } else {
      const nf = {
        id: uid(), name, note: f.note.value.trim(), positions: [],
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      state.virtuals = [...(state.virtuals || []), nf];
      openFundId = nf.id;   // 만들자마자 펼쳐서 바로 종목을 넣을 수 있게
    }
    saveNow(); closeModal(); render();
    toast(fundId ? '저장했습니다' : '가상 펀드를 만들었습니다. 종목을 넣어 보세요.');
  });
}

// ---------- 종목 추가 ----------
function openPositionModal(fund) {
  const fundId = fund.id;   // 객체가 아니라 id를 들고 있는다 (위 findFund 주석 참고)
  const today = todayStr();
  const m = openModal(`
    <h2>가상 매수 — ${esc(fund.name)}</h2>
    <form id="vp-form">
      <div class="form-grid">
        <label class="fld">종목
          <input name="symbol" list="vp-symlist" placeholder="티커 (예: 005930 또는 AAPL)" required autocomplete="off">
          ${symbolDatalist('vp-symlist')}
        </label>
        <label class="fld">매수일
          <input type="date" name="date" max="${today}" value="${today}" required>
        </label>
        <label class="fld">매수가 (종목 통화 그대로)
          <input name="price" type="number" step="any" min="0" required placeholder="한국 원, 미국 달러">
        </label>
        <label class="fld">수량
          <input name="qty" type="number" step="any" min="0" required>
        </label>
      </div>
      <p class="hint" style="margin:8px 0 0;">매수가를 비워 두지 말고 그날 실제로 살 수 있었던 값을 넣으세요.
      그날 종가와 크게 다르면 저장 뒤에 알려 드립니다.</p>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" type="button" data-x="cancel">취소</button>
        <button class="btn primary" type="submit">넣기</button>
      </div>
    </form>`);
  m.querySelector('[data-x=cancel]').addEventListener('click', closeModal);

  // 종목·날짜를 채우면 그날 종가를 안내해 오타를 줄인다
  const f = m.querySelector('#vp-form');
  const hintClose = () => {
    const sym = P.resolveSymbol(f.symbol.value);
    const c = sym && f.date.value ? P.closeOn(sym, f.date.value) : null;
    if (c != null && !f.price.value) f.price.placeholder = `그날 종가 ${c}`;
  };
  f.symbol.addEventListener('change', hintClose);
  f.date.addEventListener('change', hintClose);

  f.addEventListener('submit', e => {
    e.preventDefault();
    const symbol = P.resolveSymbol(f.symbol.value);
    if (!symbol) { toast('종목을 입력하세요'); return; }
    const price = parseFloat(f.price.value);
    const qty = parseFloat(f.qty.value);
    if (!(price > 0) || !(qty > 0)) { toast('매수가와 수량은 0보다 커야 합니다'); return; }

    // 입력하는 동안 동기화가 배열을 갈아끼웠을 수 있으므로 지금 다시 찾는다
    const cur = findFund(fundId);
    if (!cur) { closeModal(); render(); toast('그 사이 펀드가 사라졌습니다'); return; }
    cur.positions = [...(cur.positions || []), {
      id: uid(), symbol, name: P.info(symbol)?.name || symbol,
      date: f.date.value, price, qty,
    }];
    cur.updatedAt = Date.now();   // positions가 펀드 안에 있으므로 펀드의 시각을 올려야 동기화된다
    ensureTicker(symbol);
    saveNow(); closeModal(); render();

    // 입력값이 그날 종가와 크게 다르면 알려 준다 (막지는 않는다 — 장중가로 샀을 수도 있으니)
    const c = P.closeOn(symbol, f.date.value);
    if (c != null && Math.abs(price / c - 1) > 0.2) {
      toast(`넣었습니다. 참고: 그날 종가는 ${fmtMoney(c, P.currencyOf(symbol))}였습니다.`, 4200);
    } else {
      toast('넣었습니다');
    }
  });
}

// ---------- 펀드 한 개의 상세 (보유 표) ----------
function fundDetail(v, sum) {
  if (!sum.rows.length) {
    return `<div class="empty">아직 넣은 종목이 없습니다 — "가상 매수"를 눌러 시작하세요</div>`;
  }
  const body = sum.rows.map(r => {
    // 나눠 산 건들은 종목 아래에 접어 둔다 — 합산이 기본, 낱건은 참고용(그리고 지우려면 필요하다).
    const lotLines = r.lots.map(l => `
      <div style="display:flex; gap:8px; align-items:center; margin-top:3px;">
        <span class="muted small">${l.p.date} · ${fmtQty(l.p.qty)}주 @ ${fmtMoney(l.p.price, r.cur)}${l.hasPrice ? '' : ' · 시세 대기'}</span>
        <button class="btn small danger" style="padding:1px 7px; line-height:1.5;"
                data-delpos="${v.id}|${l.p.id}" title="이 매수 건 빼기">✕</button>
      </div>`).join('');

    return `
    <tr>
      <td>
        <b>${esc(r.name)}</b>
        <br><span class="muted small">${esc(r.symbol)}${r.buys > 1 ? ` · ${r.buys}건 합산` : ''}${r.qty > 0 ? ` · ${fmtQty(r.qty)}주 · 평균 ${fmtMoney(r.avgPrice, r.cur)}` : ''}</span>
        ${r.frozenSince ? `<br><span class="muted small" title="거래정지·상장폐지로 시세가 멈췄습니다">${r.frozenSince} 시세 정지</span>` : ''}
        ${lotLines}
      </td>
      <td class="num">${r.hasPrice
        ? `${fmtMoney(r.cost, r.cur)}<br><span class="muted small">${fmtMoney(r.costKRW)}</span>`
        : '<span class="muted">–</span>'}</td>
      <td class="num">${r.hasPrice
        ? `${fmtMoney(r.value, r.cur)}<br><span class="muted small">${fmtMoney(r.valueKRW)}</span>`
        : '<span class="muted">시세 대기 중</span>'}</td>
      <td class="num ${pctClass(r.ret)}"><b>${fmtPct(r.ret)}</b>${r.holdDays != null ? `<br><span class="muted small">최장 ${Math.round(r.holdDays / 30.44)}개월</span>` : ''}</td>
    </tr>`;
  }).join('');

  return `
    <div class="tbl-wrap"><table class="tbl">
      <tr><th>종목</th><th class="num">매입액</th><th class="num">평가액</th><th class="num">수익률</th></tr>
      ${body}
    </table></div>
    ${sum.pending ? `<div class="warnbox" style="margin-top:8px;">시세를 아직 못 받은 매수 ${sum.pending}건은 합계에서 뺐습니다 — 몇 분 뒤 자동으로 채워집니다.</div>` : ''}
    <p class="hint">같은 종목을 여러 번 샀으면 <b>한 줄로 합산</b>합니다 — 수익률은 매입액 전체 대비이고, 평균 단가는 수량으로 가중한 값입니다.
    평가액은 매수 건마다 그날 이후의 <b>수정종가</b> 변동을 적용해 더한 값입니다(배당·액면분할 반영) — 홈의 보유 종목과 같은 방식.
    종목 수익률은 그 종목 통화 기준이라 환율 영향이 없고, 위 원화 합계에는 환율 변동이 포함됩니다.</p>`;
}

// ---------- 목록 ----------
function vVirtual() {
  const funds = E.virtualFunds(state);

  const cards = funds.map(({ v, sum }) => {
    const isOpen = openFundId === v.id;
    return `
    <div class="card">
      <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
        <div style="min-width:0;">
          <h3 style="margin:0;">${esc(v.name)}</h3>
          <div class="muted small">종목 ${sum.rows.length}개${(v.positions || []).length > sum.rows.length ? ` · 매수 ${(v.positions || []).length}건` : ''}${v.note ? ' · ' + esc(v.note) : ''}</div>
        </div>
        <div style="margin-left:auto; text-align:right; white-space:nowrap;">
          <div style="font-size:17px; font-weight:700;">${sum.rows.length ? fmtMoney(sum.valueKRW) : '–'}</div>
          ${sum.ret != null ? `<div class="small ${pctClass(sum.profitKRW)}">${fmtSigned(sum.profitKRW)} · ${fmtPct(sum.ret)}</div>` : ''}
        </div>
      </div>
      <div class="btn-row" style="margin:10px 0 0; flex-wrap:wrap;">
        <button class="btn small ${isOpen ? 'primary' : ''}" data-toggle="${v.id}">${isOpen ? '접기' : '보기'}</button>
        <button class="btn small" data-addpos="${v.id}">가상 매수</button>
        <button class="btn small" data-edit="${v.id}">이름·메모</button>
        <button class="btn small danger" style="margin-left:auto;" data-delfund="${v.id}">펀드 삭제</button>
      </div>
      ${isOpen ? `<div style="margin-top:12px;">
        ${sum.rows.length ? `<dl class="hero-facts" style="margin:0 0 10px;">
          <dt>매입액</dt><dd>${fmtMoney(sum.costKRW)}</dd>
          <dt>평가액</dt><dd>${fmtMoney(sum.valueKRW)}</dd>
          <dt>손익</dt><dd class="${pctClass(sum.profitKRW)}"><b>${fmtSigned(sum.profitKRW)}</b> (${fmtPct(sum.ret)})</dd>
        </dl>` : ''}
        ${fundDetail(v, sum)}
      </div>` : ''}
    </div>`;
  }).join('');

  return `
    <div class="view-title">가상</div>
    <p class="view-desc">사지 않은 종목으로 만드는 장부. "그때 그 값에 그만큼 샀다면 지금 얼마인가"만 봅니다 — 실제 펀드와는 완전히 분리돼 있어 수익률·기록 어디에도 섞이지 않습니다.</p>
    <div class="btn-row" style="margin:0 0 12px;">
      <button class="btn primary" data-x="newfund">새 가상 펀드</button>
    </div>
    ${funds.length ? cards : '<div class="card"><div class="empty">아직 가상 펀드가 없습니다 — 하나 만들어 보세요</div></div>'}`;
}

vVirtual.bind_ = (root) => {
  const find = findFund;

  root.querySelector('[data-x=newfund]')?.addEventListener('click', () => openFundModal());

  root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    openFundId = openFundId === b.dataset.toggle ? null : b.dataset.toggle;
    render();
  }));

  root.querySelectorAll('[data-addpos]').forEach(b => b.addEventListener('click', () => {
    const v = find(b.dataset.addpos);
    if (v) { openFundId = v.id; openPositionModal(v); }
  }));

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const v = find(b.dataset.edit);
    if (v) openFundModal(v);
  }));

  root.querySelectorAll('[data-delpos]').forEach(b => b.addEventListener('click', async () => {
    const [vid, pid] = b.dataset.delpos.split('|');
    const v = find(vid);
    if (!v) return;
    const p = (v.positions || []).find(x => x.id === pid);
    // 같은 종목을 여러 번 샀을 수 있으므로 어느 건인지 날짜·수량으로 못박아 보여 준다
    if (!await confirmModal({
      title: '이 매수 건을 뺄까요?',
      body: p ? `${P.info(p.symbol)?.name || p.name || p.symbol}\n${p.date} · ${fmtQty(p.qty)}주 @ ${fmtMoney(p.price, P.currencyOf(p.symbol))}` : '',
      okLabel: '빼기', danger: true,
    })) return;
    // 확인창을 띄운 사이 동기화가 배열을 갈아끼웠을 수 있으므로 지금 다시 찾는다
    const cur = find(vid);
    if (!cur) { render(); return; }
    cur.positions = (cur.positions || []).filter(x => x.id !== pid);
    cur.updatedAt = Date.now();
    saveNow(); render(); toast('뺐습니다');
  }));

  root.querySelectorAll('[data-delfund]').forEach(b => b.addEventListener('click', async () => {
    const v = find(b.dataset.delfund);
    if (!v) return;
    if (!await confirmModal({
      title: '가상 펀드를 삭제할까요?',
      body: `"${v.name}" 과 그 안의 종목 ${(v.positions || []).length}개가 사라집니다. 되돌릴 수 없습니다.`,
      okLabel: '삭제', danger: true,
    })) return;
    // 삭제는 반드시 tombstone과 함께 — 안 그러면 다른 기기의 사본이 되살린다
    state.virtuals = (state.virtuals || []).filter(x => x.id !== v.id);
    state.deleted = state.deleted || {};
    state.deleted[v.id] = Date.now();
    if (openFundId === v.id) openFundId = null;
    saveNow(); render(); toast('삭제했습니다');
  }));
};

registerView('virtual', vVirtual);
