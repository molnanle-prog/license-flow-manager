import React, { useState, useEffect } from 'react';
import { License } from '../types';
import { sendSmsViaSolapi } from '../services/smsService';
import { getAppConfig } from '../services/storageService';

interface BulkSmsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLicenses: License[];
  allLicenses: License[];
  onSuccess: () => void;
}

const BulkSmsModal: React.FC<BulkSmsModalProps> = ({
  isOpen,
  onClose,
  selectedLicenses,
  allLicenses,
  onSuccess
}) => {
  const [targetType, setTargetType] = useState<'selected' | 'all'>('selected');
  const [smsContent, setSmsContent] = useState('');
  
  // 발송 진행 상황 상태
  const [isSending, setIsSending] = useState(false);
  const [shouldStop, setShouldStop] = useState(false);
  const [progress, setProgress] = useState(0); // 0 ~ 100
  const [totalCount, setTotalCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [failedList, setFailedList] = useState<{ userName: string; contact: string; reason: string }[]>([]);
  const [isFinished, setIsFinished] = useState(false);

  const appConfig = getAppConfig();

  // 대상 변경 시 및 모달 초기화
  useEffect(() => {
    if (isOpen) {
      setTargetType(selectedLicenses.length > 0 ? 'selected' : 'all');
      setSmsContent('');
      setIsSending(false);
      setShouldStop(false);
      setProgress(0);
      setSentCount(0);
      setSuccessCount(0);
      setFailCount(0);
      setFailedList([]);
      setIsFinished(false);
    }
  }, [isOpen, selectedLicenses]);

  if (!isOpen) return null;

  // 발송 리스트 결정 (연락처가 있고 올바른 형태인 대상만 추출)
  const getTargetList = (): License[] => {
    const rawList = targetType === 'selected' ? selectedLicenses : allLicenses;
    return rawList.filter(l => l.contactInfo && l.contactInfo.replace(/\D/g, "").length >= 9);
  };

  const targets = getTargetList();

  // 치환 헬퍼 함수
  const replaceMergeTags = (template: string, lic: License): string => {
    const defaultLink = appConfig.downloadLink || 'https://naver.me/Fm3SGglJ';
    const nameLower = (lic.productName || '').toLowerCase();
    const pidStr = lic.programId ? String(lic.programId) : '';
    const isPrint = nameLower.includes('print') || pidStr === 'ezprintwork-program' || pidStr === 'EZPRINTWORK';
    const pLink = appConfig.programs.find(p => String(p.programId) === 'ezprintwork-program' || String(p.programId) === 'EZPRINTWORK')?.downloadLink;
    const downloadUrl = isPrint 
      ? (pLink ? `https://ez-hub.kr/ezprintwork\n${pLink}` : 'https://ez-hub.kr/ezprintwork')
      : `https://ez-hub.kr/ezimpo\n${defaultLink}`;

    return template
      .replace(/\[고객명\]/g, lic.userName || '고객님')
      .replace(/\[라이선스키\]/g, lic.key || '')
      .replace(/\[PIN\]/g, lic.pin || '-')
      .replace(/\[제품명\]/g, lic.productName || '')
      .replace(/\[다운로드링크\]/g, downloadUrl)
      .replace(/\[만료일\]/g, lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString() : '평생');
  };

  // 치환 태그 강제 클릭 주입 함수
  const insertMergeTag = (tag: string) => {
    const textarea = document.getElementById('bulk-sms-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    setSmsContent(before + tag + after);
    
    // 포커스 유지 및 커서 이동
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 10);
  };

  // 템플릿 선택
  const handleApplyTemplate = (type: 'welcome' | 'upgrade') => {
    if (type === 'welcome') {
      setSmsContent(
        `[[제품명]] 안녕하세요 [고객명]님, 라이선스가 발급되었습니다.\n\n` +
        `- 제품: [제품명]\n` +
        `- 키: [라이선스키]\n` +
        `- PIN: [PIN]\n` +
        `- 만료일: [만료일]\n\n` +
        `■ 프로그램 다운로드 링크\n[다운로드링크]\n\n` +
        `감사합니다.`
      );
    } else {
      setSmsContent(
        `[[제품명]] 안녕하세요 [고객명]님, 새로운 버전이 출시되었습니다.\n\n` +
        `프로그램을 재실행하여 업데이트를 진행해주세요.\n\n` +
        `■ 프로그램 다운로드 링크\n[다운로드링크]\n\n` +
        `감사합니다.`
      );
    }
  };

  // 단체 문자 비동기 발송 루프
  const handleStartSending = async () => {
    if (!smsContent.trim()) return alert('발송할 메시지 내용을 입력해주세요.');
    if (targets.length === 0) return alert('발송 대상자가 없습니다.');

    const confirmMessage = 
      `정말로 다음 단체 문자를 발송하시겠습니까?\n\n` +
      `▶ 발송 대상: ${targetType === 'selected' ? '선택 회원' : '전체 회원'} (${targets.length}명)\n` +
      `▶ 발송 방식: 개별 치환 맞춤 전송\n\n` +
      `* 솔라피 요금이 차감되므로 연락처 정보와 내용을 다시 한번 확인해 주세요.`;

    if (!window.confirm(confirmMessage)) return;

    setIsSending(true);
    setShouldStop(false);
    setProgress(0);
    setSentCount(0);
    setSuccessCount(0);
    setFailCount(0);
    setFailedList([]);
    setIsFinished(false);
    setTotalCount(targets.length);

    let currentStop = false;

    for (let i = 0; i < targets.length; i++) {
      // 도중에 중단하기를 누른 경우 검사
      if (currentStop || shouldStop) break;

      const lic = targets[i];
      const contact = lic.contactInfo || '';
      
      // 개별 맞춤 문자 치환
      const customizedText = replaceMergeTags(smsContent, lic);
      const tenantId = lic.programId ? appConfig.programs.find(p => p.programId === lic.programId)?.sheetId : null;

      try {
        const res = await sendSmsViaSolapi(contact, customizedText, lic.id, tenantId);
        
        if (res.success) {
          setSuccessCount(prev => prev + 1);
        } else {
          setFailCount(prev => prev + 1);
          setFailedList(prev => [...prev, { 
            userName: lic.userName || '미명', 
            contact: contact, 
            reason: res.message 
          }]);
        }
      } catch (err: any) {
        setFailCount(prev => prev + 1);
        setFailedList(prev => [...prev, { 
          userName: lic.userName || '미명', 
          contact: contact, 
          reason: err.message || '네트워크 오류' 
        }]);
      }

      const nextSentCount = i + 1;
      setSentCount(nextSentCount);
      setProgress(Math.round((nextSentCount / targets.length) * 100));

      // 0.2초 딜레이를 주어 안정적인 API 발송 흐름 유지
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    setIsSending(false);
    setIsFinished(true);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4" onClick={() => { if (!isSending) onClose(); }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] animate-fade-in" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-indigo-50 border-indigo-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <i className="fas fa-paper-plane text-sm"></i>
            </span>
            <div>
              <h3 className="text-base font-black text-slate-800">단체 문자 대량 발송</h3>
              <p className="text-[10px] text-gray-500">지정된 조건의 회원들에게 각각 맞춤형으로 치환된 문자를 순차 전송합니다.</p>
            </div>
          </div>
          {!isSending && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times text-lg"></i></button>
          )}
        </div>

        {/* Content */}
        {!isSending && !isFinished ? (
          <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50/50">
            {/* Left: 발송 대상 설정 */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-2">1. 발송 대상 설정</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setTargetType('selected')}
                    disabled={selectedLicenses.length === 0}
                    className={`p-3 rounded-xl border text-center font-bold text-xs transition-all flex flex-col items-center gap-1.5 ${targetType === 'selected' ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-gray-50 border-gray-200 disabled:opacity-50'}`}
                  >
                    <i className="fas fa-check-square text-base"></i>
                    <span>선택 회원 ({selectedLicenses.length}명)</span>
                  </button>
                  <button 
                    onClick={() => setTargetType('all')}
                    className={`p-3 rounded-xl border text-center font-bold text-xs transition-all flex flex-col items-center gap-1.5 ${targetType === 'all' ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-gray-50 border-gray-200'}`}
                  >
                    <i className="fas fa-users text-base"></i>
                    <span>전체 회원 ({allLicenses.length}명)</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">실제 발송 명단 요약 ({targets.length}명)</span>
                {selectedLicenses.length === 0 && targetType === 'selected' ? (
                  <p className="text-xs text-red-500 font-bold">선택된 회원이 없습니다. 체크박스로 선택 후 눌러주세요.</p>
                ) : targets.length === 0 ? (
                  <p className="text-xs text-red-500 font-bold">발송 가능한 올바른 수신 번호가 있는 대상이 없습니다.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2">
                    {targets.map((t, idx) => (
                      <div key={t.id} className="flex justify-between items-center text-[11px] p-2 bg-gray-50 rounded border border-gray-100/50">
                        <span className="font-bold text-slate-700">{idx + 1}. {t.userName}</span>
                        <span className="text-gray-400 font-mono">{t.contactInfo}</span>
                      </div>
                    ))}
                  </div>
                )}
                {targets.length < (targetType === 'selected' ? selectedLicenses.length : allLicenses.length) && (
                  <span className="block text-[9px] text-amber-600 font-bold"><i className="fas fa-exclamation-triangle mr-1"></i> 연락처가 올바르지 않은 일부 대상자는 자동 필터링(제외)되었습니다.</span>
                )}
              </div>
            </div>

            {/* Right: 내용 작성 */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-xs font-black text-slate-600">2. 내용 작성 및 템플릿</label>
                <div className="flex gap-1">
                  <button onClick={() => handleApplyTemplate('welcome')} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 border text-[10px] font-bold rounded-md">🚀 발급</button>
                  <button onClick={() => handleApplyTemplate('upgrade')} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 border text-[10px] font-bold rounded-md">📢 공지</button>
                </div>
              </div>

              <div>
                <textarea 
                  id="bulk-sms-textarea"
                  placeholder="보내실 메시지 내용을 입력하세요..."
                  className="w-full border rounded-xl p-3 text-xs h-60 focus:ring-2 focus:ring-indigo-500 outline-none resize-none font-sans bg-white shadow-inner"
                  value={smsContent}
                  onChange={e => setSmsContent(e.target.value)}
                />
                <div className="mt-1 text-right text-[10px] text-gray-400">
                  {smsContent.length} 자 / 약 {Math.ceil(smsContent.length / 80)} 건 발송
                </div>
              </div>

              {/* 치환 태그 입력 칩 */}
              <div className="space-y-1.5">
                <span className="block text-[9px] font-black text-slate-400 tracking-wider">클릭 시 자동 치환 태그 삽입</span>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => insertMergeTag('[고객명]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">👤 고객명</button>
                  <button onClick={() => insertMergeTag('[제품명]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">📦 제품명</button>
                  <button onClick={() => insertMergeTag('[라이선스키]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">🔑 라이선스 키</button>
                  <button onClick={() => insertMergeTag('[PIN]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">📌 PIN</button>
                  <button onClick={() => insertMergeTag('[만료일]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">📅 만료일</button>
                  <button onClick={() => insertMergeTag('[다운로드링크]')} className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 text-[10px] font-bold rounded-lg shadow-2xs">🔗 다운로드 링크</button>
                </div>
              </div>
            </div>
          </div>
        ) : isSending ? (
          /* 발송 진행 상태 UI */
          <div className="p-10 flex-1 flex flex-col justify-center items-center text-center bg-gray-50/50">
            <div className="relative w-28 h-28 flex items-center justify-center mb-6">
              {/* 스피너 서클 */}
              <div className="absolute inset-0 rounded-full border-4 border-gray-200 border-t-indigo-600 animate-spin"></div>
              {/* 퍼센테이지 텍스트 */}
              <span className="text-xl font-black text-indigo-700">{progress}%</span>
            </div>
            
            <h4 className="text-lg font-black text-slate-800 mb-1">단체 문자를 순차 발송하는 중입니다...</h4>
            <p className="text-xs text-slate-500 mb-6">창을 닫거나 브라우저를 새로고침하지 마세요.</p>

            {/* 프로그레스 바 뒷 배경 */}
            <div className="w-full max-w-md h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner mb-6">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>

            {/* 전송 집계 스코어 */}
            <div className="grid grid-cols-3 gap-6 bg-white border rounded-2xl p-4 w-full max-w-md shadow-sm">
              <div>
                <span className="block text-[10px] font-black text-slate-400">발송 대상</span>
                <span className="text-lg font-black text-slate-700">{totalCount}명</span>
              </div>
              <div>
                <span className="block text-[10px] font-black text-green-500">발송 성공</span>
                <span className="text-lg font-black text-green-600">{successCount}건</span>
              </div>
              <div>
                <span className="block text-[10px] font-black text-red-500">발송 실패</span>
                <span className="text-lg font-black text-red-600">{failCount}건</span>
              </div>
            </div>

            <button 
              onClick={() => { setShouldStop(true); }}
              className="mt-8 px-6 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 hover:text-red-700 rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              ✋ 발송 작업 중단하기
            </button>
          </div>
        ) : (
          /* 발송 완료 보고서 UI */
          <div className="p-8 flex-1 flex flex-col overflow-hidden bg-gray-50/50">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-2xl mx-auto mb-3 shadow-md">
                <i className="fas fa-check-circle"></i>
              </div>
              <h4 className="text-lg font-black text-slate-800 mb-1">단체 문자 발송이 완료되었습니다!</h4>
              {shouldStop && <p className="text-xs text-amber-600 font-bold"><i className="fas fa-exclamation-circle mr-1"></i> 사용자의 요청에 의해 발송 도중 중단되었습니다.</p>}
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 max-h-[40vh] pr-2">
              <div className="grid grid-cols-3 gap-4 bg-white border border-gray-200 rounded-2xl p-4 text-center shadow-xs shrink-0">
                <div>
                  <span className="block text-[10px] font-black text-slate-400">총 시도 건수</span>
                  <span className="text-base font-black text-slate-700">{sentCount}건</span>
                </div>
                <div>
                  <span className="block text-[10px] font-black text-green-500">성공 완료</span>
                  <span className="text-base font-black text-green-600">{successCount}건</span>
                </div>
                <div>
                  <span className="block text-[10px] font-black text-red-500">실패 처리</span>
                  <span className="text-base font-black text-red-600">{failCount}건</span>
                </div>
              </div>

              {/* 실패 대상자가 있는 경우 보고서 노출 */}
              {failedList.length > 0 && (
                <div className="bg-red-50/50 border border-red-200/50 rounded-2xl p-4 space-y-2">
                  <span className="block text-[10px] font-black text-red-600 tracking-wider"><i className="fas fa-exclamation-triangle mr-1"></i> 발송 실패 대상자 목록 ({failedList.length}명)</span>
                  <div className="space-y-1.5">
                    {failedList.map((f, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px] p-2 bg-white rounded border border-red-100">
                        <span className="font-bold text-slate-700">{f.userName} ({f.contact})</span>
                        <span className="text-red-500 font-medium">{f.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {!isSending && (
          <div className="px-6 py-4 bg-gray-50 border-t flex gap-3 flex-shrink-0">
            <button 
              onClick={onClose} 
              className="flex-1 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-xs hover:bg-gray-50 transition-all"
            >
              {isFinished ? '대화창 닫기' : '취소'}
            </button>
            {!isFinished && (
              <button 
                onClick={handleStartSending} 
                disabled={targets.length === 0}
                className="flex-[2] py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-100 disabled:bg-gray-400 disabled:shadow-none transition-all"
              >
                단체 문자 발송하기 ({targets.length}명)
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default BulkSmsModal;
