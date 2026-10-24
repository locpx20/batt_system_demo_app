import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  RoleCode,
  type AttachmentItem,
  type AuditHistoryItem,
} from '../../shared/types.ts';
import { useAuth, useToast } from '../context/AppContexts.tsx';
import {
  apiRequest,
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

interface PlanItem {
  id: number;
  code: string;
  planDate: string;
  shift: string;
  targetKg: number;
  machineId: number | null;
  machineCode: string;
  machineName: string;
  note: string;
  status: string;
  createdByName: string;
  issuedNvlKg: number;
  approvedOutputKg: number;
  assignments: Array<{ staffId: number; taskRole: string; staffName: string }>;
  isDemo: boolean;
}

// ==================== PRODUCTION PLANS PAGE (/ke-hoach-san-xuat) ====================
export function ProductionPlansPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';

  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [staffOptions, setStaffOptions] = useState<Array<{ id: number; fullName: string }>>([]);
  const [machines, setMachines] = useState<Array<{ id: number; code: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [planDate, setPlanDate] = useState(todayIsoDate());
  const [shift, setShift] = useState('Ca 1');
  const [targetKg, setTargetKg] = useState('');
  const [machineId, setMachineId] = useState('');
  const [note, setNote] = useState('');
  const [assignRows, setAssignRows] = useState<Array<{ staffId: string; taskRole: string }>>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isManager = user?.role === RoleCode.MANAGER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planRes, dirRes] = await Promise.all([
        apiRequest<{ items: PlanItem[] }>('/api/production/plans'),
        apiRequest<{
          staffList: Array<{ id: number; fullName: string; role: string }>;
          machines: Array<{ id: number; code: string; name: string }>;
        }>('/api/directory/options'),
      ]);
      setPlans(planRes.items);
      setStaffOptions(
        dirRes.staffList
          .filter((u) => u.role === RoleCode.STAFF)
          .map((u) => ({ id: u.id, fullName: u.fullName }))
      );
      setMachines(dirRes.machines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách kế hoạch sản xuất.');
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

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (
        q &&
        !p.code.toLowerCase().includes(q) &&
        !p.machineName.toLowerCase().includes(q) &&
        !p.assignments.some((a) => a.staffName.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [plans, search, statusFilter]);

  const pagedPlans = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredPlans.slice(start, start + PAGE_SIZE);
  }, [filteredPlans, page]);

  const openCreate = () => {
    setEditing(null);
    setPlanDate(todayIsoDate());
    setShift('Ca 1');
    setTargetKg('5000');
    setMachineId(machines[0]?.id ? String(machines[0].id) : '');
    setNote('');
    setAssignRows([
      {
        staffId: staffOptions[0]?.id ? String(staffOptions[0].id) : '',
        taskRole: 'Vận hành máy ép viên',
      },
    ]);
    setDirty(false);
    setFormOpen(true);
  };

  const openEdit = (plan: PlanItem) => {
    setEditing(plan);
    setPlanDate(plan.planDate);
    setShift(plan.shift);
    setTargetKg(String(plan.targetKg));
    setMachineId(plan.machineId ? String(plan.machineId) : '');
    setNote(plan.note);
    setAssignRows(
      plan.assignments.length > 0
        ? plan.assignments.map((a) => ({ staffId: String(a.staffId), taskRole: a.taskRole }))
        : [{ staffId: '', taskRole: 'Vận hành sản xuất' }]
    );
    setDirty(false);
    setFormOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = Number(targetKg);
    const validAssigns = assignRows
      .filter((r) => r.staffId)
      .map((r) => ({ staffId: Number(r.staffId), taskRole: r.taskRole.trim() || 'Vận hành sản xuất' }));

    if (!planDate || !Number.isFinite(target) || target <= 0) {
      notifyError('Vui lòng nhập ngày sản xuất và mục tiêu sản lượng lớn hơn 0.');
      return;
    }
    if (validAssigns.length === 0) {
      notifyError('Vui lòng phân công ít nhất một công nhân cho kế hoạch.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        planDate,
        shift,
        targetKg: target,
        machineId: machineId ? Number(machineId) : null,
        note: note.trim(),
        assignments: validAssigns,
      };
      if (editing) {
        await apiRequest(`/api/production/plans/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notifySuccess('Đã cập nhật kế hoạch sản xuất.');
      } else {
        await apiRequest('/api/production/plans', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notifySuccess('Đã lập kế hoạch sản xuất mới.');
      }
      setDirty(false);
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể lưu kế hoạch sản xuất.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompletePlan = async (id: number) => {
    try {
      await apiRequest(`/api/production/plans/${id}/complete`, { method: 'POST' });
      notifySuccess('Đã xác nhận hoàn tất kế hoạch sản xuất.');
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể hoàn tất kế hoạch.');
    }
  };

  const runningCnt = plans.filter((p) => p.status === 'RUNNING').length;
  const plannedCnt = plans.filter((p) => p.status === 'PLANNED').length;
  const doneCnt = plans.filter((p) => p.status === 'COMPLETED').length;

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Kế hoạch sản xuất"
        primaryAction={
          isManager ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Lập kế hoạch mới
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng kế hoạch', value: `${plans.length}`, onClick: () => updateFilter(search, '') },
          { label: 'Chưa bắt đầu', value: `${plannedCnt}`, onClick: () => updateFilter(search, 'PLANNED') },
          { label: 'Đang sản xuất', value: `${runningCnt}`, onClick: () => updateFilter(search, 'RUNNING') },
          { label: 'Đã hoàn tất', value: `${doneCnt}`, onClick: () => updateFilter(search, 'COMPLETED') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã kế hoạch, dây chuyền máy, công nhân..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="PLANNED">Chưa bắt đầu</option>
          <option value="RUNNING">Đang sản xuất</option>
          <option value="COMPLETED">Hoàn tất</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={plans.length === 0}
        isFilteredEmpty={plans.length > 0 && filteredPlans.length === 0}
        emptyText="Chưa có kế hoạch sản xuất nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã kế hoạch</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Thiết bị / Công nhân</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Mục tiêu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">NVL đã cấp</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Sản lượng duyệt</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedPlans.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {p.code}
                      <DemoMarker isDemo={p.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data">{formatDate(p.planDate)}</span> ·{' '}
                      <span className="font-medium">{p.shift}</span>
                    </td>
                    <td className="py-2.5 px-3.5">
                      <p className="font-medium text-slate-900">{p.machineName || 'Chưa chọn máy'}</p>
                      <p className="text-xs text-slate-500 truncate max-w-xs">
                        {p.assignments.map((a) => a.staffName).join(', ')}
                      </p>
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(p.targetKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(p.issuedNvlKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium text-slate-900">
                      {formatKg(p.approvedOutputKg)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={p.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      {isManager && ['PLANNED', 'RUNNING'].includes(p.status) && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCompletePlan(p.id)}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Hoàn tất
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
          totalItems={filteredPlans.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      <ModalDrawer
        open={formOpen}
        title={editing ? `Cập nhật kế hoạch ${editing.code}` : 'Lập kế hoạch & phân công ca'}
        onClose={() => setFormOpen(false)}
        isDirty={dirty}
        wide
      >
        <form onSubmit={handleSavePlan} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Ngày sản xuất <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={planDate}
                onChange={(e) => {
                  setPlanDate(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Ca làm việc <span className="text-red-600">*</span>
              </label>
              <select
                value={shift}
                onChange={(e) => {
                  setShift(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              >
                <option value="Ca 1">Ca 1</option>
                <option value="Ca 2">Ca 2</option>
                <option value="Ca 3">Ca 3</option>
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Mục tiêu sản lượng (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={targetKg}
                onChange={(e) => {
                  setTargetKg(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Dây chuyền / Máy chính</label>
            <select
              value={machineId}
              onChange={(e) => {
                setMachineId(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
            >
              <option value="">Chọn máy vận hành</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-slate-700">
                Phân công công nhân thực hiện <span className="text-red-600">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setAssignRows((prev) => [...prev, { staffId: '', taskRole: 'Phụ trách đóng bao' }]);
                  setDirty(true);
                }}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                + Thêm công nhân
              </button>
            </div>

            <div className="space-y-2">
              {assignRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.staffId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAssignRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, staffId: val } : r))
                      );
                      setDirty(true);
                    }}
                    className="flex-1 px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">Chọn công nhân</option>
                    {staffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={row.taskRole}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAssignRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, taskRole: val } : r))
                      );
                      setDirty(true);
                    }}
                    placeholder="Nhiệm vụ trong ca"
                    className="flex-1 px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                  />
                  {assignRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setAssignRows((prev) => prev.filter((_, i) => i !== idx));
                        setDirty(true);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600"
                      aria-label="Xóa dòng phân công"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú ca sản xuất</label>
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
              {saving ? 'Đang lưu...' : 'Lưu kế hoạch'}
            </button>
          </div>
        </form>
      </ModalDrawer>
    </div>
  );
}

// ==================== STAFF ASSIGNMENTS PAGE (/cong-viec-phan-cong) ====================
export function StaffAssignmentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: PlanItem[] }>('/api/production/plans');
      setPlans(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách công việc được giao.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activePlans = plans.filter((p) => ['PLANNED', 'RUNNING'].includes(p.status));

  return (
    <div className="space-y-3.5">
      <PageHeader title="Công việc được giao" />

      <CompactMetricsRow
        items={[
          { label: 'Kế hoạch đang mở', value: `${activePlans.length}` },
          { label: 'Tổng ca đã phân công', value: `${plans.length}` },
        ]}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={plans.length === 0}
        emptyText="Bạn chưa có ca sản xuất nào được phân công"
        onRetry={loadData}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã kế hoạch</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Máy vận hành</th>
                  <th className="py-2.5 px-3.5 font-medium">Nhiệm vụ của bạn</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Mục tiêu ca</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">NVL kho đã cấp</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => {
                  const myAssign = p.assignments.find((a) => a.staffId === user?.id);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                        {p.code}
                        <DemoMarker isDemo={p.isDemo} />
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <span className="font-data">{formatDate(p.planDate)}</span> ·{' '}
                        <span className="font-medium">{p.shift}</span>
                      </td>
                      <td className="py-2.5 px-3.5">{p.machineName || '—'}</td>
                      <td className="py-2.5 px-3.5">{myAssign?.taskRole || 'Vận hành sản xuất'}</td>
                      <td className="py-2.5 px-3.5 text-right font-data">{formatKg(p.targetKg)}</td>
                      <td className="py-2.5 px-3.5 text-right font-data">{formatKg(p.issuedNvlKg)}</td>
                      <td className="py-2.5 px-3.5">
                        <StatusLabel status={p.status} />
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                        {['PLANNED', 'RUNNING'].includes(p.status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/bao-cao-ca?planId=${p.id}`)}
                              className="text-xs font-medium text-emerald-700 hover:underline"
                            >
                              Gửi báo cáo ca
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate('/su-co-may-moc')}
                              className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                            >
                              Báo sự cố máy
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>
    </div>
  );
}

