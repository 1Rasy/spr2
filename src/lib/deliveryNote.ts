import type { Product, SalesOrderItem } from '../types';
import { money } from './rules';

type Html2Canvas = (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

export type DeliveryNoteRow = {
  productName: string;
  unit: string;
  wholeQty: number;
  looseQty: number;
  wholePrice: number;
  loosePrice: number;
  wholeUnit: string;
  amount: number;
  qtyText: string;
  priceText: string;
};

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function formatDeliveryNumber(value: number) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function amountToChineseUpper(amount: number) {
  let n = Math.round((Number(amount) || 0) * 100);
  if (n === 0) return '零元整';
  const fraction = ['角', '分'];
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']];
  let text = '';
  for (let i = 0; i < fraction.length; i += 1) {
    const d = Math.floor(n / Math.pow(10, 1 - i)) % 10;
    if (d) text += digit[d] + fraction[i];
  }
  text ||= '整';
  n = Math.floor(n / 100);
  for (let i = 0; n > 0 && i < unit[0].length; i += 1) {
    let part = '';
    for (let j = 0; j < unit[1].length && n > 0; j += 1) {
      const d = n % 10;
      part = d === 0 ? digit[0] + part : digit[d] + unit[1][j] + part;
      n = Math.floor(n / 10);
    }
    part = part.replace(/(零.)*零$/, '').replace(/^$/, '零');
    text = part + unit[0][i] + text;
  }
  return text
    .replace(/零+/g, '零')
    .replace(/零元/, '元')
    .replace(/零(万|亿)/g, '$1')
    .replace(/亿万/, '亿')
    .replace(/^元/, '零元');
}

function deliveryProduct(item: SalesOrderItem, products: Product[]) {
  const barcode = String(item.barcode || '');
  return products.find(product => String(product.barcode) === barcode || String(product.id) === barcode);
}

function deliveryWholeSize(product?: Product) {
  const box = Number(product?.pcs_per_box) || 0;
  const pcsCase = Number(product?.pcs_per_case) || 0;
  return box > 0 ? box : pcsCase > 0 ? pcsCase : 1;
}

function deliveryQuantityText(row: DeliveryNoteRow) {
  const parts: string[] = [];
  if (row.wholeQty > 0) parts.push(`${formatDeliveryNumber(row.wholeQty)}${row.wholeUnit || '整'}`);
  if (row.looseQty > 0) parts.push(`${formatDeliveryNumber(row.looseQty)}${row.unit || '个'}`);
  return parts.join('');
}

function deliveryPriceText(row: DeliveryNoteRow) {
  const hasWhole = row.wholeQty > 0;
  const hasLoose = row.looseQty > 0;
  if (hasWhole && hasLoose) return `整${money(row.wholePrice || 0)} / 散${money(row.loosePrice || 0)}`;
  if (hasWhole) return money(row.wholePrice || 0);
  if (hasLoose) return money(row.loosePrice || 0);
  return '';
}

export function buildDeliveryNoteRows(items: SalesOrderItem[], products: Product[]) {
  const grouped = new Map<string, DeliveryNoteRow>();
  items.forEach(item => {
    const product = deliveryProduct(item, products);
    const brand = String(product?.brand || '').trim();
    const spec = String(product?.spec || '').trim();
    const productName = brand || spec ? `${brand}${spec}` : item.product_name || '未知商品';
    const unit = product?.unit || '个';
    const key = `${brand}|||${spec}|||${productName}`;
    const row = grouped.get(key) || {
      productName,
      unit,
      wholeQty: 0,
      looseQty: 0,
      wholePrice: 0,
      loosePrice: 0,
      wholeUnit: '整',
      amount: 0,
      qtyText: '',
      priceText: '',
    };
    row.amount += Number(item.amount || 0);
    if (item.sale_unit) {
      const saleUnit = String(item.sale_unit);
      const saleQty = Number(item.sale_qty ?? item.qty ?? 0);
      const salePrice = Number(item.sale_unit_price ?? item.unit_price ?? 0);
      if (saleUnit.includes('拼盒')) {
        row.wholeQty += saleQty / deliveryWholeSize(product);
        row.wholePrice = salePrice;
        row.wholeUnit = '中盒';
      } else if (saleUnit.includes('整')) {
        row.wholeQty += saleQty;
        row.wholePrice = salePrice;
      } else {
        row.looseQty += saleQty;
        row.loosePrice = salePrice;
      }
    } else {
      const qty = Number(item.qty || 0);
      const wholeSize = deliveryWholeSize(product);
      const loosePrice = Number(item.unit_price || 0);
      row.wholeQty += Math.floor(qty / wholeSize);
      row.looseQty += qty % wholeSize;
      row.loosePrice = loosePrice;
      row.wholePrice = Number((loosePrice * wholeSize).toFixed(2));
    }
    grouped.set(key, row);
  });
  return Array.from(grouped.values()).map(row => ({
    ...row,
    amount: Number(row.amount.toFixed(2)),
    qtyText: deliveryQuantityText(row),
    priceText: deliveryPriceText(row),
  }));
}

export function buildDeliveryNoteHtml({ storeName, rows, totalAmount, employeeName, orderDate }: { storeName: string; rows: DeliveryNoteRow[]; totalAmount: number; employeeName: string; orderDate: string }) {
  const displayRows: Array<DeliveryNoteRow | null> = [...rows];
  while (displayRows.length < 8) displayRows.push(null);
  const body = displayRows.map((row, index) => `<tr><td>${index + 1}</td><td class="text-left">${row ? esc(row.productName) : ''}</td><td>${row ? esc(row.qtyText) : ''}</td><td>${row ? esc(row.priceText) : ''}</td><td>${row ? money(row.amount) : ''}</td></tr>`).join('');
  return `<div class="delivery-note-sheet"><div class="delivery-note-title">送货单</div><div class="delivery-note-meta"><div class="delivery-note-customer">客户名称：<span>${esc(storeName)}</span></div><div class="delivery-note-date">日期：${esc(orderDate)}</div></div><table class="delivery-note-table"><thead><tr><th class="col-index">序号</th><th class="col-name">产品名称</th><th class="col-qty">数量/单位</th><th class="col-price">单价</th><th class="col-amount">金额</th></tr></thead><tbody>${body}<tr class="delivery-note-total"><td colspan="3">金额合计大写：${esc(amountToChineseUpper(totalAmount))}</td><td colspan="2">金额合计小写：¥${money(totalAmount)}</td></tr><tr class="delivery-note-footer"><td colspan="5" class="delivery-note-deliver">送货人：${esc(employeeName)}</td></tr></tbody></table></div>`;
}

function safeDeliveryFileName(storeName: string, orderDate: string) {
  return `送货单_${String(storeName || 'delivery-note').replace(/[\\/:*?"<>|\s]+/g, '_')}_${orderDate || ''}.png`;
}

export async function downloadDeliveryNoteImage({ storeName, rows, totalAmount, employeeName, orderDate }: { storeName: string; rows: DeliveryNoteRow[]; totalAmount: number; employeeName: string; orderDate: string }) {
  const html2canvas = (window as unknown as { html2canvas?: Html2Canvas }).html2canvas;
  if (!html2canvas) throw new Error('生成图片组件加载失败，请稍后重试');
  const wrap = document.createElement('div');
  wrap.className = 'delivery-note-capture-wrap';
  wrap.innerHTML = buildDeliveryNoteHtml({ storeName, rows, totalAmount, employeeName, orderDate });
  document.body.appendChild(wrap);
  try {
    const sheet = wrap.querySelector('.delivery-note-sheet');
    if (!(sheet instanceof HTMLElement)) throw new Error('送货单模板生成失败');
    const canvas = await html2canvas(sheet, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = safeDeliveryFileName(storeName, orderDate);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    document.body.removeChild(wrap);
  }
}
