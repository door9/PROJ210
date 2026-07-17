// 진입점
import * as P from './prices.js';
import * as Dbx from './dropbox.js';
import * as Sync from './sync.js';
import * as Store from './store.js';
import * as Lock from './lock.js';
import { state, render, renderIfIdle, refreshPriceStatus, initTopbar, toast } from './core.js';
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
  // 시세 갱신은 앱이 요청하지 않는다 — 저장소 크론이 한국·미국 마감 직후 하루 한 번씩
  // 미리 받아 두므로, 앱은 이미 갱신된 파일을 읽기만 하면 된다(기다릴 일이 없다).
  // 지금 당장 받고 싶으면 상단바의 갱신 버튼.
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
