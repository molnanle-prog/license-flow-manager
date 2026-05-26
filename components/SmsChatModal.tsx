import React, { useState, useEffect, useRef } from 'react';
import { License, Product, SmsLog } from '../types';
import { getSmsLogs, sendSmsViaSolapi, saveSmsLog, syncInboundSmsLogs } from '../services/smsService';
import { getAppConfig } from '../services/storageService';
import { generateApprovalMessage } from '../services/geminiService';

interface SmsChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  license: License;
  contact: string;
  onSmsSent: (licenseId: string) => void;
}

const SmsChatModal: React.FC<SmsChatModalProps> = ({ 
  isOpen, 
  onClose, 
  license, 
  contact, 
  onSmsSent 
}) => {
  const [chatLogs, setChatLogs] = useState<SmsLog[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [smsTesting, setSmsTesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const appConfig = getAppConfig();

  const loadChatLogs = async () => {
    try {
      const tenantId = license.programId ? appConfig.programs.find(p => String(p.programId) === String(license.programId))?.sheetId : null;
      
      // 1. 솔라피 수신함으로부터 진짜 고객의 답장 로그를 실시간 가져와 DB에 자율 동기화!
      await syncInboundSmsLogs(tenantId || null, contact, license.id);
      
      // 2. 동기화가 마쳐진 후 DB로부터 최신 대화 로그 렌더링
      const logs = await getSmsLogs(tenantId || null, contact, license.id);
      setChatLogs(logs);
    } catch (e) {
      console.error("Failed to load chat logs", e);
    }
  };

  // 다운로드 링크 생성 헬퍼
  const getDownloadLink = (prodName: string, programId?: any) => {
    const defaultLink = appConfig.downloadLink || 'https://naver.me/Fm3SGglJ';
    const nameLower = prodName.toLowerCase();
    const pidStr = programId ? String(programId) : '';
    
    if (nameLower.includes('print') || pidStr === 'ezprintwork-program' || pidStr === 'EZPRINTWORK') {
      const pLink = appConfig.programs.find(p => String(p.programId) === 'ezprintwork-program' || String(p.programId) === 'EZPRINTWORK')?.downloadLink;
      return pLink ? `https://ez-hub.kr/ezprintwork\n${pLink}` : 'https://ez-hub.kr/ezprintwork';
    } else {
      return `https://ez-hub.kr/ezimpo\n${defaultLink}`;
    }
  };

  // 모달 오픈 시 초기 대화 이력 로딩
  useEffect(() => {
    if (!isOpen) return;

    const initChat = async () => {
      setChatInput('');
      setChatLogs([]);
      setIsGenerating(false);

      // 1. 대화 이력 로드 (이전 이력이 쫙 뜹니다!)
      await loadChatLogs();
    };

    initChat();
  }, [isOpen, license.id, contact]);

  // 대화 로그 변경 시 자동 스크롤
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLogs]);

  // 템플릿 메시지 적용 함수
  const applyTemplate = async (type: 'welcome' | 'upgrade' | 'ai') => {
    if (type === 'ai') {
      setIsGenerating(true);
      setChatInput('');
      try {
        const isPreActivated = !!license.machineId;
        const downloadLink = getDownloadLink(license.productName || 'EzImpo', license.programId);
        const message = await generateApprovalMessage(
          license.userName || '고객님', 
          license.productName || 'EzImpo', 
          license.key || '', 
          isPreActivated,
          downloadLink
        );
        setChatInput(message);
      } catch (err) {
        console.error("AI Generation failed", err);
        alert("AI 문장 생성 중 오류가 발생했습니다.");
      } finally {
        setIsGenerating(false);
      }
    } else {
      const downloadLink = getDownloadLink(license.productName || 'EzImpo', license.programId);
      let content = '';
      if (type === 'welcome') {
        content = `[${license.productName || 'EzImpo'}] 안녕하세요 ${license.userName}님, 라이선스가 발급되었습니다.\n\n- 제품: ${license.productName}\n- 키: ${license.key}\n- PIN: ${license.pin || '-'}\n- 만료일: ${license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : '평생'}\n\n■ 프로그램 다운로드 링크\n${downloadLink}\n\n감사합니다.`;
      } else {
        content = `[${license.productName || 'EzImpo'}] 안녕하세요 ${license.userName}님, 새로운 버전이 출시되었습니다.\n\n프로그램을 재실행하여 업데이트를 진행해주세요.\n\n■ 프로그램 다운로드 링크\n${downloadLink}\n\n현재 버전: ${license.version || '-'}\n\n감사합니다.`;
      }
      setChatInput(content);
    }
  };

  const handleSendChatSms = async () => {
    if (!chatInput.trim() || !contact || !license.id) return;

    setSmsTesting(true);
    const textToSend = chatInput;
    setChatInput(''); // UI 입력 지연 소멸을 위해 즉각 클리어

    try {
      const tenantId = license.programId ? appConfig.programs.find(p => String(p.programId) === String(license.programId))?.sheetId : null;
      const res = await sendSmsViaSolapi(contact, textToSend, license.id, tenantId);
      
      if (res.success) {
        onSmsSent(license.id);
        
        // 대화 로그 새로고침
        await loadChatLogs();

      } else {
        alert(res.message);
        setChatInput(textToSend); // 실패 시 복구
      }
    } catch (e: any) {
      alert("문자 전송 중 오류가 발생했습니다: " + e.message);
      setChatInput(textToSend);
    } finally {
      setSmsTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-[40px] shadow-2xl w-full max-w-sm flex flex-col h-[750px] border-[10px] border-slate-800 relative overflow-hidden" onClick={e => e.stopPropagation()}>
        
        {/* 스마트폰 상단 펀치홀/노치 및 스피커 데코 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-full z-20 flex items-center justify-center">
          <div className="w-12 h-1 bg-slate-700 rounded-full mr-2"></div>
          <div className="w-2.5 h-2.5 bg-slate-900 rounded-full border border-slate-800"></div>
        </div>

        {/* 스마트폰 내부 화면 상단 바 (배터리, 시각 등) */}
        <div className="bg-slate-50 pt-8 pb-2 px-6 flex justify-between items-center text-[10px] font-bold text-slate-600 border-b border-slate-100 z-10 select-none shrink-0">
          <span>{new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
          <div className="flex items-center gap-1.5">
            <i className="fas fa-wifi text-[9px]"></i>
            <span className="text-[9px]">LTE</span>
            <i className="fas fa-battery-three-quarters text-[11px]"></i>
          </div>
        </div>

        {/* 대화방 헤더 */}
        <div className="bg-white py-3 px-4 flex items-center justify-between border-b border-gray-200/80 shadow-sm shrink-0 z-10">
          <div className="flex items-center gap-2.5">
            {/* 프로필 서클 */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-black text-xs shadow-md">
              {license.userName ? license.userName.substring(0, 2) : '고'}
            </div>
            <div>
              <h4 className="font-extrabold text-xs text-gray-800 flex items-center gap-1.5">
                {license.userName || '고객님'}
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping"></span>
              </h4>
              <p className="text-[9px] text-gray-400 font-mono font-bold">{contact}</p>
            </div>
          </div>
          
          {/* 닫기 버튼 */}
          <button 
            onClick={onClose} 
            className="w-7 h-7 rounded-full bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors border border-gray-100"
          >
            <i className="fas fa-times text-[10px]"></i>
          </button>
        </div>

        {/* 대화창 본문 (스크롤 영역) */}
        <div className="flex-1 bg-[#F4F6F9] overflow-y-auto p-4 space-y-4 flex flex-col min-h-0">
          {isGenerating && chatLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 flex-1">
              <i className="fas fa-magic text-2xl mb-3 animate-bounce text-indigo-500"></i>
              <p className="font-bold text-xs text-slate-600">AI가 알맞은 안내 문자를</p>
              <p className="text-[10px] text-gray-400">작성하고 있습니다...</p>
            </div>
          ) : (
            <div className="flex flex-col space-y-3 flex-1 min-h-0">
              <div className="text-center py-1">
                <span className="bg-gray-200/70 text-gray-500 font-bold text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                  {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                </span>
              </div>

              <div className="flex flex-col space-y-3 flex-1 overflow-y-auto pr-1">
                {chatLogs.map(log => {
                  const isMe = log.direction === 'OUTBOUND';
                  return (
                    <div key={log.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                      <div className={`flex flex-col max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                        {/* 말풍선 */}
                        <div className={`p-2.5 rounded-xl text-[11px] leading-relaxed shadow-sm break-all whitespace-pre-wrap font-sans ${isMe ? 'bg-gradient-to-tr from-green-500 to-emerald-600 text-white rounded-tr-none' : 'bg-white text-gray-800 border border-gray-200/50 rounded-tl-none'}`}>
                          {log.content}
                        </div>
                        
                        {/* 시간 및 성공 여부 */}
                        <div className="flex items-center gap-1 mt-1 text-[8px] font-bold text-gray-400">
                          <span>
                            {new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                          {isMe && (
                            <span className={log.status === 'SUCCESS' ? 'text-green-500' : 'text-red-500'}>
                              {log.status === 'SUCCESS' ? <i className="fas fa-check" title="전송 성공"></i> : <i className="fas fa-exclamation-circle" title="전송 실패"></i>}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {isGenerating && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="bg-white text-gray-400 border border-gray-200/50 p-2.5 rounded-xl rounded-tl-none text-[11px] flex items-center gap-1.5 shadow-sm">
                      <i className="fas fa-magic text-indigo-500 animate-pulse"></i> AI 글짓는 중...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* 템플릿 추천 칩 영역 (카카오톡 상단 칩스 스타일로 귀엽게!) */}
        <div className="bg-slate-50 px-3 py-1.5 border-t border-gray-100 flex gap-2 shrink-0 overflow-x-auto select-none scrollbar-none">
          <button 
            onClick={() => applyTemplate('welcome')} 
            className="px-2.5 py-1 bg-white border border-gray-200/80 rounded-full text-[10px] font-black text-slate-700 hover:bg-slate-100 hover:text-indigo-600 shadow-xs transition-colors shrink-0"
          >
            🚀 발급 안내
          </button>
          <button 
            onClick={() => applyTemplate('upgrade')} 
            className="px-2.5 py-1 bg-white border border-gray-200/80 rounded-full text-[10px] font-black text-slate-700 hover:bg-slate-100 hover:text-indigo-600 shadow-xs transition-colors shrink-0"
          >
            📢 업데이트
          </button>
          <button 
            onClick={() => applyTemplate('ai')} 
            className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-[10px] font-black text-indigo-600 hover:bg-indigo-100 shadow-xs transition-colors shrink-0 flex items-center gap-1"
          >
            <i className="fas fa-magic"></i> AI 자동생성
          </button>
        </div>

        {/* 하단 입력/전송 컨트롤 */}
        <div className="bg-white p-3 border-t border-gray-200 flex items-end gap-2 shrink-0 pb-6">
          <textarea
            placeholder="메시지 입력..."
            rows={2}
            className="flex-1 border border-gray-200 rounded-xl p-2 text-[11px] max-h-24 outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none leading-normal font-sans bg-gray-50/50 focus:bg-white transition-all shadow-inner"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendChatSms();
              }
            }}
          />
          <button
            onClick={handleSendChatSms}
            disabled={smsTesting || !chatInput.trim()}
            className="w-8 h-8 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-full flex items-center justify-center transition-all shadow-md shadow-green-100 disabled:shadow-none hover:scale-105 active:scale-95 shrink-0"
          >
            {smsTesting ? (
              <i className="fas fa-spinner fa-spin text-xs"></i>
            ) : (
              <i className="fas fa-arrow-up text-xs"></i>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default SmsChatModal;
