
import React, { useState, useEffect } from 'react';
import { License, Product, Customer, LicenseRequest } from '../types';
import { getLicenses, getProducts, getLicenseRequests, getAppConfig } from '../services/storageService';
import { generateApprovalMessage, generateLicenseEmail } from '../services/geminiService';
import { sendLicenseEmail } from '../services/emailService';

const isEmail = (contact: string): boolean => contact.includes('@');
// [FIX] localStorage 키 사용 (영구 저장)
const SMS_HISTORY_KEY = 'SMS_HISTORY_V1';
const EMAIL_HISTORY_KEY = 'EMAIL_HISTORY_V1';

const LicenseDelivery: React.FC = () => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'sms' | 'email' | null>(null);
  const [modalContent, setModalContent] = useState({ title: '', body: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedLicenseId, setSelectedLicenseId] = useState<string | null>(null);
  const [selectedLicenseContact, setSelectedLicenseContact] = useState<string | null>(null);
  const [selectedLicenseEmail, setSelectedLicenseEmail] = useState<string | null>(null);

  // Email Sending State
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSendStatus, setEmailSendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');
  
  // [NEW] History States (ID -> Timestamp)
  const [smsHistory, setSmsHistory] = useState<Record<string, number>>({});
  const [emailHistory, setEmailHistory] = useState<Record<string, number>>({});

  const appConfig = getAppConfig();

  useEffect(() => {
    // Load histories from localStorage
    try {
        const savedSms = localStorage.getItem(SMS_HISTORY_KEY);
        if (savedSms) setSmsHistory(JSON.parse(savedSms));
        
        const savedEmail = localStorage.getItem(EMAIL_HISTORY_KEY);
        if (savedEmail) setEmailHistory(JSON.parse(savedEmail));
    } catch (e) {
        console.error("History load failed", e);
    }
    loadData();
  }, []);

  const updateSmsHistory = (licenseId: string) => {
      setSmsHistory(prev => {
          const next = { ...prev, [licenseId]: Date.now() };
          localStorage.setItem(SMS_HISTORY_KEY, JSON.stringify(next));
          return next;
      });
  };

  const updateEmailHistory = (licenseId: string) => {
      setEmailHistory(prev => {
          const next = { ...prev, [licenseId]: Date.now() };
          localStorage.setItem(EMAIL_HISTORY_KEY, JSON.stringify(next));
          return next;
      });
  };

  const loadData = async () => {
    setLoading(true);
    const [lics, prods, reqs] = await Promise.all([getLicenses(), getProducts(), getLicenseRequests()]);
    
    // Process licenses to extract contact info from name if missing
    const processedLics = lics.map(l => {
        let rawName = l.userName || '';
        let contact = l.contactInfo || '';

        const hasValidContact = contact && (isEmail(contact) || contact.replace(/[^0-9]/g, '').length >= 10);
        
        if (!hasValidContact) {
            const phoneRegex = /(01[016789][-\s.]?\d{3,4}[-\s.]?\d{4})/g;
            const phoneMatch = rawName.match(phoneRegex);
            if (phoneMatch && phoneMatch.length > 0) {
                const extracted = phoneMatch[0].replace(/[\s.]/g, '-');
                if (!extracted.includes('-') && extracted.length === 11) {
                     contact = extracted.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
                } else {
                     contact = extracted;
                }
            }
        }

        let cleanName = rawName.replace(/[(\[]?\s*01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\s*[)\]]?/g, '');
        cleanName = cleanName.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').trim();
        
        if (contact && !isEmail(contact)) {
             const simpleContact = contact.replace(/-/g, '');
             cleanName = cleanName.replace(contact, '').trim();
             cleanName = cleanName.replace(simpleContact, '').trim();
        }

        return {
            ...l,
            userName: cleanName || rawName,
            contactInfo: contact
        };
    });

    // Enhanced Sorting: Newest first, handle missing dates
    const filteredLics = processedLics
      .filter(l => l.userName && l.key)
      .sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return (timeB || 0) - (timeA || 0);
      });
      
    setLicenses(filteredLics);
    setProducts(prods);
    setRequests(reqs);
    setLoading(false);
  };

  const contactMap = new Map<string, string>();
  requests.forEach(req => {
    if (req.id && req.contact) {
      contactMap.set(req.id, req.contact);
    }
  });

  const getDownloadLink = (productName: string) => {
    const normalizedName = productName.toLowerCase().replace(/\s/g, '');
    if (normalizedName.includes('ezprintwork')) {
        return 'https://naver.me/G9pYj8or';
    }
    return appConfig.downloadLink || 'https://naver.me/Fm3SGglJ';
  };

  const getResolvedProduct = (license: License): Product => {
      const found = products.find(p => p.id === license.productId);
      if (found) return found;
      const fallbackName = license.productName && license.productName !== 'undefined' ? license.productName : 'EzImpo';
      return {
          id: license.productId || 'fallback-id',
          name: fallbackName,
          version: license.version || '1.0',
          price: 0,
          description: 'Fallback Product'
      };
  };

  // Helper for date/time formatting
  const formatDateTime = (timestamp?: number) => {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${min}`;
  };

  // Helper for "NEW" badge logic
  const getRecency = (dateStr?: string) => {
      if (!dateStr) return null;
      const created = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - created.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      
      if (diffHours < 1) return 'JUST'; // 1시간 이내: 방금
      if (diffHours < 24) return 'NEW'; // 24시간 이내: NEW
      return null;
  };

  const handleSmsClick = async (license: License) => {
    const product = getResolvedProduct(license);
    
    let contact: string | null = null;
    const potentialContact1 = license.contactInfo;
    const potentialContact2 = license.requestId ? contactMap.get(license.requestId) : null;

    if (potentialContact1 && !isEmail(potentialContact1)) {
      contact = potentialContact1;
    } else if (potentialContact2 && !isEmail(potentialContact2)) {
      contact = potentialContact2;
    }
    
    setSelectedLicenseId(license.id);
    setSelectedLicenseContact(contact);

    setShowModal(true);
    setModalType('sms');
    setIsGenerating(true);
    setModalContent({ title: '문자/카톡 메시지', body: 'AI가 고객님께 보낼 메시지를 작성하고 있습니다. 잠시만 기다려주세요...' });

    const isPreActivated = !!license.machineId;
    const downloadLink = getDownloadLink(product.name);

    const message = await generateApprovalMessage(
        license.userName || '고객님', 
        product.name, 
        license.key, 
        isPreActivated,
        downloadLink
    );
    
    setModalContent({ title: '문자/카톡 메시지', body: message });
    setIsGenerating(false);
  };

  const handleEmailClick = async (license: License) => {
    const product = getResolvedProduct(license);
    
    let email: string | null = null;
    const potentialContact1 = license.contactInfo;
    const potentialContact2 = license.requestId ? contactMap.get(license.requestId) : null;
    
    if (potentialContact1 && isEmail(potentialContact1)) {
      email = potentialContact1;
    } else if (potentialContact2 && isEmail(potentialContact2)) {
      email = potentialContact2;
    }

    setSelectedLicenseId(license.id);
    setSelectedLicenseEmail(email);
    setEmailSendStatus('idle');
    setEmailError('');

    setShowModal(true);
    setModalType('email');
    setIsGenerating(true);
    setModalContent({ title: '이메일 생성 중...', body: 'AI가 이메일 초안을 작성하고 있습니다. 잠시만 기다려주세요...' });
    
    const customer: Customer = {
        id: '', name: license.userName || '고객님', company: license.companyName,
        email: email || '', createdAt: ''
    };
    
    const downloadLink = getDownloadLink(product.name);

    const emailBody = await generateLicenseEmail(
        customer, 
        product, 
        license,
        downloadLink
    );
    
    setModalContent({ title: `[${product.name}] 라이선스 발급 안내`, body: emailBody });
    setIsGenerating(false);
  };
  
  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    alert(`${type} 복사 완료!`);
  };

  const handleSendSms = () => {
    if (!selectedLicenseContact) return;
    try {
      const phoneNumber = selectedLicenseContact.replace(/[^0-9+]/g, '');
      if (!phoneNumber) {
        alert("유효한 전화번호가 아닙니다.");
        return;
      }
      const messageBody = encodeURIComponent(modalContent.body);
      const smsLink = `sms:${phoneNumber}?&body=${messageBody}`;
      window.open(smsLink, '_blank');
      if (selectedLicenseId) {
        updateSmsHistory(selectedLicenseId);
      }
      setShowModal(false);
      alert("문자 앱이 열립니다. 전송 후 창을 닫아주세요.");
    } catch (e) {
      console.error("SMS link generation failed:", e);
      alert("SMS 링크를 여는 데 실패했습니다.");
    }
  };

  const handleSendEmail = async () => {
    if (!selectedLicenseEmail || !selectedLicenseId) return;
    
    setIsSendingEmail(true);
    setEmailSendStatus('idle');
    setEmailError('');
    try {
      await sendLicenseEmail(
        appConfig,
        selectedLicenseEmail,
        modalContent.title,
        modalContent.body
      );
      setEmailSendStatus('success');
      updateEmailHistory(selectedLicenseId);
      setTimeout(() => {
        setShowModal(false);
      }, 1500);
    } catch (error: any) {
      setEmailSendStatus('error');
      setEmailError(error.message);
    } finally {
      setIsSendingEmail(false);
    }
  };
  
  const handleOpenInNaverMail = () => {
    if (!selectedLicenseEmail) {
      alert("고객 이메일 주소가 없습니다.");
      return;
    }
    const to = selectedLicenseEmail;
    const subject = encodeURIComponent(modalContent.title);
    const body = encodeURIComponent(modalContent.body);
    const mailtoLink = `https://mail.naver.com/v2/writes/new?to=${to}&title=${subject}&body=${body}`;
    window.open(mailtoLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col gap-1 animate-fade-in h-full">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 py-1.5 px-4">
        <h2 className="text-base font-bold text-gray-800 flex items-center">
          <i className="fas fa-paper-plane text-indigo-500 mr-3"></i>라이선스 전송 및 안내
        </h2>
        <p className="text-[10px] text-gray-500">
          최근 발급된 라이선스가 상단에 표시됩니다. 생성된 지 24시간 이내인 항목은 <span className="text-orange-600 font-bold">NEW</span> 표시가 나타납니다.
        </p>
      </div>

      {/* License List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-gray-700">전송 대기 및 내역</h3>
          <button onClick={loadData} className="text-xs text-gray-500 hover:text-indigo-600 font-bold">
            <i className="fas fa-sync-alt mr-1"></i>새로고침
          </button>
        </div>
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="text-center py-20 text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i> 목록을 불러오는 중...
            </div>
          ) : licenses.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              발급 내역이 없습니다.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-2 py-0.5 font-medium text-center">최근 전송</th>
                  <th className="px-2 py-0.5 font-medium">고객 / 회사</th>
                  <th className="px-2 py-0.5 font-medium">제품</th>
                  <th className="px-2 py-0.5 font-medium">라이선스 키</th>
                  <th className="px-2 py-0.5 font-medium">연락처 (요청)</th>
                  <th className="px-2 py-0.5 font-medium text-center">전송 상태</th>
                  <th className="px-2 py-0.5 font-medium text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {licenses.map(license => {
                  const product = getResolvedProduct(license);
                  const contact = license.contactInfo || (license.requestId ? contactMap.get(license.requestId) : null);
                  
                  const smsTime = smsHistory[license.id];
                  const emailTime = emailHistory[license.id];
                  
                  const lastSentTime = Math.max(smsTime || 0, emailTime || 0);
                  
                  const smsDate = smsTime ? formatDateTime(smsTime) : null;
                  const emailDate = emailTime ? formatDateTime(emailTime) : null;

                  const recency = getRecency(license.createdAt);

                  return (
                    <tr key={license.id} className={`hover:bg-gray-50 transition-colors ${recency === 'JUST' ? 'bg-yellow-50/50' : ''}`}>
                      <td className="px-2 py-0.5 text-center">
                        {lastSentTime > 0 ? (
                            <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                {formatDateTime(lastSentTime)}
                            </span>
                        ) : (
                            <span className="text-gray-300 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="px-2 py-0.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-800 text-sm">{license.userName}</span>
                            {recency === 'JUST' && (
                                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold animate-pulse">방금</span>
                            )}
                            {recency === 'NEW' && (
                                <span className="bg-orange-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">NEW</span>
                            )}
                            {license.companyName && <span className="text-xs text-gray-500">({license.companyName})</span>}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 text-sm text-gray-600 truncate max-w-[150px]" title={product.name}>{product.name}</td>
                      <td className="px-2 py-0.5 font-mono text-base text-gray-700 font-medium">{license.key}</td>
                      <td className="px-2 py-0.5 text-base text-gray-700 font-mono">
                        {contact || <span className="text-gray-300 text-xs">-</span>}
                      </td>
                      <td className="px-2 py-0.5 text-center">
                        <div className="flex justify-center items-center gap-2">
                           {smsDate ? (
                                <span className="flex items-center justify-center px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold border border-green-200" title={new Date(smsTime).toLocaleString()}>
                                    <i className="fas fa-comment-dots mr-1"></i>{smsDate}
                                </span>
                           ) : <span className="text-gray-300 text-[10px]">-</span>}
                           
                           {emailDate ? (
                                <span className="flex items-center justify-center px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold border border-blue-200" title={new Date(emailTime).toLocaleString()}>
                                    <i className="fas fa-envelope mr-1"></i>{emailDate}
                                </span>
                           ) : <span className="text-gray-300 text-[10px]">-</span>}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button 
                            onClick={() => handleSmsClick(license)}
                            className="bg-green-600 text-white px-3 py-0.5 rounded text-[11px] font-bold hover:bg-green-700 shadow-sm transition-colors whitespace-nowrap"
                          >
                            <i className="fas fa-comment-dots mr-1"></i>문자
                          </button>
                          <button 
                            onClick={() => handleEmailClick(license)}
                            className="bg-indigo-600 text-white px-3 py-0.5 rounded text-[11px] font-bold hover:bg-indigo-700 shadow-sm transition-colors whitespace-nowrap"
                          >
                            <i className="fas fa-envelope mr-1"></i>메일
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Delivery Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          
          {/* --- Email Modal --- */}
          {modalType === 'email' && (
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col h-[85vh] animate-fade-in" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                <h3 className="text-lg font-bold text-gray-800">{isGenerating ? "AI 생성 중..." : modalContent.title}</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto bg-gray-50">
                {isGenerating ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <i className="fas fa-magic text-3xl mb-4 animate-pulse"></i>
                    <p className="font-medium">AI가 내용을 생성하고 있습니다.</p>
                    <p className="text-sm">잠시만 기다려주세요...</p>
                  </div>
                ) : (
                  <div
                    className="w-full h-full p-6 bg-white border border-gray-200 rounded-lg text-gray-800 text-sm leading-relaxed whitespace-pre-wrap font-sans overflow-y-auto"
                  >
                    {modalContent.body}
                  </div>
                )}
              </div>
              <div className="p-4 bg-white border-t border-gray-200 flex justify-end gap-3 items-center flex-shrink-0">
                 <div className="mr-auto text-xs space-y-1">
                    {emailSendStatus === 'success' && <span className="block text-green-600 font-bold"><i className="fas fa-check-circle mr-1"></i> 이메일이 성공적으로 발송되었습니다.</span>}
                    {emailSendStatus === 'error' && <span className="block text-red-500 font-bold"><i className="fas fa-times-circle mr-1"></i> 발송 실패: {emailError}</span>}
                 </div>
                 <button 
                  onClick={handleOpenInNaverMail}
                  disabled={isGenerating}
                  className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
                 >
                   <i className="fas fa-external-link-alt text-green-500"></i>
                   네이버 메일함 열기
                 </button>
                 <button 
                  onClick={handleSendEmail}
                  disabled={isGenerating || isSendingEmail || emailSendStatus === 'success'}
                  className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 text-white shadow-md ${emailSendStatus === 'success' ? 'bg-green-500 hover:bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                 >
                   {isSendingEmail ? (
                     <>
                        <i className="fas fa-spinner fa-spin"></i> 발송 중...
                     </>
                   ) : emailSendStatus === 'success' ? (
                     <>
                        <i className="fas fa-check"></i> 발송 완료
                     </>
                   ) : (
                     <>
                        <i className="fas fa-paper-plane"></i> EmailJS로 즉시 발송
                     </>
                   )}
                 </button>
              </div>
            </div>
          )}

          {/* --- SMS Modal --- */}
          {modalType === 'sms' && (
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-800">{isGenerating ? "AI 생성 중..." : modalContent.title}</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-6 bg-gray-50">
                 {isGenerating ? (
                    <div className="text-center py-8 text-gray-500">
                      <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                      <p>메시지 생성 중...</p>
                    </div>
                 ) : (
                    <textarea 
                      className="w-full h-40 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                      value={modalContent.body}
                      onChange={(e) => setModalContent({...modalContent, body: e.target.value})}
                    ></textarea>
                 )}
              </div>
              <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
                 <button onClick={() => handleCopy(modalContent.body, '메시지')} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-50">
                    <i className="fas fa-copy mr-1"></i>복사
                 </button>
                 <button onClick={handleSendSms} className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-600 shadow-md">
                    <i className="fas fa-paper-plane mr-1"></i>문자 보내기
                 </button>
              </div>
            </div>
          )}
          
        </div>
      )}
    </div>
  );
};

export default LicenseDelivery;
