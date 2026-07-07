import { useEffect, useMemo, useState } from 'react';
import { loadDashboardOrders, loadEmployees } from './lib/api';
import { money } from './lib/rules';
import type { Employee, SalesOrder } from './types';

type DashboardRange = 'today' | 'yesterday' | '7d' | 'month' | 'all';
type DashboardRangeInfo = { start: string; end: string; label: string };
type EmployeeRankRow = { code: string; name: string; total: number; count: number; last: string };

const DASHBOARD_NAV = [
  ['📍', '导入门店', '/store_import'],
  ['📦', '吉能库存', '/stock_jn'],
  ['🚚', '长湛库存', '/stock_ct'],
  ['📊', '库存管理', '/stock_summary'],
  ['🍧', '商品表', '/products'],
  ['👥', '员工表', '/employees'],
] as const;

export default function DashboardApp() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [employeeCode, setEmployeeCode] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void loadDashboard(range); }, [range]);

  async function loadDashboard(nextRange = range) {
    setLoading(true);
    setError('');
    try {
      const rangeInfo = getDashboardRange(nextRange);
      const [orderRows, employeeRows] = await Promise.all([
        loadDashboardOrders(rangeInfo.start, rangeInfo.end),
        loadEmployees(),
      ]);
      setOrders(orderRows);
      setEmployees(employeeRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const employeeMap = useMemo(() => new Map(employees.map(row => [String(row.employee_code), row])), [employees]);
  const visibleOrders = useMemo(() => employeeCode ? orders.filter(order => String(order.employee_code || '') === employeeCode) : orders, [orders, employeeCode]);
  const metrics = useMemo(() => buildDashboardMetrics(visibleOrders), [visibleOrders]);
  const rankRows = useMemo(() => buildEmployeeRankRows(visibleOrders, employeeMap), [visibleOrders, employeeMap]);
  const trendRows = useMemo(() => buildTrendRows(visibleOrders), [visibleOrders]);

  return <div className="dashboard-shell">
    <section className="dashboard-hero"><div className="dashboard-hero-main"><h1>管理后台</h1><div className="dashboard-hero-actions"><button className="dashboard-btn hero-btn" onClick={() => { window.location.href = '/'; }}>员工开单入口</button><button className="dashboard-btn hero-btn" onClick={() => loadDashboard()}>刷新数据</button></div></div></section>
    <section className="dashboard-panel dashboard-quick-panel"><div className="dashboard-nav-grid">{DASHBOARD_NAV.map(([icon, label, href]) => <button className="dashboard-nav-card" key={href} onClick={() => { window.location.href = href; }}><span className="dashboard-nav-ico">{icon}</span><strong>{label}</strong><b className="dashboard-nav-arrow">›</b></button>)}</div></section>
    <section className="dashboard-panel dashboard-filter-panel"><div className="dashboard-range-row">{(['today', 'yesterday', '7d', 'month', 'all'] as DashboardRange[]).map(value => <button key={value} className={`dashboard-range-btn ${range === value ? 'active' : ''}`} onClick={() => setRange(value)}>{dashboardRangeLabel(value)}</button>)}</div><div className="dashboard-employee-filter"><button className={`dashboard-employee-chip ${employeeCode ? '' : 'active'}`} onClick={() => setEmployeeCode('')}>全部员工</button>{employees.map(row => <button className={`dashboard-employee-chip ${employeeCode === String(row.employee_code) ? 'active' : ''}`} key={row.employee_code} onClick={() => setEmployeeCode(String(row.employee_code))}>{row.name || row.employee_code}</button>)}</div></section>
    <div className={`dashboard-status ${loading || error ? '' : 'hide'} ${error ? 'error' : ''}`}>{error || '正在加载...'}</div>
    <section className="dashboard-metric-grid"><MetricCard icon="💰" label="卖进金额" value={`¥ ${money(metrics.totalAmount)}`} /><MetricCard icon="🧾" label="卖进单据" value={String(metrics.orderCount)} /><MetricCard icon="📈" label="平均客单价" value={money(metrics.avgOrderAmount)} /></section>
    <div className="dashboard-content-grid"><section className="dashboard-panel"><div className="dashboard-panel-title"><h2>卖进趋势</h2></div><TrendChart rows={trendRows} /></section><section className="dashboard-panel"><div className="dashboard-panel-title"><h2>卖进排行</h2><button className="dashboard-btn primary" onClick={() => downloadDashboardCsv(visibleOrders, employeeMap)}>导出开单单据</button></div><RankTable rows={rankRows} /></section></div>
  </div>;
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className="dashboard-metric"><div className="dashboard-metric-head"><div className="dashboard-metric-icon">{icon}</div><div className="dashboard-metric-label">{label}</div></div><div className="dashboard-metric-value">{value}</div></div>;
}

function RankTable({ rows }: { rows: EmployeeRankRow[] }) {
  return <div className="dashboard-table-wrap"><table><thead><tr><th>排名</th><th>员工</th><th>卖进金额</th><th>单据</th><th>客单价</th><th>最近开单</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.code}><td><span className="dashboard-rank">{index + 1}</span></td><td><strong>{row.name}</strong><div className="dashboard-emp-code">{row.code}</div></td><td className="dashboard-amount">¥ {money(row.total)}</td><td>{row.count}</td><td>¥ {money(row.count ? row.total / row.count : 0)}</td><td>{formatDashboardDate(row.last)}</td></tr>) : <tr><td colSpan={6} className="dashboard-empty">暂无数据</td></tr>}</tbody></table></div>;
}

