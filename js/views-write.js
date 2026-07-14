// 화면: 주주 서한, 투자 헌법, AI 복기, 설정, 더보기
import { state, saveNow, toast, openModal, closeModal, confirmModal, registerView, render, refreshPriceStatus } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import * as Dbx from './dropbox.js';
import * as Sync from './sync.js';
import { uid, todayStr, esc, fmtMoney, fmtPct, pctClass, quarterOf } from './util.js';

// ---------- 주주 서한 ----------
function packSummaryText(pk) {
  const pct = v => v == null ? '?' : ((v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
  const L = [];
  L.push(`[자동 요약 — ${pk.period} (${pk.start} ~ ${pk.end})]`);
  L.push(`기초 가치 ${fmtMoney(pk.p0.totalKRW)} → 기말 가치 ${fmtMoney(pk.p1.totalKRW)} (기간 중 투입 ${fmtMoney(pk.flows)})`);
  L.push(`기간 수익률(근사) ${pct(pk.ret)} · 코스피 ${pct(pk.bench.kospi != null ? pk.bench.kospi - 1 : null)} · S&P500 ${pct(pk.bench.sp500 != null ? pk.bench.sp500 - 1 : null)}`);
  if (pk.trades.length) {
    L.push(`거래 ${pk.trades.length}건:`);
    for (const t of pk.trades) L.push(`  · ${t.date} ${t.side === 'buy' ? '매수' : '매도'} ${t.name || t.symbol} ${t.qty}주 — ${(t.reason || '').slice(0, 60)}`);
  } else L.push('거래 없음 (거래가 없는 분기도 판단이다)');
  if (pk.vio.length) L.push(`헌법 위반 ${pk.vio.length}건`);
  if (pk.diary.length) L.push(`흔들린 기록 ${pk.diary.length}건`);
  L.push('기말 보유: ' + (pk.p1.rows.map(r => `${r.name} ${(r.weight * 100).toFixed(0)}%`).join(', ') || '없음'));
  if (pk.prev) L.push(`지난 서한(${pk.prev.period})에서 한 말: "${pk.prev.body.slice(0, 80)}..."`);
  return L.join('\n');
}

function openLetterEditor(period) {
  const existing = state.letters.find(l => l.period === period);
  const pk = E.letterPack(state, period);
  const template = existing?.body ??
    (packSummaryText(pk) + '\n\n---\n\n주주(=나)에게.\n\n이번 분기 가장 잘한 판단:\n\n이번 분기 가장 부끄러운 판단:\n\n지난 서한에서 한 말은 지켜졌는가:\n\n다음 분기의 나에게:\n');
  const m = openModal(`
    <h2>${period} 주주 서한</h2>
    <p class="small muted" style="margin-top:-6px;">유일한 독자는 미래의 나. 잘한 것보다 부끄러운 것을 쓸 때 가치가 있습니다.</p>
    <textarea class="letter-edit" id="letter-body">${esc(template)}</textarea>
    <div class="btn-row" style="justify-content:space-between;">
      <button class="btn" data-x="pack">자동 요약 다시 넣기</button>
      <span>
        <button class="btn" data-x="cancel">취소</button>
        <button class="btn primary" data-x="save">저장</button>
      </span>
    </div>`);
  m.querySelector('[data-x=cancel]').onclick = closeModal;
  m.querySelector('[data-x=pack]').onclick = () => {
    const ta = m.querySelector('#letter-body');
    ta.value = packSummaryText(pk) + '\n\n' + ta.value;
  };
  m.querySelector('[data-x=save]').onclick = () => {
    const body = m.querySelector('#letter-body').value.trim();
    if (!body) { toast('내용이 비어 있습니다'); return; }
    if (existing) { existing.body = body; existing.updatedAt = Date.now(); }
    else state.letters.push({ id: uid(), period, body, createdAt: Date.now(), updatedAt: Date.now() });
    saveNow(); closeModal(); render(); toast('서한을 저장했습니다');
  };
}

function vLetters() {
  const q = quarterOf(todayStr());
  const hasCurrent = state.letters.some(l => l.period === q);
  const pk = state.trades.length ? E.letterPack(state, q) : null;
  const pct = v => v == null ? '–' : fmtPct(v);

  const past = [...state.letters].sort((a, b) => a.period < b.period ? 1 : -1).map(l => `
    <details class="acc">
      <summary>${l.period} 서한 ${l.sample ? '<span class="tag warn">예시</span>' : ''}</summary>
      <div class="letter-body" style="margin-top:8px;">${esc(l.body)}</div>
      <div class="btn-row">
        <button class="btn small" data-editletter="${l.period}">수정</button>
        <button class="btn small danger" data-delletter="${l.id}">삭제</button>
      </div>
    </details>`).join('');

  return `
    <div class="view-title">주주 서한</div>
    <p class="view-desc">분기에 한 번, 내 펀드의 유일한 고객(미래의 나)에게 운용보고서를 씁니다. 재료는 앱이 차려줍니다.</p>
    <div class="card">
      <h3>이번 분기 — ${q} ${hasCurrent ? '✅ 작성함' : ''}</h3>
      ${pk ? `
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>기간 수익률(근사)</th><th>코스피</th><th>S&P500</th><th>거래</th><th>위반</th><th>흔들림</th></tr>
        <tr>
          <td class="num ${pctClass(pk.ret)}">${pct(pk.ret)}</td>
          <td class="num ${pctClass(pk.bench.kospi != null ? pk.bench.kospi - 1 : null)}">${pct(pk.bench.kospi != null ? pk.bench.kospi - 1 : null)}</td>
          <td class="num ${pctClass(pk.bench.sp500 != null ? pk.bench.sp500 - 1 : null)}">${pct(pk.bench.sp500 != null ? pk.bench.sp500 - 1 : null)}</td>
          <td class="num">${pk.trades.length}건</td>
          <td class="num">${pk.vio.length}건</td>
          <td class="num">${pk.diary.length}건</td>
        </tr>
      </table></div>` : '<div class="empty">매매 기록이 생기면 분기 요약이 자동으로 준비됩니다</div>'}
      <div class="btn-row">
        <button class="btn primary" data-x="write">${hasCurrent ? '이번 분기 서한 수정' : '이번 분기 서한 쓰기'}</button>
      </div>
    </div>
    <div class="card">
      <h3>지난 서한</h3>
      ${past || '<div class="empty">아직 서한이 없습니다</div>'}
    </div>`;
}
vLetters.bind_ = (root) => {
  const q = quarterOf(todayStr());
  root.querySelector('[data-x=write]').addEventListener('click', () => openLetterEditor(q));
  root.querySelectorAll('[data-editletter]').forEach(b => b.addEventListener('click', () => openLetterEditor(b.dataset.editletter)));
  root.querySelectorAll('[data-delletter]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '서한 삭제', body: '이 서한을 삭제합니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'letters', b.dataset.delletter);
    saveNow(); render();
  }));
};
registerView('letters', vLetters);

