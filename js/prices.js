// 시세 모듈: 시세 JSON 로드 + 조회 헬퍼
// 출처 1) 비공개 GitHub 저장소(설정에 개인 토큰 등록 시) — 배포판 기본
// 출처 2) 같은 폴더의 data/ (로컬 개발용)
// closes: [ [YYYY-MM-DD, 종가, 수정종가(배당·분할 반영)] ... ] 날짜 오름차순

const map = new Map(); // symbol -> {name, currency, closes, dates[]}
let meta = null;
let source = null; // 'github' | 'local' | null

function safeName(symbol) {
  return symbol.replace(/[^A-Za-z0-9.\-]/g, '_');
}

// ---- GitHub 비공개 저장소 접근 ----
function ghReady(cfg) { return !!(cfg && cfg.ghPat && cfg.ghRepo); }

async function ghGet(cfg, path, raw = true) {
  const r = await fetch(`https://api.github.com/repos/${cfg.ghRepo}/contents/${path}`, {
    headers: {
      'Authorization': 'Bearer ' + cfg.ghPat,
      'Accept': raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    },
    cache: 'no-cache',
  });
  if (!r.ok) throw new Error('gh ' + r.status + ' ' + path);
  return r.json();
}

function ingest(sym, d) {
  d.dates = d.closes.map(r => r[0]);
  map.set(sym, d);
}

export async function load(cfg = null) {
  // 1) 비공개 저장소
  if (ghReady(cfg)) {
    try {
      meta = await ghGet(cfg, 'data/meta.json');
      await Promise.all((meta.symbols || []).map(async sym => {
        try {
          const f = meta.files?.[sym] || safeName(sym) + '.json';
          ingest(sym, await ghGet(cfg, 'data/prices/' + f));
        } catch { /* 개별 실패 무시 */ }
      }));
      if (map.size) { source = 'github'; return source; }
    } catch { /* 로컬로 폴백 */ }
  }
  // 2) 로컬 data/
  try {
    meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json();
    await Promise.all((meta.symbols || []).map(async sym => {
      try {
        const f = meta.files?.[sym] || safeName(sym) + '.json';
        const d = await (await fetch('data/prices/' + f, { cache: 'no-cache' })).json();
        ingest(sym, d);
      } catch { /* 개별 실패 무시 */ }
    }));
    if (map.size) { source = 'local'; return source; }
  } catch { meta = null; }
  return null;
}

export const loadedFrom = () => source;

// GitHub 연결 확인 (설정 화면용)
export async function ghTest(cfg) {
  if (!ghReady(cfg)) return { ok: false, msg: '저장소와 토큰을 입력하세요' };
  try {
    const m = await ghGet(cfg, 'data/meta.json');
    return { ok: true, msg: `연결됨 — 종목 ${ (m.symbols || []).length }개` };
  } catch (e) {
    return { ok: false, msg: '연결 실패 (' + e.message + ')' };
  }
}

