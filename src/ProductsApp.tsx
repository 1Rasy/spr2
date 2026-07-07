import { useEffect, useMemo, useState } from 'react';
import { createAdminProduct, loadAdminProducts, updateAdminProduct } from './lib/api';
import type { Product } from './types';

type ProductAdminRow = Product & { sort_order?: number | null; created_at?: string };
type ProductPatch = Partial<ProductAdminRow>;
type ProductFilterField = 'is_active' | 'allow_mix_box' | 'barcode' | 'name' | 'brand' | 'spec' | 'flavor' | 'default_price' | 'pcs_per_case' | 'pcs_per_box' | 'unit';
type StatusState = { text: string; kind?: 'error' | 'ok' };

const EDITABLE_PRODUCT_FIELDS: Array<keyof ProductAdminRow> = ['sort_order', 'barcode', 'name', 'brand', 'spec', 'flavor', 'default_price', 'pcs_per_case', 'pcs_per_box', 'unit', 'allow_mix_box', 'is_active'];
const FILTER_FIELDS: ProductFilterField[] = ['is_active', 'allow_mix_box', 'barcode', 'name', 'brand', 'spec', 'flavor', 'default_price', 'pcs_per_case', 'pcs_per_box', 'unit'];
const FILTER_LABELS: Record<ProductFilterField, string> = { is_active: '启用', allow_mix_box: '拼盒', barcode: '条形码', name: '商品名称', brand: '品牌', spec: '规格', flavor: '口味/简称', default_price: '默认散件价', pcs_per_case: '件装数', pcs_per_box: '盒装数', unit: '散件单位' };
const emptyProduct = { barcode: '', name: '', brand: '', spec: '', flavor: '', default_price: 0, pcs_per_case: 1, pcs_per_box: 0, unit: '个', allow_mix_box: false, is_active: true };

