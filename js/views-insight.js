// 화면: 평행우주, 개입 점수, 홀딩 일지
import { state, saveNow, toast, registerView, render, confirmModal } from './core.js';
import * as Store from './store.js';
import * as P from './prices.js';
import * as E from './engine.js';
import { uid, todayStr, esc, fmtMoney, fmtPct, fmtQty, pctClass } from './util.js';
import { lineChart, moneyShort } from './chart.js';

const C = {
  actual: '#0f9d6a', neverSell: '#c8871a', kospi: '#8a8a8a', sp500: '#8b5cc9', deposits: '#b0b0b0',
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
        <tr><th>세계</th><th class="num">현재 가치</th><th class="num">수익률</th><th class="num">실제 대비</th></tr>
        ${rows.map(([label, v, color, note]) => `
          <tr>
            <td><span class="sw" style="background:${color}; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px;"></span><b>${label}</b>${v === best ? ' 🏆' : ''}<br><span class="muted small">${note}</span></td>
            <td class="num">${fmtMoney(v)}</td>
            <td class="num ${pctClass(v / dep - 1)}">${fmtPct(dep > 0 ? v / dep - 1 : null)}</td>
            <td class="num ${pctClass(v - rows[0][1])}">${label === '실제의 나' ? '—' : fmtMoney(v - rows[0][1])}</td>
          </tr>`).join('')}
      </table></div>
      <p class="small" style="margin-bottom:0;">${verdict}</p>
      <p class="hint">가정: 모든 매수는 새 돈 · 배당 재투자 · 매도 대금은 무이자 현금 · 달러는 당일 환율 환산. 세계 간 조건은 동일하므로 비교는 공정합니다.</p>
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
      <td class="num ${x.delta == null ? 'flat' : pctClass(x.delta)}"><b>${x.delta == null ? '–' : fmtPct(x.delta)}</b></td>
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
        물타기 ${ad.agg.count}회. 그 돈을 그냥 지수에 넣었을 때와 비교해 평균 <b class="${pctClass(ad.agg.avgDelta)}">${fmtPct(ad.agg.avgDelta)}</b>.
        ${ad.agg.avgDelta < -0.03 ? '→ 물타기가 평균적으로 <b>지수보다 못한 선택</b>이었습니다.' : ad.agg.avgDelta > 0.03 ? '→ 물타기가 지수보다 나은 결과를 냈습니다.' : ''}
      </p>` : ''}` : '<div class="empty">물타기로 분류된 매수가 없습니다</div>'}
      <p class="hint">물타기 = 이미 보유 중인 종목을 평균 단가보다 싸게 추가 매수한 것. 한국 종목은 코스피, 미국 종목은 S&P500과 비교합니다.</p>
    </div>`;
}
registerView('actions', vActions);

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