// 시세 갱신 워크플로 즉시 실행 요청 (실패해도 다음 정기 갱신에 포함되므로 무시)
async function dispatchRefresh(cfg) {
  await fetch(`https://api.github.com/repos/${cfg.ghRepo}/actions/workflows/prices.yml/dispatches`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + cfg.ghPat, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
}

// 새 종목을 비공개 저장소 tickers.json에 추가하고 시세 갱신 워크플로 실행
export async function registerTicker(cfg, symbol) {
  if (!ghReady(cfg)) throw new Error('GitHub 설정 없음');
  const cur = await ghGet(cfg, 'data/tickers.json', false); // {content(base64), sha}
  const text = new TextDecoder().decode(Uint8Array.from(atob(cur.content.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const j = JSON.parse(text);
  j.symbols = j.symbols || [];
  if (!j.symbols.includes(symbol)) {
    j.symbols.push(symbol);
    const body = JSON.stringify(j, null, 2);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
    const put = await fetch(`https://api.github.com/repos/${cfg.ghRepo}/contents/data/tickers.json`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + cfg.ghPat, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `티커 추가: ${symbol}`, content: b64, sha: cur.sha }),
    });
    if (!put.ok) throw new Error('tickers.json 갱신 실패 ' + put.status);
  }
  try { await dispatchRefresh(cfg); } catch { /* cron이 처리 */ }
}

// ---- 거래소 휴장일 캘린더 (종일 휴장만. 반일 조기폐장은 반영하지 않음) ----
// 규칙만으로 계산 불가라 연도별로 직접 관리한다(한국: 음력 설날·추석·대체·임시공휴일 / 미국: 부활절 연동 성금요일).
// **매년 다음 해 휴장일을 추가할 것.** (마지막 갱신 2026-07, 2027 고정 휴장일까지 수록)
// 목록에 없는 날짜는 정상 거래일로 간주(fail-open): 빠뜨린 휴장일엔 헛갱신이 갈 뿐 무해하지만,
// 실제 거래일을 잘못 넣으면 그날 실시간 갱신이 막히므로 확실한 날짜만 넣는다.
const HOLIDAYS_KR = new Set([
  // 2025
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-03',
  '2025-05-01', '2025-05-05', '2025-05-06', '2025-06-03', '2025-06-06', '2025-08-15',
  '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-10-10', '2025-12-25', '2025-12-31',
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-25',
  '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-28', '2026-10-05', '2026-10-09', '2026-12-25', '2026-12-31',
  // 2027 — 음력(설날·부처님오신날·추석)은 확정 후 보완, 우선 고정 휴장일·대체공휴일만
  '2027-01-01', '2027-03-01', '2027-05-05', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-31',
]);
const HOLIDAYS_US = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
const HOLIDAYS = { kr: HOLIDAYS_KR, us: HOLIDAYS_US };

// 지정 시장의 특정 날짜(YYYY-MM-DD, 그 시장 현지 날짜)가 휴장일인지 — 검증·재사용용
export function isMarketHoliday(market, dateStr) { return !!HOLIDAYS[market]?.has(dateStr); }

// ---- 정규장 시간 판정 (Intl 타임존 변환 — DST 자동 처리) ----
function nowInZone(timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // hour12:false 환경에서 자정을 '24'로 주는 경우 보정
  return {
    weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`, // 그 시장 현지 날짜
    minutesOfDay: hour * 60 + parseInt(p.minute, 10),
  };
}

function isOpen(timeZone, openMin, closeMin, holidays) {
  const { weekday, minutesOfDay, date } = nowInZone(timeZone);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (holidays.has(date)) return false; // 공휴일 휴장
  return minutesOfDay >= openMin && minutesOfDay <= closeMin;
}

// 한국(09:00–15:30 KST)·미국(9:30–16:00 ET) 정규장 개장 여부. 주말·공휴일 휴장 반영.
export function marketStatus() {
  return {
    kr: isOpen('Asia/Seoul', 9 * 60, 15 * 60 + 30, HOLIDAYS_KR),
    us: isOpen('America/New_York', 9 * 60 + 30, 16 * 60, HOLIDAYS_US),
  };
}

const K_LAST_TRIGGER = 'onefund.lastPriceTrigger';
const REFRESH_MIN_GAP_MS = 2 * 60 * 1000; // 같은 기기에서 최소 2분 간격

// 앱을 열 때 호출: 정규장이 열린 시장이 하나라도 있으면(그리고 최근에 요청한 적 없으면) 즉시 갱신 트리거.
// 두 시장 다 마감 상태면 이미 확정 종가를 보유하고 있으므로 트리거하지 않음.
export async function maybeRefreshLive(cfg) {
  if (!ghReady(cfg)) return false;
  const { kr, us } = marketStatus();
  if (!kr && !us) return false;
  const last = parseInt(localStorage.getItem(K_LAST_TRIGGER) || '0', 10);
  if (Date.now() - last < REFRESH_MIN_GAP_MS) return false;
  localStorage.setItem(K_LAST_TRIGGER, String(Date.now()));
  try { await dispatchRefresh(cfg); return true; } catch { return false; }
}

export const has = sym => map.has(sym);
export const symbols = () => [...map.keys()];
export const updatedAt = () => meta?.updatedAt ? new Date(meta.updatedAt * 1000) : null;

export function info(sym) {
  const d = map.get(sym);
  return d ? { name: d.name, currency: d.currency } : null;
}

// dates에서 target 이하의 마지막 인덱스 (이진 탐색)
function idxOn(d, target) {
  const a = d.dates;
  let lo = 0, hi = a.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function rowOn(sym, date) {
  const d = map.get(sym);
  if (!d) return null;
  const i = idxOn(d, date);
  return i < 0 ? null : d.closes[i];
}

export function closeOn(sym, date) { const r = rowOn(sym, date); return r ? r[1] : null; }
export function adjOn(sym, date) { const r = rowOn(sym, date); return r ? r[2] : null; }

export function last(sym) {
  const d = map.get(sym);
  if (!d || !d.closes.length) return null;
  const r = d.closes[d.closes.length - 1];
  return { date: r[0], close: r[1], adj: r[2] };
}
export function firstDate(sym) {
  const d = map.get(sym);
  return d?.closes.length ? d.closes[0][0] : null;
}

// 배당·분할 반영 성장배수. to 생략 시 최신까지.
export function growth(sym, from, to = null) {
  const a = adjOn(sym, from);
  const b = to ? adjOn(sym, to) : last(sym)?.adj;
  if (!a || !b) return null;
  return b / a;
}

// 원/달러 환율 (해당일 이하 마지막)
export function fxOn(date = null) {
  const r = date ? rowOn('KRW=X', date) : (last('KRW=X') && [null, last('KRW=X').close]);
  return r ? r[1] : null;
}

export function toKRW(amount, currency, date = null) {
  if (amount == null) return null;
  if (currency === 'USD') {
    const fx = fxOn(date);
    return fx ? amount * fx : null;
  }
  return amount;
}

// KR 6자리 코드 → 실제 심볼 추정 (.KS / .KQ). 시세 파일이 있으면 그걸 우선.
export function resolveSymbol(input) {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  if (map.has(s)) return s;
  if (/^\d{6}$/.test(s)) {
    if (map.has(s + '.KS')) return s + '.KS';
    if (map.has(s + '.KQ')) return s + '.KQ';
    return s + '.KS'; // 미등록이면 일단 코스피로 추정
  }
  return s;
}

export function currencyOf(sym) {
  const d = map.get(sym);
  if (d) return d.currency;
  return /\.(KS|KQ)$/.test(sym) ? 'KRW' : 'USD';
}