export default function ProductsApp() {
  const [products, setProducts] = useState<ProductAdminRow[]>([]);
  const [dirty, setDirty] = useState<Record<string, ProductPatch>>({});
  const [query, setQuery] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<ProductFilterField, Set<string> | null>>(() => Object.fromEntries(FILTER_FIELDS.map(field => [field, null])) as Record<ProductFilterField, Set<string> | null>);
  const [openFilter, setOpenFilter] = useState<ProductFilterField | ''>('');
  const [filterSearchText, setFilterSearchText] = useState('');
  const [showNewRow, setShowNewRow] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProduct);
  const [creating, setCreating] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [selectedSortIds, setSelectedSortIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusState>({ text: '正在加载商品...' });

  useEffect(() => { void refreshProducts(); }, []);

  const sortedProducts = useMemo(() => [...products].sort(compareProducts), [products]);
  const filtered = useMemo(() => sortedProducts.filter(product => productMatches(product, query, columnFilters)), [sortedProducts, query, columnFilters]);

  async function refreshProducts() {
    setStatus({ text: '正在加载商品...' });
    setDirty({});
    setSelectedSortIds(new Set());
    setShowNewRow(false);
    setOpenFilter('');
    try {
      const rows = await loadAdminProducts();
      setProducts(rows.map(row => ({ ...row, sort_order: Number((row as ProductAdminRow).sort_order || 0), unit: row.unit || '个' })));
      setStatus({ text: `共 ${rows.length} 条，当前筛选 ${rows.length} 条。已选择排序 0 条。未保存修改 0 条。` });
    } catch (err) {
      setStatus({ text: `加载失败：${errorMessage(err)}。如果提示 sort_order 不存在，请先给 products 表添加 sort_order 字段。`, kind: 'error' });
    }
  }

  function markDirty(id: string | number | undefined, field: keyof ProductAdminRow, value: string | number | boolean) {
    if (id === undefined) return;
    let normalized: unknown = value;
    if (['sort_order', 'default_price', 'pcs_per_case', 'pcs_per_box'].includes(String(field))) normalized = value === '' ? null : Number(value);
    if (field === 'is_active' || field === 'allow_mix_box') normalized = Boolean(value);
    setProducts(prev => prev.map(row => String(row.id) === String(id) ? { ...row, [field]: normalized } : row));
    setDirty(prev => ({ ...prev, [String(id)]: { ...(prev[String(id)] || {}), [field]: normalized } }));
    setStatus({ text: `已修改 ${Object.keys(dirty).length + (dirty[String(id)] ? 0 : 1)} 条，记得保存。` });
  }

  function openInlineProductRow() {
    setShowNewRow(true);
    setNewProduct(emptyProduct);
    setStatus({ text: '请在列表最上方填写新商品，条形码和商品名称必填。' });
  }

  async function createProduct() {
    const payload: Partial<ProductAdminRow> = {
      ...newProduct,
      barcode: newProduct.barcode.trim(),
      name: newProduct.name.trim(),
      product_name: newProduct.name.trim(),
      brand: newProduct.brand.trim(),
      spec: newProduct.spec.trim(),
      flavor: newProduct.flavor.trim(),
      unit: newProduct.unit.trim() || '个',
      sort_order: products.length ? Math.max(...products.map(productSortValue)) + 10 : 10,
    };
    if (!payload.barcode || !payload.name) { setStatus({ text: '新增失败：条形码和商品名称不能为空。', kind: 'error' }); return; }
    setCreating(true);
    try {
      const data = await createAdminProduct(payload);
      setProducts(prev => [...prev, { ...data, sort_order: Number((data as ProductAdminRow).sort_order || payload.sort_order || 0), unit: data.unit || '个' }].sort(compareProducts));
      setShowNewRow(false);
      setStatus({ text: `已添加：${data.name || data.product_name || data.barcode}`, kind: 'ok' });
    } catch (err) {
      setStatus({ text: `新增失败：${errorMessage(err)}`, kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function saveRow(id: string | number | undefined) {
    if (id === undefined) return false;
    const patch = dirty[String(id)];
    if (!patch) { setStatus({ text: '本行没有需要保存的修改。' }); return true; }
    const cleanPatch: ProductPatch = {};
    EDITABLE_PRODUCT_FIELDS.forEach(field => { if (Object.prototype.hasOwnProperty.call(patch, field)) (cleanPatch as Record<string, unknown>)[field] = patch[field]; });
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'barcode') && !String(cleanPatch.barcode || '').trim()) { setStatus({ text: '保存失败：条形码不能为空。', kind: 'error' }); return false; }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'name') && !String(cleanPatch.name || '').trim()) { setStatus({ text: '保存失败：商品名称不能为空。', kind: 'error' }); return false; }
    if (cleanPatch.name && !cleanPatch.product_name) cleanPatch.product_name = String(cleanPatch.name);
    try {
      const data = await updateAdminProduct(id, cleanPatch);
      setProducts(prev => prev.map(row => String(row.id) === String(id) ? { ...row, ...data, sort_order: Number((data as ProductAdminRow).sort_order || 0), unit: data.unit || '个' } : row));
      setDirty(prev => { const copy = { ...prev }; delete copy[String(id)]; return copy; });
      setStatus({ text: `已保存：${data.name || data.product_name || data.barcode}`, kind: 'ok' });
      return true;
    } catch (err) {
      setStatus({ text: `保存失败：${errorMessage(err)}`, kind: 'error' });
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

  function moveSelectedSortRows(action: 'top' | 'up' | 'down' | 'bottom') {
    const selected = selectedSortIds;
    if (!selected.size) { setStatus({ text: '请先勾选需要排序的商品。', kind: 'error' }); return; }
    const ordered = [...sortedProducts];
    let next = ordered;
    if (action === 'top' || action === 'bottom') {
      const moving = ordered.filter(row => selected.has(String(row.id)));
      const rest = ordered.filter(row => !selected.has(String(row.id)));
      next = action === 'top' ? [...moving, ...rest] : [...rest, ...moving];
    } else {
      next = [...ordered];
      const indexes = ordered.map((row, index) => selected.has(String(row.id)) ? index : -1).filter(index => index >= 0);
      const walking = action === 'up' ? indexes : indexes.reverse();
      walking.forEach(index => {
        const swap = action === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= next.length || selected.has(String(next[swap].id))) return;
        [next[index], next[swap]] = [next[swap], next[index]];
      });
    }
    const patched = next.map((row, index) => ({ ...row, sort_order: (index + 1) * 10 }));
    setProducts(patched);
    setDirty(prev => {
      const copy = { ...prev };
      patched.forEach(row => { copy[String(row.id)] = { ...(copy[String(row.id)] || {}), sort_order: row.sort_order }; });
      return copy;
    });
    setStatus({ text: `排序已调整，未保存修改 ${patched.length} 条。` });
  }

  return <div className={`products-shell ${sortMode ? 'sorting' : ''}`}><div className="products-card"><div className="products-top"><h1>商品表管理</h1><div className="products-actions"><button className="products-btn" onClick={() => { window.location.href = '/dashboard'; }}>← 返回管理后台</button><button className="products-btn" onClick={refreshProducts}>刷新</button><button id="sortModeBtn" className="products-btn warn" onClick={() => setSortMode(prev => !prev)}>{sortMode ? '退出排序' : '排序'}</button><button id="addProductBtn" className="products-btn" disabled={showNewRow || creating} onClick={openInlineProductRow}>{showNewRow ? '正在添加' : '添加商品'}</button><button className="products-btn primary" onClick={saveAllDirty}>保存修改</button></div></div><div className="products-toolbar"><input id="globalSearch" className="products-search" value={query} placeholder="搜索：条码 / 商品名 / 品牌 / 规格 / 口味 / 单位" onChange={event => setQuery(event.target.value)} /><button className="products-btn" onClick={() => { setQuery(''); setColumnFilters(Object.fromEntries(FILTER_FIELDS.map(field => [field, null])) as Record<ProductFilterField, Set<string> | null>); }}>清空筛选</button></div><div className="products-sort-tip">排序模式：勾选商品后点击“上移 / 下移 / 置顶 / 置底”，可多选批量排序。排序数字只写入后台，不在页面显示。</div>{sortMode && <div className="products-sort-actions"><button className="products-btn" onClick={() => setSelectedSortIds(new Set(filtered.map(row => String(row.id))))}>全选当前筛选</button><button className="products-btn" onClick={() => setSelectedSortIds(new Set())}>取消选择</button><button className="products-btn warn" onClick={() => moveSelectedSortRows('top')}>置顶</button><button className="products-btn" onClick={() => moveSelectedSortRows('up')}>上移</button><button className="products-btn" onClick={() => moveSelectedSortRows('down')}>下移</button><button className="products-btn warn" onClick={() => moveSelectedSortRows('bottom')}>置底</button><span className="products-sort-hint">选中多行后一起移动，点“保存修改”后生效。</span></div>}<div id="status" className={`products-status ${status.kind || ''}`}>{status.text}</div><div className="products-table-wrap"><table><thead><tr>{sortMode && <th className="products-sort-col">排序模式</th>}<ProductHead field="barcode" label="条形码" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.barcode} /><ProductHead field="name" label="商品名称" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.name} /><ProductHead field="brand" label="品牌" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.brand} /><ProductHead field="spec" label="规格" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.spec} /><ProductHead field="flavor" label="口味/简称" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.flavor} /><ProductHead field="default_price" label="默认散件价" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.default_price} /><ProductHead field="pcs_per_case" label="件装数" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.pcs_per_case} /><ProductHead field="pcs_per_box" label="盒装数" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.pcs_per_box} /><ProductHead field="unit" label="散件单位" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.unit} /><ProductHead field="allow_mix_box" label="拼盒" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.allow_mix_box} /><ProductHead field="is_active" label="启用" openFilter={openFilter} setOpenFilter={setOpenFilter} active={!!columnFilters.is_active} /></tr></thead><tbody>{showNewRow && <NewProductRow value={newProduct} setValue={setNewProduct} creating={creating} createProduct={createProduct} cancel={() => setShowNewRow(false)} />}{filtered.map(row => <ProductRow key={String(row.id || row.barcode)} row={row} dirty={dirty[String(row.id)] || {}} sortMode={sortMode} selected={selectedSortIds.has(String(row.id))} setSelected={checked => setSelectedSortIds(prev => { const next = new Set(prev); checked ? next.add(String(row.id)) : next.delete(String(row.id)); return next; })} markDirty={markDirty} saveRow={saveRow} />)}</tbody></table></div></div>{openFilter && <FilterPanel field={openFilter} products={sortedProducts.filter(product => productMatches(product, query, columnFilters, openFilter))} selected={columnFilters[openFilter]} search={filterSearchText} setSearch={setFilterSearchText} close={() => setOpenFilter('')} setOnly={key => setColumnFilters(prev => ({ ...prev, [openFilter]: new Set([key]) }))} toggle={key => setColumnFilters(prev => toggleColumnFilter(prev, openFilter, key))} clear={() => setColumnFilters(prev => ({ ...prev, [openFilter]: null }))} />}</div>;
}

