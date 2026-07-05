# SPR 经销商 Excel 导入映射文档

> 本文件记录 SPR 项目中经销商出库 Excel 导入规则。
>
> 任何库存导入页面、解析函数、SQL 写入逻辑，都必须遵守本文件。

---

## 1. 总原则

### 1.1 原始数据先入 raw 表

经销商 Excel 不应直接写业务员库存表。

标准流程：

```text
Excel 文件
  -> 前端解析
  -> raw_dealer_outbounds
  -> Supabase trigger / function
  -> van_stocks
```

### 1.2 条码必须按文本处理

Excel 中的条码必须以文本形式读取和写入。

禁止：

- 让 Excel 把条码转成科学计数法。
- 用 Number 类型处理 13 位条码。
- 截断条码前导或尾部数字。

### 1.3 日期必须明确

经销商单据日期要写入 `bill_date`。

如果 Excel 中包含时间，应保留时间信息，但业务统计时要按中国业务日处理。

### 1.4 重复导入控制

默认使用：

```text
order_no + barcode
```

作为重复识别基准。

如果后续确认同一单号同一条码会合法出现多行，需要改为更细的唯一键或导入前聚合。

---

## 2. 目标表：raw_dealer_outbounds

目标表字段共识：

```text
order_no
 doc_no
bill_date
customer_code
customer_name
barcode
qty
price
package_reg
```

说明：

- `order_no`：经销商单号。
- `doc_no`：单据编号，如来源没有可为空。
- `bill_date`：制单 / 单据日期。
- `customer_code`：经销商客户编号。
- `customer_name`：经销商客户名称。
- `barcode`：商品条码。
- `qty`：统一后的数量。
- `price`：价格，如来源有则写入。
- `package_reg`：包装换算数。

---

## 3. 经销商入口

管理后台导入库存按钮应进入经销商选择入口，而不是只有一个通用导入页。

当前经销商：

```text
吉能：stock_jn.html
长涛：stock_ct.html
```

管理后台应提供两个按钮：

- 吉能导入。
- 长涛导入。

点击后分别跳转到对应导入页面。

---

## 4. 吉能 stock_jn 映射

### 4.1 当前状态

吉能沿用原 `stock_import.html` 的旧逻辑，并改名 / 拆分为：

```text
stock_jn.html
```

### 4.2 注意事项

由于旧逻辑可能已经在代码中实现，修改前必须查看当前 `stock_jn.html` 或旧 `stock_import.html` 的实际列映射。

不要凭空覆盖吉能映射。

### 4.3 共同要求

吉能导入也必须：

- 写入 `raw_dealer_outbounds`。
- 使用条码文本。
- 保留单号、日期、客户编号、客户名称、条码、商品名、包装、数量。
- 通过 raw 表触发库存同步。

---

## 5. 长涛 stock_ct 映射

### 5.1 页面名称

长涛导入页：

```text
stock_ct.html
```

### 5.2 Excel 列映射

长涛 Excel 映射如下：

```text
X 列  -> order_no
A 列  -> bill_date
Q 列  -> customer_code
R 列  -> customer_name
AA 列 -> barcode
C 列  -> product_name
D 列  -> package_reg
F 列  -> qty_piece
G 列  -> qty_scatter
```

### 5.3 bill_date 格式

长涛 `bill_date` 示例：

```text
2026/6/15  10:18:28
```

解析要求：

- 允许 `/` 分隔日期。
- 允许日期和时间之间有多个空格。
- 写入数据库前应转为稳定日期时间格式。
- 页面展示 / 统计时按中国业务日处理。

### 5.4 数量计算

长涛来源字段：

```text
F = qty_piece
G = qty_scatter
D = package_reg
```

推荐统一数量计算：

```text
qty = qty_piece * package_reg + qty_scatter
```

注意：

- `qty_piece` 为空时按 0。
- `qty_scatter` 为空时按 0。
- `package_reg` 为空或 <= 0 时，后续库存处理应按产品表 `pcs_per_case` 回填。
- 如果当前 `raw_dealer_outbounds.qty` 存的是箱数而不是最小单位，必须先核对旧逻辑，不要直接替换。

### 5.5 product_name

`product_name` 来自 C 列。

当前目标表共识中未固定 `product_name` 字段。

处理方式：

- 如果 raw 表已有 `product_name` 字段，则写入。
- 如果没有，则仅用于页面预览和错误排查，不强行改表。

---

## 6. 导入前校验

导入前应检查：

1. 是否成功读取 Excel。
2. 是否存在表头或固定列。
3. 单号是否为空。
4. 客户编号是否为空。
5. 条码是否为空。
6. 数量是否为有效数字。
7. 日期是否能解析。

不建议因为单行错误导致整个文件无法预览。

推荐：

- 页面先展示预览。
- 标记异常行。
- 用户确认后再导入有效行。

---

## 7. 导入后校验

导入后应能排查：

### 7.1 未映射客户

```text
raw_dealer_outbounds.customer_code
未能在 dealer_employee_mappings.customer_code 找到 employee_code
```

这些记录不应进入业务员库存。

### 7.2 未匹配商品

```text
raw_dealer_outbounds.barcode
未能在 products.barcode 找到商品
```

这些记录不应进入有效库存。

### 7.3 重复记录

如果因为唯一键冲突无法插入，应能区分：

- 已导入过。
- Excel 自身重复。
- 真实业务存在同单同码多行。

---

## 8. 写入 raw 表规范

### 8.1 必填建议

建议每行至少写入：

```text
order_no
bill_date
customer_code
customer_name
barcode
qty
package_reg
```

### 8.2 可选字段

有来源则写入：

```text
doc_no
price
product_name
```

如果目标表没有可选字段，不要为了导入强行新增字段，除非用户明确要求并同步更新 `SCHEMA_LOCK.md`。

---

## 9. 页面行为要求

库存导入页应具备：

1. 选择 Excel 文件。
2. 解析并预览。
3. 显示总行数、有效行、异常行。
4. 点击确认导入后写入 Supabase。
5. 导入完成后显示成功 / 失败数量。
6. 对错误行提供可复制信息。

文案建议：

```text
正在加载..
正在解析..
确认导入
导入完成
```

注意：项目中加载文案倾向统一为 `正在加载..`。

---

## 10. 常见问题

### 10.1 条码变科学计数法

原因：Excel 或 JS 把条码当 Number。

处理：

- 读取 Excel 时按 raw / text。
- 写入数据库时转字符串。
- 导出时设置文本格式。

### 10.2 日期偏移一天

原因：UTC 与中国业务日混用。

处理：

- 存储和查询时明确时区。
- 按业务日统计，不直接用 UTC 日期截断。

### 10.3 导入成功但库存没变

排查顺序：

1. raw 表是否有数据。
2. customer_code 是否能映射 employee_code。
3. barcode 是否存在 products。
4. trigger 是否启用。
5. package_reg / qty 是否有效。
6. van_stocks 唯一键是否冲突并正确 upsert。

---

## 11. 更新记录

### 2026-07-05

建立导入映射文档。

已明确：

- 吉能使用 `stock_jn.html`，沿用旧导入逻辑。
- 长涛使用 `stock_ct.html`。
- 长涛列映射：X 单号、A 日期、Q 客户编号、R 客户名、AA 条码、C 商品名、D 包装、F 件数、G 散数。
