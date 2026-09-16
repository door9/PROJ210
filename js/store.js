// 상태 저장/불러오기 (localStorage) + 예시 데이터
import { uid, todayStr, addMonthsStr } from './util.js';

const KEY = 'onefund.v1';

export const EMOTIONS = ['확신', '차분', '설렘', '조급(놓칠까 봐)', '불안', '지루함', '복구 심리'];
export const SELL_REASON_TYPES = ['계획대로', '생각이 바뀌어서', '불안·공포', '더 좋은 곳에 쓰려고', '현금이 필요해서', '기타'];

export function defaultState() {
  return {
    version: 1,
    // settings는 통째로 동기화됨(마지막에 저장한 기기가 이긴다) — 바꿀 때 반드시 updatedAt 갱신.
    settings: { fundName: 'PROJ210', inception: null, ghRepo: '', ghPat: '', updatedAt: 0 },
    trades: [],      // 매매 기록
    diary: [],       // 홀딩 일지
    principles: [],  // 투자 헌법
    letters: [],     // 주주 서한
    quotes: [],      // 글귀 서랍 (책·자료에서 모은 문장)
    watchlist: [],   // 관심 종목 (안 산 판단의 기록)
    cashLog: [],     // 직접 입력한 현금 잔액 이력 [{id, date, KRW, USD}] — 비어 있으면 현금 0(주식만 합산)
    swaps: [],       // 교체 시뮬레이션 (보유 A → 관심 B 가정)
    loans: [],       // 투자용 대출(마이너스통장 등) 잔액 스냅샷 — 이자 비용 추적
    // 환전 내역(선택). 안 넣으면 앱이 매수 시점 시장 환율로 알아서 환전했다고 본다.
    exchanges: [],
    // 현금 입출금. 펀드 밖으로 뺀 돈·새로 넣은 돈을 **사용자가 확정해서** 남기는 기록.
    cashMoves: [],
    // 배당·이자 등 매매가 아닌 수입. 자본이 아니라 **수익**이므로 원금(넣은 돈)에 넣지 않는다.
    incomes: [],
    archives: [],    // 청산한 펀드 세대 (2ⁿ) — 아래 closeFund 참고
    // 가상 펀드: 실제로 사지 않은 종목을 "그때 샀다면" 굴려 보는 장부. 여러 개 만들 수 있다.
    virtuals: [],
    deleted: {},     // tombstone: {id: 삭제시각} — 동기화 시 부활 방지
    pendingSymbols: [], // 시세 파일이 아직 없는 심볼 (기기 로컬, 동기화 안 함)
  };
}

// ---- 펀드 세대(2ⁿ): 청산과 복원 ------------------------------------------------
export const FUND_COLLS = ['trades', 'diary', 'principles', 'letters', 'watchlist', 'swaps', 'loans', 'exchanges', 'cashMoves', 'incomes', 'cashLog'];

// 지금 펀드를 청산해 archives에 넣고 장부를 비운다.
// summary는 engine.fundSummary가 청산 시점에 계산한 성적표 — 열람할 때 다시 계산하지 않는다.
export function closeFund(state, { name, from, to, note, summary, newName, newInception }) {
  const now = Date.now();
  const snapshot = {};
  for (const c of FUND_COLLS) snapshot[c] = JSON.parse(JSON.stringify(state[c] || []));
  snapshot.depositRate = state.settings.depositRate ?? 3;
  snapshot.inception = state.settings.inception || null;  // 복원할 때 이 펀드의 시작일을 되돌리려고

  const ar = {
    id: uid(),
    gen: (state.archives || []).length + 1,
    name, from, to, note: note || '',
    closedAt: now, summary, snapshot,
    createdAt: now, updatedAt: now,
  };
  state.archives = [...(state.archives || []), ar];

  // 비우기 — 반드시 tombstone을 남긴다. 안 그러면 다른 기기의 Dropbox 사본이 "여긴 아직
  state.deleted = state.deleted || {};
  for (const c of FUND_COLLS) {
    for (const it of state[c] || []) state.deleted[it.id] = now;
    state[c] = [];
  }
  state.settings.fundName = newName || name;
  state.settings.inception = newInception || to;
  state.settings.updatedAt = now;
  return ar;
}

