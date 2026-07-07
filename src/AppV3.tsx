import { useEffect, useMemo, useState } from 'react';
import { pinyin } from 'pinyin-pro';
import { countStoreOrders, createManualStore, deleteExistingOrder, deleteManualStore, loadEmployees, loadHistory, loadItems, loadOrderDetail, loadOrdersByEmployee, loadProducts, loadStocks, loadStores, submitOrder } from './lib/api';
import { buildDeliveryNoteRows, downloadDeliveryNoteImage } from './lib/deliveryNote';
import { calculateOrderTotal, canMixBox, defaultOrderLine, packSize, productBarcode, unitOf, wholeDefaultPrice } from './lib/orderPayload';
import { localDate, money, normalAmount, normalSaleItems, orderDetailFlavor, orderDetailSpec, orderHasAfterSale, parseAfterSaleRemark, productDisplayName, uniqueSkuCount } from './lib/rules';
import type { Employee, HistorySummary, OrderLineDraft, Product, ReportRow, SalesOrderItem, Screen, StoreAsset, VanStock } from './types';

const LOADING_TEXT = '正在加载..';
const ORDER_DRAFT_PREFIX = 'spr2_order_draft_v1';

type DetailState = { orderNo: string; orderDate: string; items: SalesOrderItem[]; hasAfterSale: boolean; afterSaleMap: Record<string, number> };
type DetailSaleParts = { wholeQty: number; wholePrice: number; looseQty: number; loosePrice: number };
type DetailFlavorRow = DetailSaleParts & { flavor: string };
type DetailGroup = DetailSaleParts & { title: string; flavors: Map<string, DetailFlavorRow>; amount: number };
type DetailAfterSaleRow = { barcode: string; title: string; flavor: string; qty: number; unit: string };
type StoredDraft = { date: string; lines: Record<string, OrderLineDraft>; selectedBrand?: string; selectedSpec?: string; mixBoxOpenKeys?: string[] };
type StoreGroup = { letter: string; stores: StoreAsset[] };
type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

function getInitialEmployeeFromUrl(rows: Employee[]) {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('emp') || params.get('employee_code') || sessionStorage.getItem('current_employee_code') || '').trim();
  if (!code) return null;
  const name = (params.get('name') || sessionStorage.getItem('current_employee_name') || code).trim();
  return rows.find(row => String(row.employee_code) === code) || { employee_code: code, name, is_active: true };
}

