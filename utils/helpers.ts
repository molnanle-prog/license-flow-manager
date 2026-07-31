
/**
 * 유틸리티 도움말 함수
 */

/**
 * 랜덤 시리얼 키 생성
 * EzImpo: EZIM-XXXX-XXXX-XXXX
 * EzPrintWork: EZPW-XXXX-XXXX-XXXX
 */
export const generateSerialKey = (prefix: string = 'EZIM'): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  return `${prefix}-${part()}-${part()}-${part()}`;
};

/**
 * 연락처 입력 포맷팅 (01012345678 -> 010-1234-5678)
 */
export const formatContactInput = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

/**
 * 이메일 형식 검사
 */
export const isEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};
