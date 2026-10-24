import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { RoleCode } from '../../shared/types.ts';
import { useAuth, useToast } from '../context/AppContexts.tsx';
import {
  apiRequest,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatKg,
  todayIsoDate,
} from '../lib/api.ts';
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

const PAGE_SIZE = 10;

// ==================== PAYABLES PAGE (/cong-no-phai-tra) ====================
interface PayableItem {
  id: number;
  code: string;
  supplierId: number;
  supplierName: string;
  purchasingCode: string;
  receivedKg: number;
  unitPrice: number;
  txDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  payments: Array<{
    id: number;
    amount: number;
    paymentDate: string;
    methodNote: string;
    recordedByName: string;
  }>;
  isDemo: boolean;
}

export function PayablesPage() {
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [summary, setSummary] = useState({ totalPayable: 0, totalPaid: 0, totalRemaining: 0 });
  const [items, setItems] = useState<PayableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [payTarget, setPayTarget] = useState<PayableItem | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [methodNote, setMethodNote] = useState('Chuyển khoản ngân hàng');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        summary: { totalPayable: number; totalPaid: number; totalRemaining: number };
        items: PayableItem[];
      }>('/api/finance/payables');
      setSummary(res.summary);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách công nợ phải trả.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateFilter = (q: string, st: string) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (st) next.set('status', st);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (
        q &&
        !p.code.toLowerCase().includes(q) &&
        !p.supplierName.toLowerCase().includes(q) &&
        !p.purchasingCode.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, search, statusFilter]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      notifyError('Vui lòng nhập số tiền thanh toán hợp lệ lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/finance/payables/${payTarget.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: val,
          paymentDate,
          methodNote: methodNote.trim(),
        }),
      });
      notifySuccess('Đã ghi nhận khoản thanh toán nhà cung cấp.');
      setPayTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể ghi nhận thanh toán.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader title="Công nợ phải trả" />

      <CompactMetricsRow
        items={[
          { label: 'Tổng phát sinh mua NVL', value: formatCurrency(summary.totalPayable) },
          { label: 'Đã thanh toán NCC', value: formatCurrency(summary.totalPaid) },
          { label: 'Còn phải trả NCC', value: formatCurrency(summary.totalRemaining) },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã công nợ, nhà cung cấp, phiếu thu mua..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="UNPAID">Chưa thanh toán</option>
          <option value="PARTIAL_PAID">Thanh toán một phần</option>
          <option value="PAID">Đã tất toán</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        isFilteredEmpty={items.length > 0 && filtered.length === 0}
        emptyText="Chưa có khoản công nợ phải trả nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã công nợ</th>
                  <th className="py-2.5 px-3.5 font-medium">Nhà cung cấp</th>
                  <th className="py-2.5 px-3.5 font-medium">Phiếu thu mua</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Tổng phải trả</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã trả</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Còn lại</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {p.code}
                      <DemoMarker isDemo={p.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{p.supplierName}</td>
                    <td className="py-2.5 px-3.5 font-data">
                      {p.purchasingCode} ({formatKg(p.receivedKg)})
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatCurrency(p.totalAmount)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatCurrency(p.paidAmount)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-semibold text-slate-900">
                      {formatCurrency(p.remainingAmount)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={p.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      {p.remainingAmount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPayTarget(p);
                            setAmount(String(p.remainingAmount));
                            setPaymentDate(todayIsoDate());
                            setMethodNote('Chuyển khoản ngân hàng');
                          }}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                        >
                          Ghi nhận trả tiền
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Hoàn tất</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filtered.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      <ModalDrawer
        open={Boolean(payTarget)}
        title={payTarget ? `Thanh toán nhà cung cấp — ${payTarget.code}` : 'Ghi nhận thanh toán'}
        onClose={() => setPayTarget(null)}
      >
        {payTarget && (
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Nhà cung cấp:</span>{' '}
                <strong>{payTarget.supplierName}</strong>
              </p>
              <p>
                <span className="text-slate-500">Còn phải trả:</span>{' '}
                <strong className="font-data">{formatCurrency(payTarget.remainingAmount)}</strong>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Số tiền thanh toán (đ) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={payTarget.remainingAmount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Ngày thanh toán <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Hình thức / Ghi chú</label>
              <input
                type="text"
                value={methodNote}
                onChange={(e) => setMethodNote(e.target.value)}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            {payTarget.payments.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700">Lịch sử đã thanh toán</p>
                {payTarget.payments.map((pm) => (
                  <div key={pm.id} className="text-xs flex justify-between text-slate-600">
                    <span>
                      {formatDate(pm.paymentDate)} · {pm.methodNote}
                    </span>
                    <span className="font-data font-medium">{formatCurrency(pm.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Xác nhận thanh toán'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== RECEIVABLES PAGE (/cong-no-phai-thu) ====================
interface ReceivableItem {
  id: number;
  code: string;
  customerId: number;
  customerName: string;
  outboundCode: string;
  dispatchedKg: number;
  unitPrice: number;
  deliveryDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  payments: Array<{
    id: number;
    amount: number;
    paymentDate: string;
    methodNote: string;
    recordedByName: string;
  }>;
  isDemo: boolean;
}

export function ReceivablesPage() {
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [summary, setSummary] = useState({ totalReceivable: 0, totalCollected: 0, totalRemaining: 0 });
  const [items, setItems] = useState<ReceivableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [recTarget, setRecTarget] = useState<ReceivableItem | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [methodNote, setMethodNote] = useState('Chuyển khoản ngân hàng');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        summary: { totalReceivable: number; totalCollected: number; totalRemaining: number };
        items: ReceivableItem[];
      }>('/api/finance/receivables');
      setSummary(res.summary);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách công nợ phải thu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateFilter = (q: string, st: string) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (st) next.set('status', st);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (
        q &&
        !r.code.toLowerCase().includes(q) &&
        !r.customerName.toLowerCase().includes(q) &&
        !r.outboundCode.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, search, statusFilter]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recTarget) return;
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      notifyError('Vui lòng nhập số tiền thu hợp lệ lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/finance/receivables/${recTarget.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: val,
          paymentDate,
          methodNote: methodNote.trim(),
        }),
      });
      notifySuccess('Đã ghi nhận khoản thu từ khách hàng.');
      setRecTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể ghi nhận khoản thu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader title="Công nợ phải thu" />

      <CompactMetricsRow
        items={[
          { label: 'Tổng giá trị hàng thực giao', value: formatCurrency(summary.totalReceivable) },
          { label: 'Đã thu từ khách hàng', value: formatCurrency(summary.totalCollected) },
          { label: 'Còn phải thu', value: formatCurrency(summary.totalRemaining) },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã công nợ, khách hàng, đơn xuất hàng..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="UNPAID">Chưa thanh toán</option>
          <option value="PARTIAL_PAID">Thanh toán một phần</option>
          <option value="PAID">Đã tất toán</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        isFilteredEmpty={items.length > 0 && filtered.length === 0}
        emptyText="Chưa có khoản công nợ phải thu nào từ giao hàng thực tế"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã công nợ</th>
                  <th className="py-2.5 px-3.5 font-medium">Khách hàng</th>
                  <th className="py-2.5 px-3.5 font-medium">Đơn xuất / Thực giao</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Tổng phải thu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã thu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Còn lại</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {r.code}
                      <DemoMarker isDemo={r.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{r.customerName}</td>
                    <td className="py-2.5 px-3.5 font-data">
                      {r.outboundCode} ({formatKg(r.dispatchedKg)})
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatCurrency(r.totalAmount)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatCurrency(r.paidAmount)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-semibold text-slate-900">
                      {formatCurrency(r.remainingAmount)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={r.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      {r.remainingAmount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRecTarget(r);
                            setAmount(String(r.remainingAmount));
                            setPaymentDate(todayIsoDate());
                            setMethodNote('Chuyển khoản ngân hàng');
                          }}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                        >
                          Ghi nhận thu tiền
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Hoàn tất</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filtered.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      <ModalDrawer
        open={Boolean(recTarget)}
        title={recTarget ? `Thu tiền khách hàng — ${recTarget.code}` : 'Ghi nhận thu tiền'}
        onClose={() => setRecTarget(null)}
      >
        {recTarget && (
          <form onSubmit={handleRecordCollection} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Khách hàng:</span>{' '}
                <strong>{recTarget.customerName}</strong>
              </p>
              <p>
                <span className="text-slate-500">Số dư còn phải thu:</span>{' '}
                <strong className="font-data">{formatCurrency(recTarget.remainingAmount)}</strong>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Số tiền thu (đ) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={recTarget.remainingAmount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Ngày thu tiền <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Hình thức / Ghi chú</label>
              <input
                type="text"
                value={methodNote}
                onChange={(e) => setMethodNote(e.target.value)}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setRecTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Xác nhận đã thu'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== RECONCILIATION PAGE (/doi-chieu-so-lieu) ====================
export function ReconciliationPage() {
  const [tab, setTab] = useState<
    'purchasing' | 'nvl_plan' | 'fg_receipt' | 'outbound_dispatch'
  >('purchasing');
  const [data, setData] = useState<{
    purchasingVsReceipt: Array<Record<string, unknown>>;
    issuedVsShiftNvl: Array<Record<string, unknown>>;
    reportedVsConfirmedOutput: Array<Record<string, unknown>>;
    approvedVsDispatched: Array<Record<string, unknown>>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        purchasingVsReceipt: Array<Record<string, unknown>>;
        issuedVsShiftNvl: Array<Record<string, unknown>>;
        reportedVsConfirmedOutput: Array<Record<string, unknown>>;
        approvedVsDispatched: Array<Record<string, unknown>>;
      }>('/api/reconciliation');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu đối chiếu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const tabs = [
    { id: 'purchasing', label: 'Phiếu mua vs Nhập kho NVL' },
    { id: 'nvl_plan', label: 'NVL kho cấp vs Ca sử dụng' },
    { id: 'fg_receipt', label: 'Sản lượng ca vs Kho nhận' },
    { id: 'outbound_dispatch', label: 'Duyệt xuất vs Thực giao' },
  ] as const;

  return (
    <div className="space-y-3.5">
      <PageHeader title="Đối chiếu số liệu" />

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
              tab === t.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={!data}
        emptyText="Chưa có dữ liệu đối chiếu"
        onRetry={loadData}
      >
        {data && tab === 'purchasing' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Mã phiếu</th>
                    <th className="py-2.5 px-3.5">Nhà cung cấp</th>
                    <th className="py-2.5 px-3.5 text-right">Cân trên phiếu</th>
                    <th className="py-2.5 px-3.5 text-right">Kho thực nhận</th>
                    <th className="py-2.5 px-3.5 text-right">Chênh lệch</th>
                    <th className="py-2.5 px-3.5">Ghi chú chênh lệch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.purchasingVsReceipt.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2.5 px-3.5 font-data font-medium">
                        {String(r.code)}
                        <DemoMarker isDemo={Number(r.isDemo) === 1} />
                      </td>
                      <td className="py-2.5 px-3.5">{String(r.supplierName)}</td>
                      <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(r.ticketKg))}</td>
                      <td className="py-2.5 px-3.5 text-right font-data">
                        {r.receivedKg !== null ? formatKg(Number(r.receivedKg)) : 'Chưa nhập kho'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-data font-medium">
                        {r.diffKg !== null ? `${Number(r.diffKg)} kg` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-600">{String(r.note || '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'nvl_plan' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Kế hoạch</th>
                    <th className="py-2.5 px-3.5">Ngày / Ca</th>
                    <th className="py-2.5 px-3.5 text-right">NVL kho đã cấp</th>
                    <th className="py-2.5 px-3.5 text-right">NVL báo cáo ca đã dùng</th>
                    <th className="py-2.5 px-3.5 text-right">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.issuedVsShiftNvl.map((r, i) => {
                    const diff = Number(r.issuedKg) - Number(r.reportedUsedKg);
                    return (
                      <tr key={i}>
                        <td className="py-2.5 px-3.5 font-data font-medium">
                          {String(r.planCode)}
                          <DemoMarker isDemo={Number(r.isDemo) === 1} />
                        </td>
                        <td className="py-2.5 px-3.5">
                          {formatDate(String(r.planDate))} · {String(r.shift)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(r.issuedKg))}</td>
                        <td className="py-2.5 px-3.5 text-right font-data">
                          {formatKg(Number(r.reportedUsedKg))}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-data font-medium">{formatKg(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'fg_receipt' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Báo cáo ca</th>
                    <th className="py-2.5 px-3.5">Mã lô</th>
                    <th className="py-2.5 px-3.5 text-right">Sản lượng báo cáo</th>
                    <th className="py-2.5 px-3.5 text-right">Kho xác nhận nhận</th>
                    <th className="py-2.5 px-3.5">Trạng thái kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.reportedVsConfirmedOutput.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2.5 px-3.5 font-data">{String(r.reportCode)}</td>
                      <td className="py-2.5 px-3.5 font-data font-medium">
                        {String(r.batchCode)}
                        <DemoMarker isDemo={Number(r.isDemo) === 1} />
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-data">
                        {formatKg(Number(r.reportedOutputKg))}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-data font-medium">
                        {Number(r.confirmedReceiptKg) > 0 ? formatKg(Number(r.confirmedReceiptKg)) : 'Chờ nhận'}
                      </td>
                      <td className="py-2.5 px-3.5">
                        <StatusLabel status={String(r.warehouseStatus || 'PENDING_QC')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'outbound_dispatch' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Mã đơn xuất</th>
                    <th className="py-2.5 px-3.5">Khách hàng</th>
                    <th className="py-2.5 px-3.5 text-right">Khối lượng duyệt</th>
                    <th className="py-2.5 px-3.5 text-right">Đã bàn giao thực tế</th>
                    <th className="py-2.5 px-3.5 text-right">Còn lại</th>
                    <th className="py-2.5 px-3.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.approvedVsDispatched.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2.5 px-3.5 font-data font-medium">
                        {String(r.orderCode)}
                        <DemoMarker isDemo={Number(r.isDemo) === 1} />
                      </td>
                      <td className="py-2.5 px-3.5">{String(r.customerName)}</td>
                      <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(r.approvedKg))}</td>
                      <td className="py-2.5 px-3.5 text-right font-data font-medium">
                        {formatKg(Number(r.actualDispatchedKg))}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(r.remainingKg))}</td>
                      <td className="py-2.5 px-3.5">
                        <StatusLabel status={String(r.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ScreenStateView>
    </div>
  );
}

// ==================== REPORTS PAGE (/bao-cao — ALL 10 REPORT GROUPS + CSV EXPORT) ====================
export function ReportsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === RoleCode.OWNER;

  const [category, setCategory] = useState('production');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [shift, setShift] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [pendingNotes, setPendingNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reportCategories = useMemo(() => {
    const base = [
      { id: 'production', label: '1. Sản xuất theo ca' },
      { id: 'raw_inventory', label: '2. Nhập xuất tồn NVL' },
      { id: 'finished_inventory', label: '3. Tồn kho thành phẩm' },
      { id: 'purchasing', label: '4. Thu mua NVL' },
      { id: 'qc', label: '5. Kiểm tra chất lượng QC theo ca' },
      { id: 'outbound', label: '6. Xuất hàng thành phẩm' },
      { id: 'maintenance', label: '7. Sự cố & Bảo trì máy' },
      { id: 'operations', label: '8. Tổng hợp vận hành thực tế' },
    ];
    if (isOwner) {
      base.push(
        { id: 'receivables', label: '9. Công nợ phải thu' },
        { id: 'payables', label: '10. Công nợ phải trả' }
      );
    }
    return base;
  }, [isOwner]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ category });
      if (fromDate) qs.set('fromDate', fromDate);
      if (toDate) qs.set('toDate', toDate);
      if (shift) qs.set('shift', shift);
      const res = await apiRequest<{
        rows: Array<Record<string, unknown>>;
        pendingFormulaConfirmations?: string[];
      }>(`/api/reports?${qs.toString()}`);
      setRows(res.rows || []);
      setPendingNotes(res.pendingFormulaConfirmations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải báo cáo tổng hợp.');
    } finally {
      setLoading(false);
    }
  }, [category, fromDate, toDate, shift]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const keys = Object.keys(rows[0]).filter((k) => k !== 'isDemo');
    const csvLines = [
      keys.join(','),
      ...rows.map((r) =>
        keys
          .map((k) => {
            const val = r[k] === null || r[k] === undefined ? '' : String(r[k]);
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BATT-PPMS-BaoCao-${category}-${todayIsoDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]).filter((k) => k !== 'isDemo');
  }, [rows]);

  const colLabel: Record<string, string> = {
    code: 'Mã chứng từ',
    batchCode: 'Mã lô',
    date: 'Ngày',
    shift: 'Ca',
    planCode: 'Kế hoạch',
    staffName: 'Công nhân',
    nvlUsedKg: 'NVL dùng (kg)',
    outputKg: 'Sản lượng (kg)',
    status: 'Trạng thái',
    txType: 'Biến động',
    quantityKg: 'Khối lượng (kg)',
    balanceAfterKg: 'Tồn sau GD (kg)',
    referenceCode: 'Tham chiếu',
    actorName: 'Người thực hiện',
    grade: 'Phân loại',
    initialKg: 'Nhập ban đầu (kg)',
    dispatchedKg: 'Đã giao (kg)',
    availableKg: 'Khả dụng (kg)',
    qcStatus: 'Trạng thái QC',
    supplierName: 'Nhà cung cấp',
    purchasingStaff: 'NV thu mua',
    weighedKg: 'Cân phiếu (kg)',
    receivedKg: 'Thực nhận (kg)',
    unitPrice: 'Đơn giá (đ)',
    moistureNote: 'Độ ẩm ghi nhận',
    inspectorName: 'Nhân viên QC',
    customerName: 'Khách hàng',
    requestedKg: 'Yêu cầu (kg)',
    totalValue: 'Thành tiền (đ)',
    machineName: 'Thiết bị',
    issueType: 'Nhóm sự cố',
    severity: 'Mức độ',
    requestedByName: 'Người báo',
    assignedToName: 'NV bảo trì',
    outboundCode: 'Đơn xuất',
    purchasingCode: 'Phiếu mua',
    totalAmount: 'Tổng tiền (đ)',
    paidAmount: 'Đã thanh toán (đ)',
    remainingAmount: 'Còn lại (đ)',
    metric: 'Chỉ tiêu vận hành thực tế',
    unit: 'Đơn vị',
    value: 'Giá trị ghi nhận',
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Báo cáo tổng hợp"
        primaryAction={
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            Xuất tệp CSV
          </button>
        }
      />

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nhóm báo cáo</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
          >
            {reportCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Từ ngày</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2.5 py-1.5 text-[13px] font-data bg-slate-50 border border-slate-200 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Đến ngày</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2.5 py-1.5 text-[13px] font-data bg-slate-50 border border-slate-200 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Ca sản xuất</label>
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md"
          >
            <option value="">Tất cả ca</option>
            <option value="Ca 1">Ca 1</option>
            <option value="Ca 2">Ca 2</option>
            <option value="Ca 3">Ca 3</option>
          </select>
        </div>
        {(fromDate || toDate || shift) && (
          <button
            type="button"
            onClick={() => {
              setFromDate('');
              setToDate('');
              setShift('');
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Xóa lọc
          </button>
        )}
      </div>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        emptyText="Không có dữ liệu báo cáo trong khoảng thời gian đã chọn"
        onRetry={loadReport}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="py-2.5 px-3.5 font-medium whitespace-nowrap">
                      {colLabel[col] || col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80">
                    {columns.map((col) => {
                      const raw = r[col];
                      if (col === 'status' || col === 'qcStatus') {
                        return (
                          <td key={col} className="py-2.5 px-3.5">
                            <StatusLabel status={String(raw || '')} />
                          </td>
                        );
                      }
                      if (col === 'date') {
                        return (
                          <td key={col} className="py-2.5 px-3.5 font-data whitespace-nowrap">
                            {formatDate(String(raw || ''))}
                          </td>
                        );
                      }
                      if (col.endsWith('Kg')) {
                        return (
                          <td key={col} className="py-2.5 px-3.5 font-data">
                            {raw !== null && raw !== undefined ? formatKg(Number(raw)) : '—'}
                          </td>
                        );
                      }
                      if (col.endsWith('Amount') || col === 'unitPrice' || col === 'totalValue') {
                        return (
                          <td key={col} className="py-2.5 px-3.5 font-data">
                            {raw !== null && raw !== undefined ? formatCurrency(Number(raw)) : '—'}
                          </td>
                        );
                      }
                      return (
                        <td key={col} className="py-2.5 px-3.5">
                          <span className={typeof raw === 'number' ? 'font-data font-medium' : ''}>
                            {raw === null || raw === undefined
                              ? '—'
                              : typeof raw === 'number'
                                ? raw.toLocaleString('vi-VN')
                                : String(raw)}
                          </span>
                          {col === columns[0] && Boolean(r.isDemo) && <DemoMarker isDemo />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pendingNotes.length > 0 && (
          <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-1">
            <p className="font-semibold">Chỉ tiêu chờ doanh nghiệp xác nhận công thức chuẩn:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {pendingNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </ScreenStateView>
    </div>
  );
}
