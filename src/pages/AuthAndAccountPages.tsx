import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { getDefaultRouteForRole } from '../../shared/permissions.ts';
import { ROLE_LABELS, RoleCode, type AuthUser } from '../../shared/types.ts';
import { useAuth, useToast } from '../context/AppContexts.tsx';
import { apiRequest, formatDate } from '../lib/api.ts';
import { signInWithGooglePopup } from '../lib/firebase.ts';
import {
  CompactMetricsRow,
  DemoMarker,
  ModalDrawer,
  PageHeader,
  PaginationControls,
  ScreenStateView,
  SearchFilterBar,
  StatusLabel,
} from '../components/ui/SharedUi.tsx';

const DEMO_ACCOUNTS = [
  { username: 'owner', roleLabel: 'Chủ doanh nghiệp' },
  { username: 'manager', roleLabel: 'Quản lý xưởng' },
  { username: 'purchasing1', roleLabel: 'Nhân viên thu mua' },
  { username: 'warehouse1', roleLabel: 'Thủ kho' },
  { username: 'staff1', roleLabel: 'Công nhân' },
  { username: 'qc1', roleLabel: 'Nhân viên QC' },
  { username: 'maint1', roleLabel: 'Nhân viên bảo trì' },
  { username: 'admin', roleLabel: 'Quản trị hệ thống' },
];

// ==================== LOGIN SCREEN ====================
export function LoginPage() {
  const { user, setAuthenticatedSession } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(getDefaultRouteForRole(user.role), { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setAuthenticatedSession(res.token, res.user);
      navigate(getDefaultRouteForRole(res.user.role), { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Đăng nhập không thành công.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setSubmitting(true);
    try {
      const googleUser = await signInWithGooglePopup();
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/google-session', {
        method: 'POST',
        body: JSON.stringify({ email: googleUser.email }),
      });
      setAuthenticatedSession(res.token, res.user);
      navigate(getDefaultRouteForRole(res.user.role), { replace: true });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể đăng nhập bằng Google. Vui lòng dùng tài khoản nội bộ.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 shadow-xs space-y-5">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-emerald-700 text-white font-bold text-sm flex items-center justify-center shrink-0">
            BATT
          </div>
          <div>
            <h1 className="text-[19px] font-semibold text-slate-900 leading-tight">BATT PPMS</h1>
            <p className="text-[12px] text-slate-500">Công ty Cổ phần Năng lượng Tái tạo BATT</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-username" className="block text-[13px] font-medium text-slate-700 mb-1">
              Tên đăng nhập <span className="text-red-600">*</span>
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="Ví dụ: manager"
              className="w-full px-3 py-2 text-[14px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="login-password" className="block text-[13px] font-medium text-slate-700">
                Mật khẩu <span className="text-red-600">*</span>
              </label>
              <Link to="/quen-mat-khau" className="text-[12px] text-slate-600 hover:text-slate-900 hover:underline">
                Quên mật khẩu
              </Link>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                placeholder="Nhập mật khẩu"
                className="w-full pl-3 pr-10 py-2 text-[14px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p role="alert" className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-[14px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50"
          >
            {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogleSignIn}
            className="w-full py-2 px-4 text-[13px] font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors disabled:opacity-50"
          >
            Đăng nhập bằng Google nội bộ
          </button>
        </form>

        {/* Clearly separated Demo Test Accounts Switcher */}
        <div className="pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowDemoAccounts((v) => !v)}
            className="w-full flex items-center justify-between text-[12px] font-medium text-slate-500 hover:text-slate-800"
          >
            <span>Tài khoản thử nghiệm (Môi trường Demo)</span>
            {showDemoAccounts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showDemoAccounts && (
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword('Batt@2026');
                    setErrorMsg('');
                  }}
                  className="text-left px-2.5 py-1.5 rounded border border-slate-200 hover:border-slate-400 bg-slate-50 text-[12px]"
                >
                  <span className="font-medium text-slate-900 block truncate">{acc.roleLabel}</span>
                  <span className="font-data text-[11px] text-slate-500">{acc.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== FORGOT PASSWORD SCREEN ====================
export function ForgotPasswordPage() {
  const [username, setUsername] = useState('');
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setErr('Vui lòng nhập tên đăng nhập.');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim() }),
      });
      setNotice(res.message);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h1 className="text-[18px] font-semibold text-slate-900">Đặt lại mật khẩu</h1>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Tên đăng nhập <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (err) setErr('');
              }}
              placeholder="Nhập tên đăng nhập của bạn"
              className="w-full px-3 py-2 text-[14px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
            {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
          </div>

          {notice && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-[13px] text-slate-700">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 text-[13.5px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
          >
            {loading ? 'Đang kiểm tra...' : 'Kiểm tra phương thức cấp lại'}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 text-center">
          <Link to="/dang-nhap" className="text-[13px] font-medium text-slate-700 hover:text-slate-900 hover:underline">
            Quay lại đăng nhập
          </Link>
        </div>
      </div>
    </div>
  );
}

