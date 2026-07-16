// 진입점
import * as P from './prices.js';
import * as Dbx from './dropbox.js';
import * as Sync from './sync.js';
import * as Store from './store.js';
import * as Lock from './lock.js';
import { state, render, refreshPriceStatus, initTopbar, toast } from './core.js';
import './views-main.js';
import './views-insight.js';
import './views-write.js';

async function init() {
  // Dropbox OAuth 복귀 처리
  const justConnected = await Dbx.handleCallback().catch(() => false);

  // PIN 잠금: 설정돼 있으면 맞을 때까지 화면을 가림
  if (Lock.hasPin()) await Lock.showLock();

  Sync.init({
    state,
    persist: () => Store.save(state),
    onApplied: () => { render(); },
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

  // 정규장이 열린 시장이 있으면 백그라운드로 최신 시세 갱신을 요청하고,
  // 워크플로가 끝날 즈음(약 40초 뒤) 조용히 다시 불러와 화면을 갱신한다.
  // 화면은 즉시 기존 데이터로 그려지므로 이 요청이 첫 로딩을 지연시키지 않는다.
  P.maybeRefreshLive(state.settings).then(triggered => {
    if (!triggered) return;
    setTimeout(async () => {
      await P.load(state.settings);
      refreshPriceStatus();
      render();
    }, 40000);
  }).catch(() => {});
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
  if (changed) { Store.save(state); Sync.schedule(); }
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