// ---------- 투자 헌법 ----------
function vRules() {
  const stats = E.principleStats(state);
  const vio = E.violations(state);
  const pctOrDash = v => v == null ? '–' : fmtPct(v);

  const items = state.principles.map(p => {
    const st = stats.get(p.id);
    const kindInfo = E.PRINCIPLE_KINDS[p.kind];
    return `
    <li>
      <div class="trade-head">
        <b style="${p.active ? '' : 'opacity:0.45; text-decoration:line-through;'}">${esc(p.text)}</b>
        ${p.sample ? '<span class="tag warn">예시</span>' : ''}
        <span style="margin-left:auto; white-space:nowrap;">
          <button class="btn small" data-toggle="${p.id}">${p.active ? '중지' : '재개'}</button>
          <button class="btn small danger" data-del="${p.id}">삭제</button>
        </span>
      </div>
      <div class="trade-meta">
        <span class="tag">${kindInfo?.label || p.kind}</span>
        ${st ? `<span>위반 ${st.violCount}건</span>` : '<span class="muted">수동 점검 (매수 폼에 표시)</span>'}
        ${st && st.violAvgRet != null && st.okAvgRet != null ? `
          <span>실현 수익률: 위반 <b class="${pctClass(st.violAvgRet)}">${pctOrDash(st.violAvgRet)}</b> vs 준수 <b class="${pctClass(st.okAvgRet)}">${pctOrDash(st.okAvgRet)}</b>
          ${st.okAvgRet > st.violAvgRet ? '→ 이 원칙은 밥값을 하고 있다' : '→ 이 원칙이 정말 맞는지 데이터가 묻고 있다'}</span>` : ''}
      </div>
    </li>`;
  }).join('');

  const vioItems = vio.map(v => `
    <li><span class="tag warn">위반</span> <b>${v.trade.date}</b> ${esc(v.trade.name || v.trade.symbol)} — ${esc(v.detail)}
      <br><span class="muted small">조항: ${esc(v.p.text)}</span></li>`).join('');

  return `
    <div class="view-title">투자 헌법</div>
    <p class="view-desc">원칙을 조문으로 남기면 앱이 자동 감시합니다. 그리고 시간이 지나면 원칙 자체를 검증합니다 — 지킨 매매가 정말 더 나았는가?</p>
    <div class="card">
      <h3>조항 추가</h3>
      <form id="rule-form">
        <div class="form-grid">
          <label class="fld">종류
            <select name="kind">
              <option value="max_weight">한 종목 최대 비중(%) — 자동 감시</option>
              <option value="min_hold_days">최소 보유 일수 — 자동 감시</option>
              <option value="no_avg_down">물타기 금지 — 자동 감시</option>
              <option value="manual">수동 조항 (매수 전 점검 목록에 표시)</option>
            </select>
          </label>
          <label class="fld">기준값 <span class="muted">(비중 % 또는 일수)</span>
            <input type="number" name="param" step="any" min="0" inputmode="decimal">
          </label>
          <label class="fld full">조문 <span class="muted">(비워두면 자동 작성)</span>
            <input name="text" placeholder="예: 한 종목 비중은 25%를 넘기지 않는다">
          </label>
        </div>
        <div class="btn-row" style="justify-content:flex-end;"><button class="btn primary" type="submit">추가</button></div>
      </form>
    </div>
    <div class="card">
      <h3>나의 조항</h3>
      ${items ? `<ul class="list-plain">${items}</ul>` : '<div class="empty">아직 조항이 없습니다</div>'}
    </div>
    <div class="card">
      <h3>위반 기록</h3>
      ${vioItems ? `<ul class="list-plain">${vioItems}</ul>` : '<div class="empty">위반이 없습니다</div>'}
    </div>`;
}
vRules.bind_ = (root) => {
  root.querySelector('#rule-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const kind = f.kind.value;
    const param = parseFloat(f.param.value) || null;
    if ((kind === 'max_weight' || kind === 'min_hold_days') && !param) { toast('기준값을 입력하세요'); return; }
    let text = f.text.value.trim();
    if (!text) {
      text = kind === 'max_weight' ? `한 종목 비중은 ${param}%를 넘기지 않는다`
        : kind === 'min_hold_days' ? `산 지 ${param}일 안에는 팔지 않는다`
        : kind === 'no_avg_down' ? '물타기를 하지 않는다' : '';
      if (!text) { toast('조문을 입력하세요'); return; }
    }
    state.principles.push({ id: uid(), kind, param, text, active: true, createdAt: Date.now(), updatedAt: Date.now() });
    saveNow(); render(); toast('조항을 추가했습니다');
  });
  root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const p = state.principles.find(x => x.id === b.dataset.toggle);
    if (p) { p.active = !p.active; p.updatedAt = Date.now(); saveNow(); render(); }
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '조항 삭제', body: '이 조항과 위반 기록 표시가 사라집니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'principles', b.dataset.del);
    saveNow(); render();
  }));
};
registerView('rules', vRules);

