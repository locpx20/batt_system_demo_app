import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getDefaultRouteForRole } from '../shared/permissions.ts';
import { AppErrorBoundary, AuthProvider, ToastProvider, useAuth } from './context/AppContexts.tsx';
import { AppShell } from './components/layout/AppShell.tsx';
import {
  AdminUsersPage,
  ForgotPasswordPage,
  LoginPage,
  PersonalProfilePage,
} from './pages/AuthAndAccountPages.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { CustomersPage, SuppliersPage } from './pages/PartnersPages.tsx';
import {
  PurchasingPage,
  RawInventoryPage,
  RawMaterialIssuePage,
  RawMaterialReceiptPage,
} from './pages/PurchasingAndRawPages.tsx';
import {
  FinishedGoodsReceiptPage,
  FinishedInventoryPage,
  ProductionPlansPage,
  ShiftQcPage,
  ShiftReportsPage,
  StaffAssignmentsPage,
} from './pages/ProductionAndQcPages.tsx';
import {
  MaintenancePage,
  OutboundDispatchPage,
  OutboundRequestsPage,
  OwnerOutboundApprovalPage,
  SparePartsPage,
} from './pages/OutboundAndMaintenancePages.tsx';
import {
  PayablesPage,
  ReceivablesPage,
  ReconciliationPage,
  ReportsPage,
} from './pages/FinanceAndReportsPages.tsx';

function ProtectedRoutes() {
  const { user, loadingAuth } = useAuth();

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Đang tải phiên làm việc...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/dang-nhap" replace />;
  }

  const defaultPath = getDefaultRouteForRole(user.role);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={defaultPath} replace />} />
        <Route path="/tong-quan" element={<DashboardPage />} />
        <Route path="/tai-khoan-ca-nhan" element={<PersonalProfilePage />} />

        {/* Partners & Purchasing */}
        <Route path="/nha-cung-cap" element={<SuppliersPage />} />
        <Route path="/khach-hang" element={<CustomersPage />} />
        <Route path="/thu-mua" element={<PurchasingPage />} />

        {/* Warehouse Raw Materials & Finished Goods */}
        <Route path="/nhap-kho-nvl" element={<RawMaterialReceiptPage />} />
        <Route path="/cap-nvl" element={<RawMaterialIssuePage />} />
        <Route path="/ton-kho-nvl" element={<RawInventoryPage />} />
        <Route path="/tiep-nhan-thanh-pham" element={<FinishedGoodsReceiptPage />} />
        <Route path="/ton-kho-thanh-pham" element={<FinishedInventoryPage />} />

        {/* Production & Shift Reports */}
        <Route path="/ke-hoach-san-xuat" element={<ProductionPlansPage />} />
        <Route path="/cong-viec-phan-cong" element={<StaffAssignmentsPage />} />
        <Route path="/bao-cao-ca" element={<ShiftReportsPage />} />

        {/* Quality Control */}
        <Route path="/kiem-tra-chat-luong" element={<ShiftQcPage />} />

        {/* Outbound & Owner Decision */}
        <Route path="/yeu-cau-xuat-hang" element={<OutboundRequestsPage />} />
        <Route path="/duyet-xuat-hang" element={<OwnerOutboundApprovalPage />} />
        <Route path="/ban-giao-xuat-hang" element={<OutboundDispatchPage />} />

        {/* Machine Maintenance & Spare Parts */}
        <Route path="/su-co-may-moc" element={<MaintenancePage />} />
        <Route path="/vat-tu-bao-tri" element={<SparePartsPage />} />

        {/* Finance, Reconciliation & Reports */}
        <Route path="/cong-no-phai-tra" element={<PayablesPage />} />
        <Route path="/cong-no-phai-thu" element={<ReceivablesPage />} />
        <Route path="/doi-chieu-so-lieu" element={<ReconciliationPage />} />
        <Route path="/bao-cao" element={<ReportsPage />} />

        {/* System Administration */}
        <Route path="/quan-ly-tai-khoan" element={<AdminUsersPage />} />

        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/dang-nhap" element={<LoginPage />} />
              <Route path="/quen-mat-khau" element={<ForgotPasswordPage />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </AppErrorBoundary>
  );
}
