
import { readSheetData, writeSheetData, clearSheetData } from './googleSheetService';
import { AppConfig, ProgramConfig, PROGRAM_IDS } from '../types';

const STORAGE_KEYS = {
  APP_CONFIG: 'licenseflow_config_v4',
};

const DEFAULT_CONFIG: AppConfig = {
  clientEmail: 'license-admin@license-manager-485501.iam.gserviceaccount.com', 
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----', 
  programs: [
    { id: 'ezimpo-program', programId: PROGRAM_IDS.EZIMPO, name: 'EzImpo 관리', sheetId: '1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ', productName: 'EzImpo', gasUrl: '', securityToken: 'EzImpo_Secure_Handshake_Token_v3_X9Z' },
    { id: 'ezprintwork-program', programId: PROGRAM_IDS.EZPRINTWORK, name: 'EzPrintWork 관리', sheetId: '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0', productName: 'EzPrintWork', gasUrl: '', securityToken: 'EzImpo_Secure_Handshake_Token_v3_X9Z' }
  ],
  currentProgramId: 'ezimpo-program', emailJsServiceId: '', emailJsTemplateId: '', emailJsPublicKey: '', downloadLink: 'https://naver.me/Fm3SGglJ', enableContactSync: false, googleSubjectEmail: 'asmail774580@gmail.com'
};

export const getAppConfig = (): AppConfig => { 
  const cfg = localStorage.getItem(STORAGE_KEYS.APP_CONFIG); 
  if (cfg) { 
    try { 
      const s = JSON.parse(cfg); 
      const m = { ...DEFAULT_CONFIG, ...s };
      // 만약 EzPrintWork의 sheetId가 EzImpo의 sheetId와 같은 기본값으로 복제되어 있다면 올바른 기본값으로 패치해줍니다.
      m.programs = m.programs.map(p => {
        if (p.programId === PROGRAM_IDS.EZPRINTWORK && (p.sheetId === '1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ' || !p.sheetId)) {
          return { ...p, sheetId: '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0' };
        }
        return p;
      });
      return m;
    } catch (e) {} 
  } 
  return DEFAULT_CONFIG; 
};

export const saveAppConfig = (config: AppConfig) => localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(config));

export const getCurrentProgram = (programId?: PROGRAM_IDS): ProgramConfig | undefined => { 
  const c = getAppConfig(); 
  if (programId) return c.programs.find(p => p.programId === programId); 
  return c.programs.find(p => p.id === c.currentProgramId) || c.programs[0]; 
};

export const cleanSheetId = (input: string): string => { 
  if (!input) return ''; 
  const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/); 
  return (m && m[1]) ? m[1] : input.trim(); 
};

export const parseKoreanDate = (dateStr: any): string => {
    if (!dateStr) return '';
    try {
        const str = String(dateStr).trim();
        if (!str || str === '-') return '';
        if (str.includes('T') && str.includes('Z')) return str;
        const d_direct = new Date(str);
        if (!isNaN(d_direct.getTime())) return d_direct.toISOString();
        let clean = str.replace(/\./g, '-').replace('오전', 'AM').replace('오후', 'PM');
        const d_clean = new Date(clean);
        if (!isNaN(d_clean.getTime())) return d_clean.toISOString();
        return str;
    } catch { return String(dateStr || ''); }
};

export const formatDateForSheet = (date: any): string => {
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch (e) { return ''; }
};


export const retry = async <T>(fn: () => Promise<T>, r = 3, d = 2000): Promise<T> => { 
  try { return await fn(); } catch (e) { if (r > 0) { await new Promise(res => setTimeout(res, d)); return retry(fn, r - 1, d * 1.5); } throw e; } 
};

/**
 * [NEW] Call Google Apps Script WebApp URL for program-specific actions
 */
export const callGAS = async (programId: PROGRAM_IDS, action: string, data: any): Promise<any> => {
  const p = getCurrentProgram(programId);
  if (!p || !p.gasUrl) {
    console.warn(`No GAS URL found for program: ${programId}`);
    return null;
  }

  try {
    const response = await fetch(p.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action,
        token: p.securityToken || '',
        ...data
      })
    });
    
    if (!response.ok) throw new Error(`GAS Error: ${response.statusText}`);
    return await response.json();
  } catch (err) {
    console.error(`Failed to call GAS (${action}):`, err);
    throw err;
  }
};

