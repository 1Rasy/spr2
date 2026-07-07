import { supabase } from './supabase';
import { buildAfterSaleRemark, createdAtFromDate, localDate } from './rules';
import { buildOrderPayload } from './orderPayload';
import type { DealerEmployeeMapping, Employee, OrderLineDraft, Product, SalesOrder, SalesOrderItem, StoreAsset, VanStock } from '../types';

export async function fetchAll<T>(table: string, columns = '*', pageSize = 1000) {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}


export async function loadEmployeeAdminData() {
  const [employeesRes, mappingsRes] = await Promise.all([
    supabase.from('employees').select('id, employee_code, name, is_active, created_at').order('employee_code', { ascending: true }),
    supabase.from('dealer_employee_mappings').select('id, customer_code, customer_name, employee_code').order('customer_code', { ascending: true }),
  ]);
  if (employeesRes.error) throw employeesRes.error;
  if (mappingsRes.error) throw mappingsRes.error;
  return {
    employees: (employeesRes.data || []) as Employee[],
    mappings: (mappingsRes.data || []) as DealerEmployeeMapping[],
  };
}

export async function createAdminEmployee(payload: Pick<Employee, 'employee_code' | 'name' | 'is_active'>) {
  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select('id, employee_code, name, is_active, created_at')
    .single();
  if (error) throw error;
  return data as Employee;
}

export async function updateAdminEmployee(id: string | number, patch: Partial<Pick<Employee, 'employee_code' | 'name' | 'is_active'>>) {
  const { data, error } = await supabase
    .from('employees')
    .update(patch)
    .eq('id', id)
    .select('id, employee_code, name, is_active, created_at')
    .single();
  if (error) throw error;
  return data as Employee;
}

export async function unassignDealerEmployeeMapping(customerCode: string) {
  const { error } = await supabase
    .from('dealer_employee_mappings')
    .update({ employee_code: null })
    .eq('customer_code', customerCode);
  if (error) throw error;
}

export async function upsertDealerEmployeeMapping(customerCode: string, employeeCode: string) {
  const { error } = await supabase
    .from('dealer_employee_mappings')
    .upsert({ customer_code: customerCode, employee_code: employeeCode }, { onConflict: 'customer_code' });
  if (error) throw error;
}
export async function loadEmployees() {
  const rows = await fetchAll<Employee>('employees', '*');
  return rows.filter(row => row.is_active !== false).sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code), 'zh-CN'));
}

export async function loadStores(employeeCode: string) {
  const rows = await fetchAll<StoreAsset>('employee_store_assets', '*');
  return rows
    .filter(row => String(row.employee_code) === String(employeeCode))
    .sort((a, b) => String(a.store_name).localeCompare(String(b.store_name), 'zh-CN'));
}


export async function loadAdminProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, sort_order, barcode, name, product_name, brand, spec, flavor, default_price, pcs_per_case, pcs_per_box, unit, allow_mix_box, is_active, created_at')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []) as Product[];
}

export async function createAdminProduct(payload: Partial<Product>) {
  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('id, sort_order, barcode, name, product_name, brand, spec, flavor, default_price, pcs_per_case, pcs_per_box, unit, allow_mix_box, is_active, created_at')
    .single();
  if (error) throw error;
  return data as Product;
}

export async function updateAdminProduct(id: string | number, patch: Partial<Product>) {
  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', id)
    .select('id, sort_order, barcode, name, product_name, brand, spec, flavor, default_price, pcs_per_case, pcs_per_box, unit, allow_mix_box, is_active, created_at')
    .single();
  if (error) throw error;
  return data as Product;
}
export async function loadProducts() {
  const rows = await fetchAll<Product>('products', '*');
  return rows.filter(row => row.is_active !== false).sort((a, b) => String(a.brand || '').localeCompare(String(b.brand || ''), 'zh-CN'));
}

export async function loadHistory(atomCode: string) {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('atom_code', atomCode)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as SalesOrder[];
}

