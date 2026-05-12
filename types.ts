
export interface Product {
  id: string;
  name: string;
  version: string;
  price: number; // 실제 판매 가격 (할인 적용가)
  originalPrice?: number; // 정가 (할인 전 가격)
  description: string;
}

export interface ProgramConfig {
  id: string; // Unique ID for the program config (e.g., 'ezimpo-config', 'ezprintwork-config')
  programId: PROGRAM_IDS; // [NEW] Actual program identifier (e.g., 'EZIMPO', 'EZPRINTWORK')
  name: string; // Display name for the program (e.g., 'EzImpo 관리', 'EzPrintWork 관리')
  sheetId: string; // Google Sheet ID for this specific program
  productName?: string; // New field for sheet tagging
  downloadLink?: string; // [NEW] Download link for this program
  gasUrl?: string; // [NEW] GAS WebApp URL for v3.6.6+ security
  securityToken?: string; // [NEW] Security handshake token
}

export enum PROGRAM_IDS {
  EZIMPO = 'EZIMPO',
  EZPRINTWORK = 'EZPRINTWORK',
}

export interface AppConfig {
  clientEmail: string;
  privateKey: string;
  programs: ProgramConfig[];
  currentProgramId: string;
  
  // EmailJS Settings (Client-Side Safe)
  emailJsServiceId?: string;
  emailJsTemplateId?: string;
  emailJsPublicKey?: string;
  
  // Common Download Link
  downloadLink?: string;

  // Google Contact Sync Settings
  enableContactSync?: boolean;
  googleSubjectEmail?: string; // For Domain-Wide Delegation (Target User Email)
}

export interface Customer {
  id: string;
  name: string;
  position?: string;
  email: string;
  company?: string;
  createdAt: string;
}

export enum LicenseType {
  TRIAL = 'TRIAL',
  SUBSCRIPTION = 'SUBSCRIPTION',
  LIFETIME = 'LIFETIME',
}

export enum LicenseStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export interface ActivityLog {
    id: string;
    timestamp: string;
    action: string;
    details: string;
}

export interface SmsTemplate {
    id: string;
    name: string;
    content: string;
}

export interface License {
  id: string;
  key: string;
  productId: string;
  type: LicenseType;
  status: LicenseStatus;
  
  paymentStatus?: 'PAID' | 'UNPAID' | 'FREE'; // 입금 확인 여부 (무료사용 추가)

  createdAt: string;
  expiresAt: string | null; // null for lifetime
  
  // Activation Data (Filled by Customer on First Use)
  pin?: string;          // 사용자가 설정한 PIN
  companyName?: string;  // 회사명
  userName?: string;     // 이름
  userPosition?: string; // 직책
  machineId?: string;    // 하드웨어 고유 ID
  
  lastCheckIn?: string;
  lastReset?: string;
  
  productName?: string; // Tagging for sheet
  version?: string;     // [NEW] Version column support
  requestId?: string;   // Link to the original LicenseRequest
  contactInfo?: string; // Contact from the request
  lastSmsSent?: string; // [NEW] 마지막 문자 발송 시간 추적
  email?: string;       // [NEW] 웹 버전 연동을 위한 구글 이메일
  plan?: string;        // [NEW] 라이선스 요금제 (free, lite, pro, pro_plus)
  programId?: PROGRAM_IDS; // [NEW] 프로그램 ID
}

export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED'
}

export interface Order {
  id: string;
  customerId: string;
  productId: string;
  amount: number;
  depositorName: string;
  status: OrderStatus;
  createdAt: string;
  licenseId?: string;
}

// --- New Request Types (Updated for Order sheet) ---
export enum RequestStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  REJECTED = 'REJECTED'
}

export interface LicenseRequest {
  id: string; // Internal ID (Generated locally or mapped)
  
  // Sheet Columns: 날짜, 업체명, 입금자, 연락처, 기기ID, 버전, 상태
  createdAt: string;     // Timestamp
  status: RequestStatus; // Status
  companyName: string;   // CompanyName
  name: string;          // Depositor
  contact: string;       // Contact
  machineId: string;     // MachineID
  productName: string;   // Pending Product
  version: string;       // Version
  email?: string;        // [NEW] 웹 버전 연동을 위한 구글 이메일
  plan?: string;         // [NEW] 라이선스 요금제
  programId?: PROGRAM_IDS; // [NEW] 프로그램 ID
}

export interface DashboardStats {
  totalRevenue: number;
  activeLicenses: number;
  expiringSoon: number;
  totalCustomers: number;
}

export interface Installation {
  id: string;
  timestamp: string;
  productName: string; 
  companyName?: string; // Mapped from 'CompanyName' in sheet
  userName?: string;
  contact?: string; // [NEW] Added contact field
  machineId: string;
  actionType?: string;
  result?: string;
  ip?: string;
  version?: string;
}

export interface DebugLog {
  timestamp: string;
  action: string;
  machineId: string;
  version: string;
  rawData: string;
}
