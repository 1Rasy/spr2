import { useEffect, useMemo, useState } from 'react';
import { countStoreOrders, createManualStore, deleteManualStore, loadEmployees, loadHistory, loadItems, loadOrderDetail, loadOrdersByEmployee, loadProducts, loadStocks, loadStores, submitOrder } from './lib/api';
import { calculateOrderTotal, canMixBox, defaultOrderLine, packSize, productBarcode, unitOf, wholeDefaultPrice } from './lib/orderPayload';
import { localDate, money, normalAmount, normalSaleItems, orderDetailFlavor, orderDetailSpec, orderHasAfterSale, productDisplayName, uniqueSkuCount } from './lib/rules';
import type { Employee, HistorySummary, OrderLineDraft, Product, ReportRow, SalesOrderItem, Screen, StoreAsset, VanStock } from './types';

const LOADING_TEXT = '正在加载..';
const ORDER_DRAFT_PREFIX = 'spr2_order_draft_v1';

type DetailState = { orderNo: string; items: SalesOrderItem[]; hasAfterSale: boolean };
type DetailGroup = { title: string; flavors: Map<string, number> };
type StoredDraft = { date: string; lines: Record<string, OrderLineDraft>; selectedBrand?: string; selectedSpec?: string; mixBoxOpenKeys?: string[] };
type StoreGroup = { letter: string; stores: StoreAsset[] };

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
  const [draftDate, setDraftDate] = useState(localDate());
  const [draftLines, setDraftLines] = useState<Record<string, OrderLineDraft>>({});
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('');
  const [mixBoxOpenKeys, setMixBoxOpenKeys] = useState<Set<string>>(new Set());

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
    if (screen === 'stores' && keyword.trim()) { setKeyword(''); return; }
    if (screen === 'stores') { setEmployee(null); setStores([]); setScreen('employees'); return; }
    if (screen === 'history') { setStore(null); setScreen('stores'); return; }
    if (screen === 'detail') { setScreen('history'); return; }
    if (screen === 'report' || screen === 'stock' || screen === 'newStore') { setScreen('stores'); return; }
    if (screen === 'order') {
      if (employee && store) clearDraft(draftKey(employee, store));
      setDraftLines({});
      setMixBoxOpenKeys(new Set());
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
      const orderNo = await submitOrder({ employeeCode: employee.employee_code, atomCode: store.atom_code, storeName: store.store_name, date: draftDate, products, lines: draftLines });
      clearDraft(draftKey(employee, store));
      setDraftLines({});
      setMixBoxOpenKeys(new Set());
      alert(`✅ 开单成功：${orderNo}`);
      await openHistory(store);
    });
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
        {screen === 'stores' && <StoreScreen keyword={keyword} stores={filteredStores} totalStores={visibleStores.length} groups={storeGroups} openHistory={openHistory} openStock={openStock} openReport={() => openReport()} openNewStoreManagement={openNewStoreManagement} />}
        {screen === 'history' && store && <HistoryScreen store={store} history={history} openOrder={openOrder} openDetail={openDetail} loading={loading} />}
        {screen === 'newStore' && <NewStoreScreen stores={stores.filter(row => String(row.atom_code).startsWith('NEW_'))} triggerCreateNewStore={triggerCreateNewStore} openHistory={openHistory} deleteNewStore={deleteNewStore} />}
        {screen === 'detail' && detail && <DetailScreen detail={detail} products={products} />}
        {screen === 'report' && <ReportScreen date={reportDate} setDate={openReport} rows={reportRows} openDetail={openDetail} />}
        {screen === 'stock' && employee && <StockScreen employee={employee} allProducts={products} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} selectedSpec={selectedSpec} setSelectedSpec={setSelectedSpec} stockMap={stockMap} />}
        {screen === 'order' && store && <OrderScreen store={store} date={draftDate} setDate={setDraftDate} allProducts={products} selectedBrand={selectedBrand} setSelectedBrand={setSelectedBrand} selectedSpec={selectedSpec} setSelectedSpec={setSelectedSpec} lines={draftLines} mixBoxOpenKeys={mixBoxOpenKeys} setMixBoxOpenKeys={setMixBoxOpenKeys} updateDraft={updateDraft} updateSpecPrice={updateSpecPrice} saveOrder={saveOrder} />}
      </div>
      <div id="alphabetSidebar" className={`alphabet-sidebar ${sidebarLetters.length ? '' : 'hide'}`}>
        {sidebarLetters.map(letter => <button key={letter} onClick={() => document.getElementById(`group_letter_${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{letter}</button>)}
      </div>
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
function HistoryScreen({ store, history, openOrder, openDetail, loading }: { store: StoreAsset; history: HistorySummary[]; openOrder: () => void; openDetail: (orderNo: string) => void; loading: boolean }) {
  const isTemp = String(store.atom_code).startsWith('NEW_');
  return <><div className="big-store-title">{store.store_name} {isTemp && <span className="new-store-badge">新门店</span>}</div><div style={{ margin: '14px 0' }}><button className="btn-new-order" onClick={openOrder}>＋ 新增单据</button></div>{history.map(row => { const date = row.created_at?.split('T')[0] || '未知日期'; return <button className="history-item history-item-compact" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><span>实收：{money(row.saleSum || 0)}</span><span>{date}</span></div><div className="history-item-actions"><div className="history-item-meta">品项数: {row.skuCount || 0} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary" type="button" onClick={event => event.stopPropagation()}>生成单据</button></div></button>; })}{!history.length && !loading && <div className="sub empty">暂无订单</div>}</>;
}

function DetailScreen({ detail, products }: { detail: DetailState; products: Product[] }) {
  const total = normalAmount(detail.items);
  const grouped = groupOrderDetail(detail.items, products);
  return <><div className="big-store-title">订单详情</div><div className="detail-action-row"><div className="detail-summary-actions"><div className="amount-summary-banner detail-amount-banner"><span><strong>实收：{money(total)}</strong></span>{detail.hasAfterSale && <b className="badge">有售后</b>}</div><button className="delivery-note-btn delivery-note-btn-primary detail-delivery-action" type="button">生成单据</button></div><div className="detail-secondary-actions"><button className="smallbtn detail-action-secondary">✏️ 修改</button><button className="smallbtn detail-danger-action">🗑️ 删除</button></div></div><div className="order-detail-list">{grouped.map(row => <div className="order-detail-row" key={row.title}><div className="order-detail-title">{row.title}</div><div className="order-detail-lines"><div className="order-detail-flavors">{Array.from(row.flavors.entries()).map(([flavor, qty]) => <div className="order-detail-flavor" key={flavor}><span>{flavor}</span><span>×{qty}</span></div>)}</div></div></div>)}</div></>;
}

function ReportScreen({ date, setDate, rows, openDetail }: { date: string; setDate: (date: string) => void; rows: ReportRow[]; openDetail: (orderNo: string) => void }) {
  const total = rows.reduce((sum, row) => sum + row.saleSum, 0);
  return <><div className="big-store-title">📈 卖进数据</div><div id="reportFilters" className="report-filter-row"><button className="smallbtn active">今天</button><div className="date-picker-wrapper"><button className="smallbtn">日期选择</button><input className="real-date-input report-date-input" type="date" value={date} onChange={event => setDate(event.target.value)} /></div></div><div id="reportSummary" className="amount-summary-banner"><span><strong>总实收：{money(total)}</strong></span></div><div id="reportRows">{rows.length === 0 ? <div className="sub empty">⚠️ 暂无报表记录</div> : rows.map(row => <button className="history-item report-history-item" key={row.order_no} onClick={() => openDetail(row.order_no)}><div className="history-item-top"><strong>{row.storeName}</strong><span>{row.orderDate}</span></div><div className="history-item-actions"><div className="history-item-meta">品项: <strong>{row.skuCount}</strong> 种</div><div className="history-detail-hint">实收：{money(row.saleSum)}</div></div></button>)}</div></>;
}

function StockScreen({ employee, allProducts, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec, stockMap }: { employee: Employee; allProducts: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void; stockMap: Map<string, number> }) {
  const brands = orderedUnique(allProducts, 'brand');
  const activeBrand = selectedBrand || brands[0] || '';
  const specs = getSpecsForBrand(allProducts, activeBrand);
  const activeSpec = specs.includes(selectedSpec) ? selectedSpec : specs[0] || '';
  const rows = orderedProducts(allProducts.filter(product => product.brand === activeBrand && product.spec === activeSpec));
  return <><div className="sub stock-employee-title">🏢 库存查看：{employee.name || employee.employee_code}</div><FilterHeader products={allProducts} selectedBrand={activeBrand} setSelectedBrand={brand => { setSelectedBrand(brand); setSelectedSpec(getSpecsForBrand(allProducts, brand)[0] || ''); }} selectedSpec={activeSpec} setSelectedSpec={setSelectedSpec} />{rows.map(product => { const total = stockMap.get(productBarcode(product)) || 0; return <div className="stock-row" key={productBarcode(product)}><div className="stock-product-name">{displayProductName(product)}</div><div className="stock-qty">当前库存量: <strong>{formatStockQty(total, product)}</strong> ({total}{unitOf(product)})</div></div>; })}</>;
}

function OrderScreen({ store, date, setDate, allProducts, selectedBrand, setSelectedBrand, selectedSpec, setSelectedSpec, lines, mixBoxOpenKeys, setMixBoxOpenKeys, updateDraft, updateSpecPrice, saveOrder }: { store: StoreAsset; date: string; setDate: (v: string) => void; allProducts: Product[]; selectedBrand: string; setSelectedBrand: (v: string) => void; selectedSpec: string; setSelectedSpec: (v: string) => void; lines: Record<string, OrderLineDraft>; mixBoxOpenKeys: Set<string>; setMixBoxOpenKeys: (v: Set<string>) => void; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; updateSpecPrice: (product: Product, key: 'wholePrice' | 'loosePrice', value: number) => void; saveOrder: () => void }) {
  const brands = orderedUnique(allProducts, 'brand');
  const activeBrand = selectedBrand || brands[0] || '';
  const specs = getSpecsForBrand(allProducts, activeBrand);
  const activeSpec = specs.includes(selectedSpec) ? selectedSpec : specs[0] || '';
  const rows = orderedProducts(allProducts.filter(product => product.brand === activeBrand && product.spec === activeSpec));
  const total = calculateOrderTotal(allProducts, lines);
  const count = allProducts.reduce((sum, product) => stockQtyFromLine(product, lines[productBarcode(product)]) > 0 ? sum + 1 : sum, 0);
  const isTemp = String(store.atom_code).startsWith('NEW_');

  return <><div className="big-store-title">{store.store_name} {isTemp && <span className="new-store-badge">新门店开单</span>}</div><div className="order-date-row"><span className="order-date-main">日期：<span id="dateText">{date}</span></span><div className="date-picker-wrapper"><button className="smallbtn order-date-action">修改日期</button><input type="date" className="real-date-input" value={date} onChange={event => setDate(event.target.value)} /></div></div><div id="liveAmountBanner" className="amount-summary-banner"><span><strong>实收：{money(total)}</strong></span><br />选购品项：{count} 款</div><FilterHeader products={allProducts} selectedBrand={activeBrand} setSelectedBrand={brand => { setSelectedBrand(brand); setSelectedSpec(getSpecsForBrand(allProducts, brand)[0] || ''); }} selectedSpec={activeSpec} setSelectedSpec={setSelectedSpec} /><MixBoxSection products={rows} lines={lines} openKeys={mixBoxOpenKeys} setOpenKeys={setMixBoxOpenKeys} updateDraft={updateDraft} />{rows.map(product => <ProductLine key={productBarcode(product)} product={product} line={lines[productBarcode(product)]} updateDraft={updateDraft} updateSpecPrice={updateSpecPrice} />)}<button className="float-submit" onClick={saveOrder}>提交账单</button></>;
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

function ProductLine({ product, line, updateDraft, updateSpecPrice }: { product: Product; line?: OrderLineDraft; updateDraft: (product: Product, patch: Partial<OrderLineDraft>) => void; updateSpecPrice: (product: Product, key: 'wholePrice' | 'loosePrice', value: number) => void }) {
  const [afterSalesOpen, setAfterSalesOpen] = useState(false);
  const current = { ...defaultOrderLine(product), ...(line || {}) };
  const barcode = productBarcode(product);
  const afterSaleQty = Number(current.afterSaleQty || 0);

  return <div className="item"><div className="prod-info"><div className="prod-name flavor-badge">{displayProductName(product)}</div><div className="pack-hint">整=扣 {packSize(product)}{unitOf(product)}</div></div><div className="control-group after-sales-group"><div className="sell-line after-sales-line" data-after-sales-bound="1"><span className="sell-tag" style={{ background: '#756676' }}>散</span><select className="ios-picker" value={Number(current.looseQty || 0)} onChange={event => updateDraft(product, { looseQty: Number(event.target.value) })}>{makeQtyOptions(100).map(value => <option value={value} key={value}>{value}</option>)}</select><span className="sell-unit">{unitOf(product)}</span><span className="price-label">价格</span><select className="ios-picker price-picker" data-price-product={barcode} data-price-key="loosePrice" value={Number(current.loosePrice || 0)} onChange={event => updateSpecPrice(product, 'loosePrice', Number(event.target.value))}>{makePriceOptions(product.default_price || 0, current.loosePrice).map(value => <option value={value} key={value}>{value.toFixed(2)}</option>)}</select><span className={`after-sales-wrap ${afterSalesOpen ? 'open' : ''} ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-wrap={barcode}><button type="button" className={`after-sales-toggle ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-toggle={barcode} onClick={() => setAfterSalesOpen(open => !open)}>{afterSaleQty > 0 ? `收回${afterSaleQty}` : '收回'}</button></span></div><div className={`after-sales-panel ${afterSalesOpen ? 'open' : ''} ${afterSaleQty > 0 ? 'has-value' : ''}`} data-after-sales-panel={barcode}><span className="after-sales-panel-label">收回数</span><select className="ios-picker after-sales-picker" data-after-sales-select={barcode} value={afterSaleQty} onChange={event => updateDraft(product, { afterSaleQty: Number(event.target.value) })}>{makeQtyOptions(100).map(value => <option value={value} key={value}>{value}</option>)}</select><span className="after-sales-note">只算能卖的，收回增加库存</span></div><div className="sell-line"><span className="sell-tag">整</span><select className="ios-picker" value={Number(current.wholeQty || 0)} onChange={event => updateDraft(product, { wholeQty: Number(event.target.value) })}>{makeQtyOptions(50).map(value => <option value={value} key={value}>{value}</option>)}</select><span className="sell-unit">整</span><span className="price-label">价格</span><select className="ios-picker price-picker" data-price-product={barcode} data-price-key="wholePrice" value={Number(current.wholePrice || 0)} onChange={event => updateSpecPrice(product, 'wholePrice', Number(event.target.value))}>{makePriceOptions(wholeDefaultPrice(product), current.wholePrice, 0.1).map(value => <option value={value} key={value}>{value.toFixed(2)}</option>)}</select></div></div></div>;
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

function filterRows<T>(rows: T[], keyword: string, text: (row: T) => string) { const q = keyword.trim().toLowerCase(); return q ? rows.filter(row => text(row).toLowerCase().includes(q)) : rows; }
function groupItemsByOrder(items: SalesOrderItem[]) { const grouped = new Map<string, SalesOrderItem[]>(); items.forEach(item => { const key = String(item.order_no); grouped.set(key, [...(grouped.get(key) || []), item]); }); return grouped; }
function groupOrderDetail(items: SalesOrderItem[], products: Product[]) { const grouped = new Map<string, DetailGroup>(); normalSaleItems(items).forEach(item => { const product = products.find(p => String(p.barcode) === String(item.barcode) || String(p.id) === String(item.barcode)); const title = orderDetailSpec(product, item.product_name || item.barcode); const flavor = orderDetailFlavor(product) || item.product_name || '默认'; const row = grouped.get(title) || { title, flavors: new Map<string, number>() }; const qty = Number(item.sale_qty ?? item.qty ?? 0); row.flavors.set(flavor, Number(row.flavors.get(flavor) || 0) + qty); grouped.set(title, row); }); return Array.from(grouped.values()); }
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
function getStoreFirstLetter(name: string) { const first = String(name || '#').trim().charAt(0).toUpperCase(); return /[A-Z]/.test(first) ? first : '#'; }
function groupStoresByLetter(stores: StoreAsset[]) { const map = new Map<string, StoreAsset[]>(); stores.forEach(store => { const letter = getStoreFirstLetter(store.store_name); map.set(letter, [...(map.get(letter) || []), store]); }); return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([letter, rows]) => ({ letter, stores: rows })); }
function mixBoxKey(product: Product) { return `${product.brand || ''}|||${product.spec || ''}`; }
function canMixBoxList(products: Product[]) { return products.some(canMixBox) && mixBoxSize(products) > 0; }
function mixBoxSize(products: Product[]) { return Number(products.find(product => Number(product.pcs_per_box || 0) > 0)?.pcs_per_box || 0); }
function makeQtyOptions(max: number) { return Array.from({ length: max + 1 }, (_, index) => index); }
function makePriceOptions(center: number, current: number, step = 0.05) { const c = Number(center || 0); const cur = Number(current || 0); let start = Math.max(0, c - 15); let end = c + 30; if (cur < start) start = Math.max(0, cur - 1); if (cur > end) end = cur + 1; const out: number[] = []; for (let value = start; value <= end + 0.001; value += step) out.push(Number(value.toFixed(2))); return out; }
function formatStockQty(total: number, product: Product) { const q = Number(total) || 0; const size = packSize(product); const whole = Math.floor(Math.abs(q) / size); const loose = Math.abs(q) % size; const sign = q < 0 ? '-' : ''; return `${sign}${whole}整 ${loose}${unitOf(product)}`; }