// ---------- AI 복기 ----------
function vAI() {
  return `
    <div class="view-title">AI 복기</div>
    <p class="view-desc">기록 전체를 데이터 팩 하나로 만들어 Claude에게 넘기면, 통계가 못 잡는 패턴 — 글과 행동의 어긋남 — 을 심문받을 수 있습니다.</p>
    <div class="card">
      <h3>복기 데이터 팩</h3>
      <p class="small muted" style="margin:4px 0 0;">
        담기는 것: 펀드 현황 · 평행우주 결과 · 전체 매매(이유·확신도·감정 포함) · 실현 결과와 개입 점수 · 홀딩 일지 · 헌법과 위반 · 지난 서한 전문 · 심문 지침.<br>
        사용법: 아래 버튼으로 복사 → Claude 대화창에 붙여넣기. 분기에 한 번이면 충분합니다.
      </p>
      <div class="btn-row">
        <button class="btn primary" data-x="copy">데이터 팩 만들어 복사</button>
        <button class="btn" data-x="preview">미리 보기</button>
      </div>
      <div id="ai-preview"></div>
    </div>`;
}
vAI.bind_ = (root) => {
  const make = () => E.aiPack(state);
  root.querySelector('[data-x=copy]').addEventListener('click', async () => {
    const text = make();
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했습니다. Claude에 붙여넣으세요.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast('복사했습니다. Claude에 붙여넣으세요.');
    }
  });
  root.querySelector('[data-x=preview]').addEventListener('click', () => {
    const el = root.querySelector('#ai-preview');
    el.innerHTML = `<div class="letter-body small" style="margin-top:12px; max-height:340px; overflow-y:auto; border:1px solid var(--line); border-radius:10px; padding:12px;">${esc(make())}</div>`;
  });
};
registerView('ai', vAI);

