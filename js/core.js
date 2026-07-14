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

export const NAV = [
  { id: 'home', label: '홈', ico: '🏛️' },
  { id: 'trades', label: '기록', ico: '✍️' },
  { id: 'watch', label: '관심', ico: '👁️' },
  { id: 'diary', label: '일지', ico: '📓' },
  { id: 'more', label: '더보기', ico: '☰' },
];
export const NAV_DESKTOP = [
  ['home', '홈'], ['trades', '기록'], ['watch', '관심'], ['worlds', '평행우주'], ['actions', '개입 점수'],
  ['diary', '일지'], ['quotes', '글귀'], ['letters', '서한'], ['rules', '헌법'], ['ai', 'AI 복기'], ['settings', '설정'],
];

export function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  return h || 'home';
}

export function go(route) { location.hash = '#/' + route; }

export function render() {
  const route = currentRoute();
  const fn = views[route] || views.home;
  const main = document.getElementById('view');
  main.innerHTML = fn();
  // 뷰별 후처리(이벤트 바인딩)
  if (fn.bind_) fn.bind_(main);
  renderNav(route);
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
  document.getElementById('fund-name').textContent = state.settings.fundName || '1인 펀드';
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