function TrendChart({ rows }: { rows: Array<[string, number]> }) {
  if (!rows.length) return <div className="dashboard-chart-wrap"><div className="dashboard-empty">暂无趋势数据</div></div>;
  const max = Math.max(...rows.map(([, value]) => value), 1);
  const points = rows.map(([date, value], index) => {
    const x = rows.length === 1 ? 360 : 44 + index * (632 / Math.max(rows.length - 1, 1));
    const y = 236 - (Number(value || 0) / max) * 212;
    return { date, value, x, y };
  });
  const polyline = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return <div className="dashboard-chart-wrap"><div className="dashboard-trend-figure" style={{ ['--trend-count' as string]: rows.length }}><svg className="dashboard-trend-line-svg" viewBox="0 0 720 260" preserveAspectRatio="xMidYMid meet"><line x1="44" y1="236" x2="676" y2="236" stroke="#e7e1e8" strokeWidth="2" /><polyline points={polyline} fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{points.map(point => <circle key={point.date} cx={point.x} cy={point.y} r="5" fill="#fff" stroke="var(--primary)" strokeWidth="4" />)}</svg><div className="dashboard-trend-axis">{points.map(point => <span key={point.date}>{point.date.slice(5)}</span>)}</div></div></div>;
}

function getDashboardRange(range: DashboardRange): DashboardRangeInfo {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'all') return { start: '', end: '', label: '全部历史' };
  if (range === 'yesterday') {
    const d = new Date(today); d.setDate(d.getDate() - 1);
    return { start: dateOnly(d), end: dateOnly(d), label: '昨日' };
  }
  if (range === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    return { start: dateOnly(d), end: dateOnly(today), label: '近 7 天' };
  }
  if (range === 'month') return { start: dateOnly(new Date(today.getFullYear(), today.getMonth(), 1)), end: dateOnly(today), label: '本月' };
  return { start: dateOnly(today), end: dateOnly(today), label: '本日' };
}

function dashboardRangeLabel(range: DashboardRange) {
  return getDashboardRange(range).label;
}

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildDashboardMetrics(orders: SalesOrder[]) {
  const totalAmount = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  return { totalAmount, orderCount: orders.length, avgOrderAmount: orders.length ? totalAmount / orders.length : 0 };
}

function buildEmployeeRankRows(orders: SalesOrder[], employeeMap: Map<string, Employee>) {
  const grouped = new Map<string, EmployeeRankRow>();
  orders.forEach(order => {
    const code = String(order.employee_code || '');
    if (!grouped.has(code)) grouped.set(code, { code, name: employeeMap.get(code)?.name || code || '-', total: 0, count: 0, last: '' });
    const row = grouped.get(code)!;
    row.total += Number(order.total_amount || 0);
    row.count += 1;
    if (!row.last || String(order.created_at || '') > row.last) row.last = String(order.created_at || '');
  });
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
}

function buildTrendRows(orders: SalesOrder[]) {
  const grouped = new Map<string, number>();
  orders.forEach(order => {
    const date = String(order.created_at || '').slice(0, 10) || '-';
    grouped.set(date, Number(grouped.get(date) || 0) + Number(order.total_amount || 0));
  });
  return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function formatDashboardDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function downloadDashboardCsv(orders: SalesOrder[], employeeMap: Map<string, Employee>) {
  if (!orders.length) { window.alert('当前筛选没有可导出的开单单据'); return; }
  const header = ['开单日期', '员工', '员工号', '门店编号', '门店', '金额', '订单号'];
  const rows = orders.map(order => [String(order.created_at || '').slice(0, 10), employeeMap.get(String(order.employee_code || ''))?.name || order.employee_code || '', order.employee_code || '', order.atom_code || order.store_atom_code || '', order.store_name || '', money(order.total_amount || 0), order.order_no || '']);
  const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `开单单据_${dateOnly(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}