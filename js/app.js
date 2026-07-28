// 진입점
import * as P from './prices.js';
import * as Dbx from './dropbox.js';
import * as Sync from './sync.js';
import * as Store from './store.js';
import * as Lock from './lock.js';
import { state, render, renderIfIdle, refreshPriceStatus, initTopbar, toast, triggerRefresh } from './core.js';
import './views-main.js';
import './views-insight.js';
import './views-write.js';
import './views-funds.js';
import './views-virtual.js';

async function init() {
  // Dropbox OAuth 복귀 처리
  const justConnected = await Dbx.handleCallback().catch(() => false);

  // PIN 잠금: 설정돼 있으면 맞을 때까지 화면을 가림
  if (Lock.hasPin()) await Lock.showLock();

  Sync.init({
    state,
    persist: () => Store.save(state),
    // 동기화가 실제로 바꾼 게 있을 때만 불린다. 그때도 쓰던 글이 있으면 다시 그리지 않는다.
    onApplied: () => { renderIfIdle(); },
  });

  // 원격 데이터 먼저 병합(연결돼 있으면) → 시세 로드 → 렌더
  if (Dbx.connected()) await Sync.syncNow();
  await P.load(state.settings);
  syncNames();
  // 시세가 생긴 심볼은 미등록 목록에서 자동 제거
  const pending = state.pendingSymbols.filter(s => !P.has(s));
  if (pending.length !== state.pendingSymbols.length) {
    state.pendingSymbols = pending;
    Store.save(state);
  }
  refreshPriceStatus();
  initTopbar();
  render();
  window.addEventListener('hashchange', render);
  if (justConnected) toast('Dropbox에 연결됐습니다. 이제 기기 간 동기화됩니다.');

  // 시세는 저장소 크론이 각 시장 마감 직후 미리 받아 둔다 — 앱은 읽기만 한다.
  // 다만 GitHub 예약은 정시 보장이 없어 밀리는 날이 있다(실측 최대 3시간). 그런 날 앱을 열면
  // '오늘 종가가 나와 있어야 하는데 없다'를 감지해 서버 갱신을 한 번 요청해 둔다.
  // 기기·시장·날짜당 1회만(localStorage). 휴장일 오탐은 서버가 몇 초 만에 걸러내므로 무해.
  try {
    const stale = P.staleClosedMarkets();
    if (stale.length && state.settings.ghPat && state.settings.ghRepo) {
      const K = 'onefund.autoFetch';
      let done = {};
      try { done = JSON.parse(localStorage.getItem(K) || '{}'); } catch { /* 손상 무시 */ }
      const need = stale.filter(s => done[s.mkt] !== s.day);
      if (need.length) {
        for (const s of need) done[s.mkt] = s.day;
        localStorage.setItem(K, JSON.stringify(done));
        // 비어 있는 시장이 하나면 그 시장만 받는다 — 한국 종가만 없는데 미국 종목까지
        // 받으면 기다리는 시간이 세 배가 된다.
        triggerRefresh({ quiet: true, market: need.length === 1 ? need[0].mkt : 'all' });
      }
    }
  } catch { /* 자가 치유는 실패해도 조용히 — 다음 크론이 어차피 받는다 */ }
}

// 저장된 데이터의 종목명을 시세의 자동 이름(한국=한글/미국=영문)으로 맞춘다.
// 시세에 등록된 종목만 갱신하며, 이름이 실제로 바뀐 경우만 updatedAt을 올려 동기화로 전파.
function syncNames() {
  let changed = false;
  const apply = (obj, symKey, nameKey) => {
    const info = P.info(obj[symKey]);
    if (info && obj[nameKey] !== info.name) { obj[nameKey] = info.name; obj.updatedAt = Date.now(); changed = true; }
  };
  for (const t of state.trades) apply(t, 'symbol', 'name');
  for (const w of state.watchlist || []) apply(w, 'symbol', 'name');
  for (const s of state.swaps || []) { apply(s, 'fromSymbol', 'fromName'); apply(s, 'toSymbol', 'toName'); }
  // 가상 펀드의 매수 건은 펀드 안에 들어 있다 — 이름이 바뀌면 건이 아니라 '펀드'의 시각을
  // 올려야 동기화가 전파한다(병합 단위가 펀드이므로).
  for (const v of state.virtuals || []) {
    let touched = false;
    for (const p of v.positions || []) {
      const info = P.info(p.symbol);
      if (info && p.name !== info.name) { p.name = info.name; touched = true; }
    }
    if (touched) { v.updatedAt = Date.now(); changed = true; }
  }
  if (changed) { Store.save(state); Sync.schedule(); }
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
