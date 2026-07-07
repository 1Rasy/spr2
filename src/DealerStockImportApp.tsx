import { useRef, useState } from 'react';
import { loadDealerCustomerWhitelist, upsertRawDealerOutbounds } from './lib/api';

type DealerKind = 'JN' | 'CT';
type DealerImportConfig = { prefix: DealerKind; title: string; mapText: string; hint: string; cols: Record<'order_no' | 'bill_date' | 'customer_code' | 'customer_name' | 'barcode' | 'product_name' | 'package_reg' | 'qty_piece' | 'qty_scatter', number>; required: number[] };
type DealerImportRow = { import_batch_id: string; is_processed: boolean; source_row_no: number; order_no: string; bill_date: string; customer_code: string; customer_name: string; barcode: string; product_name: string; package_reg: number; qty_piece: number; qty_scatter: number; is_triple_spec_direct: boolean; import_uid: string };
type BuildResult = { payload: DealerImportRow[]; total: number; skipBad: number; skipMap: number; skipDup: number; invalid: string[] };
type XlsxLike = { read: (data: ArrayBuffer | Uint8Array, options: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> }; utils: { sheet_to_json: (sheet: unknown, options: Record<string, unknown>) => unknown[][] } };
declare global { interface Window { XLSX?: XlsxLike } }

const DEALER_EMPLOYEE_MAPPINGS_TABLE = 'dealer_employee_mappings';
const RAW_DEALER_OUTBOUNDS_TABLE = 'raw_dealer_outbounds';
const SPECIAL_TRIPLE_SPEC: Record<string, 1> = { '6924513908032': 1, '6924513908001': 1, '6924513909244': 1, '6924513909268': 1, '6924513902283': 1, '6924513908063': 1 };
const CONFIGS: Record<DealerKind, DealerImportConfig> = {
  JN: { prefix: 'JN', title: '吉能库存导入', mapText: '固定列：A单号、C制单日期、D客户编号、E客户、G条形码、H商品名称、I包装、J件、L散', hint: 'A单号、D客户编号、G条形码', cols: { order_no: 0, bill_date: 2, customer_code: 3, customer_name: 4, barcode: 6, product_name: 7, package_reg: 8, qty_piece: 9, qty_scatter: 11 }, required: [0, 3, 6] },
  CT: { prefix: 'CT', title: '长湛库存导入', mapText: '固定列：A制单日期、C商品名称、D包装、F件、G散、Q客户编号、R客户名称、X单号、AA条形码', hint: 'X单号、Q客户编号、AA条形码', cols: { order_no: 23, bill_date: 0, customer_code: 16, customer_name: 17, barcode: 26, product_name: 2, package_reg: 3, qty_piece: 5, qty_scatter: 6 }, required: [23, 16, 26] },
};

export default function DealerStockImportApp({ kind }: { kind: DealerKind }) {
  const cfg = CONFIGS[kind];
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusText, setStatusText] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file?: File) {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') { window.alert('文件格式错误，请选择 .xlsx 或 .xls'); return; }
    setSelectedFile(file);
    setStatusText('');
    setStatusError(false);
  }

  async function startImport() {
    if (!selectedFile) return;
    setBusy(true);
    setStatus('正在解析 Excel 数据...');
    try {
      const whitelist = await loadWhitelist(setStatus);
      const rows = await readExcelRows(selectedFile);
      if (!rows.length) throw new Error('Excel 未包含任何可读取内容');
      const result = buildDealerImportRows(rows, whitelist, cfg);
      if (!result.payload.length) {
        const sample = result.invalid.length ? `\n\n无效行示例：\n${result.invalid.join('\n')}` : '';
        throw new Error(`有效行解析为0。原始数据 ${result.total} 行，未匹配白名单 ${result.skipMap} 行，无效行 ${result.skipBad} 行。请检查 ${cfg.hint} 是否在固定列。${sample}`);
      }
      setStatus(`原始数据 ${result.total} 行\n白名单命中 ${result.payload.length} 行\n跳过未匹配客户 ${result.skipMap} 行\n跳过无效行 ${result.skipBad} 行\n跳过本文件内重复 ${result.skipDup} 行\n正在写入...`);
      await upsertRawDealerOutbounds(result.payload as unknown as Array<Record<string, unknown>>);
      setStatus(`数据导入完成。\n原始数据 ${result.total} 行，实际导入/更新 ${result.payload.length} 行。`);
      window.alert(`导入成功，共处理 ${result.payload.length} 条记录`);
      setSelectedFile(null);
    } catch (err) {
      const message = `导入失败：${errorMessage(err)}`;
      setStatus(message, true);
      window.alert(message);
    } finally {
      setBusy(false);
    }
  }

  function setStatus(text: string, error = false) {
    setStatusText(text);
    setStatusError(error);
  }

  return <div className="dealer-stock-import-shell"><a className="dealer-stock-back" href="/dashboard">← 返回管理后台</a><div className="dealer-stock-card"><h2>{cfg.title}</h2><div className="dealer-stock-map"><strong>固定列：</strong>{cfg.mapText.replace('固定列：', '')}</div><div id="dropZone" className={`dealer-stock-upload ${dragOver ? 'dragover' : ''}`} onClick={() => inputRef.current?.click()} onDragEnter={event => { event.preventDefault(); setDragOver(true); }} onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={event => { event.preventDefault(); setDragOver(false); }} onDrop={event => { event.preventDefault(); setDragOver(false); pick(event.dataTransfer.files[0]); }}><div>点击选择文件，或拖拽 Excel 到这里</div><input ref={inputRef} id="excelFile" className="dealer-stock-file" type="file" accept=".xlsx,.xls" onChange={event => pick(event.target.files?.[0])} /></div>{selectedFile && <div id="fileInfo" className="dealer-stock-info">已选择文件：<span id="fileName">{selectedFile.name}</span></div>}<button id="submitBtn" className="dealer-stock-btn" disabled={!selectedFile || busy} onClick={startImport}>{busy ? '正在导入...' : '确认导入数据库'}</button>{statusText && <div id="statusMsg" className={`dealer-stock-status ${statusError ? 'error' : ''}`}>{statusText}</div>}</div></div>;
}

