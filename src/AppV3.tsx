import { useEffect, useMemo, useState } from 'react';
import { loadEmployees, loadHistory, loadItems, loadOrderDetail, loadOrdersByEmployee, loadProducts, loadStocks, loadStores, submitOrder } from './lib/api';
import { calculateOrderTotal, canMixBox, defaultOrderLine, packSize, productBarcode, unitOf, wholeDefaultPrice } from './lib/orderPayload';
import { localDate, money, normalAmount, normalSaleItems, orderDetailFlavor, orderDetailSpec, orderHasAfterSale, productDisplayName, uniqueSkuCount } from './lib/rules';
import { PageTitle, SearchBox } from './ui/components';
import type { Employee, HistorySummary, OrderLineDraft, Product, ReportRow, SalesOrderItem, Screen, StoreAsset, VanStock } from './types';

const LOADING_TEXT = '正在加载..';
const ORDER_DRAFT_PREFIX = 'spr2_order_draft_v1';

type DetailState = { orderNo: string; items: SalesOrderItem[]; hasAfterSale: boolean };
type DetailGroup = { title: string; flavors: Map<string, number> };
type StoredDraft = { date: string; lines: Record<string, OrderLineDraft> };

export default function AppV3() {
  const [screen, setScreen] = useState<Screen>('employees');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stores, setStores] = useState<StoreAsset[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [store, setStore] = useState<StoreAsset | null>(null);
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [stocks, setStocks] = useState<VanStock[]>([]);
  const [reportDate, setReportDate] = useState(localDate());
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [productKeyword, setProductKeyword] = useState('');
  const [draftDate, setDraftDate] = useState(localDate());
  const [draftLines, setDraftLines] = useState<Record<string, OrderLineDraft>>({});
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('ALL');

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    document.body.classList.toggle('store-search-mode', screen === 'stores' && keyword.trim().length > 0);
    return () => document.body.classList.remove('store-search-mode');
  }, [screen, keyword]);

  useEffect(() => {
    if (screen !== 'order' || !employee || !store) return;
    saveDraft(draftKey(employee, store), { date: draftDate, lines: draftLines });
  }, [screen, employee, store, draftDate, draftLines]);

  async function run<T>(job: () => Promise<T>) {
    setLoading(true);
    setError('');
    try { return await job(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { setLoading(false); }
  }

  async function bootstrap() {
    await run(async () => {
      const [empRows, productRows] = await Promise.all([loadEmployees(), loadProducts()]);
      setEmployees(empRows);
      setProducts(productRows);
    });
  }

  async function chooseEmployee(row: Employee) {
    await run(async () => {
      setEmployee(row);
      setKeyword('');
      setStores(await loadStores(row.employee_code));
      setScreen('stores');
    });
  }

  async function openHistory(row: StoreAsset) {
    await run(async () => {
      setStore(row);
      setKeyword('');
      const orders = await loadHistory(row.atom_code);
      const items = await loadItems(orders.map(o => o.order_no));
      const grouped = groupItemsByOrder(items);
      setHistory(orders.map(order => {
        const orderItems = grouped.get(String(order.order_no)) || [];
        return { ...order, saleSum: normalAmount(orderItems), skuCount: uniqueSkuCount(orderItems), hasAfterSale: orderHasAfterSale(order, orderItems) };
      }));
      setScreen('history');
    });
  }

  async function openDetail(orderNo: string) {
    await run(async () => {
      const data = await loadOrderDetail(orderNo);
      setDetail({ orderNo, items: data.items, hasAfterSale: orderHasAfterSale(data.order || {}, data.items) });
      setScreen('detail');
    });
  }

  async function openReport(date = reportDate) {
    if (!employee) return;
    await run(async () => {
      setReportDate(date);
      const orders = await loadOrdersByEmployee(employee.employee_code, date, date);
      const items = await loadItems(orders.map(o => o.order_no));
      const grouped = groupItemsByOrder(items);
      setReportRows(orders.map(order => {
        const orderItems = grouped.get(String(order.order_no)) || [];
        return { ...order, atomCode: String(order.atom_code || order.store_atom_code || ''), storeName: String(order.store_name || ''), orderDate: order.created_at ? order.created_at.split('T')[0] : '-', saleSum: normalAmount(orderItems), skuCount: uniqueSkuCount(orderItems), hasAfterSale: orderHasAfterSale(order, orderItems) };
      }));
      setScreen('report');
    });
  }

  async function openStock() {
    if (!employee) return;
    await run(async () => {
      setStocks(await loadStocks(employee.employee_code));
      setScreen('stock');
    });
  }

  function openOrder() {
    if (!employee || !store) return;
    const saved = loadDraft(draftKey(employee, store));
    const brands = orderedUnique(products, 'brand');
    setDraftLines(saved?.lines || {});
    setDraftDate(saved?.date || localDate());
    setProductKeyword('');
    setSelectedBrand(brands[0] || '');
    setSelectedSpec('ALL');
    setScreen('order');
  }

  function back() {
    setError('');
    if (screen === 'stores' && keyword.trim()) { setKeyword(''); return; }
    if (screen === 'stores') { setEmployee(null); setScreen('employees'); return; }
    if (screen === 'history') { setStore(null); setScreen('stores'); return; }
    if (screen === 'detail') { setScreen('history'); return; }
    if (screen === 'order') {
      if (employee && store) clearDraft(draftKey(employee, store));
      setDraftLines({});
      setScreen('history');
      return;
    }
    setScreen('stores');
  }

  function updateDraft(product: Product, patch: Partial<OrderLineDraft>) {
    const barcode = productBarcode(product);
    setDraftLines(prev => {
      const nextLine = { ...defaultOrderLine(product), ...(prev[barcode] || {}), ...patch, barcode };
      const copy = { ...prev };
      if (hasLineValue(nextLine)) copy[barcode] = nextLine;
      else delete copy[barcode];
      return copy;
    });
  }

  async function saveOrder() {
    if (!employee || !store) return;
    await run(async () => {
      const orderNo = await submitOrder({ employeeCode: employee.employee_code, atomCode: store.atom_code, storeName: store.store_name, date: draftDate, products, lines: draftLines });
      clearDraft(draftKey(employee, store));
      setDraftLines({});
      alert(`✅ 开单成功：${orderNo}`);
      await openHistory(store);
    });
  }

  const filteredEmployees = useMemo(() => filterRows(employees, keyword, row => `${row.employee_code} ${row.name}`), [employees, keyword]);
  const filteredStores = useMemo(() => filterRows(stores, keyword, row => `${row.atom_code} ${row.store_name}`), [stores, keyword]);
  const stockMap = useMemo(() => new Map(stocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)])), [stocks]);

  return (
    <main className="page app-v3">
      <section className="card app-shell">
        {screen !== 'employees' && <div className="top-action-bar"><button className="back-btn" onClick={back}>返回</button></div>}
        {error && <div className="error">❌ {error}</div>}
        {loading && <div className="loading">{LOADING_TEXT}</div>}

        {screen === 'employees' && <EmployeeScreen keyword={keyword} setKeyword={setKeyword} employees={filteredEmployees} chooseEmployee={chooseEmployee} />}
        {screen === 'stores' && employee && <StoreScreen employee={employee} keyword={keyword} setKeyword={setKeyword} stores={filteredStores} totalStores={stores.length} openHistory={openHistory} openStock={openStock} openReport={() => openReport()} />}
        {screen === 'history' && store && <HistoryScreen store={store} history={history} openOrder={openOrder} openDetail={openDetail} loading={loading} />}
        {screen === 'detail' && detail && <DetailScreen detail={detail} products={products} />}
        {screen === 'report' && <ReportScreen date={reportDate} setDate={openReport} rows={reportRows} openDetail={openDetail} />}
        {screen === 'stock' && <StockScreen keyword={productKeyword} setKeyword={setProductKeyword} products={products} stockMap={stockMap} />}
        {screen === 'order' && store && <OrderScreen date={draftDate} setDate={setDraftDate} keyword={productKeyword} setKeyword={setProductKeyword} allProducts={products} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} selectedSpec={selectedSpec} setSelectedSpec={setSelectedSpec} lines={draftLines} updateDraft={updateDraft} saveOrder={saveOrder} />}
      </section>
    </main>
  );
}

