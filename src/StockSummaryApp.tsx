import { useEffect, useMemo, useRef, useState } from 'react';
import { loadStockSummaryData, upsertStockRows } from './lib/api';
import type { Employee, Product, VanStock } from './types';

type StockProductInfo = { title: string; pcs_per_case: number; pcs_per_box: number; unit: string; sort_order: number; id?: number | string };
type StockItem = VanStock & { product: StockProductInfo; qty: number };
type StockEmployeeRow = { employee_code: string; name: string; is_active: boolean; itemCount: number; negativeCount: number; totalQty: number; lastUpdated: string; items: StockItem[] };
type StatusState = { text: string; kind?: 'error' | 'ok' };
type ParsedStockImportRow = { line: number; employee_code: string; product_barcode: string; qty: number };
type XlsxLike = { read: (data: ArrayBuffer, options: { type: 'array'; cellDates?: boolean }) => { SheetNames: string[]; Sheets: Record<string, unknown> }; utils: { sheet_to_json: (sheet: unknown, options: { header: 1; raw: false; defval: string }) => unknown[][] } };
declare global { interface Window { XLSX?: XlsxLike } }

const VAN_STOCKS_TABLE = 'van_stocks';

export default function StockSummaryApp() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stocks, setStocks] = useState<VanStock[]>([]);
  const [query, setQuery] = useState('');
  const [expandedEmployee, setExpandedEmployee] = useState('');
  const [onlyNonZero, setOnlyNonZero] = useState(true);
  const [status, setStatus] = useState<StatusState>({ text: '正在加载库存...' });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadAll(); }, []);

  const employeeMap = useMemo(() => new Map(employees.map(row => [String(row.employee_code || ''), row])), [employees]);
  const productMap = useMemo(() => new Map(products.map(row => [String(row.barcode || ''), row])), [products]);
  const rows = useMemo(() => buildRows(stocks, employeeMap, productMap, query, onlyNonZero), [stocks, employeeMap, productMap, query, onlyNonZero]);
  const negativeRows = useMemo(() => stocks.filter(row => Number(row.qty || 0) < 0), [stocks]);
  const totalEmployees = useMemo(() => new Set(stocks.map(row => String(row.employee_code || '')).filter(Boolean)).size, [stocks]);

  async function loadAll() {
    setStatus({ text: '正在加载库存...' });
    try {
      const data = await loadStockSummaryData();
      setStocks(data.stocks);
      setEmployees(data.employees);
      setProducts(data.products);
      setStatus({ text: '' });
    } catch (err) {
      setStatus({ text: `库存加载失败：${errorMessage(err)}`, kind: 'error' });
    }
  }

  function exportEmployeeStocks() {
    const csvRows = [['员工名字', '员工号', '商品名', '条码', '库存散数']];
    rows.forEach(row => row.items.forEach(item => csvRows.push([row.name || '', row.employee_code, item.product.title, String(item.product_barcode || ''), String(item.qty)])));
    const csv = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `库存管理_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importStockExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setStatus({ text: '正在读取 Excel...' });
      const rows = await readStockImportFile(file);
      const { parsed, errors } = parseStockImportRows(rows);
      if (errors.length) { setStatus({ text: `导入已取消：Excel 格式有错误\n${errors.slice(0, 6).join('\n')}`, kind: 'error' }); return; }
      if (!parsed.length) { setStatus({ text: '没有读取到库存数据。请确认 A列员工编号、B列条码、C列散数。', kind: 'error' }); return; }
      const validEmployees = new Set(employees.map(row => String(row.employee_code || '')));
      const validProducts = new Set(products.map(row => String(row.barcode || '')));
      const missingEmployees = Array.from(new Set(parsed.map(row => row.employee_code).filter(code => !validEmployees.has(code))));
      const missingProducts = Array.from(new Set(parsed.map(row => row.product_barcode).filter(code => !validProducts.has(code))));
      if (missingEmployees.length || missingProducts.length) {
        setStatus({ text: `导入已取消：存在员工编号或条码未建档${missingEmployees.length ? `\n员工编号不存在：${missingEmployees.slice(0, 20).join('、')}` : ''}${missingProducts.length ? `\n商品条码不存在：${missingProducts.slice(0, 20).join('、')}` : ''}`, kind: 'error' });
        return;
      }
      const merged = new Map<string, { employee_code: string; product_barcode: string; qty: number; updated_at: string }>();
      parsed.forEach(row => merged.set(`${row.employee_code}|${row.product_barcode}`, { employee_code: row.employee_code, product_barcode: row.product_barcode, qty: row.qty, updated_at: new Date().toISOString() }));
      await upsertStockRows(Array.from(merged.values()));
      await loadAll();
      setStatus({ text: `导入完成：写入 ${merged.size} 条库存。`, kind: 'ok' });
    } catch (err) {
      setStatus({ text: `库存导入失败：${errorMessage(err)}`, kind: 'error' });
    } finally {
      event.target.value = '';
    }
  }

  return <div className="stock-summary-shell"><div className="stock-summary-card"><div className="stock-summary-top"><div><h1>库存管理</h1><div className="stock-summary-sub">导入格式：A列员工编号，B列条码，C列库存散数；散数可以为负数。导入会按“员工编号+条码”覆盖库存。</div></div><div className="stock-summary-actions"><button className="stock-summary-btn" onClick={() => { window.location.href = '/dashboard'; }}>返回管理看板</button><button className="stock-summary-btn" onClick={() => fileRef.current?.click()}>导入库存</button><button className="stock-summary-btn" onClick={exportEmployeeStocks}>导出</button><button className="stock-summary-btn primary" onClick={() => loadAll()}>刷新</button><input ref={fileRef} id="stockImportFile" type="file" accept=".xlsx,.xls,.csv" className="hide" onChange={importStockExcel} /></div></div><div className="stock-summary-filters"><input id="searchInput" className="stock-summary-input" value={query} placeholder="搜索员工/工号/商品/条码" onChange={event => setQuery(event.target.value)} /><button className="stock-summary-btn" onClick={() => setQuery('')}>清空搜索</button><button id="onlyNonZeroBtn" className={`stock-summary-btn ${onlyNonZero ? 'primary' : ''}`} onClick={() => setOnlyNonZero(prev => !prev)}>{onlyNonZero ? '只看非零库存' : '显示零库存行'}</button></div>{status.text && <div id="status" className={`stock-summary-status ${status.kind || ''}`}>{status.text}</div>}</div><div className="stock-summary-metric-grid"><div className="stock-summary-metric"><div className="label">有库存员工</div><div className="value">{totalEmployees}</div><div className="hint">当前筛选显示 {rows.length} 人</div></div><div className="stock-summary-metric"><div className="label">负数异常</div><div className="value">{negativeRows.length}</div></div></div><div className="stock-summary-card"><h2>员工库存汇总</h2><div className="stock-summary-table-wrap"><table><thead><tr><th>展开</th><th>员工</th><th>有库存品项</th><th>总散数</th><th>负数品项</th><th>最近更新时间</th></tr></thead><tbody>{rows.length ? rows.map(row => <StockEmployeeRows key={row.employee_code} row={row} open={expandedEmployee === row.employee_code} toggle={() => setExpandedEmployee(prev => prev === row.employee_code ? '' : row.employee_code)} />) : <tr><td colSpan={6}><div className="stock-summary-empty">暂无库存数据</div></td></tr>}</tbody></table></div></div></div>;
}

function StockEmployeeRows({ row, open, toggle }: { row: StockEmployeeRow; open: boolean; toggle: () => void }) {
  return <><tr className="stock-summary-clickable" onClick={toggle}><td><span className="stock-summary-pill">{open ? '收起' : '展开'}</span></td><td><strong>{row.name || row.employee_code}</strong>{!row.is_active && <div className="stock-summary-sub">已停用</div>}</td><td className="stock-summary-amount">{row.itemCount}</td><td className="stock-summary-amount">{formatInteger(row.totalQty)}</td><td>{row.negativeCount ? <span className="stock-summary-pill warn">{row.negativeCount}</span> : '0'}</td><td>{formatDate(row.lastUpdated)}</td></tr>{open && <tr className="stock-summary-detail-row"><td colSpan={6}><div className="stock-summary-detail-box"><div className="stock-summary-detail-title"><strong>{row.name || row.employee_code} 的库存明细</strong></div><div className="stock-summary-table-wrap"><table className="stock-summary-detail-table"><thead><tr><th>商品</th><th>条码</th><th>库存散数</th><th>换算显示</th><th>箱规</th><th>盒规</th><th>更新时间</th></tr></thead><tbody>{row.items.map(item => <tr key={`${row.employee_code}-${item.product_barcode}`}><td><span className="stock-summary-detail-product">{item.product.title}</span></td><td>{item.product_barcode}</td><td className={item.qty < 0 ? 'stock-summary-qty-negative' : item.qty === 0 ? 'stock-summary-qty-zero' : 'stock-summary-amount'}>{formatInteger(item.qty)}</td><td>{formatStockUnits(item.qty, item.product)}</td><td>{item.product.pcs_per_case || '-'}</td><td>{item.product.pcs_per_box || '-'}</td><td>{formatDate(String(item.updated_at || ''))}</td></tr>)}</tbody></table></div></div></td></tr>}</>;
}

function buildRows(stocks: VanStock[], employeeMap: Map<string, Employee>, productMap: Map<string, Product>, query: string, onlyNonZero: boolean) {
  const search = query.trim().toLowerCase();
  const grouped = new Map<string, StockEmployeeRow>();
  stocks.forEach(stock => {
    const code = String(stock.employee_code || '');
    const barcode = String(stock.product_barcode || '');
    const amount = Number(stock.qty ?? stock.stock_qty ?? 0);
    if (onlyNonZero && amount === 0) return;
    const employee = employeeMap.get(code) || { employee_code: code, name: '' };
    const product = productDisplay(barcode, productMap);
    const haystack = [code, employee.name, barcode, product.title].join(' ').toLowerCase();
    if (search && !haystack.includes(search)) return;
    if (!grouped.has(code)) grouped.set(code, { employee_code: code, name: employee.name || '', is_active: employee.is_active !== false, itemCount: 0, negativeCount: 0, totalQty: 0, lastUpdated: '', items: [] });
    const row = grouped.get(code)!;
    row.itemCount += 1;
    row.totalQty += amount;
    if (amount < 0) row.negativeCount += 1;
    if (!row.lastUpdated || String(stock.updated_at || '') > String(row.lastUpdated)) row.lastUpdated = String(stock.updated_at || '');
    row.items.push({ ...stock, product, qty: amount });
  });
  return Array.from(grouped.values()).map(row => ({ ...row, items: row.items.sort((a, b) => a.product.sort_order - b.product.sort_order || String(a.product_barcode).localeCompare(String(b.product_barcode), 'zh-CN', { numeric: true })) })).sort((a, b) => b.totalQty - a.totalQty || b.itemCount - a.itemCount || String(a.employee_code).localeCompare(String(b.employee_code), 'zh-CN', { numeric: true }));
}

function productDisplay(barcode: string, productMap: Map<string, Product>): StockProductInfo {
  const product = productMap.get(String(barcode || ''));
  if (!product) return { title: String(barcode || '未知条码'), pcs_per_case: 0, pcs_per_box: 0, unit: '个', sort_order: 999999 };
  return { title: product.name || product.product_name || barcode, pcs_per_case: Number(product.pcs_per_case || 0), pcs_per_box: Number(product.pcs_per_box || 0), unit: product.unit || '个', sort_order: productSortValue(product), id: product.id };
}
function productSortValue(product: Product) { const sort = Number((product as Product & { sort_order?: number }).sort_order || 0); if (Number.isFinite(sort) && sort > 0) return sort; const id = Number(product.id || 0); return Number.isFinite(id) && id > 0 ? id * 10 : 999999; }
function formatStockUnits(totalPcs: number, product: StockProductInfo) { const pcs = Number(totalPcs || 0); const caseSize = Number(product.pcs_per_case || 0); const boxSize = Number(product.pcs_per_box || 0); const unit = product.unit || '个'; if (caseSize <= 0) return `${formatInteger(pcs)}${unit}`; const sign = pcs < 0 ? '-' : ''; let rest = Math.abs(pcs); const cases = Math.floor(rest / caseSize); rest %= caseSize; if (boxSize > 0) { const boxes = Math.floor(rest / boxSize); const loose = rest % boxSize; return `${sign}${cases}件 ${boxes}盒 ${loose}${unit}`; } return `${sign}${cases}件 ${rest}${unit}`; }
function formatInteger(value: number) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
function formatDate(value: string) { if (!value) return '-'; const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value).slice(0, 16); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
function normalizeImportText(value: unknown) { return String(value ?? '').replace(/\u00a0/g, ' ').trim(); }
function normalizeImportCode(value: unknown) { const text = normalizeImportText(value); return /^\d+\.0$/.test(text) ? text.replace(/\.0$/, '') : text; }
function parseImportQty(value: unknown) { const text = normalizeImportText(value).replace(/,/g, ''); if (text === '') return Number.NaN; return Number(text); }
function parseStockImportRows(rows: unknown[][]) { const parsed: ParsedStockImportRow[] = []; const errors: string[] = []; rows.forEach((row, index) => { const line = index + 1; const employeeCode = normalizeImportCode(row[0]); const barcode = normalizeImportCode(row[1]); const qty = parseImportQty(row[2]); const blank = !employeeCode && !barcode && !normalizeImportText(row[2]); if (blank) return; const header = line === 1 && /员工|employee/i.test(employeeCode) && /条码|barcode/i.test(barcode); if (header) return; if (!employeeCode || !barcode || !Number.isFinite(qty) || !Number.isInteger(qty)) { errors.push(`第 ${line} 行格式错误：A列员工编号、B列条码、C列整数散数都不能为空`); return; } parsed.push({ line, employee_code: employeeCode, product_barcode: barcode, qty }); }); return { parsed, errors }; }
async function readStockImportFile(file: File) {
  if (window.XLSX && /\.(xlsx|xls)$/i.test(file.name)) {
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }
  const text = await file.text();
  return text.split(/\r?\n/).map(line => line.split(/,|\t/));
}
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }