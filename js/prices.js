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
  // 시세 갱신 워크플로 즉시 실행 (실패해도 다음 정기 갱신에 포함되므로 무시)
  try {
    await fetch(`https://api.github.com/repos/${cfg.ghRepo}/actions/workflows/prices.yml/dispatches`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.ghPat, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
  } catch { /* cron이 처리 */ }
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
