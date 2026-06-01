import { getAppConfig } from './baseStorageService';
import { SmsLog } from '../types';
import { getSmsLogsFromSheet, saveSmsLogToSheet, getLicenses } from './storageService';

// Fallback local storage key for logs in case Firestore is unreachable
const LOCAL_SMS_LOGS_KEY = 'sms_chat_history_logs';

// HMAC-SHA256 Signature Generator using Web Crypto API for zero-dependency secure browser requests
async function getSolapiSignature(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await window.crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Saves SMS log to Google Sheet.
 */
export const saveSmsLog = async (
  tenantId: string | null, 
  log: Omit<SmsLog, 'id' | 'timestamp'> & { licenseId?: string }
): Promise<void> => {
  const cleanTo = log.contact.replace(/\D/g, "");
  const newLog = {
    contact: cleanTo,
    licenseId: log.licenseId || '',
    content: log.content,
    direction: log.direction,
    status: log.status,
    timestamp: new Date().toISOString()
  };

  try {
    // 1. 구글 시트에 직접 기록 및 동기화!
    await saveSmsLogToSheet(newLog);
    console.log('[smsService] Successfully logged SMS to Google Sheet.');

    // 2. 발송 성공 시 로컬 스토리지 SMS_HISTORY_V1 실시간 업데이트로 화면 연동 보장
    if (log.licenseId && log.direction === 'OUTBOUND' && log.status === 'SUCCESS') {
      try {
        const SMS_HISTORY_KEY = 'SMS_HISTORY_V1';
        const saved = localStorage.getItem(SMS_HISTORY_KEY);
        const history = saved ? JSON.parse(saved) : {};
        history[log.licenseId] = Date.now();
        localStorage.setItem(SMS_HISTORY_KEY, JSON.stringify(history));
        console.log(`[smsService] Updated SMS_HISTORY_V1 in localStorage for ${log.licenseId}`);
      } catch (e) {
        console.error('[smsService] Failed to update local SMS history in saveSmsLog:', e);
      }
    }
  } catch (err) {
    console.error('[smsService] Failed to write SMS log to Google Sheet:', err);
  }
};

/**
 * Loads SMS logs for a specific contact or licenseId from Google Sheet.
 */
export const getSmsLogs = async (
  tenantId: string | null, 
  contact: string, 
  licenseId?: string
): Promise<SmsLog[]> => {
  const cleanContact = contact.replace(/\D/g, "");
  
  try {
    // 1. 구글 시트에서 전체 문자 로그 로딩
    const allLogs = await getSmsLogsFromSheet(true);
    
    // 2. 라이선스 ID가 있다면 라이선스 정보 조회 (스마트 이름 매칭용)
    let userName = "";
    if (licenseId) {
      const lics = await getLicenses(false);
      const targetLic = lics.find(l => l.id === licenseId);
      if (targetLic && targetLic.userName) {
        userName = targetLic.userName.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
      }
    }
    
    // 3. 해당 수신번호(contact) 또는 라이선스 ID가 매칭되는 문자들만 정밀 필터링
    const filtered = allLogs.filter(log => {
      const cleanLogContact = log.contact.replace(/\D/g, "");
      
      // 번호 매칭
      const matchContact = cleanLogContact === cleanContact && cleanContact !== "";
      
      // 라이선스 ID 매칭
      const matchLicense = licenseId && log.licenseId === licenseId;
      
      // 스마트 이름 매칭 (구글 시트에 '허현/부장'처럼 한글 이름으로 기록된 경우)
      let matchName = false;
      if (cleanLogContact === "" && userName !== "") {
        const normalizedLogName = log.contact.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
        if (normalizedLogName !== "") {
          matchName = normalizedLogName.includes(userName) || userName.includes(normalizedLogName);
        }
      }
      
      return matchContact || matchLicense || matchName;
    });

    // 4. 시간 순서대로 정렬 (올림차순 - 대화 타임라인용)
    return filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  } catch (err) {
    console.error('[smsService] Failed to load SMS logs from Google Sheet:', err);
    return [];
  }
};

/**
 * Sends SMS/LMS message to target recipient via Solapi REST API v4.
 */
export const sendSmsViaSolapi = async (
  to: string, 
  text: string,
  licenseId?: string,
  tenantId?: string | null
): Promise<{ success: boolean; message: string }> => {
  const config = getAppConfig();
  
  const apiKey = config.solapiApiKey;
  const apiSecret = config.solapiApiSecret;
  const senderNumber = config.solapiSenderNumber;

  if (!apiKey || !apiSecret || !senderNumber) {
    return { 
      success: false, 
      message: '환경설정에서 솔라피 API Key, API Secret Key, 발신번호를 모두 입력해 주세요.' 
    };
  }

  // Clean numbers (remove hyphens, spaces, keeping only digits)
  const cleanTo = to.replace(/\D/g, "");
  const cleanFrom = senderNumber.replace(/\D/g, "");

  if (!cleanTo) {
    return { success: false, message: '수신인 연락처가 유효하지 않습니다.' };
  }

  const date = new Date().toISOString();
  // Generate random 32-character hexadecimal salt
  const salt = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const signature = await getSolapiSignature(apiSecret, date + salt);

  try {
    const response = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
      },
      body: JSON.stringify({
        messages: [
          {
            to: cleanTo,
            from: cleanFrom,
            text: text
          }
        ]
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.errorMessage || `HTTP Error ${response.status}`);
    }

    if (result.failedMessageCount > 0) {
      const errorMsg = result.failedList?.[0]?.errorMessage || '발송 실패';
      throw new Error(errorMsg);
    }

    // Direct blocking write to logs for outbound message
    await saveSmsLog(tenantId || null, {
      contact: cleanTo,
      licenseId,
      content: text,
      direction: 'OUTBOUND',
      status: 'SUCCESS'
    });

    return { success: true, message: '문자가 성공적으로 전송되었습니다!' };
  } catch (err: any) {
    console.error('Solapi SMS sending failed:', err);
    
    // Save failed attempt
    await saveSmsLog(tenantId || null, {
      contact: cleanTo,
      licenseId,
      content: text,
      direction: 'OUTBOUND',
      status: 'FAIL'
    });

    return { success: false, message: `문자 발송 실패: ${err.message}` };
  }
};