// ==================== PERSONAL PROFILE SCREEN ====================
export function PersonalProfilePage() {
  const { user, refreshMe, logout } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const navigate = useNavigate();

  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdDirty, setPwdDirty] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdErr, setPwdErr] = useState('');

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone);
      setEmail(user.email);
    }
  }, [user]);

  if (!user) return null;

  const openEditProfile = () => {
    setFullName(user.fullName);
    setPhone(user.phone);
    setEmail(user.email);
    setProfileDirty(false);
    setEditProfileOpen(true);
  };

  const openChangePassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwdErr('');
    setPwdDirty(false);
    setChangePwdOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      notifyError('Họ tên không được để trống.');
      return;
    }
    setSavingProfile(true);
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
        }),
      });
      await refreshMe();
      notifySuccess('Đã cập nhật thông tin cá nhân.');
      setProfileDirty(false);
      setEditProfileOpen(false);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cập nhật thông tin.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setPwdErr('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.');
      return;
    }
    if (newPassword.length < 6) {
      setPwdErr('Mật khẩu mới cần có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr('Xác nhận mật khẩu mới chưa khớp.');
      return;
    }
    setPwdErr('');
    setSavingPwd(true);
    try {
      await apiRequest('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdDirty(false);
      setChangePwdOpen(false);
      notifySuccess('Đã đổi mật khẩu thành công.');
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Tài khoản cá nhân"
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openEditProfile}
              className="px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              Cập nhật thông tin
            </button>
            <button
              type="button"
              onClick={openChangePassword}
              className="px-3.5 py-2 text-[13px] font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md"
            >
              Đổi mật khẩu
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/dang-nhap', { replace: true });
              }}
              className="px-3.5 py-2 text-[13px] font-medium text-red-700 border border-red-200 bg-white hover:bg-red-50 rounded-md"
            >
              Đăng xuất
            </button>
          </div>
        }
      />

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <h2 className="text-[16px] font-semibold text-slate-900">Hồ sơ tài khoản</h2>
          <StatusLabel status={user.status} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13.5px]">
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Họ và tên</span>
            <span className="font-medium text-slate-900">{user.fullName}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Tên đăng nhập</span>
            <span className="font-data font-medium text-slate-900">{user.username}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Vai trò nghiệp vụ</span>
            <span className="font-medium text-slate-900">{ROLE_LABELS[user.role]}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Số điện thoại</span>
            <span className="font-data text-slate-900">{user.phone || '—'}</span>
          </div>
          <div className="sm:col-span-2">
            <span className="text-slate-500 block text-xs mb-0.5">Email liên hệ</span>
            <span className="font-data text-slate-900">{user.email || '—'}</span>
          </div>
        </div>
      </div>

      {/* Edit Personal Info Popup */}
      <ModalDrawer
        open={editProfileOpen}
        title="Cập nhật thông tin tài khoản"
        onClose={() => setEditProfileOpen(false)}
        isDirty={profileDirty}
      >
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px]">
            <div>
              <span className="text-slate-500 block text-xs">Tên đăng nhập</span>
              <span className="font-data font-medium text-slate-900">{user.username}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs">Vai trò nghiệp vụ</span>
              <span className="font-medium text-slate-900">{ROLE_LABELS[user.role]}</span>
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Họ và tên <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setProfileDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Số điện thoại</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setProfileDirty(true);
              }}
              placeholder="Ví dụ: 0903112233"
              className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setProfileDirty(true);
              }}
              placeholder="Ví dụ: ten@batt.vn"
              className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setEditProfileOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {savingProfile ? 'Đang lưu...' : 'Lưu thông tin'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Change Password Popup */}
      <ModalDrawer
        open={changePwdOpen}
        title="Đổi mật khẩu đăng nhập"
        onClose={() => setChangePwdOpen(false)}
        isDirty={pwdDirty}
      >
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Mật khẩu hiện tại <span className="text-red-600">*</span>
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPwdDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Mật khẩu mới <span className="text-red-600">*</span>
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPwdDirty(true);
              }}
              placeholder="Ít nhất 6 ký tự"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Nhập lại mật khẩu mới <span className="text-red-600">*</span>
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPwdDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          {pwdErr && <p className="text-xs text-red-600">{pwdErr}</p>}

          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setChangePwdOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingPwd}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {savingPwd ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
            </button>
          </div>
        </form>
      </ModalDrawer>
    </div>
  );
}

