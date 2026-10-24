const TOKEN_STORAGE_KEY = 'batt_ppms_session_token';

export function getStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

let onUnauthorizedCallback: (() => void) | null = null;

export function registerUnauthorizedHandler(cb: () => void): void {
  onUnauthorizedCallback = cb;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (res.status === 401 && path !== '/api/auth/login') {
    setStoredToken(null);
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  if (!res.ok) {
    const errMsg =
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
    throw new Error(errMsg);
  }

  return payload as T;
}

export interface UploadedFileResponse {
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

export async function uploadAttachmentFile(file: File): Promise<UploadedFileResponse> {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
  ];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Định dạng tệp không hợp lệ. Vui lòng chọn ảnh JPG, PNG, WEBP, SVG hoặc PDF.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Dung lượng tệp vượt quá giới hạn 5 MB.');
  }

  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<UploadedFileResponse>('/api/uploads', {
    method: 'POST',
    body: formData,
  });
}

// Consistent Vietnamese Formatting Utilities (dd/MM/yyyy and HH:mm)
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return str;
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return formatDate(value);
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

export function formatKg(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('vi-VN')} kg`;
}

export function formatCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('vi-VN')} đ`;
}

export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