function persistCurrentEmployee(row: Employee) {
  sessionStorage.setItem('current_employee_code', String(row.employee_code));
  if (row.name) sessionStorage.setItem('current_employee_name', String(row.name));
  const params = new URLSearchParams(window.location.search);
  const queryCode = (params.get('emp') || params.get('employee_code') || '').trim();
  if (!queryCode) return;
  const url = new URL(window.location.href);
  const target = `emp=${encodeURIComponent(String(row.employee_code))}`;
  if (url.searchParams.toString() !== target) window.history.replaceState(null, '', `${url.pathname}?${target}${url.hash}`);
}

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
  const [detailFromReport, setDetailFromReport] = useState(false);
  const [stocks, setStocks] = useState<VanStock[]>([]);
  const [reportDate, setReportDate] = useState(localDate());
  const [reportPreset, setReportPreset] = useState<ReportPreset>('today');
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [draftDate, setDraftDate] = useState(localDate());
  const [draftLines, setDraftLines] = useState<Record<string, OrderLineDraft>>({});
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('');
  const [mixBoxOpenKeys, setMixBoxOpenKeys] = useState<Set<string>>(new Set());
  const [qtyPopup, setQtyPopup] = useState<QtyPopupState | null>(null);
  const [deliveryBusyOrderNo, setDeliveryBusyOrderNo] = useState<string | null>(null);
  const [editingOrderNo, setEditingOrderNo] = useState<string | null>(null);
  const [previousStockByBarcode, setPreviousStockByBarcode] = useState<Map<string, number>>(new Map());

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    const syncHeight = () => {
      const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${Math.floor(h)}px`);
    };
    syncHeight();
    window.visualViewport?.addEventListener('resize', syncHeight);
    window.visualViewport?.addEventListener('scroll', syncHeight);
    window.addEventListener('resize', syncHeight);
    return () => {
      window.visualViewport?.removeEventListener('resize', syncHeight);
      window.visualViewport?.removeEventListener('scroll', syncHeight);
      window.removeEventListener('resize', syncHeight);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('store-search-mode', screen === 'stores' && keyword.trim().length > 0);
    return () => document.body.classList.remove('store-search-mode');
  }, [screen, keyword]);

  useEffect(() => {
    if (screen !== 'order' || !employee || !store) return;
    saveDraft(draftKey(employee, store), { date: draftDate, lines: draftLines, selectedBrand, selectedSpec, mixBoxOpenKeys: Array.from(mixBoxOpenKeys) });
  }, [screen, employee, store, draftDate, draftLines, selectedBrand, selectedSpec, mixBoxOpenKeys]);

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
      setProducts(normalizeProducts(productRows));
      const initialEmployee = getInitialEmployeeFromUrl(empRows);
      if (initialEmployee) await openInitialEmployeeFromUrl(initialEmployee);
    });
  }

  async function openInitialEmployeeFromUrl(row: Employee) {
    persistCurrentEmployee(row);
    setEmployee(row);
    setKeyword('');
    setStores(await loadStores(row.employee_code));
    setScreen('stores');
  }

  async function chooseEmployee(row: Employee) {
    await run(async () => {
      persistCurrentEmployee(row);
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

  async function openDetail(orderNo: string, fromReport = false) {
    await run(async () => {
      const data = await loadOrderDetail(orderNo);
      const afterSaleMap = parseAfterSaleRemark(data.order?.remark);
      setDetailFromReport(fromReport);
      setDetail({ orderNo, orderDate: data.order?.created_at ? data.order.created_at.split('T')[0] : localDate(), items: data.items, hasAfterSale: orderHasAfterSale(data.order || {}, data.items), afterSaleMap });
      setScreen('detail');
    });
  }

  async function openReportDetail(row: ReportRow) {
    setStore({ employee_code: employee?.employee_code || '', atom_code: row.atomCode, store_name: row.storeName });
    await openDetail(row.order_no, true);
  }

  async function openReport(preset: ReportPreset = reportPreset, customDate = reportDate) {
    if (!employee) return;
    await run(async () => {
      const range = getReportRange(preset, customDate);
      setReportPreset(preset);
      if (preset === 'custom') setReportDate(range.label);
      const orders = await loadOrdersByEmployee(employee.employee_code, range.start, range.end);
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
      const brands = orderedUnique(products, 'brand');
      const brand = selectedBrand || brands[0] || '';
      setSelectedBrand(brand);
      setSelectedSpec(getSpecsForBrand(products, brand)[0] || '');
      setStocks(await loadStocks(employee.employee_code));
      setScreen('stock');
    });
  }
  function openOrder() {
    if (!employee || !store) return;
    const saved = loadDraft(draftKey(employee, store));
    const brands = orderedUnique(products, 'brand');
    const brand = saved?.selectedBrand || brands[0] || '';
    const spec = saved?.selectedSpec || getSpecsForBrand(products, brand)[0] || '';
    setDraftLines(saved?.lines || {});
    setDraftDate(saved?.date || localDate());
    setSelectedBrand(brand);
    setSelectedSpec(spec);
    setMixBoxOpenKeys(new Set(saved?.mixBoxOpenKeys || []));
    setScreen('order');
  }

  function back() {
    setError('');
    const clearOrderState = () => {
      if (employee && store) clearDraft(draftKey(employee, store));
      setDraftLines({});
      setMixBoxOpenKeys(new Set());
      setEditingOrderNo(null);
      setPreviousStockByBarcode(new Map());
    };
    if (screen === 'stores' && keyword.trim()) { setKeyword(''); return; }
    if (screen === 'stores') { setEmployee(null); setStores([]); setScreen('employees'); return; }
    if (screen === 'history') { setStore(null); setScreen('stores'); return; }
    if (screen === 'detail') { detailFromReport ? void openReport(reportPreset, reportDate) : setScreen('history'); return; }
    if (screen === 'report' || screen === 'stock' || screen === 'newStore') { setScreen('stores'); return; }
    if (screen === 'order' && editingOrderNo && detail) { clearOrderState(); setScreen('detail'); return; }
    if (screen === 'order' && store && String(store.atom_code).startsWith('NEW_')) { clearOrderState(); setScreen('newStore'); return; }
    if (screen === 'order') {
      clearOrderState();
      setScreen('history');
    }
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

  function updateSpecPrice(product: Product, key: 'wholePrice' | 'loosePrice', value: number) {
    setDraftLines(prev => {
      const copy = { ...prev };
      products.forEach(target => {
        if (String(target.brand || '') !== String(product.brand || '') || String(target.spec || '') !== String(product.spec || '')) return;
        const barcode = productBarcode(target);
        copy[barcode] = { ...defaultOrderLine(target), ...(copy[barcode] || {}), [key]: value, barcode };
      });
      return copy;
    });
  }

  function openNewStoreManagement() {
    setKeyword('');
    setScreen('newStore');
  }

  function triggerCreateNewStore() {
    const name = window.prompt('请输入自定义新门店的名称:');
    if (!name?.trim()) { if (name !== null) window.alert('门店名称不能为空！'); return; }
    const tempStore: StoreAsset = { employee_code: employee?.employee_code || '', atom_code: `NEW_${Math.random().toString(36).slice(2, 8).toUpperCase()}`, store_name: name.trim() };
    setStore(tempStore);
    const brands = orderedUnique(products, 'brand');
    const brand = brands[0] || '';
    setDraftLines({});
    setDraftDate(localDate());
    setSelectedBrand(brand);
    setSelectedSpec(getSpecsForBrand(products, brand)[0] || '');
    setMixBoxOpenKeys(new Set());
    setScreen('order');
  }

  async function deleteNewStore(row: StoreAsset) {
    if (!employee) return;
    await run(async () => {
      const count = await countStoreOrders(row.atom_code);
      if (count > 0) { window.alert('先删除历史单据再删除门店'); return; }
      if (!window.confirm(`确定删除 ${row.store_name} 吗？`)) return;
      await deleteManualStore(employee.employee_code, row.atom_code);
      setStores(prev => prev.filter(store => store.atom_code !== row.atom_code));
    });
  }

  async function saveOrder() {
    if (!employee || !store) return;
    if (!hasAnySale(products, draftLines)) { alert('⚠️ 空白单据无法提交！'); return; }
    await run(async () => {
      if (String(store.atom_code).startsWith('NEW_') && !stores.some(row => row.atom_code === store.atom_code)) {
        await createManualStore(employee.employee_code, store.atom_code, store.store_name);
        setStores(prev => [...prev, { ...store, employee_code: employee.employee_code }].sort((a, b) => String(a.store_name).localeCompare(String(b.store_name), 'zh-CN')));
      }
      const orderNo = await submitOrder({ employeeCode: employee.employee_code, atomCode: store.atom_code, storeName: store.store_name, date: draftDate, products, lines: draftLines, orderNo: editingOrderNo || undefined, previousStockByBarcode });
      clearDraft(draftKey(employee, store));
      setDraftLines({});
      setMixBoxOpenKeys(new Set());
      alert(`✅ 开单成功：${orderNo}`);
      await openHistory(store);
    });
  }

  async function editExistingOrder(orderNo: string) {
    if (!store) return;
    await run(async () => {
      const data = await loadOrderDetail(orderNo);
      const lines = orderItemsToDraftLines(data.items, products, parseAfterSaleRemark(data.order?.remark));
      const previous = orderItemsStockMap(data.items);
      const brands = orderedUnique(products, 'brand');
      const firstEdited = products.find(product => lines[productBarcode(product)]);
      const brand = firstEdited?.brand || brands[0] || '';
      setEditingOrderNo(orderNo);
      setPreviousStockByBarcode(previous);
      setDraftLines(lines);
      setDraftDate(data.order?.created_at ? data.order.created_at.split('T')[0] : localDate());
      setSelectedBrand(brand);
      setSelectedSpec(firstEdited?.spec || getSpecsForBrand(products, brand)[0] || '');
      setMixBoxOpenKeys(new Set());
      setScreen('order');
    });
  }

  async function deleteOrder(orderNo: string) {
    if (!employee || !store || !detail) return;
    if (!window.confirm('确定删除本笔记录并返还库存量吗？')) return;
    await run(async () => {
      await deleteExistingOrder(employee.employee_code, orderNo, detail.items);
      setDetail(null);
      if (detailFromReport) await openReport(reportPreset, reportDate);
      else await openHistory(store);
    });
  }
  async function generateDeliveryNote(orderNo: string, orderDate: string, storeName = store?.store_name || '') {
    if (!employee) return;
    setDeliveryBusyOrderNo(orderNo);
    try {
      const data = await loadOrderDetail(orderNo);
      const rows = buildDeliveryNoteRows(data.items, products);
      if (!rows.length) { alert('该订单没有明细，无法生成单据'); return; }
      const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      await downloadDeliveryNoteImage({ storeName, rows, totalAmount: Number(totalAmount.toFixed(2)), employeeName: employee.name || employee.employee_code, orderDate });
    } catch (err) {
      alert(`生成单据失败: ${err instanceof Error ? err.message : '请重试'}`);
    } finally {
      setDeliveryBusyOrderNo(null);
    }
  }

  const filteredEmployees = useMemo(() => filterRows(employees, keyword, row => `${row.employee_code} ${row.name}`), [employees, keyword]);
  const visibleStores = useMemo(() => stores.filter(row => !String(row.atom_code).startsWith('NEW_')), [stores]);
  const filteredStores = useMemo(() => filterRows(visibleStores, keyword, row => `${row.atom_code} ${row.store_name}`), [visibleStores, keyword]);
  const storeGroups = useMemo(() => keyword.trim() ? [] : groupStoresByLetter(filteredStores), [filteredStores, keyword]);
  const sidebarLetters = storeGroups.length > 1 && filteredStores.length > 10 ? storeGroups.map(group => group.letter) : [];
  const stockMap = useMemo(() => new Map(stocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)])), [stocks]);
  const showSearch = screen === 'employees' || screen === 'stores';
  const searchPlaceholder = screen === 'employees' ? '🔍 输入姓名或工号搜索员工' : '🔍 输入门店名称或编码搜索店铺...';

  return (
    <div className="card">
      <div id="searchBlock" className={`search-wrapper ${showSearch ? '' : 'hide'}`}>
        <input id="search" value={keyword} placeholder={searchPlaceholder} onFocus={() => screen === 'stores' && keyword && document.body.classList.add('store-search-mode')} onChange={event => setKeyword(event.target.value)} />
        <button id="clearSearch" className={`search-clear-btn ${keyword ? 'visible' : ''}`} onClick={() => setKeyword('')}>✕</button>
      </div>
      <div className="top-action-bar"><button id="back" className="back-btn" onClick={back}>返回</button></div>
      <div id="list">
        {error && <div className="error">❌ {error}</div>}
        {loading && <div className="loading">{LOADING_TEXT}</div>}
        {screen === 'employees' && <EmployeeScreen employees={filteredEmployees} chooseEmployee={chooseEmployee} />}
        {screen === 'stores' && <StoreScreen keyword={keyword} stores={filteredStores} totalStores={visibleStores.length} groups={storeGroups} openHistory={openHistory} openStock={openStock} openReport={() => openReport('today')} openNewStoreManagement={openNewStoreManagement} />}
        {screen === 'history' && store && <HistoryScreen store={store} history={history} openOrder={openOrder} openDetail={openDetail} generateDeliveryNote={generateDeliveryNote} deliveryBusy={deliveryBusyOrderNo !== null} loading={loading} />}
        {screen === 'newStore' && <NewStoreScreen stores={stores.filter(row => String(row.atom_code).startsWith('NEW_'))} triggerCreateNewStore={triggerCreateNewStore} openHistory={openHistory} deleteNewStore={deleteNewStore} />}
        {screen === 'detail' && detail && <DetailScreen detail={detail} products={products} storeName={store?.store_name || ''} generateDeliveryNote={generateDeliveryNote} deliveryBusy={deliveryBusyOrderNo !== null} editExistingOrder={editExistingOrder} deleteOrder={deleteOrder} />}
        {screen === 'report' && <ReportScreen preset={reportPreset} customDate={reportDate} openReport={openReport} rows={reportRows} openDetail={openReportDetail} />}
        {screen === 'stock' && employee && <StockScreen employee={employee} allProducts={products} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} selectedSpec={selectedSpec} setSelectedSpec={setSelectedSpec} stockMap={stockMap} />}
        {screen === 'order' && store && <OrderScreen store={store} date={draftDate} setDate={setDraftDate} allProducts={products} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} selectedSpec={selectedSpec} setSelectedSpec={setSelectedSpec} lines={draftLines} mixBoxOpenKeys={mixBoxOpenKeys} setMixBoxOpenKeys={setMixBoxOpenKeys} updateDraft={updateDraft} updateSpecPrice={updateSpecPrice} openQtyPopup={setQtyPopup} saveOrder={saveOrder} />}
      </div>
      <div id="alphabetSidebar" className={`alphabet-sidebar ${sidebarLetters.length ? '' : 'hide'}`}>
        {sidebarLetters.map(letter => <button key={letter} onClick={() => document.getElementById(`group_letter_${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{letter}</button>)}
      </div>
      <QtyPopup state={qtyPopup} close={() => setQtyPopup(null)} />
    </div>
  );
}