function ProductHead({ field, label, openFilter, setOpenFilter, active }: { field: ProductFilterField; label: string; openFilter: ProductFilterField | ''; setOpenFilter: (field: ProductFilterField | '') => void; active: boolean }) {
  return <th><div className="products-th-head"><span>{label}</span><button className={`products-filter-btn ${active ? 'active' : ''}`} onClick={() => setOpenFilter(openFilter === field ? '' : field)}>筛选</button></div></th>;
}
function ProductRow({ row, dirty, sortMode, selected, setSelected, markDirty, saveRow }: { row: ProductAdminRow; dirty: ProductPatch; sortMode: boolean; selected: boolean; setSelected: (checked: boolean) => void; markDirty: (id: string | number | undefined, field: keyof ProductAdminRow, value: string | number | boolean) => void; saveRow: (id: string | number | undefined) => void }) {
  return <tr className={selected ? 'selected-row' : ''}>{sortMode && <td className="products-sort-col"><input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} /></td>}<td><input className={dirty.barcode !== undefined ? 'dirty' : ''} value={row.barcode || ''} onChange={event => markDirty(row.id, 'barcode', event.target.value)} /></td><td><input className={dirty.name !== undefined ? 'dirty' : ''} value={row.name || row.product_name || ''} onChange={event => markDirty(row.id, 'name', event.target.value)} /></td><td><input value={row.brand || ''} onChange={event => markDirty(row.id, 'brand', event.target.value)} /></td><td><input value={row.spec || ''} onChange={event => markDirty(row.id, 'spec', event.target.value)} /></td><td><input value={row.flavor || ''} onChange={event => markDirty(row.id, 'flavor', event.target.value)} /></td><td><input type="number" value={Number(row.default_price || 0)} onChange={event => markDirty(row.id, 'default_price', event.target.value)} /></td><td><input type="number" value={Number(row.pcs_per_case || 0)} onChange={event => markDirty(row.id, 'pcs_per_case', event.target.value)} /></td><td><input type="number" value={Number(row.pcs_per_box || 0)} onChange={event => markDirty(row.id, 'pcs_per_box', event.target.value)} /></td><td><input value={row.unit || '个'} onChange={event => markDirty(row.id, 'unit', event.target.value)} /></td><td><input type="checkbox" checked={!!row.allow_mix_box} onChange={event => markDirty(row.id, 'allow_mix_box', event.target.checked)} /></td><td><input type="checkbox" checked={row.is_active !== false} onChange={event => markDirty(row.id, 'is_active', event.target.checked)} /><div className="products-inline-actions"><button className="products-btn" onClick={() => saveRow(row.id)}>保存本行</button></div></td></tr>;
}
function NewProductRow({ value, setValue, creating, createProduct, cancel }: { value: typeof emptyProduct; setValue: (fn: (prev: typeof emptyProduct) => typeof emptyProduct) => void; creating: boolean; createProduct: () => void; cancel: () => void }) {
  return <tr className="products-new-row"><td><input value={value.barcode} placeholder="必填" onChange={event => setValue(prev => ({ ...prev, barcode: event.target.value }))} /></td><td><input value={value.name} placeholder="必填" onChange={event => setValue(prev => ({ ...prev, name: event.target.value }))} /></td><td><input value={value.brand} onChange={event => setValue(prev => ({ ...prev, brand: event.target.value }))} /></td><td><input value={value.spec} onChange={event => setValue(prev => ({ ...prev, spec: event.target.value }))} /></td><td><input value={value.flavor} onChange={event => setValue(prev => ({ ...prev, flavor: event.target.value }))} /></td><td><input type="number" value={value.default_price} onChange={event => setValue(prev => ({ ...prev, default_price: Number(event.target.value || 0) }))} /></td><td><input type="number" value={value.pcs_per_case} onChange={event => setValue(prev => ({ ...prev, pcs_per_case: Number(event.target.value || 0) }))} /></td><td><input type="number" value={value.pcs_per_box} onChange={event => setValue(prev => ({ ...prev, pcs_per_box: Number(event.target.value || 0) }))} /></td><td><input value={value.unit} onChange={event => setValue(prev => ({ ...prev, unit: event.target.value }))} /></td><td><input type="checkbox" checked={value.allow_mix_box} onChange={event => setValue(prev => ({ ...prev, allow_mix_box: event.target.checked }))} /></td><td><input type="checkbox" checked={value.is_active} onChange={event => setValue(prev => ({ ...prev, is_active: event.target.checked }))} /><div className="products-inline-actions"><button className="products-btn primary" disabled={creating} onClick={createProduct}>提交</button><button className="products-btn" disabled={creating} onClick={cancel}>取消</button></div></td></tr>;
}
function FilterPanel({ field, products, selected, search, setSearch, close, toggle, setOnly, clear }: { field: ProductFilterField; products: ProductAdminRow[]; selected: Set<string> | null; search: string; setSearch: (v: string) => void; close: () => void; toggle: (key: string) => void; setOnly: (key: string) => void; clear: () => void }) {
  const options = getFilterOptions(products, field).filter(([, label]) => !search || label.toLowerCase().includes(search.toLowerCase()));
  return <div className="products-filter-panel open"><div className="products-filter-panel-title">{FILTER_LABELS[field]}</div><input className="products-filter-search" value={search} placeholder="搜索此列" onChange={event => setSearch(event.target.value)} /><div className="products-filter-options">{options.length ? options.map(([key, label]) => <label className="products-filter-option" key={key}><input type="checkbox" checked={!selected || selected.has(key)} onChange={() => toggle(key)} /><span>{label}</span><button className="products-only-btn" type="button" onClick={event => { event.preventDefault(); setOnly(key); }}>只看</button></label>) : <div className="products-filter-empty">没有可选项</div>}</div><div className="products-filter-actions"><button className="products-btn" onClick={clear}>清空本列</button><button className="products-btn primary" onClick={close}>完成</button></div></div>;
}

