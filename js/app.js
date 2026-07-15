// 진입점
import * as P from './prices.js';
import * as Dbx from './dropbox.js';
import * as Sync from './sync.js';
import * as Store from './store.js';
import { state, render, refreshPriceStatus, toast } from './core.js';
import './views-main.js';
import './views-insight.js';
import './views-write.js';

async function init() {
  // Dropbox OAuth 복귀 처리
  const justConnected = await Dbx.handleCallback().catch(() => false);

  Sync.init({
    state,
    persist: () => Store.save(state),
    onApplied: () => { render(); },
  });

  // 원격 데이터 먼저 병합(연결돼 있으면) → 시세 로드 → 렌더
  if (Dbx.connected()) await Sync.syncNow();
  await P.load(state.settings);
  // 시세가 생긴 심볼은 미등록 목록에서 자동 제거
  const pending = state.pendingSymbols.filter(s => !P.has(s));
  if (pending.length !== state.pendingSymbols.length) {
    state.pendingSymbols = pending;
    Store.save(state);
  }
  refreshPriceStatus();
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

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
