import React from 'react';
import { isDesktopShell } from '../services/authService';

type Props = {
  isLoggingIn: boolean;
  errorMessage?: string | null;
  onLogin: () => void;
};

const FirebaseLoginScreen: React.FC<Props> = ({ isLoggingIn, errorMessage, onLogin }) => {
  const desktop = isDesktopShell();

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6">
      <div className="w-full max-w-md rounded-3xl bg-white/95 shadow-2xl border border-white/20 p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
          <i className="fas fa-rocket text-white text-2xl"></i>
        </div>
        <h1 className="text-2xl font-black text-slate-900">LicenseFlow Manager</h1>
        <p className="text-sm text-slate-500 mt-2">EzPrintWork 데이터 동기화를 위해 Google 로그인이 필요합니다.</p>
        <p className="text-xs text-indigo-600 font-bold mt-1">molnanle@gmail.com</p>

        <button
          type="button"
          onClick={onLogin}
          disabled={isLoggingIn}
          className="mt-8 w-full py-3.5 px-4 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black text-base shadow-sm hover:bg-slate-50 hover:border-indigo-300 transition-all disabled:opacity-60 flex items-center justify-center gap-3"
        >
          {isLoggingIn ? (
            <>
              <i className="fas fa-spinner fa-spin text-indigo-600"></i>
              {desktop ? '로그인 창 대기 중...' : 'Google 로그인 중...'}
            </>
          ) : (
            <>
              <i className="fab fa-google text-red-500"></i>
              Google로 로그인
            </>
          )}
        </button>

        {errorMessage && (
          <p className="mt-4 text-sm text-red-600 leading-relaxed whitespace-pre-line">{errorMessage}</p>
        )}

        <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
          {desktop
            ? '로그인 버튼을 누르면 별도 로그인 창이 열립니다. 그 창에서만 Google 계정을 선택해 주세요. 이 메인 화면은 로그인을 기다립니다.'
            : '브라우저에서 Google 계정을 선택해 로그인합니다.'}
        </p>
      </div>
    </div>
  );
};

export default FirebaseLoginScreen;