// 청산 되돌리기. 잘못 눌렀을 때를 위한 것이라, 새 펀드에 아직 아무 기록도 없을 때만 부른다.
export function restoreFund(state, id) {
  const ar = (state.archives || []).find(a => a.id === id);
  if (!ar) return false;
  const now = Date.now();
  for (const c of FUND_COLLS) {
    state[c] = (ar.snapshot[c] || []).map(it => ({ ...it, updatedAt: now }));
    for (const it of state[c]) delete state.deleted?.[it.id];
  }
  state.settings.fundName = ar.name;
  state.settings.inception = ar.snapshot.inception || null;
  state.settings.updatedAt = now;
  state.archives = state.archives.filter(a => a.id !== id);
  state.deleted = state.deleted || {};
  state.deleted[id] = now;   // 보관본 자체도 tombstone — 다른 기기에서 부활하지 않게
  return true;
}

// 현금 잔액 입력 한 줄 기록 (같은 기준일이면 덮어쓰기). 홈·설정 양쪽이 공용으로 쓴다.
export const cashId = date => 'cash-' + date;

// 항목 단위 컬렉션이라 기기 간 병합도 줄 단위로 된다 —
// 같은 날짜를 두 기기에서 고치면 그 줄만 나중 것이 이기고, 다른 날짜 입력은 살아남는다.
export function setCash(state, date, krw, usd) {
  state.cashLog = state.cashLog || [];
  const now = Date.now();
  const cur = state.cashLog.find(x => x.date === date);
  if (cur) {
    cur.id = cashId(date); cur.KRW = krw; cur.USD = usd; cur.updatedAt = now;
    // 직접 넣은 값이 곧 사실이다 — 입출금 자동 반영 흔적을 지워, 그 입출금을 지워도 이 값은 건드리지 않게 한다
    delete cur.auto; delete cur.autoAt;
  } else {
    state.cashLog.push({ id: cashId(date), date, KRW: krw, USD: usd, createdAt: now, updatedAt: now });
  }
  state.cashLog.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// 삭제는 반드시 이 함수로 — tombstone을 남겨 다른 기기에서 부활하지 않게 한다
export function removeItem(state, coll, id) {
  state[coll] = state[coll].filter(x => x.id !== id);
  state.deleted = state.deleted || {};
  state.deleted[id] = Date.now();
}

// ---- 기록 → 현금 잔액 연동 (입출금·매수·매도·환전·배당) --------------------------
const CURS = ['KRW', 'USD'];
const roundCur = (v, cur) => cur === 'USD' ? Math.round(v * 100) / 100 : Math.round(v);
const sortedCash = state => [...(state.cashLog || [])].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const isAutoCash = e => !!e.auto && e.autoAt === e.updatedAt;
const linkDeltas = x => x && x.cur ? { [x.cur]: x.delta } : { ...(x || {}) };

// 저장 전에 무엇이 바뀔지 (화면 미리보기·저장 공용). 바꾸지 않으면 { skip: 'none' | 'later', ... }
export function planCash(state, date, d) {
  const log = sortedCash(state);
  if (!log.length) return { skip: 'none' };
  const last = log[log.length - 1];
  if (last.date > date) return { skip: 'later', laterDate: last.date };
  const before = { KRW: last.KRW || 0, USD: last.USD || 0 };
  const after = { ...before }, delta = { KRW: 0, USD: 0 }, short = {};
  for (const c of CURS) {
    const want = roundCur(before[c] + (Number(d?.[c]) || 0), c);
    if (want < 0) short[c] = -want;
    after[c] = Math.max(0, want);
    delta[c] = roundCur(after[c] - before[c], c);
  }
  return { date, before, after, delta, short, basisDate: last.date };
}

export function applyCash(state, id, date, d) {
  const plan = planCash(state, date, d);
  if (plan.skip) return plan;
  if (!plan.delta.KRW && !plan.delta.USD) return { ...plan, skip: 'zero' };
  const now = Date.now();
  state.cashLog = state.cashLog || [];
  let e = state.cashLog.find(x => x.date === plan.date);   // 있으면 곧 가장 최근 줄이다
  const created = !e;
  if (created) {
    e = { id: cashId(plan.date), date: plan.date, KRW: plan.after.KRW, USD: plan.after.USD, createdAt: now };
    state.cashLog.push(e);
    delete state.deleted?.[e.id];
  } else {
    e.KRW = plan.after.KRW; e.USD = plan.after.USD;
  }
  const prev = isAutoCash(e) ? e.auto : { created, moves: {} };
  const kept = {};
  for (const c of CURS) if (plan.delta[c]) kept[c] = plan.delta[c];
  e.auto = { created: prev.created, moves: { ...prev.moves, [id]: kept } };
  e.updatedAt = now; e.autoAt = now;
  state.cashLog.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return plan;
}

// 이 기록이 잔액에 반영돼 있고, 그 뒤 손대지 않았으면 { date, d } (지우기·고치기 전 확인용)
export function cashLinkOf(state, id) {
  const e = sortedCash(state).find(x => isAutoCash(x) && x.auto.moves?.[id]);
  return e ? { date: e.date, d: linkDeltas(e.auto.moves[id]) } : null;
}

// 기록을 지울 때 잔액에서 되돌린다. 그 줄 뒤에 이어서 자동으로 만든 잔액 줄에도
export function revertCash(state, id) {
  const log = sortedCash(state);
  const i = log.findIndex(x => isAutoCash(x) && x.auto.moves?.[id]);
  if (i < 0) return null;
  const d = linkDeltas(log[i].auto.moves[id]);
  const now = Date.now();
  for (let j = i; j < log.length; j++) {
    const e = log[j];
    if (j > i && !isAutoCash(e)) break;
    for (const c of CURS) if (d[c]) e[c] = Math.max(0, roundCur((e[c] || 0) - d[c], c));
    if (j === i) {
      const moves = { ...e.auto.moves }; delete moves[id];
      e.auto = { ...e.auto, moves };
    }
    e.updatedAt = now; e.autoAt = now;
  }
  const head = log[i];
  if (head.auto.created && !Object.keys(head.auto.moves).length) removeItem(state, 'cashLog', head.id);
  return { date: head.date, d };
}

// 입출금 전용 이름 (검사가 이 이름으로 부른다)
const moveDeltas = mv => {
  const amt = Math.max(0, Number(mv.amount) || 0);
  return { [mv.cur === 'USD' ? 'USD' : 'KRW']: mv.kind === 'out' ? -amt : amt };
};
export const planMoveCash = (state, mv) => planCash(state, mv.date, moveDeltas(mv));
export const applyMoveCash = (state, mv) => applyCash(state, mv.id, mv.date, moveDeltas(mv));
export const moveCashLink = (state, mv) => cashLinkOf(state, mv.id);
export const revertMoveCash = (state, mv) => revertCash(state, mv.id);

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const st = Object.assign(defaultState(), s);
    migrate(st);
    return st;
  } catch {
    return defaultState();
  }
}

