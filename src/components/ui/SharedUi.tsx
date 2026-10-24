import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRightCircle,
  MinusCircle,
  Search,
  X,
  Upload,
  Eye,
  FileText,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { STATUS_META } from '../../../shared/permissions.ts';
import { ROLE_LABELS, type AttachmentItem, type AuditHistoryItem } from '../../../shared/types.ts';
import { formatDateTime, uploadAttachmentFile, type UploadedFileResponse } from '../../lib/api.ts';

// ==================== PAGE HEADER ====================
export function PageHeader({
  title,
  primaryAction,
}: {
  title: string;
  primaryAction?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
      <h1 className="text-[22px] sm:text-[25px] font-semibold tracking-tight text-slate-900 text-balance">
        {title}
      </h1>
      {primaryAction && <div className="flex items-center gap-2 shrink-0">{primaryAction}</div>}
    </div>
  );
}

// ==================== COMPACT METRICS ROW (SMALL HEIGHT, CLICKABLE) ====================
export interface CompactMetricItem {
  label: string;
  value: string;
  onClick?: () => void;
}

export function CompactMetricsRow({ items }: { items: CompactMetricItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {items.map((item, idx) => {
        const inner = (
          <>
            <span className="text-[12px] text-slate-500 truncate block">{item.label}</span>
            <span className="text-[17px] font-semibold text-slate-900 font-data tabular-nums block mt-0.5 truncate">
              {item.value}
            </span>
          </>
        );
        return item.onClick ? (
          <button
            key={idx}
            type="button"
            onClick={item.onClick}
            className="text-left px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-slate-400 transition-colors focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            {inner}
          </button>
        ) : (
          <div key={idx} className="px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ==================== SEMANTIC STATUS INDICATOR (ICON + TEXT, UNBOXED ZERO-PILL) ====================
export function StatusLabel({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, tone: 'gray' as const };
  const toneClass =
    meta.tone === 'green'
      ? 'text-emerald-700'
      : meta.tone === 'amber'
        ? 'text-amber-700'
        : meta.tone === 'red'
          ? 'text-red-700'
          : meta.tone === 'blue'
            ? 'text-blue-700'
            : 'text-slate-600';

  const Icon =
    meta.tone === 'green'
      ? CheckCircle2
      : meta.tone === 'amber'
        ? Clock
        : meta.tone === 'red'
          ? XCircle
          : meta.tone === 'blue'
            ? ArrowRightCircle
            : MinusCircle;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap ${toneClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

// ==================== DEMO RECORD MARKER (QUIET UNBOXED METADATA) ====================
export function DemoMarker({ isDemo }: { isDemo?: boolean }) {
  if (!isDemo) return null;
  return (
    <span className="text-[11px] text-slate-400 font-normal whitespace-nowrap ml-1.5" title="Bản ghi mẫu môi trường thử nghiệm">
      · Mẫu thử nghiệm
    </span>
  );
}

// ==================== SEARCH & FILTER BAR ====================
export function SearchFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Tìm theo mã phiếu, tên...',
  children,
  onReset,
  hasActiveFilters,
}: {
  search: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 bg-white p-2.5 border border-slate-200 rounded-lg">
      <div className="relative flex-1 min-w-[210px]">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-8 py-1.5 text-[13.5px] bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-900 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            aria-label="Xóa từ khóa"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {children}
      {hasActiveFilters && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
        >
          Xóa bộ lọc
        </button>
      )}
    </div>
  );
}

// ==================== PAGINATION CONTROLS ====================
export function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[13px] text-slate-600">
      <span className="tabular-nums">
        Hiển thị {from}–{to} trong tổng số <strong className="text-slate-900">{totalItems}</strong> bản ghi
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 bg-white rounded-md disabled:opacity-40 hover:bg-slate-50 whitespace-nowrap"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Trước
          </button>
          <span className="px-2 font-data tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 bg-white rounded-md disabled:opacity-40 hover:bg-slate-50 whitespace-nowrap"
          >
            Sau
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== 6 SCREEN STATES HANDLER ====================
export function ScreenStateView({
  loading,
  error,
  isEmpty,
  isFilteredEmpty,
  emptyText,
  onRetry,
  onClearFilter,
  emptyAction,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  isFilteredEmpty?: boolean;
  emptyText: string;
  onRetry?: () => void;
  onClearFilter?: () => void;
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {[1, 2, 3, 4, 5].map((r) => (
          <div key={r} className="px-4 py-3 flex items-center justify-between gap-4 animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-32" />
            <div className="h-4 bg-slate-100 rounded flex-1 max-w-xs" />
            <div className="h-4 bg-slate-200 rounded w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-8 text-center space-y-3">
        <AlertTriangle className="w-6 h-6 text-red-600 mx-auto" />
        <p className="text-sm font-medium text-slate-900">
          {error || 'Không thể tải dữ liệu. Vui lòng thử lại.'}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-slate-900 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Thử lại
          </button>
        )}
      </div>
    );
  }

  if (isFilteredEmpty) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-2.5">
        <p className="text-sm font-medium text-slate-700">Không tìm thấy kết quả</p>
        {onClearFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="px-3.5 py-1.5 text-[13px] font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-3">
        <p className="text-sm font-medium text-slate-700">{emptyText}</p>
        {emptyAction && <div>{emptyAction}</div>}
      </div>
    );
  }

  return <>{children}</>;
}

export function ForbiddenScreen({ onBackHome }: { onBackHome: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-md mx-auto mt-8 space-y-3">
      <ShieldAlert className="w-7 h-7 text-red-600 mx-auto" />
      <h2 className="text-base font-semibold text-slate-900">Bạn không có quyền truy cập trang này</h2>
      <button
        type="button"
        onClick={onBackHome}
        className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
      >
        Về trang chính
      </button>
    </div>
  );
}

// ==================== CENTERED POPUP MODAL WITH UNSAVED CHANGES GUARD ====================
export function ModalDrawer({
  open,
  title,
  onClose,
  isDirty = false,
  wide = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  isDirty?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmDiscard(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDirty) {
          setConfirmDiscard(true);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isDirty, onClose]);

  if (!open) return null;

  const requestClose = () => {
    if (isDirty) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-3 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`relative bg-white w-full ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        } max-h-[90vh] flex flex-col rounded-xl border border-slate-200 shadow-xl overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50/60 shrink-0">
          <h2 className="text-[16px] sm:text-[17px] font-semibold text-slate-900 truncate">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200/60"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {confirmDiscard && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="text-[13px] text-amber-900">
              Dữ liệu đang nhập chưa được lưu. Bạn có muốn hủy các thay đổi này?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                Tiếp tục nhập
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded"
              >
                Bỏ thay đổi
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-5">{children}</div>
      </div>
    </div>
  );
}

// ==================== REASON DIALOG FOR REJECTION / RECHECK ====================
export function ReasonConfirmModal({
  open,
  title,
  actionLabel,
  placeholder = 'Nhập lý do cụ thể...',
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  actionLabel: string;
  placeholder?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErr('Vui lòng nhập lý do trước khi xác nhận.');
      return;
    }
    setErr('');
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-4 shadow-lg"
      >
        <h3 className="text-[16px] font-semibold text-slate-900">{title}</h3>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1">
            Lý do <span className="text-red-600">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (err) setErr('');
            }}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
          />
          {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setReason('');
              setErr('');
              onCancel();
            }}
            className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-[13px] font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
          >
            {loading ? 'Đang xử lý...' : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

// ==================== FILE UPLOAD WITH LIVE PREVIEW & REPLACE ====================
export function FileUploadBox({
  label,
  required,
  value,
  onChange,
  contextCaption,
}: {
  label: string;
  required?: boolean;
  value: UploadedFileResponse | null;
  onChange: (file: UploadedFileResponse | null) => void;
  contextCaption?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [previewLarge, setPreviewLarge] = useState(false);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      const uploaded = await uploadAttachmentFile(file);
      onChange(uploaded);
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : 'Tải tệp thất bại.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const isImage = value && value.mimeType.startsWith('image/');

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-slate-700">
        {label} {required && <span className="text-red-600">*</span>}
      </label>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml,application/pdf"
        onChange={handleSelect}
        className="hidden"
      />

      {!value ? (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-slate-300 rounded-md text-[13px] text-slate-600 hover:border-slate-500 hover:text-slate-900 bg-slate-50 transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>{uploading ? 'Đang tải tệp lên...' : 'Chọn ảnh hoặc chứng từ (tối đa 5 MB)'}</span>
        </button>
      ) : (
        <div className="border border-slate-200 rounded-md p-3 bg-slate-50 space-y-2">
          <div className="flex items-start gap-3">
            {isImage ? (
              <img
                src={value.fileUrl}
                alt={label}
                referrerPolicy="no-referrer"
                onClick={() => setPreviewLarge(true)}
                className="w-20 h-16 object-cover rounded border border-slate-200 bg-white cursor-pointer shrink-0"
              />
            ) : (
              <div className="w-16 h-16 flex items-center justify-center rounded border border-slate-200 bg-white shrink-0">
                <FileText className="w-6 h-6 text-slate-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-slate-900 truncate">{value.fileName}</p>
              {contextCaption && (
                <p className="text-[12px] text-slate-500 truncate mt-0.5">{contextCaption}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {isImage && (
                  <button
                    type="button"
                    onClick={() => setPreviewLarge(true)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-700 hover:underline"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Xem ảnh lớn
                  </button>
                )}
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                  className="text-[12px] font-medium text-slate-700 hover:text-slate-900 underline"
                >
                  {uploading ? 'Đang thay thế...' : 'Thay thế tệp'}
                </button>
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="text-[12px] text-red-600 hover:underline"
                >
                  Gỡ bỏ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      {previewLarge && value && (
        <ImageLightbox
          fileUrl={value.fileUrl}
          title={label}
          subtitle={contextCaption || value.fileName}
          onClose={() => setPreviewLarge(false)}
        />
      )}
    </div>
  );
}

// ==================== IMAGE LIGHTBOX WITH CONTEXT ====================
export function ImageLightbox({
  fileUrl,
  title,
  subtitle,
  onClose,
}: {
  fileUrl: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-3xl w-full overflow-hidden border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
            aria-label="Đóng xem ảnh"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 bg-slate-100 flex items-center justify-center max-h-[75vh] overflow-auto">
          {!broken ? (
            <img
              src={fileUrl}
              alt={title}
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              className="max-w-full max-h-[68vh] object-contain rounded bg-white"
            />
          ) : (
            <div className="py-12 px-6 text-center text-slate-600 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-slate-400" />
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-slate-500">Không thể hiển thị trực tiếp tệp đính kèm này.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== ATTACHMENTS GALLERY & AUDIT HISTORY LIST ====================
export function AttachmentListSection({
  recordReference,
  items,
}: {
  recordReference: string;
  items: AttachmentItem[];
}) {
  const [activePreview, setActivePreview] = useState<AttachmentItem | null>(null);

  if (!items || items.length === 0) {
    return <p className="text-[13px] text-slate-500 py-3">Chưa có chứng từ hoặc hình ảnh đính kèm.</p>;
  }

  return (
    <div className="space-y-2.5">
      {items.map((att) => {
        const isImg = att.mimeType.startsWith('image/');
        return (
          <div
            key={att.id}
            className="flex items-start gap-3 p-3 border border-slate-200 rounded-md bg-white"
          >
            {isImg ? (
              <img
                src={att.fileUrl}
                alt={att.docType}
                referrerPolicy="no-referrer"
                onClick={() => setActivePreview(att)}
                className="w-20 h-16 object-cover rounded border border-slate-200 bg-slate-50 cursor-pointer shrink-0"
              />
            ) : (
              <div className="w-16 h-16 flex items-center justify-center rounded border border-slate-200 bg-slate-50 shrink-0">
                <FileText className="w-6 h-6 text-slate-500" />
              </div>
            )}
            <div className="flex-1 min-w-0 text-[13px]">
              <p className="font-medium text-slate-900">
                {att.docType} <span className="text-slate-400">·</span>{' '}
                <span className="font-data text-xs text-slate-600">{recordReference}</span>
              </p>
              <p className="text-xs text-slate-500 truncate mt-0.5">{att.fileName}</p>
              <p className="text-xs text-slate-500 mt-1">
                Người gửi: {att.uploadedByName} · Thời điểm: {formatDateTime(att.createdAt)}
              </p>
            </div>
            {isImg ? (
              <button
                type="button"
                onClick={() => setActivePreview(att)}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-50 shrink-0 whitespace-nowrap"
              >
                Xem ảnh lớn
              </button>
            ) : (
              <a
                href={att.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-50 shrink-0 whitespace-nowrap"
              >
                Mở tệp
              </a>
            )}
          </div>
        );
      })}

      {activePreview && (
        <ImageLightbox
          fileUrl={activePreview.fileUrl}
          title={`${activePreview.docType} — ${recordReference}`}
          subtitle={`Người gửi: ${activePreview.uploadedByName} · ${formatDateTime(activePreview.createdAt)}`}
          onClose={() => setActivePreview(null)}
        />
      )}
    </div>
  );
}

export function HistoryTimelineSection({
  title = 'Lịch sử xử lý',
  items,
}: {
  title?: string;
  items: AuditHistoryItem[];
}) {
  if (!items || items.length === 0) {
    return <p className="text-[13px] text-slate-500 py-3">Chưa có lịch sử ghi nhận thêm.</p>;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[13px] font-semibold text-slate-800">{title}</h4>
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-md bg-white">
        {items.map((h) => (
          <div key={h.id} className="px-3.5 py-2.5 text-[13px] space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{h.action}</span>
              <span className="text-xs font-data text-slate-500">{formatDateTime(h.createdAt)}</span>
            </div>
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-1.5">
              <span>{h.actorName}</span>
              <span aria-hidden="true">·</span>
              <span>{ROLE_LABELS[h.actorRole] || h.actorRole}</span>
              {h.toStatus && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Trạng thái: {STATUS_META[h.toStatus]?.label || h.toStatus}</span>
                </>
              )}
            </div>
            {h.reason && (
              <p className="text-xs text-red-700 bg-red-50/70 px-2.5 py-1.5 rounded">
                Ghi chú / Lý do: {h.reason}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
