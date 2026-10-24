import { RoleCode } from './types.ts';

export interface NavItemConfig {
  path: string;
  label: string;
  roles: RoleCode[];
}

export interface NavGroupConfig {
  id: string;
  label: string;
  items: NavItemConfig[];
}

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'overview',
    label: 'Tổng quan',
    items: [
      {
        path: '/tong-quan',
        label: 'Tổng quan',
        roles: [
          RoleCode.OWNER,
          RoleCode.MANAGER,
          RoleCode.PURCHASING_STAFF,
          RoleCode.WAREHOUSE_KEEPER,
          RoleCode.STAFF,
          RoleCode.QC_STAFF,
          RoleCode.MAINTENANCE_STAFF,
          RoleCode.ADMIN_SYSTEM,
        ],
      },
    ],
  },
  {
    id: 'purchasing',
    label: 'Thu mua NVL',
    items: [
      {
        path: '/thu-mua',
        label: 'Phiếu thu mua',
        roles: [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.PURCHASING_STAFF],
      },
      {
        path: '/nha-cung-cap',
        label: 'Nhà cung cấp',
        roles: [RoleCode.OWNER, RoleCode.MANAGER],
      },
    ],
  },
  {
    id: 'warehouse',
    label: 'Kho hàng',
    items: [
      {
        path: '/nhap-kho-nvl',
        label: 'Tiếp nhận NVL',
        roles: [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER, RoleCode.OWNER],
      },
      {
        path: '/cap-nvl',
        label: 'Cấp NVL sản xuất',
        roles: [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER],
      },
      {
        path: '/ton-kho-nvl',
        label: 'Tồn kho NVL',
        roles: [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER],
      },
      {
        path: '/tiep-nhan-thanh-pham',
        label: 'Tiếp nhận thành phẩm',
        roles: [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER],
      },
      {
        path: '/ton-kho-thanh-pham',
        label: 'Tồn kho thành phẩm',
        roles: [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER, RoleCode.QC_STAFF],
      },
    ],
  },
  {
    id: 'production',
    label: 'Sản xuất',
    items: [
      {
        path: '/ke-hoach-san-xuat',
        label: 'Kế hoạch sản xuất',
        roles: [RoleCode.MANAGER, RoleCode.OWNER],
      },
      {
        path: '/cong-viec-phan-cong',
        label: 'Công việc được giao',
        roles: [RoleCode.STAFF],
      },
      {
        path: '/bao-cao-ca',
        label: 'Báo cáo ca',
        roles: [RoleCode.MANAGER, RoleCode.STAFF, RoleCode.OWNER],
      },
    ],
  },
  {
    id: 'qc',
    label: 'Kiểm tra chất lượng',
    items: [
      {
        path: '/kiem-tra-chat-luong',
        label: 'QC theo ca',
        roles: [RoleCode.QC_STAFF, RoleCode.MANAGER, RoleCode.OWNER],
      },
    ],
  },
  {
    id: 'outbound',
    label: 'Xuất hàng',
    items: [
      {
        path: '/yeu-cau-xuat-hang',
        label: 'Yêu cầu xuất hàng',
        roles: [RoleCode.MANAGER, RoleCode.OWNER],
      },
      {
        path: '/duyet-xuat-hang',
        label: 'Duyệt xuất hàng',
        roles: [RoleCode.OWNER],
      },
      {
        path: '/ban-giao-xuat-hang',
        label: 'Bàn giao xuất hàng',
        roles: [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER, RoleCode.OWNER],
      },
      {
        path: '/khach-hang',
        label: 'Khách hàng',
        roles: [RoleCode.OWNER, RoleCode.MANAGER],
      },
    ],
  },
  {
    id: 'maintenance',
    label: 'Máy móc & Bảo trì',
    items: [
      {
        path: '/su-co-may-moc',
        label: 'Sự cố & Bảo trì',
        roles: [RoleCode.MANAGER, RoleCode.STAFF, RoleCode.MAINTENANCE_STAFF, RoleCode.OWNER],
      },
      {
        path: '/vat-tu-bao-tri',
        label: 'Vật tư bảo trì',
        roles: [RoleCode.MANAGER, RoleCode.MAINTENANCE_STAFF, RoleCode.OWNER],
      },
    ],
  },
  {
    id: 'finance_reports',
    label: 'Công nợ & Báo cáo',
    items: [
      {
        path: '/cong-no-phai-thu',
        label: 'Công nợ phải thu',
        roles: [RoleCode.OWNER],
      },
      {
        path: '/cong-no-phai-tra',
        label: 'Công nợ phải trả',
        roles: [RoleCode.OWNER],
      },
      {
        path: '/doi-chieu-so-lieu',
        label: 'Đối chiếu số liệu',
        roles: [RoleCode.OWNER, RoleCode.MANAGER],
      },
      {
        path: '/bao-cao',
        label: 'Báo cáo tổng hợp',
        roles: [RoleCode.OWNER, RoleCode.MANAGER],
      },
    ],
  },
  {
    id: 'admin',
    label: 'Quản trị hệ thống',
    items: [
      {
        path: '/quan-ly-tai-khoan',
        label: 'Phân quyền người dùng',
        roles: [RoleCode.ADMIN_SYSTEM],
      },
    ],
  },
];