function EmployeeScreen({ keyword, setKeyword, employees, chooseEmployee }: { keyword: string; setKeyword: (v: string) => void; employees: Employee[]; chooseEmployee: (row: Employee) => void }) {
  return <><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="🔍 输入姓名或工号搜索员工" /><div className="emp-grid">{employees.map(row => <button className="emp-card" key={row.employee_code} onClick={() => chooseEmployee(row)}><strong>{row.name}</strong><div className="sub">{row.employee_code}</div></button>)}</div></>;
}

function StoreScreen({ employee, keyword, setKeyword, stores, totalStores, openHistory, openStock, openReport }: { employee: Employee; keyword: string; setKeyword: (v: string) => void; stores: StoreAsset[]; totalStores: number; openHistory: (row: StoreAsset) => void; openStock: () => void; openReport: () => void }) {
  const letters = storeLetters(stores);
  return <><div className="store-top-gates"><button className="btn-gate-half btn-gate-stock" onClick={openStock}>库存</button><button className="btn-gate-half btn-gate-report" onClick={() => openReport()}>卖进数据</button><button className="btn-gate-half btn-gate-newstore" onClick={() => alert('新门店功能后续迁移')}>新门店</button></div><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜门店" /><div className="store-search-summary">当前业务员：{employee.name || employee.employee_code} · 门店 {stores.length}/{totalStores}</div><div className="store-container" id="list">{stores.map(row => <button className="item store-item" key={row.atom_code} onClick={() => openHistory(row)}><div className="prod-name">{row.store_name}</div><div className="sub">{row.atom_code}</div></button>)}</div><div className="alphabet-sidebar">{letters.map(letter => <span key={letter}>{letter}</span>)}</div></>;
}

