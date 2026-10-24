import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  RoleCode,
  type AttachmentItem,
  type AuditHistoryItem,
} from '../../shared/types.ts';
import { useAuth, useToast } from '../context/AppContexts.tsx';
import {
  apiRequest,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatKg,
  todayIsoDate,
  type UploadedFileResponse,
} from '../lib/api.ts';
import {
  AttachmentListSection,
  CompactMetricsRow,
  DemoMarker,
  FileUploadBox,
  HistoryTimelineSection,
  ModalDrawer,
  PageHeader,
  PaginationControls,
  ReasonConfirmModal,
  ScreenStateView,
  SearchFilterBar,
  StatusLabel,
} from '../components/ui/SharedUi.tsx';

const PAGE_SIZE = 10;

interface OutboundAllocation {
  id?: number;
  batchId: number;
  batchCode: string;
  productionDate: string;
  shift: string;
  shiftGrade: string;
  allocatedKg: number;
  dispatchedKg: number;
  batchAvailableKg: number;
  shiftQcCode?: string;
}

interface OutboundOrderItem {
  id: number;
  code: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  productName: string;
  requestedKg: number;
  dispatchedKg: number;
  remainingKg: number;
  acceptedGrade: string;
  unitPrice: number | null;
  totalValue: number | null;
  expectedDate: string;
  note: string;
  managerName: string;
  ownerName: string | null;
  ownerDecisionAt: string | null;
  ownerReason: string | null;
  recipientName: string;
  recipientPhone: string;
  vehiclePlate: string;
  deliveryNote: string;
  status: string;
  allocations: OutboundAllocation[];
  isDemo: boolean;
}

interface OutboundDetailResponse {
  order: OutboundOrderItem;
  allocations: OutboundAllocation[];
  shiftQcInspections: Array<{
    id: number;
    code: string;
    batchId: number;
    batchCode: string;
    productionDate: string;
    shift: string;
    grade: string;
    inspectionResult: string;
    moistureNote: string;
    durabilityNote: string;
    appearanceNote: string;
    foreignMatterNote: string;
    note: string;
    inspectorName: string;
    inspectedAt: string;
    attachments: AttachmentItem[];
  }>;
  dispatches: Array<{
    id: number;
    code: string;
    batchCode: string;
    dispatched_kg: number;
    recipient_name: string;
    vehicle_plate: string;
    warehouseKeeperName: string;
    dispatched_at: string;
  }>;
  attachments: AttachmentItem[];
  history: AuditHistoryItem[];
}

