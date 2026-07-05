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
        {screen !== 'employees' && (
          <div className="top-action-bar">
            <button className="back-btn" onClick={back}>返回</button>
          </div>
        )}
        {error && <div className="error">❌ {error}</div>}
        {loading && <div className="loading">{LOADING_TEXT}</div>}

        {screen === 'employees' && (
          <section>
            <div className="search-wrapper">
              <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="🔍 输入姓名或工号搜索员工" />
              {keyword && <button className="search-clear-btn visible" onClick={() => setKeyword('')}>✕</button>}
            </div>
            <div className="emp-grid">
              {filteredEmployees.map(row => (
                <button className="emp-card" key={row.employee_code} onClick={() => chooseEmployee(row)}>
                  <strong>{row.name}</strong>
                  <div className="sub">{row.employee_code}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'stores' && (
          <section>
            <div className="store-top-gates">
              <button className="btn-gate-half btn-gate-stock" onClick={openStock}>库存</button>
              <button className="btn-gate-half btn-gate-report" onClick={() => openReport()}>卖进数据</button>
              <button className="btn-gate-half btn-gate-newstore" onClick={() => alert('新门店功能后续迁移')}>新门店</button>
            </div>
            <div className="search-wrapper">
              <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜门店" />
              {keyword && <button className="search-clear-btn visible" onClick={() => setKeyword('')}>✕</button>}
            </div>
            <div className="store-container">
              {filteredStores.map(row => (
                <button className="item store-item" key={row.atom_code} onClick={() => openHistory(row)}>
                  <div className="item-main-row">
                    <div className="prod-info">
                      <div className="prod-name">{row.store_name}</div>
                      <div className="sub">{row.atom_code}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'history' && store && (
          <section>
            <div className="big-store-title">{store.store_name}</div>
            <button className="btn-new-order" onClick={openOrder}>＋ 新增单据</button>
            <div>
              {history.map(row => (
                <button className="history-item history-item-compact" key={row.order_no} onClick={() => openDetail(row.order_no)}>
                  <div className="history-item-top">
                    <span>实收：{money(row.saleSum)}</span>
                    <span>{row.created_at?.split('T')[0] || '-'}</span>
                  </div>
                  <div className="history-item-actions">
                    <div className="history-item-meta">品项数：{row.skuCount} 款 {row.hasAfterSale && <b className="badge">有售后</b>}</div>
                    <span className="delivery-note-btn delivery-note-btn-primary">生成单据</span>
                  </div>
                </button>
              ))}
              {!history.length && !loading && <div className="sub empty">暂无订单</div>}
            </div>
          </section>
        )}

        {screen === 'detail' && detail && <OrderDetail detail={detail} products={products} />}

        {screen === 'report' && (
          <section>
            <div className="big-store-title">📈 卖进数据</div>
            <div className="report-filter-row">
              <input className="report-date-real" type="date" value={reportDate} onChange={event => openReport(event.target.value)} />
              <button className="smallbtn" onClick={() => openReport(localDate())}>今天</button>
            </div>
            <div className="amount-summary-banner"><strong>总实收：{money(reportRows.reduce((sum, row) => sum + row.saleSum, 0))}</strong></div>
            <div>
              {reportRows.map(row => (
                <button className="history-item report-history-item" key={row.order_no} onClick={() => openDetail(row.order_no)}>
                  <div className="history-item-top">
                    <span>{row.storeName}</span>
                    <span>{row.orderDate}</span>
                  </div>
                  <div className="history-item-actions">
                    <div className="history-item-meta">品项数：{row.skuCount} 种 {row.hasAfterSale && <b className="badge">有售后</b>}</div>
                    <div className="history-detail-hint">实收：{money(row.saleSum)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === 'stock' && (
          <section>
            <div className="big-store-title">库存</div>
            <div className="search-wrapper">
              <input value={productKeyword} onChange={event => setProductKeyword(event.target.value)} placeholder="搜商品 / 条码" />
              {productKeyword && <button className="search-clear-btn visible" onClick={() => setProductKeyword('')}>✕</button>}
            </div>
            <div>
              {products.filter(p => !productKeyword || productDisplayName(p).includes(productKeyword) || String(p.barcode).includes(productKeyword)).slice(0, 200).map(product => (
                <div className="stock-row" key={String(product.barcode)}>
                  <strong>{productDisplayName(product)}</strong>
                  <div className="stock-qty">库存：{stockMap.get(String(product.barcode)) || 0}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {screen === 'order' && store && (
          <section>
            <div className="big-store-title">新增单据</div>
            <div className="order-date-row">
              <span className="order-date-main">日期：<input className="order-date-input" type="date" value={draftDate} onChange={event => setDraftDate(event.target.value)} /></span>
            </div>
            <div className="search-wrapper">
              <input value={productKeyword} onChange={event => setProductKeyword(event.target.value)} placeholder="搜商品 / 条码 / 口味" />
              {productKeyword && <button className="search-clear-btn visible" onClick={() => setProductKeyword('')}>✕</button>}
            </div>
            <div>
              {filteredProducts.map(product => {
                const barcode = String(product.barcode || product.id || '');
                const line = draftLines[barcode] || { barcode, looseQty: 0, loosePrice: Number(product.default_price || 0), afterSaleQty: 0 };
                return (
                  <div className="item" key={barcode}>
                    <div className="item-main-row">
                      <div className="prod-info">
                        <div className="prod-name">{orderDetailSpec(product, barcode)}</div>
                        {orderDetailFlavor(product) && <div className="flavor-badge">{orderDetailFlavor(product)}</div>}
                      </div>
                    </div>
                    <div className="control-group">
                      <div className="sell-line sell-line-react">
                        <span className="sell-tag">散</span>
                        <input className="ios-picker" type="number" inputMode="numeric" min="0" value={line.looseQty || ''} onChange={event => updateDraft(product, { looseQty: Number(event.target.value || 0) })} />
                        <span className="price-label">价格</span>
                        <input className="ios-picker price-picker" type="number" inputMode="decimal" min="0" step="0.05" value={line.loosePrice || ''} onChange={event => updateDraft(product, { loosePrice: Number(event.target.value || 0) })} />
                        <span className="after-sales-wrap"><span className="after-sales-toggle">收回</span></span>
                        <input className="ios-picker" type="number" inputMode="numeric" min="0" value={line.afterSaleQty || ''} onChange={event => updateDraft(product, { afterSaleQty: Number(event.target.value || 0) })} />
                      </div>
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
      <div className="big-store-title">订单详情</div>
      <div className="detail-action-row">
        <div className="detail-summary-actions">
          <div className="amount-summary-banner detail-amount-banner"><strong>实收：{money(total)}</strong> {detail.hasAfterSale && <b className="badge">有售后</b>}</div>
          <button className="delivery-note-btn delivery-note-btn-primary detail-delivery-action">生成单据</button>
        </div>
        <div className="detail-secondary-actions">
          <button className="smallbtn detail-action-secondary">修改</button>
          <button className="smallbtn detail-danger-action">删除</button>
        </div>
      </div>
      <div className="order-detail-list">
        {Array.from(grouped.values()).map(row => (
          <div className="order-detail-row" key={row.title}>
            <div className="order-detail-title">{row.title}</div>
            <div className="order-detail-flavors order-detail-flavors-compact">
              {Array.from(row.flavors.entries()).map(([flavor, qty]) => <div className="order-detail-flavor order-detail-flavor-compact" key={flavor}><span>{flavor}<b>x{qty}</b></span></div>)}
            </div>
            <div className="order-detail-lines"><div className="order-detail-line">卖进：<strong>{row.parts.join(' + ')}</strong></div></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default App;
