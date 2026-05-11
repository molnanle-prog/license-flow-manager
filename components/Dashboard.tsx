import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Product, License, Customer, LicenseStatus, LicenseType, Installation } from '../types';
import { getAllProducts, getAllLicenses, getAllCustomers, getAllInstallations, getAppConfig } from '../services/storageService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalRevenue: 0,
    activeCount: 0,
    customerCount: 0,
    expiredCount: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSheetConnected, setIsSheetConnected] = useState(true);
  const [configEmail, setConfigEmail] = useState('');

  // [Helper] 문자열 정규화 (LicenseManager와 동일한 로직 사용)
  const normalize = (s: any) => String(s || '').trim().replace(/[\s-]/g, '').toLowerCase();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      const config = getAppConfig();
      setConfigEmail(config.clientEmail);
      
      // Check if at least one program is connected
      const hasConnectedProgram = config.programs.some(p => !!p.sheetId);
      if (!hasConnectedProgram) {
          setIsSheetConnected(false);
          setLoading(false);
          return;
      }
      setIsSheetConnected(true);

      // Safety timeout
      const timeout = setTimeout(() => {
          setLoading(false);
      }, 30000);

      try {
          // 모든 프로그램의 데이터 병렬 로드
          const [products, rawLicenses, customers, installations] = await Promise.all([
             getAllProducts(),
             getAllLicenses(),
             getAllCustomers(),
             getAllInstallations()
          ]);
          clearTimeout(timeout);

          // =====================================================================================
          // 1. 데이터 정제 및 중복 제거 (LicenseManager와 동일 로직)
          // =====================================================================================
          
          // 1-1. 라이선스 중복 제거 (키 기준)
          const seenKeys = new Set<string>();
          const uniqueLicenses = rawLicenses.filter(license => {
              if (license.key && license.key.trim() !== '') {
                  const upperKey = license.key.toUpperCase();
                  if (upperKey.includes('TEST') || upperKey.includes('TRIAL')) return true;
                  
                  if (seenKeys.has(license.key)) return false;
                  seenKeys.add(license.key);
              }
              return true;
          });

          // 1-2. 정식 라이선스 vs 체험판 구분
          const isTrial = (l: License) => {
              if (l.type === LicenseType.TRIAL) return true;
              if (l.key) {
                  const k = l.key.toLowerCase();
                  if (k.includes('test') || k.includes('trial')) return true;
              }
              return false;
          };

          const officialLicenses = uniqueLicenses.filter(l => !isTrial(l));
          const sheetTrialLicenses = uniqueLicenses.filter(l => isTrial(l));

          // 1-3. Ghost Trial (로그상 체험판) 집계
          const sortedInstallations = [...installations].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          const ghostTrialLogs = sortedInstallations.filter(log => log.actionType === 'TRIAL_ACTIVATED' && log.machineId);
          const uniqueGhostTrials: Installation[] = [];
          const seenGhosts = new Set<string>();

          ghostTrialLogs.forEach(log => {
              const mid = normalize(log.machineId);
              if (mid.length <= 5) return;
              if (seenGhosts.has(mid)) return;

              // 이미 시트에 등록된 체험판이 있는지 확인 (중복 집계 방지)
              const hasRealTrial = uniqueLicenses.some(l => isTrial(l) && normalize(l.machineId) === mid);
              if (hasRealTrial) return;

              seenGhosts.add(mid);
              uniqueGhostTrials.push(log);
          });

          // 1-4. Identify Active vs Converted Ghosts for Stats
          // (LicenseManager shows converted ghosts in list, but Stats should probably treat them carefully)
          // For Total List Count matching: We include converted ghosts in the chart data.
          // For "Active Licenses" Stat: We exclude converted ghosts (because they are likely Official now).
          
          let activeGhostCount = 0;
          uniqueGhostTrials.forEach(g => {
              const mid = normalize(g.machineId);
              const isConverted = officialLicenses.some(l => normalize(l.machineId) === mid);
              if (!isConverted) activeGhostCount++;
          });


          // 1-5. 고객 수 산출 (Customers 시트 + Licenses 기반 중복 제거)
          const uniqueCustomerKeys = new Set<string>();
          
          // Licenses 기반 고객 추출
          uniqueLicenses.forEach(l => {
              const name = normalize(l.userName);
              const company = normalize(l.companyName);
              const contact = normalize(l.contactInfo);
              
              // 이름+회사 또는 이름+연락처 조합으로 유니크 키 생성
              if (name && company) uniqueCustomerKeys.add(`${name}|${company}`);
              else if (name && contact) uniqueCustomerKeys.add(`${name}|${contact}`);
              else if (name) uniqueCustomerKeys.add(name);
              else if (company) uniqueCustomerKeys.add(company);
          });

          // Customers 시트 기반 고객 추가
          customers.forEach(c => {
              const name = normalize(c.name);
              const company = normalize(c.company);
              const email = normalize(c.email);
              
              if (name && company) uniqueCustomerKeys.add(`${name}|${company}`);
              else if (name && email) uniqueCustomerKeys.add(`${name}|${email}`);
              else if (name) uniqueCustomerKeys.add(name);
          });

          const finalCustomerCount = Math.max(customers.length, uniqueCustomerKeys.size);

          // =====================================================================================
          // 2. 통계 (Stats) 계산
          // =====================================================================================
          
          // 매출: 정식 라이선스 중 PAID 상태만 계산
          const totalRevenue = officialLicenses.reduce((acc, lic) => {
              if (lic.paymentStatus !== 'PAID') return acc;
              const prod = products.find(p => p.id === lic.productId);
              return acc + (prod ? prod.price : 0);
          }, 0);

          // 활성: 정식(ACTIVE) + 시트체험(ACTIVE) + 로그체험(순수 Active만)
          const activeCount = 
              officialLicenses.filter(l => l.status === LicenseStatus.ACTIVE).length + 
              sheetTrialLicenses.filter(l => l.status === LicenseStatus.ACTIVE).length + 
              activeGhostCount;

          const expiredCount = officialLicenses.filter(l => l.status === LicenseStatus.EXPIRED).length;

          setStats({
            totalRevenue,
            activeCount,
            customerCount: finalCustomerCount,
            expiredCount
          });

          // =====================================================================================
          // 3. 차트 데이터 (Chart Data) 생성 - Robust Product Matching
          // =====================================================================================
          
          const statsMap = new Map<string, { 
              name: string; 
              paid: number; 
              unpaid: number; 
              free: number;
              isConfigured: boolean; 
          }>();

          // Initialize with configured products
          products.forEach(p => {
              statsMap.set(p.id, { 
                  name: p.name, 
                  paid: 0, 
                  unpaid: 0, 
                  free: 0, 
                  isConfigured: true 
              });
          });
          
          // Helper to find key
          const findProductKey = (l: { productId?: string, productName?: string }) => {
              if (l.productId && statsMap.has(l.productId)) return l.productId;
              
              const lName = normalize(l.productName);
              for (const [key, val] of statsMap.entries()) {
                  if (val.isConfigured) {
                      const pName = normalize(val.name);
                      if (lName === pName || (lName.length > 2 && (lName.includes(pName) || pName.includes(lName)))) {
                          return key;
                      }
                  }
              }
              return l.productId || l.productName || 'Unknown Product';
          };
          
          const getOrCreateEntry = (key: string, nameFallback: string) => {
              if (statsMap.has(key)) return statsMap.get(key)!;
              const entry = { name: nameFallback, paid: 0, unpaid: 0, free: 0, isConfigured: false };
              statsMap.set(key, entry);
              return entry;
          };

          // Aggregate Official
          officialLicenses.forEach(l => {
              const key = findProductKey(l);
              const entry = getOrCreateEntry(key, l.productName || 'Unknown');
              
              if (l.paymentStatus === 'PAID') entry.paid++;
              else if (l.paymentStatus === 'FREE') entry.free++;
              else entry.unpaid++;
          });

          // Aggregate Sheet Trials
          sheetTrialLicenses.forEach(l => {
              const key = findProductKey(l);
              const entry = getOrCreateEntry(key, l.productName || 'Unknown');
              entry.free++;
          });

          // Aggregate Ghosts
          uniqueGhostTrials.forEach(g => {
              const key = findProductKey(g);
              const entry = getOrCreateEntry(key, g.productName || 'Unknown');
              entry.free++;
          });
          
          const data = Array.from(statsMap.values()).map(v => ({
              name: v.name,
              paid: v.paid,
              unpaid: v.unpaid,
              free: v.free,
              total: v.paid + v.unpaid + v.free,
              isConfigured: v.isConfigured
          })).sort((a, b) => b.total - a.total)
            .filter(item => item.total > 0 || item.isConfigured); // Show configured even if 0, show others only if > 0

          setChartData(data);

      } catch (e) {
          console.error("Dashboard load failed", e);
      } finally {
          setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <div className="p-10 text-center text-gray-500"><i className="fas fa-spinner fa-spin mr-2"></i> 데이터 불러오는 중...</div>;
  }

  // 시트 미연결 시 안내 화면
  if (!isSheetConnected) {
      return (
        <div className="flex flex-col items-center justify-center h-[80vh] animate-fade-in">
            <div className="bg-white p-8 rounded-2xl shadow-xl border border-indigo-100 max-w-2xl w-full text-center">
                <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fas fa-database text-3xl text-indigo-600"></i>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">데이터 저장소(구글 시트)가 없습니다!</h2>
                <p className="text-gray-600 mb-8">
                    인증(Key)은 성공했지만, 데이터를 저장할 엑셀 파일이 연결되지 않았습니다.<br/>
                    아래 순서대로 진행하면 1분 안에 완료됩니다.
                </p>
                <button 
                    onClick={() => navigate('/settings')}
                    className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all transform hover:-translate-y-1"
                >
                    환경 설정으로 이동하기 <i className="fas fa-arrow-right ml-2"></i>
                </button>
            </div>
        </div>
      );
  }

  return (
    <div className="space-y-6 animate-fade-in h-full">
      <h2 className="text-2xl font-bold text-gray-800">대시보드 개요</h2>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <i className="fas fa-won-sign text-xl"></i>
          </div>
          <div>
            <p className="text-sm text-gray-500">총 수익 (결제완료)</p>
            <p className="text-2xl font-bold text-gray-800">{stats.totalRevenue.toLocaleString()}원</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-lg">
            <i className="fas fa-check-circle text-xl"></i>
          </div>
          <div>
            <p className="text-sm text-gray-500">활성 라이선스</p>
            <p className="text-2xl font-bold text-gray-800" title="정식 활성 + 체험판(순수)">{stats.activeCount}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-purple-100 text-purple-600 rounded-lg">
            <i className="fas fa-users text-xl"></i>
          </div>
          <div>
            <p className="text-sm text-gray-500">고객 수</p>
            <p className="text-2xl font-bold text-gray-800">{stats.customerCount}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg">
            <i className="fas fa-clock text-xl"></i>
          </div>
          <div>
            <p className="text-sm text-gray-500">만료됨</p>
            <p className="text-2xl font-bold text-gray-800">{stats.expiredCount}</p>
          </div>
        </div>
      </div>

      {/* Chart - Stacked Bar Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">제품별 판매 및 체험 현황</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6b7280', fontSize: 12}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#6b7280', fontSize: 12}} />
              <Tooltip 
                cursor={{fill: '#f3f4f6'}} 
                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} 
                formatter={(value: number, name: string) => {
                    if (name === 'paid') return [value, '결제 완료'];
                    if (name === 'unpaid') return [value, '미입금'];
                    if (name === 'free') return [value, '무료/체험'];
                    return [value, name];
                }}
              />
              <Legend 
                wrapperStyle={{paddingTop: '20px'}} 
                formatter={(value) => {
                    if (value === 'paid') return '결제 완료';
                    if (value === 'unpaid') return '미입금';
                    if (value === 'free') return '무료/체험';
                    return value;
                }}
              />
              {/* Stacked Bars: Paid (Blue), Unpaid (Red), Free/Trial (Green) */}
              <Bar dataKey="paid" stackId="a" fill="#4f46e5" name="paid" radius={[0, 0, 0, 0]} barSize={50} />
              <Bar dataKey="unpaid" stackId="a" fill="#ef4444" name="unpaid" radius={[0, 0, 0, 0]} barSize={50} />
              <Bar dataKey="free" stackId="a" fill="#10b981" name="free" radius={[4, 4, 0, 0]} barSize={50} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;