import type { Product, SalesOrder, SalesOrderItem } from '../types';

const AFTER_SALE_REMARK_PREFIX = 'AFTER_SALES:';

export function money(value: number | string | null | undefined) {
  return Number(value || 0).toFixed(2);
}

export function localDate(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createdAtFromDate(date: string) {
  return `${date}T12:00:00+08:00`;
}

export function isAfterSaleItem(item: Pick<SalesOrderItem, 'sale_unit'>) {
  const text = String(item.sale_unit || '');
  return text === '售后' || text.includes('售后');
}

export function normalSaleItems(items: SalesOrderItem[]) {
  return items.filter(item => !isAfterSaleItem(item));
}

export function parseAfterSaleRemark(remark?: string | null): Record<string, number> {
  const text = String(remark || '').trim();
  if (!text) return {};
  const raw = text.startsWith(AFTER_SALE_REMARK_PREFIX) ? text.slice(AFTER_SALE_REMARK_PREFIX.length) : text;
  try {
    const data = JSON.parse(raw) as Record<string, number>;
    return Object.fromEntries(Object.entries(data || {}).filter(([, qty]) => Number(qty) > 0));
  } catch {
    return {};
  }
}

export function buildAfterSaleRemark(map: Record<string, number>) {
  const clean = Object.fromEntries(Object.entries(map).filter(([, qty]) => Number(qty) > 0));
  return Object.keys(clean).length ? AFTER_SALE_REMARK_PREFIX + JSON.stringify(clean) : null;
}

export function orderHasAfterSale(order: Pick<SalesOrder, 'status' | 'remark'>, items: SalesOrderItem[] = []) {
  return String(order.status || '').includes('AFTER_SALE') ||
    Object.keys(parseAfterSaleRemark(order.remark)).length > 0 ||
    items.some(isAfterSaleItem);
}

export function productDisplayName(product?: Product) {
  if (!product) return '';
  const spec = product.spec || product.name || product.product_name || product.barcode;
  return [spec, product.flavor].filter(Boolean).join(' ');
}

export function orderDetailSpec(product?: Product, fallback = '') {
  return product?.spec || product?.name || product?.product_name || fallback || product?.barcode || '';
}

export function orderDetailFlavor(product?: Product) {
  return product?.flavor || '';
}

export function uniqueSkuCount(items: SalesOrderItem[]) {
  return new Set(normalSaleItems(items).map(item => String(item.barcode || ''))).size;
}

export function normalAmount(items: SalesOrderItem[]) {
  return normalSaleItems(items).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}
