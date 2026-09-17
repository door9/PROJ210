// 공용 유틸: 날짜, 포맷, id

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// 로컬(사용자 기기, KST) 기준 YYYY-MM-DD
export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function addMonthsStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// 분기 문자열: '2026-Q2'
export function quarterOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}
export function quarterRange(q) {
  const [y, qn] = q.split('-Q').map(Number);
  const m0 = (qn - 1) * 3 + 1;
  const last = new Date(y, m0 + 2, 0).getDate();
  return [`${y}-${String(m0).padStart(2, '0')}-01`, `${y}-${String(m0 + 2).padStart(2, '0')}-${last}`];
}
export function prevQuarter(q) {
  const [y, qn] = q.split('-Q').map(Number);
  return qn === 1 ? `${y - 1}-Q4` : `${y}-Q${qn - 1}`;
}

export function fmtMoney(v, currency = 'KRW') {
  if (v == null || isNaN(v)) return '–';
  if (currency === 'USD') return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '₩' + Math.round(v).toLocaleString('ko-KR');
}

// 억/만 단위 한글 표기 (억은 항상, 만은 4자리 고정)
export function moneyKorean(v) {
  if (v == null || isNaN(v)) return '–';
  const neg = v < 0;
  const man = Math.round(Math.abs(v) / 1e4); // 만 단위로 반올림 (자리올림 자동 처리)
  const eok = Math.floor(man / 1e4);
  const rest = man % 1e4;
  return (neg ? '-' : '') + eok.toLocaleString('ko-KR') + '억' + String(rest).padStart(4, '0') + '만원';
}

// 부호를 붙인 원화 정수(₩ 없이). 색은 pctClass로 — 상승 빨강·하락 파랑
export function fmtSigned(v) {
  if (v == null || isNaN(v)) return '–';
  const n = Math.round(v);
  return (n > 0 ? '+' : '') + n.toLocaleString('ko-KR');
}

export function fmtQty(v) {
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

// 원/달러 환율: 소수점 첫째 자리까지 (1,483.1). 정수로 반올림하면 하루 등락이 통째로 사라진다.
export function fmtFx(v) {
  if (v == null || isNaN(v)) return '–';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// +12.3% 형태 (한국 관례: 상승 빨강, 하락 파랑 — 클래스는 호출부에서)
export function fmtPct(r, digits = 1) {
  if (r == null || isNaN(r)) return '–';
  const p = r * 100;
  return (p > 0 ? '+' : '') + p.toFixed(digits) + '%';
}
export function pctClass(r) {
  if (r == null || isNaN(r) || Math.abs(r) < 0.00005) return 'flat';
  return r > 0 ? 'up' : 'down';
}

export function fmtDate(dateStr) {
  return dateStr; // YYYY-MM-DD 그대로 (간결)
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 한국 증시 호가 단위 — 가격대별 최소 주문 간격 (원)
export function krTickSize(price) {
  const p = Number(price) || 0;
  if (p < 2000) return 1;
  if (p < 5000) return 5;
  if (p < 20000) return 10;
  if (p < 50000) return 50;
  if (p < 200000) return 100;
  if (p < 500000) return 500;
  return 1000;
}

// 방향키 한 번에 이동할 다음/이전 호가. 현재 값이 호가 단위에 안 맞아도(직접 입력값)
export function krStepPrice(price, dir) {
  const p = Math.max(0, Math.round(Number(price) || 0));
  if (dir > 0) {
    const tick = krTickSize(p);
    return Math.floor(p / tick) * tick + tick;
  }
  const tick = krTickSize(Math.max(0, p - 1));
  return Math.max(0, Math.ceil(p / tick) * tick - tick);
}

// 가격 입력칸의 방향키 위/아래를 한국 종목 호가 단위로 스텝하게 만든다.
export function bindKrArrowStep(input, getCurrency) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (getCurrency() !== 'KRW') return;
    e.preventDefault();
    const next = krStepPrice(numOf(input) || 0, e.key === 'ArrowUp' ? 1 : -1);
    setNum(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---- 숫자 입력칸: 세 자리마다 콤마 -----------------------------------------------
export function fmtInput(s) {
  const t = String(s ?? '').replace(/[^\d.-]/g, '');
  if (t === '' || t === '-' || t === '.') return t;
  const neg = t.startsWith('-');
  const [i, ...rest] = t.replace(/-/g, '').split('.');
  const head = (i || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = rest.length ? '.' + rest.join('').slice(0, 8) : '';
  return (neg ? '-' : '') + (head || '0') + dec;
}

// 입력칸의 실제 숫자 (콤마 제거). 비었으면 NaN
export function numOf(input) {
  const raw = String(input?.value ?? '').replace(/,/g, '').trim();
  return raw === '' ? NaN : parseFloat(raw);
}

export function setNum(input, v) {
  input.value = fmtInput(String(v));
}

// 입력하는 동안 콤마를 유지한다. 커서는 '오른쪽에 남은 숫자 개수'로 되돌려
// 콤마가 끼어들어도 제자리에 있게 한다.
export function bindThousands(input) {
  const apply = () => {
    const before = input.value;
    const caret = input.selectionStart ?? before.length;
    const digitsRight = before.slice(caret).replace(/[^\d.]/g, '').length;
    const after = fmtInput(before);
    if (after === before) return;
    input.value = after;
    let pos = after.length, seen = 0;
    while (pos > 0 && seen < digitsRight) { pos--; if (/[\d.]/.test(after[pos])) seen++; }
    try { input.setSelectionRange(pos, pos); } catch { /* type이 지원 안 하면 무시 */ }
  };
  input.addEventListener('input', apply);
  input.addEventListener('blur', apply);
  apply();
}

// 입력칸 상한 — 칸 아래에 "최대 얼마 — 무엇 기준"을 늘 보여 주고, 넘으면 그 자리에서 알린다.
export function bindCap(input, box, get) {
  const ph0 = input.placeholder;
  let cur = null;
  const render = () => {
    cur = get();
    if (!cur) { box.style.display = 'none'; box.innerHTML = ''; input.placeholder = ph0; return; }
    box.style.display = 'block';
    if (cur.max == null) {
      box.style.color = '';
      box.textContent = cur.note || '';
      input.placeholder = ph0;
      return;
    }
    const over = numOf(input) > cur.max + (cur.slack || 0);
    box.style.color = over ? 'var(--warn-ink)' : '';
    box.innerHTML = (over
      ? `<b>최대 ${cur.fmt(cur.max)}를 넘습니다</b> — ${cur.basis}`
      : `최대 <b>${cur.fmt(cur.max)}</b> — ${cur.basis}`)
      + (cur.max > 0 ? ' <button type="button" class="btn small" data-capfill style="margin-left:6px; padding:1px 8px;">전액</button>' : '');
    input.placeholder = '최대 ' + cur.fmt(cur.max);
  };
  box.addEventListener('click', e => {
    if (!e.target.closest('[data-capfill]') || !cur || cur.max == null) return;
    e.preventDefault();
    input.value = fmtInput(String(cur.fill ? cur.fill(cur.max) : cur.max));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  input.addEventListener('input', render);
  render();
  return {
    refresh: render,
    over: () => { render(); return !!cur && cur.max != null && numOf(input) > cur.max + (cur.slack || 0); },
    message: () => (cur && cur.max != null ? `최대 ${cur.fmt(cur.max)}까지 입력할 수 있습니다 — ${cur.basis}` : ''),
  };
}
