import { supabase } from './supabase';
import { buildAfterSaleRemark, createdAtFromDate, localDate } from './rules';
import type { Employee, OrderLineDraft, Product, SalesOrder, SalesOrderItem, StoreAsset, VanStock } from '../types';

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
}) {
  const orderNo = 'SO' + Date.now() + Math.floor(Math.random() * 1000);
  const liveStocks = await loadStocks(params.employeeCode);
  const liveMap = new Map(liveStocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)]));
  const items: SalesOrderItem[] = [];
  const stockUpdates: { product_barcode: string; qty: number }[] = [];
  const afterSaleMap: Record<string, number> = {};
  let total = 0;

  for (const line of Object.values(params.lines)) {
    const product = params.products.find(p => String(p.barcode) === String(line.barcode) || String(p.id) === String(line.barcode));
    const barcode = String(product?.barcode || line.barcode);
    const qty = Number(line.looseQty || 0);
    const afterSaleQty = Number(line.afterSaleQty || 0);
    const price = Number(line.loosePrice || product?.default_price || 0);
    const amount = Number((qty * price).toFixed(2));
    if (qty > 0) {
      total += amount;
      items.push({
        order_no: orderNo,
        barcode,
        product_name: product?.name || product?.product_name || product?.spec || barcode,
        qty,
        unit_price: price,
        amount,
        sale_unit: '散',
        sale_qty: qty,
        sale_unit_price: price,
      });
    }
    if (afterSaleQty > 0) afterSaleMap[barcode] = afterSaleQty;
    const stockDelta = qty - afterSaleQty;
    if (stockDelta !== 0) stockUpdates.push({ product_barcode: barcode, qty: Number(liveMap.get(barcode) || 0) - stockDelta });
  }

  if (!items.length && !Object.keys(afterSaleMap).length) throw new Error('空白单据无法提交');

  const { error } = await supabase.rpc('submit_sales_order_v2', {
    p_order_no: orderNo,
    p_employee_code: String(params.employeeCode),
    p_atom_code: String(params.atomCode),
    p_store_name: String(params.storeName),
    p_total_amount: Number(total.toFixed(2)),
    p_items: items,
    p_stock_updates: stockUpdates,
  });
  if (error) throw error;

  const hasAfterSale = Object.keys(afterSaleMap).length > 0;
  const { error: updateError } = await supabase
    .from('sales_orders')
    .update({
      created_at: createdAtFromDate(params.date || localDate()),
      status: hasAfterSale ? 'SUCCESS_AFTER_SALE' : 'SUCCESS',
      remark: buildAfterSaleRemark(afterSaleMap),
    })
    .eq('order_no', orderNo);
  if (updateError) throw updateError;

  return orderNo;
}
