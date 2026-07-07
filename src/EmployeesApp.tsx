import { useEffect, useMemo, useState } from 'react';
import { createAdminEmployee, loadEmployeeAdminData, unassignDealerEmployeeMapping, updateAdminEmployee, upsertDealerEmployeeMapping } from './lib/api';
import type { DealerEmployeeMapping, Employee } from './types';

type EmployeeAdminRow = Employee & { original_employee_code: string; customer_code: string; created_at?: string };
type EmployeePatch = Partial<Pick<EmployeeAdminRow, 'employee_code' | 'name' | 'is_active' | 'customer_code'>>;
type StatusState = { text: string; kind?: 'error' | 'ok' };

const DEALER_EMPLOYEE_MAPPINGS_TABLE = 'dealer_employee_mappings';
const EDITABLE_FIELDS: Array<keyof Pick<EmployeeAdminRow, 'employee_code' | 'name' | 'is_active'>> = ['employee_code', 'name', 'is_active'];

export default function EmployeesApp() {
  const [employees, setEmployees] = useState<EmployeeAdminRow[]>([]);
  const [mappings, setMappings] = useState<DealerEmployeeMapping[]>([]);
  const [dirty, setDirty] = useState<Record<string, EmployeePatch>>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusState>({ text: '正在加载员工...' });
  const [showNewRow, setShowNewRow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employee_code: '', name: '', customer_code: '', is_active: true });

  useEffect(() => { void refreshEmployees(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(row => {
      const blob = [row.employee_code, row.name, row.customer_code].map(value => String(value || '').toLowerCase()).join(' ');
      return !q || blob.includes(q);
    });
  }, [employees, query]);

  async function refreshEmployees() {
    setStatus({ text: '正在加载员工...' });
    setDirty({});
    setShowNewRow(false);
    try {
      const data = await loadEmployeeAdminData();
      const normalizedMappings = data.mappings.map(row => ({ ...row, customer_code: String(row.customer_code || '').trim(), employee_code: String(row.employee_code || '').trim() }));
      setMappings(normalizedMappings);
      setEmployees(data.employees.map(row => ({
        ...row,
        original_employee_code: String(row.employee_code || ''),
        is_active: row.is_active !== false,
        customer_code: getEmployeeCustomerCode(String(row.employee_code || ''), normalizedMappings),
      })));
      setStatus({ text: `共 ${data.employees.length} 条，当前显示 ${data.employees.length} 条。未保存修改 0 条。` });
    } catch (err) {
      setStatus({ text: `加载失败：${errorMessage(err)}`, kind: 'error' });
    }
  }

  function updateStatus(nextDirty = dirty, rows = filtered) {
    setStatus({ text: `共 ${employees.length} 条，当前显示 ${rows.length} 条。未保存修改 ${Object.keys(nextDirty).length} 条。` });
  }

  function markDirty(id: string | number | undefined, field: keyof EmployeePatch, value: string | boolean) {
    if (id === undefined) return;
    const normalized = field === 'is_active' ? Boolean(value) : String(value);
    if (field === 'customer_code') {
      const code = normalizeCustomerCode(String(value));
      if (code === null) { setStatus({ text: '保存失败：一个员工只能对应一个经销商客户编号。', kind: 'error' }); return; }
      setEmployees(prev => prev.map(row => String(row.id) === String(id) ? { ...row, customer_code: code } : row));
      setDirty(prev => ({ ...prev, [String(id)]: { ...(prev[String(id)] || {}), customer_code: code } }));
    } else {
      setEmployees(prev => prev.map(row => String(row.id) === String(id) ? { ...row, [field]: normalized } : row));
      setDirty(prev => ({ ...prev, [String(id)]: { ...(prev[String(id)] || {}), [field]: normalized } }));
    }
    setStatus({ text: `已修改 ${Object.keys(dirty).length + (dirty[String(id)] ? 0 : 1)} 条，记得保存。` });
  }

  function openInlineEmployeeRow() {
    setShowNewRow(true);
    setNewEmployee({ employee_code: '', name: '', customer_code: '', is_active: true });
    setStatus({ text: '请在列表最上方填写新员工，员工工号和姓名必填。' });
  }

  async function createEmployee() {
    const customerCode = normalizeCustomerCode(newEmployee.customer_code);
    if (customerCode === null) return;
    const payload = { employee_code: newEmployee.employee_code.trim(), name: newEmployee.name.trim(), is_active: newEmployee.is_active };
    if (!payload.employee_code || !payload.name) { setStatus({ text: '新增失败：员工工号和姓名不能为空。', kind: 'error' }); return; }
    setCreating(true);
    try {
      const data = await createAdminEmployee(payload);
      let nextMappings = mappings;
      if (customerCode) nextMappings = await saveMappingForEmployee(String(data.employee_code), '', customerCode, mappings);
      const row = { ...data, original_employee_code: String(data.employee_code || ''), is_active: data.is_active !== false, customer_code: customerCode } as EmployeeAdminRow;
      setMappings(nextMappings);
      setEmployees(prev => [...prev, row].sort(compareEmployeeRows));
      setShowNewRow(false);
      setStatus({ text: `已添加：${data.name || data.employee_code}`, kind: 'ok' });
    } catch (err) {
      setStatus({ text: isDuplicateEmployeeError(err) ? `新增失败：员工工号「${payload.employee_code}」已存在。` : `新增失败：${errorMessage(err)}`, kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function saveRow(id: string | number | undefined) {
    if (id === undefined) return false;
    const patch = dirty[String(id)];
    if (!patch) { setStatus({ text: '本行没有需要保存的修改。' }); return true; }
    const employee = employees.find(row => String(row.id) === String(id));
    if (!employee) { setStatus({ text: '保存失败：找不到这名员工，请刷新后再试。', kind: 'error' }); return false; }

    const cleanPatch: Partial<Pick<Employee, 'employee_code' | 'name' | 'is_active'>> = {};
    EDITABLE_FIELDS.forEach(field => { if (Object.prototype.hasOwnProperty.call(patch, field)) (cleanPatch as Record<string, unknown>)[field] = patch[field]; });
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'employee_code') && !String(cleanPatch.employee_code || '').trim()) { setStatus({ text: '保存失败：员工工号不能为空。', kind: 'error' }); return false; }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'name') && !String(cleanPatch.name || '').trim()) { setStatus({ text: '保存失败：员工姓名不能为空。', kind: 'error' }); return false; }

    const previousEmployeeCode = String(employee.original_employee_code || employee.employee_code || '').trim();
    const nextEmployeeCode = String(cleanPatch.employee_code || employee.employee_code || '').trim();
    const nextCustomerCode = Object.prototype.hasOwnProperty.call(patch, 'customer_code') ? String(patch.customer_code || '') : employee.customer_code;

    try {
      const data = Object.keys(cleanPatch).length ? await updateAdminEmployee(id, cleanPatch) : employee;
      const nextMappings = await saveMappingForEmployee(nextEmployeeCode, previousEmployeeCode, nextCustomerCode, mappings);
      setMappings(nextMappings);
      setEmployees(prev => prev.map(row => String(row.id) === String(id) ? { ...row, ...data, original_employee_code: String(data.employee_code || ''), is_active: data.is_active !== false, customer_code: getEmployeeCustomerCode(String(data.employee_code || ''), nextMappings) } : row));
      setDirty(prev => {
        const copy = { ...prev };
        delete copy[String(id)];
        updateStatus(copy);
        return copy;
      });
      setStatus({ text: `已保存：${data.name || data.employee_code}`, kind: 'ok' });
      return true;
    } catch (err) {
      setStatus({ text: isDuplicateEmployeeError(err) ? '保存失败：员工工号已存在，不能改成重复工号。' : `保存失败：${errorMessage(err)}`, kind: 'error' });
      return false;
    }
  }

  async function saveAllDirty() {
    const ids = Object.keys(dirty);
    if (!ids.length) { setStatus({ text: '没有需要保存的修改。' }); return; }
    setStatus({ text: `正在保存 ${ids.length} 条...` });
    for (const id of ids) {
      const ok = await saveRow(id);
      if (!ok) break;
    }
  }

  return <div className="employees-shell"><div className="employees-card"><div className="employees-top"><h1>员工表管理</h1><div className="employees-actions"><button className="employees-btn" onClick={() => { window.location.href = '/dashboard'; }}>← 返回管理后台</button><button className="employees-btn" onClick={() => refreshEmployees()}>刷新</button><button id="addEmployeeBtn" className="employees-btn" disabled={showNewRow || creating} onClick={openInlineEmployeeRow}>{showNewRow ? '正在添加' : '添加员工'}</button><button className="employees-btn primary" onClick={saveAllDirty}>保存修改</button></div></div><div className="employees-toolbar"><input id="globalSearch" className="employees-search" value={query} placeholder="搜索：工号 / 姓名 / 经销商客户编号" onChange={event => setQuery(event.target.value)} /><button className="employees-btn" onClick={() => setQuery('')}>清空搜索</button></div><div id="status" className={`employees-status ${status.kind || ''}`}>{status.text}</div><div className="employees-table-wrap"><table><thead><tr><th>员工工号</th><th>员工姓名</th><th>经销商客户编号</th><th>操作</th><th>启用</th></tr></thead><tbody>{showNewRow && <tr className="employees-new-row"><td><input value={newEmployee.employee_code} placeholder="必填" onChange={event => setNewEmployee(prev => ({ ...prev, employee_code: event.target.value }))} /></td><td><input value={newEmployee.name} placeholder="必填" onChange={event => setNewEmployee(prev => ({ ...prev, name: event.target.value }))} /></td><td><input className="employees-customer-code-input" value={newEmployee.customer_code} placeholder="经销商客户编号" onChange={event => setNewEmployee(prev => ({ ...prev, customer_code: event.target.value }))} /></td><td><div className="employees-inline-actions"><button className="employees-btn primary" disabled={creating} onClick={createEmployee}>提交</button><button className="employees-btn" disabled={creating} onClick={() => setShowNewRow(false)}>取消</button></div></td><td><input type="checkbox" checked={newEmployee.is_active} onChange={event => setNewEmployee(prev => ({ ...prev, is_active: event.target.checked }))} /></td></tr>}{filtered.map(row => <tr key={String(row.id || row.employee_code)}><td><input className={dirty[String(row.id)]?.employee_code !== undefined ? 'dirty' : ''} value={row.employee_code || ''} onChange={event => markDirty(row.id, 'employee_code', event.target.value)} /></td><td><input className={dirty[String(row.id)]?.name !== undefined ? 'dirty' : ''} value={row.name || ''} onChange={event => markDirty(row.id, 'name', event.target.value)} /></td><td><input className={`employees-customer-code-input ${dirty[String(row.id)]?.customer_code !== undefined ? 'dirty' : ''}`} value={row.customer_code || ''} onChange={event => markDirty(row.id, 'customer_code', event.target.value)} /></td><td><button className="employees-btn" onClick={() => saveRow(row.id)}>保存本行</button></td><td><input type="checkbox" checked={row.is_active !== false} onChange={event => markDirty(row.id, 'is_active', event.target.checked)} /></td></tr>)}</tbody></table></div></div></div>;
}