// ---------- 글귀 서랍 ----------
function openQuoteEditor(q) {
  const m = openModal(`
    <h2>글귀 수정</h2>
    <label class="fld">문장
      <textarea id="q-text" style="min-height:110px;">${esc(q.text)}</textarea>
    </label>
    <label class="fld" style="margin-top:10px;">출처 (책·저자·자료)
      <input id="q-src" value="${esc(q.source || '')}">
    </label>
    <div class="btn-row" style="justify-content:flex-end;">
      <button class="btn" data-x="cancel">취소</button>
      <button class="btn primary" data-x="save">저장</button>
    </div>`);
  m.querySelector('[data-x=cancel]').onclick = closeModal;
  m.querySelector('[data-x=save]').onclick = () => {
    const text = m.querySelector('#q-text').value.trim();
    if (!text) { toast('문장이 비어 있습니다'); return; }
    q.text = text;
    q.source = m.querySelector('#q-src').value.trim();
    q.updatedAt = Date.now();
    saveNow(); closeModal(); render(); toast('저장했습니다');
  };
}

function vQuotes() {
  const qs = [...(state.quotes || [])].sort((a, b) => b.createdAt - a.createdAt);
  const items = qs.map(q => `
    <li>
      <div class="q-text" style="font-size:15px;">${esc(q.text)}</div>
      <div class="trade-meta">
        <span class="muted">${q.source ? '— ' + esc(q.source) : ''}</span>
        ${q.sample ? '<span class="tag warn">예시</span>' : ''}
        <span style="margin-left:auto; white-space:nowrap;">
          <button class="btn small" data-edit="${q.id}">수정</button>
          <button class="btn small danger" data-del="${q.id}">삭제</button>
        </span>
      </div>
    </li>`).join('');

  return `
    <div class="view-title">글귀 서랍</div>
    <p class="view-desc">책이나 자료에서 다시 꺼내 읽고 싶은 문장을 모아두면, 홈 화면에서 하나씩 랜덤으로 만나게 됩니다.</p>
    <div class="card">
      <h3>새 글귀</h3>
      <form id="quote-form">
        <label class="fld">문장
          <textarea name="text" style="min-height:90px;" placeholder="다시 읽고 싶은 문장을 그대로 옮겨 적기" required></textarea>
        </label>
        <label class="fld" style="margin-top:10px;">출처 (책·저자·자료, 선택)
          <input name="source" placeholder="예: 현명한 투자자, 벤저민 그레이엄">
        </label>
        <div class="btn-row" style="justify-content:flex-end;"><button class="btn primary" type="submit">담기</button></div>
      </form>
    </div>
    <div class="card">
      <h3>모아둔 글귀 ${qs.length ? `(${qs.length})` : ''}</h3>
      ${items ? `<ul class="list-plain">${items}</ul>` : '<div class="empty">아직 담긴 글귀가 없습니다</div>'}
    </div>`;
}
vQuotes.bind_ = (root) => {
  root.querySelector('#quote-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) return;
    state.quotes = state.quotes || [];
    state.quotes.push({ id: uid(), text, source: f.source.value.trim(), createdAt: Date.now(), updatedAt: Date.now() });
    saveNow(); render(); toast('글귀를 담았습니다');
  });
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const q = state.quotes.find(x => x.id === b.dataset.edit);
    if (q) openQuoteEditor(q);
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '글귀 삭제', body: '이 글귀를 삭제합니다.', okLabel: '삭제', danger: true });
    if (!ok) return;
    Store.removeItem(state, 'quotes', b.dataset.del);
    saveNow(); render();
  }));
};
registerView('quotes', vQuotes);

