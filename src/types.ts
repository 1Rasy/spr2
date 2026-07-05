export type Screen = 'employees' | 'stores' | 'history' | 'order' | 'detail' | 'report' | 'stock';

export interface Employee {
  id?: number | string;
  employee_code: string;
  name: string;
  is_active?: boolean;
}

export interface StoreAsset {
  id?: number | string;
  employee_code: string;
  atom_code: string;
  store_name: string;
}

export interface Product {
  id?: number | string;
  barcode: string;
  name?: string;
  product_name?: string;
  brand?: string;
  spec?: string;
  flavor?: string;
  default_price?: number;
  pcs_per_case?: number;
  pcs_per_box?: number;
  unit?: string;
  is_active?: boolean;
}

export interface SalesOrder {
  id?: number | string;
  created_at?: string;
  order_no: string;
  employee_code?: string;
  atom_code?: string;
  store_atom_code?: string;
  store_name?: string;
  total_amount?: number;
  status?: string | null;
  remark?: string | null;
}

export interface SalesOrderItem {
  id?: number | string;
  order_no: string;
  barcode: string;
  product_name?: string;
  qty?: number;
  unit_price?: number;
  amount?: number;
  sale_unit?: string;
  sale_qty?: number;
  sale_unit_price?: number;
}

export interface VanStock {
  employee_code: string;
  product_barcode: string;
  qty?: number;
  stock_qty?: number;
}

export interface OrderLineDraft {
  barcode: string;
  looseQty: number;
  loosePrice: number;
  afterSaleQty: number;
}

export interface HistorySummary extends SalesOrder {
  saleSum: number;
  skuCount: number;
  hasAfterSale: boolean;
}

export interface ReportRow extends HistorySummary {
  orderDate: string;
  atomCode: string;
  storeName: string;
}