function productSortValue(product: ProductAdminRow) { const sort = Number(product.sort_order || 0); if (Number.isFinite(sort) && sort > 0) return sort; const id = Number(product.id || 0); return Number.isFinite(id) ? id * 10 : 999999; }
function compareProducts(a: ProductAdminRow, b: ProductAdminRow) { const d = productSortValue(a) - productSortValue(b); return d || Number(a.id || 0) - Number(b.id || 0); }
function productMatches(product: ProductAdminRow, query: string, columnFilters: Record<ProductFilterField, Set<string> | null>, excludeField?: ProductFilterField) { const q = query.trim().toLowerCase(); const blob = [product.barcode, product.name, product.product_name, product.brand, product.spec, product.flavor, product.unit].map(value => String(value || '').toLowerCase()).join(' '); if (q && !blob.includes(q)) return false; return FILTER_FIELDS.every(field => field === excludeField || !columnFilters[field] || columnFilters[field]!.has(getFilterKey(product, field))); }
function getFilterKey(product: ProductAdminRow, field: ProductFilterField) { if (field === 'is_active') return product.is_active !== false ? 'true' : 'false'; if (field === 'allow_mix_box') return product.allow_mix_box ? 'true' : 'false'; return String((product as unknown as Record<string, unknown>)[field] ?? ''); }
function displayFilterValue(field: ProductFilterField, key: string) { if (field === 'is_active') return key === 'true' ? '启用' : '停用'; if (field === 'allow_mix_box') return key === 'true' ? '可拼盒' : '不可拼盒'; return key || '(空白)'; }
function getFilterOptions(products: ProductAdminRow[], field: ProductFilterField) { const map = new Map<string, string>(); products.forEach(product => { const key = getFilterKey(product, field); map.set(key, displayFilterValue(field, key)); }); return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN', { numeric: true })); }
function toggleColumnFilter(prev: Record<ProductFilterField, Set<string> | null>, field: ProductFilterField, key: string) { const selected = new Set(prev[field] || getFilterOptions([], field).map(([value]) => value)); if (prev[field] === null) return { ...prev, [field]: new Set([key]) }; selected.has(key) ? selected.delete(key) : selected.add(key); return { ...prev, [field]: selected.size ? selected : new Set(['__none__']) }; }
function errorMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }