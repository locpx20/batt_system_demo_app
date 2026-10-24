import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { RoleCode, type AuditHistoryItem } from '../../shared/types.ts';
import { useAuth, useToast } from '../context/AppContexts.tsx';
import { apiRequest, formatCurrency, formatDate, formatKg } from '../lib/api.ts';
import {
  CompactMetricsRow,
  DemoMarker,
  HistoryTimelineSection,
  ModalDrawer,
  PageHeader,
  PaginationControls,
  ScreenStateView,
  SearchFilterBar,
  StatusLabel,
} from '../components/ui/SharedUi.tsx';

const PAGE_SIZE = 10;

// ==================== SUPPLIERS PAGE (/nha-cung-cap) ====================
interface SupplierItem {
  id: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  contactPerson: string;
  note: string;
  status: string;
  isDemo: boolean;
  orderCount: number;
  totalReceivedKg: number;
  totalPurchaseValue: number;
}

interface SupplierDetail {
  supplier: SupplierItem;
  orders: Array<{
    id: number;
    code: string;
    requestDate: string;
    weighedKg: number | null;
    receivedKg: number | null;
    unitPrice: number | null;
    status: string;
    isDemo: number;
    assignedToName: string;
  }>;
  payables: Array<{
    code: string;
    txDate: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: string;
  }>;
  history: AuditHistoryItem[];
}

export function SuppliersPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [allItems, setAllItems] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierItem | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [detailData, setDetailData] = useState<SupplierDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const isOwner = user?.role === RoleCode.OWNER;

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: SupplierItem[] }>('/api/suppliers');
      setAllItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách nhà cung cấp.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const updateFilter = (nextQ: string, nextStatus: string) => {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextStatus) next.set('status', nextStatus);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (
        q &&
        !item.code.toLowerCase().includes(q) &&
        !item.name.toLowerCase().includes(q) &&
        !item.phone.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allItems, search, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setAddress('');
    setContactPerson('');
    setNote('');
    setStatus('ACTIVE');
    setDirty(false);
    setFormOpen(true);
  };

  const openEdit = (item: SupplierItem) => {
    setEditing(item);
    setName(item.name);
    setPhone(item.phone);
    setAddress(item.address);
    setContactPerson(item.contactPerson);
    setNote(item.note);
    setStatus(item.status);
    setDirty(false);
    setFormOpen(true);
  };

  const openDetail = async (id: number) => {
    try {
      const res = await apiRequest<SupplierDetail>(`/api/suppliers/${id}`);
      setDetailData(res);
      setDetailOpen(true);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể tải chi tiết nhà cung cấp.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      notifyError('Vui lòng nhập tên nhà cung cấp và số điện thoại.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/suppliers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            address: address.trim(),
            contactPerson: contactPerson.trim(),
            note: note.trim(),
            status,
          }),
        });
        notifySuccess('Đã cập nhật nhà cung cấp.');
      } else {
        await apiRequest('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            address: address.trim(),
            contactPerson: contactPerson.trim(),
            note: note.trim(),
          }),
        });
        notifySuccess('Đã thêm nhà cung cấp mới.');
      }
      setDirty(false);
      setFormOpen(false);
      await loadSuppliers();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể lưu thông tin nhà cung cấp.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = allItems.filter((i) => i.status === 'ACTIVE').length;
  const totalReceived = allItems.reduce((sum, i) => sum + i.totalReceivedKg, 0);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Nhà cung cấp"
        primaryAction={
          isOwner ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Thêm nhà cung cấp
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng nhà cung cấp', value: `${allItems.length}` },
          { label: 'Đang giao dịch', value: `${activeCount}`, onClick: () => updateFilter(search, 'ACTIVE') },
          { label: 'Ngừng sử dụng', value: `${allItems.length - activeCount}`, onClick: () => updateFilter(search, 'INACTIVE') },
          { label: 'Tổng NVL thực nhận', value: formatKg(totalReceived) },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã, tên nhà cung cấp, số điện thoại..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="INACTIVE">Ngừng sử dụng</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={allItems.length === 0}
        isFilteredEmpty={allItems.length > 0 && filteredItems.length === 0}
        emptyText="Chưa có dữ liệu nhà cung cấp"
        onRetry={loadSuppliers}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã NCC</th>
                  <th className="py-2.5 px-3.5 font-medium">Tên nhà cung cấp</th>
                  <th className="py-2.5 px-3.5 font-medium">Liên hệ</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Số chuyến</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">NVL đã nhận</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedItems.map((sup) => (
                  <tr key={sup.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {sup.code}
                      <DemoMarker isDemo={sup.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <p className="font-medium text-slate-900">{sup.name}</p>
                      {sup.address && <p className="text-xs text-slate-500 truncate max-w-xs">{sup.address}</p>}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <p className="font-data text-slate-800">{sup.phone}</p>
                      {sup.contactPerson && <p className="text-xs text-slate-500">{sup.contactPerson}</p>}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{sup.orderCount}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(sup.totalReceivedKg)}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={sup.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(sup.id)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => openEdit(sup)}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                        >
                          Sửa
                        </button>
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
          totalItems={filteredItems.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Create / Edit Drawer */}
      <ModalDrawer
        open={formOpen}
        title={editing ? `Cập nhật nhà cung cấp ${editing.code}` : 'Thêm nhà cung cấp mới'}
        onClose={() => setFormOpen(false)}
        isDirty={dirty}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Tên nhà cung cấp <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Ví dụ: Xưởng cưa mùn cưa Minh Tâm"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Số điện thoại <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setDirty(true);
                }}
                placeholder="090xxxxxxx"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Người liên hệ</label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => {
                  setContactPerson(e.target.value);
                  setDirty(true);
                }}
                placeholder="Họ tên đầu mối"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Địa chỉ bãi / xưởng</label>
            <input
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          {editing && (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Trạng thái giao dịch</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="INACTIVE">Ngừng sử dụng</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : 'Lưu thông tin'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Supplier History Drawer */}
      <ModalDrawer
        open={detailOpen && Boolean(detailData)}
        title={detailData ? `Hồ sơ nhà cung cấp ${detailData.supplier.code}` : 'Chi tiết nhà cung cấp'}
        onClose={() => setDetailOpen(false)}
        wide
      >
        {detailData && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
              <div>
                <span className="text-slate-500">Tên nhà cung cấp:</span>{' '}
                <strong className="text-slate-900">{detailData.supplier.name}</strong>
              </div>
              <div>
                <span className="text-slate-500">Điện thoại:</span>{' '}
                <span className="font-data text-slate-900">{detailData.supplier.phone}</span>
              </div>
              <div>
                <span className="text-slate-500">Người liên hệ:</span>{' '}
                <span className="text-slate-900">{detailData.supplier.contactPerson || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                <StatusLabel status={detailData.supplier.status} />
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Địa chỉ:</span>{' '}
                <span className="text-slate-900">{detailData.supplier.address || '—'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-[13px] font-semibold text-slate-800">Lịch sử phiếu thu mua NVL</h4>
              {detailData.orders.length === 0 ? (
                <p className="text-[13px] text-slate-500">Chưa có giao dịch thu mua nào</p>
              ) : (
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2 px-3">Mã phiếu</th>
                        <th className="py-2 px-3">Ngày</th>
                        <th className="py-2 px-3 text-right">Cân trên phiếu</th>
                        <th className="py-2 px-3 text-right">Thực nhận kho</th>
                        <th className="py-2 px-3">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailData.orders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2 px-3 font-data font-medium">{o.code}</td>
                          <td className="py-2 px-3 font-data">{formatDate(o.requestDate)}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(o.weighedKg)}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(o.receivedKg)}</td>
                          <td className="py-2 px-3">
                            <StatusLabel status={o.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {isOwner && (
              <div className="space-y-2">
                <h4 className="text-[13px] font-semibold text-slate-800">Công nợ phải trả liên quan</h4>
                {detailData.payables.length === 0 ? (
                  <p className="text-[13px] text-slate-500">Chưa phát sinh khoản công nợ phải trả</p>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-x-auto">
                    <table className="w-full text-left text-[12.5px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-2 px-3">Mã công nợ</th>
                          <th className="py-2 px-3">Ngày</th>
                          <th className="py-2 px-3 text-right">Tổng tiền</th>
                          <th className="py-2 px-3 text-right">Còn phải trả</th>
                          <th className="py-2 px-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailData.payables.map((p) => (
                          <tr key={p.code}>
                            <td className="py-2 px-3 font-data">{p.code}</td>
                            <td className="py-2 px-3 font-data">{formatDate(p.txDate)}</td>
                            <td className="py-2 px-3 text-right font-data">{formatCurrency(p.totalAmount)}</td>
                            <td className="py-2 px-3 text-right font-data font-medium">
                              {formatCurrency(p.remainingAmount)}
                            </td>
                            <td className="py-2 px-3">
                              <StatusLabel status={p.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <HistoryTimelineSection items={detailData.history} />
          </div>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== CUSTOMERS PAGE (/khach-hang) ====================
interface CustomerItem {
  id: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  contactPerson: string;
  acceptedGrade: string;
  note: string;
  status: string;
  isDemo: boolean;
  outboundCount: number;
  totalDispatchedKg: number;
  totalSalesAmount: number | null;
  totalCollectedAmount: number | null;
  totalRemainingAmount: number | null;
}

interface CustomerDetail {
  customer: CustomerItem;
  orders: Array<{
    id: number;
    code: string;
    requestedKg: number;
    dispatchedKg: number;
    acceptedGrade: string;
    expectedDate: string;
    status: string;
  }>;
  dispatches: Array<{
    code: string;
    dispatchedKg: number;
    recipientName: string;
    vehiclePlate: string;
    dispatchedAt: string;
    orderCode: string;
    batchCode: string;
  }>;
  receivables: Array<{
    id: number;
    code: string;
    deliveryDate: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: string;
    orderCode: string;
  }>;
  history: AuditHistoryItem[];
}

export function CustomersPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [allItems, setAllItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [acceptedGrade, setAcceptedGrade] = useState('Grade A');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [detailData, setDetailData] = useState<CustomerDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const isOwner = user?.role === RoleCode.OWNER;

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: CustomerItem[] }>('/api/customers');
      setAllItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách khách hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const updateFilter = (nextQ: string, nextStatus: string) => {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextStatus) next.set('status', nextStatus);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (
        q &&
        !item.code.toLowerCase().includes(q) &&
        !item.name.toLowerCase().includes(q) &&
        !item.phone.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allItems, search, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setAddress('');
    setContactPerson('');
    setAcceptedGrade('Grade A');
    setNote('');
    setStatus('ACTIVE');
    setDirty(false);
    setFormOpen(true);
  };

  const openEdit = (item: CustomerItem) => {
    setEditing(item);
    setName(item.name);
    setPhone(item.phone);
    setAddress(item.address);
    setContactPerson(item.contactPerson);
    setAcceptedGrade(item.acceptedGrade);
    setNote(item.note);
    setStatus(item.status);
    setDirty(false);
    setFormOpen(true);
  };

  const openDetail = async (id: number) => {
    try {
      const res = await apiRequest<CustomerDetail>(`/api/customers/${id}`);
      setDetailData(res);
      setDetailOpen(true);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể tải thông tin khách hàng.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      notifyError('Vui lòng nhập tên khách hàng và số điện thoại.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/customers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            address: address.trim(),
            contactPerson: contactPerson.trim(),
            acceptedGrade,
            note: note.trim(),
            status,
          }),
        });
        notifySuccess('Đã cập nhật khách hàng.');
      } else {
        await apiRequest('/api/customers', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            address: address.trim(),
            contactPerson: contactPerson.trim(),
            acceptedGrade,
            note: note.trim(),
          }),
        });
        notifySuccess('Đã thêm khách hàng mới.');
      }
      setDirty(false);
      setFormOpen(false);
      await loadCustomers();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể lưu thông tin khách hàng.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = allItems.filter((i) => i.status === 'ACTIVE').length;
  const totalDispatched = allItems.reduce((sum, i) => sum + i.totalDispatchedKg, 0);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Khách hàng"
        primaryAction={
          isOwner ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Thêm khách hàng
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng khách hàng', value: `${allItems.length}` },
          { label: 'Đang giao dịch', value: `${activeCount}`, onClick: () => updateFilter(search, 'ACTIVE') },
          { label: 'Tổng thành phẩm đã giao', value: formatKg(totalDispatched) },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã, tên khách hàng, số điện thoại..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="INACTIVE">Ngừng sử dụng</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={allItems.length === 0}
        isFilteredEmpty={allItems.length > 0 && filteredItems.length === 0}
        emptyText="Chưa có dữ liệu khách hàng"
        onRetry={loadCustomers}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã KH</th>
                  <th className="py-2.5 px-3.5 font-medium">Tên khách hàng</th>
                  <th className="py-2.5 px-3.5 font-medium">Liên hệ</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại nhận</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã giao</th>
                  {isOwner && <th className="py-2.5 px-3.5 font-medium text-right">Còn phải thu</th>}
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedItems.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {cust.code}
                      <DemoMarker isDemo={cust.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <p className="font-medium text-slate-900">{cust.name}</p>
                      {cust.address && <p className="text-xs text-slate-500 truncate max-w-xs">{cust.address}</p>}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <p className="font-data text-slate-800">{cust.phone}</p>
                      {cust.contactPerson && <p className="text-xs text-slate-500">{cust.contactPerson}</p>}
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-700 whitespace-nowrap">
                      {cust.acceptedGrade}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(cust.totalDispatchedKg)}</td>
                    {isOwner && (
                      <td className="py-2.5 px-3.5 text-right font-data">
                        {formatCurrency(cust.totalRemainingAmount)}
                      </td>
                    )}
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={cust.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(cust.id)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => openEdit(cust)}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                        >
                          Sửa
                        </button>
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
          totalItems={filteredItems.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Create / Edit Customer Drawer */}
      <ModalDrawer
        open={formOpen}
        title={editing ? `Cập nhật khách hàng ${editing.code}` : 'Thêm khách hàng mới'}
        onClose={() => setFormOpen(false)}
        isDirty={dirty}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Tên khách hàng <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Ví dụ: Công ty Nhiệt điện Sinh khối miền Trung"
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Số điện thoại <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Người liên hệ</label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => {
                  setContactPerson(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Phân loại thành phẩm chấp nhận <span className="text-red-600">*</span>
            </label>
            <select
              value={acceptedGrade}
              onChange={(e) => {
                setAcceptedGrade(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="Grade A">Grade A</option>
              <option value="Grade B">Grade B</option>
              <option value="Grade A & B">Grade A & B</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Địa chỉ giao hàng</label>
            <input
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          {editing && (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Trạng thái</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="INACTIVE">Ngừng sử dụng</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : 'Lưu thông tin'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Customer Detail Drawer */}
      <ModalDrawer
        open={detailOpen && Boolean(detailData)}
        title={detailData ? `Hồ sơ khách hàng ${detailData.customer.code}` : 'Chi tiết khách hàng'}
        onClose={() => setDetailOpen(false)}
        wide
      >
        {detailData && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
              <div>
                <span className="text-slate-500">Khách hàng:</span>{' '}
                <strong className="text-slate-900">{detailData.customer.name}</strong>
              </div>
              <div>
                <span className="text-slate-500">Điện thoại:</span>{' '}
                <span className="font-data text-slate-900">{detailData.customer.phone}</span>
              </div>
              <div>
                <span className="text-slate-500">Phân loại chấp nhận:</span>{' '}
                <strong className="text-slate-900">{detailData.customer.acceptedGrade}</strong>
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                <StatusLabel status={detailData.customer.status} />
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Địa chỉ:</span>{' '}
                <span className="text-slate-900">{detailData.customer.address || '—'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-[13px] font-semibold text-slate-800">Lịch sử đơn xuất hàng</h4>
              {detailData.orders.length === 0 ? (
                <p className="text-[13px] text-slate-500">Chưa có đơn xuất hàng nào</p>
              ) : (
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2 px-3">Mã đơn</th>
                        <th className="py-2 px-3">Ngày dự kiến</th>
                        <th className="py-2 px-3">Phân loại</th>
                        <th className="py-2 px-3 text-right">Yêu cầu</th>
                        <th className="py-2 px-3 text-right">Đã giao</th>
                        <th className="py-2 px-3">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailData.orders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2 px-3 font-data font-medium">{o.code}</td>
                          <td className="py-2 px-3 font-data">{formatDate(o.expectedDate)}</td>
                          <td className="py-2 px-3">{o.acceptedGrade}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(o.requestedKg)}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(o.dispatchedKg)}</td>
                          <td className="py-2 px-3">
                            <StatusLabel status={o.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {isOwner && (
              <div className="space-y-2">
                <h4 className="text-[13px] font-semibold text-slate-800">Công nợ phải thu</h4>
                {detailData.receivables.length === 0 ? (
                  <p className="text-[13px] text-slate-500">Chưa phát sinh khoản phải thu</p>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-x-auto">
                    <table className="w-full text-left text-[12.5px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-2 px-3">Mã công nợ</th>
                          <th className="py-2 px-3">Đơn xuất</th>
                          <th className="py-2 px-3 text-right">Tổng phải thu</th>
                          <th className="py-2 px-3 text-right">Còn lại</th>
                          <th className="py-2 px-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailData.receivables.map((r) => (
                          <tr key={r.id}>
                            <td className="py-2 px-3 font-data">{r.code}</td>
                            <td className="py-2 px-3 font-data">{r.orderCode}</td>
                            <td className="py-2 px-3 text-right font-data">{formatCurrency(r.totalAmount)}</td>
                            <td className="py-2 px-3 text-right font-data font-medium">
                              {formatCurrency(r.remainingAmount)}
                            </td>
                            <td className="py-2 px-3">
                              <StatusLabel status={r.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <HistoryTimelineSection items={detailData.history} />
          </div>
        )}
      </ModalDrawer>
    </div>
  );
}
