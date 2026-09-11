// 검사는 **절대 실제 앱 데이터를 건드리면 안 된다.**
// store.js의 migrate/save는 localStorage에 직접 쓴다. 처음엔 그걸 모르고 시험에서 migrate를
// 불렀다가 앱 상태(onefund.v1)를 지어낸 장부로 덮어썼다 — 사용자가 이 페이지를 열기만 해도
// 기록이 날아갈 뻔했다. 그래서 시험이 도는 동안 localStorage를 메모리 흉내로 바꿔 끼운다.
export function isolateStorage() {
  const mem = new Map();
  const shim = {
    getItem: k => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)); },
    removeItem: k => { mem.delete(String(k)); },
    clear: () => mem.clear(),
    key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
    return localStorage === shim;
  } catch {
    return false;
  }
}

// 아주 작은 테스트 러너. 빌드 도구가 없는 프로젝트라 브라우저에서 그대로 돈다.
// (이 환경엔 node가 없어 `node --test`를 쓸 수 없고, 어차피 앱이 도는 곳과 같은
//  런타임에서 검증하는 편이 더 정직하다.)
const cases = [];
export const test = (name, fn) => cases.push({ name, fn });

let cur = null;
function fail(msg) { cur.errors.push(msg); }

export const eq = (got, want, what = '') => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fail(`${what || '값'}: ${g} ≠ ${w}`);
};
// 돈 계산은 부동소수라 완전히 같기를 요구하면 안 된다. 기본 허용오차 0.01(원·센트 단위).
export const near = (got, want, tol = 0.01, what = '') => {
  if (!(Math.abs(got - want) <= tol)) fail(`${what || '값'}: ${got} ≉ ${want} (허용 ${tol})`);
};
export const ok = (cond, what = '') => { if (!cond) fail(what || '참이어야 한다'); };

export async function runAll(out) {
  let pass = 0, fail_ = 0;
  for (const c of cases) {
    cur = { errors: [] };
    try { await c.fn(); } catch (e) { cur.errors.push('예외: ' + (e && e.message || e)); }
    const li = document.createElement('li');
    if (cur.errors.length) {
      fail_++;
      li.className = 'bad';
      li.innerHTML = `<b>✕ ${c.name}</b><ul>${cur.errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
    } else {
      pass++;
      li.className = 'good';
      li.textContent = `✓ ${c.name}`;
    }
    out.appendChild(li);
  }
  return { pass, fail: fail_, total: cases.length };
}
