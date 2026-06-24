/** EzPrintWork contact/version resolution for LicenseFlow Manager */

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
  companyPhone?: string | null
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
  const fromTenant = String(
    tenant?.appVersion
    || tenant?.clientVersion
    || tenant?.lastAppVersion
    || tenant?.ezprintVersion
    || (tenant?.stats as Record<string, unknown> | undefined)?.appVersion
    || ''
  ).trim();
  if (fromTenant) return fromTenant.replace(/^v/i, '');
  const fromLicense = String(licenseVersion || '').trim();
  if (fromLicense) return fromLicense.replace(/^v/i, '');
  return '';
};
