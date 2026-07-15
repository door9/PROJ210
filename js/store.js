// 상태 저장/불러오기 (localStorage) + 예시 데이터
import { uid, todayStr, addMonthsStr } from './util.js';

const KEY = 'onefund.v1';

export const EMOTIONS = ['확신', '차분', '설렘', '조급(놓칠까 봐)', '불안', '지루함', '복구 심리'];
export const SELL_REASON_TYPES = ['계획대로', '생각이 바뀌어서', '불안·공포', '더 좋은 곳에 쓰려고', '현금이 필요해서', '기타'];

export function defaultState() {
  return {
    version: 1,
    // settings는 통째로 동기화됨 — 바꿀 때 반드시 updatedAt 갱신
    settings: { fundName: 'PROJ210', inception: null, ghRepo: '', ghPat: '', updatedAt: 0 },
    trades: [],      // 매매 기록
    diary: [],       // 홀딩 일지
    principles: [],  // 투자 헌법
    letters: [],     // 주주 서한
    quotes: [],      // 글귀 서랍 (책·자료에서 모은 문장)
    watchlist: [],   // 관심 종목 (안 산 판단의 기록)
    swaps: [],       // 교체 시뮬레이션 (보유 A → 관심 B 가정)
    loans: [],       // 투자용 대출(마이너스통장 등) 잔액 스냅샷 — 이자 비용 추적
    deleted: {},     // tombstone: {id: 삭제시각} — 동기화 시 부활 방지
    pendingSymbols: [], // 시세 파일이 아직 없는 심볼 (기기 로컬, 동기화 안 함)
  };
}

// 삭제는 반드시 이 함수로 — tombstone을 남겨 다른 기기에서 부활하지 않게 한다
export function removeItem(state, coll, id) {
  state[coll] = state[coll].filter(x => x.id !== id);
  state.deleted = state.deleted || {};
  state.deleted[id] = Date.now();
}

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
// 옛 기록은 각각 별개 계좌로 보고 date를 시작일(startDate)로, 상환일(endDate)은 비움(보유 중).
function migrate(state) {
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
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

// 가져오기: 병합이 아니라 통째 교체(단순함 우선). 호출부에서 확인창 필수.
export function importJson(text) {
  const s = JSON.parse(text);
  if (!s || !Array.isArray(s.trades)) throw new Error('형식이 다릅니다');
  return Object.assign(defaultState(), s);
}

