import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { type AuthUser } from '../../shared/types.ts';
import { apiRequest, getStoredToken, registerUnauthorizedHandler, setStoredToken } from '../lib/api.ts';
import { signOutFirebaseIfActive } from '../lib/firebase.ts';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// ==================== TOAST CONTEXT ====================
export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  notifySuccess: (msg: string) => void;
  notifyError: (msg: string) => void;
  notifyInfo: (msg: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const notifySuccess = useCallback((msg: string) => pushToast('success', msg), [pushToast]);
  const notifyError = useCallback((msg: string) => pushToast('error', msg), [pushToast]);
  const notifyInfo = useCallback((msg: string) => pushToast('info', msg), [pushToast]);

  return (
    <ToastContext.Provider value={{ notifySuccess, notifyError, notifyInfo }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border bg-white shadow-sm text-[13px] leading-snug ${
              t.type === 'success'
                ? 'border-emerald-300 text-slate-900'
                : t.type === 'error'
                  ? 'border-red-300 text-slate-900'
                  : 'border-slate-300 text-slate-900'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-slate-400 hover:text-slate-700 p-0.5"
              aria-label="Đóng thông báo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ==================== AUTH CONTEXT ====================
interface AuthContextValue {
  user: AuthUser | null;
  loadingAuth: boolean;
  setAuthenticatedSession: (token: string, user: AuthUser) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);

  const refreshMe = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoadingAuth(false);
      return;
    }
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/me');
      setUser(res.user);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setUser(null);
    });
    void refreshMe();
  }, [refreshMe]);

  const setAuthenticatedSession = useCallback((token: string, nextUser: AuthUser) => {
    setStoredToken(token);
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore logout network error
    }
    try {
      await signOutFirebaseIfActive();
    } catch {
      // ignore firebase signout error
    }
    setStoredToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loadingAuth,
        setAuthenticatedSession,
        refreshMe,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// ==================== ERROR BOUNDARY ====================
interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Đã xảy ra lỗi hiển thị ngoài dự kiến.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <h1 className="text-lg font-semibold text-slate-900">Không thể hiển thị màn hình</h1>
            <p className="text-sm text-slate-600">
              Hệ thống gặp sự cố tạm thời khi hiển thị nội dung. Vui lòng tải lại trang để tiếp tục làm việc.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
