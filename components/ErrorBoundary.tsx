
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "알 수 없는 오류가 발생했습니다.";
      let isFirestoreError = false;
      
      try {
        // Check if it's our custom Firestore error JSON
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.authInfo && parsed.operationType) {
            isFirestoreError = true;
            if (parsed.error.includes('permission-denied')) {
              errorMessage = "데이터에 접근할 권한이 없습니다. 관리자 계정으로 로그인했는지 확인해주세요.";
            } else {
              errorMessage = `데이터베이스 오류: ${parsed.error}`;
            }
          }
        }
      } catch (e) {
        // Not a JSON error, use the default or the error message
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="fas fa-exclamation-triangle text-2xl"></i>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">문제가 발생했습니다</h1>
            <p className="text-gray-600 mb-4 whitespace-pre-wrap">
              {errorMessage}
            </p>
            {this.state.error?.stack && (
              <div className="mb-6 p-3 bg-gray-50 rounded-lg text-left overflow-auto max-h-40">
                <p className="text-[10px] font-mono text-gray-400">Stack Trace:</p>
                <p className="text-[9px] font-mono text-red-400 whitespace-pre">
                  {this.state.error.stack}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
              >
                페이지 새로고침
              </button>
              <button
                onClick={() => (this as any).setState({ hasError: false, error: null })}
                className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
              >
                다시 시도
              </button>
            </div>
            {isFirestoreError && (
              <p className="mt-6 text-[10px] text-gray-400 uppercase tracking-widest">
                Firestore Security Error Detected
              </p>
            )}
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
