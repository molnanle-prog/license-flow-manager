
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { Product, License, LicenseType, LicenseStatus, RequestStatus, LicenseRequest, Installation, DebugLog } from '../types';
import { 
  getProducts, saveProduct, deleteProduct, deleteProducts,
  getLicenses, saveLicense, saveLicenses, deleteLicense, deleteLicenses, generateSerialKey, 
  getLicenseRequests, saveLicenseRequest, findOrCreateCustomer, getCurrentProgram, getInstallations, getAppConfig as getStorageAppConfig, saveAppConfig, getDebugLogs, getCustomers,
  repairLicenseProductIds
} from '../services/storageService';
import { compareVersions, normalizeMachineId, getLicenseVersionInfo, extractInfoFromDebugLog } from '../services/versionService';
import { PROGRAM_IDS } from '../types';
import { syncWebUserRole } from '../services/firebaseBridge';

const PLAN_DEFS = {
    free: { label: 'FREE (광고형)', price: 0, maxUsers: 1 },
    lite: { label: 'LITE (5인)', price: 5500, maxUsers: 5 },
    pro: { label: 'PRO (10인)', price: 9900, maxUsers: 10 },
    pro_plus: { label: 'PRO+ (10인+)', price: 99000, maxUsers: 999 }
};

const COLUMN_DEFS = [
  { id: 'index', label: 'No.', width: 40 },
  { id: 'key', label: 'LICENSE KEY', width: 140 },
  { id: 'pin', label: 'PIN', width: 60 },
  { id: 'companyName', label: 'COMPANY', width: 100 },
  { id: 'userName', label: 'NAME', width: 90 },
  { id: 'contactInfo', label: 'CONTACT', width: 110 },
  { id: 'machineId', label: '기기 ID', width: 180 },
  { id: 'expiresAt', label: 'EXPIRY', width: 80 },
  { id: 'status', label: 'STATUS', width: 70 },
  { id: 'paymentStatus', label: 'PAY', width: 60 },
  { id: 'lastCheckIn', label: 'CHECKED', width: 70 },
  { id: 'lastReset', label: 'RESET', width: 70 },
  { id: 'productName', label: 'PRODUCT', width: 80 },
  { id: 'version', label: '버전', width: 50 }, 
  { id: 'smsStatus', label: '발송상태', width: 80 }, 
  { id: 'actions', label: 'ACTIONS', width: 100 },
];



import EzImpoLicenseManager from './EzImpoLicenseManager';
import EzPrintWorkLicenseManager from './EzPrintWorkLicenseManager';

const LicenseManager: React.FC = () => {
  const [currentProgramId, setCurrentProgramId] = useState<PROGRAM_IDS | ''>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const config = getStorageAppConfig();
    if (config.currentProgramId) {
      const p = config.programs.find(prog => prog.id === config.currentProgramId);
      if (p) setCurrentProgramId(p.programId);
    }
    setIsLoading(false);
  }, []);

  if (isLoading) return <div className="p-10 text-center">설정 불러오는 중...</div>;

  return (
    <div className="space-y-6">
      {currentProgramId === PROGRAM_IDS.EZIMPO ? (
        <EzImpoLicenseManager />
      ) : currentProgramId === PROGRAM_IDS.EZPRINTWORK ? (
        <EzPrintWorkLicenseManager />
      ) : (
        <div className="p-20 text-center bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
          <i className="fas fa-hand-pointer mb-4 text-4xl"></i>
          <p>왼쪽 사이드바에서 프로그램을 먼저 선택해주세요.</p>
        </div>
      )}
    </div>
  );
};

export default LicenseManager;

