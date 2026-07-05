import type { OrderLineDraft, Product, SalesOrderItem } from '../types';

export type StockUpdate = { product_barcode: string; qty: number };

export type OrderPayload = {
  items: SalesOrderItem[];
  stockUpdates: StockUpdate[];
  afterSaleMap: Record<string, number>;
  total: number;
};

export function productBarcode(product: Product) {
  return String(product.barcode || product.id || '');
}

export function productName(product: Product | undefined, fallback: string) {
  return product?.product_name || product?.name || [product?.brand, product?.spec, product?.flavor].filter(Boolean).join(' ') || fallback;
}

export function unitOf(product: Product) {
  return product.unit || '个';
}

export function packSize(product: Product) {
  const box = Number(product.pcs_per_box || 0);
  const pcase = Number(product.pcs_per_case || 0);
  if (box > 0) return box;
  if (pcase > 0) return pcase;
  return 1;
}

export function wholeDefaultPrice(product: Product) {
  return Number((Number(product.default_price || 0) * packSize(product)).toFixed(2));
}

export function defaultOrderLine(product: Product): OrderLineDraft {
  const barcode = productBarcode(product);
  const wholePrice = wholeDefaultPrice(product);
  const loosePrice = Number(product.default_price || 0);
  return {
    barcode,
    wholeQty: 0,
    wholePrice,
    looseQty: 0,
    loosePrice,
    mixQty: 0,
    mixBoxPrice: wholePrice,
    afterSaleQty: 0,
  };
}

export function normalizeOrderLine(product: Product, line?: Partial<OrderLineDraft>): OrderLineDraft {
  return { ...defaultOrderLine(product), ...(line || {}), barcode: productBarcode(product) };
}

export function mixBoxGroupKey(product: Product) {
  return `${product.brand || ''}|||${product.spec || ''}`;
}

export function canMixBox(product: Product) {
  return Boolean(product.allow_mix_box) && Number(product.pcs_per_box || 0) > 0;
}

export function lineNormalAmount(product: Product, line: OrderLineDraft) {
  return Number((Number(line.wholeQty || 0) * Number(line.wholePrice || 0) + Number(line.looseQty || 0) * Number(line.loosePrice || 0)).toFixed(2));
}

export function calculateOrderTotal(products: Product[], lines: Record<string, OrderLineDraft>) {
  const normal = products.reduce((sum, product) => {
    const line = lines[productBarcode(product)];
    return line ? sum + lineNormalAmount(product, normalizeOrderLine(product, line)) : sum;
  }, 0);
  const mix = buildMixBoxPayloads('', products, lines).total;
  return Number((normal + mix).toFixed(2));
}

function number(value: unknown) {
  return Number(value || 0);
}

function makeItem(orderNo: string, product: Product, qty: number, price: number, saleUnit: string, stockQty: number): SalesOrderItem {
  const barcode = productBarcode(product);
  const amount = Number((qty * price).toFixed(2));
  return {
    order_no: orderNo,
    barcode,
    product_name: productName(product, barcode),
    qty: stockQty,
    unit_price: price,
    amount,
    sale_unit: saleUnit,
    sale_qty: qty,
    sale_unit_price: price,
  };
}

function activeMixGroups(products: Product[], lines: Record<string, OrderLineDraft>) {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    if (!canMixBox(product)) continue;
    const key = mixBoxGroupKey(product);
    groups.set(key, [...(groups.get(key) || []), product]);
  }
  return Array.from(groups.values()).filter(group => group.some(product => number(lines[productBarcode(product)]?.mixQty) > 0));
}

export function buildMixBoxPayloads(orderNo: string, products: Product[], lines: Record<string, OrderLineDraft>) {
  const items: SalesOrderItem[] = [];
  let total = 0;

  for (const group of activeMixGroups(products, lines)) {
    const size = Number(group.find(product => Number(product.pcs_per_box || 0) > 0)?.pcs_per_box || 0);
    const qty = group.reduce((sum, product) => sum + number(lines[productBarcode(product)]?.mixQty), 0);
    const firstSelected = group.find(product => number(lines[productBarcode(product)]?.mixQty) > 0) || group[0];
    const price = number(lines[productBarcode(firstSelected)]?.mixBoxPrice || wholeDefaultPrice(firstSelected));
    if (qty > 0 && size > 0 && qty % size !== 0) {
      const first = group[0];
      throw new Error(`${first.brand || ''}${first.spec || ''} 拼盒已选 ${qty}${unitOf(first)}，必须按 ${size}${unitOf(first)}成盒提交`);
    }
    if (!qty) continue;

    const amount = Number(((qty / size) * price).toFixed(2));
    let allocated = 0;
    const selected = group.filter(product => number(lines[productBarcode(product)]?.mixQty) > 0);
    selected.forEach((product, index) => {
      const barcode = productBarcode(product);
      const partQty = number(lines[barcode]?.mixQty);
      const partAmount = index === selected.length - 1 ? Number((amount - allocated).toFixed(2)) : Number(((amount * partQty) / qty).toFixed(2));
      allocated += partAmount;
      items.push({
        order_no: orderNo,
        barcode,
        product_name: productName(product, barcode),
        qty: partQty,
        unit_price: Number((partAmount / partQty).toFixed(4)),
        amount: partAmount,
        sale_unit: '拼盒',
        sale_qty: partQty,
        sale_unit_price: price,
      });
    });
    total += amount;
  }

  return { items, total: Number(total.toFixed(2)) };
}

export function buildOrderPayload(params: {
  orderNo: string;
  products: Product[];
  lines: Record<string, OrderLineDraft>;
  liveStock: Map<string, number>;
}): OrderPayload {
  const items: SalesOrderItem[] = [];
  const stockUpdates: StockUpdate[] = [];
  const afterSaleMap: Record<string, number> = {};
  let total = 0;

  for (const product of params.products) {
    const barcode = productBarcode(product);
    const line = params.lines[barcode];
    if (!line) continue;
    const normalized = normalizeOrderLine(product, line);
    const wholeQty = number(normalized.wholeQty);
    const looseQty = number(normalized.looseQty);
    const mixQty = number(normalized.mixQty);
    const afterSaleQty = number(normalized.afterSaleQty);
    const saleStockQty = wholeQty * packSize(product) + looseQty + mixQty;
    const netStockOut = saleStockQty - afterSaleQty;

    if (netStockOut !== 0 || saleStockQty > 0 || afterSaleQty > 0) {
      stockUpdates.push({ product_barcode: barcode, qty: number(params.liveStock.get(barcode)) - netStockOut });
    }

    if (wholeQty > 0) {
      const item = makeItem(params.orderNo, product, wholeQty, number(normalized.wholePrice), '整', wholeQty * packSize(product));
      total += item.amount || 0;
      items.push(item);
    }
    if (looseQty > 0) {
      const item = makeItem(params.orderNo, product, looseQty, number(normalized.loosePrice), '散', looseQty);
      total += item.amount || 0;
      items.push(item);
    }
    if (afterSaleQty > 0) afterSaleMap[barcode] = afterSaleQty;
  }

  const mixPayload = buildMixBoxPayloads(params.orderNo, params.products, params.lines);
  total += mixPayload.total;
  items.push(...mixPayload.items);

  if (!items.length && !Object.keys(afterSaleMap).length) throw new Error('空白单据无法提交');

  return {
    items,
    stockUpdates,
    afterSaleMap,
    total: Number(total.toFixed(2)),
  };
}