// ==================== SHIFT REPORTS PAGE (/bao-cao-ca) ====================
interface ShiftReportItem {
  id: number;
  code: string;
  batchCode: string;
  planId: number;
  planCode: string;
  planTargetKg: number;
  productionDate: string;
  shift: string;
  staffId: number;
  staffName: string;
  nvlUsedKg: number;
  outputKg: number;
  note: string;
  status: string;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  batchGrade: string | null;
  batchQcStatus: string | null;
  batchWarehouseStatus: string | null;
  isDemo: boolean;
}

export function ShiftReportsPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';
  const preselectedPlanId = searchParams.get('planId') || '';

  const [reports, setReports] = useState<ShiftReportItem[]>([]);
  const [myPlans, setMyPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<ShiftReportItem | null>(null);
  const [planId, setPlanId] = useState('');
  const [nvlUsedKg, setNvlUsedKg] = useState('');
  const [outputKg, setOutputKg] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [detailData, setDetailData] = useState<{
    report: ShiftReportItem;
    attachments: AttachmentItem[];
    history: AuditHistoryItem[];
  } | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);

  const isStaff = user?.role === RoleCode.STAFF;
  const isManager = user?.role === RoleCode.MANAGER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const repRes = await apiRequest<{ items: ShiftReportItem[] }>('/api/production/shift-reports');
      setReports(repRes.items);
      if (isStaff) {
        const planRes = await apiRequest<{ items: PlanItem[] }>('/api/production/plans');
        setMyPlans(planRes.items.filter((p) => ['PLANNED', 'RUNNING'].includes(p.status)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách báo cáo ca.');
    } finally {
      setLoading(false);
    }
  }, [isStaff]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (isStaff && preselectedPlanId && myPlans.length > 0 && !formOpen) {
      setEditingReport(null);
      setPlanId(preselectedPlanId);
      setNvlUsedKg('');
      setOutputKg('');
      setNote('');
      setDirty(false);
      setFormOpen(true);
    }
  }, [isStaff, preselectedPlanId, myPlans.length, formOpen]);

  const updateFilter = (nextQ: string, nextStatus: string) => {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextStatus) next.set('status', nextStatus);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (
        q &&
        !r.code.toLowerCase().includes(q) &&
        !r.batchCode.toLowerCase().includes(q) &&
        !r.staffName.toLowerCase().includes(q) &&
        !r.planCode.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [reports, search, statusFilter]);

  const pagedReports = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredReports.slice(start, start + PAGE_SIZE);
  }, [filteredReports, page]);

  const openCreate = () => {
    setEditingReport(null);
    setPlanId(myPlans[0]?.id ? String(myPlans[0].id) : '');
    setNvlUsedKg('');
    setOutputKg('');
    setNote('');
    setDirty(false);
    setFormOpen(true);
  };

  const openResubmit = (rep: ShiftReportItem) => {
    setEditingReport(rep);
    setPlanId(String(rep.planId));
    setNvlUsedKg(String(rep.nvlUsedKg));
    setOutputKg(String(rep.outputKg));
    setNote(rep.note);
    setDirty(false);
    setFormOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const nvl = Number(nvlUsedKg);
    const out = Number(outputKg);
    if (!Number.isFinite(nvl) || nvl <= 0 || !Number.isFinite(out) || out <= 0) {
      notifyError('Vui lòng nhập khối lượng NVL sử dụng và sản lượng thành phẩm lớn hơn 0.');
      return;
    }

    setSaving(true);
    try {
      if (editingReport) {
        await apiRequest(`/api/production/shift-reports/${editingReport.id}`, {
          method: 'PUT',
          body: JSON.stringify({ nvlUsedKg: nvl, outputKg: out, note: note.trim() }),
        });
        notifySuccess('Đã chỉnh sửa và gửi lại báo cáo ca (giữ nguyên mã lô).');
      } else {
        if (!planId) {
          notifyError('Vui lòng chọn kế hoạch sản xuất.');
          setSaving(false);
          return;
        }
        const res = await apiRequest<{ batchCode: string }>('/api/production/shift-reports', {
          method: 'POST',
          body: JSON.stringify({ planId: Number(planId), nvlUsedKg: nvl, outputKg: out, note: note.trim() }),
        });
        notifySuccess(`Đã gửi báo cáo ca — Mã lô tự động: ${res.batchCode}`);
      }
      setDirty(false);
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể gửi báo cáo ca.');
    } finally {
      setSaving(false);
    }
  };

  const handleManagerDecision = async (id: number, decision: 'APPROVE' | 'REJECT', reason?: string) => {
    setSaving(true);
    try {
      await apiRequest(`/api/production/shift-reports/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      notifySuccess(
        decision === 'APPROVE'
          ? 'Đã duyệt báo cáo ca và chuyển lô sang QC theo ca.'
          : 'Đã trả lại báo cáo ca kèm lý do.'
      );
      setRejectTargetId(null);
      setDetailData(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể xử lý duyệt báo cáo ca.');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    try {
      const res = await apiRequest<{
        report: ShiftReportItem;
        attachments: AttachmentItem[];
        history: AuditHistoryItem[];
      }>(`/api/production/shift-reports/${id}`);
      setDetailData(res);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể mở chi tiết báo cáo ca.');
    }
  };

  const pendingCnt = reports.filter((r) => r.status === 'SUBMITTED').length;
  const approvedCnt = reports.filter((r) => r.status === 'APPROVED').length;
  const rejectedCnt = reports.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Báo cáo ca"
        primaryAction={
          isStaff ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Plus className="w-4 h-4" />
              Gửi báo cáo ca
            </button>
          ) : undefined
        }
      />

      <CompactMetricsRow
        items={[
          { label: 'Tổng báo cáo ca', value: `${reports.length}`, onClick: () => updateFilter(search, '') },
          { label: 'Chờ Manager duyệt', value: `${pendingCnt}`, onClick: () => updateFilter(search, 'SUBMITTED') },
          { label: 'Đã duyệt', value: `${approvedCnt}`, onClick: () => updateFilter(search, 'APPROVED') },
          { label: 'Cần chỉnh sửa', value: `${rejectedCnt}`, onClick: () => updateFilter(search, 'REJECTED') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, statusFilter)}
        searchPlaceholder="Tìm theo mã báo cáo, mã lô TP/..., kế hoạch, công nhân..."
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={statusFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="SUBMITTED">Chờ Manager duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Từ chối / Trả lại</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={reports.length === 0}
        isFilteredEmpty={reports.length > 0 && filteredReports.length === 0}
        emptyText="Chưa có báo cáo ca sản xuất nào"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã báo cáo</th>
                  <th className="py-2.5 px-3.5 font-medium">Mã lô thành phẩm</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Công nhân</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">NVL dùng</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Sản lượng ra</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedReports.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {r.code}
                      <DemoMarker isDemo={r.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 font-data text-slate-800 whitespace-nowrap">
                      {r.batchCode}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data">{formatDate(r.productionDate)}</span> · {r.shift}
                    </td>
                    <td className="py-2.5 px-3.5">{r.staffName}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(r.nvlUsedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium text-slate-900">
                      {formatKg(r.outputKg)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={r.status} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(r.id)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Chi tiết
                      </button>
                      {isStaff && r.status === 'REJECTED' && r.staffId === user?.id && (
                        <button
                          type="button"
                          onClick={() => openResubmit(r)}
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        >
                          Sửa & gửi lại
                        </button>
                      )}
                      {isManager && r.status === 'SUBMITTED' && r.staffId !== user?.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleManagerDecision(r.id, 'APPROVE')}
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Duyệt
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTargetId(r.id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Trả lại
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
          totalItems={filteredReports.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Submit / Resubmit Shift Report Drawer */}
      <ModalDrawer
        open={formOpen}
        title={
          editingReport
            ? `Chỉnh sửa báo cáo ca ${editingReport.code} (Lô ${editingReport.batchCode})`
            : 'Gửi báo cáo kết quả ca sản xuất'
        }
        onClose={() => setFormOpen(false)}
        isDirty={dirty}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          {editingReport ? (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                Mã lô thành phẩm giữ nguyên: <strong className="font-data">{editingReport.batchCode}</strong>
              </p>
              {editingReport.rejectReason && (
                <p className="text-xs text-red-700">Lý do cần chỉnh sửa: {editingReport.rejectReason}</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Kế hoạch ca được phân công <span className="text-red-600">*</span>
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
                {myPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {formatDate(p.planDate)} ({p.shift})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                NVL thực tế sử dụng (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={nvlUsedKg}
                onChange={(e) => {
                  setNvlUsedKg(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ví dụ: 5100"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Sản lượng viên gỗ nén ra (kg) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={outputKg}
                onChange={(e) => {
                  setOutputKg(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ví dụ: 4250"
                className="w-full px-3 py-2 text-[13.5px] font-data border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi chú vận hành ca</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
              placeholder="Ghi chú tình trạng ép viên, đóng bao..."
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
              {saving ? 'Đang gửi...' : editingReport ? 'Gửi lại báo cáo ca' : 'Gửi báo cáo ca'}
            </button>
          </div>
        </form>
      </ModalDrawer>

      {/* Shift Report Detail Drawer */}
      <ModalDrawer
        open={Boolean(detailData)}
        title={detailData ? `Báo cáo ca ${detailData.report.code}` : 'Chi tiết báo cáo ca'}
        onClose={() => setDetailData(null)}
        wide
      >
        {detailData && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 text-[13px]">
              <div>
                <span className="text-slate-500">Mã lô tự động:</span>{' '}
                <strong className="font-data text-slate-900">{detailData.report.batchCode}</strong>
              </div>
              <div>
                <span className="text-slate-500">Trạng thái:</span>{' '}
                <StatusLabel status={detailData.report.status} />
              </div>
              <div>
                <span className="text-slate-500">Kế hoạch / Ca:</span>{' '}
                <span className="font-data">{detailData.report.planCode}</span> · {detailData.report.shift}
              </div>
              <div>
                <span className="text-slate-500">Công nhân báo cáo:</span>{' '}
                <span>{detailData.report.staffName}</span>
              </div>
              <div>
                <span className="text-slate-500">NVL thực tế dùng:</span>{' '}
                <strong className="font-data">{formatKg(detailData.report.nvlUsedKg)}</strong>
              </div>
              <div>
                <span className="text-slate-500">Sản lượng thành phẩm:</span>{' '}
                <strong className="font-data">{formatKg(detailData.report.outputKg)}</strong>
              </div>
              {detailData.report.batchGrade && (
                <div>
                  <span className="text-slate-500">Phân loại QC theo ca:</span>{' '}
                  <strong>{detailData.report.batchGrade}</strong>
                </div>
              )}
              {detailData.report.batchWarehouseStatus && (
                <div>
                  <span className="text-slate-500">Trạng thái kho thành phẩm:</span>{' '}
                  <StatusLabel status={detailData.report.batchWarehouseStatus} />
                </div>
              )}
              {detailData.report.rejectReason && (
                <div className="sm:col-span-2 text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs">
                  Lý do trả lại: {detailData.report.rejectReason}
                </div>
              )}
            </div>

            <HistoryTimelineSection items={detailData.history} />
          </div>
        )}
      </ModalDrawer>

      <ReasonConfirmModal
        open={rejectTargetId !== null}
        title="Trả lại báo cáo ca yêu cầu chỉnh sửa"
        actionLabel="Xác nhận trả lại"
        placeholder="Nhập lý do số liệu chưa khớp để công nhân cập nhật lại..."
        loading={saving}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={(reason) => {
          if (rejectTargetId !== null) {
            void handleManagerDecision(rejectTargetId, 'REJECT', reason);
          }
        }}
      />
    </div>
  );
}

// ==================== SHIFT QC PAGE (/kiem-tra-chat-luong) ====================
interface ShiftBatchItem {
  id: number;
  batchCode: string;
  planCode: string;
  shiftReportCode: string;
  productionDate: string;
  shift: string;
  producerName: string;
  producedKg: number;
  initialKg: number;
  availableKg: number;
  grade: string | null;
  qcStatus: string;
  warehouseStatus: string;
  packagingInfo: string;
  inspections: Array<{
    id: number;
    code: string;
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
  isDemo: boolean;
}

export function ShiftQcPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const qcFilter = searchParams.get('status') || '';

  const [batches, setBatches] = useState<ShiftBatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [inspectTarget, setInspectTarget] = useState<ShiftBatchItem | null>(null);
  const [grade, setGrade] = useState<'Grade A' | 'Grade B'>('Grade A');
  const [inspectionResult, setInspectionResult] = useState<'PASSED' | 'NEEDS_REVIEW'>('PASSED');
  const [moistureNote, setMoistureNote] = useState('');
  const [durabilityNote, setDurabilityNote] = useState('');
  const [appearanceNote, setAppearanceNote] = useState('');
  const [foreignMatterNote, setForeignMatterNote] = useState('');
  const [note, setNote] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<UploadedFileResponse | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [historyTarget, setHistoryTarget] = useState<ShiftBatchItem | null>(null);

  const isQcStaff = user?.role === RoleCode.QC_STAFF;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: ShiftBatchItem[] }>('/api/qc/shift');
      setBatches(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách lô chờ QC theo ca.');
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

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((b) => {
      if (qcFilter && b.qcStatus !== qcFilter) return false;
      if (
        q &&
        !b.batchCode.toLowerCase().includes(q) &&
        !b.planCode.toLowerCase().includes(q) &&
        !b.producerName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [batches, search, qcFilter]);

  const pagedBatches = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredBatches.slice(start, start + PAGE_SIZE);
  }, [filteredBatches, page]);

  const openInspect = (b: ShiftBatchItem) => {
    setInspectTarget(b);
    setGrade((b.grade as 'Grade A' | 'Grade B') || 'Grade A');
    setInspectionResult('PASSED');
    setMoistureNote('');
    setDurabilityNote('');
    setAppearanceNote('');
    setForeignMatterNote('');
    setNote('');
    setEvidenceFile(null);
    setDirty(false);
  };

  const handleSaveQc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectTarget) return;
    if (!evidenceFile) {
      notifyError('Vui lòng đính kèm ảnh bằng chứng kiểm tra QC theo ca.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/qc/shift/${inspectTarget.id}`, {
        method: 'POST',
        body: JSON.stringify({
          grade,
          inspectionResult,
          moistureNote: moistureNote.trim(),
          durabilityNote: durabilityNote.trim(),
          appearanceNote: appearanceNote.trim(),
          foreignMatterNote: foreignMatterNote.trim(),
          note: note.trim(),
          evidenceAttachment: evidenceFile,
        }),
      });
      notifySuccess(`Đã lưu kết quả QC theo ca (${grade}).`);
      setDirty(false);
      setInspectTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể lưu kết quả QC theo ca.');
    } finally {
      setSaving(false);
    }
  };

  const pendingCnt = batches.filter((b) => b.qcStatus === 'PENDING_QC').length;
  const inspectedCnt = batches.filter((b) => b.qcStatus === 'INSPECTED').length;

  return (
    <div className="space-y-3.5">
      <PageHeader title="QC theo ca" />

      <CompactMetricsRow
        items={[
          { label: 'Tổng lô sản xuất', value: `${batches.length}`, onClick: () => updateFilter(search, '') },
          { label: 'Chờ QC theo ca', value: `${pendingCnt}`, onClick: () => updateFilter(search, 'PENDING_QC') },
          { label: 'Đã kiểm tra QC', value: `${inspectedCnt}`, onClick: () => updateFilter(search, 'INSPECTED') },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => updateFilter(val, qcFilter)}
        searchPlaceholder="Tìm theo mã lô TP/..., kế hoạch, công nhân..."
        hasActiveFilters={Boolean(search || qcFilter)}
        onReset={() => updateFilter('', '')}
      >
        <select
          value={qcFilter}
          onChange={(e) => updateFilter(search, e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả trạng thái QC</option>
          <option value="PENDING_QC">Chờ QC theo ca</option>
          <option value="INSPECTED">Đã kiểm tra QC</option>
          <option value="NEEDS_REVIEW">Cần xem xét QC</option>
        </select>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={batches.length === 0}
        isFilteredEmpty={batches.length > 0 && filteredBatches.length === 0}
        emptyText="Chưa có lô thành phẩm nào từ sản xuất chuyển sang"
        onRetry={loadData}
        onClearFilter={() => updateFilter('', '')}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã lô</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Công nhân báo cáo</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Sản lượng báo cáo</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại Grade</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái QC</th>
                  <th className="py-2.5 px-3.5 font-medium">Kho thành phẩm</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {b.batchCode}
                      <DemoMarker isDemo={b.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data">{formatDate(b.productionDate)}</span> · {b.shift}
                    </td>
                    <td className="py-2.5 px-3.5">{b.producerName}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(b.producedKg)}</td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{b.grade || '—'}</td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={b.qcStatus} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={b.warehouseStatus} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => setHistoryTarget(b)}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Hồ sơ QC
                      </button>
                      {isQcStaff && !['IN_STOCK', 'DEPLETED'].includes(b.warehouseStatus) && (
                        <button
                          type="button"
                          onClick={() => openInspect(b)}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                        >
                          Thực hiện QC
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
          totalItems={filteredBatches.length}
          onPageChange={setPage}
        />
      </ScreenStateView>

      {/* Perform Shift QC Drawer */}
      <ModalDrawer
        open={Boolean(inspectTarget)}
        title={inspectTarget ? `Kiểm tra QC theo ca — Lô ${inspectTarget.batchCode}` : 'Kiểm tra QC theo ca'}
        onClose={() => setInspectTarget(null)}
        isDirty={dirty}
      >
        {inspectTarget && (
          <form onSubmit={handleSaveQc} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Ngày / Ca sản xuất:</span>{' '}
                <span className="font-data">{formatDate(inspectTarget.productionDate)}</span> ·{' '}
                {inspectTarget.shift}
              </p>
              <p>
                <span className="text-slate-500">Sản lượng ca:</span>{' '}
                <strong className="font-data">{formatKg(inspectTarget.producedKg)}</strong>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Phân loại sản phẩm thương mại <span className="text-red-600">*</span>
                </label>
                <select
                  value={grade}
                  onChange={(e) => {
                    setGrade(e.target.value as 'Grade A' | 'Grade B');
                    setDirty(true);
                  }}
                  className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                >
                  <option value="Grade A">Grade A</option>
                  <option value="Grade B">Grade B</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Kết luận kiểm tra <span className="text-red-600">*</span>
                </label>
                <select
                  value={inspectionResult}
                  onChange={(e) => {
                    setInspectionResult(e.target.value as 'PASSED' | 'NEEDS_REVIEW');
                    setDirty(true);
                  }}
                  className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                >
                  <option value="PASSED">Đạt điều kiện chuyển kho thành phẩm</option>
                  <option value="NEEDS_REVIEW">Cần xem xét lại trước khi nhập kho</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Ghi nhận độ ẩm</label>
                <input
                  type="text"
                  value={moistureNote}
                  onChange={(e) => {
                    setMoistureNote(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Ví dụ: Độ ẩm đo thực tế 7.8%"
                  className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Độ bền cơ học / Vụn</label>
                <input
                  type="text"
                  value={durabilityNote}
                  onChange={(e) => {
                    setDurabilityNote(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Ví dụ: Viên chắc, ít bụi mịn"
                  className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Ngoại quan màu sắc</label>
                <input
                  type="text"
                  value={appearanceNote}
                  onChange={(e) => {
                    setAppearanceNote(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Màu sáng hoặc sẫm tự nhiên"
                  className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Tạp chất quan sát</label>
                <input
                  type="text"
                  value={foreignMatterNote}
                  onChange={(e) => {
                    setForeignMatterNote(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Không lẫn tạp chất lạ"
                  className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <FileUploadBox
              label="Ảnh mẫu kiểm tra QC theo ca"
              required
              value={evidenceFile}
              onChange={(f) => {
                setEvidenceFile(f);
                setDirty(true);
              }}
              contextCaption={`Lô ${inspectTarget.batchCode} · ${grade}`}
            />

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Nhận xét bổ sung</label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
                className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setInspectTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Lưu kết quả QC'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>

      {/* QC History Drawer */}
      <ModalDrawer
        open={Boolean(historyTarget)}
        title={historyTarget ? `Hồ sơ QC lô ${historyTarget.batchCode}` : 'Hồ sơ QC'}
        onClose={() => setHistoryTarget(null)}
        wide
      >
        {historyTarget && (
          <div className="space-y-4">
            {historyTarget.inspections.length === 0 ? (
              <p className="text-[13px] text-slate-500">Lô này chưa có biên bản kiểm tra QC theo ca</p>
            ) : (
              historyTarget.inspections.map((insp) => (
                <div key={insp.id} className="border border-slate-200 rounded-md p-4 space-y-3 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <span className="font-data font-semibold text-slate-900">{insp.code}</span> ·{' '}
                      <strong className="text-emerald-700">{insp.grade}</strong>
                    </div>
                    <span className="text-xs font-data text-slate-500">
                      {insp.inspectorName} · {formatDateTime(insp.inspectedAt)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
                    <p>
                      <span className="text-slate-500">Độ ẩm:</span> {insp.moistureNote || '—'}
                    </p>
                    <p>
                      <span className="text-slate-500">Độ bền:</span> {insp.durabilityNote || '—'}
                    </p>
                    <p>
                      <span className="text-slate-500">Ngoại quan:</span> {insp.appearanceNote || '—'}
                    </p>
                    <p>
                      <span className="text-slate-500">Tạp chất:</span> {insp.foreignMatterNote || '—'}
                    </p>
                  </div>
                  <AttachmentListSection
                    recordReference={`${historyTarget.batchCode} (${insp.code})`}
                    items={insp.attachments}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== FINISHED GOODS RECEIPT PAGE (/tiep-nhan-thanh-pham) ====================
export function FinishedGoodsReceiptPage() {
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const [batches, setBatches] = useState<ShiftBatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<ShiftBatchItem | null>(null);
  const [receivedKg, setReceivedKg] = useState('');
  const [packagingInfo, setPackagingInfo] = useState('Bao Jumbo 1 tấn');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isWarehouseKeeper = user?.role === RoleCode.WAREHOUSE_KEEPER;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: ShiftBatchItem[] }>('/api/qc/shift');
      setBatches(
        res.items.filter((b) => ['PENDING_RECEIPT', 'IN_STOCK', 'DEPLETED'].includes(b.warehouseStatus))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách tiếp nhận thành phẩm.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((b) => !q || b.batchCode.toLowerCase().includes(q));
  }, [batches, search]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const kg = Number(receivedKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      notifyError('Khối lượng thành phẩm thực nhận phải lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/warehouse/finished-receipts/${target.id}`, {
        method: 'POST',
        body: JSON.stringify({
          receivedKg: kg,
          packagingInfo: packagingInfo.trim() || 'Bao Jumbo',
        }),
      });
      notifySuccess(`Đã tiếp nhận lô ${target.batchCode} vào tồn kho thành phẩm.`);
      setDirty(false);
      setTarget(null);
      await loadData();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Không thể tiếp nhận thành phẩm.');
    } finally {
      setSaving(false);
    }
  };

  const pendingCnt = batches.filter((b) => b.warehouseStatus === 'PENDING_RECEIPT').length;
  const stockedCnt = batches.filter((b) => b.warehouseStatus !== 'PENDING_RECEIPT').length;

  return (
    <div className="space-y-3.5">
      <PageHeader title="Tiếp nhận thành phẩm" />

      <CompactMetricsRow
        items={[
          { label: 'Lô chờ tiếp nhận kho', value: `${pendingCnt}` },
          { label: 'Lô đã nhập kho', value: `${stockedCnt}` },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => {
          const next = new URLSearchParams();
          if (val) next.set('q', val);
          setSearchParams(next, { replace: true });
        }}
        searchPlaceholder="Tìm theo mã lô thành phẩm TP/..."
        hasActiveFilters={Boolean(search)}
        onReset={() => setSearchParams(new URLSearchParams(), { replace: true })}
      />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={batches.length === 0}
        isFilteredEmpty={batches.length > 0 && filtered.length === 0}
        emptyText="Chưa có lô thành phẩm hoàn tất QC chờ nhập kho"
        onRetry={loadData}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Mã lô</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại QC</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Sản lượng báo cáo</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã nhận kho</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái kho</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {b.batchCode}
                      <DemoMarker isDemo={b.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data">{formatDate(b.productionDate)}</span> · {b.shift}
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{b.grade || '—'}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(b.producedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-medium">
                      {b.initialKg > 0 ? formatKg(b.initialKg) : '—'}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={b.warehouseStatus} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      {isWarehouseKeeper && b.warehouseStatus === 'PENDING_RECEIPT' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTarget(b);
                            setReceivedKg(String(b.producedKg));
                            setPackagingInfo(b.packagingInfo || 'Bao Jumbo');
                            setDirty(false);
                          }}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded"
                        >
                          Xác nhận nhập kho
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">{b.packagingInfo || '—'}</span>
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
        open={Boolean(target)}
        title={target ? `Tiếp nhận thành phẩm — Lô ${target.batchCode}` : 'Tiếp nhận thành phẩm'}
        onClose={() => setTarget(null)}
        isDirty={dirty}
      >
        {target && (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[13px] space-y-1">
              <p>
                <span className="text-slate-500">Phân loại QC theo ca:</span>{' '}
                <strong>{target.grade}</strong>
              </p>
              <p>
                <span className="text-slate-500">Sản lượng ca báo cáo:</span>{' '}
                <strong className="font-data">{formatKg(target.producedKg)}</strong>
              </p>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">
                Khối lượng thực nhận nhập kho (kg) <span className="text-red-600">*</span>
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
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Quy cách đóng gói</label>
              <input
                type="text"
                value={packagingInfo}
                onChange={(e) => {
                  setPackagingInfo(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ví dụ: Bao Jumbo 1 tấn"
                className="w-full px-3 py-2 text-[13.5px] border border-slate-300 rounded-md focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="px-3.5 py-2 text-[13px] text-slate-600 hover:text-slate-900"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Xác nhận nhập kho'}
              </button>
            </div>
          </form>
        )}
      </ModalDrawer>
    </div>
  );
}

// ==================== FINISHED INVENTORY PAGE (/ton-kho-thanh-pham) ====================
export function FinishedInventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const gradeFilter = searchParams.get('grade') || '';
  const includeHistory = searchParams.get('history') === '1';

  const [summary, setSummary] = useState({ totalAvailableKg: 0, gradeAKg: 0, gradeBKg: 0 });
  const [batches, setBatches] = useState<
    Array<{
      id: number;
      batchCode: string;
      productionDate: string;
      shift: string;
      grade: string;
      initialKg: number;
      dispatchedKg: number;
      availableKg: number;
      qcStatus: string;
      warehouseStatus: string;
      packagingInfo: string;
      isDemo: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        summary: { totalAvailableKg: number; gradeAKg: number; gradeBKg: number };
        batches: Array<{
          id: number;
          batchCode: string;
          productionDate: string;
          shift: string;
          grade: string;
          initialKg: number;
          dispatchedKg: number;
          availableKg: number;
          qcStatus: string;
          warehouseStatus: string;
          packagingInfo: string;
          isDemo: boolean;
        }>;
      }>(`/api/inventory/finished?includeHistory=${includeHistory ? 'true' : 'false'}`);
      setSummary(res.summary);
      setBatches(res.batches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải tồn kho thành phẩm.');
    } finally {
      setLoading(false);
    }
  }, [includeHistory]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const setParams = (q: string, grade: string, hist: boolean) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (grade) next.set('grade', grade);
    if (hist) next.set('history', '1');
    setSearchParams(next, { replace: true });
  };

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((b) => {
      if (gradeFilter && b.grade !== gradeFilter) return false;
      if (q && !b.batchCode.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [batches, search, gradeFilter]);

  return (
    <div className="space-y-3.5">
      <PageHeader title="Tồn kho thành phẩm" />

      <CompactMetricsRow
        items={[
          { label: 'Tổng tồn kho khả dụng', value: formatKg(summary.totalAvailableKg), onClick: () => setParams(search, '', includeHistory) },
          { label: 'Viên gỗ nén Grade A', value: formatKg(summary.gradeAKg), onClick: () => setParams(search, 'Grade A', includeHistory) },
          { label: 'Viên gỗ nén Grade B', value: formatKg(summary.gradeBKg), onClick: () => setParams(search, 'Grade B', includeHistory) },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearchChange={(val) => setParams(val, gradeFilter, includeHistory)}
        searchPlaceholder="Tìm theo mã lô thành phẩm TP/..."
        hasActiveFilters={Boolean(search || gradeFilter || includeHistory)}
        onReset={() => setParams('', '', false)}
      >
        <select
          value={gradeFilter}
          onChange={(e) => setParams(search, e.target.value, includeHistory)}
          className="px-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tất cả phân loại</option>
          <option value="Grade A">Grade A</option>
          <option value="Grade B">Grade B</option>
        </select>
        <label className="inline-flex items-center gap-2 text-[13px] text-slate-700 px-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setParams(search, gradeFilter, e.target.checked)}
            className="rounded border-slate-300"
          />
          <span>Hiển thị cả lô đã xuất hết</span>
        </label>
      </SearchFilterBar>

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={batches.length === 0}
        isFilteredEmpty={batches.length > 0 && filteredBatches.length === 0}
        emptyText="Chưa có lô thành phẩm nào đang tồn kho"
        onRetry={loadData}
        onClearFilter={() => setParams('', '', false)}
      >
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Thứ tự FIFO</th>
                  <th className="py-2.5 px-3.5 font-medium">Mã lô</th>
                  <th className="py-2.5 px-3.5 font-medium">Ngày sản xuất / Ca</th>
                  <th className="py-2.5 px-3.5 font-medium">Phân loại</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Nhập ban đầu</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Đã xuất</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Tồn khả dụng</th>
                  <th className="py-2.5 px-3.5 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.map((b, index) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3.5 font-data text-slate-500">
                      {b.availableKg > 0 ? `#${index + 1}` : '—'}
                    </td>
                    <td className="py-2.5 px-3.5 font-data font-medium text-slate-900 whitespace-nowrap">
                      {b.batchCode}
                      <DemoMarker isDemo={b.isDemo} />
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-data">{formatDate(b.productionDate)}</span> · {b.shift}
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{b.grade}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(b.initialKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data">{formatKg(b.dispatchedKg)}</td>
                    <td className="py-2.5 px-3.5 text-right font-data font-semibold text-slate-900">
                      {formatKg(b.availableKg)}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <StatusLabel status={b.warehouseStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScreenStateView>
    </div>
  );
}