function HistoryScreen({ store, history, openOrder, openDetail, loading }: { store: StoreAsset; history: HistorySummary[]; openOrder: () => void; openDetail: (orderNo: string) => void; loading: boolean }) {
  const isTemp = String(store.atom_code).startsWith('NEW_');
  return <><PageTitle>{store.store_name} {isTemp && <span className="new-store-badge">新门店</span>}</PageTitle><button className="btn-new-order" onClick={openOrder}>＋ 新增单据</button>{history.map(row => <button className="history-item history-item-compact" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><span>实收：{money(row.saleSum)}</span><span>{row.created_at?.split('T')[0] || '-'}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数：{row.skuCount} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</div><span className="delivery-note-btn delivery-note-btn-primary" onClick={event => event.stopPropagation()}>生成单据</span></div></button>)}{!history.length && !loading && <div className="sub empty">暂无订单</div>}</>;
}

function DetailScreen({ detail, products }: { detail: DetailState; products: Product[] }) {
  const total = normalAmount(detail.items);
  const grouped = groupOrderDetail(detail.items, products);
  return <><PageTitle>订单详情</PageTitle><div className="detail-action-row"><div className="detail-summary-actions"><div className="amount-summary-banner detail-amount-banner"><strong>实收：{money(total)}</strong>{detail.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary detail-delivery-action">生成单据</button></div><div className="detail-secondary-actions"><button className="smallbtn detail-action-secondary">修改</button><button className="smallbtn detail-danger-action">作废</button></div></div><div className="order-detail-list">{grouped.map(row => <div className="order-detail-row" key={row.title}><div className="order-detail-title">{row.title}</div><div className="order-detail-flavors">{Array.from(row.flavors.entries()).map(([flavor, qty]) => <div className="order-detail-flavor" key={flavor}><span>{flavor}</span><b>×{qty}</b></div>)}</div></div>)}</div></>;
}

function ReportScreen({ date, setDate, rows, openDetail }: { date: string; setDate: (date: string) => void; rows: ReportRow[]; openDetail: (orderNo: string) => void }) {
  return <><PageTitle>卖进数据</PageTitle><div className="report-filter-row"><input className="report-date-real" type="date" value={date} onChange={event => setDate(event.target.value)} /><button className="smallbtn" onClick={() => setDate(localDate())}>今天</button></div><div className="amount-summary-banner"><strong>总实收：{money(rows.reduce((sum, row) => sum + row.saleSum, 0))}</strong></div>{rows.map(row => <button className="history-item report-history-item" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><span>{row.storeName}</span><span>{row.orderDate}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数：{row.skuCount} 种 {row.hasAfterSale && <b className="badge">有售后</b>}</div><div className="history-detail-hint">实收：{money(row.saleSum)}</div></div></button>)}</>;
}

function StockScreen({ keyword, setKeyword, products, stockMap }: { keyword: string; setKeyword: (v: string) => void; products: Product[]; stockMap: Map<string, number> }) {
  const rows = filterRows(products, keyword, p => `${productDisplayName(p)} ${p.barcode}`).slice(0, 200);
  return <><PageTitle>库存</PageTitle><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜商品 / 条码" />{rows.map(product => <div className="stock-row" key={productBarcode(product)}><strong>{productDisplayName(product)}</strong><div className="stock-qty">库存：{stockMap.get(productBarcode(product)) || 0}</div></div>)}</>;
}

function OrderScreen({ date, setDate, keyword, setKeyword, allProducts, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec, lines, updateDraft, saveOrder }: { date: string; setDate: (v: string) => void; keyword: string; setKeyword: (v: string) => void; allProducts: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void; lines: Record<string, OrderLineDraft>; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; saveOrder: () => void }) {
  const brands = orderedUnique(allProducts, 'brand');
  const activeBrand = selectedBrand || brands[0] || '';
  const brandProducts = activeBrand ? allProducts.filter(product => String(product.brand || '') === activeBrand) : allProducts;
  const specs = ['ALL', ...orderedUnique(brandProducts, 'spec')];
  const specProducts = selectedSpec === 'ALL' ? brandProducts : brandProducts.filter(product => String(product.spec || '') === selectedSpec);
  const visibleProducts = filterRows(orderedProducts(specProducts), keyword, product => `${product.barcode} ${product.brand} ${product.spec} ${product.flavor} ${product.name} ${product.product_name}`).slice(0, keyword ? 120 : 80);
  const mixGroups = groupMixProducts(visibleProducts);
  const total = calculateOrderTotal(allProducts, lines);

  return <><PageTitle>新增单据</PageTitle><div className="order-date-row"><span className="order-date-main">日期：<input className="order-date-input" type="date" value={date} onChange={event => setDate(event.target.value)} /></span></div><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜商品 / 条码 / 口味" /><div className="brand-nav">{brands.map(brand => <button key={brand} className={`brand-badge ${brand === activeBrand ? 'active' : ''}`} onClick={() => { setSelectedBrand(brand); setSelectedSpec('ALL'); }}>{brand}</button>)}</div><div className="spec-nav">{specs.map(spec => <button key={spec} className={`spec-badge ${spec === selectedSpec ? 'active' : ''}`} onClick={() => setSelectedSpec(spec)}>{spec === 'ALL' ? '全部规格' : spec}</button>)}</div>{mixGroups.map(group => <MixBoxCard key={mixBoxKey(group[0])} products={group} lines={lines} updateDraft={updateDraft} />)}{visibleProducts.map(product => <ProductLine key={productBarcode(product)} product={product} line={lines[productBarcode(product)]} updateDraft={updateDraft} />)}<button className="float-submit" onClick={saveOrder}>提交账单 · {money(total)}</button></>;
}

function MixBoxCard({ products, lines, updateDraft }: { products: Product[]; lines: Record<string, OrderLineDraft>; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void }) {
  const first = products[0];
  const size = Number(first.pcs_per_box || 0);
  const qty = products.reduce((sum, product) => sum + Number(lines[productBarcode(product)]?.mixQty || 0), 0);
  const selected = products.find(product => Number(lines[productBarcode(product)]?.mixQty || 0) > 0) || first;
  const current = { ...defaultOrderLine(selected), ...(lines[productBarcode(selected)] || {}) };
  const price = Number(current.mixBoxPrice || wholeDefaultPrice(selected));

  return <div className="mix-box-card"><div className="mix-box-head"><span className="mix-box-title">点击拼盒</span><span className="mix-box-count">{qty}/{size}{unitOf(first)}</span><span className="price-label">价格</span><input className="ios-picker price-picker" type="number" inputMode="decimal" min="0" step="0.10" value={price || ''} onChange={event => products.forEach(product => updateDraft(product, { mixBoxPrice: Number(event.target.value || 0) }))} /></div><div className="mix-box-panel">{products.map(product => { const barcode = productBarcode(product); const line = { ...defaultOrderLine(product), ...(lines[barcode] || {}) }; return <div className="mix-flavor-row" key={barcode}><span>{orderDetailFlavor(product) || productDisplayName(product)}</span><button type="button" onClick={() => updateDraft(product, { mixQty: Math.max(0, Number(line.mixQty || 0) - 1) })}>-</button><b>{Number(line.mixQty || 0)}</b><button type="button" onClick={() => updateDraft(product, { mixQty: Number(line.mixQty || 0) + 1 })}>+</button></div>; })}</div></div>;
}

function ProductLine({ product, line, updateDraft }: { product: Product; line?: OrderLineDraft; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void }) {
  const current = { ...defaultOrderLine(product), ...(line || {}) };
  const size = packSize(product);
  return <div className="item product-line"><div className="item-main-row"><div className="prod-info"><div className="prod-name">{orderDetailSpec(product, current.barcode)}</div>{orderDetailFlavor(product) && <div className="flavor-badge">{orderDetailFlavor(product)}</div>}<div className="pack-hint">{size > 1 ? `1整 = ${size}${unitOf(product)}` : `单位：${unitOf(product)}`}</div></div><div className="control-group">{size > 1 && <div className="sell-line"><span className="sell-tag">整</span><input className="ios-picker" type="number" inputMode="numeric" min="0" value={current.wholeQty || ''} onChange={event => updateDraft(product, { wholeQty: Number(event.target.value || 0) })} /><span className="sell-unit">整</span><span className="price-label">价格</span><input className="ios-picker price-picker" type="number" inputMode="decimal" min="0" step="0.10" value={current.wholePrice || ''} onChange={event => updateDraft(product, { wholePrice: Number(event.target.value || 0) })} /></div>}<div className="sell-line"><span className="sell-tag">散</span><input className="ios-picker" type="number" inputMode="numeric" min="0" value={current.looseQty || ''} onChange={event => updateDraft(product, { looseQty: Number(event.target.value || 0) })} /><span className="sell-unit">{unitOf(product)}</span><span className="price-label">价格</span><input className="ios-picker price-picker" type="number" inputMode="decimal" min="0" step="0.05" value={current.loosePrice || ''} onChange={event => updateDraft(product, { loosePrice: Number(event.target.value || 0) })} /></div><div className="after-sales-line"><span className="after-sales-toggle">收回</span><input className="ios-picker" type="number" inputMode="numeric" min="0" value={current.afterSaleQty || ''} onChange={event => updateDraft(product, { afterSaleQty: Number(event.target.value || 0) })} /><span className="sell-unit">{unitOf(product)}</span></div></div></div></div>;
}

function filterRows<T>(rows: T[], keyword: string, text: (row: T) => string) { const q = keyword.trim().toLowerCase(); return q ? rows.filter(row => text(row).toLowerCase().includes(q)) : rows; }
function groupItemsByOrder(items: SalesOrderItem[]) { const grouped = new Map<string, SalesOrderItem[]>(); items.forEach(item => { const key = String(item.order_no); grouped.set(key, [...(grouped.get(key) || []), item]); }); return grouped; }
function groupOrderDetail(items: SalesOrderItem[], products: Product[]) { const grouped = new Map<string, DetailGroup>(); normalSaleItems(items).forEach(item => { const product = products.find(p => String(p.barcode) === String(item.barcode) || String(p.id) === String(item.barcode)); const title = orderDetailSpec(product, item.product_name || item.barcode); const flavor = orderDetailFlavor(product) || item.product_name || '默认'; const row = grouped.get(title) || { title, flavors: new Map<string, number>() }; const qty = Number(item.sale_qty ?? item.qty ?? 0); row.flavors.set(flavor, Number(row.flavors.get(flavor) || 0) + qty); grouped.set(title, row); }); return Array.from(grouped.values()); }
function hasLineValue(line: OrderLineDraft) { return Number(line.wholeQty || 0) > 0 || Number(line.looseQty || 0) > 0 || Number(line.mixQty || 0) > 0 || Number(line.afterSaleQty || 0) > 0; }
function draftKey(employee: Employee, store: StoreAsset) { return `${ORDER_DRAFT_PREFIX}:${employee.employee_code}:${store.atom_code}`; }
function loadDraft(key: string): StoredDraft | null { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as StoredDraft : null; } catch { return null; } }
function saveDraft(key: string, draft: StoredDraft) { try { if (Object.keys(draft.lines).length) localStorage.setItem(key, JSON.stringify(draft)); } catch { /* localStorage may be unavailable */ } }
function clearDraft(key: string) { try { localStorage.removeItem(key); } catch { /* localStorage may be unavailable */ } }
function productSortValue(product: Product) { const id = Number(product.id || 0); return Number.isFinite(id) && id > 0 ? id : 999999; }
function orderedProducts(list: Product[]) { return [...list].sort((a, b) => productSortValue(a) - productSortValue(b) || productDisplayName(a).localeCompare(productDisplayName(b), 'zh-CN', { numeric: true })); }
function orderedUnique<K extends keyof Product>(list: Product[], key: K) { const seen = new Set<string>(); const out: string[] = []; orderedProducts(list).forEach(product => { const value = String(product[key] || '').trim(); if (value && !seen.has(value)) { seen.add(value); out.push(value); } }); return out; }
function mixBoxKey(product: Product) { return `${product.brand || ''}|||${product.spec || ''}`; }
function groupMixProducts(products: Product[]) { const map = new Map<string, Product[]>(); products.filter(canMixBox).forEach(product => { const key = mixBoxKey(product); map.set(key, [...(map.get(key) || []), product]); }); return Array.from(map.values()).filter(group => group.length > 1); }
function storeLetters(stores: StoreAsset[]) { const letters = new Set<string>(); stores.forEach(store => { const first = String(store.store_name || store.atom_code || '#').trim().charAt(0).toUpperCase(); letters.add(/[A-Z]/.test(first) ? first : '#'); }); return Array.from(letters).sort(); }
