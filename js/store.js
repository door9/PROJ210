// 상태 저장/불러오기 (localStorage) + 예시 데이터
import { uid, todayStr, addMonthsStr } from './util.js';

const KEY = 'onefund.v1';

export const EMOTIONS = ['확신', '차분', '설렘', '조급(놓칠까 봐)', '불안', '지루함', '복구 심리'];
export const SELL_REASON_TYPES = ['계획대로', '생각이 바뀌어서', '불안·공포', '더 좋은 곳에 쓰려고', '현금이 필요해서', '기타'];

export function defaultState() {
  return {
    version: 1,
    // settings는 통째로 동기화됨 — 바꿀 때 반드시 updatedAt 갱신
    settings: { fundName: '1인 펀드', inception: null, ghRepo: '', ghPat: '', updatedAt: 0 },
    trades: [],      // 매매 기록
    diary: [],       // 홀딩 일지
    principles: [],  // 투자 헌법
    letters: [],     // 주주 서한
    quotes: [],      // 글귀 서랍 (책·자료에서 모은 문장)
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
    return Object.assign(defaultState(), s);
  } catch {
    return defaultState();
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

// ---- 예시 데이터 ----------------------------------------------------------
// 기능을 구경할 수 있도록 넣는 가상의 매매. 전부 sample:true 표시가 붙고
// "예시 지우기"는 이 표시가 있는 항목만 지운다(사용자 데이터 비파괴).

export function sampleData() {
  const t = (o) => Object.assign({ id: uid(), fee: 0, sample: true, createdAt: Date.now(), updatedAt: Date.now() }, o);
  const trades = [
    t({ side: 'buy', symbol: '005930.KS', name: '삼성전자', date: '2024-11-18', price: 56000, qty: 50,
        reason: '반도체 업황 바닥 판단. HBM 경쟁력 회복 기대. PBR 1.0 이하로 역사적 저평가 구간.',
        confidence: 70, planMonths: 24, sellPlan: 'PBR 1.6 이상 도달하거나, HBM 점유율 회복 스토리가 깨지면 매도.',
        emotions: ['차분', '확신'] }),
    t({ side: 'buy', symbol: '000660.KS', name: 'SK하이닉스', date: '2025-01-20', price: 219000, qty: 10,
        reason: 'AI 메모리 수요가 구조적이라고 판단. 삼성전자보다 HBM에서 앞서 있음.',
        confidence: 80, planMonths: 36, sellPlan: 'AI 투자 사이클이 꺾이는 뚜렷한 신호(빅테크 캐펙스 감소)가 나오면.',
        emotions: ['확신', '설렘'] }),
    t({ side: 'buy', symbol: 'AAPL', name: 'Apple', date: '2025-03-10', price: 227, qty: 15,
        reason: '조정으로 내려온 김에 매수. 서비스 매출 성장 지속.',
        confidence: 60, planMonths: 12, sellPlan: '뚜렷한 기준 없음.',
        emotions: ['조급(놓칠까 봐)'] }),
    t({ side: 'sell', symbol: 'AAPL', name: 'Apple', date: '2025-08-05', price: 220, qty: 15,
        reason: '몇 달째 지지부진하고 다른 종목이 더 좋아 보여서 정리.',
        sellReasonType: '불안·공포', emotions: ['지루함'] }),
    t({ side: 'buy', symbol: 'NVDA', name: 'NVIDIA', date: '2025-08-06', price: 180, qty: 20,
        reason: 'AAPL 판 돈으로 매수. AI 인프라 사이클의 중심. 실적 성장 대비 밸류에이션 부담은 있음.',
        confidence: 65, planMonths: 24, sellPlan: '데이터센터 매출 성장률이 두 분기 연속 꺾이면.',
        emotions: ['설렘', '조급(놓칠까 봐)'] }),
    t({ side: 'buy', symbol: '005930.KS', name: '삼성전자', date: '2025-04-07', price: 53200, qty: 30,
        reason: '관세 쇼크 급락. 평단 아래라 물타기. 원래 논리는 그대로라고 판단.',
        confidence: 65, planMonths: 24, sellPlan: '기존과 동일.',
        emotions: ['불안'] }),
    t({ side: 'sell', symbol: '005930.KS', name: '삼성전자', date: '2026-02-16', price: 143000, qty: 40,
        reason: '단기간 급등으로 목표 밸류에이션 부근 도달. 절반 이상 이익 실현.',
        sellReasonType: '계획대로', emotions: ['차분'] }),
  ];
  const d = (o) => Object.assign({ id: uid(), sample: true, createdAt: Date.now(), updatedAt: Date.now() }, o);
  const diary = [
    d({ symbol: '000660.KS', date: '2025-04-08', urge: 'sell', note: '관세 쇼크로 -20% 가까이 밀림. 다 팔고 도망가고 싶다.' }),
    d({ symbol: 'NVDA', date: '2025-11-20', urge: 'sell', note: 'AI 버블 기사가 쏟아진다. 불안하다.' }),
    d({ symbol: '005930.KS', date: '2025-06-10', urge: 'buy', note: '더 사고 싶지만 이미 비중이 크다.' }),
  ];
  const principles = [
    d({ kind: 'max_weight', param: 30, text: '한 종목 비중은 30%를 넘기지 않는다', active: true }),
    d({ kind: 'min_hold_days', param: 180, text: '산 지 180일 안에는 팔지 않는다', active: true }),
    d({ kind: 'no_avg_down', param: null, text: '물타기를 하지 않는다', active: true }),
    d({ kind: 'manual', param: null, text: '매수 전, 이 회사가 10년 뒤에도 존재할 이유를 한 문장으로 쓸 수 있어야 한다', active: true }),
  ];
  const quotes = [
    d({ text: '가격은 당신이 지불하는 것이고, 가치는 당신이 얻는 것이다.', source: '워런 버핏' }),
    d({ text: '주식시장은 인내심 없는 사람의 돈을 인내심 있는 사람에게 옮기는 장치다.', source: '워런 버핏' }),
  ];
  const letters = [
    { id: uid(), sample: true, period: '2026-Q1', createdAt: Date.now(), updatedAt: Date.now(),
      body: '주주(=나)에게.\n\n이번 분기 삼성전자를 절반 넘게 팔았다. 계획했던 밸류에이션에 도달했기 때문이라고 썼지만, 솔직히는 급등이 무서웠던 것도 있다. 남긴 40주는 계획대로 2026년 말까지 끌고 간다.\n\nSK하이닉스는 4월 폭락 때 팔고 싶었지만 참았다. 참은 것이 이번 분기 가장 잘한 일이다.\n\n다음 분기에는 새 종목을 늘리기보다 지금 가진 것을 공부하는 데 시간을 쓰겠다.' },
  ];
  return { trades, diary, principles, letters, quotes };
}

const SAMPLE_COLLS = ['trades', 'diary', 'principles', 'letters', 'quotes'];

export function addSample(state) {
  const s = sampleData();
  for (const k of SAMPLE_COLLS) {
    state[k] = state[k] || [];
    state[k].push(...s[k]);
  }
}

export function removeSample(state) {
  for (const k of SAMPLE_COLLS) {
    for (const x of (state[k] || []).filter(x => x.sample)) removeItem(state, k, x.id);
  }
}

export function hasSample(state) {
  return SAMPLE_COLLS.some(k => (state[k] || []).some(x => x.sample));
}
