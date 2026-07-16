/** EzPrintWork contact/version resolution for LicenseFlow Manager */

import type { AppUser, License, Tenant } from '../types';

/** B2B 사내 직원 로그인 계정 (@ez-hub.kr) — 회사 대표 라이선스 행과 분리 */
export const isStaffInternalLoginEmail = (email?: string | null): boolean => {
  const v = String(email || '').trim().toLowerCase();
  return v.endsWith('@ez-hub.kr');
};

/** tenants.ownerId 기준 실제 대표자 users 문서 */
export const resolveTenantOwnerUser = (
  tenant: Pick<Tenant, 'id' | 'ownerId'>,
  users: AppUser[]
): AppUser | undefined => {
  if (tenant.ownerId) {
    const byOwnerId = users.find((u) => u.uid === tenant.ownerId);
    if (byOwnerId) return byOwnerId;
  }
  return users.find(
    (u) =>
      u.tenantId === tenant.id &&
      u.role === 'admin' &&
      !isStaffInternalLoginEmail(u.email)
  );
};

/** users 문서가 회사 대표(ADMIN 라이선스) 행으로 표시되어야 하는지 */
/** 구글 시트에 없고 Firebase에만 남은 테넌트(유령)인지 판별 */
export const isGhostWebTenant = (
  tenant: Tenant,
  users: AppUser[],
  licenses: License[]
): boolean => {
  const sheetAdmins = licenses.filter((l) => l.role === 'ADMIN');
  const activeAdminEmails = new Set(
    sheetAdmins
      .map((l) => (l.adminEmail || l.email || '').trim().toLowerCase())
      .filter((e) => e.includes('@'))
  );
  const activeJoinCodes = new Set(
    sheetAdmins
      .map((l) => String(l.joinCode || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const tenantJoinCode = String((tenant as { joinCode?: string }).joinCode || '').trim().toLowerCase();
  if (tenantJoinCode && activeJoinCodes.has(tenantJoinCode)) return false;

  const ownerUser = resolveTenantOwnerUser(tenant, users);
  const ownerEmail = String(ownerUser?.email || '').trim().toLowerCase();
  if (!ownerEmail.includes('@')) return false;
  if (isStaffInternalLoginEmail(ownerEmail)) return false;

  return !activeAdminEmails.has(ownerEmail);
};

export const isTenantRepresentativeAdminUser = (
  user: Pick<AppUser, 'uid' | 'email' | 'role'>,
  tenants: Array<Pick<Tenant, 'ownerId'>>
): boolean => {
  if (tenants.some((t) => t.ownerId === user.uid)) return true;
  if (isStaffInternalLoginEmail(user.email)) return false;
  return user.role === 'admin';
};

export const isValidMobilePhone = (num?: string | null): boolean => {
  if (!num) return false;
  const clean = String(num).replace(/[^0-9]/g, '');
  return /^(010|011|016|017|018|019)\d{7,8}$/.test(clean);
};

const firstValidMobile = (...candidates: Array<string | null | undefined>): string => {
  for (const raw of candidates) {
    const v = String(raw || '').trim();
    if (v && isValidMobilePhone(v)) return v;
  }
  return '';
};

/** Admin contact: signup phone -> personal info -> company info */
export const resolveAdminContactInfo = (
  user: Record<string, unknown> | null | undefined,
  staffDoc: Record<string, unknown> | null | undefined,
  companyPhone?: string | null,
  tenantDoc?: Record<string, unknown> | null
): string => {
  return firstValidMobile(
    user?.contactInfo as string | undefined,
    user?.phone as string | undefined,
    user?.contact as string | undefined,
    staffDoc?.phone as string | undefined,
    staffDoc?.phoneCompany as string | undefined,
    staffDoc?.phoneOffice as string | undefined,
    staffDoc?.contactInfo as string | undefined,
    staffDoc?.contact as string | undefined,
    tenantDoc?.ownerPhone as string | undefined,
    tenantDoc?.contactPhone as string | undefined,
    companyPhone
  );
};

/** Staff contact: personal -> company mobile -> office */
export const resolveStaffContactInfo = (
  staffDoc: Record<string, unknown> | null | undefined,
  companyPhone?: string | null
): string => {
  return firstValidMobile(
    staffDoc?.phone as string | undefined,
    staffDoc?.contactInfo as string | undefined,
    staffDoc?.phoneCompany as string | undefined,
    staffDoc?.phoneOffice as string | undefined,
    companyPhone
  );
};

/** EzPrintWork client version from tenant or license */
export const resolveTenantAppVersion = (
  tenant: Record<string, unknown> | null | undefined,
  licenseVersion?: string | null
): string => {
  const normalize = (v: unknown) => String(v || '').trim().replace(/^v/i, '');
  const candidates = [
    tenant?.lastAppVersion,
    tenant?.appVersion,
    tenant?.clientVersion,
    tenant?.ezprintVersion,
    (tenant?.stats as Record<string, unknown> | undefined)?.appVersion,
    licenseVersion,
  ]
    .map(normalize)
    .filter(Boolean);

  if (candidates.length === 0) return '';

  // semver 비교로 가장 높은(최신) 값 선택
  const score = (ver: string): number[] =>
    ver.split(/[^0-9]+/).filter(Boolean).map((n) => parseInt(n, 10) || 0);

  return candidates.reduce((best, cur) => {
    const a = score(cur);
    const b = score(best);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av > bv) return cur;
      if (av < bv) return best;
    }
    return best;
  });
};
