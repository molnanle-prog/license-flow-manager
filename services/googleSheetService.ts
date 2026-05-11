
import * as jose from 'jose';

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/contacts'
];

const fetchWithTimeout = async (url: string, options: any = {}, timeout = 30000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. (Timeout)');
    }
    throw error;
  }
};

export const getAccessToken = async (clientEmail: string, privateKey: string, subjectEmail?: string): Promise<string> => {
  try {
    const alg = 'RS256';
    if (!privateKey || privateKey.length < 50) throw new Error("Private Key가 너무 짧거나 비어있습니다.");
    let cleanKey = privateKey.replace(/\\n/g, '\n').trim();
    if ((cleanKey.startsWith('"') && cleanKey.endsWith('"')) || (cleanKey.startsWith("'") && cleanKey.endsWith("'"))) {
       cleanKey = cleanKey.slice(1, -1);
    }
    const pemHeaderRegex = /-----BEGIN [A-Z ]+-----/;
    const pemFooterRegex = /-----END [A-Z ]+-----/;
    const headerMatch = cleanKey.match(pemHeaderRegex);
    const footerMatch = cleanKey.match(pemFooterRegex);
    let body = cleanKey;
    if (headerMatch && footerMatch) {
        const headerIdx = headerMatch.index! + headerMatch[0].length;
        const footerIdx = footerMatch.index!;
        if (footerIdx > headerIdx) body = cleanKey.substring(headerIdx, footerIdx);
    } else {
        body = body.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '');
    }
    body = body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (body.length % 4 !== 0) body += '=';
    try { if (typeof window !== 'undefined' && window.atob) window.atob(body); } catch (e) {
        throw new Error("Private Key가 손상되었습니다. (Base64 인코딩 오류).");
    }
    const finalPem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
    const pk = await jose.importPKCS8(finalPem, alg);
    const iat = Math.floor(Date.now() / 1000) - 30;
    const jwtBuilder = new jose.SignJWT({ scope: SCOPES.join(' ') })
      .setProtectedHeader({ alg })
      .setIssuer(clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(iat)
      .setExpirationTime('1h');
    if (subjectEmail && subjectEmail.includes('@')) jwtBuilder.setSubject(subjectEmail);
    else jwtBuilder.setSubject(clientEmail);
    const jwt = await jwtBuilder.sign(pk);
    const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
  } catch (error: any) {
    throw new Error('인증 토큰 생성 실패: ' + error.message);
  }
};

export const testConnection = async (sheetId: string, clientEmail: string, privateKey: string): Promise<{ success: boolean; message: string; title?: string }> => {
  try {
    if (!sheetId || !clientEmail || !privateKey) return { success: false, message: '설정 값이 부족합니다.' };
    const token = await getAccessToken(clientEmail, privateKey);
    const response = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (response.ok) return { success: true, message: '연결 성공!', title: data.properties?.title };
    return { success: false, message: data.error?.message || '접근 실패' };
  } catch (error: any) { return { success: false, message: '오류: ' + error.message }; }
};

export const initializeSheetTabs = async (sheetId: string, clientEmail: string, privateKey: string) => {
  const token = await getAccessToken(clientEmail, privateKey);
  const metaRes = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!metaRes.ok) throw new Error(`시트 정보 조회 실패`);
  const metaData = await metaRes.json();
  const existingTitles = metaData.sheets?.map((s: any) => s.properties.title) || [];

  const requiredTabs = ['Products', 'Customers', 'Licenses', 'Orders', 'Order', 'InstallLogs'];
  const addRequests = [];

  for (const tab of requiredTabs) {
    if (!existingTitles.includes(tab)) {
      addRequests.push({ addSheet: { properties: { title: tab } } });
    }
  }

  if (addRequests.length > 0) {
    await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: addRequests })
    });
  }

  // [STRICT] InstallLogs 탭의 헤더를 강제 초기화하여 사용자가 지정한 순서를 보장합니다.
  const installLogsHeaders = [['Timestamp', 'CompanyName', 'UserName', 'Contact', 'MachineID', 'ActionType', 'Result', 'IP', 'Version', 'ProductName']];
  const checkLogsRes = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/InstallLogs!A1:J1`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const logsData = await checkLogsRes.json();
  
  // 헤더가 다르거나 비어있다면 다시 씁니다.
  if (!logsData.values || logsData.values.length === 0 || logsData.values[0][0] !== 'Timestamp' || logsData.values[0][3] !== 'Contact') {
    await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/InstallLogs!A1:J1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: installLogsHeaders })
    });
  }
};

export const readSheetData = async (sheetId: string, range: string, clientEmail: string, privateKey: string): Promise<any[]> => {
  const token = await getAccessToken(clientEmail, privateKey);
  const response = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorData = await response.json();
      errorDetail = errorData.error?.message || JSON.stringify(errorData);
    } catch (e) {
      errorDetail = response.statusText;
    }
    throw new Error(`구글시트 읽기 오류 (${response.status}): ${errorDetail}`);
  }
  const data = await response.json();
  return data.values || [];
};

export const clearSheetData = async (sheetId: string, range: string, clientEmail: string, privateKey: string) => {
  const token = await getAccessToken(clientEmail, privateKey);
  await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const writeSheetData = async (sheetId: string, range: string, values: any[][], clientEmail: string, privateKey: string) => {
  const token = await getAccessToken(clientEmail, privateKey);
  await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
};