export const ALL_PROTECTED_ROUTES: Record<string, RoleCode[]> = {
  '/tong-quan': [
    RoleCode.OWNER,
    RoleCode.MANAGER,
    RoleCode.PURCHASING_STAFF,
    RoleCode.WAREHOUSE_KEEPER,
    RoleCode.STAFF,
    RoleCode.QC_STAFF,
    RoleCode.MAINTENANCE_STAFF,
    RoleCode.ADMIN_SYSTEM,
  ],
  '/tai-khoan-ca-nhan': [
    RoleCode.OWNER,
    RoleCode.MANAGER,
    RoleCode.PURCHASING_STAFF,
    RoleCode.WAREHOUSE_KEEPER,
    RoleCode.STAFF,
    RoleCode.QC_STAFF,
    RoleCode.MAINTENANCE_STAFF,
    RoleCode.ADMIN_SYSTEM,
  ],
  '/thu-mua': [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.PURCHASING_STAFF],
  '/nha-cung-cap': [RoleCode.OWNER, RoleCode.MANAGER],
  '/nhap-kho-nvl': [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER, RoleCode.OWNER],
  '/cap-nvl': [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER],
  '/ton-kho-nvl': [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER],
  '/tiep-nhan-thanh-pham': [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER],
  '/ton-kho-thanh-pham': [RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER, RoleCode.QC_STAFF],
  '/ke-hoach-san-xuat': [RoleCode.MANAGER, RoleCode.OWNER],
  '/cong-viec-phan-cong': [RoleCode.STAFF],
  '/bao-cao-ca': [RoleCode.MANAGER, RoleCode.STAFF, RoleCode.OWNER],
  '/kiem-tra-chat-luong': [RoleCode.QC_STAFF, RoleCode.MANAGER, RoleCode.OWNER],
  '/yeu-cau-xuat-hang': [RoleCode.MANAGER, RoleCode.OWNER],
  '/duyet-xuat-hang': [RoleCode.OWNER],
  '/ban-giao-xuat-hang': [RoleCode.WAREHOUSE_KEEPER, RoleCode.MANAGER, RoleCode.OWNER],
  '/khach-hang': [RoleCode.OWNER, RoleCode.MANAGER],
  '/su-co-may-moc': [RoleCode.MANAGER, RoleCode.STAFF, RoleCode.MAINTENANCE_STAFF, RoleCode.OWNER],
  '/vat-tu-bao-tri': [RoleCode.MANAGER, RoleCode.MAINTENANCE_STAFF, RoleCode.OWNER],
  '/cong-no-phai-thu': [RoleCode.OWNER],
  '/cong-no-phai-tra': [RoleCode.OWNER],
  '/doi-chieu-so-lieu': [RoleCode.OWNER, RoleCode.MANAGER],
  '/bao-cao': [RoleCode.OWNER, RoleCode.MANAGER],
  '/quan-ly-tai-khoan': [RoleCode.ADMIN_SYSTEM],
};

export function canAccessRoute(role: RoleCode, pathname: string): boolean {
  const allowed = ALL_PROTECTED_ROUTES[pathname];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function getDefaultRouteForRole(role: RoleCode): string {
  if (role === RoleCode.ADMIN_SYSTEM) {
    return '/quan-ly-tai-khoan';
  }
  return '/tong-quan';
}

export const STATUS_META: Record<
  string,
  { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }
> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'green' },
  INACTIVE: { label: 'Ngừng sử dụng', tone: 'gray' },

  ASSIGNED: { label: 'Đã giao việc', tone: 'blue' },
  IN_PROGRESS: { label: 'Đang thực hiện', tone: 'amber' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt', tone: 'blue' },
  REJECTED: { label: 'Từ chối', tone: 'red' },
  RECEIVED: { label: 'Đã nhập kho', tone: 'green' },

  PLANNED: { label: 'Chưa bắt đầu', tone: 'blue' },
  RUNNING: { label: 'Đang sản xuất', tone: 'amber' },
  COMPLETED: { label: 'Hoàn tất', tone: 'green' },
  CANCELLED: { label: 'Đã hủy', tone: 'gray' },

  DRAFT: { label: 'Đang nhập', tone: 'gray' },
  SUBMITTED: { label: 'Chờ Manager duyệt', tone: 'amber' },

  PENDING_QC: { label: 'Chờ QC theo ca', tone: 'amber' },
  INSPECTED: { label: 'Đã kiểm tra QC', tone: 'green' },
  NEEDS_REVIEW: { label: 'Cần xem xét QC', tone: 'amber' },
  PENDING_RECEIPT: { label: 'Chờ Thủ kho nhận', tone: 'amber' },
  IN_STOCK: { label: 'Còn tồn kho', tone: 'green' },
  DEPLETED: { label: 'Đã xuất hết', tone: 'gray' },

  PENDING_OWNER: { label: 'Chờ Chủ DN quyết định', tone: 'amber' },
  OWNER_APPROVED: { label: 'Đã duyệt xuất', tone: 'blue' },
  READY_DISPATCH: { label: 'Chờ bàn giao thực tế', tone: 'amber' },
  PARTIALLY_DISPATCHED: { label: 'Đã giao một phần', tone: 'amber' },
  DISPATCHED: { label: 'Hoàn tất xuất hàng', tone: 'green' },

  NEW_ISSUE: { label: 'Chờ tiếp nhận', tone: 'amber' },
  REPORTED: { label: 'Chờ xác nhận sửa chữa', tone: 'amber' },
  REVISION_REQUIRED: { label: 'Yêu cầu cập nhật lại', tone: 'red' },

  PENDING: { label: 'Chờ duyệt', tone: 'amber' },
  UNPAID: { label: 'Chưa thanh toán', tone: 'amber' },
  PARTIAL_PAID: { label: 'Thanh toán một phần', tone: 'blue' },
  PAID: { label: 'Đã tất toán', tone: 'green' },
};