// 구버전 데이터 이전. 대출은 "잔액 변동 스냅샷(한 계좌)" → "계좌별 독립 대출"로 바뀜.
export function migrate(state) {
  for (const l of state.loans || []) {
    if (l.startDate === undefined && l.date !== undefined) {
      l.startDate = l.date;
      l.name = l.name || l.kind || '대출';
      if (l.endDate === undefined) l.endDate = null;
      delete l.date;
      l.updatedAt = Date.now(); // 이전본이 동기화에서 옛 기록을 이기도록 갱신
    }
  }
  // 매수 기록에서 폐기된 필드(확신도·계획 보유기간) 제거
  for (const t of state.trades || []) {
    if (t.confidence !== undefined || t.planMonths !== undefined) {
      delete t.confidence; delete t.planMonths;
      t.updatedAt = Date.now();
    }
    if (t.sample) delete t.sample; // 예시 표시도 정리
  }
  // 현금 잔액: 단일 값(manualCash) → 날짜별 입력 이력(cashLog)으로 이전.
  // 언제 넣은 값인지 알 수 없으므로 오늘 입력한 것으로 본다(그 전 구간은 현금 0 = 주식만 합산).
  if (state.settings.manualCash) {
    const mc = state.settings.manualCash;
    if (!(state.settings.cashLog || []).length && (mc.KRW != null || mc.USD != null)) {
      state.settings.cashLog = [{ date: todayStr(), KRW: mc.KRW || 0, USD: mc.USD || 0 }];
    }
    delete state.settings.manualCash;
    state.settings.updatedAt = Date.now();
  }

  // cashLog를 settings 밖으로 — settings는 통째로 동기화돼 두 기기에서 현금을 입력하면
  state.cashLog = state.cashLog || [];
  const legacyCash = state.settings.cashLog;
  if (Array.isArray(legacyCash) && legacyCash.length) {
    const now = Date.now();
    for (const e of legacyCash) {
      const cur = state.cashLog.find(x => x.date === e.date);
      if (cur) {
        // 같은 날짜가 양쪽에 있으면 옛 값을 덮지 않는다 — 새 형식 쪽이 더 최근이다
        continue;
      }
      state.cashLog.push({ id: cashId(e.date), date: e.date, KRW: e.KRW || 0, USD: e.USD || 0, createdAt: now, updatedAt: now });
    }
    state.cashLog.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    delete state.settings.cashLog;
    state.settings.updatedAt = now;
    save(state);   // 옛 위치를 지우기 전에 반드시 영속화 (PIN 이전과 같은 이유)
  } else if (legacyCash !== undefined) {
    delete state.settings.cashLog;
    save(state);
  }
  // 현금 입력을 날짜당 한 줄로 정리하고 id를 날짜에서 다시 뽑는다.
  {
    const byDate = new Map();
    for (const e of state.cashLog) {
      const cur = byDate.get(e.date);
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byDate.set(e.date, e);
    }
    const keep = [...byDate.values()];
    const survivors = new Set(keep.map(e => e.id));
    let touched = keep.length !== state.cashLog.length;
    state.deleted = state.deleted || {};
    for (const e of state.cashLog) {
      if (!survivors.has(e.id)) { state.deleted[e.id] = Date.now(); touched = true; }
    }
    for (const e of keep) {
      const want = cashId(e.date);
      if (e.id !== want) {
        if (e.id) state.deleted[e.id] = Date.now();   // 옛 id는 묻어 둔다
        e.id = want; e.updatedAt = Date.now(); touched = true;
      }
      e.createdAt = e.createdAt || Date.now();
      e.updatedAt = e.updatedAt || Date.now();
    }
    keep.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    state.cashLog = keep;
    if (touched) save(state);
  }

  // 앱을 열 때 시세 갱신을 요청하던 로직이 쓰던 키 — 그 기능이 없어졌으니 정리
  try { localStorage.removeItem('onefund.lastPriceTrigger'); } catch { /* 무시 */ }

  // 기기별로 저장하던 PIN을 동기화되는 settings로 이전
  try {
    const legacyPin = localStorage.getItem('onefund.pinHash');
    if (legacyPin) {
      if (!state.settings.pinHash) {
        state.settings.pinHash = legacyPin;
        state.settings.updatedAt = Date.now();
      }
      save(state);                              // 옛 키를 지우기 전에 반드시 영속화
      localStorage.removeItem('onefund.pinHash');
    }
  } catch { /* localStorage 접근 불가 무시 */ }
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// 내보내기(백업 파일)에서는 비밀값을 뺀다.
const SECRET_KEYS = ['ghPat', 'pinHash'];

export function exportJson(state) {
  const settings = { ...state.settings };
  for (const k of SECRET_KEYS) delete settings[k];
  return JSON.stringify({ ...state, settings }, null, 2);
}

// 가져오기: 병합이 아니라 통째 교체(단순함 우선). 호출부에서 확인창 필수.
export function importJson(text, current = null) {
  const s = JSON.parse(text);
  if (!s || !Array.isArray(s.trades)) throw new Error('형식이 다릅니다');
  const next = Object.assign(defaultState(), s);
  next.settings = { ...next.settings };
  for (const k of SECRET_KEYS) {
    if (next.settings[k] == null && current?.settings?.[k] != null) next.settings[k] = current.settings[k];
  }
  return next;
}

