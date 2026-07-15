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

export function fmtQty(v) {
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
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
