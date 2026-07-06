import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function importTs(path) {
  const source = readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), 'spr2-test-'));
  const file = join(dir, 'module.mjs');
  writeFileSync(file, output, 'utf8');
  return import(pathToFileURL(file).href);
}

const {
  buildOrderPayload,
  calculateOrderTotal,
  defaultOrderLine,
  packSize,
  wholeDefaultPrice,
} = await importTs('src/lib/orderPayload.ts');

const products = [
  {
    barcode: 'A',
    product_name: '品牌 规格 柠檬',
    brand: '品牌',
    spec: '规格',
    flavor: '柠檬',
    default_price: 2,
    pcs_per_case: 12,
    pcs_per_box: 6,
    allow_mix_box: true,
    unit: '个',
  },
  {
    barcode: 'B',
    product_name: '品牌 规格 蜜桃',
    brand: '品牌',
    spec: '规格',
    flavor: '蜜桃',
    default_price: 2,
    pcs_per_case: 12,
    pcs_per_box: 6,
    allow_mix_box: true,
    unit: '个',
  },
];

assert.equal(packSize(products[0]), 6);
assert.equal(wholeDefaultPrice(products[0]), 12);
assert.deepEqual(defaultOrderLine(products[0]), {
  barcode: 'A',
  wholeQty: 0,
  wholePrice: 12,
  looseQty: 0,
  loosePrice: 2,
  mixQty: 0,
  mixBoxPrice: 12,
  afterSaleQty: 0,
});

const payload = buildOrderPayload({
  orderNo: 'SO1',
  products,
  liveStock: new Map([
    ['A', 100],
    ['B', 50],
  ]),
  lines: {
    A: {
      barcode: 'A',
      wholeQty: 1,
      wholePrice: 12,
      looseQty: 2,
      loosePrice: 2.5,
      mixQty: 3,
      mixBoxPrice: 18,
      afterSaleQty: 1,
    },
    B: {
      barcode: 'B',
      wholeQty: 0,
      wholePrice: 12,
      looseQty: 0,
      loosePrice: 2,
      mixQty: 3,
      mixBoxPrice: 18,
      afterSaleQty: 0,
    },
  },
});

assert.equal(calculateOrderTotal(products, {
  A: { ...defaultOrderLine(products[0]), mixQty: 2, mixBoxPrice: 18 },
}), 6);
assert.equal(payload.total, 35);
assert.deepEqual(payload.afterSaleMap, { A: 1 });
assert.deepEqual(payload.stockUpdates, [
  { product_barcode: 'A', qty: 90 },
  { product_barcode: 'B', qty: 47 },
]);
assert.deepEqual(payload.items, [
  {
    order_no: 'SO1',
    barcode: 'A',
    product_name: '品牌 规格 柠檬',
    qty: 6,
    unit_price: 12,
    amount: 12,
    sale_unit: '整',
    sale_qty: 1,
    sale_unit_price: 12,
  },
  {
    order_no: 'SO1',
    barcode: 'A',
    product_name: '品牌 规格 柠檬',
    qty: 2,
    unit_price: 2.5,
    amount: 5,
    sale_unit: '散',
    sale_qty: 2,
    sale_unit_price: 2.5,
  },
  {
    order_no: 'SO1',
    barcode: 'A',
    product_name: '品牌 规格 柠檬',
    qty: 3,
    unit_price: 3,
    amount: 9,
    sale_unit: '拼盒',
    sale_qty: 3,
    sale_unit_price: 18,
  },
  {
    order_no: 'SO1',
    barcode: 'B',
    product_name: '品牌 规格 蜜桃',
    qty: 3,
    unit_price: 3,
    amount: 9,
    sale_unit: '拼盒',
    sale_qty: 3,
    sale_unit_price: 18,
  },
]);

assert.throws(
  () => buildOrderPayload({
    orderNo: 'SO2',
    products,
    liveStock: new Map(),
    lines: {
      A: { ...defaultOrderLine(products[0]), mixQty: 2 },
    },
  }),
  /拼盒已选 2个，必须按 6个成盒提交/,
);


const editedPayload = buildOrderPayload({
  orderNo: 'SO_EDIT',
  products,
  liveStock: new Map([['A', 90]]),
  previousStockByBarcode: new Map([['A', 8]]),
  lines: {
    A: {
      barcode: 'A',
      wholeQty: 1,
      wholePrice: 12,
      looseQty: 0,
      loosePrice: 2,
      mixQty: 0,
      mixBoxPrice: 12,
      afterSaleQty: 0,
    },
  },
});
assert.deepEqual(editedPayload.stockUpdates, [{ product_barcode: 'A', qty: 92 }]);