export async function loadOrdersByEmployee(employeeCode: string, startDate?: string, endDate?: string) {
  let query = supabase.from('sales_orders').select('*').eq('employee_code', employeeCode).order('created_at', { ascending: false });
  if (startDate && endDate) {
    query = query.gte('created_at', `${startDate}T00:00:00+08:00`).lte('created_at', `${endDate}T23:59:59+08:00`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as SalesOrder[];
}
export async function loadDashboardOrders(startDate?: string, endDate?: string) {
  let query = supabase.from('sales_orders').select('*').order('created_at', { ascending: false }).limit(2000);
  if (startDate) query = query.gte('created_at', `${startDate}T00:00:00+08:00`);
  if (endDate) query = query.lte('created_at', `${endDate}T23:59:59+08:00`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as SalesOrder[];
}
export async function loadItems(orderNos: string[]) {
  if (!orderNos.length) return [] as SalesOrderItem[];
  const { data, error } = await supabase.from('sales_order_items').select('*').in('order_no', orderNos);
  if (error) throw error;
  return (data || []) as SalesOrderItem[];
}

export async function loadOrderDetail(orderNo: string) {
  const [{ data: items, error: itemError }, { data: order, error: orderError }] = await Promise.all([
    supabase.from('sales_order_items').select('*').eq('order_no', orderNo),
    supabase.from('sales_orders').select('*').eq('order_no', orderNo).maybeSingle(),
  ]);
  if (itemError) throw itemError;
  if (orderError) throw orderError;
  return { order: order as SalesOrder | null, items: (items || []) as SalesOrderItem[] };
}


export async function loadStockSummaryData() {
  const [stockRes, empRows, productRows] = await Promise.all([
    supabase.from('van_stocks').select('employee_code, product_barcode, qty, updated_at').order('employee_code', { ascending: true }).limit(20000),
    fetchAll<Employee>('employees', 'employee_code, name, is_active'),
    fetchAll<Product>('products', 'id, sort_order, barcode, name, product_name, brand, spec, flavor, pcs_per_case, pcs_per_box, unit, is_active'),
  ]);
  if (stockRes.error) throw stockRes.error;
  return { stocks: (stockRes.data || []) as VanStock[], employees: empRows, products: productRows };
}

export async function upsertStockRows(rows: Array<{ employee_code: string; product_barcode: string; qty: number; updated_at?: string }>) {
  for (let start = 0; start < rows.length; start += 500) {
    const part = rows.slice(start, start + 500);
    const { error } = await supabase.from('van_stocks').upsert(part, { onConflict: 'employee_code,product_barcode' });
    if (error) throw error;
  }
}
export async function loadStocks(employeeCode: string) {
  const { data, error } = await supabase.from('van_stocks').select('*').eq('employee_code', employeeCode);
  if (error) throw error;
  return (data || []) as VanStock[];
}

export async function submitOrder(params: {
  employeeCode: string;
  atomCode: string;
  storeName: string;
  date: string;
  products: Product[];
  lines: Record<string, OrderLineDraft>;
  orderNo?: string;
  previousStockByBarcode?: Map<string, number>;
}) {
  const orderNo = params.orderNo || 'SO' + Date.now() + Math.floor(Math.random() * 1000);
  const liveStocks = await loadStocks(params.employeeCode);
  const liveMap = new Map(liveStocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)]));
  const payload = buildOrderPayload({
    orderNo,
    products: params.products,
    lines: params.lines,
    liveStock: liveMap,
    previousStockByBarcode: params.previousStockByBarcode,
  });
  const { error } = await supabase.rpc('submit_sales_order_v2', {
    p_order_no: orderNo,
    p_employee_code: String(params.employeeCode),
    p_atom_code: String(params.atomCode),
    p_store_name: String(params.storeName),
    p_total_amount: payload.total,
    p_items: payload.items,
    p_stock_updates: payload.stockUpdates,
  });
  if (error) throw error;

  const hasAfterSale = Object.keys(payload.afterSaleMap).length > 0;
  const { error: updateError } = await supabase
    .from('sales_orders')
    .update({
      created_at: createdAtFromDate(params.date || localDate()),
      status: hasAfterSale ? 'SUCCESS_AFTER_SALE' : 'SUCCESS',
      remark: buildAfterSaleRemark(payload.afterSaleMap),
    })
    .eq('order_no', orderNo);
  if (updateError) throw updateError;

  return orderNo;
}
export async function createManualStore(employeeCode: string, atomCode: string, storeName: string) {
  const { error } = await supabase.from('employee_store_assets').insert({
    employee_code: String(employeeCode),
    atom_code: String(atomCode),
    store_name: String(storeName),
  });
  if (error) throw error;
}

export async function countStoreOrders(atomCode: string) {
  const { count, error } = await supabase
    .from('sales_orders')
    .select('id', { count: 'exact', head: true })
    .eq('atom_code', atomCode);
  if (error) throw error;
  return count || 0;
}

export async function deleteManualStore(employeeCode: string, atomCode: string) {
  const { error } = await supabase
    .from('employee_store_assets')
    .delete()
    .eq('employee_code', employeeCode)
    .eq('atom_code', atomCode);
  if (error) throw error;
}

export async function deleteExistingOrder(employeeCode: string, orderNo: string, items: SalesOrderItem[]) {
  const liveStocks = await loadStocks(employeeCode);
  const liveMap = new Map(liveStocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)]));
  const restoreMap = new Map<string, number>();
  items.forEach(item => {
    const barcode = String(item.barcode || '');
    if (!barcode) return;
    restoreMap.set(barcode, Number(restoreMap.get(barcode) || 0) + Number(item.qty || 0));
  });
  const updates = Array.from(restoreMap.entries()).map(([barcode, qty]) => ({
    employee_code: String(employeeCode),
    product_barcode: barcode,
    qty: Number(liveMap.get(barcode) || 0) + Number(qty || 0),
  }));
  const { error: itemError } = await supabase.from('sales_order_items').delete().eq('order_no', orderNo);
  if (itemError) throw itemError;
  const { error: orderError } = await supabase.from('sales_orders').delete().eq('order_no', orderNo);
  if (orderError) throw orderError;
  if (updates.length) {
    const { error: stockError } = await supabase.from('van_stocks').upsert(updates, { onConflict: 'employee_code,product_barcode' });
    if (stockError) throw stockError;
  }
}