async function loadWhitelist(setStatus: (text: string, error?: boolean) => void) {
  setStatus('正在读取客户编号白名单...');
  const whitelist = await loadDealerCustomerWhitelist();
  if (!whitelist.size) throw new Error(`${DEALER_EMPLOYEE_MAPPINGS_TABLE} 里没有可用的客户编号白名单`);
  return whitelist;
}
async function readExcelRows(file: File) {
  if (!window.XLSX) throw new Error('Excel 组件加载失败，请刷新页面后重试');
  const workbook = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss', blankrows: false });
}
function text(value: unknown) { return value == null ? '' : String(value).trim(); }
function num(value: unknown) { const source = text(value).replace(/,/g, ''); if (!source) return 0; const n = Number(source); return Number.isFinite(n) ? n : 0; }
function keyNum(value: unknown) { const n = Number(value); return Number.isFinite(n) ? String(Math.round(n * 1000000) / 1000000) : '0'; }
function barcode(value: unknown) { const source = text(value); if (!source) return ''; if (/^[0-9]+(\.0+)?$/.test(source)) return source.replace(/\.0+$/, ''); const n = Number(source); if (Number.isFinite(n) && /e\+?/i.test(source)) return String(Math.trunc(n)); return source; }
function dateText(value: unknown) { return text(value).replace(/\//g, '-').replace(/\s+/g, ' '); }
function safe(value: unknown) { return text(value).replace(/\s+/g, ' ').replace(/[|]/g, '/'); }
function bad(value: unknown) { const source = text(value).toLowerCase(); return !source || source === 'undefined' || source === 'null'; }
function hash16(source: string) { let h1 = 0x811c9dc5; let h2 = 0x9e3779b9; for (let index = 0; index < source.length; index++) { const c = source.charCodeAt(index); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ (c + index), 1597334677); } return `i${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`; }
function importUid(row: DealerImportRow) { return hash16([safe(row.order_no), dateText(row.bill_date), safe(row.barcode), keyNum(row.qty_piece), keyNum(row.qty_scatter)].join('|')); }
function normRow(cells: unknown[], cfg: DealerImportConfig) { const row = Array.isArray(cells) ? cells : []; const first = text(row[0]); const missing = cfg.required.some(index => row[index] === undefined); if (first.includes('\t') && (row.length <= 2 || missing)) return first.split('\t'); return row; }
function any(cells: unknown[], cfg: DealerImportConfig) { return normRow(cells, cfg).some(cell => text(cell) !== ''); }
function header(cells: unknown[], cfg: DealerImportConfig) { const joined = normRow(cells, cfg).map(text).join('|').toLowerCase(); return (joined.includes('客户') || joined.includes('customer')) && (joined.includes('条形码') || joined.includes('barcode')) && (joined.includes('单号') || joined.includes('order')); }
function dataRows(rows: unknown[][], cfg: DealerImportConfig) { const list = (rows || []).map((cells, index) => ({ cells: cells || [], sourceRowNo: index + 1 })).filter(row => any(row.cells, cfg)); return list.length && header(list[0].cells, cfg) ? list.slice(1) : list; }
function makeDealerImportRow(cells: unknown[], batch: string, rowNo: number, cfg: DealerImportConfig): DealerImportRow { const row = normRow(cells, cfg); const out = { import_batch_id: batch, is_processed: false, source_row_no: rowNo, order_no: text(row[cfg.cols.order_no]), bill_date: dateText(row[cfg.cols.bill_date]), customer_code: text(row[cfg.cols.customer_code]), customer_name: text(row[cfg.cols.customer_name]), barcode: barcode(row[cfg.cols.barcode]), product_name: text(row[cfg.cols.product_name]), package_reg: num(row[cfg.cols.package_reg]), qty_piece: num(row[cfg.cols.qty_piece]), qty_scatter: num(row[cfg.cols.qty_scatter]), is_triple_spec_direct: false, import_uid: '' }; out.is_triple_spec_direct = !!SPECIAL_TRIPLE_SPEC[out.barcode]; out.import_uid = importUid(out); return out; }
function buildDealerImportRows(rows: unknown[][], whitelist: Set<string>, cfg: DealerImportConfig): BuildResult { const batch = `${cfg.prefix}_${Date.now()}`; const seen = new Set<string>(); const payload: DealerImportRow[] = []; const invalid: string[] = []; let skipBad = 0; let skipMap = 0; let skipDup = 0; const list = dataRows(rows, cfg); list.forEach(row => { const out = makeDealerImportRow(row.cells, batch, row.sourceRowNo, cfg); if (bad(out.order_no) || bad(out.barcode) || bad(out.customer_code)) { skipBad += 1; if (invalid.length < 5) invalid.push(`第${row.sourceRowNo}行：单号=${out.order_no || '空'}，客户编号=${out.customer_code || '空'}，条码=${out.barcode || '空'}`); return; } if (!whitelist.has(out.customer_code)) { skipMap += 1; return; } if (seen.has(out.import_uid)) { skipDup += 1; return; } seen.add(out.import_uid); payload.push(out); }); return { payload, total: list.length, skipBad, skipMap, skipDup, invalid }; }
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }
void RAW_DEALER_OUTBOUNDS_TABLE;