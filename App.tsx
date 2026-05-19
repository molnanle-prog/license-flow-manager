import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, recordInstallLog } from './firebase';
import Dashboard from './components/Dashboard';
import LicenseManager from './components/LicenseManager';
import IntegrationGuide from './components/IntegrationGuide';
import DepositManager from './components/DepositManager';
import RequestManager from './components/RequestManager';
import LicenseDelivery from './components/LicenseDelivery';
import InstallLogs from './components/InstallationList';
import Settings from './components/Settings';
import DebugLogViewer from './components/DebugLogViewer';
import ErrorBoundary from './components/ErrorBoundary';
import { getAppConfig, setCurrentProgramId, getLicenseRequests } from './services/storageService';
import { AppConfig, ProgramConfig, RequestStatus } from './types';
import { playNotificationSound, unlockAudioContext } from './services/soundService';

const SidebarLink: React.FC<{ to: string; icon: string; label: string; badge?: number }> = ({ to, icon, label, badge }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link 
      to={to} 
      className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
        isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <div className="flex items-center space-x-3">
        <i className={`fas ${icon} w-5 text-center`}></i>
        <span className="font-medium">{label}</span>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
          {badge}
        </span>
      )}
    </Link>
  );
};

// Main Layout Component to access useLocation
const MainLayout: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const location = useLocation(); 
  
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Notification State
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // [FIX] ref로 커런트 값을 저장하여 checkRequests 클로저 문제 해결
  const pendingCountRef = useRef(0);
  
  useEffect(() => {
    const handleRefresh = () => setRefreshKey(prev => prev + 1);
    window.addEventListener('REFRESH_DATA', handleRefresh);
    return () => window.removeEventListener('REFRESH_DATA', handleRefresh);
  }, []);
  
  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        recordInstallLog(u.uid);
        
        // Ensure user document exists in Firestore
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              role: u.email === 'molnanle@gmail.com' ? 'admin' : 'user',
              createdAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error("Error creating user document:", e);
        }
      } else {
        recordInstallLog();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };
  
  // Effect to unlock audio context on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
        unlockAudioContext();
        // Remove the listeners after the first interaction to avoid running it multiple times
        window.removeEventListener('click', handleFirstInteraction);
        window.removeEventListener('keydown', handleFirstInteraction);
        window.removeEventListener('touchstart', handleFirstInteraction);
    };

    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    window.addEventListener('touchstart', handleFirstInteraction);

    return () => {
        // Cleanup listeners when the component unmounts
        window.removeEventListener('click', handleFirstInteraction);
        window.removeEventListener('keydown', handleFirstInteraction);
        window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // Polling logic to check requests
  // [FIX] useRef를 통해 클로저 문제 해결 - 모든 콜백에서 최신값 접근 가능
  const checkRequests = async () => {
      try {
          const config = getAppConfig();
          // [FIX] 모든 프로그램의 대기 요청을 통합 확인 (getAllLicenseRequests 대신 단일 프로그램 요청만 확인하던 기존 로직 유지)
          const currentProgram = config.programs.find(p => p.id === config.currentProgramId);
          if (!currentProgram) return;

          const requests = await getLicenseRequests(false, currentProgram.programId);
          const pending = requests.filter(r => r.status === RequestStatus.PENDING || !r.status).length;
          
          const prev = pendingCountRef.current; // [FIX] ref로 클로저 문제 해결
          if (pending > 0 && pending > prev) { // 실제로 새로운 요청이 늘어난 경우만 알림
             playNotificationSound();
             setShowToast(true);
          }
          pendingCountRef.current = pending; // [FIX] ref도 함께 업데이트
          setPendingRequestCount(pending);
      } catch (e) {
          console.error("Failed to check requests", e);
      }
  };

  // 1. Initial & Interval Polling (5초마다 데이터 확인)
  useEffect(() => {
    checkRequests(); 
    const interval = setInterval(checkRequests, 5000); 
    return () => clearInterval(interval);
  }, []);

  // [FIX] REQUEST_PROCESSED 이벤트 수신: 승인 즉시 카운트 갱신 (하위 컴포넌트에서 이벤트 발사함)
  useEffect(() => {
      const handleProcessed = () => {
          // 즉시 카운트 -1 (업데이트 전 기다리지 않고 즉시 반영)
          setPendingRequestCount(prev => {
              const next = Math.max(0, prev - 1);
              pendingCountRef.current = next;
              return next;
          });
          setShowToast(false); // 토스트 즉시 숨김
      };
      window.addEventListener('REQUEST_PROCESSED', handleProcessed);
      return () => window.removeEventListener('REQUEST_PROCESSED', handleProcessed);
  }, []);

  // 2. Persistent Alert Loop (대기 요청이 있으면 30초마다 다시 알림 - 기존 15초에서 증가)
  useEffect(() => {
      let alertInterval: ReturnType<typeof setInterval> | null = null;

      if (pendingRequestCount > 0) {
          alertInterval = setInterval(() => {
              // [FIX] 실제 ref 값을 확인하여 0이 되어있는데 인터벌이 놓치고 울리는 현상 방지
              if (pendingCountRef.current > 0) {
                  playNotificationSound();
                  setShowToast(true);
              }
          }, 30000); // 30초로 늘려서 과다한 알림 방지
      }

      return () => {
          if (alertInterval) clearInterval(alertInterval);
      };
  }, [pendingRequestCount]);

  // Toast Auto Hide
  useEffect(() => {
      if (showToast) {
          const timer = setTimeout(() => setShowToast(false), 5000);
          return () => clearTimeout(timer);
      }
  }, [showToast]);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden relative">
        
        {/* Hover Trigger Area (Left edge) - Increased width for better responsiveness */}
        <div 
          className="fixed inset-y-0 left-0 w-8 z-[60] cursor-pointer"
          onMouseEnter={() => setIsSidebarHovered(true)}
        ></div>

        {/* Persistent Toast Notification */}
        {showToast && pendingRequestCount > 0 && (
            <div className="fixed top-6 right-6 z-[100] animate-bounce-in cursor-pointer" onClick={() => setShowToast(false)}>
                <div className="bg-white/90 backdrop-blur-md border border-red-200 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4">
                    <div className="bg-red-500 text-white w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl shadow-lg animate-pulse">
                        {pendingRequestCount}
                    </div>
                    <div>
                        <h4 className="font-bold text-gray-900 text-lg">새로운 라이선스 요청</h4>
                        <p className="text-gray-500 text-sm font-medium">실시간 대기 중인 요청이 있습니다.</p>
                    </div>
                    <Link to="/requests" className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-600 transition-colors shadow-md">
                        즉시 확인
                    </Link>
                </div>
            </div>
        )}
        
        {/* Sidebar */}
        <aside 
          className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900/95 backdrop-blur-xl text-white transform transition-all duration-500 ease-in-out shadow-[0_0_40px_rgba(0,0,0,0.5)] border-r border-white/10 ${mobileMenuOpen || isSidebarHovered ? 'translate-x-0' : '-translate-x-full'}`}
          onMouseEnter={() => setIsSidebarHovered(true)}
          onMouseLeave={() => setIsSidebarHovered(false)}
        >
          <div className="flex items-center p-8 border-b border-white/5 bg-gradient-to-r from-indigo-600/20 to-transparent">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mr-4 shadow-lg shadow-indigo-500/20">
              <i className="fas fa-rocket text-white text-lg"></i>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">LicenseFlow</h1>
              <p className="text-[10px] text-indigo-300 font-bold tracking-widest uppercase opacity-70">Management Pro <span className="ml-2 text-white/50 lowercase">v1.0.0</span></p>
            </div>
          </div>



          <nav className="p-6 space-y-3">
            <SidebarLink to="/" icon="fa-th-large" label="라이선스 관리" />
            <SidebarLink to="/requests" icon="fa-bell" label="라이선스 요청" badge={pendingRequestCount} />
            <SidebarLink to="/delivery" icon="fa-paper-plane" label="라이선스 전송" />
            <div className="h-px bg-white/5 my-4 mx-2"></div>
            <SidebarLink to="/dashboard" icon="fa-chart-line" label="성능 대시보드" />
            <SidebarLink to="/installations" icon="fa-terminal" label="애플리케이션 로그" />
            <SidebarLink to="/debug-logs" icon="fa-bug" label="시스템 디버그 로그" />
            <SidebarLink to="/integrate" icon="fa-plug" label="API 연동 가이드" />
            <SidebarLink to="/settings" icon="fa-sliders-h" label="시스템 설정" />
          </nav>

          <div className="absolute bottom-0 w-full p-8 border-t border-white/5 bg-slate-900/50">
             <div className="flex items-center justify-between">
               <div className="flex items-center space-x-4">
                 <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center overflow-hidden border border-white/10">
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt="profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <i className="fas fa-user text-slate-400"></i>
                      )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-slate-900"></div>
                 </div>
                 <div className="overflow-hidden">
                   <p className="text-white font-bold text-sm truncate w-28">{user?.displayName || '방문자'}</p>
                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{user?.email === 'molnanle@gmail.com' ? 'Administrator' : 'General User'}</p>
                 </div>
               </div>
               <button 
                 onClick={user ? handleLogout : handleLogin}
                 className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-indigo-600 transition-all duration-300 group"
                 title={user ? "로그아웃" : "로그인"}
               >
                 <i className={`fas ${user ? 'fa-sign-out-alt' : 'fa-power-off'} group-hover:scale-110 transition-transform`}></i>
               </button>
             </div>
          </div>
        </aside>

        {/* Overlay for mobile/hover */}
        {(mobileMenuOpen || isSidebarHovered) && (
          <div 
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => {
                setMobileMenuOpen(false);
                setIsSidebarHovered(false);
            }}
            onMouseEnter={() => setIsSidebarHovered(false)}
          ></div>
        )}


        {/* Main Content */}
        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          {/* Header */}
          <header className="bg-white border-b border-gray-200 shrink-0 flex flex-col">
            <div className="h-16 flex items-center justify-between px-6 lg:px-10 relative">
              <button 
                className="lg:hidden text-gray-500 hover:text-gray-700"
                onClick={() => setMobileMenuOpen(true)}
              >
                <i className="fas fa-bars text-xl"></i>
              </button>
              
              <div className="flex-1"></div> {/* Spacer to keep flex balance */}
              
              <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10">
                <div className="bg-gray-100 p-0.5 rounded-xl flex items-center shadow-inner border border-gray-200/50">
                  <button 
                    onClick={() => {
                        setCurrentProgramId('ezimpo-program');
                        window.location.reload();
                    }}
                    className={`px-6 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-2 ${getAppConfig().currentProgramId === 'ezimpo-program' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <i className="fas fa-print"></i> EzImpo 관리
                  </button>
                  <button 
                    onClick={() => {
                        setCurrentProgramId('ezprintwork-program');
                        window.location.reload();
                    }}
                    className={`px-6 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-2 ${getAppConfig().currentProgramId === 'ezprintwork-program' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <i className="fas fa-file-invoice"></i> EzPrintWork 관리
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-4 ml-auto">
                <button 
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
                  }} 
                  className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-indigo-100 hover:text-indigo-600 flex items-center justify-center transition-colors"
                  title="데이터 새로고침"
                >
                  <i className="fas fa-sync-alt"></i>
                </button>
                {pendingRequestCount > 0 && (
                   <div className="hidden md:flex items-center px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs font-bold border border-red-100 animate-pulse">
                      <i className="fas fa-bell mr-2"></i> {pendingRequestCount}개의 대기 요청
                   </div>
                )}
                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full border border-indigo-100">
                  PRO 버전
                </span>
                <button className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors relative">
                  <i className="fas fa-bell"></i>
                  {pendingRequestCount > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
                </button>
              </div>
            </div>
          </header>

          {/* Scrollable Content Area */}
          <div className={`flex-1 ${['/installations', '/requests', '/delivery', '/deposits', '/debug-logs'].includes(location.pathname) ? 'overflow-hidden flex flex-col' : 'overflow-auto'} p-4 lg:p-6`}>
            {/* [NEW] 글로벌 라이선스 모달 레이어 - 배경 유지용 */}
            {sessionStorage.getItem('AUTO_CREATE_DATA') && (
                <LicenseManager modalOnly={true} />
            )}
            
            <div className={`w-full ${['/', '/installations', '/requests', '/delivery', '/deposits', '/debug-logs'].includes(location.pathname) ? 'h-full flex flex-col' : ''} px-2 mx-auto`}>
              <Routes>
                <Route path="/" element={<LicenseManager />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/requests" element={<RequestManager />} />
                <Route path="/deposits" element={<DepositManager />} />
                <Route path="/installations" element={<InstallLogs />} />
                <Route path="/delivery" element={<LicenseDelivery />} />
                <Route path="/debug-logs" element={<DebugLogViewer />} />
                <Route path="/integrate" element={<IntegrationGuide />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </div>
          
        </main>
      </div>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <HashRouter>
        <MainLayout />
      </HashRouter>
    </ErrorBoundary>
  );
};

export default App;
