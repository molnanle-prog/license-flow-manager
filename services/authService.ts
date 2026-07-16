import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { auth } from '../firebase';

const ADMIN_EMAIL = 'molnanle@gmail.com';
const CREDS_STORAGE_KEY = 'lfm_firebase_creds_v1';

/** Firestore users 목록 읽기에 필요한 슈퍼관리자 (email + verified) */
export const isManagerSuperAdminUser = (
  user: { email?: string | null; emailVerified?: boolean } | null = auth.currentUser
): boolean => {
  if (!user?.email) return false;
  return (
    user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
    user.emailVerified === true
  );
};

export type ManagerAuthDiag = {
  loggedIn: boolean;
  email: string | null;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  uid: string | null;
};

export const getManagerAuthDiag = (): ManagerAuthDiag => {
  const u = auth.currentUser;
  return {
    loggedIn: !!u,
    email: u?.email ?? null,
    emailVerified: u?.emailVerified === true,
    isSuperAdmin: isManagerSuperAdminUser(u),
    uid: u?.uid ?? null,
  };
};

type PyWebViewApi = {
  open_browser_login?: () => Promise<boolean> | boolean;
  close_login_window?: () => Promise<boolean> | boolean;
};

export const isDesktopShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  const port = window.location.port;
  return port === '55771' || port === '55772';
};

export const getDesktopFallbackUser = () => ({
  uid: 'desktop-admin',
  email: ADMIN_EMAIL,
  displayName: 'Administrator',
  emailVerified: true,
});

export type ManagerCredentials = { email: string; password: string };

export class CredentialRequiredError extends Error {
  constructor(message = 'Firebase login required.') {
    super(message);
    this.name = 'CredentialRequiredError';
  }
}

export const saveManagerCredentials = (creds: ManagerCredentials): void => {
  try {
    localStorage.setItem(CREDS_STORAGE_KEY, JSON.stringify(creds));
  } catch (e) {
    console.warn('[Auth] failed to persist credentials:', e);
  }
};