// ==================== ADMIN SYSTEM — USER & ROLE MANAGEMENT ====================
export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { notifySuccess, notifyError } = useToast();

  const [items, setItems] = useState<AuthUser[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [formFullName, setFormFullName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<RoleCode>(RoleCode.STAFF);
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [formDirty, setFormDirty] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (roleFilter) qs.set('role', roleFilter);
      if (statusFilter) qs.set('status', statusFilter);
      const res = await apiRequest<{
        summary: { total: number; active: number; inactive: number };
        items: AuthUser[];
      }>(`/api/users?${qs.toString()}`);
      setSummary(res.summary);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách tài khoản.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const openCreate = () => {
    setEditingUser(null);
    setFormFullName('');
    setFormUsername('');
    setFormPassword('');
    setFormRole(RoleCode.STAFF);
    setFormPhone('');
    setFormEmail('');
    setFormStatus('ACTIVE');
    setFormDirty(false);
    setFormErr('');
    setDrawerOpen(true);
  };

  const openEdit = (u: AuthUser) => {
    setEditingUser(u);
    setFormFullName(u.fullName);
    setFormUsername(u.username);
    setFormPassword('');
    setFormRole(u.role);
    setFormPhone(u.phone);
    setFormEmail(u.email);
    setFormStatus(u.status);
    setFormDirty(false);
    setFormErr('');
    setDrawerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFullName.trim() || !formUsername.trim()) {
      setFormErr('Vui lòng nhập đầy đủ họ tên và tài khoản đăng nhập.');
      return;
    }
    if (!editingUser && formPassword.length < 6) {
      setFormErr('Mật khẩu khởi tạo cần ít nhất 6 ký tự.');
      return;
    }
    setFormErr('');
    setSaving(true);
    try {
      if (editingUser) {
        await apiRequest(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            fullName: formFullName.trim(),
            role: formRole,
            phone: formPhone.trim(),
            email: formEmail.trim(),
            status: formStatus,
            resetPassword: formPassword.trim() || undefined,
          }),
        });
        notifySuccess('Đã cập nhật tài khoản người dùng.');
      } else {
        await apiRequest('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            fullName: formFullName.trim(),
            username: formUsername.trim(),
            password: formPassword,
            role: formRole,
            phone: formPhone.trim(),
            email: formEmail.trim(),
            status: formStatus,
          }),
        });
        notifySuccess('Đã tạo tài khoản người dùng mới.');
      }
      setFormDirty(false);
      setDrawerOpen(false);
      await fetchUsers();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Không thể lưu tài khoản.');
    } finally {
      setSaving(false);
    }
  };

  const hasFilters = Boolean(search.trim() || roleFilter || statusFilter);
  const paged = items.slice((page - 1) * pageSize, page * pageSize);
  const isEditingSelf = Boolean(editingUser && currentUser && editingUser.id === currentUser.id);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Phân quyền người dùng"
        primaryAction={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Tạo tài khoản
          </button>
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng tài khoản', value: String(summary.total), onClick: () => setStatusFilter('') },
          { label: 'Đang hoạt động', value: String(summary.active), onClick: () => setStatusFilter('ACTIVE') },
          { label: 'Ngừng sử dụng', value: String(summary.inactive), onClick: () => setStatusFilter('INACTIVE') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Tìm theo họ tên hoặc tài khoản..."
        hasActiveFilters={hasFilters}
        onReset={() => {
          setSearch('');
          setRoleFilter('');
          setStatusFilter('');
          setPage(1);
        }}
      >
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-700"
        >
          <option value="">Tất cả vai trò</option>
          {Object.entries(ROLE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-700"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="INACTIVE">Ngừng sử dụng</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={items.length === 0 && !hasFilters}
        isFilteredEmpty={items.length === 0 && hasFilters}
        emptyText="Chưa có tài khoản người dùng"
        onRetry={fetchUsers}
        onClearFilter={() => {
          setSearch('');
          setRoleFilter('');
          setStatusFilter('');
        }}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[12.5px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3.5">Tên người dùng</th>
                  <th className="py-2.5 px-3.5">Tài khoản đăng nhập</th>
                  <th className="py-2.5 px-3.5">Vai trò</th>
                  <th className="py-2.5 px-3.5">Trạng thái</th>
                  <th className="py-2.5 px-3.5">Ngày tạo</th>
                  <th className="py-2.5 px-3.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[13.5px]">
                {paged.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="hover:underline text-left"
                      >
                        {u.fullName}
                      </button>
                      <DemoMarker isDemo={u.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data text-slate-700">{u.username}</td>
                    <td className="py-2.5 px-3.5 text-slate-700">{ROLE_LABELS[u.role] || u.role}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={u.status} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data text-slate-600">{formatDate(u.createdAt)}</td>
                    <td className="py-2.5 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                      >
                        Chỉnh sửa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalItems={items.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      <ModalDrawer
        open={drawerOpen}
        title={editingUser ? `Chỉnh sửa tài khoản — ${editingUser.username}` : 'Tạo tài khoản mới'}
        isDirty={formDirty}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Họ và tên <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={formFullName}
              onChange={(e) => {
                setFormFullName(e.target.value);
                setFormDirty(true);
              }}
              placeholder="Ví dụ: Nguyễn Văn An"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Tên đăng nhập <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              disabled={Boolean(editingUser)}
              value={formUsername}
              onChange={(e) => {
                setFormUsername(e.target.value);
                setFormDirty(true);
              }}
              placeholder="Ví dụ: staff3"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md disabled:bg-slate-100 font-data focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Vai trò <span className="text-red-600">*</span>
              </label>
              <select
                disabled={isEditingSelf}
                value={formRole}
                onChange={(e) => {
                  setFormRole(e.target.value as RoleCode);
                  setFormDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
              >
                {Object.entries(ROLE_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Trạng thái <span className="text-red-600">*</span>
              </label>
              <select
                disabled={isEditingSelf}
                value={formStatus}
                onChange={(e) => {
                  setFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE');
                  setFormDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
              >
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="INACTIVE">Ngừng sử dụng</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Số điện thoại</label>
              <input
                type="text"
                value={formPhone}
                onChange={(e) => {
                  setFormPhone(e.target.value);
                  setFormDirty(true);
                }}
                placeholder="Ví dụ: 0903123456"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={formEmail}
                onChange={(e) => {
                  setFormEmail(e.target.value);
                  setFormDirty(true);
                }}
                placeholder="Ví dụ: an.nguyen@batt.vn"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              {editingUser ? 'Cấp lại mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu khởi tạo'}{' '}
              {!editingUser && <span className="text-red-600">*</span>}
            </label>
            <input
              type="password"
              value={formPassword}
              onChange={(e) => {
                setFormPassword(e.target.value);
                setFormDirty(true);
              }}
              placeholder="Tối thiểu 6 ký tự"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>

          {formErr && <p className="text-xs text-red-600">{formErr}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : editingUser ? 'Lưu thay đổi' : 'Tạo tài khoản'}
            </button>
          </div>
        </form>
      </ModalDrawer>
    </div>
  );
}
