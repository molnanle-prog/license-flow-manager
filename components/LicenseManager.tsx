
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

const LicenseManager: React.FC<{ modalOnly?: boolean }> = ({ modalOnly = false }) => {
  const COOLDOWN_DAYS = 3; // 기기 변경 쿨다운 기간 (3일)
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'licenses' | 'trials' | 'products' | 'versions'>('licenses');
  const [currentProgramId, setCurrentProgramIdState] = useState<PROGRAM_IDS | ''>('');

  useEffect(() => {
      const config = getStorageAppConfig();
      if (config.currentProgramId) {
          const program = config.programs.find(p => p.id === config.currentProgramId);
          if (program) {
              setCurrentProgramIdState(program.programId);
          }
      }
  }, []);

  const handleProgramChange = async (programId: PROGRAM_IDS) => {
      console.log(`Switching to program: ${programId}`);
      const config = getStorageAppConfig();
      const targetProgram = config.programs.find(p => p.programId === programId);
      
      if (targetProgram) {
          config.currentProgramId = targetProgram.id;
          saveAppConfig(config);
          setCurrentProgramIdState(programId);
          setLicenses([]);
          setProducts([]);
          setInstallationLogs([]);
          await refreshData(true, true, targetProgram.programId);
      } else {
          console.error(`Program not found for ID: ${programId}`);
      }
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [installationLogs, setInstallationLogs] = useState<Installation[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'product' | 'license' | 'bulk-edit' | 'sms'>('product');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [missingSheetId, setMissingSheetId] = useState(false);
  const [linkedRequestId, setLinkedRequestId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  const [filterProductId, setFilterProductId] = useState<string>('all');
  const [newProduct, setNewProduct] = useState<Partial<Product>>({});
  const [newLicense, setNewLicense] = useState<Partial<License>>({ status: LicenseStatus.PENDING, paymentStatus: 'PAID' });
  const [smsTarget, setSmsTarget] = useState<{ contact: string, content: string, license?: License }>({ contact: '', content: '' });
  const [selectedDuration, setSelectedDuration] = useState<string>('LIFETIME');
  const [customExpiryDate, setCustomExpiryDate] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{id: string, startX: number, startWidth: number} | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'product' | 'license', id: string, name: string, programId?: string } | null>(null);
  
  const normalize = useCallback((s: any) => String(s || '').trim().replace(/[\s-]/g, '').toLowerCase(), []);

  const extractPhoneFromName = useCallback((name: string): { name: string, contact: string | null } => {
      if (!name) return { name: '', contact: null };
      const str = String(name);
      const phoneRegex = /(01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}/;
      const match = str.match(phoneRegex);
      if (match) {
          const contact = match[0];
          const cleanName = str.replace(contact, '').replace(/[()]/g, '').trim();
          return { name: cleanName, contact: contact };
      }
      return { name: str, contact: null };
  }, []);

  const formatContactInput = (val: string) => {
      const d = val.replace(/\D/g, '');
      if (d.length <= 2) return d;
      if (d.startsWith('02')) {
          if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
          if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
          return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
      } else {
          if (d.length <= 3) return d;
          if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
          if (d.length <= 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
          return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
      }
  };

  const handleSort = (key: string) => {
      setSortConfig(prev => ({
          key,
          direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
      }));
  };

  const isWithin24Hours = useCallback((dateStr?: string) => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      const now = new Date();
      return (now.getTime() - date.getTime()) < (24 * 60 * 60 * 1000);
  }, []);

  const isTrial = useCallback((l: License) => {
      if (l.type === LicenseType.TRIAL) return true;
      if (l.key) {
          const k = l.key.toLowerCase();
          if (k.includes('test') || k.includes('trial')) return true;
      }
      return false;
  }, []);

  const getComparisonKey = useCallback((l: License) => {
      const mid = normalizeMachineId(l.machineId);
      let prod = normalize(l.productName);
      if (!prod && l.productId) {
          const p = products.find(prod => prod.id === l.productId);
          if (p) prod = normalize(p.name);
      }
      return `${mid}|${prod}`;
  }, [products, normalize]);

  const officialLicenses = useMemo(() => licenses.filter(l => !isTrial(l)), [licenses, isTrial]);
  const officialUserKeys = useMemo(() => {
      const keys = new Set<string>();
      officialLicenses.forEach(l => { if (l.machineId && l.machineId.length > 3) keys.add(getComparisonKey(l)); });
      return keys;
  }, [officialLicenses, getComparisonKey]);

  const activeTrialLicenses = useMemo(() => {
      const active: License[] = [];
      licenses.filter(l => isTrial(l)).forEach(l => {
          let isConverted = false;
          if (l.machineId && l.machineId.length > 3) {
              const key = getComparisonKey(l);
              if (officialUserKeys.has(key)) isConverted = true;
          }
          if (!isConverted) active.push(l);
      });
      return active;
  }, [licenses, isTrial, getComparisonKey, officialUserKeys]);

  const convertedTrialLicenses = useMemo(() => {
      const converted: License[] = [];
      licenses.filter(l => isTrial(l)).forEach(l => {
          let isConverted = false;
          if (l.machineId && l.machineId.length > 3) {
              const key = getComparisonKey(l);
              if (officialUserKeys.has(key)) isConverted = true;
          }
          if (isConverted) converted.push(l);
      });
      return converted;
  }, [licenses, isTrial, getComparisonKey, officialUserKeys]);

  const uniqueGhostTrials = useMemo(() => {
      const trialLogs: any[] = [
          ...installationLogs.filter(log => log.actionType === 'TRIAL_ACTIVATED' && log.machineId),
          ...debugLogs.map(log => {
              const ext = extractInfoFromDebugLog(log);
              const isTrial = !ext.key || ext.key.includes('TRIAL') || ext.key.includes('공용');
              if (isTrial && log.machineId) {
                  return { ...log, userName: ext.name, companyName: ext.company, productName: ext.product, version: ext.version };
              }
              return null;
          }).filter(Boolean)
      ];

      const uniqueMap = new Map<string, any>();
      trialLogs.forEach(log => {
          const mid = normalizeMachineId(log.machineId);
          if (!mid) return;
          const { contact } = extractPhoneFromName(log.userName || '');
          const groupKey = contact ? `contact-${normalizeMachineId(contact)}` : `mid-${mid}`;

          if (uniqueMap.has(groupKey)) {
              const existing = uniqueMap.get(groupKey)!;
              if (new Date(log.timestamp) > new Date(existing.timestamp)) {
                  uniqueMap.set(groupKey, log);
              }
          } else {
              uniqueMap.set(groupKey, log);
          }
      });
      return Array.from(uniqueMap.values());
  }, [installationLogs, debugLogs, extractPhoneFromName]);

  const activeGhosts = useMemo(() => {
      const ghosts: License[] = [];
      uniqueGhostTrials.forEach((log, idx) => {
          const mid = normalizeMachineId(log.machineId);
          const isKnownInSheet = licenses.some(l => normalizeMachineId(l.machineId) === mid);
          if (!isKnownInSheet) {
              const timestamp = log.timestamp;
              const expDate = new Date(timestamp);
              let expiresAtStr: string | null = null;
              if (!isNaN(expDate.getTime())) {
                  expDate.setDate(expDate.getDate() + 14);
                  expiresAtStr = expDate.toISOString();
              }
              const { name, contact } = extractPhoneFromName(log.userName || '');
              ghosts.push({
                  id: `ghost-${idx}`, 
                  key: '(공용 체험판 키)', 
                  productId: 'trial-product', 
                  productName: log.productName,
                  type: LicenseType.TRIAL, 
                  status: LicenseStatus.ACTIVE, 
                  paymentStatus: 'FREE', 
                  createdAt: timestamp, 
                  expiresAt: expiresAtStr,
                  machineId: log.machineId, 
                  userName: name || '미등록 사용자', 
                  companyName: log.companyName || '자동 설치됨', 
                  contactInfo: contact || '', 
                  pin: '****', 
                  version: log.version
              });
          }
      });
      return ghosts;
  }, [uniqueGhostTrials, licenses, extractPhoneFromName]);

  const convertedGhosts = useMemo(() => {
      const ghosts: License[] = [];
      uniqueGhostTrials.forEach((log, idx) => {
          const mid = normalizeMachineId(log.machineId);
          const isOfficial = officialLicenses.some(l => normalizeMachineId(l.machineId) === mid);
          const hasSheetTrial = licenses.some(l => isTrial(l) && normalizeMachineId(l.machineId) === mid);
          if (isOfficial && !hasSheetTrial) {
              const { name, contact } = extractPhoneFromName(log.userName || '');
              ghosts.push({
                  id: `ghost-${idx}`, 
                  key: '(공용 체험판 키)', 
                  productId: 'trial-product', 
                  productName: log.productName,
                  type: LicenseType.TRIAL, 
                  status: LicenseStatus.EXPIRED, 
                  paymentStatus: 'FREE', 
                  createdAt: log.timestamp, 
                  expiresAt: null,
                  machineId: log.machineId, 
                  userName: name || '미등록 사용자', 
                  companyName: log.companyName || '자동 설치됨', 
                  contactInfo: contact || '', 
                  pin: '****', 
                  version: log.version
              });
          }
      });
      return ghosts;
  }, [uniqueGhostTrials, officialLicenses, licenses, isTrial, extractPhoneFromName]);

  const allActiveTrials = useMemo(() => [...activeTrialLicenses, ...activeGhosts], [activeTrialLicenses, activeGhosts]);
  const allConvertedTrials = useMemo(() => [...convertedTrialLicenses, ...convertedGhosts], [convertedTrialLicenses, convertedGhosts]);
  const allTrials = useMemo(() => [...allActiveTrials, ...allConvertedTrials], [allActiveTrials, allConvertedTrials]);

  const createFilterFn = useCallback((term: string, pId: string) => {
      const lowerTerm = term.toLowerCase();
      return (l: License) => {
          if (pId !== 'all' && l.productId !== pId && l.productId !== 'trial-product') return false;
          if (!term) return true;
          const prod = products.find(p => p.id === l.productId);
          return (l.key.toLowerCase().includes(lowerTerm) || (l.pin && l.pin.includes(lowerTerm)) || (l.userName && l.userName.toLowerCase().includes(lowerTerm)) || (l.companyName && l.companyName.toLowerCase().includes(lowerTerm)) || (prod && prod.name.toLowerCase().includes(lowerTerm)) || (l.productName && l.productName.toLowerCase().includes(lowerTerm)) || (l.contactInfo && l.contactInfo.toLowerCase().includes(lowerTerm)));
      };
  }, [products]);

  const currentFilterFn = useMemo(() => createFilterFn(searchTerm, filterProductId), [createFilterFn, searchTerm, filterProductId]);
  
  const sortData = useCallback(<T extends Record<string, any>>(data: T[]) => {
      return [...data].sort((a, b) => {
          let v1 = a[sortConfig.key];
          let v2 = b[sortConfig.key];
          if (v1 === v2) return 0;
          if (v1 === null || v1 === undefined) return 1;
          if (v2 === null || v2 === undefined) return -1;
          const direction = sortConfig.direction === 'asc' ? 1 : -1;
          if (typeof v1 === 'string' && typeof v2 === 'string') return v1.localeCompare(v2) * direction;
          return (v1 < v2 ? -1 : 1) * direction;
      });
  }, [sortConfig]);

  const filteredOfficial = useMemo(() => sortData(officialLicenses.filter(currentFilterFn)), [officialLicenses, currentFilterFn, sortData]);
  const filteredActiveTrials = useMemo(() => sortData(allActiveTrials.filter(currentFilterFn)), [allActiveTrials, currentFilterFn, sortData]);
  const filteredConvertedTrials = useMemo(() => sortData(allConvertedTrials.filter(currentFilterFn)), [allConvertedTrials, currentFilterFn, sortData]);
  const filteredProducts = useMemo(() => sortData(products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))), [products, searchTerm, sortData]);
  
  const countOfficial = useMemo(() => officialLicenses.length, [officialLicenses]);
  const countTrials = useMemo(() => allTrials.length, [allTrials]); 
  const countProducts = useMemo(() => products.length, [products]);
  const newTrialCount = useMemo(() => filteredActiveTrials.filter(l => isWithin24Hours(l.createdAt)).length, [filteredActiveTrials, isWithin24Hours]);
  const activeBaseForVersion = useMemo(() => [...officialLicenses, ...allActiveTrials], [officialLicenses, allActiveTrials]);
  const outdatedLicenses = useMemo(() => activeBaseForVersion.filter(l => getLicenseVersionInfo(l, installationLogs, products, licenses, debugLogs).status === 'OUTDATED'), [activeBaseForVersion, installationLogs, products, licenses, debugLogs]);
  const latestLicenses = useMemo(() => activeBaseForVersion.filter(l => getLicenseVersionInfo(l, installationLogs, products, licenses, debugLogs).status === 'LATEST'), [activeBaseForVersion, installationLogs, products, licenses, debugLogs]);
  
  const machineCountMap = useMemo(() => {
      const counts = new Map<string, Set<string>>();
      const allLogs = [...installationLogs, ...debugLogs];
      allLogs.forEach(log => {
          let key = '';
          if ((log as any).rawData) {
              const ext = extractInfoFromDebugLog(log as any);
              key = (ext.key || '').trim().toUpperCase();
          }
          const mid = normalizeMachineId(log.machineId);
          if (key && mid) {
              if (!counts.has(key)) counts.set(key, new Set());
              counts.get(key)!.add(mid);
          }
      });
      return counts;
  }, [installationLogs, debugLogs]);

  const exportToExcel = () => {
      const dataToExport = activeTab === 'licenses' ? filteredOfficial : activeTab === 'trials' ? allTrials : products;
      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
      XLSX.writeFile(workbook, `LicenseData_${activeTab}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const openSmsWithTemplate = useCallback((license: License, type: 'upgrade' | 'expire' | 'welcome') => {
      const appConfig = getStorageAppConfig();
      const program = getCurrentProgram();
      if (!program) return;
      const product = products.find(p => p.id === license.productId && p.programId === program.programId);
      const userName = license.userName || '고객';
      const prodName = product?.name || license.productName || '제품';
      const version = product?.version || '최신';
      const key = license.key || '';
      const link = appConfig.downloadLink || '다운로드 링크 확인 필요';
      let text = "";
      switch (type) {
          case 'upgrade': text = `[LicenseFlow] 안녕하세요, ${userName}님!\n\n${prodName}의 새로운 버전(${version})이 업데이트되었습니다. 원활한 사용을 위해 아래 링크에서 최신 버전을 다시 다운로드 받아주세요.\n\n다운로드: ${link}\n\n감사합니다.`; break;
          case 'expire': text = `[LicenseFlow] 안녕하세요, ${userName}님.\n\n사용 중이신 ${prodName} 라이선스가 곧 만료될 예정입니다. 계속 사용을 원하시면 연장 신청을 부탁드립니다.\n\n감사합니다.`; break;
          case 'welcome': text = `[LicenseFlow] 안녕하세요, ${userName}님!\n\n요청하신 ${prodName} 라이선스 발급이 완료되었습니다.\n\n◼ 제품: ${prodName}\n◼ 키: ${key}\n◼ 다운로드: ${link}\n\n이용해 주셔서 감사합니다.`; break;
      }
      setSmsTarget({ contact: license.contactInfo || '', content: text, license: license });
      setModalType('sms');
      setShowModal(true);
  }, [products]);

  const applyTemplate = useCallback((type: 'upgrade' | 'expire' | 'welcome') => {
      const { license } = smsTarget;
      if (!license) return;
      const appConfig = getStorageAppConfig();
      const program = getCurrentProgram();
      if (!program) return;
      const product = products.find(p => p.id === license.productId && p.programId === program.programId);
      const userName = license.userName || '고객';
      const prodName = product?.name || license.productName || '제품';
      const version = product?.version || '최신';
      const key = license.key || '';
      const link = appConfig.downloadLink || '다운로드 링크 확인 필요';
      let text = "";
      switch (type) {
          case 'upgrade': text = `[LicenseFlow] 안녕하세요, ${userName}님!\n\n${prodName}의 새로운 버전(${version})이 업데이트되었습니다. 원활한 사용을 위해 아래 링크에서 최신 버전을 다시 다운로드 받아주세요.\n\n다운로드: ${link}\n\n감사합니다.`; break;
          case 'expire': text = `[LicenseFlow] 안녕하세요, ${userName}님.\n\n사용 중이신 ${prodName} 라이선스가 곧 만료될 예정입니다. 계속 사용을 원하시면 연장 신청을 부탁드립니다.\n\n감사합니다.`; break;
          case 'welcome': text = `[LicenseFlow] 안녕하세요, ${userName}님!\n\n요청하신 ${prodName} 라이선스 발급이 완료되었습니다.\n\n◼ 제품: ${prodName}\n◼ 키: ${key}\n◼ 다운로드: ${link}\n\n이용해 주셔서 감사합니다.`; break;
      }
      setSmsTarget(prev => ({ ...prev, content: text }));
  }, [products, smsTarget]);

  const isRefreshing = useRef(false);
  const autoCreateProcessed = useRef<string | null>(null);
  const prevLicensesStr = useRef<string>("");
  const prevProductsStr = useRef<string>("");
  const prevLogsStr = useRef<string>("");

  const refreshData = useCallback(async (showLoading = true, forceRefresh = false, programId?: PROGRAM_IDS) => {
    if (isRefreshing.current && !forceRefresh) return;
    isRefreshing.current = true;
    const program = getCurrentProgram(programId);
    if (!program || !program.sheetId) {
        setMissingSheetId(true);
        setIsLoading(false);
        isRefreshing.current = false;
        return;
    } else {
        setMissingSheetId(false);
    }
    const currentProgramId = program.programId;
    if (showLoading) setIsLoading(true);
    setLoadError(null);
    const loadingTimeout = setTimeout(() => {
        if (isRefreshing.current) {
            if (showLoading) setIsLoading(false);
            isRefreshing.current = false;
            setLoadError("요청 시간이 너무 오래 걸립니다. 다시 시도해주세요.");
        }
    }, 30000);
    try {
        const [p, l, i, d, cData] = await Promise.all([ 
            getProducts(forceRefresh, currentProgramId), 
            getLicenses(forceRefresh, currentProgramId), 
            getInstallations(forceRefresh, currentProgramId),
            getDebugLogs(forceRefresh),
            getCustomers(forceRefresh, currentProgramId)
        ]);
        setBackgroundError(null);
        if (showLoading) setLoadError(null);
        const newProductsStr = JSON.stringify(p);
        if (newProductsStr !== prevProductsStr.current) { setProducts(p); prevProductsStr.current = newProductsStr; }
        clearTimeout(loadingTimeout);
        
        const processedLicenses = l.map(lic => {
            let userName = lic.userName || '';
            let contactInfo = lic.contactInfo || '';
            if (!contactInfo) {
                const { name, contact } = extractPhoneFromName(userName);
                if (contact) { userName = name; contactInfo = contact; }
            }
            const normalizedName = userName.trim().toLowerCase();
            const isGeneric = ['administrator', 'user', 'pc', 'admin', 'laptop', 'desktop'].includes(normalizedName);
            if (isGeneric && contactInfo) {
                const matchingCustomer = cData.find(c => c.email === contactInfo || c.id === lic.contactInfo);
                if (matchingCustomer && !['administrator', 'user', 'pc', 'admin', 'laptop', 'desktop'].includes(matchingCustomer.name.toLowerCase())) {
                    userName = matchingCustomer.name;
                }
            }
            return { ...lic, userName, contactInfo, programId: currentProgramId };
        });
        const getTime = (d?: string | null) => { if (!d) return 0; const date = new Date(d); return isNaN(date.getTime()) ? 0 : date.getTime(); };
        const keyCountMap = new Map<string, number>();
        processedLicenses.forEach(lic => {
            const k = (lic.key || '').trim().toUpperCase();
            if (k) keyCountMap.set(k, (keyCountMap.get(k) || 0) + 1);
        });
        const uniqueLicenses = processedLicenses.map(lic => ({
            ...lic,
            isDuplicate: (lic.key && (keyCountMap.get(lic.key.trim().toUpperCase()) || 0) > 1)
        }));
        uniqueLicenses.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
        const newLicensesStr = JSON.stringify(uniqueLicenses);
        if (newLicensesStr !== prevLicensesStr.current) { setLicenses(uniqueLicenses as any); prevLicensesStr.current = newLicensesStr; }
        const sortedInst = [...i].sort((a, b) => getTime(b.timestamp) - getTime(a.timestamp));
        const newLogsStr = JSON.stringify(sortedInst);
        if (newLogsStr !== prevLogsStr.current) { setInstallationLogs(sortedInst); prevLogsStr.current = newLogsStr; }
        setDebugLogs(d);
        const currentProgram = getCurrentProgram();
        if (currentProgram && uniqueLicenses.length > 0 && d.length > 0) {
            const autoUpdates: License[] = [];
            uniqueLicenses.forEach(lic => {
                const status = getLicenseVersionInfo(lic as any, sortedInst, p, uniqueLicenses as any, d);
                if (status.detectedMachineId) {
                    const normDetected = normalizeMachineId(status.detectedMachineId);
                    const normCurrent = normalizeMachineId(lic.machineId);
                    if (normDetected && normDetected !== normCurrent) {
                        if (!normCurrent) autoUpdates.push({ ...lic, machineId: status.detectedMachineId } as any);
                        else {
                            const lastChange = lic.lastReset ? new Date(lic.lastReset).getTime() : 0;
                            const daysSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60 * 24);
                            if (daysSinceChange >= COOLDOWN_DAYS) {
                                autoUpdates.push({ ...lic, machineId: status.detectedMachineId, lastReset: new Date().toISOString() } as any);
                            }
                        }
                    }
                }
            });
            if (autoUpdates.length > 0) {
                saveLicenses(autoUpdates, currentProgram.programId);
            }
        }
        if (newProductsStr !== prevProductsStr.current || newLicensesStr !== prevLicensesStr.current || newLogsStr !== prevLogsStr.current || forceRefresh) setLastUpdated(new Date());
    } catch (e: any) {
        if (showLoading) setLoadError(e.message || "데이터 불러오기 실패");
        else setBackgroundError(e.message || "자동 갱신 실패");
    } finally {
        setIsLoading(false);
        isRefreshing.current = false;
    }
  }, [extractPhoneFromName]);

  useEffect(() => {
    const handleGlobalRefresh = () => refreshData(true, true);
    window.addEventListener('REFRESH_DATA', handleGlobalRefresh);
    return () => window.removeEventListener('REFRESH_DATA', handleGlobalRefresh);
  }, [refreshData]);

  useEffect(() => {
    const defaults = COLUMN_DEFS.reduce((acc, col) => ({ ...acc, [col.id]: col.width }), {});
    const savedWidths = localStorage.getItem('LICENSE_COL_WIDTHS_V5');
    if (savedWidths) try { setColWidths({ ...defaults, ...JSON.parse(savedWidths) }); } catch (e) { setColWidths(defaults); }
    else setColWidths(defaults);
    let timeoutId: NodeJS.Timeout;
    const loop = async () => {
        try { const currentProgram = getCurrentProgram(); if (currentProgram) await refreshData(false, true, currentProgram.programId); else await refreshData(false, true); }
        catch (e) { console.error("Polling loop error:", e); }
        finally { timeoutId = setTimeout(loop, 600000); }
    };
    const initialProgram = getCurrentProgram();
    refreshData(false, false, initialProgram?.programId).then(() => loop());
    return () => clearTimeout(timeoutId);
  }, [refreshData]);

  const forceReconnect = useCallback(async () => {
    isRefreshing.current = false; prevLicensesStr.current = ""; prevProductsStr.current = ""; prevLogsStr.current = "";
    const currentProgram = getCurrentProgram();
    await refreshData(true, true, currentProgram?.programId);
  }, [refreshData]);

  useEffect(() => {
      const watchdogInterval = setInterval(() => { const now = new Date(); if (lastUpdated && (now.getTime() - lastUpdated.getTime() > 15 * 60 * 1000)) forceReconnect(); }, 60000); 
      return () => clearInterval(watchdogInterval);
  }, [lastUpdated, forceReconnect]);

  useEffect(() => {
    const state = location.state as any;
    const sessionDataStr = sessionStorage.getItem('AUTO_CREATE_DATA');
    let data = state?.autoCreate;
    if (!data && sessionDataStr) { try { data = JSON.parse(sessionDataStr); } catch (e) {} }
    if (data) {
        if (autoCreateProcessed.current === data.requestId) return; 
        
        // 제품 데이터가 아직 로드되지 않았으면 로드될 때까지 기다림
        if (products.length === 0) return;

        const prodName = String(data.originalProductName || '').toLowerCase();
        let detectedDuration = 'LIFETIME';
        if (prodName.includes('1개월') || prodName.includes('30일') || prodName.includes('1month')) detectedDuration = '30DAYS';
        else if (prodName.includes('1년') || prodName.includes('1year') || prodName.includes('365일')) detectedDuration = '1YEAR';
        else if (prodName.includes('체험') || prodName.includes('trial') || prodName.includes('test')) detectedDuration = '14DAYS';
        setSelectedDuration(detectedDuration);
        
        const prefix = data.programId === PROGRAM_IDS.EZPRINTWORK ? 'EZPW' : 'EZIM';
        
        // 제품 매칭 로직 강화
        let matchedProductId = data.targetProductId || '';
        let matchedProductName = data.originalProductName || '';
        let matchedVersion = data.version || '';

        const matched = products.find(p => p.programId === data.programId && (p.name === data.originalProductName || p.id === data.targetProductId));
        if (matched) {
            matchedProductId = matched.id;
            matchedProductName = matched.name;
            matchedVersion = matched.version;
        }

        setNewLicense({ 
            userName: data.userName, 
            companyName: data.companyName, 
            contactInfo: data.contact, 
            machineId: data.machineId, 
            productId: matchedProductId, 
            productName: matchedProductName, 
            version: matchedVersion, 
            status: LicenseStatus.PENDING, 
            paymentStatus: 'PAID',
            programId: data.programId,
            key: generateSerialKey(prefix),
            type: detectedDuration === '14DAYS' ? LicenseType.TRIAL : LicenseType.LIFETIME,
            email: data.email || '',
            plan: data.plan || 'free'
        });
        
        setLinkedRequestId(data.requestId); 
        setModalType('license'); 
        setIsEditing(false); 
        autoCreateProcessed.current = data.requestId;
        setShowModal(true);
        // [FIX] 여기서 지우면 App.tsx에서 컴포넌트를 즉시 언마운트해버리므로, 모달이 완전히 닫힐 때 지우도록 변경
        // sessionStorage.removeItem('AUTO_CREATE_DATA');
    }
}, [location.state, location.pathname, navigate, products]);

  const toggleSelection = (id: string) => { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const handleSelectAll = (filteredIds: string[]) => { if (selectedIds.size === filteredIds.length && filteredIds.length > 0) setSelectedIds(new Set()); else setSelectedIds(new Set(filteredIds)); };
  const handleBulkEdit = () => { if (selectedIds.size === 0) return; setModalType('bulk-edit'); setNewLicense({}); setSelectedDuration(''); setShowModal(true); };
  const handleBulkDelete = async () => {
      if (selectedIds.size === 0) return;
      if (!confirm(`${selectedIds.size}개의 항목을 정말 삭제하시겠습니까?`)) return;
      setIsLoading(true);
      try {
          const ids = Array.from(selectedIds) as string[];
          const program = getCurrentProgram();
          if (!program) return;
          if (activeTab === 'products') await deleteProducts(ids, program.programId);
          else await deleteLicenses(ids, program.programId);
          setSelectedIds(new Set());
          await refreshData(true, true, program.programId);
      } catch (e: any) { alert("삭제 중 오류가 발생했습니다: " + e.message); } finally { setIsLoading(false); }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { if (!resizing) return; const diff = e.clientX - resizing.startX; const newWidth = Math.max(40, resizing.startWidth + diff); setColWidths(prev => ({ ...prev, [resizing.id]: newWidth })); };
    const handleMouseUp = () => { if (resizing) { localStorage.setItem('LICENSE_COL_WIDTHS_V5', JSON.stringify(colWidths)); setResizing(null); document.body.style.cursor = 'default'; document.body.style.userSelect = 'auto'; } };
    if (resizing) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [resizing, colWidths]);

  const handleSaveProduct = async () => {
    if (!newProduct.name || !newProduct.price) return;
    setIsLoading(true);
    try {
      const program = getCurrentProgram(); if (!program) return;
      await saveProduct({ id: newProduct.id || Date.now().toString(), name: newProduct.name, version: newProduct.version || '1.0', price: Number(newProduct.price), originalPrice: Number(newProduct.originalPrice || newProduct.price), description: newProduct.description || '' } as Product, program.programId);
      setShowModal(false); await refreshData(true, true, program.programId);
    } catch(e) { alert('저장 실패'); } finally { setIsLoading(false); }
  };

  const handleSaveLicense = async () => {
    setIsLoading(true);
    try {
        let expiresAt: string | null = null; let type: LicenseType = LicenseType.LIFETIME;
        if (customExpiryDate) { expiresAt = new Date(customExpiryDate).toISOString(); type = LicenseType.SUBSCRIPTION; }
        else if (selectedDuration) {
             const oneDay = 86400000;
             const currentExp = (isEditing && (newLicense as License).expiresAt) ? new Date((newLicense as License).expiresAt).getTime() : Date.now();
             const baseTime = Math.max(currentExp, Date.now());
             switch (selectedDuration) {
                case '14DAYS': expiresAt = new Date(baseTime + oneDay * 14).toISOString(); type = LicenseType.TRIAL; break;
                case '30DAYS': expiresAt = new Date(baseTime + oneDay * 30).toISOString(); type = LicenseType.SUBSCRIPTION; break;
                case '1YEAR': expiresAt = new Date(baseTime + oneDay * 365).toISOString(); type = LicenseType.SUBSCRIPTION; break;
                case 'LIFETIME': expiresAt = null; type = LicenseType.LIFETIME; break;
                case 'CURRENT': expiresAt = (newLicense as License).expiresAt || null; break;
            }
        }
        const program = getCurrentProgram(); if (!program) return;
        const targetProgramId = (newLicense.programId as PROGRAM_IDS) || program.programId;
        if (modalType === 'bulk-edit') {
            const allLicenses = await getLicenses(false, targetProgramId);
            const targets = allLicenses.filter(l => selectedIds.has(l.id));
            const updates: Partial<License> = {};
            if (newLicense.productId) updates.productId = newLicense.productId;
            if (newLicense.status) updates.status = newLicense.status;
            if (newLicense.paymentStatus) updates.paymentStatus = newLicense.paymentStatus;
            if (selectedDuration) { updates.expiresAt = expiresAt; updates.type = type; }
            const modifiedLicenses = targets.map(l => ({ ...l, ...updates }));
            await saveLicenses(modifiedLicenses, targetProgramId);
        } else {
            if (isEditing) await saveLicense({ ...(newLicense as License), type: type, expiresAt: expiresAt }, targetProgramId);
            else {
                let prefix = targetProgramId === PROGRAM_IDS.EZIMPO ? 'EZIM' : 'EZPW';
                const selectedProduct = products.find(p => p.id === newLicense.productId);
                const createLicenseObj = (key: string): License => {
                    return {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
                        key: key, productId: newLicense.productId!, productName: selectedProduct?.name || newLicense.productName || '', type, status: newLicense.status || LicenseStatus.PENDING, paymentStatus: newLicense.paymentStatus || 'PAID', createdAt: new Date().toISOString(), expiresAt, pin: newLicense.pin || '', companyName: newLicense.companyName || '', userName: newLicense.userName || '', machineId: newLicense.machineId || '', version: newLicense.version || selectedProduct?.version || '', requestId: linkedRequestId || undefined, contactInfo: newLicense.contactInfo || '',
                    };
                };
                const finalKey = newLicense.key || generateSerialKey(prefix);
                const finalLicenseObj = createLicenseObj(finalKey);
                if (quantity > 1) {
                    const licensesToSave: License[] = []; 
                    for(let i=0; i<quantity; i++) licensesToSave.push(createLicenseObj(generateSerialKey(prefix)));
                    await saveLicenses(licensesToSave, targetProgramId);
                } else await saveLicense(finalLicenseObj, targetProgramId);
                if (linkedRequestId) {
                    const allRequests = await getLicenseRequests(false, targetProgramId);
                    let targetReq = allRequests.find(r => r.id === linkedRequestId);
                    if (targetReq) await saveLicenseRequest({ ...targetReq, status: RequestStatus.PROCESSED }, targetProgramId);
                    openSmsWithTemplate(finalLicenseObj, 'welcome');
                    setLinkedRequestId(null);
                    sessionStorage.setItem('RETURN_TO_REQUESTS', 'true');
                    return; 
                }
            }
        }
        if (targetProgramId === PROGRAM_IDS.EZPRINTWORK && newLicense.email && newLicense.email.includes('@')) {
            try { await syncWebUserRole(newLicense.email, (newLicense.plan || 'free') as any); } catch (e) {}
        }
        setShowModal(false); await refreshData(false, true);
    } catch(e: any) { alert('저장 실패: ' + e.message); } finally { setIsLoading(false); }
  };

  const handleRepairData = async () => {
    if (!confirm("모든 라이선스의 Product ID를 제품명 기준으로 자동 복구하시겠습니까?")) return;
    setIsLoading(true);
    try {
        const program = getCurrentProgram();
        const result = await repairLicenseProductIds(program?.programId);
        alert(`복구 완료! 총 ${result.total}개 중 ${result.repaired}개의 항목이 복구되었습니다.`);
        await refreshData(true, true);
    } catch (e: any) { alert("복구 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const promptDelete = (type: 'product' | 'license', id: string, name: string) => { const program = getCurrentProgram(); if (!program) return; setItemToDelete({ type, id, name, programId: program.programId }); setShowConfirmModal(true); };
  const confirmDelete = async () => { if (!itemToDelete) return; setShowConfirmModal(false); setIsLoading(true); try { if (itemToDelete.type === 'product') await deleteProduct(itemToDelete.id); else await deleteLicense(itemToDelete.id); await refreshData(); } catch (e: any) { alert('삭제 실패: ' + e.message); } finally { setIsLoading(false); setItemToDelete(null); } };
  const openSmsModal = (license: License) => { setSmsTarget({ contact: license.contactInfo || '', content: '', license: license }); setModalType('sms'); setShowModal(true); };

  const sendSms = async () => {
     const { contact, content, license } = smsTarget;
     const cleanNumber = contact.replace(/[^0-9+]/g, '');
     if (!cleanNumber) { alert("전화번호가 유효하지 않습니다."); return; }
     window.open(`sms:${cleanNumber}?&body=${encodeURIComponent(content)}`, '_blank');
     if (license && license.id) {
         try {
             const program = getCurrentProgram();
             if (program) {
                 await saveLicense({ ...license, lastSmsSent: new Date().toISOString() }, program.programId);
                 await refreshData(false, true, program.programId); 
             }
         } catch (e) {}
     }
     setShowModal(false);
     if (modalOnly || sessionStorage.getItem('RETURN_TO_REQUESTS') === 'true') { 
         sessionStorage.removeItem('AUTO_CREATE_DATA');
         sessionStorage.removeItem('RETURN_TO_REQUESTS'); 
         if (modalOnly) window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
         if (sessionStorage.getItem('RETURN_TO_REQUESTS') === 'true') navigate('/requests');
     }
  };

  const handleResetMachineId = async (license: License) => {
      if (!confirm(`${license.userName || license.key} 고객의 기기 정보를 초기화하시겠습니까?`)) return;
      setIsLoading(true);
      try {
          const program = getCurrentProgram();
          if (program) {
              await saveLicense({ ...license, machineId: '', lastReset: new Date().toISOString() }, program.programId);
              await refreshData(false, true, program.programId);
          }
      } catch (e: any) { alert("초기화 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const handleUpdateMachineId = async (license: License, newId: string) => {
      setIsLoading(true);
      try {
          const program = getCurrentProgram();
          if (program) {
              await saveLicense({ ...license, machineId: newId }, program.programId);
              await refreshData(false, true, program.programId);
          }
      } catch (e: any) { alert("업데이트 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const handleBulkSms = () => {
      if (selectedIds.size === 0) return;
      const targets = licenses.filter(l => selectedIds.has(l.id) && l.contactInfo);
      if (targets.length === 0) return;
      openSmsWithTemplate(targets[0], 'upgrade');
  };

  const RenderTable = ({ data, showCheckboxes = true, isConverted = false }: { data: License[], showCheckboxes?: boolean, isConverted?: boolean }) => (
       <table className="w-full text-center border-collapse" style={{ tableLayout: 'fixed' }}>
           <colgroup><col style={{ width: 40 }} />{COLUMN_DEFS.map(col => <col key={col.id} style={{ width: colWidths[col.id] || col.width }} />)}</colgroup>
           <thead className={`text-[11px] uppercase sticky top-0 shadow-sm z-10 select-none ${isConverted ? 'bg-blue-100 text-blue-900 border-b border-blue-200' : 'bg-gray-50 text-gray-700 border-b border-gray-200'}`}>
               <tr>
                   <th className="px-1 py-1 text-center border-r border-gray-200/50">{showCheckboxes && <input type="checkbox" checked={selectedIds.size === data.length && data.length > 0} onChange={() => handleSelectAll(data.map(l => l.id))} />}</th>
                   {COLUMN_DEFS.map(col => (
                       <th key={col.id} className="px-1 py-1 font-medium relative group truncate text-center border-r border-gray-200/50 last:border-r-0 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort(col.id)}>
                           <div className="flex items-center justify-center gap-1">{col.label}{sortConfig.key === col.id ? (<i className={`fas fa-sort-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-indigo-600`}></i>) : (<i className="fas fa-sort opacity-10 group-hover:opacity-40"></i>)}</div>
                           <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 group-hover:bg-gray-300" onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: col.id, startX: e.clientX, startWidth: colWidths[col.id] || col.width }); e.preventDefault(); }} />
                       </th>
                   ))}
               </tr>
           </thead>
           <tbody className={`divide-y divide-gray-100 text-xs`}>
               {data.map((l, idx) => {
                   const isGhost = l.id.startsWith('ghost-'); const isNew = isWithin24Hours(l.createdAt); const isExpired = l.expiresAt && new Date(l.expiresAt) < new Date(); 
                   const lastCheckInTime = l.lastCheckIn ? new Date(l.lastCheckIn).getTime() : 0;
                   const isOnline = lastCheckInTime > 0 && (Date.now() - lastCheckInTime) < (5 * 60 * 1000);
                   const rowClass = isConverted ? 'bg-blue-50/50 text-gray-900 hover:bg-blue-100/50' : isOnline ? 'bg-green-50/50 hover:bg-green-100/50 transition-colors' : `hover:bg-gray-50 ${isExpired ? 'bg-red-50/30' : isGhost ? 'bg-yellow-50/20' : ''}`;
                   const vStatus = getLicenseVersionInfo(l, installationLogs, products, licenses, debugLogs);
                   const hasNewMachine = vStatus.isMachineMismatch && vStatus.detectedMachineId;
                   return (
                       <tr key={l.id} className={rowClass}><td className="px-1 py-1 text-center border-r border-gray-200/50">{showCheckboxes && <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelection(l.id)} />}</td>
                           {COLUMN_DEFS.map(col => {
                               const value = l[col.id as keyof License];
                               switch(col.id) {
                                   case 'index': return (<td key={col.id} className="px-1 py-0.5 text-center text-gray-400 border-r border-gray-200/50 relative">{isOnline && (<div className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center" title="실시간 사용 중"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span></div>)}{idx + 1}</td>);
                                   case 'key': return <td key={col.id} className="px-1 py-0.5 font-mono text-[10px] text-indigo-600 truncate border-r border-gray-200/50" title={String(value || '')}><div className="flex items-center justify-center gap-1">{(l as any).isDuplicate && <i className="fas fa-exclamation-circle text-red-500 animate-pulse" title="중복 키 감지됨"></i>}{String(value || '-')}</div></td>;
                                   case 'userName': return <td key={col.id} className="px-1 py-0.5 font-bold text-gray-900 truncate border-r border-gray-200/50">{l.userName} {isNew && <span className="ml-1 bg-red-500 text-white text-[9px] px-1 rounded animate-pulse">NEW</span>}</td>;
                                   case 'machineId': { const mKey = (l.key || '').trim().toUpperCase(); const usedMids = machineCountMap.get(mKey); const mCount = usedMids ? usedMids.size : (l.machineId ? 1 : 0); return (<td key={col.id} className={`px-1 py-0.5 font-mono text-[10px] truncate border-r border-gray-200/50 ${hasNewMachine ? 'bg-amber-50' : 'text-gray-600'}`} title={l.machineId}><div className="flex flex-col items-center justify-center gap-0.5"><div className="flex items-center gap-1"><span className={hasNewMachine ? 'text-gray-400 line-through' : ''}>{l.machineId || '-'}</span>{mCount > 1 && <span className={`px-1 rounded text-[8px] font-bold ${mCount > 3 ? 'bg-red-500 text-white' : 'bg-orange-100 text-orange-600'}`} title="사용된 고유 기기 대수">[{mCount}대]</span>}{l.machineId && <button onClick={() => handleResetMachineId(l)} className="text-gray-300 hover:text-red-500 transition-colors" title="기기 초기화"><i className="fas fa-undo text-[8px]"></i></button>}</div>{hasNewMachine && (<div className="flex flex-col items-center gap-0.5 bg-amber-100 px-1 py-0.5 rounded border border-amber-200" title="로그에서 새로운 기기가 감지되었습니다."><div className="flex items-center gap-1"><i className="fas fa-exclamation-triangle text-amber-600 text-[8px]"></i><span className="text-amber-700 font-bold">{vStatus.detectedMachineId}</span><button onClick={() => { if (window.confirm(`새로운 기기 ID(${vStatus.detectedMachineId})를 라이선스에 즉시 반영하시겠습니까?`)) handleUpdateMachineId(l, vStatus.detectedMachineId!); }} className="ml-1 text-blue-600 hover:text-blue-800" title="강제 동기화"><i className="fas fa-sync-alt text-[8px]"></i></button></div></div>)}</div></td>); }
                                   case 'expiresAt': return <td key={col.id} className={`px-1 py-0.5 border-r border-gray-200/50 ${isExpired && !isConverted ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '∞ (평생)'}</td>;
                                   case 'status': { const statusMap: any = { ACTIVE: '활성', PENDING: '대기', EXPIRED: '만료', REVOKED: '정지' }; const label = statusMap[l.status] || l.status; return (<td key={col.id} className="px-1 py-0.5 border-r border-gray-200/50 text-center">{isGhost ? (<span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isConverted ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-orange-100 text-orange-700'}`}>{isConverted ? '전환됨' : 'AUTO-TRIAL'}</span>) : (<span className={`px-1 py-0.5 rounded text-[9px] font-bold ${l.status === 'ACTIVE' && !isConverted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{label}({l.status})</span>)}</td>); }
                                   case 'paymentStatus': { const payMap: any = { PAID: '완료', UNPAID: '미결제', FREE: '무료' }; const label = payMap[l.paymentStatus || 'UNPAID'] || l.paymentStatus; const color = l.paymentStatus === 'PAID' ? 'text-green-600' : l.paymentStatus === 'FREE' ? 'text-blue-500' : 'text-red-500'; return <td key={col.id} className={`px-1 py-0.5 border-r border-gray-200/50 text-center font-bold text-[10px] ${color}`}>{label}</td>; }
                                   case 'version': { const isLatest = vStatus.status === 'LATEST'; return <td key={col.id} className="px-1 py-0.5 border-r border-gray-200/50 text-center font-mono text-[10px]"><span className="inline-flex items-center gap-1 justify-center">{isLatest && <i className="fas fa-bolt text-yellow-500 text-[9px]" title="최신 버전 사용 중"></i>}{vStatus.current || '-'}</span></td>; }
                                   case 'smsStatus': { const lastSent = l.lastSmsSent; return <td key={col.id} className="px-1 py-0.5 text-center border-r border-gray-200/50">{lastSent ? <span className="text-[10px] text-green-700 font-bold bg-green-50 px-1.5 py-0.5 rounded shadow-sm inline-flex items-center gap-1"><i className="fas fa-check-double text-[8px]"></i>{new Date(lastSent).toLocaleDateString().slice(5)}</span> : <span className="text-[10px] text-gray-300">-</span>}</td>; }
                                   case 'actions': return <td key={col.id} className="px-1 py-0.5 text-center">{isGhost ? (!isConverted && <button onClick={() => { const progId = l.programId || currentProgramId || PROGRAM_IDS.EZIMPO; const prefix = progId === PROGRAM_IDS.EZIMPO ? 'EZIM' : 'EZPW'; setModalType('license'); setIsEditing(false); setNewLicense({ userName: l.userName, companyName: l.companyName, contactInfo: l.contactInfo, machineId: l.machineId, productName: l.productName, productId: l.productId || '', programId: progId, key: generateSerialKey(prefix), status: LicenseStatus.ACTIVE, paymentStatus: 'PAID', version: vStatus.current || l.version }); setSelectedDuration('LIFETIME'); setShowModal(true); }} className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-indigo-700 whitespace-nowrap shadow-sm">정품 등록</button>) : (<div className="flex justify-center opacity-80 hover:opacity-100"><button onClick={() => openSmsModal(l)} className="text-green-600 hover:text-green-800 mx-1" title="일반 문자 보내기"><i className="fas fa-comment-dots"></i></button><button onClick={() => { setModalType('license'); setIsEditing(true); const currentDisplayVersion = (vStatus.current && vStatus.current !== '?') ? vStatus.current : l.version; setNewLicense({ ...l, version: currentDisplayVersion }); if (l.expiresAt) setSelectedDuration('CURRENT'); else setSelectedDuration('LIFETIME'); setShowModal(true); }} className="text-gray-500 hover:text-indigo-700 mx-1"><i className="fas fa-edit"></i></button><button onClick={() => promptDelete('license', l.id, l.key)} className="text-gray-500 hover:text-red-700 mx-1"><i className="fas fa-trash"></i></button></div>)}</td>;
                                   default: return <td key={col.id} className={`px-1 py-0.5 truncate text-gray-600 text-[11px] border-r border-gray-200/50 last:border-r-0 ${col.id === 'companyName' ? 'text-left' : ''}`} title={String(value || '')}>{String(value || '-')}</td>;
                               }
                           })}</tr>); })}
           </tbody>
       </table>
  );

  const renderModal = () => {
    if (!showModal) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={() => {
            setShowModal(false);
            sessionStorage.removeItem('AUTO_CREATE_DATA');
            sessionStorage.removeItem('RETURN_TO_REQUESTS');
            if (modalOnly) {
                window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
            }
        }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold">{modalType === 'product' ? '제품 정보' : modalType === 'license' ? '라이선스 정보' : modalType === 'sms' ? '문자 보내기' : '일괄 수정'}</h3>
                    <button onClick={() => { setShowModal(false); if (modalOnly) { sessionStorage.removeItem('AUTO_CREATE_DATA'); sessionStorage.removeItem('RETURN_TO_REQUESTS'); window.dispatchEvent(new CustomEvent('REFRESH_DATA')); } }} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                </div>
                <div className="space-y-4">
                    {modalType === 'product' && (<><input type="text" placeholder="제품명" className="w-full border p-2 rounded" value={newProduct.name || ''} onChange={e => setNewProduct({...newProduct, name: e.target.value})} /><input type="text" placeholder="버전" className="w-full border p-2 rounded" value={newProduct.version || ''} onChange={e => setNewProduct({...newProduct, version: e.target.value})} /><input type="number" placeholder="가격" className="w-full border p-2 rounded" value={newProduct.price || ''} onChange={e => setNewProduct({...newProduct, price: Number(e.target.value)})} /></>)}
                    {modalType === 'license' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">프로그램</label><select className="w-full border p-2 rounded text-sm" value={newLicense.programId || currentProgramId || ''} onChange={async (e) => { const progId = e.target.value as PROGRAM_IDS; const prefix = progId === PROGRAM_IDS.EZIMPO ? 'EZIM' : 'EZPW'; const progProducts = await getProducts(false, progId); setProducts(progProducts); const defaultProduct = progProducts[0]; setNewLicense({ ...newLicense, programId: progId, productId: defaultProduct?.id || '', version: defaultProduct?.version || newLicense.version, key: !isEditing ? generateSerialKey(prefix) : newLicense.key }); }}><option value={PROGRAM_IDS.EZIMPO}>EzImpo</option><option value={PROGRAM_IDS.EZPRINTWORK}>EzPrintWork</option></select></div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">제품 선택</label><select className="w-full border p-2 rounded text-sm bg-blue-50/50 border-blue-100 font-bold" value={newLicense.productId || ''} onChange={e => { const p = products.find(prod => prod.id === e.target.value); setNewLicense({...newLicense, productId: e.target.value, productName: p?.name || '', version: p?.version || newLicense.version}); }}><option value="">-- 제품 선택 --</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">라이선스 키</label><input type="text" className="w-full border p-2 rounded text-sm font-mono text-indigo-600 font-bold" value={newLicense.key || ''} onChange={e => setNewLicense({...newLicense, key: e.target.value.toUpperCase()})}/></div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">버전</label><input type="text" className="w-full border p-2 rounded text-sm" value={newLicense.version || ''} onChange={e => setNewLicense({...newLicense, version: e.target.value})} /></div>
                            </div>
                            <div className={`grid grid-cols-1 ${newLicense.programId === PROGRAM_IDS.EZPRINTWORK ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">고객명</label><input type="text" className="w-full border p-2 rounded text-sm" value={newLicense.userName || ''} onChange={e => setNewLicense({...newLicense, userName: e.target.value})} /></div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">회사명</label><input type="text" className="w-full border p-2 rounded text-sm" value={newLicense.companyName || ''} onChange={e => setNewLicense({...newLicense, companyName: e.target.value})} /></div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">연락처</label><input type="text" className="w-full border p-2 rounded text-sm" placeholder="010-0000-0000" value={newLicense.contactInfo || ''} onChange={e => setNewLicense({...newLicense, contactInfo: formatContactInput(e.target.value)})} /></div>
                                {newLicense.programId === PROGRAM_IDS.EZPRINTWORK && (<div><label className="block text-xs font-bold text-gray-500 mb-1">구글 이메일</label><input type="email" className="w-full border p-2 rounded text-sm border-green-200 bg-green-50/30" placeholder="user@gmail.com" value={newLicense.email || ''} onChange={e => setNewLicense({...newLicense, email: e.target.value})} /></div>)}
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">PIN</label><input type="text" className="w-full border p-2 rounded text-sm font-bold text-indigo-600" value={newLicense.pin || ''} onChange={e => setNewLicense({...newLicense, pin: e.target.value})} /></div>
                            </div>
                            {isEditing && (<div className="p-3 bg-gray-50 rounded-lg border text-[10px] font-mono text-gray-400 flex justify-between items-center"><span>Machine ID: {newLicense.machineId || '-'}</span><button onClick={() => setNewLicense({...newLicense, lastReset: '', machineId: ''})} className="text-red-500 underline font-bold">기기 초기화</button></div>)}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">상태</label><select className="w-full border p-2 rounded text-sm" value={newLicense.status} onChange={e => setNewLicense({...newLicense, status: e.target.value as any})}><option value="ACTIVE">활성</option><option value="PENDING">대기</option><option value="EXPIRED">만료</option><option value="REVOKED">정지</option></select></div>
                                {newLicense.programId === PROGRAM_IDS.EZPRINTWORK ? (<div><label className="block text-xs font-bold text-gray-500 mb-1">요금제</label><select className="w-full border p-2 rounded text-sm bg-green-50 font-bold border-green-200" value={newLicense.plan || 'free'} onChange={e => setNewLicense({...newLicense, plan: e.target.value as any, productName: (PLAN_DEFS as any)[e.target.value].label})}>{Object.entries(PLAN_DEFS).map(([key, info]) => (<option key={key} value={key}>{info.label}</option>))}</select></div>) : (<div><label className="block text-xs font-bold text-gray-500 mb-1">결제 상태</label><select className="w-full border p-2 rounded text-sm" value={newLicense.paymentStatus} onChange={e => setNewLicense({...newLicense, paymentStatus: e.target.value as any})}><option value="PAID">결제 완료</option><option value="UNPAID">미결제</option><option value="FREE">무료</option></select></div>)}
                                {newLicense.programId === PROGRAM_IDS.EZPRINTWORK ? (<div><label className="block text-xs font-bold text-gray-500 mb-1">유효 기간</label><div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 font-bold h-[38px] flex items-center"><i className="fas fa-calendar-check mr-2"></i> 저장시 +1개월 갱신</div></div>) : (<div><label className="block text-xs font-bold text-gray-500 mb-1">유효 기간 ({newLicense.expiresAt ? new Date(newLicense.expiresAt).toLocaleDateString() : '평생'})</label><select className="w-full border p-2 rounded text-sm bg-amber-50 font-bold border-amber-200" value={selectedDuration} onChange={e => setSelectedDuration(e.target.value)}><option value="CURRENT">기존 유지</option><option value="14DAYS">+14일</option><option value="30DAYS">+30일</option><option value="1YEAR">+1년</option><option value="LIFETIME">평생</option></select></div>)}
                            </div>
                        </div>
                    )}
                    {modalType === 'sms' && (
                        <div className="space-y-4">
                            <div className="flex gap-2 mb-4 bg-gray-50 p-2 rounded-lg border">
                                <button onClick={() => applyTemplate('welcome')} className="flex-1 py-2 px-3 bg-indigo-600 text-white rounded font-bold text-xs shadow-sm hover:bg-indigo-700">발급 안내</button>
                                <button onClick={() => applyTemplate('upgrade')} className="flex-1 py-2 px-3 bg-orange-500 text-white rounded font-bold text-xs shadow-sm hover:bg-orange-600">업데이트</button>
                            </div>
                            <div><label className="block text-xs font-bold text-gray-500 mb-1">수신 번호</label><input type="text" className="w-full border p-2 rounded text-sm" value={smsTarget.contact} onChange={e => setSmsTarget({...smsTarget, contact: e.target.value})} /></div>
                            <div><label className="block text-xs font-bold text-gray-500 mb-1">내용</label><textarea className="w-full border p-2 rounded text-sm h-48 font-mono" value={smsTarget.content} onChange={e => setSmsTarget({...smsTarget, content: e.target.value})} /></div>
                        </div>
                    )}
                </div>
                <div className="mt-8 flex gap-3">
                    <button onClick={() => { setShowModal(false); if (modalOnly) { sessionStorage.removeItem('AUTO_CREATE_DATA'); sessionStorage.removeItem('RETURN_TO_REQUESTS'); window.dispatchEvent(new CustomEvent('REFRESH_DATA')); } }} className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold">취소</button>
                    <button onClick={modalType === 'sms' ? sendSms : handleSaveLicense} disabled={isLoading} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200">{isLoading ? '처리중...' : '저장하기'}</button>
                </div>
            </div>
        </div>
    );
  };

  if (modalOnly) return renderModal();

  return (
    <div className="flex flex-col h-full bg-gray-50 p-2 md:p-4 gap-4">
        <div className="flex gap-2 bg-white p-2 rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
            <button onClick={() => handleProgramChange(PROGRAM_IDS.EZIMPO)} className={`flex-1 min-w-[120px] py-2 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${currentProgramId === PROGRAM_IDS.EZIMPO ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}><i className="fas fa-print"></i> EzImpo 관리</button>
            <button onClick={() => handleProgramChange(PROGRAM_IDS.EZPRINTWORK)} className={`flex-1 min-w-[120px] py-2 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${currentProgramId === PROGRAM_IDS.EZPRINTWORK ? 'bg-green-600 text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}><i className="fas fa-file-invoice"></i> EzPrintWork 관리</button>
        </div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-white p-3 rounded-xl shadow-sm border border-gray-100">
            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg overflow-x-auto">
                <button onClick={() => setActiveTab('licenses')} className={`px-2.5 py-1 rounded-md font-bold text-xs ${activeTab === 'licenses' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}>정식 라이선스 ({countOfficial})</button>
                <button onClick={() => setActiveTab('trials')} className={`px-2.5 py-1 rounded-md font-bold text-xs ${activeTab === 'trials' ? 'bg-white shadow text-purple-600' : 'text-gray-500'}`}>체험판 ({countTrials})</button>
                <button onClick={() => setActiveTab('products')} className={`px-2.5 py-1 rounded-md font-bold text-xs ${activeTab === 'products' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}>제품 관리 ({countProducts})</button>
                <button onClick={() => setActiveTab('versions')} className={`px-2.5 py-1 rounded-md font-bold text-xs ${activeTab === 'versions' ? 'bg-white shadow text-orange-600' : 'text-gray-500'}`}>버전 관리</button>
            </div>
            <div className="flex gap-1.5 w-full md:w-auto">
                <input type="text" placeholder="검색..." className="pl-3 pr-3 py-1 border rounded-lg text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                <button onClick={() => { setModalType(activeTab === 'products' ? 'product' : 'license'); setIsEditing(false); setShowModal(true); }} className="bg-indigo-600 text-white px-3 py-1 rounded-lg font-bold text-xs">추가</button>
            </div>
        </div>
        <div className="flex-1 bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col min-h-0 relative">
            <div className="overflow-auto flex-1 h-full">
                {activeTab === 'products' ? (
                    <table className="w-full text-center"><thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0 shadow-sm z-10"><tr><th className="px-4 py-1 text-center">제품명</th><th className="px-4 py-1 text-center">버전</th><th className="px-4 py-1 text-center">가격</th><th className="px-4 py-1 text-center">관리</th></tr></thead><tbody className="divide-y divide-gray-100">{filteredProducts.map(p => (<tr key={p.id} className="hover:bg-gray-50"><td className="px-4 py-0.5 font-bold text-gray-800 text-center">{p.name}</td><td className="px-4 py-0.5 text-center">{p.version}</td><td className="px-4 py-0.5 text-gray-600 text-center">{p.price.toLocaleString()}원</td><td className="px-4 py-0.5 text-center"><button onClick={() => { setModalType('product'); setIsEditing(true); setNewProduct(p); setShowModal(true); }} className="text-gray-400 hover:text-indigo-600 mr-3"><i className="fas fa-edit"></i></button><button onClick={() => promptDelete('product', p.id, p.name)} className="text-gray-400 hover:text-red-600"><i className="fas fa-trash"></i></button></td></tr>))}</tbody></table>
                ) : activeTab === 'trials' ? (<RenderTable data={filteredActiveTrials} />) : activeTab === 'versions' ? (<div>버전 관리 탭</div>) : (<RenderTable data={filteredOfficial} />)}
            </div>
        </div>
        {renderModal()}
        {showConfirmModal && itemToDelete && (
             <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000] p-4" onClick={() => setShowConfirmModal(false)}>
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
                   <h3 className="text-lg font-bold">삭제 확인</h3>
                   <p className="py-4 text-sm">정말로 "{itemToDelete.name}"을(를) 삭제하시겠습니까?</p>
                   <div className="flex gap-3"><button onClick={() => setShowConfirmModal(false)} className="flex-1 bg-gray-100 py-2 rounded-lg text-sm">취소</button><button onClick={confirmDelete} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm">삭제</button></div>
                </div>
             </div>
        )}
    </div>
  );
};

export default LicenseManager;