// ==================== OUTBOUND REQUESTS PAGE (/yeu-cau-xuat-hang) ====================
export function OutboundRequestsPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [orders, setOrders] = useState<OutboundOrderItem[]>([]);
  const [customers, setCustomers] = useState<
    Array<{ id: number; name: string; acceptedGrade: string; status: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Create Outbound + Live FIFO Preview Popup
  const [createOpen, setCreateOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [acceptedGrade, setAcceptedGrade] = useState('Grade A');
  const [requestedKg, setRequestedKg] = useState('');
  const [unitPrice, setUnitPrice] = useState('3350');
  const [expectedDate, setExpectedDate] = useState(todayIsoDate());
  const [note, setNote] = useState('');
  const [fifoPreview, setFifoPreview] = useState<{
    isSufficient: boolean;
    shortageKg: number;
    totalAllocatableKg: number;
    allocations: Array<{
      batchId: number;
      batchCode: string;
      productionDate: string;
      shift: string;
      grade: string;
      allocatableKg: number;
      proposedKg: number;
    }>;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Recipient & Vehicle Update Popup
  const [recipientTarget, setRecipientTarget] = useState<OutboundOrderItem | null>(null);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');

  // Detail Popup
  const [detailData, setDetailData] = useState<OutboundDetailResponse | null>(null);

  const isManager = user?.role === RoleCode.MANAGER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordRes, custRes] = await Promise.all([
        apiRequest<{ items: OutboundOrderItem[] }>('/api/outbound'),
        apiRequest<{ items: Array<{ id: number; name: string; acceptedGrade: string; status: string }> }>(
          '/api/customers'
        ),
      ]);
      setOrders(ordRes.items);
      setCustomers(custRes.items.filter((c) => c.status === 'ACTIVE'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách yêu cầu xuất hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Live FIFO Preview
  useEffect(() => {
    if (!createOpen) return;
    const kg = Number(requestedKg || 0);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{
          proposal: {
            isSufficient: boolean;
            shortageKg: number;
            totalAllocatableKg: number;
            allocations: Array<{
              batchId: number;
              batchCode: string;
              productionDate: string;
              shift: string;
              grade: string;
              allocatableKg: number;
              proposedKg: number;
            }>;
          };
        }>('/api/outbound/fifo-preview', {
          method: 'POST',
          body: JSON.stringify({ requestedKg: kg > 0 ? kg : 0, acceptedGrade }),
        });
        setFifoPreview(res.proposal);
      } catch {
        setFifoPreview(null);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [createOpen, requestedKg, acceptedGrade]);

  const updateFilter = (nextQ: string, nextStatus: string) => {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextStatus) next.set('status', nextStatus);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (q && !o.code.toLowerCase().includes(q) && !o.customerName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [orders, search, statusFilter]);

  const pagedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  const openDetail = async (id: number) => {
    try {
      const res = await apiRequest<OutboundDetailResponse>(`/api/outbound/${id}`);
      setDetailData(res);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể mở chi tiết yêu cầu xuất hàng.');
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const kg = Number(requestedKg);
    const price = Number(unitPrice);
    if (!customerId || !Number.isFinite(kg) || kg <= 0 || !Number.isFinite(price) || price < 0) {
      notifyError('Vui lòng chọn khách hàng, nhập khối lượng xuất lớn hơn 0 và đơn giá bán.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/outbound', {
        method: 'POST',
        body: JSON.stringify({
          customerId: Number(customerId),
          requestedKg: kg,
          acceptedGrade,
          unitPrice: price,
          expectedDate,
          note: note.trim(),
        }),
      });
      notifySuccess('Đã tạo yêu cầu xuất hàng theo đề xuất FIFO và trình Chủ doanh nghiệp duyệt.');
      setDirty(false);
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể tạo yêu cầu xuất hàng.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientTarget) return;
    if (!recipientName.trim() || !recipientPhone.trim() || !vehiclePlate.trim()) {
      notifyError('Vui lòng nhập họ tên người nhận, số điện thoại và biển số phương tiện.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/outbound/${recipientTarget.id}/recipient`, {
        method: 'PUT',
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          recipientPhone: recipientPhone.trim(),
          vehiclePlate: vehiclePlate.trim(),
          deliveryNote: deliveryNote.trim(),
        }),
      });
      notifySuccess('Đã cập nhật thông tin người nhận và biển số xe bàn giao.');
      setRecipientTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cập nhật thông tin bàn giao.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Yêu cầu xuất hàng"
        primaryAction={
          isManager ? (
            <button
              type="button"
              onClick={() => {
                const c = customers[0];
                setCustomerId(c ? String(c.id) : '');
                setAcceptedGrade(c?.acceptedGrade || 'Grade A');
                setRequestedKg('');
                setUnitPrice('3350');
                setExpectedDate(todayIsoDate());
                setNote('');
                setDirty(false);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Tạo yêu cầu xuất hàng
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng đơn xuất', value: `${orders.length}`, onClick: () => updateFilter(search, '') },
          {
            label: 'Chờ Chủ DN duyệt',
            value: `${orders.filter((o) => o.status === 'PENDING_OWNER').length}`,
            onClick: () => updateFilter(search, 'PENDING_OWNER'),
          },
          {
            label: 'Chờ nhập thông tin xe',
            value: `${orders.filter((o) => o.status === 'OWNER_APPROVED').length}`,
            onClick: () => updateFilter(search, 'OWNER_APPROVED'),
          },
          {
            label: 'Hoàn tất xuất hàng',
            value: `${orders.filter((o) => o.status === 'DISPATCHED').length}`,
            onClick: () => updateFilter(search, 'DISPATCHED'),
          },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã đơn xuất XH-..., tên khách hàng..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="PENDING_OWNER">Chờ Chủ DN quyết định</option>
          <option value="OWNER_APPROVED">Đã duyệt xuất</option>
          <option value="READY_DISPATCH">Chờ bàn giao thực tế</option>
          <option value="PARTIALLY_DISPATCHED">Đã giao một phần</option>
          <option value="DISPATCHED">Hoàn tất xuất hàng</option>
          <option value="REJECTED">Từ chối</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={orders.length === 0}
        isFilteredEmpty={orders.length > 0 && filteredOrders.length === 0}
        emptyText="Chưa có yêu cầu xuất hàng nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã đơn</th>
                  <th className="py-2.5 px-3.5 font-medium">Khách hàng</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Yêu cầu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã giao</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {o.code}
                      <DemoMarker isDemo={o.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <p className="font-medium text-slate-900">{o.customerName}</p>
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">{o.acceptedGrade}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(o.requestedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium">
                      {formatKg(o.dispatchedKg)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={o.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(o.id)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isManager &&
                        ['OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED'].includes(o.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              setRecipientTarget(o);
                              setRecipientName(o.recipientName);
                              setRecipientPhone(o.recipientPhone);
                              setVehiclePlate(o.vehiclePlate);
                              setDeliveryNote(o.deliveryNote);
                            }}
                            className="text-xs font-medium text-slate-800 hover:underline"
                          >
                            Thông tin xe nhận
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
          totalItems={filteredOrders.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Create Outbound + FIFO Preview Popup */}
      <ModalDrawer
        open={createOpen}
        title="Tạo yêu cầu xuất hàng (Đề xuất lô theo FIFO)"
        onClose={() => setCreateOpen(false)}
        isDirty={dirty}
        wide
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Khách hàng <span className="text-red-600">*</span>
              </label>
              <select
                value={customerId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setCustomerId(nextId);
                  const found = customers.find((c) => String(c.id) === nextId);
                  if (found) setAcceptedGrade(found.acceptedGrade);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="">Chọn khách hàng</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.acceptedGrade})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Phân loại yêu cầu <span className="text-red-600">*</span>
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Khối lượng cần xuất (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={requestedKg}
                onChange={(e) => {
                  setRequestedKg(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ví dụ: 3500"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Đơn giá bán (đ/kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={unitPrice}
                onChange={(e) => {
                  setUnitPrice(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Ngày xuất dự kiến <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => {
                  setExpectedDate(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Live FIFO Proposal Table */}
          {fifoPreview && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-semibold text-slate-800">
                  Đề xuất lô xuất theo FIFO — Đã đạt QC theo ca ({acceptedGrade})
                </span>
                <span className="font-data text-slate-600">
                  Khả dụng phân bổ: <strong>{formatKg(fifoPreview.totalAllocatableKg)}</strong>
                </span>
              </div>
              {!fifoPreview.isSufficient && Number(requestedKg) > 0 && (
                <div className="bg-red-50 border-b border-red-200 px-3.5 py-2 text-xs text-red-700 font-medium">
                  Không đủ tồn kho khả dụng cho phân loại {acceptedGrade}. Còn thiếu{' '}
                  {formatKg(fifoPreview.shortageKg)}.
                </div>
              )}
              {fifoPreview.allocations.length === 0 ? (
                <p className="p-3.5 text-xs text-slate-500">Không có lô tồn kho phù hợp phân loại này</p>
              ) : (
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-white border-b border-slate-100 text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Mã lô</th>
                      <th className="py-2 px-3">Ngày SX</th>
                      <th className="py-2 px-3">QC theo ca</th>
                      <th className="py-2 px-3 text-right">Khả dụng</th>
                      <th className="py-2 px-3 text-right">Đề xuất lấy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fifoPreview.allocations.map((a) => (
                      <tr key={a.batchId} className={a.proposedKg > 0 ? 'bg-emerald-50/40' : ''}>
                        <td className="py-2 px-3 font-data font-medium">{a.batchCode}</td>
                        <td className="py-2 px-3 font-data">{formatDate(a.productionDate)}</td>
                        <td className="py-2 px-3">{a.grade}</td>
                        <td className="py-2 px-3 text-right font-data">{formatKg(a.allocatableKg)}</td>
                        <td className="py-2 px-3 text-right font-data font-semibold text-emerald-800">
                          {a.proposedKg > 0 ? formatKg(a.proposedKg) : '0 kg'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú xuất hàng</label>
            <textarea
              rows={2}
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
              onClick={() => setCreateOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving || Boolean(fifoPreview && !fifoPreview.isSufficient && Number(requestedKg) > 0)}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang gửi...' : 'Tạo & trình Chủ DN duyệt'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Update Recipient & Vehicle Popup */}
      <ModalDrawer
        open={Boolean(recipientTarget)}
        title={recipientTarget ? `Thông tin xe & người nhận — ${recipientTarget.code}` : 'Thông tin bàn giao'}
        onClose={() => setRecipientTarget(null)}
      >
        {recipientTarget && (
          <form onSubmit={handleSaveRecipient} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Họ tên người nhận / Tài xế <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Ví dụ: Nguyễn Văn Hải"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Số điện thoại tài xế <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Biển số xe <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  placeholder="Ví dụ: 43C-189.25"
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú giao nhận</label>
              <textarea
                rows={2}
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setRecipientTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Lưu thông tin bàn giao'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>

      {/* Outbound Detail Popup */}
      <OutboundDetailDrawer detailData={detailData} onClose={() => setDetailData(null)} />
    </div>
  );
}

function OutboundDetailDrawer({
  detailData,
  onClose,
  footerActions,
}: {
  detailData: OutboundDetailResponse | null;
  onClose: () => void;
  footerActions?: React.ReactNode;
}) {
  return (
    <ModalDrawer
      open={Boolean(detailData)}
      title={detailData ? `Hồ sơ xuất hàng ${detailData.order.code}` : 'Chi tiết xuất hàng'}
      onClose={onClose}
      wide
    >
      {detailData && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
            <div>
              <span className="text-slate-500">Khách hàng:</span>{' '}
              <strong className="text-slate-900">{detailData.order.customerName}</strong>
            </div>
            <div>
              <span className="text-slate-500">Trạng thái:</span>{' '}
              <StatusLabel status={detailData.order.status} />
            </div>
            <div>
              <span className="text-slate-500">Phân loại yêu cầu:</span>{' '}
              <strong>{detailData.order.acceptedGrade}</strong>
            </div>
            <div>
              <span className="text-slate-500">Khối lượng yêu cầu / Đã giao:</span>{' '}
              <strong className="font-data">
                {formatKg(detailData.order.requestedKg)} / {formatKg(detailData.order.dispatchedKg)}
              </strong>
            </div>
            {detailData.order.unitPrice !== null && (
              <div>
                <span className="text-slate-500">Đơn giá / Giá trị:</span>{' '}
                <span className="font-data">
                  {formatCurrency(detailData.order.unitPrice)} ({formatCurrency(detailData.order.totalValue)})
                </span>
              </div>
            )}
            {detailData.order.vehiclePlate && (
              <div>
                <span className="text-slate-500">Phương tiện / Người nhận:</span>{' '}
                <span className="font-data font-medium">{detailData.order.vehiclePlate}</span> —{' '}
                {detailData.order.recipientName}
              </div>
            )}
            {detailData.order.ownerReason && (
              <div className="sm:col-span-2 text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs">
                Ý kiến Chủ doanh nghiệp: {detailData.order.ownerReason}
              </div>
            )}
          </div>

          {footerActions}

          <div className="space-y-2">
            <h4 className="text-[13px] font-semibold text-slate-800">Lô phân bổ theo FIFO</h4>
            <div className="border border-slate-200 rounded-md overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Mã lô</th>
                    <th className="py-2 px-3">Ngày SX</th>
                    <th className="py-2 px-3">QC theo ca</th>
                    <th className="py-2 px-3 text-right">Phân bổ</th>
                    <th className="py-2 px-3 text-right">Đã bàn giao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailData.allocations.map((a) => (
                    <tr key={a.batchId}>
                      <td className="py-2 px-3 font-data font-medium">{a.batchCode}</td>
                      <td className="py-2 px-3 font-data">{formatDate(a.productionDate)}</td>
                      <td className="py-2 px-3 font-medium">{a.shiftGrade}</td>
                      <td className="py-2 px-3 text-right font-data">{formatKg(a.allocatedKg)}</td>
                      <td className="py-2 px-3 text-right font-data font-medium">{formatKg(a.dispatchedKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-[13px] font-semibold text-slate-800">
              Hồ sơ QC theo ca của các lô phân bổ
            </h4>
            {detailData.shiftQcInspections.length === 0 ? (
              <p className="text-[13px] text-slate-500">Chưa có biên bản QC theo ca</p>
            ) : (
              detailData.shiftQcInspections.map((q) => (
                <div key={q.id} className="border border-slate-200 rounded-md p-3.5 space-y-2 bg-white text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-data font-semibold">{q.code}</span> · Lô{' '}
                      <span className="font-data font-medium">{q.batchCode}</span> ({q.shift})
                    </div>
                    <span className="text-xs font-data text-slate-500">
                      {q.inspectorName} · {formatDateTime(q.inspectedAt)}
                    </span>
                  </div>
                  <p>
                    Kết quả phân loại QC theo ca:{' '}
                    <strong className="text-emerald-700">{q.grade}</strong>
                    {q.moistureNote ? ` · Độ ẩm: ${q.moistureNote}` : ''}
                    {q.appearanceNote ? ` · Ngoại quan: ${q.appearanceNote}` : ''}
                  </p>
                  <AttachmentListSection recordReference={`${q.batchCode} (${q.code})`} items={q.attachments} />
                </div>
              ))
            )}
          </div>

          <HistoryTimelineSection items={detailData.history} />
        </div>
      )}
    </ModalDrawer>
  );
}

// ==================== OWNER OUTBOUND APPROVAL PAGE (/duyet-xuat-hang) ====================
export function OwnerOutboundApprovalPage() {
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';

  const [orders, setOrders] = useState<OutboundOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailData, setDetailData] = useState<OutboundDetailResponse | null>(null);
  const [rejectOrderId, setRejectOrderId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: OutboundOrderItem[] }>('/api/outbound');
      setOrders(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách duyệt xuất hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) => !q || o.code.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const submitOwnerDecision = async (
    orderId: number,
    decision: 'APPROVE' | 'REJECT',
    reason?: string
  ) => {
    setSaving(true);
    try {
      await apiRequest(`/api/outbound/${orderId}/owner-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      notifySuccess(
        decision === 'APPROVE'
          ? 'Đã duyệt xuất hàng. Chờ Quản lý xưởng cập nhật xe và Thủ kho bàn giao.'
          : 'Đã từ chối yêu cầu xuất hàng.'
      );
      setRejectOrderId(null);
      setDetailData(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xử lý quyết định xuất hàng.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader title="Duyệt xuất hàng" />

      <CompactMetricsRow
        items={[
          {
            label: 'Chờ Chủ doanh nghiệp quyết định',
            value: `${orders.filter((o) => o.status === 'PENDING_OWNER').length}`,
          },
          {
            label: 'Đã duyệt xuất',
            value: `${orders.filter((o) => ['OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED', 'DISPATCHED'].includes(o.status)).length}`,
          },
          {
            label: 'Đã từ chối',
            value: `${orders.filter((o) => o.status === 'REJECTED').length}`,
          },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => {
          const next = new URLSearchParams();
          if (val) next.set('q', val);
          setSearchParams(next, { replace: true });
        }}
        searchPlaceholder="Tìm theo mã đơn xuất, khách hàng..."
        hasActiveFilters={Boolean(search)}
        onReset={() => setSearchParams(new URLSearchParams(), { replace: true })}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={orders.length === 0}
        isFilteredEmpty={orders.length > 0 && filtered.length === 0}
        emptyText="Chưa có yêu cầu xuất hàng nào"
        onRetry={loadData}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã đơn</th>
                  <th className="py-2.5 px-3.5 font-medium">Khách hàng</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại (QC ca)</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Khối lượng</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Giá trị dự kiến</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày dự kiến</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Quyết định</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {o.code}
                      <DemoMarker isDemo={o.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{o.customerName}</td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">{o.acceptedGrade}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(o.requestedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatCurrency(o.totalValue)}</td>
                    <td className="py-2.5 px-3.5 font-data whitespace-nowrap">{formatDate(o.expectedDate)}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={o.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const d = await apiRequest<OutboundDetailResponse>(`/api/outbound/${o.id}`);
                          setDetailData(d);
                        }}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Xem hồ sơ & QC ca
                      </button>
                      {o.status === 'PENDING_OWNER' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void submitOwnerDecision(o.id, 'APPROVE')}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Duyệt xuất
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectOrderId(o.id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>

      <OutboundDetailDrawer
        detailData={detailData}
        onClose={() => setDetailData(null)}
        footerActions={
          detailData?.order.status === 'PENDING_OWNER' ? (
            <div className="flex flex-wrap items-center justify-end gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
              <button
                type="button"
                onClick={() => setRejectOrderId(detailData.order.id)}
                className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-white rounded hover:bg-red-50"
              >
                Từ chối xuất hàng
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitOwnerDecision(detailData.order.id, 'APPROVE')}
                className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded"
              >
                Duyệt cho phép xuất hàng
              </button>
            </div>
          ) : undefined
        }
      />

      <ReasonConfirmModal
        open={rejectOrderId !== null}
        title="Từ chối yêu cầu xuất hàng"
        actionLabel="Xác nhận từ chối"
        loading={saving}
        onCancel={() => setRejectOrderId(null)}
        onConfirm={(reason) => {
          if (rejectOrderId !== null) {
            void submitOwnerDecision(rejectOrderId, 'REJECT', reason);
          }
        }}
      />
    </div>
  );
}

// ==================== OUTBOUND DISPATCH PAGE (/ban-giao-xuat-hang) ====================
export function OutboundDispatchPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';

  const [orders, setOrders] = useState<OutboundOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dispatchTarget, setDispatchTarget] = useState<OutboundOrderItem | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<number, string>>({});
  const [dispatchNote, setDispatchNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [detailData, setDetailData] = useState<OutboundDetailResponse | null>(null);
  const isWarehouseKeeper = user?.role === RoleCode.WAREHOUSE_KEEPER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: OutboundOrderItem[] }>('/api/outbound');
      setOrders(
        res.items.filter((o) =>
          ['OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED', 'DISPATCHED'].includes(o.status)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách bàn giao xuất hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        !q ||
        o.code.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.vehiclePlate.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const openDispatchModal = (order: OutboundOrderItem) => {
    const initLines: Record<number, string> = {};
    for (const a of order.allocations) {
      const rem = Math.max(0, Math.round((a.allocatedKg - a.dispatchedKg) * 100) / 100);
      initLines[a.batchId] = rem > 0 ? String(rem) : '0';
    }
    setDispatchTarget(order);
    setLineInputs(initLines);
    setDispatchNote('');
    setDirty(false);
  };

  const handleConfirmDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchTarget) return;
    const lines = Object.entries(lineInputs)
      .map(([bId, val]) => ({ batchId: Number(bId), dispatchedKg: Number(val) }))
      .filter((l) => Number.isFinite(l.dispatchedKg) && l.dispatchedKg > 0);

    if (lines.length === 0) {
      notifyError('Vui lòng nhập khối lượng thực tế bàn giao lớn hơn 0 cho ít nhất một lô.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest(`/api/outbound/${dispatchTarget.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ lines, note: dispatchNote.trim() }),
      });
      notifySuccess('Đã xác nhận bàn giao xuất hàng thực tế và trừ tồn kho thành phẩm.');
      setDirty(false);
      setDispatchTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xác nhận bàn giao xuất hàng.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader title="Bàn giao xuất hàng" />

      <CompactMetricsRow
        items={[
          {
            label: 'Sẵn sàng bàn giao',
            value: `${orders.filter((o) => o.status === 'READY_DISPATCH').length}`,
          },
          {
            label: 'Đang giao một phần',
            value: `${orders.filter((o) => o.status === 'PARTIALLY_DISPATCHED').length}`,
          },
          {
            label: 'Đã hoàn tất bàn giao',
            value: `${orders.filter((o) => o.status === 'DISPATCHED').length}`,
          },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => {
          const next = new URLSearchParams();
          if (val) next.set('q', val);
          setSearchParams(next, { replace: true });
        }}
        searchPlaceholder="Tìm theo mã đơn xuất, khách hàng, biển số xe..."
        hasActiveFilters={Boolean(search)}
        onReset={() => setSearchParams(new URLSearchParams(), { replace: true })}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={orders.length === 0}
        isFilteredEmpty={orders.length > 0 && filtered.length === 0}
        emptyText="Chưa có đơn xuất hàng đã duyệt nào chờ bàn giao"
        onRetry={loadData}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã đơn</th>
                  <th className="py-2.5 px-3.5 font-medium">Khách hàng</th>
                  <th className="py-2.5 px-3.5 font-medium">Người nhận / Xe</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Yêu cầu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã giao</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Còn lại</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {o.code}
                      <DemoMarker isDemo={o.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{o.customerName}</td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {o.vehiclePlate ? (
                        <>
                          <span className="font-data font-medium">{o.vehiclePlate}</span> · {o.recipientName}
                        </>
                      ) : (
                        <span className="text-xs text-amber-700">Chờ Quản lý cập nhật xe</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(o.requestedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium">{formatKg(o.dispatchedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(o.remainingKg)}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={o.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const d = await apiRequest<OutboundDetailResponse>(`/api/outbound/${o.id}`);
                          setDetailData(d);
                        }}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isWarehouseKeeper &&
                        ['READY_DISPATCH', 'PARTIALLY_DISPATCHED'].includes(o.status) && (
                          <button
                            type="button"
                            onClick={() => openDispatchModal(o)}
                            className="px-3 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                          >
                            Xác nhận bàn giao
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>

      <ModalDrawer
        open={Boolean(dispatchTarget)}
        title={dispatchTarget ? `Xác nhận bàn giao thực tế — ${dispatchTarget.code}` : 'Bàn giao xuất hàng'}
        onClose={() => setDispatchTarget(null)}
        isDirty={dirty}
        wide
      >
        {dispatchTarget && (
          <form onSubmit={handleConfirmDispatch} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px] grid grid-cols-1 sm:grid-cols-2 gap-2">
              <p>
                <span className="text-slate-500">Khách hàng:</span>{' '}
                <strong>{dispatchTarget.customerName}</strong>
              </p>
              <p>
                <span className="text-slate-500">Xe & Người nhận:</span>{' '}
                <strong className="font-data">{dispatchTarget.vehiclePlate}</strong> —{' '}
                {dispatchTarget.recipientName}
              </p>
              <p>
                <span className="text-slate-500">Còn cần bàn giao:</span>{' '}
                <strong className="font-data">{formatKg(dispatchTarget.remainingKg)}</strong>
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-[13px] font-semibold text-slate-800">
                Khối lượng bàn giao thực tế theo từng lô FIFO (hỗ trợ giao một phần hoặc đủ đơn)
              </label>
              <div className="border border-slate-200 rounded-md overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Mã lô</th>
                      <th className="py-2 px-3 text-right">Phân bổ</th>
                      <th className="py-2 px-3 text-right">Đã giao trước</th>
                      <th className="py-2 px-3 text-right">Còn lại của lô</th>
                      <th className="py-2 px-3 text-right">Thực xuất lần này (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dispatchTarget.allocations.map((a) => {
                      const rem = Math.max(0, Math.round((a.allocatedKg - a.dispatchedKg) * 100) / 100);
                      return (
                        <tr key={a.batchId}>
                          <td className="py-2 px-3 font-data font-medium">{a.batchCode}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(a.allocatedKg)}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(a.dispatchedKg)}</td>
                          <td className="py-2 px-3 text-right font-data">{formatKg(rem)}</td>
                          <td className="py-2 px-3 text-right w-40">
                            <input
                              type="number"
                              min="0"
                              max={rem}
                              step="any"
                              disabled={rem <= 0}
                              value={lineInputs[a.batchId] ?? ''}
                              onChange={(e) => {
                                setLineInputs((prev) => ({
                                  ...prev,
                                  [a.batchId]: e.target.value,
                                }));
                                setDirty(true);
                              }}
                              className="w-full px-2.5 py-1 text-right font-data border border-slate-300 rounded focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú bàn giao tại kho</label>
              <textarea
                rows={2}
                value={dispatchNote}
                onChange={(e) => {
                  setDispatchNote(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDispatchTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang trừ tồn kho...' : 'Xác nhận bàn giao thực tế'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>

      <OutboundDetailDrawer detailData={detailData} onClose={() => setDetailData(null)} />
    </div>
  );
}

// ==================== MAINTENANCE PAGE (/su-co-may-moc) ====================
interface MaintenanceItem {
  id: number;
  code: string;
  machineId: number;
  machineCode: string;
  machineName: string;
  requestedBy: number;
  requestedByName: string;
  issueType: string;
  severity: string;
  description: string;
  assignedByName: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  assignmentNote: string;
  repairResult: string;
  materialsUsed: string;
  completedWorkAt: string | null;
  repairNote: string;
  rejectReason: string | null;
  status: string;
  attachments: AttachmentItem[];
  history: AuditHistoryItem[];
  isDemo: boolean;
  createdAt: string;
}

export function MaintenancePage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [machines, setMachines] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [techList, setTechList] = useState<Array<{ id: number; fullName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create incident
  const [createOpen, setCreateOpen] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [issueType, setIssueType] = useState('Cơ khí');
  const [severity, setSeverity] = useState('Cần xử lý trong ca');
  const [description, setDescription] = useState('');
  const [issuePhoto, setIssuePhoto] = useState<UploadedFileResponse | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manager atomic receive & assign
  const [assignTarget, setAssignTarget] = useState<MaintenanceItem | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [assignmentNote, setAssignmentNote] = useState('');

  // Maintenance staff report completion
  const [reportTarget, setReportTarget] = useState<MaintenanceItem | null>(null);
  const [repairResult, setRepairResult] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [repairNote, setRepairNote] = useState('');
  const [repairPhoto, setRepairPhoto] = useState<UploadedFileResponse | null>(null);

  // Detail & Reject
  const [detailTarget, setDetailTarget] = useState<MaintenanceItem | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);

  const canCreate = user?.role === RoleCode.STAFF || user?.role === RoleCode.MANAGER;
  const isManager = user?.role === RoleCode.MANAGER;
  const isMaint = user?.role === RoleCode.MAINTENANCE_STAFF;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, dirRes] = await Promise.all([
        apiRequest<{ items: MaintenanceItem[] }>('/api/maintenance/requests'),
        apiRequest<{
          staffList: Array<{ id: number; fullName: string; role: string }>;
          machines: Array<{ id: number; code: string; name: string }>;
        }>('/api/directory/options'),
      ]);
      setItems(reqRes.items);
      setMachines(dirRes.machines);
      setTechList(
        dirRes.staffList
          .filter((u) => u.role === RoleCode.MAINTENANCE_STAFF)
          .map((u) => ({ id: u.id, fullName: u.fullName }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách sự cố & bảo trì.');
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
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((m) => {
      if (statusFilter && m.status !== statusFilter) return false;
      if (
        q &&
        !m.code.toLowerCase().includes(q) &&
        !m.machineName.toLowerCase().includes(q) &&
        !m.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, search, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId || !description.trim()) {
      notifyError('Vui lòng chọn máy móc và nhập mô tả sự cố.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/maintenance/requests', {
        method: 'POST',
        body: JSON.stringify({
          machineId: Number(machineId),
          issueType,
          severity,
          description: description.trim(),
          evidenceAttachment: issuePhoto || undefined,
        }),
      });
      notifySuccess('Đã gửi yêu cầu báo sự cố máy móc.');
      setDirty(false);
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể gửi yêu cầu sự cố.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget || !assignedTo) {
      notifyError('Vui lòng chọn nhân viên bảo trì nhận việc.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/maintenance/requests/${assignTarget.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          assignedTo: Number(assignedTo),
          assignmentNote: assignmentNote.trim(),
        }),
      });
      notifySuccess('Đã tiếp nhận và giao việc cho nhân viên bảo trì.');
      setAssignTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể phân công bảo trì.');
    } finally {
      setSaving(false);
    }
  };

  const handleStartMaint = async (id: number) => {
    try {
      await apiRequest(`/api/maintenance/requests/${id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({ mode: 'START' }),
      });
      notifySuccess('Đã bắt đầu thực hiện sửa chữa.');
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cập nhật tiến độ.');
    }
  };

  const handleReportMaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTarget || !repairResult.trim()) {
      notifyError('Vui lòng nhập kết quả sửa chữa trước khi gửi xác nhận.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/maintenance/requests/${reportTarget.id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({
          mode: 'REPORT',
          repairResult: repairResult.trim(),
          materialsUsed: materialsUsed.trim(),
          repairNote: repairNote.trim(),
          evidenceAttachment: repairPhoto || undefined,
        }),
      });
      notifySuccess('Đã gửi báo cáo sửa chữa chờ Quản lý xưởng xác nhận.');
      setReportTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể gửi báo cáo sửa chữa.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmMaint = async (id: number, decision: 'CONFIRM' | 'REJECT', reason?: string) => {
    setSaving(true);
    try {
      await apiRequest(`/api/maintenance/requests/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      notifySuccess(
        decision === 'CONFIRM'
          ? 'Đã xác nhận hoàn tất công việc sửa chữa.'
          : 'Đã trả lại báo cáo sửa chữa kèm lý do.'
      );
      setRejectTargetId(null);
      setDetailTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xác nhận báo cáo sửa chữa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Sự cố & Bảo trì"
        primaryAction={
          canCreate ? (
            <button
              type="button"
              onClick={() => {
                setMachineId(machines[0]?.id ? String(machines[0].id) : '');
                setIssueType('Cơ khí');
                setSeverity('Cần xử lý trong ca');
                setDescription('');
                setIssuePhoto(null);
                setDirty(false);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Báo sự cố máy móc
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng yêu cầu', value: `${items.length}`, onClick: () => updateFilter(search, '') },
          {
            label: 'Chờ tiếp nhận',
            value: `${items.filter((i) => i.status === 'NEW_ISSUE').length}`,
            onClick: () => updateFilter(search, 'NEW_ISSUE'),
          },
          {
            label: 'Chờ nghiệm thu',
            value: `${items.filter((i) => i.status === 'REPORTED').length}`,
            onClick: () => updateFilter(search, 'REPORTED'),
          },
          {
            label: 'Hoàn tất sửa chữa',
            value: `${items.filter((i) => i.status === 'COMPLETED').length}`,
            onClick: () => updateFilter(search, 'COMPLETED'),
          },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã BT-..., tên máy, mô tả sự cố..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="NEW_ISSUE">Chờ tiếp nhận</option>
          <option value="ASSIGNED">Đã giao việc</option>
          <option value="IN_PROGRESS">Đang thực hiện</option>
          <option value="REPORTED">Chờ xác nhận sửa chữa</option>
          <option value="REVISION_REQUIRED">Yêu cầu cập nhật lại</option>
          <option value="COMPLETED">Hoàn tất</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        isFilteredEmpty={items.length > 0 && filtered.length === 0}
        emptyText="Chưa có yêu cầu sửa chữa máy móc nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã phiếu</th>
                  <th className="py-2.5 px-3.5 font-medium">Thiết bị</th>
                  <th className="py-2.5 px-3.5 font-medium">Mô tả / Mức độ</th>
                  <th className="py-2.5 px-3.5 font-medium">Người xử lý</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {m.code}
                      <DemoMarker isDemo={m.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <p className="font-medium text-slate-900">{m.machineName}</p>
                      <p className="text-xs font-data text-slate-500">{m.machineCode}</p>
                    </td>
                    <td className="py-2.5 px-3.5 max-w-xs">
                      <p className="truncate text-slate-800">{m.description}</p>
                      <p className="text-xs text-slate-500">
                        {m.issueType} · {m.severity}
                      </p>
                    </td>
                    <td className="py-2.5 px-3.5">{m.assignedToName || 'Chưa phân công'}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={m.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => setDetailTarget(m)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isManager && m.status === 'NEW_ISSUE' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignTarget(m);
                            setAssignedTo(techList[0]?.id ? String(techList[0].id) : '');
                            setAssignmentNote('');
                          }}
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        >
                          Tiếp nhận & giao việc
                        </button>
                      )}
                      {isMaint && m.assignedTo === user?.id && m.status === 'ASSIGNED' && (
                        <button
                          type="button"
                          onClick={() => void handleStartMaint(m.id)}
                          className="text-xs font-medium text-slate-800 hover:underline"
                        >
                          Bắt đầu sửa
                        </button>
                      )}
                      {isMaint &&
                        m.assignedTo === user?.id &&
                        ['ASSIGNED', 'IN_PROGRESS', 'REVISION_REQUIRED'].includes(m.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              setReportTarget(m);
                              setRepairResult(m.repairResult);
                              setMaterialsUsed(m.materialsUsed);
                              setRepairNote(m.repairNote);
                              setRepairPhoto(null);
                            }}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Báo cáo hoàn tất
                          </button>
                        )}
                      {isManager && m.status === 'REPORTED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleConfirmMaint(m.id, 'CONFIRM')}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Xác nhận xong
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTargetId(m.id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>

      {/* Report Machine Incident Drawer */}
      <ModalDrawer
        open={createOpen}
        title="Báo sự cố máy móc"
        onClose={() => setCreateOpen(false)}
        isDirty={dirty}
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Máy móc / Thiết bị gặp sự cố <span className="text-red-600">*</span>
            </label>
            <select
              value={machineId}
              onChange={(e) => {
                setMachineId(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Nhóm sự cố</label>
              <select
                value={issueType}
                onChange={(e) => {
                  setIssueType(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="Cơ khí">Cơ khí</option>
                <option value="Điện - Tự động">Điện - Tự động</option>
                <option value="Thủy lực - Bôi trơn">Thủy lực - Bôi trơn</option>
                <option value="Khuôn ép & Con lăn">Khuôn ép & Con lăn</option>
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Mức độ ưu tiên</label>
              <select
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="Dừng máy khẩn cấp">Dừng máy khẩn cấp</option>
                <option value="Cần xử lý trong ca">Cần xử lý trong ca</option>
                <option value="Bảo dưỡng định kỳ">Bảo dưỡng định kỳ</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Mô tả hiện tượng sự cố <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
              placeholder="Mô tả tiếng kêu lạ, nhiệt độ ổ bi, kẹt liệu..."
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            />
          </div>
          <FileUploadBox
            label="Ảnh hiện trường sự cố"
            value={issuePhoto}
            onChange={(f) => {
              setIssuePhoto(f);
              setDirty(true);
            }}
          />
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang gửi...' : 'Gửi báo sự cố'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Manager Receive & Assign Drawer */}
      <ModalDrawer
        open={Boolean(assignTarget)}
        title={assignTarget ? `Tiếp nhận & phân công — ${assignTarget.code}` : 'Phân công bảo trì'}
        onClose={() => setAssignTarget(null)}
      >
        {assignTarget && (
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <strong>{assignTarget.machineName}</strong> ({assignTarget.severity})
              </p>
              <p className="text-slate-600">{assignTarget.description}</p>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Nhân viên bảo trì thực hiện <span className="text-red-600">*</span>
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="">Chọn nhân viên bảo trì</option>
                {techList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Yêu cầu kỹ thuật</label>
              <textarea
                rows={2}
                value={assignmentNote}
                onChange={(e) => setAssignmentNote(e.target.value)}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang giao việc...' : 'Xác nhận giao việc'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>

      {/* Maintenance Staff Completion Report Drawer */}
      <ModalDrawer
        open={Boolean(reportTarget)}
        title={reportTarget ? `Báo cáo hoàn tất sửa chữa — ${reportTarget.code}` : 'Báo cáo sửa chữa'}
        onClose={() => setReportTarget(null)}
      >
        {reportTarget && (
          <form onSubmit={handleReportMaint} className="space-y-4">
            {reportTarget.rejectReason && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
                Yêu cầu bổ sung từ Quản lý xưởng: {reportTarget.rejectReason}
              </div>
            )}
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Kết quả xử lý kỹ thuật <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={3}
                value={repairResult}
                onChange={(e) => setRepairResult(e.target.value)}
                placeholder="Mô tả hạng mục đã thay thế, căn chỉnh và chạy thử..."
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Vật tư đã sử dụng</label>
              <input
                type="text"
                value={materialsUsed}
                onChange={(e) => setMaterialsUsed(e.target.value)}
                placeholder="Ví dụ: 02 vòng bi SKF 6312, mỡ chịu nhiệt"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <FileUploadBox
              label="Ảnh sau sửa chữa"
              value={repairPhoto}
              onChange={(f) => setRepairPhoto(f)}
            />
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang gửi...' : 'Gửi Quản lý xác nhận'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>

      {/* Maintenance Detail Drawer */}
      <ModalDrawer
        open={Boolean(detailTarget)}
        title={detailTarget ? `Chi tiết phiếu bảo trì ${detailTarget.code}` : 'Chi tiết bảo trì'}
        onClose={() => setDetailTarget(null)}
        wide
      >
        {detailTarget && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
              <div>
                <span className="text-slate-500">Thiết bị:</span>{' '}
                <strong>{detailTarget.machineName}</strong> ({detailTarget.machineCode})
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                <StatusLabel status={detailTarget.status} />
              </div>
              <div>
                <span className="text-slate-500">Người báo sự cố:</span> {detailTarget.requestedByName}
              </div>
              <div>
                <span className="text-slate-500">Nhân viên sửa chữa:</span>{' '}
                {detailTarget.assignedToName || 'Chưa phân công'}
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Mô tả sự cố:</span> {detailTarget.description}
              </div>
              {detailTarget.repairResult && (
                <div className="sm:col-span-2">
                  <span className="text-slate-500">Kết quả sửa chữa:</span>{' '}
                  <strong>{detailTarget.repairResult}</strong>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-[13px] font-semibold text-slate-800">Hình ảnh hiện trường & kết quả</h4>
              <AttachmentListSection recordReference={detailTarget.code} items={detailTarget.attachments} />
            </div>
            <HistoryTimelineSection items={detailTarget.history} />
          </div>
        )}
      </ModalDrawer>

      <ReasonConfirmModal
        open={rejectTargetId !== null}
        title="Từ chối nghiệm thu báo cáo sửa chữa"
        actionLabel="Trả lại yêu cầu kiểm tra"
        loading={saving}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={(reason) => {
          if (rejectTargetId !== null) {
            void handleConfirmMaint(rejectTargetId, 'REJECT', reason);
          }
        }}
      />
    </div>
  );
}

// ==================== SPARE PARTS PAGE (/vat-tu-bao-tri) ====================
interface SparePartRequest {
  id: number;
  code: string;
  maintenanceRequestId: number | null;
  maintenanceCode: string | null;
  requestedByName: string;
  note: string;
  lineItems: Array<{
    id: number;
    itemName: string;
    quantity: number;
    unit: string;
    specNote: string;
    status: string;
    decisionReason: string | null;
    reviewedByName: string | null;
  }>;
  isDemo: boolean;
  createdAt: string;
}

export function SparePartsPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();

  const [requests, setRequests] = useState<SparePartRequest[]>([]);
  const [maintOptions, setMaintOptions] = useState<Array<{ id: number; code: string; machineName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [maintenanceRequestId, setMaintenanceRequestId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<
    Array<{ itemName: string; quantity: string; unit: string; specNote: string }>
  >([{ itemName: '', quantity: '1', unit: 'cái', specNote: '' }]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rejectItemId, setRejectItemId] = useState<number | null>(null);

  const isMaint = user?.role === RoleCode.MAINTENANCE_STAFF;
  const isManager = user?.role === RoleCode.MANAGER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const spRes = await apiRequest<{ items: SparePartRequest[] }>('/api/maintenance/spare-parts');
      setRequests(spRes.items);
      if (isMaint) {
        const mRes = await apiRequest<{
          items: Array<{ id: number; code: string; machineName: string; status: string }>;
        }>('/api/maintenance/requests');
        setMaintOptions(mRes.items.filter((m) => m.status !== 'COMPLETED'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách vật tư bảo trì.');
    } finally {
      setLoading(false);
    }
  }, [isMaint]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = rows
      .filter((r) => r.itemName.trim())
      .map((r) => ({
        itemName: r.itemName.trim(),
        quantity: Number(r.quantity),
        unit: r.unit.trim() || 'cái',
        specNote: r.specNote.trim(),
      }));

    if (valid.length === 0 || valid.some((v) => !Number.isFinite(v.quantity) || v.quantity <= 0)) {
      notifyError('Vui lòng nhập tên vật tư và số lượng hợp lệ lớn hơn 0.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/api/maintenance/spare-parts', {
        method: 'POST',
        body: JSON.stringify({
          maintenanceRequestId: maintenanceRequestId ? Number(maintenanceRequestId) : null,
          note: note.trim(),
          lineItems: valid,
        }),
      });
      notifySuccess('Đã gửi phiếu đề xuất vật tư bảo trì.');
      setDirty(false);
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể gửi phiếu vật tư.');
    } finally {
      setSaving(false);
    }
  };

  const handleItemDecision = async (itemId: number, decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    setSaving(true);
    try {
      await apiRequest(`/api/maintenance/spare-part-items/${itemId}/decision`, {
        method: 'PUT',
        body: JSON.stringify({ decision, reason }),
      });
      notifySuccess(decision === 'APPROVED' ? 'Đã duyệt hạng mục vật tư.' : 'Đã từ chối hạng mục vật tư.');
      setRejectItemId(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xử lý duyệt vật tư.');
    } finally {
      setSaving(false);
    }
  };

  const allItemsFlat = requests.flatMap((r) => r.lineItems);

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Vật tư bảo trì"
        primaryAction={
          isMaint ? (
            <button
              type="button"
              onClick={() => {
                setMaintenanceRequestId(maintOptions[0]?.id ? String(maintOptions[0].id) : '');
                setNote('');
                setRows([{ itemName: '', quantity: '1', unit: 'cái', specNote: '' }]);
                setDirty(false);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Đề xuất vật tư mới
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng phiếu đề xuất', value: `${requests.length}` },
          {
            label: 'Hạng mục chờ duyệt',
            value: `${allItemsFlat.filter((i) => i.status === 'PENDING').length}`,
          },
          {
            label: 'Hạng mục đã duyệt',
            value: `${allItemsFlat.filter((i) => i.status === 'APPROVED').length}`,
          },
        ]}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={requests.length === 0}
        emptyText="Chưa có phiếu đề xuất vật tư bảo trì nào"
        onRetry={loadData}
      >
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <div>
                  <span className="font-data font-semibold text-slate-900">{req.code}</span>
                  <DemoMarker isDemo={req.isDemo} />
                  {req.maintenanceCode && (
                    <span className="text-slate-500"> · Phiếu sửa chữa {req.maintenanceCode}</span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  Người đề xuất: {req.requestedByName} · {formatDateTime(req.createdAt)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-slate-100 text-slate-500">
                    <tr>
                      <th className="py-2 px-4 font-medium">Tên vật tư / Phụ tùng</th>
                      <th className="py-2 px-4 font-medium text-right">Số lượng</th>
                      <th className="py-2 px-4 font-medium">Quy cách</th>
                      <th className="py-2 px-4 font-medium">Trạng thái mục</th>
                      <th className="py-2 px-4 font-medium text-right">Duyệt độc lập từng mục</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {req.lineItems.map((li) => (
                      <tr key={li.id}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{li.itemName}</td>
                        <td className="py-2.5 px-4 text-right font-data">
                          {li.quantity} {li.unit}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{li.specNote || '—'}</td>
                        <td className="py-2.5 px-4">
                          <StatusLabel status={li.status} />
                          {li.decisionReason && (
                            <p className="text-xs text-red-600 mt-0.5">{li.decisionReason}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-2">
                          {isManager && li.status === 'PENDING' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleItemDecision(li.id, 'APPROVED')}
                                className="text-xs font-medium text-emerald-700 hover:underline"
                              >
                                Duyệt mục này
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectItemId(li.id)}
                                className="text-xs font-medium text-red-600 hover:underline"
                              >
                                Từ chối mục này
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-slate-500">{li.reviewedByName || '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </ScreenStateView>

      <ModalDrawer
        open={createOpen}
        title="Lập phiếu đề xuất vật tư bảo trì"
        onClose={() => setCreateOpen(false)}
        isDirty={dirty}
        wide
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Gắn với phiếu sửa chữa (nếu có)
            </label>
            <select
              value={maintenanceRequestId}
              onChange={(e) => {
                setMaintenanceRequestId(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="">Đề xuất vật tư dự phòng định kỳ</option>
              {maintOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.machineName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-slate-700">
                Danh sách mặt hàng vật tư <span className="text-red-600">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setRows((prev) => [
                    ...prev,
                    { itemName: '', quantity: '1', unit: 'cái', specNote: '' },
                  ]);
                  setDirty(true);
                }}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                + Thêm mặt hàng
              </button>
            </div>
            {rows.map((r, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  value={r.itemName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, itemName: val } : x)));
                    setDirty(true);
                  }}
                  placeholder="Tên phụ tùng / vật tư"
                  className="col-span-5 px-2.5 py-1.5 text-[13px] border border-slate-300 rounded"
                />
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={r.quantity}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: val } : x)));
                    setDirty(true);
                  }}
                  placeholder="SL"
                  className="col-span-2 px-2.5 py-1.5 text-[13px] font-data border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={r.unit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: val } : x)));
                    setDirty(true);
                  }}
                  placeholder="ĐVT"
                  className="col-span-2 px-2.5 py-1.5 text-[13px] border border-slate-300 rounded"
                />
                <div className="col-span-3 flex items-center gap-1">
                  <input
                    type="text"
                    value={r.specNote}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, specNote: val } : x)));
                      setDirty(true);
                    }}
                    placeholder="Quy cách"
                    className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded"
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú đề xuất</label>
            <textarea
              rows={2}
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
              onClick={() => setCreateOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang gửi...' : 'Gửi phiếu vật tư'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      <ReasonConfirmModal
        open={rejectItemId !== null}
        title="Từ chối hạng mục vật tư bảo trì"
        actionLabel="Xác nhận từ chối mục này"
        loading={saving}
        onCancel={() => setRejectItemId(null)}
        onConfirm={(reason) => {
          if (rejectItemId !== null) {
            void handleItemDecision(rejectItemId, 'REJECTED', reason);
          }
        }}
      />
    </div>
  );
}
