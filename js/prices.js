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

// cache:'no-cache' = '캐시를 쓰지 마라'가 아니라 '쓰기 전에 반드시 서버에 확인하라'는 뜻.
// 내용이 그대로면 304(본문 없음)라 공짜에 가깝고, 바뀌었으면 200으로 새 내용이 온다.
// 87개 파일을 매번 통째로 받지 않으면서도 최신을 보장하므로 no-store보다 이쪽이 맞다.
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

// 시세 갱신은 앱이 아니라 저장소의 크론이 한다 — 한국·미국이 각각 마감한 직후 하루 한 번씩,
// 휴장일은 건너뛰고(시장 판정·휴장일 캘린더는 PROJ210-data의 scripts/fetch_prices.py에 있다).
// 앱을 열 때 갱신을 요청하던 로직은 제거했다: 실시간 시세가 필요하지 않은데 열 때마다
// Actions를 돌려 한도를 갉아먹었고, 기기별 쓰로틀이라 PC·폰을 같이 열면 중복 실행됐다.
// 사용자가 지금 당장 받고 싶으면 상단바의 갱신 버튼(forceRefresh)을 누르면 된다.
export async function forceRefresh(cfg) {
  if (!ghReady(cfg)) throw new Error('시세 저장소가 설정되지 않았습니다');
  await dispatchRefresh(cfg);
}

export const has = sym => map.has(sym);
export const symbols = () => [...map.keys()];
export const updatedAt = () => meta?.updatedAt ? new Date(meta.updatedAt * 1000) : null;

// 시장 구분: 한국(.KS/.KQ) vs 미국(그 외). 지수(^)·환율(KRW=X)은 호출 전에 걸러 쓴다.
function marketOf(sym) { return /\.(KS|KQ)$/.test(sym) ? 'kr' : 'us'; }

const CLOSE_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

// 시세(종가) 기준 시각 — 수집 시각(meta.updatedAt)이 아니라 '종가가 찍히는 정해진 시각'.
// 종가는 시장별로 마감 시각이 고정돼 있으므로 봉 날짜 + 고정 마감시각으로 계산한다.
//   - 한국: 그 거래일 15:30 KST
//   - 미국: 그 거래일 16:00 ET → 파일의 gmtoffset로 서머타임 판별해 KST로 (05:00/06:00 다음날)
// 반환: { kr:'YYYY-MM-DD HH:MM', us:'…' } — 해당 시장 종목이 없으면 그 키는 없다.
export function closeStamps() {
  const latest = {}; // 'kr'|'us' -> {date, gmtoffset}
  for (const [sym, d] of map) {
    if (sym === 'KRW=X' || sym.startsWith('^')) continue; // 환율·지수는 마감시각이 달라 제외
    if (!d.closes?.length) continue;
    const date = d.closes[d.closes.length - 1][0];
    const mk = marketOf(sym);
    if (!latest[mk] || date > latest[mk].date) latest[mk] = { date, gmtoffset: d.gmtoffset };
  }
  const out = {};
  if (latest.kr) out.kr = `${latest.kr.date} 15:30`; // 한국 종가는 15:30 KST (거래일 = KST 날짜)
  if (latest.us) {
    // 미국 16:00 ET를 UTC로: 'date 16:00'을 UTC로 읽은 뒤 gmtoffset만큼 되돌린다
    const off = latest.us.gmtoffset ?? -14400; // 미상이면 서머타임(-4h) 가정
    const utcMs = Date.parse(`${latest.us.date}T16:00:00Z`) - off * 1000;
    out.us = CLOSE_FMT.format(new Date(utcMs)).replace('T', ' ');
  }
  return out;
}

export function info(sym) {
  const d = map.get(sym);
  return d ? { name: d.name, currency: d.currency } : null;
}

// 시세가 멈춘 종목(거래정지·상장폐지)이면 멈춘 날짜, 정상이면 null.
// 멈춘 종가를 '현재가'로 쓴 수익률은 사실이 아니므로 화면에서 표시해 경고한다.
export function frozenSince(sym) {
  return map.get(sym)?.frozenSince || null;
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

// 마지막 시세의 거래소 현지 시각 'HH:MM'(24시간). 시세 시각이 마지막 봉의 날짜와 다르면
// (야후가 그날 봉을 빠뜨려 옛 봉을 들고 있는 경우) 시간을 붙이면 거짓이 되므로 null.
// 날짜(closes[0])도 거래소 현지 기준이라 시간도 같은 기준으로 맞춘다 — 미국 종목은 16:00 ET.
function quoteHM(d, lastDate) {
  if (!d.quoteTime) return null;
  const s = new Date((d.quoteTime + (d.gmtoffset || 0)) * 1000).toISOString();
  return s.slice(0, 10) === lastDate ? s.slice(11, 16) : null;
}

export function last(sym) {
  const d = map.get(sym);
  if (!d || !d.closes.length) return null;
  const r = d.closes[d.closes.length - 1];
  return { date: r[0], close: r[1], adj: r[2], time: quoteHM(d, r[0]) };
}

// "2026-07-16 15:30" (시각을 모르면 날짜만) — 거래소 현지 기준
export function lastStamp(sym) {
  const l = last(sym);
  return l ? l.date + (l.time ? ' ' + l.time : '') : null;
}
export function firstDate(sym) {
  const d = map.get(sym);
  return d?.closes.length ? d.closes[0][0] : null;
}

// 최근 n개 수정종가 (보유 종목 표의 추세 스파크라인용).
// 수정종가를 쓰는 이유: 액면분할·병합이 있으면 원종가는 그 지점에서 뚝 끊겨 가짜 급락처럼 보인다.
export function recentAdj(sym, n = 120) {
  const d = map.get(sym);
  if (!d || !d.closes.length) return [];
  return d.closes.slice(-n).map(r => r[2]).filter(v => v != null && isFinite(v));
}

// from 이후의 (날짜, 종가) 계열 — 종목 상세의 주가 차트용.
// 실제 종가(수정 전)를 쓴다: 툴팁의 '당시 주가'와 내가 기록한 매매가가 맞아떨어져야 하므로.
// 대신 그 구간에 액면분할이 있으면 선이 뚝 끊긴다 → split 플래그로 알려 화면에서 안내한다.
export function seriesFrom(sym, from = null) {
  const d = map.get(sym);
  if (!d || !d.closes.length) return { labels: [], values: [], split: false };
  const rows = d.closes.filter(r => (!from || r[0] >= from) && r[1] != null && isFinite(r[1]));
  // 원종가/수정종가 비율이 구간 안에서 크게 달라지면 분할·병합이 있었다는 뜻
  let split = false;
  if (rows.length > 1) {
    const ratio = r => (r[2] && r[1]) ? r[2] / r[1] : null;
    const a = ratio(rows[0]), b = ratio(rows[rows.length - 1]);
    if (a && b && Math.abs(Math.log(b / a)) > Math.log(1.5)) split = true;
  }
  return { labels: rows.map(r => r[0]), values: rows.map(r => r[1]), split };
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