function normalizeCustomerCode(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[\s,，;；]+/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) return null;
  return parts[0] || '';
}

async function saveMappingForEmployee(nextEmployeeCode: string, previousEmployeeCode: string, nextCustomerCode: string, mappings: DealerEmployeeMapping[]) {
  const nextCode = String(nextEmployeeCode || '').trim();
  const previousCode = String(previousEmployeeCode || '').trim();
  const wantedCode = normalizeCustomerCode(nextCustomerCode);
  if (wantedCode === null) throw new Error('一个员工只能对应一个经销商客户编号。');
  const ownedBefore = mappings.filter(row => {
    const mappedCode = String(row.employee_code || '').trim();
    return mappedCode === nextCode || (previousCode && mappedCode === previousCode);
  }).map(row => String(row.customer_code || '').trim()).filter(Boolean);
  const toUnassign = ownedBefore.filter(code => code !== wantedCode);
  for (const code of toUnassign) await unassignDealerEmployeeMapping(code);
  if (wantedCode) await upsertDealerEmployeeMapping(wantedCode, nextCode);
  const nextMappings = mappings.map(row => {
    const customerCode = String(row.customer_code || '').trim();
    if (customerCode === wantedCode) return { ...row, employee_code: nextCode };
    if (toUnassign.includes(customerCode)) return { ...row, employee_code: '' };
    if (previousCode && String(row.employee_code || '').trim() === previousCode) return { ...row, employee_code: nextCode };
    return row;
  });
  if (wantedCode && !nextMappings.some(row => String(row.customer_code || '').trim() === wantedCode)) nextMappings.push({ id: null, customer_code: wantedCode, customer_name: '', employee_code: nextCode });
  return nextMappings;
}

function getEmployeeCustomerCode(employeeCode: string, mappings: DealerEmployeeMapping[]) {
  const row = mappings.find(item => String(item.employee_code || '') === String(employeeCode || ''));
  return row ? String(row.customer_code || '').trim() : '';
}
function compareEmployeeRows(a: EmployeeAdminRow, b: EmployeeAdminRow) { return String(a.employee_code || '').localeCompare(String(b.employee_code || ''), 'zh-Hans-CN', { numeric: true }); }
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }
function isDuplicateEmployeeError(error: unknown) { const text = errorMessage(error); return text.includes('employees_employee_code_key') || text.includes('duplicate key value') || text.includes('23505'); }