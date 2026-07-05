import { useEffect, useMemo, useState } from 'react';
import { loadEmployees, loadHistory, loadItems, loadOrderDetail, loadOrdersByEmployee, loadProducts, loadStocks, loadStores, submitOrder } from './lib/api';
import { localDate, money, normalAmount, normalSaleItems, orderDetailFlavor, orderDetailSpec, orderHasAfterSale, productDisplayName, uniqueSkuCount } from './lib/rules';
import { PageTitle, SearchBox } from './ui/components';
import type { Employee, HistorySummary, OrderLineDraft, Product, ReportRow, SalesOrderItem, Screen, StoreAsset, VanStock } from './types';

const LOADING_TEXT = '正在加载..';

type DetailState = { orderNo: string; items: SalesOrderItem[]; hasAfterSale: boolean };
type DetailGroup = { title: string; flavors: Map<string, number> };

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

  useEffect(() => { void bootstrap(); }, []);

  async function run<T>(job: () => Promise<T>) {
    setLoading(true); setError('');
    try { return await job(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { setLoading(false); }
  }

  async function bootstrap() {
    await run(async () => {
      const [empRows, productRows] = await Promise.all([loadEmployees(), loadProducts()]);
      setEmployees(empRows); setProducts(productRows);
    });
  }

  async function chooseEmployee(row: Employee) {
    await run(async () => { setEmployee(row); setKeyword(''); setStores(await loadStores(row.employee_code)); setScreen('stores'); });
  }

  async function openHistory(row: StoreAsset) {
    await run(async () => {
      setStore(row); setKeyword('');
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

  async function openStock() { if (!employee) return; await run(async () => { setStocks(await loadStocks(employee.employee_code)); setScreen('stock'); }); }
  function openOrder() { setDraftLines({}); setDraftDate(localDate()); setProductKeyword(''); setScreen('order'); }
  function back() {
    setError('');
    if (screen === 'stores') { setEmployee(null); setScreen('employees'); return; }
    if (screen === 'history') { setStore(null); setScreen('stores'); return; }
    if (screen === 'detail' || screen === 'order') { setScreen('history'); return; }
    setScreen('stores');
  }

  function updateDraft(product: Product, patch: Partial<OrderLineDraft>) {
    const barcode = String(product.barcode || product.id || '');
    setDraftLines(prev => {
      const old = prev[barcode] || { barcode, looseQty: 0, loosePrice: Number(product.default_price || 0), afterSaleQty: 0 };
      const next = { ...old, ...patch };
      const copy = { ...prev };
      if (next.looseQty > 0 || next.afterSaleQty > 0) copy[barcode] = next; else delete copy[barcode];
      return copy;
    });
  }

  async function saveOrder() {
    if (!employee || !store) return;
    await run(async () => {
      const orderNo = await submitOrder({ employeeCode: employee.employee_code, atomCode: store.atom_code, storeName: store.store_name, date: draftDate, products, lines: draftLines });
      alert(`✅ 开单成功：${orderNo}`);
      await openHistory(store);
    });
  }

  const filteredEmployees = useMemo(() => filterRows(employees, keyword, row => `${row.employee_code} ${row.name}`), [employees, keyword]);
  const filteredStores = useMemo(() => filterRows(stores, keyword, row => `${row.atom_code} ${row.store_name}`), [stores, keyword]);
  const filteredProducts = useMemo(() => {
    const selected = new Set(Object.keys(draftLines));
    return filterRows(products, productKeyword, row => `${row.barcode} ${row.brand} ${row.spec} ${row.flavor} ${row.name}`).filter(row => selected.has(String(row.barcode)) || productKeyword || true).slice(0, productKeyword ? 120 : 60);
  }, [products, productKeyword, draftLines]);
  const stockMap = useMemo(() => new Map(stocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)])), [stocks]);

  return (
    <main className="page app-v3">
      <section className="card app-shell">
        {screen !== 'employees' && <div className="top-action-bar"><button className="back-btn" onClick={back}>返回</button></div>}
        {error && <div className="error">❌ {error}</div>}
        {loading && <div className="loading">{LOADING_TEXT}</div>}

        {screen === 'employees' && <EmployeeScreen keyword={keyword} setKeyword={setKeyword} employees={filteredEmployees} chooseEmployee={chooseEmployee} />}
        {screen === 'stores' && <StoreScreen keyword={keyword} setKeyword={setKeyword} stores={filteredStores} openHistory={openHistory} openStock={openStock} openReport={() => openReport()} />}
        {screen === 'history' && store && <HistoryScreen store={store} history={history} openOrder={openOrder} openDetail={openDetail} loading={loading} />}
        {screen === 'detail' && detail && <DetailScreen detail={detail} products={products} />}
        {screen === 'report' && <ReportScreen date={reportDate} setDate={openReport} rows={reportRows} openDetail={openDetail} />}
        {screen === 'stock' && <StockScreen keyword={productKeyword} setKeyword={setProductKeyword} products={products} stockMap={stockMap} />}
        {screen === 'order' && store && <OrderScreen date={draftDate} setDate={setDraftDate} keyword={productKeyword} setKeyword={setProductKeyword} products={filteredProducts} lines={draftLines} updateDraft={updateDraft} saveOrder={saveOrder} />}
      </section>
    </main>
  );
}

function EmployeeScreen({ keyword, setKeyword, employees, chooseEmployee }: { keyword: string; setKeyword: (v: string) => void; employees: Employee[]; chooseEmployee: (row: Employee) => void }) {
  return <><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="🔍 输入姓名或工号搜索员工" /><div className="emp-grid">{employees.map(row => <button className="emp-card" key={row.employee_code} onClick={() => chooseEmployee(row)}><strong>{row.name}</strong><div className="sub">{row.employee_code}</div></button>)}</div></>;
}

function StoreScreen({ keyword, setKeyword, stores, openHistory, openStock, openReport }: { keyword: string; setKeyword: (v: string) => void; stores: StoreAsset[]; openHistory: (row: StoreAsset) => void; openStock: () => void; openReport: () => void }) {
  return <><div className="store-top-gates"><button className="btn-gate-half btn-gate-stock" onClick={openStock}>库存</button><button className="btn-gate-half btn-gate-report" onClick={() => openReport()}>卖进数据</button><button className="btn-gate-half btn-gate-newstore" onClick={() => alert('新门店功能后续迁移')}>新门店</button></div><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜门店" /><div className="store-container">{stores.map(row => <button className="item store-item" key={row.atom_code} onClick={() => openHistory(row)}><div className="prod-name">{row.store_name}</div><div className="sub">{row.atom_code}</div></button>)}</div></>;
}

function HistoryScreen({ store, history, openOrder, openDetail, loading }: { store: StoreAsset; history: HistorySummary[]; openOrder: () => void; openDetail: (orderNo: string) => void; loading: boolean }) {
  return <><PageTitle>{store.store_name}</PageTitle><button className="btn-new-order" onClick={openOrder}>＋ 新增单据</button>{history.map(row => <button className="history-item history-item-compact" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><span>实收：{money(row.saleSum)}</span><span>{row.created_at?.split('T')[0] || '-'}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数：{row.skuCount} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</div><span className="delivery-note-btn delivery-note-btn-primary">生成单据</span></div></button>)}{!history.length && !loading && <div className="sub empty">暂无订单</div>}</>;
}

function DetailScreen({ detail, products }: { detail: DetailState; products: Product[] }) {
  const total = normalAmount(detail.items);
  const grouped = groupOrderDetail(detail.items, products);
  return <><PageTitle>订单详情</PageTitle><div className="detail-action-row"><div className="detail-summary-actions"><div className="amount-summary-banner detail-amount-banner"><strong>实收：{money(total)}</strong>{detail.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary detail-delivery-action">生成单据</button></div><div className="detail-secondary-actions"><button className="smallbtn detail-action-secondary">修改</button><button className="smallbtn detail-danger-action">作废</button></div></div><div className="order-detail-list">{grouped.map(row => <div className="order-detail-row" key={row.title}><div className="order-detail-title">{row.title}</div><div className="order-detail-flavors">{Array.from(row.flavors.entries()).map(([flavor, qty]) => <div className="order-detail-flavor" key={flavor}><span>{flavor}<b>×{qty}</b></span></div>)}</div></div>)}</div></>;
}

function ReportScreen({ date, setDate, rows, openDetail }: { date: string; setDate: (date: string) => void; rows: ReportRow[]; openDetail: (orderNo: string) => void }) {
  return <><PageTitle>卖进数据</PageTitle><div className="report-filter-row"><input className="report-date-real" type="date" value={date} onChange={event => setDate(event.target.value)} /><button className="smallbtn" onClick={() => setDate(localDate())}>今天</button></div><div className="amount-summary-banner"><strong>总实收：{money(rows.reduce((sum, row) => sum + row.saleSum, 0))}</strong></div>{rows.map(row => <button className="history-item report-history-item" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><span>{row.storeName}</span><span>{row.orderDate}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数：{row.skuCount} 种 {row.hasAfterSale && <b className="badge">有售后</b>}</div><div className="history-detail-hint">实收：{money(row.saleSum)}</div></div></button>)}</>;
}

function StockScreen({ keyword, setKeyword, products, stockMap }: { keyword: string; setKeyword: (v: string) => void; products: Product[]; stockMap: Map<string, number> }) {
  const rows = filterRows(products, keyword, p => `${productDisplayName(p)} ${p.barcode}`).slice(0, 200);
  return <><PageTitle>库存</PageTitle><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜商品 / 条码" />{rows.map(product => <div className="stock-row" key={String(product.barcode)}><strong>{productDisplayName(product)}</strong><div className="stock-qty">库存：{stockMap.get(String(product.barcode)) || 0}</div></div>)}</>;
}

function OrderScreen({ date, setDate, keyword, setKeyword, products, lines, updateDraft, saveOrder }: { date: string; setDate: (v: string) => void; keyword: string; setKeyword: (v: string) => void; products: Product[]; lines: Record<string, OrderLineDraft>; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; saveOrder: () => void }) {
  const total = Object.values(lines).reduce((sum, line) => sum + Number(line.looseQty || 0) * Number(line.loosePrice || 0), 0);
  return <><PageTitle>新增单据</PageTitle><div className="order-date-row"><span className="order-date-main">日期：<input className="order-date-input" type="date" value={date} onChange={event => setDate(event.target.value)} /></span></div><SearchBox value={keyword} onChange={setKeyword} onClear={() => setKeyword('')} placeholder="搜商品 / 条码 / 口味" />{products.map(product => <ProductLine key={String(product.barcode || product.id)} product={product} line={lines[String(product.barcode || product.id)]} updateDraft={updateDraft} />)}<button className="float-submit" onClick={saveOrder}>提交账单 · {money(total)}</button></>;
}

function ProductLine({ product, line, updateDraft }: { product: Product; line?: OrderLineDraft; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void }) {
  const current = line || { barcode: String(product.barcode || product.id || ''), looseQty: 0, loosePrice: Number(product.default_price || 0), afterSaleQty: 0 };
  return <div className="item product-line"><div className="prod-name">{orderDetailSpec(product, current.barcode)}</div>{orderDetailFlavor(product) && <div className="flavor-badge">{orderDetailFlavor(product)}</div>}<div className="control-group"><div className="sell-line"><span className="sell-tag">散</span><input className="ios-picker" type="number" inputMode="numeric" min="0" value={current.looseQty || ''} onChange={event => updateDraft(product, { looseQty: Number(event.target.value || 0) })} /><span className="price-label">价格</span><input className="ios-picker price-picker" type="number" inputMode="decimal" min="0" step="0.05" value={current.loosePrice || ''} onChange={event => updateDraft(product, { loosePrice: Number(event.target.value || 0) })} /><span className="after-sales-toggle">收回</span><input className="ios-picker" type="number" inputMode="numeric" min="0" value={current.afterSaleQty || ''} onChange={event => updateDraft(product, { afterSaleQty: Number(event.target.value || 0) })} /></div></div></div>;
}

function filterRows<T>(rows: T[], keyword: string, text: (row: T) => string) { const q = keyword.trim().toLowerCase(); return q ? rows.filter(row => text(row).toLowerCase().includes(q)) : rows; }
function groupItemsByOrder(items: SalesOrderItem[]) { const grouped = new Map<string, SalesOrderItem[]>(); items.forEach(item => { const key = String(item.order_no); grouped.set(key, [...(grouped.get(key) || []), item]); }); return grouped; }
function groupOrderDetail(items: SalesOrderItem[], products: Product[]) { const grouped = new Map<string, DetailGroup>(); normalSaleItems(items).forEach(item => { const product = products.find(p => String(p.barcode) === String(item.barcode) || String(p.id) === String(item.barcode)); const title = orderDetailSpec(product, item.product_name || item.barcode); const flavor = orderDetailFlavor(product) || item.product_name || '默认'; const row = grouped.get(title) || { title, flavors: new Map<string, number>() }; const qty = Number(item.sale_qty ?? item.qty ?? 0); row.flavors.set(flavor, Number(row.flavors.get(flavor) || 0) + qty); grouped.set(title, row); }); return Array.from(grouped.values()); }