// ---------- 설정 ----------
function vSettings() {
  const has = Store.hasSample(state);
  const syms = P.symbols().filter(s => !s.startsWith('^') && s !== 'KRW=X');
  const u = P.updatedAt();
  return `
    <div class="view-title">설정</div>
    <div class="card">
      <h3>펀드 이름</h3>
      <form id="name-form" class="btn-row" style="margin:0;">
        <input name="fundName" value="${esc(state.settings.fundName || '1인 펀드')}" style="flex:1; border:1px solid var(--line); border-radius:10px; padding:9px 10px; background:var(--bg);">
        <button class="btn primary" type="submit">저장</button>
      </form>
    </div>
    <div class="card">
      <h3>동기화 (Dropbox)</h3>
      ${Dbx.connected() ? `
        <p class="small muted" style="margin:4px 0 0;">
          ✅ 연결됨 — 매매 기록·일지·헌법·서한이 내 Dropbox의 앱 전용 폴더에 저장되고 기기 간 동기화됩니다.<br>
          마지막 동기화: ${Sync.lastSync() ? new Date(Sync.lastSync()).toLocaleString('ko-KR') : '아직 없음'}
          ${Sync.lastError ? `<br><span class="down">최근 오류: ${esc(Sync.lastError)}</span>` : ''}
        </p>
        <div class="btn-row">
          <button class="btn primary" data-x="syncnow">지금 동기화</button>
          <button class="btn danger" data-x="dbxout">연결 해제</button>
        </div>` : `
        <p class="small muted" style="margin:4px 0 0;">아직 이 기기에만 저장 중입니다. Dropbox에 연결하면 PC·폰 간 자동 동기화되고, 데이터는 내 Dropbox에만 존재합니다.</p>
        <div class="btn-row"><button class="btn primary" data-x="dbxin">Dropbox 연결</button></div>`}
      <div class="btn-row">
        <button class="btn small" data-x="export">JSON 파일로 내보내기</button>
        <label class="btn small">JSON 가져오기<input type="file" accept=".json" data-x="import" style="display:none;"></label>
      </div>
    </div>
    <div class="card">
      <h3>시세 저장소 (비공개 GitHub)</h3>
      <p class="small muted" style="margin:4px 0 0;">
        종목명·시세는 본인만 접근 가능한 비공개 저장소에 보관됩니다. 현재 출처: <b>${P.loadedFrom() === 'github' ? '비공개 저장소 ✅' : P.loadedFrom() === 'local' ? '로컬 파일(개발용)' : '없음'}</b><br>
        등록 종목: ${syms.map(s => `${esc(P.info(s)?.name || s)}`).join(', ') || '없음'} · 갱신: ${u ? u.toLocaleString('ko-KR') : '없음'}
      </p>
      <form id="gh-form" class="form-grid" style="margin-top:10px;">
        <label class="fld">저장소
          <input name="ghRepo" placeholder="door9/one-fund-data" value="${esc(state.settings.ghRepo || '')}">
        </label>
        <label class="fld">개인 접근 토큰 (PAT)
          <input name="ghPat" type="password" placeholder="${state.settings.ghPat ? '저장됨 (변경 시에만 입력)' : 'github_pat_...'}" autocomplete="off">
        </label>
        <div class="full btn-row" style="margin:0;">
          <button class="btn primary" type="submit">저장 후 연결 확인</button>
        </div>
      </form>
      <div id="gh-test-result"></div>
      ${state.pendingSymbols.length ? `
      <div class="warnbox">시세 미등록: <b>${state.pendingSymbols.map(esc).join(', ')}</b></div>
      <div class="btn-row">
        <button class="btn small primary" data-x="regpending">미등록 종목 시세 등록 요청</button>
        <button class="btn small" data-x="clearpending">목록 비우기</button>
      </div>` : ''}
      <p class="hint">새 종목을 기록하면 자동으로 등록을 요청하고, 몇 분 내 시세가 채워집니다. 정기 갱신은 매일 07:10·16:10(한국시간).</p>
    </div>
    <div class="card">
      <h3>예시 데이터</h3>
      <div class="btn-row" style="margin-top:6px;">
        ${has
          ? `<button class="btn danger" data-x="delsample">예시 데이터만 지우기</button>`
          : `<button class="btn" data-x="addsample">예시 데이터 넣기</button>`}
      </div>
      <p class="hint">예시 표시가 붙은 항목만 넣고 지웁니다. 직접 기록한 데이터는 건드리지 않습니다.</p>
    </div>
    <div class="card">
      <h3>회계 가정</h3>
      <p class="small muted" style="margin:4px 0 0;">
        · 모든 매수는 "새 돈"으로 간주 (매도 대금 재사용을 추적하지 않음)<br>
        · 매도 대금은 무이자 현금으로 포트폴리오에 잔류<br>
        · 평가액은 수정종가 기준 = 배당 재투자 + 액면분할 자동 반영<br>
        · 달러 자산은 해당일 원/달러 환율로 환산<br>
        · 모든 평행우주에 같은 가정을 적용하므로 비교는 공정
      </p>
    </div>`;
}
vSettings.bind_ = (root) => {
  // Dropbox
  root.querySelector('[data-x=dbxin]')?.addEventListener('click', () => Dbx.login());
  root.querySelector('[data-x=dbxout]')?.addEventListener('click', async () => {
    const ok = await confirmModal({ title: 'Dropbox 연결 해제', body: '이 기기의 연결만 끊습니다. Dropbox에 저장된 데이터는 그대로 남습니다.', okLabel: '해제', danger: true });
    if (!ok) return;
    Dbx.logout(); render(); toast('연결을 해제했습니다');
  });
  root.querySelector('[data-x=syncnow]')?.addEventListener('click', async () => {
    toast('동기화 중...');
    const ok = await Sync.syncNow();
    render();
    toast(ok ? '동기화 완료' : '동기화 실패: ' + (Sync.lastError || '알 수 없음'));
  });
  // GitHub 시세 저장소
  root.querySelector('#gh-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    state.settings.ghRepo = f.ghRepo.value.trim();
    if (f.ghPat.value.trim()) state.settings.ghPat = f.ghPat.value.trim();
    state.settings.updatedAt = Date.now();
    saveNow();
    const el = root.querySelector('#gh-test-result');
    el.innerHTML = '<p class="small muted">연결 확인 중...</p>';
    const r = await P.ghTest(state.settings);
    if (r.ok) {
      await P.load(state.settings);
      refreshPriceStatus();
      render(); toast('시세 저장소 연결됨');
    } else {
      el.innerHTML = `<div class="warnbox">${esc(r.msg)}</div>`;
    }
  });
  root.querySelector('[data-x=regpending]')?.addEventListener('click', async () => {
    const syms = [...state.pendingSymbols];
    let done = 0;
    for (const s of syms) {
      try { await P.registerTicker(state.settings, s); done++; } catch { /* 실패 항목은 남김 */ }
    }
    toast(done ? `${done}개 등록 요청 완료 — 몇 분 뒤 시세가 채워집니다` : '등록 실패: 토큰·저장소 설정을 확인하세요');
  });
  root.querySelector('#name-form').addEventListener('submit', e => {
    e.preventDefault();
    state.settings.fundName = e.target.fundName.value.trim() || '1인 펀드';
    state.settings.updatedAt = Date.now();
    saveNow(); render(); toast('저장했습니다');
  });
  root.querySelector('[data-x=export]').addEventListener('click', () => {
    const d = new Date();
    const ts = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
      + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const blob = new Blob([Store.exportJson(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `1인펀드_백업_${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  root.querySelector('[data-x=import]').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = Store.importJson(text);
      const ok = await confirmModal({
        title: '데이터 가져오기',
        body: `현재 데이터(매매 ${state.trades.length}건)를 백업 파일(매매 ${imported.trades.length}건)로 통째로 교체합니다.\n\n교체 전에 현재 데이터를 내보내 두는 것을 권합니다.`,
        okLabel: '교체', danger: true,
      });
      if (!ok) return;
      Object.assign(state, imported);
      saveNow(); render(); toast('가져왔습니다');
    } catch {
      toast('파일을 읽을 수 없습니다');
    }
  });
  root.querySelector('[data-x=addsample]')?.addEventListener('click', () => {
    Store.addSample(state); saveNow(); render(); toast('예시 데이터를 넣었습니다');
  });
  root.querySelector('[data-x=delsample]')?.addEventListener('click', async () => {
    const ok = await confirmModal({ title: '예시 데이터 삭제', body: '예시 표시가 붙은 항목만 지웁니다. 직접 기록한 데이터는 남습니다.', okLabel: '지우기', danger: true });
    if (!ok) return;
    Store.removeSample(state); saveNow(); render(); toast('예시 데이터를 지웠습니다');
  });
  root.querySelector('[data-x=clearpending]')?.addEventListener('click', () => {
    state.pendingSymbols = []; saveNow(); render();
  });
};
registerView('settings', vSettings);

// ---------- 더보기 (모바일 메뉴) ----------
function vMore() {
  const items = [
    ['actions', '⚖️', '개입 점수', '매도·물타기 하나하나 채점'],
    ['quotes', '📚', '글귀 서랍', '책에서 모은 문장, 홈에서 랜덤으로'],
    ['letters', '📜', '주주 서한', '분기마다 나에게 쓰는 운용보고서'],
    ['rules', '📖', '투자 헌법', '원칙 자동 감시와 원칙 검증'],
    ['ai', '🤖', 'AI 복기', '기록 전체를 Claude에게 심문받기'],
    ['settings', '⚙️', '설정', '백업 · 시세 · 예시 데이터'],
  ];
  return `
    <div class="view-title">더보기</div>
    <div class="card"><ul class="list-plain">
      ${items.map(([id, ico, label, desc]) => `
        <li><a href="#/${id}" style="display:flex; gap:12px; align-items:center; text-decoration:none; color:inherit;">
          <span style="font-size:22px;">${ico}</span>
          <span><b>${label}</b><br><span class="muted small">${desc}</span></span>
          <span style="margin-left:auto; color:var(--sub);">›</span>
        </a></li>`).join('')}
    </ul></div>`;
}
registerView('more', vMore);