/**
 * 솔라피 API로부터 해당 연락처(contact)에서 우리 발신번호로 들어온 실제 수신 문자 목록을 조회하여,
 * 우리 DB에 실시간으로 없는 항목만 골라 동기화(저장)합니다.
 */
export const syncInboundSmsLogs = async (
  tenantId: string | null,
  contact: string,
  licenseId: string
): Promise<void> => {
  const config = getAppConfig();
  
  const apiKey = config.solapiApiKey;
  const apiSecret = config.solapiApiSecret;
  const senderNumber = config.solapiSenderNumber;

  if (!apiKey || !apiSecret || !senderNumber) return;

  const cleanContact = contact.replace(/\D/g, "");
  const cleanSender = senderNumber.replace(/\D/g, "");

  if (!cleanContact || !cleanSender) return;

  const date = new Date().toISOString();
  const salt = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const signature = await getSolapiSignature(apiSecret, date + salt);

  try {
    // to: 우리 발신번호, from: 고객 연락처 (고객이 보낸 문자 조회)
    const url = `https://api.solapi.com/messages/v4/list?to=${cleanSender}&from=${cleanContact}&limit=50`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
      }
    });

    if (!response.ok) {
      console.warn('[smsService] Failed to fetch inbound messages from Solapi');
      return;
    }

    const result = await response.json();
    const solapiLogs = result.messageList || [];

    if (solapiLogs.length === 0) return;

    // 현재 우리 Firestore/LocalStorage DB에 기록된 SMS 로그 목록 조회
    const localLogs = await getSmsLogs(tenantId, contact, licenseId);

    for (const solMsg of solapiLogs) {
      const text = solMsg.text || '';
      // 솔라피에서 반환하는 메시지 생성일 (dateCreated)
      const dateCreated = solMsg.dateCreated;

      const isAlreadyExists = localLogs.some(log => {
        return log.direction === 'INBOUND' && 
               log.content === text &&
               Math.abs(new Date(log.timestamp).getTime() - new Date(dateCreated).getTime()) < 10000; // 10초 오차 허용
      });

      if (!isAlreadyExists) {
        // 아직 우리 DB에 등록되지 않은 진짜 상대방의 실제 답장이므로 DB에 수동 동기화!
        await saveSmsLog(tenantId, {
          contact: cleanContact,
          licenseId: licenseId,
          content: text,
          direction: 'INBOUND',
          status: 'SUCCESS'
        });
        console.log(`[smsService] Successfully synced real inbound SMS: "${text.substring(0, 15)}..."`);
      }
    }
  } catch (err) {
    console.error('[smsService] Error during syncInboundSmsLogs:', err);
  }
};
