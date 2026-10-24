import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  X,
} from 'lucide-react';
import {
  ALL_PROTECTED_ROUTES,
  canAccessRoute,
  getDefaultRouteForRole,
  NAV_GROUPS,
} from '../../../shared/permissions.ts';
import { ROLE_LABELS, type NotificationItem } from '../../../shared/types.ts';
import { useAuth } from '../../context/AppContexts.tsx';
import { apiRequest, formatDateTime } from '../../lib/api.ts';
import { syncFirebaseRouteSnapshot } from '../../lib/firebase.ts';
import { ForbiddenScreen } from '../ui/SharedUi.tsx';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);

  // Filter nav groups strictly by user role (never show empty or unauthorized groups)
  const visibleGroups = useMemo(() => {
    if (!user) return [];
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(user.role)),
    })).filter((group) => group.items.length > 0);
  }, [user]);

  // Rule: Do NOT expand all menu groups by default — ONLY open the active group!
  const activeGroupId = useMemo(() => {
    const found = visibleGroups.find((g) =>
      g.items.some((i) => location.pathname.startsWith(i.path))
    );
    return found?.id || visibleGroups[0]?.id || '';
  }, [visibleGroups, location.pathname]);

  const [openGroupId, setOpenGroupId] = useState<string>(activeGroupId);

  useEffect(() => {
    if (activeGroupId) {
      setOpenGroupId(activeGroupId);
    }
  }, [activeGroupId]);

  useEffect(() => {
    setMobileMenuOpen(false);
    if (user && canAccessRoute(user.role, location.pathname)) {
      void syncFirebaseRouteSnapshot(location.pathname);
    }
  }, [location.pathname, user]);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest<{ unreadCount: number; items: NotificationItem[] }>(
        '/api/notifications'
      );
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // silent background fetch
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const currentPageLabel = useMemo(() => {
    if (location.pathname === '/tai-khoan-ca-nhan') return 'Tài khoản cá nhân';
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.path === location.pathname) return item.label;
      }
    }
    return 'BATT PPMS';
  }, [location.pathname]);

  if (!user) return null;

  const isRouteKnown = Boolean(ALL_PROTECTED_ROUTES[location.pathname]);
  const isAllowed = isRouteKnown && canAccessRoute(user.role, location.pathname);

  const handleNotificationClick = async (n: NotificationItem) => {
    if (!n.isRead) {
      try {
        await apiRequest(`/api/notifications/${n.id}/read`, { method: 'POST' });
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    }
    setNotifOpen(false);
    if (canAccessRoute(user.role, n.targetPath)) {
      const url = n.referenceCode
        ? `${n.targetPath}?q=${encodeURIComponent(n.referenceCode)}`
        : n.targetPath;
      navigate(url);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const renderSidebarContent = (isMobileDrawer: boolean) => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 select-none">
      {/* Compact Brand Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
        <Link
          to={getDefaultRouteForRole(user.role)}
          className="flex items-center gap-2.5 min-w-0"
        >
          <div className="w-7 h-7 rounded bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
            BATT
          </div>
          {(!collapsed || isMobileDrawer) && (
            <span className="font-semibold text-[15px] tracking-tight text-white truncate">
              BATT PPMS
            </span>
          )}
        </Link>
        {isMobileDrawer ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white rounded"
            aria-label="Đóng menu"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 text-slate-400 hover:text-white rounded hidden lg:inline-flex"
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
        {visibleGroups.map((group) => {
          const singleDirectItem = group.items.length === 1 ? group.items[0] : null;
          if (singleDirectItem) {
            const active = location.pathname === singleDirectItem.path;
            return (
              <Link
                key={group.id}
                to={singleDirectItem.path}
                title={collapsed && !isMobileDrawer ? singleDirectItem.label : undefined}
                className={`flex items-center px-3 py-2 rounded-md text-[13.5px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="truncate">
                  {collapsed && !isMobileDrawer
                    ? singleDirectItem.label.slice(0, 2).toUpperCase()
                    : singleDirectItem.label}
                </span>
              </Link>
            );
          }

          const isGroupOpen = openGroupId === group.id;
          const hasActiveChild = group.items.some((i) => location.pathname === i.path);

          return (
            <div key={group.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  if (collapsed && !isMobileDrawer) {
                    setCollapsed(false);
                    setOpenGroupId(group.id);
                  } else {
                    setOpenGroupId((prev) => (prev === group.id ? '' : group.id));
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap ${
                  hasActiveChild ? 'text-white bg-slate-800/70' : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                <span className="truncate">
                  {collapsed && !isMobileDrawer ? group.label.slice(0, 2).toUpperCase() : group.label}
                </span>
                {(!collapsed || isMobileDrawer) &&
                  (isGroupOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  ))}
              </button>

              {isGroupOpen && (!collapsed || isMobileDrawer) && (
                <div className="pl-3 space-y-0.5">
                  {group.items.map((item) => {
                    const active = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`block px-3 py-1.5 rounded-md text-[13px] transition-colors whitespace-nowrap truncate ${
                          active
                            ? 'bg-emerald-600 text-white font-medium'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );

  const initials = user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-150 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className={`fixed inset-y-0 left-0 z-30 ${collapsed ? 'w-16' : 'w-60'}`}>
          {renderSidebarContent(false)}
        </div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[82vw] h-full">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Header */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
              aria-label="Mở menu điều hướng"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-[14px] font-medium text-slate-700 truncate">
              {currentPageLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Notifications Dropdown */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                aria-label="Thông báo nội bộ"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-data font-semibold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-1.5 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-lg shadow-lg z-40 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200">
                    <span className="text-[13px] font-semibold text-slate-900">Thông báo</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        Đánh dấu đã đọc tất cả
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                        Chưa có thông báo mới
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          className={`w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition-colors space-y-0.5 ${
                            !n.isRead ? 'bg-blue-50/40' : 'bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[13px] truncate ${
                                !n.isRead ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                              }`}
                            >
                              {n.title}
                            </span>
                            <span className="text-[11px] font-data text-slate-400 shrink-0">
                              {formatDateTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 line-clamp-2">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Compact Account Menu */}
            <div className="relative" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((o) => !o)}
                className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
              >
                <span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {initials || 'NV'}
                </span>
                <span className="hidden sm:block text-[13px] font-medium text-slate-800 max-w-[140px] truncate">
                  {user.fullName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-1">
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">
                      {user.fullName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {ROLE_LABELS[user.role] || user.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      navigate('/tai-khoan-ca-nhan');
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    <User className="w-4 h-4 text-slate-500" />
                    Tài khoản cá nhân
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setAccountMenuOpen(false);
                      await logout();
                      navigate('/dang-nhap', { replace: true });
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-[13px] text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-5 max-w-[1440px] w-full mx-auto space-y-3.5">
          {isAllowed ? (
            children
          ) : (
            <ForbiddenScreen
              onBackHome={() => navigate(getDefaultRouteForRole(user.role), { replace: true })}
            />
          )}
        </main>
      </div>
    </div>
  );
}