function EmployeeScreen({ employees, chooseEmployee }: { employees: Employee[]; chooseEmployee: (row: Employee) => void }) {
  return <div className="emp-grid">{employees.map(row => <button className="emp-card" key={row.employee_code} onClick={() => chooseEmployee(row)}><strong>{row.name}</strong><div className="sub">{row.employee_code}</div></button>)}</div>;
}

function StoreScreen({ keyword, stores, totalStores, groups, openHistory, openStock, openReport, openNewStoreManagement }: { keyword: string; stores: StoreAsset[]; totalStores: number; groups: StoreGroup[]; openHistory: (row: StoreAsset) => void; openStock: () => void; openReport: () => void; openNewStoreManagement: () => void }) {
  return <><div className="store-top-gates"><button className="btn-gate-half btn-gate-stock" onClick={openStock}>📦 库存管理</button><button className="btn-gate-half btn-gate-report" onClick={openReport}>📊 卖进数据</button><button className="btn-gate-half btn-gate-newstore" onClick={openNewStoreManagement}>🆕 新门店</button></div><div className="store-search-summary">门店总数：{totalStores} 家</div><div className="store-container">{keyword.trim() ? <StoreRows stores={stores} openHistory={openHistory} /> : groups.length ? groups.map(group => <div key={group.letter}><div id={`group_letter_${group.letter}`} className="letter-group-title">{group.letter}</div><StoreRows stores={group.stores} openHistory={openHistory} /></div>) : <div className="sub empty">⚠️ 未找到匹配的店铺</div>}</div></>;
}

