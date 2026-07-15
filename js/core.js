// 앱 코어: 상태 보관, 라우터, 내비, 모달/토스트
import * as Store from './store.js';
import * as P from './prices.js';
import * as Sync from './sync.js';

export const state = Store.load();
export function saveNow() {
  Store.save(state);
  Sync.schedule(); // Dropbox 연결 시 3초 뒤 동기화
}

// ---- 토스트 ----
export function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---- 모달 ----
export function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-back').addEventListener('click', e => {
    if (e.target.classList.contains('modal-back')) closeModal();
  });
  return root.querySelector('.modal');
}
export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// 확인 모달 (Promise<boolean>)
export function confirmModal({ title, body, okLabel = '확인', danger = false }) {
  return new Promise(resolve => {
    const m = openModal(`
      <h2>${title}</h2>
      <div style="font-size:14px; white-space:pre-wrap;">${body}</div>
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn" data-x="no">취소</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${okLabel}</button>
      </div>`);
    m.querySelector('[data-x=no]').onclick = () => { closeModal(); resolve(false); };
    m.querySelector('[data-x=ok]').onclick = () => { closeModal(); resolve(true); };
  });
}

// ---- 라우터 ----
const views = {}; // name -> render fn
export function registerView(name, fn) { views[name] = fn; }

// 단색 선 아이콘 (currentColor 상속) — 하단 탭·더보기 메뉴 공용
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>'),
  trades: svg('<path d="M16.7 3.8l3.5 3.5L7.5 20H4v-3.5L16.7 3.8z"/>'),
  watch: svg('<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.2z"/>'),
  diary: svg('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12.5h6"/>'),
  more: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  worlds: svg('<path d="M4 19c8 0 8-14 16-14M4 5c8 0 8 14 16 14"/>'),
  actions: svg('<path d="M12 4.5V19M7.5 19h9M4 7.5h16"/><path d="M6 7.5l-2.3 5.5a2.6 2.6 0 004.6 0L6 7.5zM18 7.5l-2.3 5.5a2.6 2.6 0 004.6 0L18 7.5z"/>'),
  quotes: svg('<path d="M12 6.5C10 5 7 5 4 5.8V19c3-.8 6-.8 8 .7 2-1.5 5-1.5 8-.7V5.8C17 5 14 5 12 6.5z"/><path d="M12 6.5V19.7"/>'),
  letters: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>'),
  rules: svg('<path d="M4 20h16M6 16.5V10M10 16.5V10M14 16.5V10M18 16.5V10M3.5 10h17L12 3.8 3.5 10z"/>'),
  ai: svg('<path d="M11 4.5l1.4 4.1 4.1 1.4-4.1 1.4L11 15.5l-1.4-4.1-4.1-1.4 4.1-1.4L11 4.5z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>'),
  cost: svg('<circle cx="12" cy="12" r="8.3"/><path d="M9.2 15.2c.6.8 1.6 1.3 2.8 1.3 1.7 0 2.8-.9 2.8-2.2 0-2.9-5.2-1.6-5.2-4.4 0-1.2 1-2.1 2.6-2.1 1.1 0 2 .5 2.6 1.2"/><path d="M12 6.6v10.8"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/>'),
  returns: svg('<path d="M4 4v16h16"/><path d="M8 16v-4M13 16v-8M18 16v-6"/>'),
};

export const NAV = [
  { id: 'home', label: '홈', ico: ICONS.home },
  { id: 'trades', label: '기록', ico: ICONS.trades },
  { id: 'watch', label: '관심', ico: ICONS.watch },
  { id: 'diary', label: '일지', ico: ICONS.diary },
  { id: 'more', label: '더보기', ico: ICONS.more },
];
export const NAV_DESKTOP = [
  ['home', '홈'], ['trades', '기록'], ['watch', '관심'], ['returns', '수익률'], ['worlds', '평행우주'], ['actions', '개입 점수'],
  ['diary', '일지'], ['cost', '비용'], ['quotes', '글귀'], ['letters', '서한'], ['rules', '헌법'], ['ai', 'AI 복기'], ['settings', '설정'],
];

export function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  return h || 'home';
}

export function go(route) { location.hash = '#/' + route; }

export function render() {
  const route = currentRoute();
  // 파라미터 경로 지원: "symbol/AAPL" → 뷰 'symbol', 인자 'AAPL'
  const slash = route.indexOf('/');
  const name = slash < 0 ? route : route.slice(0, slash);
  const arg = slash < 0 ? '' : decodeURIComponent(route.slice(slash + 1));
  const fn = views[name] || views.home;
  const main = document.getElementById('view');
  main.innerHTML = fn(arg);
  // 뷰별 후처리(이벤트 바인딩)
  if (fn.bind_) fn.bind_(main, arg);
  renderNav(name);
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

function renderNav(route) {
  const bn = document.getElementById('bottom-nav');
  bn.innerHTML = NAV.map(n => {
    const active = route === n.id || (n.id === 'more' && !NAV.some(x => x.id === route));
    return `<a href="#/${n.id}" class="${active ? 'active' : ''}"><span class="ico">${n.ico}</span>${n.label}</a>`;
  }).join('');
  const dn = document.getElementById('desktop-nav');
  dn.innerHTML = NAV_DESKTOP.map(([id, label]) =>
    `<a href="#/${id}" class="${route === id ? 'active' : ''}">${label}</a>`).join('');
  document.getElementById('fund-name').textContent = state.settings.fundName || 'PROJ210';
}

// 사용자가 버튼으로 요청하는 즉시 시세 갱신 (홈·설정 공용)
let refreshing = false;
export async function triggerRefresh() {
  if (refreshing) return;
  if (!state.settings.ghPat || !state.settings.ghRepo) { toast('설정에서 시세 저장소를 먼저 연결하세요'); return; }
  refreshing = true;
  toast('시세 갱신을 요청했습니다 — 잠시 뒤 반영됩니다');
  try {
    await P.forceRefresh(state.settings);
    // 워크플로가 끝날 즈음 다시 불러와 화면 갱신
    setTimeout(async () => {
      await P.load(state.settings);
      refreshPriceStatus();
      render();
      refreshing = false;
      toast('시세를 갱신했습니다');
    }, 40000);
  } catch (e) {
    refreshing = false;
    toast('갱신 실패: ' + (e && e.message || e));
  }
}

export function refreshPriceStatus() {
  const el = document.getElementById('price-status');
  const u = P.updatedAt();
  if (!u) { el.textContent = '시세 없음'; return; }
  const mm = String(u.getMonth() + 1).padStart(2, '0');
  const dd = String(u.getDate()).padStart(2, '0');
  const hh = String(u.getHours()).padStart(2, '0');
  const mi = String(u.getMinutes()).padStart(2, '0');
  el.innerHTML = `시세 갱신<br>${mm}.${dd} ${hh}:${mi}`;
}
