import { useEffect, useMemo, useState } from 'react';
import {
  loadEmployees,
  loadHistory,
  loadItems,
  loadOrderDetail,
  loadOrdersByEmployee,
  loadProducts,
  loadStocks,
  loadStores,
  submitOrder,
} from './lib/api';
import {
  localDate,
  money,
  normalAmount,
  normalSaleItems,
  orderDetailFlavor,
  orderDetailSpec,
  orderHasAfterSale,
  productDisplayName,
  uniqueSkuCount,
} from './lib/rules';
import type { Employee, HistorySummary, OrderLineDraft, Product, ReportRow, SalesOrderItem, Screen, StoreAsset, VanStock } from './types';

const LOADING_TEXT = '正在加载..';

type DetailState = {
  orderNo: string;
  items: SalesOrderItem[];
  hasAfterSale: boolean;
};

function App() {
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

  useEffect(() => {
    void bootstrap();
  }, []);

  async function run<T>(job: () => Promise<T>) {
    setLoading(true);
    setError('');
    try {
      return await job();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
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
      const grouped = new Map<string, SalesOrderItem[]>();
      items.forEach(item => {
        const key = String(item.order_no);
        grouped.set(key, [...(grouped.get(key) || []), item]);
      });
      setHistory(orders.map(order => {
        const orderItems = grouped.get(String(order.order_no)) || [];
        return {
          ...order,
          saleSum: normalAmount(orderItems),
          skuCount: uniqueSkuCount(orderItems),
          hasAfterSale: orderHasAfterSale(order, orderItems),
        };
      }));
      setScreen('history');
    });
  }

  async function openDetail(orderNo: string) {
    await run(async () => {
      const data = await loadOrderDetail(orderNo);
      setDetail({
        orderNo,
        items: data.items,
        hasAfterSale: orderHasAfterSale(data.order || { order_no: orderNo }, data.items),
      });
      setScreen('detail');
    });
  }

  async function openReport(date = reportDate) {
    if (!employee) return;
    await run(async () => {
      setReportDate(date);
      const orders = await loadOrdersByEmployee(employee.employee_code, date, date);
      const items = await loadItems(orders.map(o => o.order_no));
      const grouped = new Map<string, SalesOrderItem[]>();
      items.forEach(item => {
        const key = String(item.order_no);
        grouped.set(key, [...(grouped.get(key) || []), item]);
      });
      setReportRows(orders.map(order => {
        const orderItems = grouped.get(String(order.order_no)) || [];
        return {
          ...order,
          atomCode: String(order.atom_code || order.store_atom_code || ''),
          storeName: String(order.store_name || ''),
          orderDate: order.created_at ? order.created_at.split('T')[0] : '-',
          saleSum: normalAmount(orderItems),
          skuCount: uniqueSkuCount(orderItems),
          hasAfterSale: orderHasAfterSale(order, orderItems),
        };
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
    setDraftLines({});
    setDraftDate(localDate());
    setProductKeyword('');
    setScreen('order');
  }

  function back() {
    setError('');
    if (screen === 'employees') return;
    if (screen === 'stores') {
      setEmployee(null);
      setScreen('employees');
      return;
    }
    if (screen === 'history') {
      setStore(null);
      setScreen('stores');
      return;
    }
    if (screen === 'detail' || screen === 'order') {
      setScreen('history');
      return;
    }
    setScreen('stores');
  }

  function updateDraft(product: Product, patch: Partial<OrderLineDraft>) {
    const barcode = String(product.barcode || product.id || '');
    setDraftLines(prev => {
      const old = prev[barcode] || {
        barcode,
        looseQty: 0,
        loosePrice: Number(product.default_price || 0),
        afterSaleQty: 0,
      };
      const next = { ...old, ...patch };
      const shouldKeep = next.looseQty > 0 || next.afterSaleQty > 0;
      const copy = { ...prev };
      if (shouldKeep) copy[barcode] = next;
      else delete copy[barcode];
      return copy;
    });
  }

  async function saveOrder() {
    if (!employee || !store) return;
    await run(async () => {
      const orderNo = await submitOrder({
        employeeCode: employee.employee_code,
        atomCode: store.atom_code,
        storeName: store.store_name,
        date: draftDate,
        products,
        lines: draftLines,
      });
      alert(`✅ 开单成功：${orderNo}`);
      await openHistory(store);
    });
  }

  const filteredEmployees = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(row => `${row.employee_code} ${row.name}`.toLowerCase().includes(q));
  }, [employees, keyword]);

  const filteredStores = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(row => `${row.atom_code} ${row.store_name}`.toLowerCase().includes(q));
  }, [stores, keyword]);

  const filteredProducts = useMemo(() => {
    const q = productKeyword.trim().toLowerCase();
    const selected = new Set(Object.keys(draftLines));
    return products
      .filter(row => selected.has(String(row.barcode)) || !q || `${row.barcode} ${row.brand} ${row.spec} ${row.flavor} ${row.name}`.toLowerCase().includes(q))
      .slice(0, q ? 120 : 60);
  }, [products, productKeyword, draftLines]);

  const stockMap = useMemo(() => new Map(stocks.map(row => [String(row.product_barcode), Number(row.qty ?? row.stock_qty ?? 0)])), [stocks]);

  return (
    <div className="page">
      <div className="card">
        <div className="topbar">
          {screen !== 'employees' && <button className="back" onClick={back}>返回</button>}
          <div className="crumb">{employee?.name || 'SPR2'}</div>
        </div>
        {error && <div className="error">❌ {error}</div>}
        {loading && <div className="loading">{LOADING_TEXT}</div>}

        {screen === 'employees' && (
          <section>
            <input className="search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="🔍 输入姓名或工号搜索员工" />
            <div className="grid two">
              {filteredEmployees.map(row => (
                <button className="tile" key={row.employee_code} onClick={() => chooseEmployee(row)}>
                  <strong>{row.name}</strong>
                  <span>{row.employee_code}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'stores' && (
          <section>
            <div className="actions">
              <button onClick={() => openReport()}>卖进数据</button>
              <button onClick={openStock}>库存</button>
            </div>
            <input className="search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜门店" />
            <div className="list">
              {filteredStores.map(row => (
                <button className="row" key={row.atom_code} onClick={() => openHistory(row)}>
                  <strong>{row.store_name}</strong>
                  <span>{row.atom_code}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'history' && store && (
          <section>
            <h1>{store.store_name}</h1>
            <div className="actions"><button className="primary" onClick={openOrder}>＋ 新增单据</button></div>
            <div className="list">
              {history.map(row => (
                <button className="order-card" key={row.order_no} onClick={() => openDetail(row.order_no)}>
                  <div className="between"><strong>实收：{money(row.saleSum)}</strong><span>{row.created_at?.split('T')[0] || '-'}</span></div>
                  <div className="between muted"><span>品项数：{row.skuCount} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</span><span>生成单据</span></div>
                </button>
              ))}
              {!history.length && !loading && <div className="empty">暂无订单</div>}
            </div>
          </section>
        )}

        {screen === 'detail' && detail && <OrderDetail detail={detail} products={products} />}

        {screen === 'report' && (
          <section>
            <h1>卖进数据</h1>
            <div className="date-filter">
              <input type="date" value={reportDate} onChange={event => openReport(event.target.value)} />
              <button onClick={() => openReport(localDate())}>今天</button>
            </div>
            <div className="amount">总实收：{money(reportRows.reduce((sum, row) => sum + row.saleSum, 0))}</div>
            <div className="list">
              {reportRows.map(row => (
                <button className="order-card" key={row.order_no} onClick={() => openDetail(row.order_no)}>
                  <div className="between"><strong>{row.storeName}</strong><span>{row.orderDate}</span></div>
                  <div className="between muted"><span>品项数：{row.skuCount} 种 {row.hasAfterSale && <b className="badge">有售后</b>}</span><span>实收：{money(row.saleSum)}</span></div>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'stock' && (
          <section>
            <h1>库存</h1>
            <input className="search" value={productKeyword} onChange={event => setProductKeyword(event.target.value)} placeholder="搜商品 / 条码" />
            <div className="list">
              {products.filter(p => !productKeyword || productDisplayName(p).includes(productKeyword) || String(p.barcode).includes(productKeyword)).slice(0, 200).map(product => (
                <div className="stock-row" key={String(product.barcode)}>
                  <span>{productDisplayName(product)}</span>
                  <strong>{stockMap.get(String(product.barcode)) || 0}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {screen === 'order' && store && (
          <section>
            <h1>新增单据</h1>
            <label className="field">日期<input type="date" value={draftDate} onChange={event => setDraftDate(event.target.value)} /></label>
            <input className="search" value={productKeyword} onChange={event => setProductKeyword(event.target.value)} placeholder="搜商品 / 条码 / 口味" />
            <div className="list product-list">
              {filteredProducts.map(product => {
                const barcode = String(product.barcode || product.id || '');
                const line = draftLines[barcode] || { barcode, looseQty: 0, loosePrice: Number(product.default_price || 0), afterSaleQty: 0 };
                return (
                  <div className="product" key={barcode}>
                    <div><strong>{orderDetailSpec(product, barcode)}</strong><span>{orderDetailFlavor(product)}</span></div>
                    <div className="inputs">
                      <label>散<input type="number" inputMode="numeric" min="0" value={line.looseQty || ''} onChange={event => updateDraft(product, { looseQty: Number(event.target.value || 0) })} /></label>
                      <label>价<input type="number" inputMode="decimal" min="0" step="0.05" value={line.loosePrice || ''} onChange={event => updateDraft(product, { loosePrice: Number(event.target.value || 0) })} /></label>
                      <label>收回<input type="number" inputMode="numeric" min="0" value={line.afterSaleQty || ''} onChange={event => updateDraft(product, { afterSaleQty: Number(event.target.value || 0) })} /></label>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="float-submit" onClick={saveOrder}>提交账单 · {money(Object.values(draftLines).reduce((sum, line) => sum + Number(line.looseQty || 0) * Number(line.loosePrice || 0), 0))}</button>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderDetail({ detail, products }: { detail: DetailState; products: Product[] }) {
  const normal = normalSaleItems(detail.items);
  const grouped = new Map<string, { title: string; amount: number; parts: string[]; flavors: Map<string, number> }>();
  normal.forEach(item => {
    const product = products.find(p => String(p.barcode) === String(item.barcode) || String(p.id) === String(item.barcode));
    const title = orderDetailSpec(product, item.product_name || item.barcode);
    const flavor = orderDetailFlavor(product) || item.product_name || item.barcode;
    const row = grouped.get(title) || { title, amount: 0, parts: [], flavors: new Map<string, number>() };
    const qty = Number(item.sale_qty ?? item.qty ?? 0);
    const unit = String(item.sale_unit || '散');
    const price = Number(item.sale_unit_price ?? item.unit_price ?? 0);
    row.amount += Number(item.amount || 0);
    row.parts.push(`${qty}${unit === '拼盒' ? '散' : unit} × ${money(unit === '拼盒' && qty ? Number(item.amount || 0) / qty : price)}`);
    row.flavors.set(flavor, Number(row.flavors.get(flavor) || 0) + qty);
    grouped.set(title, row);
  });
  const total = normalAmount(detail.items);
  return (
    <section>
      <h1>订单详情</h1>
      <div className="amount">实收：{money(total)} {detail.hasAfterSale && <b className="badge">有售后</b>}</div>
      <div className="actions compact"><button>修改</button><button className="danger">删除</button><button className="black">生成单据</button></div>
      <div className="list">
        {Array.from(grouped.values()).map(row => (
          <div className="detail-row" key={row.title}>
            <strong>{row.title}</strong>
            {Array.from(row.flavors.entries()).map(([flavor, qty]) => <span className="flavor" key={flavor}>{flavor} x{qty}</span>)}
            <small>卖进：{row.parts.join(' + ')}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export default App;
