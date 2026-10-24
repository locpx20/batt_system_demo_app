import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
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

interface PurchasingOrderItem {
  id: number;
  code: string;
  supplierId: number;
  supplierName: string;
  supplierPhone: string;
  supplierAddress: string;
  materialName: string;
  assignedTo: number;
  assignedToName: string;
  createdBy: number;
  createdByName: string;
  requestDate: string;
  requestNote: string;
  weighedKg: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  purchasingNote: string;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  receivedKg: number | null;
  discrepancyKg: number | null;
  discrepancyNote: string;
  receivedByName: string | null;
  receivedAt: string | null;
  scaleImageUrl: string | null;
  status: string;
  isDemo: boolean;
  createdAt: string;
}

interface PurchasingDetailResponse {
  order: PurchasingOrderItem;
  attachments: AttachmentItem[];
  history: AuditHistoryItem[];
}

// ==================== PURCHASING ORDERS PAGE (/thu-mua) ====================
export function PurchasingPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [allItems, setAllItems] = useState<PurchasingOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [suppliers, setSuppliers] = useState<Array<{ id: number; name: string; status: string }>>([]);
  const [purchasingStaff, setPurchasingStaff] = useState<Array<{ id: number; fullName: string }>>([]);

  // Create request form (Manager / Owner)
  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [requestDate, setRequestDate] = useState(todayIsoDate());
  const [requestNote, setRequestNote] = useState('');
  const [createDirty, setCreateDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Result update form (Purchasing Staff)
  const [resultTarget, setResultTarget] = useState<PurchasingOrderItem | null>(null);
  const [weighedKg, setWeighedKg] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [purchasingNote, setPurchasingNote] = useState('');
  const [scaleFile, setScaleFile] = useState<UploadedFileResponse | null>(null);
  const [resultDirty, setResultDirty] = useState(false);

  // Detail & Approval Drawer
  const [detailData, setDetailData] = useState<PurchasingDetailResponse | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);

  const canAssign = user?.role === RoleCode.MANAGER || user?.role === RoleCode.OWNER;
  const canApprove = user?.role === RoleCode.MANAGER || user?.role === RoleCode.OWNER;
  const isPurchasingStaff = user?.role === RoleCode.PURCHASING_STAFF;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: PurchasingOrderItem[] }>('/api/purchasing');
      setAllItems(res.items);

      if (canAssign) {
        const [supRes, dirRes] = await Promise.all([
          apiRequest<{ items: Array<{ id: number; name: string; status: string }> }>('/api/suppliers'),
          apiRequest<{ staffList: Array<{ id: number; fullName: string; role: string }> }>('/api/directory/options'),
        ]);
        setSuppliers(supRes.items.filter((s) => s.status === 'ACTIVE'));
        setPurchasingStaff(
          dirRes.staffList
            .filter((u) => u.role === RoleCode.PURCHASING_STAFF)
            .map((u) => ({ id: u.id, fullName: u.fullName }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách phiếu thu mua.');
    } finally {
      setLoading(false);
    }
  }, [canAssign]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
        !item.supplierName.toLowerCase().includes(q) &&
        !item.assignedToName.toLowerCase().includes(q)
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

  const openDetail = async (id: number) => {
    try {
      const res = await apiRequest<PurchasingDetailResponse>(`/api/purchasing/${id}`);
      setDetailData(res);
      setDetailOpen(true);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể mở chi tiết phiếu thu mua.');
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !assignedTo || !requestDate) {
      notifyError('Vui lòng chọn nhà cung cấp, nhân viên thu mua và ngày yêu cầu.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/purchasing', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: Number(supplierId),
          assignedTo: Number(assignedTo),
          requestDate,
          requestNote: requestNote.trim(),
        }),
      });
      notifySuccess('Đã tạo yêu cầu thu mua mới.');
      setCreateDirty(false);
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể tạo yêu cầu thu mua.');
    } finally {
      setSaving(false);
    }
  };

  const openUpdateResult = (order: PurchasingOrderItem) => {
    setResultTarget(order);
    setWeighedKg(order.weighedKg !== null ? String(order.weighedKg) : '');
    setUnitPrice(order.unitPrice !== null ? String(order.unitPrice) : '');
    setPurchasingNote(order.purchasingNote || '');
    setScaleFile(
      order.scaleImageUrl
        ? {
            fileName: `Phieu-can-${order.code}`,
            fileUrl: order.scaleImageUrl,
            mimeType: 'image/svg+xml',
            fileSize: 0,
          }
        : null
    );
    setResultDirty(false);
  };

  const submitResult = async (submitForApproval: boolean) => {
    if (!resultTarget) return;
    const kg = Number(weighedKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      notifyError('Vui lòng nhập khối lượng thực tế cân lớn hơn 0.');
      return;
    }
    if (submitForApproval && !scaleFile) {
      notifyError('Vui lòng đính kèm ảnh phiếu cân trước khi gửi duyệt.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/purchasing/${resultTarget.id}/result`, {
        method: 'PUT',
        body: JSON.stringify({
          weighedKg: kg,
          unitPrice: unitPrice.trim() ? Number(unitPrice) : null,
          purchasingNote: purchasingNote.trim(),
          submitForApproval,
          scaleTicketAttachment: scaleFile
            ? {
                ...scaleFile,
                docType: 'Ảnh phiếu cân',
              }
            : undefined,
        }),
      });
      notifySuccess(submitForApproval ? 'Đã gửi phiếu thu mua chờ duyệt.' : 'Đã lưu tạm thông tin thu mua.');
      setResultDirty(false);
      setResultTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể lưu kết quả thu mua.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecision = async (id: number, decision: 'APPROVE' | 'REJECT', reason?: string) => {
    setSaving(true);
    try {
      await apiRequest(`/api/purchasing/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      notifySuccess(
        decision === 'APPROVE'
          ? 'Đã duyệt phiếu thu mua. Chuyển sang bước Thủ kho tiếp nhận.'
          : 'Đã từ chối phiếu thu mua.'
      );
      setRejectTargetId(null);
      setDetailOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xử lý phê duyệt.');
    } finally {
      setSaving(false);
    }
  };

  const pendingCnt = allItems.filter((i) => i.status === 'PENDING_APPROVAL').length;
  const approvedWaitWh = allItems.filter((i) => i.status === 'APPROVED').length;
  const receivedCnt = allItems.filter((i) => i.status === 'RECEIVED').length;

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Phiếu thu mua"
        primaryAction={
          canAssign ? (
            <button
              type="button"
              onClick={() => {
                setSupplierId(suppliers[0]?.id ? String(suppliers[0].id) : '');
                setAssignedTo(purchasingStaff[0]?.id ? String(purchasingStaff[0].id) : '');
                setRequestDate(todayIsoDate());
                setRequestNote('');
                setCreateDirty(false);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Giao yêu cầu thu mua
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng phiếu', value: `${allItems.length}`, onClick: () => updateFilter(search, '') },
          { label: 'Chờ duyệt', value: `${pendingCnt}`, onClick: () => updateFilter(search, 'PENDING_APPROVAL') },
          { label: 'Chờ Thủ kho nhận', value: `${approvedWaitWh}`, onClick: () => updateFilter(search, 'APPROVED') },
          { label: 'Đã nhập kho NVL', value: `${receivedCnt}`, onClick: () => updateFilter(search, 'RECEIVED') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã phiếu, nhà cung cấp, nhân viên thu mua..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ASSIGNED">Đã giao việc</option>
          <option value="IN_PROGRESS">Đang thực hiện</option>
          <option value="PENDING_APPROVAL">Chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Từ chối</option>
          <option value="RECEIVED">Đã nhập kho</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={allItems.length === 0}
        isFilteredEmpty={allItems.length > 0 && filteredItems.length === 0}
        emptyText="Chưa có phiếu thu mua nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã phiếu</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày</th>
                  <th className="py-2.5 px-3.5 font-medium">Nhà cung cấp</th>
                  <th className="py-2.5 px-3.5 font-medium">Nhân viên thu mua</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Cân trên phiếu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thực nhận kho</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedItems.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {po.code}
                      <DemoMarker isDemo={po.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data whitespace-nowrap">{formatDate(po.requestDate)}</td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{po.supplierName}</td>
                    <td className="py-2.5 px-3.5 text-slate-700">{po.assignedToName}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(po.weighedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(po.receivedKg)}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={po.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(po.id)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isPurchasingStaff &&
                        po.assignedTo === user?.id &&
                        ['ASSIGNED', 'IN_PROGRESS', 'REJECTED'].includes(po.status) && (
                          <button
                            type="button"
                            onClick={() => openUpdateResult(po)}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Cập nhật kết quả
                          </button>
                        )}
                      {canApprove && po.status === 'PENDING_APPROVAL' && po.assignedTo !== user?.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDecision(po.id, 'APPROVE')}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Duyệt
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTargetId(po.id)}
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
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filteredItems.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Create Purchasing Request Drawer */}
      <ModalDrawer
        open={createOpen}
        title="Giao yêu cầu thu mua NVL"
        onClose={() => setCreateOpen(false)}
        isDirty={createDirty}
      >
        <form onSubmit={handleCreateRequest} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Nhà cung cấp <span className="text-red-600">*</span>
            </label>
            <select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setCreateDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="">Chọn nhà cung cấp</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Nhân viên thu mua <span className="text-red-600">*</span>
              </label>
              <select
                value={assignedTo}
                onChange={(e) => {
                  setAssignedTo(e.target.value);
                  setCreateDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="">Chọn nhân viên thu mua</option>
                {purchasingStaff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Ngày yêu cầu <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => {
                  setRequestDate(e.target.value);
                  setCreateDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Loại nguyên liệu</label>
            <input
              type="text"
              readOnly
              value="NVL"
              className="w-full px-3 py-2 text-[13.5px] bg-slate-100 border border-slate-200 rounded-md text-slate-700"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú giao việc</label>
            <textarea
              rows={3}
              value={requestNote}
              onChange={(e) => {
                setRequestNote(e.target.value);
                setCreateDirty(true);
              }}
              placeholder="Yêu cầu kiểm tra độ khô mùn cưa và chụp rõ phiếu cân..."
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
              {saving ? 'Đang tạo...' : 'Giao việc thu mua'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Purchasing Staff Update Result Drawer */}
      <ModalDrawer
        open={Boolean(resultTarget)}
        title={resultTarget ? `Cập nhật kết quả thu mua ${resultTarget.code}` : 'Cập nhật kết quả'}
        onClose={() => setResultTarget(null)}
        isDirty={resultDirty}
      >
        {resultTarget && (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Nhà cung cấp:</span>{' '}
                <strong className="text-slate-900">{resultTarget.supplierName}</strong>
              </p>
              <p>
                <span className="text-slate-500">Ngày yêu cầu:</span>{' '}
                <span className="font-data">{formatDate(resultTarget.requestDate)}</span>
              </p>
              {resultTarget.rejectReason && (
                <p className="text-xs text-red-700 bg-red-50 px-2.5 py-1.5 rounded mt-1">
                  Lý do trả lại: {resultTarget.rejectReason}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Khối lượng cân thực tế (kg) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={weighedKg}
                  onChange={(e) => {
                    setWeighedKg(e.target.value);
                    setResultDirty(true);
                  }}
                  placeholder="Ví dụ: 12500"
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Đơn giá mua (đ/kg)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={unitPrice}
                  onChange={(e) => {
                    setUnitPrice(e.target.value);
                    setResultDirty(true);
                  }}
                  placeholder="Ví dụ: 1450"
                  className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <FileUploadBox
              label="Ảnh phiếu cân tại trạm cân"
              required
              value={scaleFile}
              onChange={(f) => {
                setScaleFile(f);
                setResultDirty(true);
              }}
              contextCaption={`Phiếu thu mua ${resultTarget.code} · ${resultTarget.supplierName}`}
            />

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú thu mua</label>
              <textarea
                rows={3}
                value={purchasingNote}
                onChange={(e) => {
                  setPurchasingNote(e.target.value);
                  setResultDirty(true);
                }}
                placeholder="Ghi chú biển số xe chở hàng, chất lượng NVL quan sát thực tế..."
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitResult(false)}
                className="px-3.5 py-2 text-[13px] font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Lưu tạm
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitResult(true)}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang gửi...' : 'Gửi duyệt'}
              </button>
            </div>
          </div>
        )}
      </ModalDrawer>

      {/* Purchasing Detail Drawer */}
      <ModalDrawer
        open={detailOpen && Boolean(detailData)}
        title={detailData ? `Chi tiết phiếu thu mua ${detailData.order.code}` : 'Chi tiết phiếu thu mua'}
        onClose={() => setDetailOpen(false)}
        wide
      >
        {detailData && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
              <div>
                <span className="text-slate-500">Nhà cung cấp:</span>{' '}
                <strong className="text-slate-900">{detailData.order.supplierName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                <StatusLabel status={detailData.order.status} />
              </div>
              <div>
                <span className="text-slate-500">Nhân viên thu mua:</span>{' '}
                <span className="text-slate-900">{detailData.order.assignedToName}</span>
              </div>
              <div>
                <span className="text-slate-500">Ngày yêu cầu:</span>{' '}
                <span className="font-data">{formatDate(detailData.order.requestDate)}</span>
              </div>
              <div>
                <span className="text-slate-500">Khối lượng trên phiếu cân:</span>{' '}
                <strong className="font-data text-slate-900">{formatKg(detailData.order.weighedKg)}</strong>
              </div>
              <div>
                <span className="text-slate-500">Khối lượng thực nhận kho:</span>{' '}
                <strong className="font-data text-slate-900">{formatKg(detailData.order.receivedKg)}</strong>
              </div>
              {detailData.order.unitPrice !== null && (
                <div>
                  <span className="text-slate-500">Đơn giá:</span>{' '}
                  <span className="font-data">{formatCurrency(detailData.order.unitPrice)}</span>
                </div>
              )}
              {detailData.order.totalAmount !== null && (
                <div>
                  <span className="text-slate-500">Thành tiền trên phiếu:</span>{' '}
                  <span className="font-data">{formatCurrency(detailData.order.totalAmount)}</span>
                </div>
              )}
              {detailData.order.discrepancyKg !== null && detailData.order.discrepancyKg !== 0 && (
                <div className="sm:col-span-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs">
                  Chênh lệch khi nhận kho: <strong className="font-data">{detailData.order.discrepancyKg} kg</strong> —{' '}
                  {detailData.order.discrepancyNote}
                </div>
              )}
              {detailData.order.rejectReason && (
                <div className="sm:col-span-2 text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs">
                  Lý do từ chối: {detailData.order.rejectReason}
                </div>
              )}
            </div>

            {canApprove &&
              detailData.order.status === 'PENDING_APPROVAL' &&
              detailData.order.assignedTo !== user?.id && (
                <div className="flex items-center justify-end gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setRejectTargetId(detailData.order.id)}
                    className="px-3.5 py-2 text-[13px] font-medium text-red-600 border border-red-200 bg-white rounded-md hover:bg-red-50"
                  >
                    Từ chối phiếu
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDecision(detailData.order.id, 'APPROVE')}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                  >
                    Duyệt phiếu thu mua
                  </button>
                </div>
              )}

            <div className="space-y-2">
              <h4 className="text-[13px] font-semibold text-slate-800">Chứng từ phiếu cân đính kèm</h4>
              <AttachmentListSection
                recordReference={detailData.order.code}
                items={detailData.attachments}
              />
            </div>

            <HistoryTimelineSection items={detailData.history} />
          </div>
        )}
      </ModalDrawer>

      <ReasonConfirmModal
        open={rejectTargetId !== null}
        title="Từ chối phiếu thu mua"
        actionLabel="Xác nhận từ chối"
        placeholder="Nhập lý do cần nhân viên thu mua kiểm tra hoặc bổ sung..."
        loading={saving}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={(reason) => {
          if (rejectTargetId !== null) {
            void handleDecision(rejectTargetId, 'REJECT', reason);
          }
        }}
      />
    </div>
  );
}

// ==================== RAW MATERIAL RECEIPT PAGE (/nhap-kho-nvl) ====================
export function RawMaterialReceiptPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [allItems, setAllItems] = useState<PurchasingOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [receiveTarget, setReceiveTarget] = useState<PurchasingOrderItem | null>(null);
  const [receivedKg, setReceivedKg] = useState('');
  const [discrepancyNote, setDiscrepancyNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isWarehouseKeeper = user?.role === RoleCode.WAREHOUSE_KEEPER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: PurchasingOrderItem[] }>('/api/purchasing');
      setAllItems(res.items.filter((i) => ['APPROVED', 'RECEIVED'].includes(i.status)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách tiếp nhận NVL.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      if (q && !item.code.toLowerCase().includes(q) && !item.supplierName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allItems, search, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const openConfirmModal = (po: PurchasingOrderItem) => {
    setReceiveTarget(po);
    setReceivedKg(po.weighedKg !== null ? String(po.weighedKg) : '');
    setDiscrepancyNote('');
    setDirty(false);
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveTarget) return;
    const rec = Number(receivedKg);
    if (!Number.isFinite(rec) || rec <= 0) {
      notifyError('Khối lượng thực nhận phải lớn hơn 0.');
      return;
    }
    const diff = Math.round((rec - Number(receiveTarget.weighedKg || 0)) * 100) / 100;
    if (diff !== 0 && !discrepancyNote.trim()) {
      notifyError('Khối lượng thực nhận khác trên phiếu. Vui lòng nhập ghi chú chênh lệch.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/purchasing/${receiveTarget.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          receivedKg: rec,
          discrepancyNote: discrepancyNote.trim(),
        }),
      });
      notifySuccess('Đã xác nhận nhập kho NVL theo khối lượng thực nhận.');
      setDirty(false);
      setReceiveTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xác nhận nhập kho NVL.');
    } finally {
      setSaving(false);
    }
  };

  const waitingCnt = allItems.filter((i) => i.status === 'APPROVED').length;
  const doneCnt = allItems.filter((i) => i.status === 'RECEIVED').length;

  return (
    <div className="space-y-3.5">
      <PageHeader title="Tiếp nhận NVL" />

      <CompactMetricsRow
        items={[
          { label: 'Chờ tiếp nhận thực tế', value: `${waitingCnt}`, onClick: () => updateFilter(search, 'APPROVED') },
          { label: 'Đã nhập kho NVL', value: `${doneCnt}`, onClick: () => updateFilter(search, 'RECEIVED') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã phiếu thu mua, nhà cung cấp..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="APPROVED">Đã duyệt (chờ nhận kho)</option>
          <option value="RECEIVED">Đã nhập kho</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={allItems.length === 0}
        isFilteredEmpty={allItems.length > 0 && filteredItems.length === 0}
        emptyText="Chưa có phiếu thu mua đã duyệt chờ nhập kho"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã phiếu</th>
                  <th className="py-2.5 px-3.5 font-medium">Nhà cung cấp</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Khối lượng trên phiếu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Khối lượng thực nhận</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Chênh lệch</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedItems.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {po.code}
                      <DemoMarker isDemo={po.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{po.supplierName}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(po.weighedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium">
                      {formatKg(po.receivedKg)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">
                      {po.discrepancyKg !== null && po.discrepancyKg !== 0 ? (
                        <span className="text-amber-700">
                          {po.discrepancyKg > 0 ? `+${po.discrepancyKg}` : po.discrepancyKg} kg
                        </span>
                      ) : po.status === 'RECEIVED' ? (
                        '0 kg'
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={po.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      {isWarehouseKeeper && po.status === 'APPROVED' ? (
                        <button
                          type="button"
                          onClick={() => openConfirmModal(po)}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                        >
                          Xác nhận nhận hàng
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {po.receivedAt ? formatDateTime(po.receivedAt) : 'Chờ Thủ kho'}
                        </span>
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

      <ModalDrawer
        open={Boolean(receiveTarget)}
        title={receiveTarget ? `Xác nhận nhập kho NVL — ${receiveTarget.code}` : 'Xác nhận nhập kho NVL'}
        onClose={() => setReceiveTarget(null)}
        isDirty={dirty}
      >
        {receiveTarget && (
          <form onSubmit={handleConfirmReceive} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Nhà cung cấp:</span>{' '}
                <strong className="text-slate-900">{receiveTarget.supplierName}</strong>
              </p>
              <p>
                <span className="text-slate-500">Khối lượng trên phiếu thu mua:</span>{' '}
                <strong className="font-data text-slate-900">{formatKg(receiveTarget.weighedKg)}</strong>
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Khối lượng thực nhận tại kho (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={receivedKg}
                onChange={(e) => {
                  setReceivedKg(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Ghi chú đối chiếu / chênh lệch
              </label>
              <textarea
                rows={3}
                value={discrepancyNote}
                onChange={(e) => {
                  setDiscrepancyNote(e.target.value);
                  setDirty(true);
                }}
                placeholder="Bắt buộc nhập nếu khối lượng thực nhận khác khối lượng trên phiếu..."
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang cập nhật tồn kho...' : 'Xác nhận nhập kho'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== RAW MATERIAL ISSUE PAGE (/cap-nvl) ====================
interface RawLedgerEntry {
  id: number;
  txCode: string;
  txType: string;
  quantityKg: number;
  balanceAfterKg: number;
  referenceCode: string;
  shift: string | null;
  estimatedBuckets: number | null;
  note: string;
  isDemo: number;
  createdAt: string;
  actorName: string;
  receiverName: string | null;
}

export function RawMaterialIssuePage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();

  const [balanceKg, setBalanceKg] = useState(0);
  const [issues, setIssues] = useState<RawLedgerEntry[]>([]);
  const [plans, setPlans] = useState<
    Array<{
      id: number;
      code: string;
      planDate: string;
      shift: string;
      targetKg: number;
      status: string;
      assignments: Array<{ staffId: number; staffName: string }>;
    }>
  >([]);
  const [staffList, setStaffList] = useState<Array<{ id: number; fullName: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [planId, setPlanId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [estimatedBuckets, setEstimatedBuckets] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isWarehouseKeeper = user?.role === RoleCode.WAREHOUSE_KEEPER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rawRes, planRes, dirRes] = await Promise.all([
        apiRequest<{ stock: { balanceKg: number }; ledger: RawLedgerEntry[] }>('/api/inventory/raw'),
        apiRequest<{
          items: Array<{
            id: number;
            code: string;
            planDate: string;
            shift: string;
            targetKg: number;
            status: string;
            assignments: Array<{ staffId: number; staffName: string }>;
          }>;
        }>('/api/production/plans'),
        apiRequest<{ staffList: Array<{ id: number; fullName: string; role: string }> }>('/api/directory/options'),
      ]);
      setBalanceKg(rawRes.stock.balanceKg);
      setIssues(rawRes.ledger.filter((l) => l.txType === 'OUT'));
      setPlans(planRes.items.filter((p) => ['PLANNED', 'RUNNING'].includes(p.status)));
      setStaffList(
        dirRes.staffList
          .filter((u) => u.role === RoleCode.STAFF)
          .map((u) => ({ id: u.id, fullName: u.fullName }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu cấp NVL sản xuất.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenIssue = () => {
    const firstPlan = plans[0];
    setPlanId(firstPlan ? String(firstPlan.id) : '');
    setReceiverId(
      firstPlan?.assignments[0]?.staffId
        ? String(firstPlan.assignments[0].staffId)
        : staffList[0]?.id
          ? String(staffList[0].id)
          : ''
    );
    setQuantityKg('');
    setEstimatedBuckets('');
    setNote('');
    setDirty(false);
    setModalOpen(true);
  };

  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantityKg);
    if (!planId || !receiverId || !Number.isFinite(qty) || qty <= 0) {
      notifyError('Vui lòng chọn kế hoạch, công nhân nhận và khối lượng NVL thực cấp lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/warehouse/raw-issues', {
        method: 'POST',
        body: JSON.stringify({
          planId: Number(planId),
          receiverId: Number(receiverId),
          quantityKg: qty,
          estimatedBuckets: estimatedBuckets.trim() ? Number(estimatedBuckets) : null,
          note: note.trim(),
        }),
      });
      notifySuccess('Đã ghi nhận xuất kho NVL cho sản xuất.');
      setDirty(false);
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể cấp NVL sản xuất.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Cấp NVL sản xuất"
        primaryAction={
          isWarehouseKeeper ? (
            <button
              type="button"
              onClick={handleOpenIssue}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Lập phiếu cấp NVL
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'NVL khả dụng trong kho', value: formatKg(balanceKg) },
          { label: 'Kế hoạch đang mở', value: `${plans.length}` },
          { label: 'Số lần đã cấp NVL', value: `${issues.length}` },
        ]}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={issues.length === 0}
        emptyText="Chưa có phiếu cấp NVL nào cho sản xuất"
        onRetry={loadData}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã phiếu cấp</th>
                  <th className="py-2.5 px-3.5 font-medium">Thời điểm</th>
                  <th className="py-2.5 px-3.5 font-medium">Kế hoạch / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Công nhân nhận</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Khối lượng cấp</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Số gầu tham khảo</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Tồn sau cấp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {row.txCode}
                      <DemoMarker isDemo={row.isDemo === 1} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data font-medium">{row.referenceCode}</span>
                      {row.shift && <span className="text-slate-500"> · {row.shift}</span>}
                    </td>
                    <td className="py-2.5 px-3.5">{row.receiverName || '—'}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium text-slate-900">
                      {formatKg(row.quantityKg)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data text-slate-600">
                      {row.estimatedBuckets !== null ? `${row.estimatedBuckets} gầu` : '—'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(row.balanceAfterKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>

      <ModalDrawer
        open={modalOpen}
        title="Cấp NVL từ kho sang sản xuất"
        onClose={() => setModalOpen(false)}
        isDirty={dirty}
      >
        <form onSubmit={handleSubmitIssue} className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px]">
            Tồn kho NVL khả dụng hiện tại: <strong className="font-data">{formatKg(balanceKg)}</strong>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Kế hoạch sản xuất <span className="text-red-600">*</span>
            </label>
            <select
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="">Chọn kế hoạch sản xuất</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {formatDate(p.planDate)} ({p.shift})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">
              Công nhân nhận NVL <span className="text-red-600">*</span>
            </label>
            <select
              value={receiverId}
              onChange={(e) => {
                setReceiverId(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="">Chọn công nhân</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Khối lượng NVL thực cấp (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={quantityKg}
                onChange={(e) => {
                  setQuantityKg(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ví dụ: 5200"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Số gầu xúc tham khảo (~100 kg/gầu)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={estimatedBuckets}
                onChange={(e) => {
                  setEstimatedBuckets(e.target.value);
                  setDirty(true);
                }}
                placeholder="Chỉ lưu tham khảo, không bắt buộc"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú xuất kho</label>
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
              onClick={() => setModalOpen(false)}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {saving ? 'Đang ghi nhận...' : 'Xác nhận cấp NVL'}
            </button>
          </div>
        </form>
      </ModalDrawer>
    </div>
  );
}

// ==================== RAW INVENTORY PAGE (/ton-kho-nvl) ====================
export function RawInventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const txFilter = searchParams.get('type') || '';

  const [stock, setStock] = useState<{
    materialCode: string;
    materialName: string;
    balanceKg: number;
    lastInAt: string | null;
    updatedAt: string;
  } | null>(null);
  const [ledger, setLedger] = useState<RawLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        stock: {
          materialCode: string;
          materialName: string;
          balanceKg: number;
          lastInAt: string | null;
          updatedAt: string;
        };
        ledger: RawLedgerEntry[];
      }>('/api/inventory/raw');
      setStock(res.stock);
      setLedger(res.ledger);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải tồn kho NVL.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateFilter = (nextQ: string, nextType: string) => {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextType) next.set('type', nextType);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger.filter((row) => {
      if (txFilter && row.txType !== txFilter) return false;
      if (
        q &&
        !row.txCode.toLowerCase().includes(q) &&
        !row.referenceCode.toLowerCase().includes(q) &&
        !row.note.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [ledger, search, txFilter]);

  const pagedLedger = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredLedger.slice(start, start + PAGE_SIZE);
  }, [filteredLedger, page]);

  const totalIn = ledger.filter((l) => l.txType === 'IN').reduce((s, l) => s + l.quantityKg, 0);
  const totalOut = ledger.filter((l) => l.txType === 'OUT').reduce((s, l) => s + l.quantityKg, 0);

  return (
    <div className="space-y-3.5">
      <PageHeader title="Tồn kho NVL" />

      <CompactMetricsRow
        items={[
          { label: 'Mặt hàng', value: 'NVL' },
          { label: 'Tồn kho thực tế hiện tại', value: formatKg(stock?.balanceKg ?? 0) },
          { label: 'Tổng nhập kho lũy kế', value: formatKg(totalIn), onClick: () => updateFilter(search, 'IN') },
          { label: 'Tổng cấp sản xuất lũy kế', value: formatKg(totalOut), onClick: () => updateFilter(search, 'OUT') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, txFilter)}
        searchPlaceholder="Tìm theo mã giao dịch kho, mã phiếu tham chiếu..."
        hasActiveFilters={Boolean(search || txFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={txFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả biến động</option>
          <option value="IN">Nhập kho từ thu mua</option>
          <option value="OUT">Cấp NVL cho sản xuất</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={ledger.length === 0}
        isFilteredEmpty={ledger.length > 0 && filteredLedger.length === 0}
        emptyText="Chưa có lịch sử nhập xuất kho NVL"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã chứng từ kho</th>
                  <th className="py-2.5 px-3.5 font-medium">Thời điểm</th>
                  <th className="py-2.5 px-3.5 font-medium">Loại biến động</th>
                  <th className="py-2.5 px-3.5 font-medium">Tham chiếu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Khối lượng</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Tồn sau giao dịch</th>
                  <th className="py-2.5 px-3.5 font-medium">Người thực hiện</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedLedger.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {row.txCode}
                      <DemoMarker isDemo={row.isDemo === 1} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {row.txType === 'IN' ? (
                        <span className="text-emerald-700 font-medium">Nhập kho NVL</span>
                      ) : (
                        <span className="text-blue-700 font-medium">Cấp sản xuất</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 font-data whitespace-nowrap">{row.referenceCode}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium">
                      {row.txType === 'IN' ? '+' : '-'}
                      {formatKg(row.quantityKg)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data text-slate-900">
                      {formatKg(row.balanceAfterKg)}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700">{row.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filteredLedger.length}
          onPageChange={setPage}
        />
      </ScreenStateView>
    </div>
  );
}
