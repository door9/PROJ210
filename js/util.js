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

// 억/만 단위 한글 표기: 만 단위로 반올림해 "3억0500만원" 형태 (억은 항상, 만은 4자리 고정)
export function moneyKorean(v) {
  if (v == null || isNaN(v)) return '–';
  const neg = v < 0;
  const man = Math.round(Math.abs(v) / 1e4); // 만 단위로 반올림 (자리올림 자동 처리)
  const eok = Math.floor(man / 1e4);
  const rest = man % 1e4;
  return (neg ? '-' : '') + eok.toLocaleString('ko-KR') + '억' + String(rest).padStart(4, '0') + '만원';
}

// 부호를 붙인 원화 정수(₩ 없이): +65,393,142 / -6,030,624 (색은 pctClass로 — 상승 빨강·하락 파랑)
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
// 그 방향의 가장 가까운 유효 호가로 스냅한다(HTS와 동일한 동작).
//
// 내려갈 때는 tick 을 (p-1) 기준으로 정한다 — p 가 구간 경계값(2000·5000 등)이면
// 그 경계는 '위쪽' 구간에 속해 tick 이 더 크므로, 그대로 쓰면 바로 아래 구간의
// 촘촘한 호가들을 건너뛴다(예: 2000원에서 ↓ 누르면 1999원이 아니라 1995원으로
// 튀는 문제). 실제 KRX 호가는 각 경계값이 그 아래 구간 tick 의 배수라 이렇게
// 구해도 항상 유효한 호가에 정확히 맞아떨어진다.
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
// 직접 타이핑은 그대로 1원 단위 자유 입력(step="any" 유지) — 이 바인딩은 키보드
// ArrowUp/ArrowDown 만 가로챈다. getCurrency() 가 'KRW' 가 아니면 브라우저 기본 동작(±1) 유지.
export function bindKrArrowStep(input, getCurrency) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (getCurrency() !== 'KRW') return;
    e.preventDefault();
    const next = krStepPrice(parseFloat(input.value) || 0, e.key === 'ArrowUp' ? 1 : -1);
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
