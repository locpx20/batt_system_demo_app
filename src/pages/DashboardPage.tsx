import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoleCode } from '../../shared/types.ts';
import { useAuth } from '../context/AppContexts.tsx';
import { apiRequest, formatCurrency, formatDate, formatKg } from '../lib/api.ts';
import {
  CompactMetricsRow,
  DemoMarker,
  PageHeader,
  ScreenStateView,
  StatusLabel,
} from '../components/ui/SharedUi.tsx';

interface DashboardCard {
  label: string;
  value: string;
  path: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<Record<string, unknown>>('/api/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu tổng quan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (!user) return null;

  const cards = ((data?.cards as DashboardCard[]) || []).map((c) => ({
    label: c.label,
    value: c.value,
    onClick: () => navigate(c.path),
  }));

  const goRecord = (path: string, code: string) => {
    navigate(`${path}?q=${encodeURIComponent(code)}`);
  };

  return (
    <div className="space-y-3.5">
      <PageHeader title="Tổng quan" />

      <ScreenStateView
        loading={loading}
        error={error}
        isEmpty={!data}
        emptyText="Chưa có dữ liệu tổng quan"
        onRetry={loadDashboard}
      >
        <CompactMetricsRow items={cards} />

        {/* OWNER WORK QUEUES */}
        {user.role === RoleCode.OWNER && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">
                  Yêu cầu xuất hàng chờ quyết định
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/duyet-xuat-hang')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Mở danh sách
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã yêu cầu</th>
                      <th className="py-2 px-3.5">Khách hàng</th>
                      <th className="py-2 px-3.5">Phân loại</th>
                      <th className="py-2 px-3.5 text-right">Khối lượng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.pendingOutbounds as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          Không có yêu cầu xuất hàng chờ quyết định
                        </td>
                      </tr>
                    ) : (
                      ((data.pendingOutbounds as Array<Record<string, unknown>>) || []).map((o) => (
                        <tr key={Number(o.id)} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/duyet-xuat-hang', String(o.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(o.code)}
                            </button>
                            <DemoMarker isDemo={Number(o.isDemo) === 1} />
                          </td>
                          <td className="py-2.5 px-3.5 truncate max-w-[160px]">{String(o.customerName)}</td>
                          <td className="py-2.5 px-3.5 font-medium">{String(o.acceptedGrade)}</td>
                          <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(o.requestedKg))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Phiếu thu mua chờ duyệt</h2>
                <button
                  type="button"
                  onClick={() => navigate('/thu-mua')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Mở danh sách
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã phiếu</th>
                      <th className="py-2 px-3.5">Nhà cung cấp</th>
                      <th className="py-2 px-3.5 text-right">Khối lượng</th>
                      <th className="py-2 px-3.5 text-right">Giá trị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.pendingPurchasings as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          Không có phiếu thu mua chờ duyệt
                        </td>
                      </tr>
                    ) : (
                      ((data.pendingPurchasings as Array<Record<string, unknown>>) || []).map((p) => (
                        <tr key={Number(p.id)} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/thu-mua', String(p.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(p.code)}
                            </button>
                            <DemoMarker isDemo={Number(p.isDemo) === 1} />
                          </td>
                          <td className="py-2.5 px-3.5 truncate max-w-[160px]">{String(p.supplierName)}</td>
                          <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(p.weighedKg))}</td>
                          <td className="py-2.5 px-3.5 text-right font-data">
                            {p.totalAmount !== null ? formatCurrency(Number(p.totalAmount)) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Sự cố máy móc đang xử lý</h2>
                <button
                  type="button"
                  onClick={() => navigate('/su-co-may-moc')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Xem toàn bộ
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã yêu cầu</th>
                      <th className="py-2 px-3.5">Thiết bị</th>
                      <th className="py-2 px-3.5">Mức độ</th>
                      <th className="py-2 px-3.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.activeMaintenances as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-5 text-center text-slate-500">
                          Không có sự cố máy móc đang tồn đọng
                        </td>
                      </tr>
                    ) : (
                      ((data.activeMaintenances as Array<Record<string, unknown>>) || []).map((m) => (
                        <tr key={Number(m.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/su-co-may-moc', String(m.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(m.code)}
                            </button>
                            <DemoMarker isDemo={Number(m.isDemo) === 1} />
                          </td>
                          <td className="py-2 px-3.5">{String(m.machineName)}</td>
                          <td className="py-2 px-3.5 text-slate-600">{String(m.severity)}</td>
                          <td className="py-2 px-3.5">
                            <StatusLabel status={String(m.status)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MANAGER WORK QUEUES */}
        {user.role === RoleCode.MANAGER && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Báo cáo ca mới gửi</h2>
                <button
                  type="button"
                  onClick={() => navigate('/bao-cao-ca')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Xử lý báo cáo ca
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã báo cáo</th>
                      <th className="py-2 px-3.5">Nhân viên</th>
                      <th className="py-2 px-3.5 text-right">Sản lượng</th>
                      <th className="py-2 px-3.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.shiftReports as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-5 text-center text-slate-500">
                          Không có báo cáo ca chờ duyệt
                        </td>
                      </tr>
                    ) : (
                      ((data.shiftReports as Array<Record<string, unknown>>) || []).map((sr) => (
                        <tr key={Number(sr.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/bao-cao-ca', String(sr.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(sr.code)}
                            </button>
                          </td>
                          <td className="py-2 px-3.5">{String(sr.staffName)}</td>
                          <td className="py-2 px-3.5 text-right font-data">{formatKg(Number(sr.outputKg))}</td>
                          <td className="py-2 px-3.5">
                            <StatusLabel status={String(sr.status)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Phiếu thu mua cần xem</h2>
                <button
                  type="button"
                  onClick={() => navigate('/thu-mua')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Duyệt thu mua
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã phiếu</th>
                      <th className="py-2 px-3.5">Nhà cung cấp</th>
                      <th className="py-2 px-3.5 text-right">Khối lượng cân</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.purchasingQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có phiếu thu mua chờ duyệt
                        </td>
                      </tr>
                    ) : (
                      ((data.purchasingQueue as Array<Record<string, unknown>>) || []).map((p) => (
                        <tr key={Number(p.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/thu-mua', String(p.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(p.code)}
                            </button>
                            <DemoMarker isDemo={Number(p.isDemo) === 1} />
                          </td>
                          <td className="py-2 px-3.5 truncate max-w-[180px]">{String(p.supplierName)}</td>
                          <td className="py-2 px-3.5 text-right font-data">{formatKg(Number(p.weighedKg))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Yêu cầu sửa chữa cần xử lý</h2>
                <button
                  type="button"
                  onClick={() => navigate('/su-co-may-moc')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Quản lý sự cố
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã yêu cầu</th>
                      <th className="py-2 px-3.5">Máy</th>
                      <th className="py-2 px-3.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.maintenanceQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có yêu cầu bảo trì chờ xử lý
                        </td>
                      </tr>
                    ) : (
                      ((data.maintenanceQueue as Array<Record<string, unknown>>) || []).map((m) => (
                        <tr key={Number(m.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/su-co-may-moc', String(m.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(m.code)}
                            </button>
                          </td>
                          <td className="py-2 px-3.5">{String(m.machineName)}</td>
                          <td className="py-2 px-3.5">
                            <StatusLabel status={String(m.status)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Yêu cầu xuất hàng chờ bước tiếp</h2>
                <button
                  type="button"
                  onClick={() => navigate('/yeu-cau-xuat-hang')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Quản lý xuất hàng
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã đơn</th>
                      <th className="py-2 px-3.5">Khách hàng</th>
                      <th className="py-2 px-3.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.outboundQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có đơn xuất cần cập nhật ngay
                        </td>
                      </tr>
                    ) : (
                      ((data.outboundQueue as Array<Record<string, unknown>>) || []).map((o) => (
                        <tr key={Number(o.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/yeu-cau-xuat-hang', String(o.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(o.code)}
                            </button>
                          </td>
                          <td className="py-2 px-3.5 truncate max-w-[160px]">{String(o.customerName)}</td>
                          <td className="py-2 px-3.5">
                            <StatusLabel status={String(o.status)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PURCHASING STAFF QUEUE */}
        {user.role === RoleCode.PURCHASING_STAFF && data && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Yêu cầu thu mua cần xử lý</h2>
              <button
                type="button"
                onClick={() => navigate('/thu-mua')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Mở danh sách thu mua
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Mã yêu cầu</th>
                    <th className="py-2.5 px-3.5">Nhà cung cấp</th>
                    <th className="py-2.5 px-3.5">Ngày yêu cầu</th>
                    <th className="py-2.5 px-3.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {((data.tasks as Array<Record<string, unknown>>) || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        Chưa có yêu cầu thu mua được giao
                      </td>
                    </tr>
                  ) : (
                    ((data.tasks as Array<Record<string, unknown>>) || []).map((t) => (
                      <tr key={Number(t.id)} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3.5 font-data font-medium">
                          <button
                            type="button"
                            onClick={() => goRecord('/thu-mua', String(t.code))}
                            className="text-blue-700 hover:underline"
                          >
                            {String(t.code)}
                          </button>
                          <DemoMarker isDemo={Number(t.isDemo) === 1} />
                        </td>
                        <td className="py-2.5 px-3.5">{String(t.supplierName)}</td>
                        <td className="py-2.5 px-3.5 font-data">{formatDate(String(t.requestDate))}</td>
                        <td className="py-2.5 px-3.5">
                          <StatusLabel status={String(t.status)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* WAREHOUSE KEEPER QUEUES */}
        {user.role === RoleCode.WAREHOUSE_KEEPER && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Phiếu chờ tiếp nhận NVL</h2>
                <button
                  type="button"
                  onClick={() => navigate('/nhap-kho-nvl')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Tiếp nhận NVL
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã phiếu</th>
                      <th className="py-2 px-3.5">Nhà cung cấp</th>
                      <th className="py-2 px-3.5 text-right">Khối lượng phiếu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.nvlQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có phiếu chờ nhận NVL
                        </td>
                      </tr>
                    ) : (
                      ((data.nvlQueue as Array<Record<string, unknown>>) || []).map((p) => (
                        <tr key={Number(p.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/nhap-kho-nvl', String(p.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(p.code)}
                            </button>
                            <DemoMarker isDemo={Number(p.isDemo) === 1} />
                          </td>
                          <td className="py-2 px-3.5 truncate max-w-[180px]">{String(p.supplierName)}</td>
                          <td className="py-2 px-3.5 text-right font-data">{formatKg(Number(p.weighedKg))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Đơn xuất cần chuẩn bị & bàn giao</h2>
                <button
                  type="button"
                  onClick={() => navigate('/ban-giao-xuat-hang')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Bàn giao xuất hàng
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã đơn</th>
                      <th className="py-2 px-3.5">Khách hàng</th>
                      <th className="py-2 px-3.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.dispatchQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có đơn xuất chờ bàn giao
                        </td>
                      </tr>
                    ) : (
                      ((data.dispatchQueue as Array<Record<string, unknown>>) || []).map((o) => (
                        <tr key={Number(o.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/ban-giao-xuat-hang', String(o.code))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(o.code)}
                            </button>
                          </td>
                          <td className="py-2 px-3.5 truncate max-w-[160px]">{String(o.customerName)}</td>
                          <td className="py-2 px-3.5">
                            <StatusLabel status={String(o.status)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* STAFF WORK QUEUE */}
        {user.role === RoleCode.STAFF && data && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Ca và kế hoạch được phân công</h2>
              <button
                type="button"
                onClick={() => navigate('/bao-cao-ca')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Gửi báo cáo ca
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Kế hoạch</th>
                    <th className="py-2.5 px-3.5">Ngày / Ca</th>
                    <th className="py-2.5 px-3.5">Dây chuyền</th>
                    <th className="py-2.5 px-3.5 text-right">Mục tiêu</th>
                    <th className="py-2.5 px-3.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {((data.assignments as Array<Record<string, unknown>>) || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        Chưa có kế hoạch sản xuất được phân công
                      </td>
                    </tr>
                  ) : (
                    ((data.assignments as Array<Record<string, unknown>>) || []).map((a) => (
                      <tr key={Number(a.id)} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3.5 font-data font-medium">
                          <button
                            type="button"
                            onClick={() => navigate('/cong-viec-phan-cong')}
                            className="text-blue-700 hover:underline"
                          >
                            {String(a.code)}
                          </button>
                          <DemoMarker isDemo={Number(a.isDemo) === 1} />
                        </td>
                        <td className="py-2.5 px-3.5 font-data">
                          {formatDate(String(a.planDate))} · {String(a.shift)}
                        </td>
                        <td className="py-2.5 px-3.5">{String(a.machineName || '—')}</td>
                        <td className="py-2.5 px-3.5 text-right font-data">{formatKg(Number(a.targetKg))}</td>
                        <td className="py-2.5 px-3.5">
                          <StatusLabel status={String(a.status)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* QC STAFF WORK QUEUE */}
        {user.role === RoleCode.QC_STAFF && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Lô chờ QC theo ca</h2>
                <button
                  type="button"
                  onClick={() => navigate('/kiem-tra-chat-luong')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Kiểm tra ngay
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã lô</th>
                      <th className="py-2 px-3.5">Ngày / Ca</th>
                      <th className="py-2 px-3.5 text-right">Khối lượng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.shiftQcQueue as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Không có lô thành phẩm chờ kiểm tra theo ca
                        </td>
                      </tr>
                    ) : (
                      ((data.shiftQcQueue as Array<Record<string, unknown>>) || []).map((b) => (
                        <tr key={Number(b.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/kiem-tra-chat-luong', String(b.batchCode))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(b.batchCode)}
                            </button>
                          </td>
                          <td className="py-2 px-3.5 font-data">
                            {formatDate(String(b.productionDate))} · {String(b.shift)}
                          </td>
                          <td className="py-2 px-3.5 text-right font-data">{formatKg(Number(b.producedKg))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900">Kết quả QC theo ca gần đây</h2>
                <button
                  type="button"
                  onClick={() => navigate('/kiem-tra-chat-luong')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Xem toàn bộ QC ca
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3.5">Mã lô</th>
                      <th className="py-2 px-3.5">Ngày / Ca</th>
                      <th className="py-2 px-3.5">Phân loại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {((data.recentShiftInspections as Array<Record<string, unknown>>) || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-5 text-center text-slate-500">
                          Chưa có biên bản QC theo ca
                        </td>
                      </tr>
                    ) : (
                      ((data.recentShiftInspections as Array<Record<string, unknown>>) || []).map((q) => (
                        <tr key={Number(q.id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3.5 font-data font-medium">
                            <button
                              type="button"
                              onClick={() => goRecord('/kiem-tra-chat-luong', String(q.batchCode))}
                              className="text-blue-700 hover:underline"
                            >
                              {String(q.batchCode)}
                            </button>
                            <DemoMarker isDemo={Number(q.isDemo) === 1} />
                          </td>
                          <td className="py-2 px-3.5 font-data">
                            {formatDate(String(q.productionDate))} · {String(q.shift)}
                          </td>
                          <td className="py-2 px-3.5 font-medium text-emerald-700">{String(q.grade)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MAINTENANCE STAFF WORK QUEUE */}
        {user.role === RoleCode.MAINTENANCE_STAFF && data && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Công việc sửa chữa được phân công</h2>
              <button
                type="button"
                onClick={() => navigate('/su-co-may-moc')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Mở danh sách sửa chữa
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3.5">Mã yêu cầu</th>
                    <th className="py-2.5 px-3.5">Thiết bị</th>
                    <th className="py-2.5 px-3.5">Mức độ</th>
                    <th className="py-2.5 px-3.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {((data.tasks as Array<Record<string, unknown>>) || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        Chưa có công việc sửa chữa được giao
                      </td>
                    </tr>
                  ) : (
                    ((data.tasks as Array<Record<string, unknown>>) || []).map((t) => (
                      <tr key={Number(t.id)} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3.5 font-data font-medium">
                          <button
                            type="button"
                            onClick={() => goRecord('/su-co-may-moc', String(t.code))}
                            className="text-blue-700 hover:underline"
                          >
                            {String(t.code)}
                          </button>
                        </td>
                        <td className="py-2.5 px-3.5">{String(t.machineName)}</td>
                        <td className="py-2.5 px-3.5">{String(t.severity)}</td>
                        <td className="py-2.5 px-3.5">
                          <StatusLabel status={String(t.status)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ADMIN SYSTEM QUICK LINK */}
        {user.role === RoleCode.ADMIN_SYSTEM && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center justify-between gap-4">
            <span className="text-[14px] text-slate-700">
              Quản lý tài khoản đăng nhập và phân quyền sử dụng chức năng nội bộ.
            </span>
            <button
              type="button"
              onClick={() => navigate('/quan-ly-tai-khoan')}
              className="px-4 py-2 text-[13px] font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
            >
              Mở phân quyền người dùng
            </button>
          </div>
        )}
      </ScreenStateView>
    </div>
  );
}
