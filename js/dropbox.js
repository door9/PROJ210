// Dropbox 연동 — memo-app과 같은 Dropbox 앱을 재사용, 파일은 /one-fund/ 아래.
// 같은 도메인(door9.github.io)에서는 memo-app 로그인 토큰을 빌려 쓸 수 있어
// 이미 memo-app에 로그인된 기기라면 별도 로그인 없이 바로 동기화된다.
const CLIENT_ID = '0kfnwj8hluxzpun';
const CLIENT_SECRET = 'x9tu1nql7ul9lqd';
const FILE = '/one-fund/data.json';
const REDIRECT_URI = location.origin + location.pathname;

const K_TOKEN = 'onefund.dbx_token';
const K_REFRESH = 'onefund.dbx_refresh';

let accessToken = localStorage.getItem(K_TOKEN) || localStorage.getItem('dbx_token') || null;
let refreshToken = localStorage.getItem(K_REFRESH) || localStorage.getItem('dbx_refresh') || null;

export const connected = () => !!accessToken;

// ---- OAuth (PKCE) ----
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login() {
  const stateStr = crypto.randomUUID();
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const verifier = b64url(arr);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  sessionStorage.setItem('onefund.oauth_state', stateStr);
  sessionStorage.setItem('onefund.code_verifier', verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: 'files.content.read files.content.write files.metadata.read files.metadata.write',
    state: stateStr,
  });
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + params;
}

// 앱 시작 시 호출: OAuth 복귀(?code=)면 토큰 교환
export async function handleCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code || q.get('state') !== sessionStorage.getItem('onefund.oauth_state')) return false;
  const verifier = sessionStorage.getItem('onefund.code_verifier');
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, grant_type: 'authorization_code',
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, code_verifier: verifier,
    }),
  });
  sessionStorage.removeItem('onefund.oauth_state');
  sessionStorage.removeItem('onefund.code_verifier');
  history.replaceState(null, '', location.pathname + location.hash);
  if (!res.ok) return false;
  const d = await res.json();
  accessToken = d.access_token;
  if (d.refresh_token) refreshToken = d.refresh_token;
  localStorage.setItem(K_TOKEN, accessToken);
  if (refreshToken) localStorage.setItem(K_REFRESH, refreshToken);
  return true;
}

async function refresh() {
  if (!refreshToken) return false;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) return false;
  const d = await res.json();
  accessToken = d.access_token;
  localStorage.setItem(K_TOKEN, accessToken);
  return true;
}

export function logout() {
  accessToken = null; refreshToken = null;
  localStorage.removeItem(K_TOKEN);
  localStorage.removeItem(K_REFRESH);
  // memo-app의 토큰(dbx_token)은 건드리지 않는다
}

// ---- 파일 업로드/다운로드 (401 → 토큰 갱신, 409/429 → 재시도) ----
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function upload(content, retried = false, attempt = 0) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: FILE, mode: 'overwrite', mute: true }),
    },
    body: content,
  });
  if (res.status === 401) {
    if (!retried && await refresh()) return upload(content, true, attempt);
    throw new Error('auth');
  }
  if ((res.status === 429 || res.status === 409) && attempt < 3) {
    await sleep(500 * Math.pow(2, attempt));
    return upload(content, retried, attempt + 1);
  }
  if (!res.ok) throw new Error('upload ' + res.status);
  return res.json();
}

export async function download(retried = false, attempt = 0) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Dropbox-API-Arg': JSON.stringify({ path: FILE }),
    },
  });
  if (res.status === 404 || res.status === 409) return null; // 아직 파일 없음
  if (res.status === 401) {
    if (!retried && await refresh()) return download(true, attempt);
    throw new Error('auth');
  }
  if (res.status === 429 && attempt < 3) {
    await sleep(500 * Math.pow(2, attempt));
    return download(retried, attempt + 1);
  }
  if (!res.ok) throw new Error('download ' + res.status);
  return res.text();
}