export const clearManagerCredentials = (): void => {
  try {
    localStorage.removeItem(CREDS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const readStoredCredentials = (): ManagerCredentials | null => {
  try {
    const raw = localStorage.getItem(CREDS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const email = String(data?.email || ADMIN_EMAIL).trim();
    const password = String(data?.password || '');
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
};

export const loadManagerCredentials = async (): Promise<ManagerCredentials | null> => {
  const stored = readStoredCredentials();
  if (stored) return stored;

  try {
    const res = await fetch('/manager-secrets.json');
    if (!res.ok) return null;
    const data = await res.json();
    const email = String(data?.email || ADMIN_EMAIL).trim();
    const password = String(data?.password || '');
    if (!email || !password || password === 'YOUR_PASSWORD_HERE') return null;
    const creds = { email, password };
    saveManagerCredentials(creds);
    return creds;
  } catch {
    return null;
  }
};

export const loadDesktopCredentialsFresh = async (): Promise<ManagerCredentials | null> => {
  try {
    const res = await fetch(`/manager-secrets.json?t=${Date.now()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const email = String(data?.email || ADMIN_EMAIL).trim();
    const password = String(data?.password || '');
    if (!email || !password || password === 'YOUR_PASSWORD_HERE') return null;
    const creds = { email, password };
    saveManagerCredentials(creds);
    return creds;
  } catch {
    return readStoredCredentials();
  }
};

export const hasDesktopPlaceholderSecrets = async (): Promise<boolean> => {
  try {
    const res = await fetch(`/manager-secrets.json?t=${Date.now()}`);
    if (!res.ok) return true;
    const data = await res.json();
    const password = String(data?.password || '');
    return !password || password === 'YOUR_PASSWORD_HERE';
  } catch {
    return true;
  }
};

const mapFirebaseAuthError = (code: string, serverMessage?: string): string => {
  if (serverMessage?.includes('TOO_MANY_ATTEMPTS')) {
    return '로그인 시도가 너무 많아 Firebase가 일시 차단했습니다. 30분 후 다시 시도해 주세요.';
  }
  if (code.includes('too-many-requests')) {
    return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (code.includes('invalid-credential') || code.includes('wrong-password')) {
    return '비밀번호가 맞지 않습니다. 다른 PC의 manager-secrets.json 과 동일한지 확인해 주세요.';
  }
  if (code.includes('user-not-found')) {
    return 'Firebase에 등록되지 않은 이메일입니다.';
  }
  if (code.includes('operation-not-allowed')) {
    return 'Firebase 콘솔에서 이메일/비밀번호 로그인 방식을 활성화해 주세요.';
  }
  if (serverMessage && serverMessage !== 'Firebase 로그인 실패') {
    return serverMessage;
  }
  return 'Firebase 자동 로그인에 실패했습니다.';
};

let lastDesktopLoginDiagAt = 0;
let lastDesktopLoginDiagMsg: string | null = null;

const diagnoseDesktopLogin = async (): Promise<string | null> => {
  const now = Date.now();
  if (lastDesktopLoginDiagMsg && now - lastDesktopLoginDiagAt < 60000) {
    return lastDesktopLoginDiagMsg;
  }
  try {
    const res = await fetch('/__auth/desktop-login', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data?.ok) {
      lastDesktopLoginDiagMsg = null;
      return null;
    }
    const msg = String(data?.message || data?.error || 'Firebase 로그인 실패');
    lastDesktopLoginDiagMsg = msg;
    lastDesktopLoginDiagAt = now;
    return msg;
  } catch {
    return null;
  }
};

export const completeRedirectLogin = async () => {
  try {
    return await getRedirectResult(auth);
  } catch (error) {
    console.error('[Auth] redirect result failed:', error);
    return null;
  }
};

export const tryCompleteGoogleRedirect = async (): Promise<boolean> => {
  const result = await completeRedirectLogin();
  return !!result?.user;
};

/** @deprecated 1.1.0 호환 — ensureAuth 사용 권장 */
export const bootDesktopAuth = async (): Promise<boolean> => {
  await auth.authStateReady();
  if (auth.currentUser) return true;
  await completeRedirectLogin();
  if (auth.currentUser) return true;
  if (await tryRestoreLoginSession()) return true;
  return false;
};

const AUTH_HANDOFF_STORAGE_KEY = 'lfm_auth_handoff';
const AUTH_ERROR_STORAGE_KEY = 'lfm_auth_last_error';

export const getLastAuthError = (): string | null => {
  try {
    return sessionStorage.getItem(AUTH_ERROR_STORAGE_KEY);
  } catch {
    return null;
  }
};

const clearLastAuthError = (): void => {
  try {
    sessionStorage.removeItem(AUTH_ERROR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const setLastAuthError = (message: string): void => {
  try {
    sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, message);
  } catch {
    /* ignore */
  }
};

const signInWithHandoffTokens = async (
  idToken: string | null | undefined,
  accessToken?: string | null
): Promise<void> => {
  if (!idToken && !accessToken) {
    throw new Error('Google 인증 토큰이 없습니다.');
  }
  const credential = GoogleAuthProvider.credential(
    idToken || null,
    accessToken || undefined
  );
  await signInWithCredential(auth, credential);
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('Firebase 세션을 만들지 못했습니다.');
  }
};

export const tryRestoreLoginSession = async (): Promise<boolean> => {
  await auth.authStateReady();
  if (auth.currentUser) {
    clearLastAuthError();
    return true;
  }

  try {
    const raw = sessionStorage.getItem(AUTH_HANDOFF_STORAGE_KEY);
    if (raw) {
      sessionStorage.removeItem(AUTH_HANDOFF_STORAGE_KEY);
      const data = JSON.parse(raw);
      if (data?.idToken || data?.accessToken) {
        await signInWithHandoffTokens(data.idToken, data.accessToken);
        clearLastAuthError();
        return true;
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('[Auth] sessionStorage handoff failed:', error);
    setLastAuthError(`Google 로그인 후 Firebase 연결 실패: ${msg}`);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ok = await consumeAuthHandoff();
    if (ok) {
      clearLastAuthError();
      return true;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return !!auth.currentUser;
};

export const openDesktopInAppLogin = (): void => {
  // pywebview WebView 안 signInWithRedirect는 Google 결과를 못 받음 → 시스템 브라우저 + handoff
  sessionStorage.removeItem('lfm_redirect_started');
  try {
    const api = (window as Window & { pywebview?: { api?: PyWebViewApi } }).pywebview?.api;
    if (api?.open_browser_login) {
      void Promise.resolve(api.open_browser_login());
      return;
    }
  } catch {
    /* fall through */
  }
  // pywebview API 없을 때(개발 브라우저 등): 같은 포트에서 desktop 로그인 페이지 열기
  const port = window.location.port || '55771';
  window.open(
    `http://localhost:${port}/login-helper.html?from=desktop`,
    'lfm-google-login',
    'width=480,height=720'
  );
};

/** @deprecated openDesktopInAppLogin 과 동일 (외부 브라우저 handoff) */
export const openDesktopBrowserLogin = async (): Promise<boolean> => {
  openDesktopInAppLogin();
  return true;
};

export const signInWithGoogleDesktop = async (): Promise<void> => {
  openDesktopInAppLogin();
};

export const signInWithGoogle = async (): Promise<'popup' | 'redirect' | 'browser'> => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: ADMIN_EMAIL, prompt: 'select_account' });

  if (isDesktopShell()) {
    openDesktopInAppLogin();
    return 'redirect';
  }

  clearLastAuthError();
  sessionStorage.removeItem('lfm_redirect_started');
  await auth.authStateReady();

  try {
    await signInWithPopup(auth, provider);
    clearLastAuthError();
    return 'popup';
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
      await signInWithRedirect(auth, provider);
      return 'redirect';
    }
    throw error;
  }
};

/** @deprecated signInWithGoogle 사용 */
export const signInWithGoogleInApp = signInWithGoogle;

const closeDesktopLoginWindow = async (): Promise<void> => {
  try {
    const api = (window as Window & { pywebview?: { api?: PyWebViewApi } }).pywebview?.api;
    if (api?.close_login_window) {
      await Promise.resolve(api.close_login_window());
    }
  } catch {
    /* ignore */
  }
};

export const consumeAuthHandoff = async (): Promise<boolean> => {
  try {
    const res = await fetch('/__auth/handoff');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.idToken && !data?.accessToken) return false;

    await signInWithHandoffTokens(data.idToken, data.accessToken);
    await fetch('/__auth/handoff', { method: 'DELETE' }).catch(() => undefined);
    await closeDesktopLoginWindow();
    return !!auth.currentUser;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('[Auth] handoff consume failed:', error);
    setLastAuthError(`Google 로그인 후 Firebase 연결 실패: ${msg}`);
    return false;
  }
};

export const waitForAuthHandoff = async (timeoutMs = 120000): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await consumeAuthHandoff();
    if (ok) {
      clearLastAuthError();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

const promptPasswordCredentials = (): ManagerCredentials | null => {
  const pwd = window.prompt(
    `Email/password login\nAccount: ${ADMIN_EMAIL}\n\n(Google-only accounts have no password. Cancel and use Google login.)`
  );
  if (!pwd?.trim()) return null;
  const creds = { email: ADMIN_EMAIL, password: pwd.trim() };
  saveManagerCredentials(creds);
  return creds;
};

const promptInteractiveLogin = async (): Promise<void> => {
  if (isDesktopShell()) {
    await signInWithGoogle();
    return;
  }

  const useGoogle = window.confirm(
    `Firebase login is required to save EzPrintWork data.\n\n` +
    `[OK] Google login (${ADMIN_EMAIL})\n` +
    `[Cancel] Email/password login (only if password was set)`
  );

  if (useGoogle) {
    await signInWithGoogle();
    return;
  }

  const creds = promptPasswordCredentials();
  if (!creds) throw new CredentialRequiredError('Login cancelled.');
  await signInWithEmailAndPassword(auth, creds.email, creds.password);
};

export const ensureFullAuth = async (allowPrompt = false): Promise<void> => {
  await auth.authStateReady();

  // 슈퍼관리자만 통과 — 다른 계정 세션은 users 전체 list에 permission-denied → 시트 폴백 유발
  if (isManagerSuperAdminUser()) return;

  if (auth.currentUser && !isManagerSuperAdminUser()) {
    console.warn(
      '[Auth] Session is not super-admin (email/verified). Re-authenticating for Manager...',
      getManagerAuthDiag()
    );
    try {
      await signOut(auth);
    } catch {
      /* continue */
    }
  }

  const creds = await loadManagerCredentials();
  if (creds) {
    try {
      await signInWithEmailAndPassword(auth, creds.email, creds.password);
      if (isManagerSuperAdminUser()) return;
      console.warn(
        '[Auth] Credentials signed in but not verified super-admin:',
        getManagerAuthDiag()
      );
      if (!allowPrompt) {
        throw new CredentialRequiredError(
          '관리자 계정(email_verified)이 필요합니다. Google 로그인으로 molnanle@gmail.com 을 사용해 주세요.'
        );
      }
    } catch (error: unknown) {
      if (error instanceof CredentialRequiredError) throw error;
      clearManagerCredentials();
      const code = (error as { code?: string })?.code || '';
      if (!allowPrompt) {
        if (code.includes('invalid-credential') || code.includes('wrong-password')) {
          throw new CredentialRequiredError(
            'Saved password is incorrect. Use Google login for Google-only accounts.'
          );
        }
        throw new CredentialRequiredError();
      }
    }
  }

  if (!allowPrompt) {
    throw new CredentialRequiredError();
  }

  await promptInteractiveLogin();
  if (!isManagerSuperAdminUser()) {
    throw new CredentialRequiredError(
      'Firebase 로그인 후 molnanle@gmail.com(인증된 계정)인지 확인해 주세요.'
    );
  }
};

export const ensureAuth = async (): Promise<void> => {
  try {
    await completeRedirectLogin();
    await auth.authStateReady();
    if (isManagerSuperAdminUser()) return;
    // 비관리자/미인증 세션만 있으면 클리어 후 슈퍼관리자 재인증 시도
    if (auth.currentUser && !isManagerSuperAdminUser()) {
      await ensureFullAuth(false);
      return;
    }
    if (await tryRestoreLoginSession()) {
      if (isManagerSuperAdminUser()) return;
    }
    await ensureFullAuth(false);
  } catch {
    /* silent on startup — 저장된 Google 세션이 있으면 자동 연결 */
  }
};