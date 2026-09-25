import { useSyncExternalStore } from 'react';

// ── Lichess account connection (OAuth2 PKCE, no backend) ─────────────────────
// The Lichess opening explorer only answers authenticated requests. A static
// site (GitHub Pages) can't hide a secret, so we use Lichess' public-client
// PKCE flow — the same "Login with Lichess" that other static chess tools use:
// the user approves LaionChess on lichess.org, we get a personal access token
// (no scopes — read-only public data) and call the explorer straight from the
// browser with `Authorization: Bearer …`. The token lives only in this
// browser's localStorage. A token can also be pasted manually.

const LICHESS = 'https://lichess.org';
const CLIENT_ID = 'laionchess';
const TOKEN_KEY = 'laionchess-lichess-token';
const PKCE_KEY = 'laionchess-lichess-pkce';
/** The app keeps its current view here so the OAuth round-trip lands back on it. */
export const VIEW_KEY = 'laionchess-current-view';

export interface LichessAuth {
  token: string | null;
  username: string | null;
  /** Set when the last login / request failed, so the UI can say why. */
  error: string | null;
}

let state: LichessAuth = loadInitial();
const listeners = new Set<() => void>();

function loadInitial(): LichessAuth {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: string; username?: string };
      if (parsed.token) return { token: parsed.token, username: parsed.username ?? null, error: null };
    }
  } catch { /* ignore */ }
  return { token: null, username: null, error: null };
}

function emit(next: Partial<LichessAuth>) {
  state = { ...state, ...next };
  try {
    if (state.token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: state.token, username: state.username }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  listeners.forEach(l => l());
}

export function getLichessToken(): string | null {
  return state.token;
}

export function useLichessAuth(): LichessAuth {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state,
  );
}

function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

function base64Url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** Send the user to lichess.org to approve LaionChess (returns here with ?code=…). */
export async function startLichessLogin(returnTo?: string): Promise<void> {
  if (!window.crypto?.subtle) {
    emit({ error: 'This browser can’t do a secure login here (needs HTTPS). Paste a token instead.' });
    return;
  }
  const verifier = randomString(48);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const stateParam = randomString(16);
  try {
    const back = returnTo ?? sessionStorage.getItem(VIEW_KEY);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state: stateParam, returnTo: back }));
  } catch { /* ignore */ }
  const url = new URL(`${LICHESS}/oauth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', stateParam);
  window.location.assign(url.toString());
}

async function fetchUsername(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { username?: string };
    return j.username ?? null;
  } catch {
    return null;
  }
}

/**
 * Finish the OAuth redirect if the URL carries ?code=…&state=…. Safe to call on
 * every page load. Resolves to the `returnTo` value saved before the redirect.
 */
export async function completeLichessLogin(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returned = params.get('state');
  const oauthError = params.get('error');
  if (!code && !oauthError) return null;

  // Strip the OAuth params from the address bar whatever happens next.
  const clean = new URL(window.location.href);
  ['code', 'state', 'error', 'error_description'].forEach(k => clean.searchParams.delete(k));
  window.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);

  let saved: { verifier: string; state: string; returnTo: string | null } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null');
    sessionStorage.removeItem(PKCE_KEY);
  } catch { /* ignore */ }

  if (oauthError) { emit({ error: 'Lichess login was cancelled.' }); return saved?.returnTo ?? null; }
  if (!saved || saved.state !== returned || !code) {
    emit({ error: 'Lichess login expired — please try again.' });
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: saved.verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    });
    const res = await fetch(`${LICHESS}/api/token`, { method: 'POST', body });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const j = (await res.json()) as { access_token?: string };
    if (!j.access_token) throw new Error('no token');
    emit({ token: j.access_token, username: null, error: null });
    const username = await fetchUsername(j.access_token);
    if (username) emit({ username });
  } catch {
    emit({ error: 'Could not finish the Lichess login — please try again.' });
  }
  return saved.returnTo;
}

/** Use a personal token created at lichess.org/account/oauth/token (no scopes needed). */
export async function setManualLichessToken(token: string): Promise<boolean> {
  const t = token.trim();
  if (!t) return false;
  const username = await fetchUsername(t);
  if (!username) { emit({ error: 'Lichess rejected that token.' }); return false; }
  emit({ token: t, username, error: null });
  return true;
}

export function logoutLichess(): void {
  const t = state.token;
  emit({ token: null, username: null, error: null });
  // Revoke server-side too (best effort).
  if (t) fetch(`${LICHESS}/api/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
}

/** Called by the explorer client when Lichess answers 401 for our token. */
export function markLichessTokenInvalid(): void {
  if (!state.token) return;
  emit({ token: null, username: null, error: 'Your Lichess session expired — connect again for live data.' });
}

export function clearLichessError(): void {
  if (state.error) emit({ error: null });
}