function StoreRows({ stores, openHistory }: { stores: StoreAsset[]; openHistory: (row: StoreAsset) => void }) {
  if (!stores.length) return <div className="sub empty">⚠️ 未找到匹配的店铺</div>;
  return <>{stores.map(row => <button className="item store-item" key={row.atom_code} onClick={() => openHistory(row)}><strong>{row.store_name}</strong><div className="sub">{row.atom_code}</div></button>)}</>;
}
function NewStoreScreen({ stores, triggerCreateNewStore, openHistory, deleteNewStore }: { stores: StoreAsset[]; triggerCreateNewStore: () => void; openHistory: (row: StoreAsset) => void; deleteNewStore: (row: StoreAsset) => void }) {
  return <><div className="big-store-title">🆕 新门店开单管理</div><button className="btn-new-order new-store-create" onClick={triggerCreateNewStore}>＋ 创建新门店并开单</button><div className="manual-store-heading">已开单的新门店列表 ({stores.length})</div>{stores.length === 0 ? <div className="sub empty manual-store-empty">暂无自主创建的新门店信息</div> : stores.map(row => <div className="history-item manual-store-card" key={row.atom_code} role="button" tabIndex={0} onClick={() => openHistory(row)} onKeyDown={event => { if (event.key === 'Enter') openHistory(row); }}><div className="manual-store-row"><strong>{row.store_name}</strong><button className="smallbtn manual-store-delete" onClick={event => { event.stopPropagation(); void deleteNewStore(row); }}>删除</button></div></div>)}</>;
}
function HistoryScreen({ store, history, openOrder, openDetail, generateDeliveryNote, deliveryBusy, loading }: { store: StoreAsset; history: HistorySummary[]; openOrder: () => void; openDetail: (orderNo: string) => void; generateDeliveryNote: (orderNo: string, orderDate: string, storeName?: string) => void; deliveryBusy: boolean; loading: boolean }) {
  const isTemp = String(store.atom_code).startsWith('NEW_');
  return <><div className="big-store-title">{store.store_name} {isTemp && <span className="new-store-badge">新门店</span>}</div><div style={{ margin: '14px 0' }}><button className="btn-new-order" onClick={openOrder}>＋ 新增单据</button></div>{history.map(row => { const date = row.created_at?.split('T')[0] || '未知日期'; return <div className="history-item history-item-compact" role="button" tabIndex={0} key={row.order_no} onClick={() => openDetail(row.order_no)} onKeyDown={event => { if (event.key === 'Enter') openDetail(row.order_no); }}><div className="history-item-top"><span>实收：{money(row.saleSum || 0)}</span><span>{date}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数: {row.skuCount || 0} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary" type="button" disabled={deliveryBusy} onClick={event => { event.stopPropagation(); void generateDeliveryNote(row.order_no, date, store.store_name); }}>{deliveryBusy ? LOADING_TEXT : '生成单据'}</button></div></div>; })}{!history.length && !loading && <div className="sub empty">暂无订单</div>}</>;
}

function DetailScreen({ detail, products, storeName, generateDeliveryNote, deliveryBusy, editExistingOrder, deleteOrder }: { detail: DetailState; products: Product[]; storeName: string; generateDeliveryNote: (orderNo: string, orderDate: string, storeName?: string) => void; deliveryBusy: boolean; editExistingOrder: (orderNo: string) => void; deleteOrder: (orderNo: string) => void }) {
  const total = normalAmount(detail.items);
  const grouped = groupOrderDetail(detail.items, products);
  const afterSaleRows = buildAfterSaleDetailRows(detail.afterSaleMap, products);
  const groupedTitles = new Set(grouped.map(row => row.title));
  const afterOnlyRows = afterSaleRows.filter(row => !groupedTitles.has(row.title));
  return <><div className="big-store-title">订单详情</div><div className="detail-action-row"><div className="detail-summary-actions"><div className="amount-summary-banner detail-amount-banner"><span><strong>实收：{money(total)}</strong></span>{detail.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary detail-delivery-action" type="button" disabled={deliveryBusy} onClick={() => generateDeliveryNote(detail.orderNo, detail.orderDate, storeName)}>{deliveryBusy ? LOADING_TEXT : '生成单据'}</button></div><div className="detail-secondary-actions"><button className="smallbtn detail-action-secondary" onClick={() => editExistingOrder(detail.orderNo)}>✏️ 修改</button><button className="smallbtn detail-danger-action" onClick={() => deleteOrder(detail.orderNo)}>🗑️ 删除</button></div></div><div className="order-detail-list">{grouped.map(row => <div className="order-detail-row" key={row.title}><div className="order-detail-title">{row.title}</div><div className="order-detail-lines">{row.flavors.size > 1 && <div className="order-detail-flavors">{Array.from(row.flavors.values()).map(flavorRow => <div className="order-detail-flavor" key={flavorRow.flavor}><span>{flavorRow.flavor}</span><span>{orderDetailPartsText(flavorRow)}</span></div>)}</div>}<div className="order-detail-line">卖进：<strong>{orderDetailPartsText(row)}</strong></div><div className="order-detail-line">金额：<strong>{money(row.amount)}</strong></div>{afterSaleRows.filter(afterRow => afterRow.title === row.title).map(afterRow => <div className="order-detail-line order-detail-line-danger" key={`after-${afterRow.barcode}`}>售后：<strong>{afterRow.qty}{afterRow.unit}</strong></div>)}</div></div>)}{afterOnlyRows.map(row => <div className="order-detail-row order-detail-row-danger" key={`after-only-${row.barcode}`}><div className="order-detail-title order-detail-title-danger">{row.title}</div><div className="order-detail-lines"><div className="order-detail-line order-detail-line-danger">售后：<strong>{row.qty}{row.unit}</strong></div></div></div>)}</div></>;
}

function ReportScreen({ preset, customDate, openReport, rows, openDetail }: { preset: ReportPreset; customDate: string; openReport: (preset: ReportPreset, customDate?: string) => void; rows: ReportRow[]; openDetail: (row: ReportRow) => void }) {
  const total = rows.reduce((sum, row) => sum + row.saleSum, 0);
  const buttons: Array<[ReportPreset, string]> = [['today', '今天'], ['yesterday', '昨天'], ['week', '本周'], ['month', '本月'], ['all', '全部']];
  return <><div className="big-store-title">📈 卖进数据</div><div id="reportFilters" className="report-filter-row">{buttons.map(([value, label]) => <button key={value} className={`smallbtn ${preset === value ? 'active' : ''}`} onClick={() => openReport(value)}>{label}</button>)}<div className="date-picker-wrapper"><button className={`smallbtn ${preset === 'custom' ? 'active' : ''}`} onClick={() => document.getElementById('reportDateInput') instanceof HTMLInputElement && (document.getElementById('reportDateInput') as HTMLInputElement).showPicker?.()}>日期选择</button><input id="reportDateInput" className="real-date-input report-date-input" type="date" value={customDate} onChange={event => event.target.value && openReport('custom', event.target.value)} /></div></div><div id="reportSummary" className="amount-summary-banner"><span><strong>总实收：{money(total)}</strong></span></div><div id="reportRows">{rows.length === 0 ? <div className="sub empty">⚠️ 暂无报表记录</div> : rows.map(row => <button className="history-item report-history-item" key={row.order_no} onClick={() => openDetail(row)}><div className="history-item-top"><strong>{row.storeName}</strong><span>{row.orderDate}</span></div><div className="history-item-actions"><div className="history-item-meta">品项: <strong>{row.skuCount}</strong> 种 {row.hasAfterSale && <b className="badge">有售后</b>}</div><div className="history-detail-hint">实收：{money(row.saleSum)}</div></div></button>)}</div></>;
}

function StockScreen({ employee, allProducts, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec, stockMap }: { employee: Employee; allProducts: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void; stockMap: Map<string, number> }) {
  const brands = orderedUnique(allProducts, 'brand');
  const activeBrand = selectedBrand || brands[0] || '';
  const specs = getSpecsForBrand(allProducts, activeBrand);
  const activeSpec = specs.includes(selectedSpec) ? selectedSpec : specs[0] || '';
  const rows = orderedProducts(allProducts.filter(product => product.brand === activeBrand && product.spec === activeSpec));
  return <><div className="sub stock-employee-title">🏢 库存查看：{employee.name || employee.employee_code}</div><FilterHeader products={allProducts} selectedBrand={activeBrand} setSelectedBrand={brand => { setSelectedBrand(brand); setSelectedSpec(getSpecsForBrand(allProducts, brand)[0] || ''); }} selectedSpec={activeSpec} setSelectedSpec={setSelectedSpec} />{rows.map(product => { const total = stockMap.get(productBarcode(product)) || 0; return <div className="stock-row" key={productBarcode(product)}><div className="stock-product-name">{displayProductName(product)}</div><div className="stock-qty">当前库存量: <strong>{formatQtyToUnits(total, product.pcs_per_case, product.pcs_per_box, unitOf(product))}</strong> ({total}{unitOf(product)})</div></div>; })}</>;
}

function OrderScreen({ store, date, setDate, allProducts, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec, lines, mixBoxOpenKeys, setMixBoxOpenKeys, updateDraft, updateSpecPrice, openQtyPopup, saveOrder }: { store: StoreAsset; date: string; setDate: (v: string) => void; allProducts: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void; lines: Record<string, OrderLineDraft>; mixBoxOpenKeys: Set<string>; setMixBoxOpenKeys: (v: Set<string>) => void; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; updateSpecPrice: (product: Product, key: 'wholePrice' | 'loosePrice', value: number) => void; openQtyPopup: (state: QtyPopupState) => void; saveOrder: () => void }) {
  const brands = orderedUnique(allProducts, 'brand');
  const activeBrand = selectedBrand || brands[0] || '';
  const specs = getSpecsForBrand(allProducts, activeBrand);
  const activeSpec = specs.includes(selectedSpec) ? selectedSpec : specs[0] || '';
  const rows = orderedProducts(allProducts.filter(product => product.brand === activeBrand && product.spec === activeSpec));
  const total = calculateOrderTotal(allProducts, lines);
  const count = allProducts.reduce((sum, product) => stockQtyFromLine(product, lines[productBarcode(product)]) > 0 ? sum + 1 : sum, 0);
  const isTemp = String(store.atom_code).startsWith('NEW_');

  return <><div className="big-store-title">{store.store_name} {isTemp && <span className="new-store-badge">新门店开单</span>}</div><div className="order-date-row"><span className="order-date-main">日期：<span id="dateText">{date}</span></span><div className="date-picker-wrapper"><button className="smallbtn order-date-action">修改日期</button><input type="date" className="real-date-input" value={date} onChange={event => setDate(event.target.value)} /></div></div><div id="liveAmountBanner" className="amount-summary-banner"><span><strong>实收：{money(total)}</strong></span><br />选购品项：{count} 款</div><FilterHeader products={allProducts} selectedBrand={activeBrand} setSelectedBrand={brand => { setSelectedBrand(brand); setSelectedSpec(getSpecsForBrand(allProducts, brand)[0] || ''); }} selectedSpec={activeSpec} setSelectedSpec={setSelectedSpec} /><MixBoxSection products={rows} lines={lines} openKeys={mixBoxOpenKeys} setOpenKeys={setMixBoxOpenKeys} updateDraft={updateDraft} />{rows.map(product => <ProductLine key={productBarcode(product)} product={product} line={lines[productBarcode(product)]} updateDraft={updateDraft} updateSpecPrice={updateSpecPrice} openQtyPopup={openQtyPopup} />)}<button className="float-submit" onClick={saveOrder}>提交账单</button></>;
}
function FilterHeader({ products, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec }: { products: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void }) {
  const brands = orderedUnique(products, 'brand');
  const specs = getSpecsForBrand(products, selectedBrand);
  return <><div className="brand-nav">{brands.map(brand => <button key={brand} className={`brand-badge ${brand === selectedBrand ? 'active' : ''}`} onClick={() => setSelectedBrand(brand)}>{brand}</button>)}</div><div className="spec-nav">{specs.map(spec => <button key={spec} className={`spec-badge ${spec === selectedSpec ? 'active' : ''}`} onClick={() => setSelectedSpec(spec)}>{spec}</button>)}</div></>;
}

function MixBoxSection({ products, lines, openKeys, setOpenKeys, updateDraft }: { products: Product[]; lines: Record<string, OrderLineDraft>; openKeys: Set<string>; setOpenKeys: (v: Set<string>) => void; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void }) {
  if (!canMixBoxList(products)) return null;
  const first = products.find(canMixBox) || products[0];
  const key = mixBoxKey(first);
  const open = openKeys.has(key);
  const qty = products.reduce((sum, product) => sum + Number(lines[productBarcode(product)]?.mixQty || 0), 0);
  const size = mixBoxSize(products);
  const selected = products.find(product => Number(lines[productBarcode(product)]?.mixQty || 0) > 0) || first;
  const price = Number(lines[productBarcode(selected)]?.mixBoxPrice || wholeDefaultPrice(selected));

  return <div className="mix-box-card"><div className="mix-box-head"><button type="button" className="mix-box-toggle" onClick={() => { const next = new Set(openKeys); next.has(key) ? next.delete(key) : next.add(key); setOpenKeys(next); }}>点击拼盒</button><span className="mix-box-count">{qty}/{size}{unitOf(first)}</span><span className="price-label">价格</span><select className="ios-picker price-picker" value={price} onChange={event => products.forEach(product => updateDraft(product, { mixBoxPrice: Number(event.target.value) }))}>{makePriceOptions(wholeDefaultPrice(first), price).map(value => <option value={value} key={value}>{value.toFixed(2)}</option>)}</select></div>{open && <div className="mix-box-panel">{products.map(product => { const barcode = productBarcode(product); const line = { ...defaultOrderLine(product), ...(lines[barcode] || {}) }; return <div className="mix-flavor-row" key={barcode}><span>{displayProductName(product)}</span><button type="button" onClick={() => updateDraft(product, { mixQty: Math.max(0, Number(line.mixQty || 0) - 1) })}>-</button><b>{Number(line.mixQty || 0)}</b><button type="button" onClick={() => updateDraft(product, { mixQty: Number(line.mixQty || 0) + 1 })}>+</button></div>; })}</div>}</div>;
}

function ProductLine({ product, line, updateDraft, updateSpecPrice, openQtyPopup }: { product: Product; line?: OrderLineDraft; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; updateSpecPrice: (product: Product, key: 'wholePrice' | 'loosePrice', value: number) => void; openQtyPopup: (state: QtyPopupState) => void }) {
  const [afterSalesOpen, setAfterSalesOpen] = useState(false);
  const current = { ...defaultOrderLine(product), ...(line || {}) };
  const barcode = productBarcode(product);
  const afterSaleQty = Number(current.afterSaleQty || 0);

  return <div className="item"><div className="prod-info"><div className="prod-name flavor-badge">{displayProductName(product)}</div><div className="pack-hint">整=扣 {packSize(product)}{unitOf(product)}</div></div><div className="control-group after-sales-group"><div className="sell-line after-sales-line" data-after-sales-bound="1"><span className="sell-tag" style={{ background: '#756676' }}>散</span><QtySelect value={Number(current.looseQty || 0)} max={100} product={product} qtyKey="looseQty" unit={unitOf(product)} label="散数" updateDraft={updateDraft} openQtyPopup={openQtyPopup} /><span className="sell-unit">{unitOf(product)}</span><span className="price-label">价格</span><select className="ios-picker price-picker" data-price-product={barcode} data-price-key="loosePrice" value={Number(current.loosePrice || 0)} onChange={event => updateSpecPrice(product, 'loosePrice', Number(event.target.value))}>{makePriceOptions(product.default_price || 0, current.loosePrice).map(value => <option value={value} key={value}>{value.toFixed(2)}</option>)}</select><span className={`after-sales-wrap ${afterSalesOpen ? 'open' : ''} ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-wrap={barcode}><button type="button" className={`after-sales-toggle ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-toggle={barcode} onClick={() => setAfterSalesOpen(open => !open)}>{afterSaleQty > 0 ? `收回${afterSaleQty}` : '收回'}</button></span></div><div className={`after-sales-panel ${afterSalesOpen ? 'open' : ''} ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-panel={barcode}><span className="after-sales-panel-label">收回数</span><QtySelect value={afterSaleQty} max={100} product={product} qtyKey="afterSaleQty" unit={unitOf(product)} label="售后数" updateDraft={updateDraft} openQtyPopup={openQtyPopup} afterSales /><span className="after-sales-note">只算能卖的，收回增加库存</span></div><div className="sell-line"><span className="sell-tag">整</span><QtySelect value={Number(current.wholeQty || 0)} max={50} product={product} qtyKey="wholeQty" unit="整" label="整数" updateDraft={updateDraft} openQtyPopup={openQtyPopup} /><span className="sell-unit">整</span><span className="price-label">价格</span><select className="ios-picker price-picker" data-price-product={barcode} data-price-key="wholePrice" value={Number(current.wholePrice || 0)} onChange={event => updateSpecPrice(product, 'wholePrice', Number(event.target.value))}>{makePriceOptions(wholeDefaultPrice(product), current.wholePrice, 0.1).map(value => <option value={value} key={value}>{value.toFixed(2)}</option>)}</select></div></div></div>;
}
type QtyKey = 'wholeQty' | 'looseQty' | 'afterSaleQty';
type QtyPopupState = { product: Product; key: QtyKey; value: number; max: number; unit: string; label: string; apply: (value: number) => void };

function QtySelect({ value, max, product, qtyKey, unit, label, updateDraft, openQtyPopup, afterSales = false }: { value: number; max: number; product: Product; qtyKey: QtyKey; unit: string; label: string; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; openQtyPopup: (state: QtyPopupState) => void; afterSales?: boolean }) {
  const barcode = productBarcode(product);
  const apply = (next: number) => updateDraft(product, { [qtyKey]: next } as Partial<OrderLineDraft>);
  const trigger = <button type="button" className={`qty-popup-trigger ${value > 0 ? 'has-value' : ''}`} aria-label="选择数量" onClick={() => openQtyPopup({ product, key: qtyKey, value, max, unit, label, apply })}>{value}</button>;
  if (afterSales) {
    return <><span className="qty-native-hidden"><select className="ios-picker after-sales-picker" data-after-sales-select={barcode} data-qty-popup-bound="1" value={value} onChange={event => apply(Number(event.target.value))}>{makeQtyOptions(max).map(option => <option value={option} key={option}>{option}</option>)}</select></span>{trigger}</>;
  }
  return <><span className="qty-native-hidden"><select className="ios-picker" data-qty-popup-bound="1" value={value} onChange={event => apply(Number(event.target.value))}>{makeQtyOptions(max).map(option => <option value={option} key={option}>{option}</option>)}</select></span>{trigger}</>;
}

function QtyPopup({ state, close }: { state: QtyPopupState | null; close: () => void }) {
  useEffect(() => {
    document.body.classList.toggle('qty-popup-open', Boolean(state));
    return () => document.body.classList.remove('qty-popup-open');
  }, [state]);
  if (!state) return <div id="qtyPopupMask" className="qty-popup-mask hide" />;
  const numbers = Array.from({ length: 25 }, (_, index) => index + 1);
  const apply = (value: number) => { state.apply(Math.max(0, Math.min(state.max, value))); close(); };
  return <div id="qtyPopupMask" className="qty-popup-mask" onClick={event => { if (event.target === event.currentTarget) close(); }}><div className="qty-popup-sheet" role="dialog" aria-modal="true" aria-labelledby="qtyPopupTitle"><div className="qty-popup-head"><div className="qty-popup-title-wrap"><div id="qtyPopupTitle" className="qty-popup-title">{displayProductName(state.product)} - {state.label}</div></div><button type="button" className="qty-popup-close" data-qty-action="close" aria-label="关闭" onClick={close}>×</button></div><div id="qtyPopupCurrent" className="qty-popup-current">当前：{state.value}{state.unit}</div><div id="qtyPopupGrid" className="qty-popup-grid qty-popup-grid-5">{numbers.map(number => <button type="button" className={`qty-popup-number ${number === state.value ? 'active' : ''}`} data-qty-value={number} disabled={number > state.max} key={number} onClick={() => apply(number)}>{number}</button>)}</div><button type="button" className="qty-popup-clear" data-qty-action="clear" onClick={() => apply(0)}>清零</button></div></div>;
}
function normalizeProducts(products: Product[]) {
  return products.map(product => ({
    ...product,
    barcode: String(product.barcode || product.id || ''),
    product_name: product.flavor || product.product_name || product.name || product.barcode,
    spec: String(product.spec || '常规').trim(),
    brand: String(product.brand || '未分类').trim(),
    unit: String(product.unit || '个').trim(),
    pcs_per_box: Number(product.pcs_per_box || 0),
    pcs_per_case: Number(product.pcs_per_case || 24),
  })).sort(compareProducts);
}

function getReportRange(preset: ReportPreset, customDate = localDate()) {
  const now = new Date();
  let start = localDate(now);
  let end = start;
  if (preset === 'custom') {
    const date = customDate || start;
    return { label: date, start: date, end: date };
  }
  if (preset === 'yesterday') {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    start = localDate(date);
    end = start;
  } else if (preset === 'week') {
    const date = new Date(now);
    const day = (now.getDay() + 6) % 7;
    date.setDate(now.getDate() - day);
    start = localDate(date);
  } else if (preset === 'month') {
    start = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (preset === 'all') {
    return { label: '全部', start: '', end: '' };
  }
  const labels: Record<ReportPreset, string> = { today: '今天', yesterday: '昨天', week: '本周', month: '本月', all: '全部', custom: customDate };
  return { label: labels[preset] || '今天', start, end };
}
function filterRows<T>(rows: T[], keyword: string, text: (row: T) => string) { const q = keyword.trim().toLowerCase(); return q ? rows.filter(row => text(row).toLowerCase().includes(q)) : rows; }
function groupItemsByOrder(items: SalesOrderItem[]) { const grouped = new Map<string, SalesOrderItem[]>(); items.forEach(item => { const key = String(item.order_no); grouped.set(key, [...(grouped.get(key) || []), item]); }); return grouped; }
function orderItemsStockMap(items: SalesOrderItem[]) {
  const map = new Map<string, number>();
  normalSaleItems(items).forEach(item => {
    const barcode = String(item.barcode || '');
    if (barcode) map.set(barcode, Number(map.get(barcode) || 0) + Number(item.qty || 0));
  });
  return map;
}

function orderItemsToDraftLines(items: SalesOrderItem[], products: Product[], afterSaleMap: Record<string, number> = {}) {
  const lines: Record<string, OrderLineDraft> = {};
  normalSaleItems(items).forEach(item => {
    const barcode = String(item.barcode || '');
    const product = products.find(row => productBarcode(row) === barcode || String(row.id) === barcode);
    if (!product) return;
    const line = lines[barcode] || defaultOrderLine(product);
    const saleUnit = String(item.sale_unit || '');
    const saleQty = Number(item.sale_qty ?? item.qty ?? 0);
    const salePrice = Number(item.sale_unit_price ?? item.unit_price ?? 0);
    if (saleUnit.includes('拼盒')) {
      line.mixQty += saleQty;
      line.mixBoxPrice = salePrice || line.mixBoxPrice;
    } else if (saleUnit.includes('整')) {
      line.wholeQty += saleQty;
      line.wholePrice = salePrice || line.wholePrice;
    } else if (item.sale_qty != null) {
      line.looseQty += saleQty;
      line.loosePrice = salePrice || line.loosePrice;
    } else {
      const qty = Number(item.qty || 0);
      line.wholeQty += Math.floor(qty / packSize(product));
      line.looseQty += qty % packSize(product);
      line.loosePrice = Number(item.unit_price || line.loosePrice);
      line.wholePrice = Number((line.loosePrice * packSize(product)).toFixed(2));
    }
    lines[barcode] = line;
  });
  Object.entries(afterSaleMap).forEach(([barcode, qty]) => {
    const returnQty = Number(qty || 0);
    if (returnQty <= 0) return;
    const product = findProductByBarcode(products, barcode);
    if (!product) return;
    const line = lines[barcode] || defaultOrderLine(product);
    line.afterSaleQty = returnQty;
    lines[barcode] = line;
  });
  return lines;
}
function groupOrderDetail(items: SalesOrderItem[], products: Product[]) {
  const grouped = new Map<string, DetailGroup>();
  normalSaleItems(items).forEach(item => {
    const product = findProductByBarcode(products, String(item.barcode || ''));
    const title = orderDetailSpec(product, item.product_name || item.barcode);
    const flavor = orderDetailFlavor(product) || item.product_name || '默认';
    const row = grouped.get(title) || { title, flavors: new Map<string, DetailFlavorRow>(), wholeQty: 0, wholePrice: 0, looseQty: 0, loosePrice: 0, amount: 0 };
    const flavorRow = row.flavors.get(flavor) || { flavor, wholeQty: 0, wholePrice: 0, looseQty: 0, loosePrice: 0 };
    const qty = Number(item.sale_qty ?? item.qty ?? 0);
    const price = Number(item.sale_unit_price ?? item.unit_price ?? 0);
    if (String(item.sale_unit || '').includes('整')) {
      row.wholeQty += qty;
      row.wholePrice = price || row.wholePrice;
      flavorRow.wholeQty += qty;
      flavorRow.wholePrice = price || flavorRow.wholePrice;
    } else {
      row.looseQty += qty;
      row.loosePrice = price || row.loosePrice;
      flavorRow.looseQty += qty;
      flavorRow.loosePrice = price || flavorRow.loosePrice;
    }
    row.amount += Number(item.amount || 0);
    row.flavors.set(flavor, flavorRow);
    grouped.set(title, row);
  });
  return Array.from(grouped.values());
}
function orderDetailPartsText(row: DetailSaleParts) {
  const parts: string[] = [];
  if (row.looseQty) parts.push(`${row.looseQty}散 × ${money(row.loosePrice)}`);
  if (row.wholeQty) parts.push(`${row.wholeQty}整 × ${money(row.wholePrice)}`);
  return parts.join(' + ') || '-';
}
function buildAfterSaleDetailRows(afterSaleMap: Record<string, number>, products: Product[]) { return Object.entries(afterSaleMap).map(([barcode, qty]) => { const product = findProductByBarcode(products, barcode); return { barcode, title: orderDetailSpec(product, product?.product_name || barcode), flavor: orderDetailFlavor(product) || product?.product_name || barcode, qty: Number(qty || 0), unit: product ? unitOf(product) : '个' }; }).filter(row => row.qty > 0) as DetailAfterSaleRow[]; }
function findProductByBarcode(products: Product[], barcode: string) { return products.find(product => productBarcode(product) === barcode || String(product.id) === barcode || String(product.barcode || '') === barcode); }
function hasLineValue(line: OrderLineDraft) { return Number(line.wholeQty || 0) > 0 || Number(line.looseQty || 0) > 0 || Number(line.mixQty || 0) > 0 || Number(line.afterSaleQty || 0) > 0; }
function hasAnySale(products: Product[], lines: Record<string, OrderLineDraft>) { return products.some(product => stockQtyFromLine(product, lines[productBarcode(product)]) > 0 || Number(lines[productBarcode(product)]?.afterSaleQty || 0) > 0); }
function stockQtyFromLine(product: Product, line?: OrderLineDraft) { return line ? Number(line.wholeQty || 0) * packSize(product) + Number(line.looseQty || 0) + Number(line.mixQty || 0) : 0; }
function draftKey(employee: Employee, store: StoreAsset) { return `${ORDER_DRAFT_PREFIX}:${employee.employee_code}:${store.atom_code}`; }
function loadDraft(key: string): StoredDraft | null { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as StoredDraft : null; } catch { return null; } }
function saveDraft(key: string, draft: StoredDraft) { try { if (Object.keys(draft.lines).length) localStorage.setItem(key, JSON.stringify(draft)); } catch { /* localStorage may be unavailable */ } }
function clearDraft(key: string) { try { localStorage.removeItem(key); } catch { /* localStorage may be unavailable */ } }
function productSortValue(product: Product) { const raw = product as Product & { sort_order?: number; db_id?: number; raw_id?: number }; const sort = Number(raw.sort_order || 0); if (Number.isFinite(sort) && sort > 0) return sort; const id = Number(raw.db_id || raw.raw_id || product.id || 0); return Number.isFinite(id) && id > 0 ? id * 10 : 999999; }
function compareProducts(a: Product, b: Product) { const d = productSortValue(a) - productSortValue(b); return d || displayProductName(a).localeCompare(displayProductName(b), 'zh-CN', { numeric: true }); }
function orderedProducts(list: Product[]) { return [...list].sort(compareProducts); }
function orderedUnique<K extends keyof Product>(list: Product[], key: K) { const seen = new Set<string>(); const out: string[] = []; orderedProducts(list).forEach(product => { const value = String(product[key] || '').trim(); if (value && !seen.has(value)) { seen.add(value); out.push(value); } }); return out; }
function getSpecsForBrand(products: Product[], brand: string) { return orderedUnique(products.filter(product => String(product.brand || '') === String(brand || '')), 'spec'); }
function displayProductName(product: Product) { return product.product_name || product.flavor || productDisplayName(product) || productBarcode(product); }
function getStoreFirstLetter(name: string) { try { const py = pinyin(name.trim().charAt(0), { pattern: 'first', toneType: 'none' }); const letter = String(py || '').charAt(0).toUpperCase(); return /[A-Z]/.test(letter) ? letter : '#'; } catch { return '#'; } }
function groupStoresByLetter(stores: StoreAsset[]) { const map = new Map<string, StoreAsset[]>(); stores.forEach(store => { const letter = getStoreFirstLetter(store.store_name); map.set(letter, [...(map.get(letter) || []), store]); }); return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([letter, rows]) => ({ letter, stores: rows })); }
function mixBoxKey(product: Product) { return `${product.brand || ''}|||${product.spec || ''}`; }
function canMixBoxList(products: Product[]) { return products.some(canMixBox) && mixBoxSize(products) > 0; }
function mixBoxSize(products: Product[]) { return Number(products.find(product => Number(product.pcs_per_box || 0) > 0)?.pcs_per_box || 0); }
function makeQtyOptions(max: number) { return Array.from({ length: max + 1 }, (_, index) => index); }
function makePriceOptions(center: number, current: number, step = 0.05) { const c = Number(center || 0); const cur = Number(current || 0); let start = Math.max(0, c - 15); let end = c + 30; if (cur < start) start = Math.max(0, cur - 1); if (cur > end) end = cur + 1; const out: number[] = []; for (let value = start; value <= end + 0.001; value += step) out.push(Number(value.toFixed(2))); return out; }
function formatQtyToUnits(totalPcs: number, specCase?: number, specBox?: number, unit = '个') {
  const sign = Number(totalPcs) < 0 ? '-' : '';
  let rest = Math.abs(Number(totalPcs) || 0);
  const caseSize = Number(specCase) || 1;
  const boxSize = Number(specBox) || 0;
  const cases = Math.floor(rest / caseSize);
  rest %= caseSize;
  if (boxSize > 0) {
    const boxes = Math.floor(rest / boxSize);
    const loose = rest % boxSize;
    return `${sign}${cases}件 ${boxes}中盒 ${loose}${unit}`;
  }
  return `${sign}${cases}件 ${rest}${unit}`;
}
function formatStockQty(total: number, product: Product) { const q = Number(total) || 0; const size = packSize(product); const whole = Math.floor(Math.abs(q) / size); const loose = Math.abs(q) % size; const sign = q < 0 ? '-' : ''; return `${sign}${whole}整 ${loose}${unitOf(product)}`; }
