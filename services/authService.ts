import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { auth } from '../firebase';

const ADMIN_EMAIL = 'molnanle@gmail.com';
const CREDS_STORAGE_KEY = 'lfm_firebase_creds_v1';

type PyWebViewApi = {
  open_browser_login?: () => Promise<boolean> | boolean;
};

export const isDesktopShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { pywebview?: { api?: PyWebViewApi } };
  if (w.pywebview?.api?.open_browser_login) return true;
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

export const completeRedirectLogin = async () => {
  try {
    return await getRedirectResult(auth);
  } catch (error) {
    console.error('[Auth] redirect result failed:', error);
    return null;
  }
};

const waitForPyWebViewApi = async (timeoutMs = 8000): Promise<PyWebViewApi | null> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const api = (window as Window & { pywebview?: { api?: PyWebViewApi } }).pywebview?.api;
    if (api?.open_browser_login) return api;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

export const openDesktopBrowserLogin = async (): Promise<boolean> => {
  const api = await waitForPyWebViewApi();
  if (api?.open_browser_login) {
    await Promise.resolve(api.open_browser_login());
    return true;
  }
  throw new CredentialRequiredError('REINSTALL_REQUIRED');
};

export const waitForAuthHandoff = async (timeoutMs = 120000): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch('/__auth/handoff');
      if (res.ok) {
        const data = await res.json();
        if (data?.idToken) {
          const credential = GoogleAuthProvider.credential(
            data.idToken,
            data.accessToken || undefined
          );
          await signInWithCredential(auth, credential);
          await fetch('/__auth/handoff', { method: 'DELETE' }).catch(() => undefined);
          await auth.authStateReady();
          return true;
        }
      }
    } catch (error) {
      console.warn('[Auth] handoff poll failed:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};

export const signInWithGoogleDesktop = async (): Promise<void> => {
  await openDesktopBrowserLogin();
  const ok = await waitForAuthHandoff();
  if (!ok) {
    throw new CredentialRequiredError(
      'Browser Google login timed out.\nComplete login with molnanle@gmail.com in Chrome/Edge, then save again.'
    );
  }
  if (!auth.currentUser) {
    throw new CredentialRequiredError('Google login was not completed.');
  }
};

export const signInWithGoogle = async (): Promise<'popup' | 'redirect' | 'browser'> => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: ADMIN_EMAIL, prompt: 'select_account' });

  if (isDesktopShell()) {
    await signInWithGoogleDesktop();
    return 'browser';
  }

  try {
    await signInWithPopup(auth, provider);
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

  const email = auth.currentUser?.email?.toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase()) return;
  if (auth.currentUser) return;

  const creds = await loadManagerCredentials();
  if (creds) {
    try {
      await signInWithEmailAndPassword(auth, creds.email, creds.password);
      return;
    } catch (error: unknown) {
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
};

export const ensureAuth = async (): Promise<void> => {
  try {
    await completeRedirectLogin();
    await auth.authStateReady();
    await ensureFullAuth(false);
  } catch {
    /* silent on startup */
  }
};