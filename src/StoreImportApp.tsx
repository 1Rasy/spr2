import { useEffect, useRef, useState } from 'react';
import { loadEmployeeCodeWhitelist, syncStoreImportAssets } from './lib/api';

type StoreImportPayload = { employee_code: string; atom_code: string; store_name: string };

const STORE_EMPLOYEE_HEADER = '门店负责人员工号';
const STORE_ATOM_HEADER = 'ATOM门店编号';
const STORE_NAME_HEADER = '门店名称';
const TEMP_UPLOAD_ASSETS_TABLE = 'temp_upload_assets';
const SYNC_AND_MASK_ASSETS_RPC = 'sync_and_mask_assets';

export default function StoreImportApp() {
  const [employeeWhitelist, setEmployeeWhitelist] = useState<Set<string>>(new Set());
  const [rawExcelRows, setRawExcelRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [status, setStatus] = useState('系统初始化中...');
  const [statusError, setStatusError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void initWhitelist(); }, []);

  async function initWhitelist() {
    try {
      const whitelist = await loadEmployeeCodeWhitelist();
      setEmployeeWhitelist(whitelist);
      if (!whitelist.size) {
        setStatus('警告：employees 表中未检测到任何员工工号');
        setStatusError(false);
        return;
      }
      setStatus(`已加载 ${whitelist.size} 位员工。`);
      setStatusError(false);
    } catch (err) {
      setStatus(`网络或系统异常: ${errorMessage(err)}`);
      setStatusError(true);
    }
  }

  async function processExcelFile(file?: File) {
    if (!file) return;
    if (!employeeWhitelist.size) { window.alert('基础白名单为空，中止操作'); return; }
    const xlsx = window.XLSX;
    if (!xlsx) { setStatus('Excel 组件加载失败，请刷新页面后重试'); setStatusError(true); return; }
    setStatus('正在解析 Excel 文件...');
    setStatusError(false);
    try {
      const workbook = xlsx.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = sheet ? xlsx.utils.sheet_to_json(sheet, {}) as unknown as Array<Record<string, unknown>> : [];
      setRawExcelRows(rows);
      setStatus(`文件解析成功，共计 ${rows.length} 行数据，等待执行导入。`);
    } catch (err) {
      setStatus(`文件解析失败：${errorMessage(err)}`);
      setStatusError(true);
    }
  }

  async function executeFrontendWash() {
    if (!rawExcelRows) return;
    setBusy(true);
    setStatus('正在解析门店数据...');
    setStatusError(false);
    try {
      const safePayloads = buildStoreImportPayloads(rawExcelRows, employeeWhitelist);
      if (!safePayloads.length) {
        setStatus('导入失败：本次文件没有可导入的门店。');
        setStatusError(true);
        window.alert('未发现可导入的门店，请检查员工工号和门店信息。');
        return;
      }
      setStatus(`正在导入 ${safePayloads.length} 家门店...`);
      await syncStoreImportAssets(safePayloads);
      setStatus(`导入成功：本次导入 ${safePayloads.length} 家门店。`);
      setStatusError(false);
      window.alert('门店导入成功。');
    } catch (err) {
      setStatus('异常：数据库同步操作失败');
      setStatusError(true);
      window.alert(`导入失败: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="store-import-shell"><div className="store-import-container"><div className="store-import-card"><h2>门店导入</h2><div id="dropZone" className={`store-import-upload ${dragOver ? 'dragover' : ''}`} onClick={() => fileRef.current?.click()} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDrop={event => { event.preventDefault(); setDragOver(false); void processExcelFile(event.dataTransfer.files[0]); }}><div>点击选择文件，或将门店 Excel 文件拖拽至此处</div><input ref={fileRef} type="file" id="excelFile" className="store-import-file" accept=".xlsx,.xls" onChange={event => void processExcelFile(event.target.files?.[0])} /></div><div id="status" className={`store-import-status ${statusError ? 'error' : ''}`}>{status}</div><button id="submitBtn" className="store-import-submit" disabled={!rawExcelRows || busy} onClick={executeFrontendWash}>{busy ? '正在导入...' : '确认导入数据'}</button></div></div></div>;
}

function buildStoreImportPayloads(rawExcelRows: Array<Record<string, unknown>>, employeeWhitelist: Set<string>) {
  const safePayloads: StoreImportPayload[] = [];
  const seenStoreCodes = new Set<string>();
  rawExcelRows.forEach(row => {
    const rawEmpCode = row[STORE_EMPLOYEE_HEADER];
    const rawStoreCode = row[STORE_ATOM_HEADER];
    const rawStoreName = row[STORE_NAME_HEADER];
    if (!rawEmpCode || !rawStoreCode || !rawStoreName) return;
    const employeeCode = String(rawEmpCode).trim().replace(/["']/g, '');
    const atomCode = String(rawStoreCode).trim().replace(/["']/g, '');
    const storeName = String(rawStoreName).trim();
    if (employeeWhitelist.has(employeeCode) && !seenStoreCodes.has(atomCode)) {
      seenStoreCodes.add(atomCode);
      safePayloads.push({ employee_code: employeeCode, atom_code: atomCode, store_name: storeName });
    }
  });
  return safePayloads;
}
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }
void TEMP_UPLOAD_ASSETS_TABLE;
void SYNC_AND_MASK_ASSETS_RPC;