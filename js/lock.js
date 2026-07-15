// 앱 잠금(PIN). 기기별 저장(localStorage, 동기화 안 함). SHA-256 해시만 저장.
// 주의: 데이터는 브라우저 localStorage에 있으므로 기기에 접근 가능한 사람으로부터 완벽히
// 막아주지는 못한다(기기 잠금 화면 수준의 가벼운 보호). UI 접근을 가리는 용도.
const K = 'onefund.pinHash';
const SALT = 'proj210.pin.v1';

async function sha(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const hasPin = () => !!localStorage.getItem(K);
export async function setPin(pin) { localStorage.setItem(K, await sha(pin)); }
export async function verify(pin) { return !!pin && localStorage.getItem(K) === await sha(pin); }
export function clearPin() { localStorage.removeItem(K); }

// 앱 시작 시 호출. PIN이 맞을 때까지 화면을 가리고 대기.
export function showLock() {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="lock-back">
        <div class="lock-box">
          <div class="lock-logo">🔒</div>
          <div class="lock-title">PROJ210</div>
          <div class="lock-sub">PIN 번호를 입력하세요</div>
          <input id="lock-pin" class="lock-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12">
          <div id="lock-err" class="lock-err"></div>
          <button id="lock-ok" class="btn primary" style="width:100%;">확인</button>
        </div>
      </div>`;
    const input = root.querySelector('#lock-pin');
    const err = root.querySelector('#lock-err');
    setTimeout(() => input.focus(), 50);
    const submit = async () => {
      if (await verify(input.value)) { root.innerHTML = ''; resolve(); }
      else { err.textContent = 'PIN이 맞지 않습니다'; input.value = ''; input.focus(); }
    };
    root.querySelector('#lock-ok').onclick = submit;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });
}
