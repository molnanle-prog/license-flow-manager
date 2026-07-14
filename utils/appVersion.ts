/** LicenseFlow Manager (이 프로그램) */
export const APP_VERSION = '1.3.0';

/**
 * EzPrintWork fallback — 네트워크 실패 시에만 사용.
 * 실제 표시는 fetchEzPrintWorkLiveVersion() → version.json 우선.
 */
export const EZPRINTWORK_VERSION = '1.7.2';

export const EZPRINTWORK_VERSION_URL = 'https://ez-hub.kr/ezpw/version.json';

let cachedLiveVersion: string | null = null;
let liveVersionInflight: Promise<string> | null = null;

const normalizeVersion = (v: unknown): string =>
  String(v || '').trim().replace(/^v/i, '');

/** 라이브 배포 버전 (version.json). 실패 시 하드코딩 fallback. */
export async function fetchEzPrintWorkLiveVersion(force = false): Promise<string> {
  if (!force && cachedLiveVersion) return cachedLiveVersion;
  if (!force && liveVersionInflight) return liveVersionInflight;

  liveVersionInflight = (async () => {
    try {
      const url = `${EZPRINTWORK_VERSION_URL}?t=${Date.now()}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as { version?: string };
      const ver = normalizeVersion(json?.version);
      if (ver) {
        cachedLiveVersion = ver;
        return ver;
      }
    } catch (e) {
      console.warn('[appVersion] version.json fetch failed:', e);
    }
    return cachedLiveVersion || EZPRINTWORK_VERSION;
  })();

  try {
    return await liveVersionInflight;
  } finally {
    liveVersionInflight = null;
  }
}

export function getCachedEzPrintWorkVersion(): string {
  return cachedLiveVersion || EZPRINTWORK_VERSION;
}
