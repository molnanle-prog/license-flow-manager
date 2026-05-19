
import { License, Product, Installation, PROGRAM_IDS, DebugLog } from '../types';

/**
 * 디버그 로그에서 사용자 정보를 추출합니다.
 */
export const extractInfoFromDebugLog = (log: DebugLog) => {
    try {
        const raw = log.rawData || '';
        const cleanRaw = raw.trim().replace(/^['"]|['"]$/g, '');
        const data = JSON.parse(cleanRaw);
        const info = data.userInfo || data;
        
        return {
            name: info.userName || info.name || '',
            company: info.company || '',
            contact: info.contactInfo || info.contact || info.phone || info.tel || '',
            product: data.progName || data.productName || log.action || '',
            version: data.version || info.version || data.progVer || log.version || '',
            key: data.key || info.key || ''
        };
    } catch (e) {
        let fallbackVer = log.version || '';
        if (typeof fallbackVer === 'string' && (fallbackVer.includes('ERROR') || fallbackVer.includes('SyntaxError') || fallbackVer.length > 20)) {
            fallbackVer = '에러(확인요망)';
        }
        return {
            name: '',
            company: '',
            contact: '',
            product: '',
            version: fallbackVer,
            key: ''
        };
    }
};

/**
 * 버전 비교 함수 (v1 > v2: 1, v1 < v2: -1, v1 == v2: 0)
 */
export const compareVersions = (v1: string, v2: string): number => {
    if (!v1 || v1 === '?') return -1;
    if (!v2 || v2 === '?') return 1;
    
    // 버전 문자열에서 'v' 제거 및 공백 제거
    const cleanV1 = String(v1).toLowerCase().replace(/^v/, '').trim();
    const cleanV2 = String(v2).toLowerCase().replace(/^v/, '').trim();

    const parts1 = cleanV1.split('.').map(part => parseInt(part) || 0);
    const parts2 = cleanV2.split('.').map(part => parseInt(part) || 0);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
};

/**
 * 기기 ID 정규화 (공백, 하이픈 제거 및 소문자화)
 */
export const normalizeMachineId = (id: any): string => {
    return String(id || '').trim().replace(/[\s-]/g, '').toLowerCase();
};

/**
 * 한국어 '오전'/'오후' 및 온점 구분자가 포함된 다양한 디버그/설치 날짜 문자열을 밀리초(Ms) 숫자로 변환합니다.
 */
export const parseLogDateToMs = (dateStr: any): number => {
    if (!dateStr) return 0;
    try {
        const str = String(dateStr).trim();
        if (/^\d+$/.test(str)) return Number(str);
        
        let clean = str
            .replace(/\./g, '-')
            .replace('오전', 'AM')
            .replace('오후', 'PM');
            
        clean = clean.replace(/\s+/g, ' ');
        
        if (clean.includes('AM')) {
            clean = clean.replace('AM', '').trim() + ' AM';
        } else if (clean.includes('PM')) {
            clean = clean.replace('PM', '').trim() + ' PM';
        }
        
        const d = new Date(clean);
        if (!isNaN(d.getTime())) return d.getTime();
        
        const numbers = str.match(/\d+/g);
        if (numbers && numbers.length >= 3) {
            const year = parseInt(numbers[0]) || 2026;
            const month = (parseInt(numbers[1]) || 1) - 1;
            const day = parseInt(numbers[2]) || 1;
            const hour = parseInt(numbers[3]) || 0;
            const min = parseInt(numbers[4]) || 0;
            const sec = parseInt(numbers[5]) || 0;
            return new Date(year, month, day, hour, min, sec).getTime();
        }
    } catch (e) {}
    return 0;
};

export interface VersionInfo {
    status: 'LATEST' | 'OUTDATED' | 'OK' | 'UNKNOWN';
    current: string;
    latest: string;
    detectedMachineId?: string; // 로그에서 발견된 최신 기기 ID
    isMachineMismatch?: boolean; // 등록된 ID와 로그의 ID가 다른지 여부
    isSuspicious?: boolean; // 의존성 버전 등으로 의심되는 경우
    isError?: boolean; // 실제 로그에 오류나 오보고 데이터가 감지되었는지 여부
    logErrorContent?: string; // 감지된 비정상 데이터 원본 내용
}

const GENERIC_MACHINE_IDS = ['test', 'development', 'unknown', 'none', '-', 'pc', 'laptop', 'desktop', 'admin', 'administrator', 'user'];

/**
 * 라이선스의 현재 버전 상태를 분석합니다.
 * @param l 분석할 라이선스
 * @param installationLogs 설치 로그 목록
 * @param products 제품 목록
 * @param allLicenses 전체 라이선스 목록 (최신 버전 감지용)
 * @param debugLogs 디버그 로그 목록 (실시간 버전 감지용)
 */
export const getLicenseVersionInfo = (
    l: License, 
    installationLogs: Installation[], 
    products: Product[], 
    allLicenses: License[],
    debugLogs: DebugLog[] = []
): VersionInfo => {
    let prod = products.find(p => p.id === l.productId);
    // [FIX] 체험판(trial-product) 등 ID로 매칭되지 않는 경우 제품명으로 재검색
    if (!prod && l.productName) {
        prod = products.find(p => p.name === l.productName);
    }
    
    // 1. 해당 제품의 최신 버전 결정
    let latestVersion = prod?.version || '0.0.0';
    
    // 시트에 등록된 다른 라이선스들 중 더 높은 버전이 있다면 그것을 최신으로 간주 (유동적 대응)
    allLicenses.forEach(lic => {
        // 제품 ID 또는 제품명이 같은 경우 비교
        if ((lic.productId === l.productId || (lic.productName && lic.productName === l.productName)) && lic.version) {
            if (compareVersions(lic.version, latestVersion) > 0) {
                latestVersion = lic.version;
            }
        }
    });

    // 2. 디버그 로그에서도 더 높은 버전이 발견되면 최신 버전 업데이트
    debugLogs.forEach(log => {
        const extracted = extractInfoFromDebugLog(log);
        if (extracted.product === l.productName || (prod && extracted.product === prod.name)) {
            if (extracted.version && compareVersions(extracted.version, latestVersion) > 0) {
                latestVersion = extracted.version;
            }
        }
    });

    // 제품 정보가 없더라도 최신 버전이 식별되었다면 진행 (UNKNOWN 최소화)
    let currentVersion = l.version || '?';
    let detectedMachineId = l.machineId || '';
    let isMachineMismatch = false;

    // [ID 전환 대응] 라이선스 키 기반 통합 로그 분석
    const mid = normalizeMachineId(l.machineId);
    const isGenericMid = mid === '' || GENERIC_MACHINE_IDS.includes(mid);

    // 1. 모든 관련 로그 통합 수집
    const allLogs = [
        ...debugLogs.map(log => ({ ...log, type: 'DEBUG' as const, ts: parseLogDateToMs(log.timestamp) })),
        ...installationLogs.map(log => ({ ...log, type: 'INSTALL' as const, ts: parseLogDateToMs(log.timestamp) }))
    ].sort((a, b) => b.ts - a.ts); // 최신순 정렬

    // 2. 가장 적합한 로그 찾기 (키 매칭 우선 -> 이름/상호명 매칭 -> 기기 ID 매칭)
    const bestLog = allLogs.find(log => {
        const norm = (s: any) => String(s || '').trim().replace(/\s/g, '');
        const normContact = (s: any) => String(s || '').trim().replace(/[^0-9]/g, '');
        
        const lName = norm(l.userName);
        const lCompany = norm(l.companyName);
        const lContact = normContact(l.contactInfo);
        const lKey = (l.key || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        
        if (log.type === 'DEBUG') {
            const ext = extractInfoFromDebugLog(log);
            const extKey = (ext.key || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const extName = norm(ext.name);
            const extCompany = norm(ext.company);
            const extContact = normContact(ext.contact || '');
            
            // 1순위: 라이선스 키가 직접 매칭되는 경우
            if (lKey && extKey === lKey) return true;
            if (lKey && log.action && log.action.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(lKey)) return true;
            
            // 2순위: 이름이 일치하면서 (회사명 or 연락처 중 하나가 일치)
            if (lName && extName === lName) {
                if (lCompany && extCompany === lCompany) return true;
                if (lContact && extContact === lContact) return true;
                // 회사명/연락처가 둘 다 라이선스 및 로그 상에 존재하지 않거나 빈값인 경우 이름만으로 매칭 보완
                if (!lCompany && !extCompany && !lContact && !extContact) return true;
            }
            
            // 3순위: 기기 ID 매칭 (기존 기기 매칭)
            if (mid && normalizeMachineId(log.machineId) === mid) return true;
        } else {
            const logName = norm(log.userName);
            const logCompany = norm(log.companyName);
            const logContact = normContact(log.contact || '');
            
            // 1순위: 이름이 일치하면서 (회사명 or 연락처 중 하나가 일치)
            if (lName && logName === lName) {
                if (lCompany && logCompany === lCompany) return true;
                if (lContact && logContact === lContact) return true;
                // 회사명/연락처가 둘 다 라이선스 및 로그 상에 존재하지 않거나 빈값인 경우 이름만으로 매칭 보완
                if (!lCompany && !logCompany && !lContact && !logContact) return true;
            }
            
            // 2순위: 기기 ID 매칭 (기존 기기 매칭)
            if (mid && normalizeMachineId(log.machineId) === mid) return true;
        }
        return false;
    });

    let isError = false;
    let logErrorContent = '';

    if (bestLog) {
        let extractedVer = '';
        if (bestLog.type === 'DEBUG') {
            const ext = extractInfoFromDebugLog(bestLog);
            extractedVer = ext.version || '';
        } else {
            extractedVer = bestLog.version || '';
        }
        
        if (extractedVer) {
            const cleanVer = extractedVer.trim();
            const upperVer = cleanVer.toUpperCase();
            
            // "OK" 텍스트 또는 비정상적인 시스템 에러/20자 초과 텍스트 감지
            const isOkText = upperVer === 'OK';
            const isSystemError = upperVer.includes('ERROR') || upperVer.includes('SYNTAXERROR') || cleanVer.length > 20 || !/\d/.test(cleanVer);
            
            if (isOkText || isSystemError) {
                isError = true;
                logErrorContent = cleanVer;
                // 비정상 데이터가 로그에 쌓였을 때는 메인 버전을 오염시키지 않고 기존 라이선스 버전을 유지합니다.
            } else {
                currentVersion = cleanVer;
            }
        }
        
        detectedMachineId = bestLog.machineId || '';
        
        // 기기 ID가 달라진 경우 (Enhanced ID 등) 감지
        if (mid && detectedMachineId && !isGenericMid && mid !== normalizeMachineId(detectedMachineId)) {
            isMachineMismatch = true;
        }
    }

    // 3.7.0 등 의심스러운 버전 체크 (dependency version accidentally reported)
    const isSuspicious = currentVersion === '3.7.0';

    const result: VersionInfo = { 
        current: currentVersion || '?', 
        latest: latestVersion, 
        detectedMachineId, 
        isMachineMismatch,
        isSuspicious,
        isError,
        logErrorContent,
        status: 'UNKNOWN'
    };
    
    if (!currentVersion || currentVersion === '?') {
        // 버전을 모르더라도 최신 버전이 존재한다면 업데이트 대상으로 간주
        result.status = (latestVersion && latestVersion !== '0.0.0') ? 'OUTDATED' : 'UNKNOWN';
        return result;
    }

    const cmp = compareVersions(currentVersion, latestVersion);
    if (cmp < 0) result.status = 'OUTDATED';
    else if (cmp === 0) result.status = 'LATEST';
    else result.status = 'OK';
    
    return result;
};

/**
 * 기기 ID를 기반으로 설치 로그에서 가장 최근 버전을 찾아줍니다.
 */
export const getLatestVersionFromLogs = (machineId: string, logs: Installation[]): string | null => {
    if (!machineId) return null;
    const mid = normalizeMachineId(machineId);
    const log = [...logs].reverse().find(l => l.machineId && normalizeMachineId(l.machineId) === mid);
    return log?.version || null;
};
