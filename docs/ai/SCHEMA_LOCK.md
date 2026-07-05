# SPR 数据库结构锁定文档

> 本文件记录当前 SPR 项目的数据库结构共识。
>
> 它不是自动导出的完整 schema，而是 AI / Codex 修改代码时必须遵守的结构基线。
>
> 如果实际 Supabase 结构与本文档冲突，必须先核对数据库，再更新本文档，不要直接猜字段。

---

## 1. 使用原则

### 1.1 修改前必须确认

涉及数据库字段、表名、唯一键、trigger、函数时，必须先确认当前 Supabase 实际结构。

本文件用于防止 AI 忘记核心表关系，不等于替代数据库 introspection。

### 1.2 禁止行为

禁止：

- 凭空新增字段。
- 擅自改表名。
- 擅自删除 trigger。
- 擅自改变唯一键。
- 在没确认前把旧字段名当作最终字段名。

---

## 2. 核心表

## 2.1 employees

用途：业务员基础资料。

共识字段：

```text
id
created_at
employee_code
name
is_active
```

关键规则：

- `employee_code` 是业务员编号核心字段。
- 页面选择员工、库存、订单、门店关系都依赖该字段。

---

## 2.2 employee_store_assets

用途：业务员与门店资产 / 门店关系。

共识字段：

```text
id
created_at
employee_code
atom_code
store_name
```

关键规则：

- `employee_code` 关联业务员。
- `atom_code` 是门店编号核心字段。
- 历史共识：`atom_code` 可能有唯一约束或被视为门店唯一标识。
- 查询门店时注意 Supabase 默认 1000 行限制。

---

## 2.3 dealer_employee_mappings

用途：经销商客户编号到业务员工号映射。

共识字段：

```text
id
created_at
customer_code
customer_name
employee_code
```

关键规则：

- `customer_code` 是经销商系统里的客户编号。
- `employee_code` 是 SPR 系统里的业务员工号。
- 经销商出库导入时，通过 `customer_code` 找到对应业务员。
- 历史共识：`customer_code` 可能是唯一键。

---

## 2.4 products

用途：商品基础资料。

共识字段：

```text
id
created_at
barcode
name
brand
spec
flavor
default_price
pcs_per_case
pcs_per_box
is_active
```

关键规则：

- `barcode` 是商品匹配核心字段。
- 库存和订单明细都应该优先使用条码匹配。
- `pcs_per_case` 用于 package_reg 缺失时回填。
- `pcs_per_box` 用于部分商品单位换算。
- 历史共识：`barcode` 可能是唯一键。

---

## 2.5 van_stocks

用途：业务员车销库存。

共识字段：

```text
id
created_at
employee_code
product_barcode
stock_qty
```

关键规则：

- 每个业务员 + 商品条码 对应一条库存。
- 历史共识：唯一键为 `employee_code + product_barcode`。
- 经销商出库导入增加库存。
- 正常开单销售减少库存。
- 售后是否回补库存按 `DATA_RULE_ENGINE.md`。

---

## 2.6 raw_dealer_outbounds

用途：经销商原始出库数据。

共识字段：

```text
id
created_at
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

关键规则：

- 原始 Excel 数据先进入本表。
- trigger / function 再从本表同步到 `van_stocks`。
- 历史共识：唯一键可能为 `order_no + barcode`。
- 如果同一单号同一条码可能多行，必须重新确认唯一键设计。

---

## 2.7 sales_orders

用途：销售订单主表。

共识字段：

```text
id
created_at
employee_code
store_atom_code
store_name
order_date
total_amount
remark
order_no
atom_code
```

关键规则：

- 一次开单对应一条主表记录。
- `employee_code` 关联业务员。
- `store_atom_code` / `atom_code` 关联门店；当前前端代码中仍可见 `atom_code` 查询，修改前必须核对真实字段。
- `order_no` 是当前前端订单历史、订单详情、送货单、管理后台导出常用关联键；修改前必须确认数据库真实约束和 RPC 返回。
- 报表涉及金额时，不要盲目相信历史 `total_amount`，售后剔除统计时应按明细重新聚合。

---

## 2.8 sales_order_items

用途：销售订单明细表。

共识字段：

```text
id
order_id
barcode
qty
price
gift_qty
return_qty
return_handle
order_no
product_name
unit_price
amount
sale_unit
sale_qty
sale_unit_price
```

关键规则：

- `order_id` 关联 `sales_orders.id`。
- 当前前端也大量使用 `order_no` 关联订单明细；修改订单查询、导出或送货单前必须确认 `order_id` 与 `order_no` 的真实关系。
- `barcode` 关联商品，是导出和拼盒拆行的核心匹配字段。
- `qty` 表示底层扣库存 / 统计可用数量；拼盒场景中通常为该条码散数。
- `unit_price` / `amount` 是当前前端提交和导出依赖字段；`price` 是否仍使用需核对数据库。
- `sale_unit` / `sale_qty` / `sale_unit_price` 记录用户开单时选择的销售单位、单位数量和单位价格；拼盒导出依赖这些字段识别 `拼盒` 并计算散价。
- `gift_qty` 表示赠品数量。
- `return_qty` / `return_handle` 用于售后 / 退回相关逻辑。
- 售后字段的真实命名与含义必须以数据库和当前代码为准。

---

## 3. 触发器与函数

## 3.1 process_dealer_stock_final

历史共识：存在函数：

```text
public.process_dealer_stock_final()
```

用途：

- 插入 `raw_dealer_outbounds` 后处理经销商出库记录。
- 通过 `dealer_employee_mappings.customer_code` 找 `employee_code`。
- 校验条码是否存在于 `products`。
- 处理 `package_reg`。
- 写入 / 更新 `van_stocks`。

关键逻辑：

```text
如果 customer_code 能映射 employee_code
并且 barcode 存在于 products
则计算数量并更新 van_stocks
```

## 3.2 trig_execute_dealer_stock_final

历史共识：存在 BEFORE INSERT trigger：

```text
trig_execute_dealer_stock_final
```

用途：

- 在插入原始出库记录时执行库存处理函数。

## 3.3 sync_van_stock_from_outbounds

历史共识：存在函数：

```text
sync_van_stock_from_outbounds()
```

用途：

- 同步 `raw_dealer_outbounds` 与 `van_stocks`。
- 可能由 AFTER INSERT / DELETE / UPDATE trigger 调用。

## 3.4 trg_sync_van_stock

历史共识：存在 AFTER I/D/U trigger：

```text
trg_sync_van_stock
```

用途：

- 当原始出库数据变化时同步业务员库存。

---

## 4. 唯一键 / 约束共识

以下是历史共识，修改前必须确认数据库实际约束名称：

```text
products.barcode 唯一
raw_dealer_outbounds(order_no, barcode) 唯一
van_stocks(employee_code, product_barcode) 唯一
employee_store_assets.atom_code 可能唯一
```

注意：

- 如果 `raw_dealer_outbounds(order_no, barcode)` 与真实业务冲突，不要直接删约束，应先确认经销商单据是否会出现同单同码多行。
- 如果 Excel 存在重复行，应先判断是重复导入、经销商重复明细，还是需要聚合。

---

## 5. 外键注意事项

历史问题：

- 清空 `products` 时，可能被 `van_stocks` 外键阻断。
- 报错类似：table `van_stocks` references `products`。

处理原则：

1. 不要随便 `TRUNCATE ... CASCADE`。
2. 先确认哪些表引用目标表。
3. 清空前确认是否会影响库存、订单历史。

---

## 6. 查询注意事项

### 6.1 Supabase 默认 1000 行限制

大表查询必须分页，例如：

- 门店关系。
- 商品。
- 库存。
- 原始出库。
- 订单历史。

不要假设一次 `.select()` 会拿到全部数据。

### 6.2 日期查询

业务日期按中国业务日处理。

不要因为 Supabase UTC 存储导致日期偏移。

---

## 7. 待确认字段

以下字段需要在每次大改前确认真实状态：

```text
sales_order_items.return_qty
sales_order_items.return_handle
sales_order_items.gift_qty
sales_orders.total_amount
raw_dealer_outbounds.qty
raw_dealer_outbounds.price
raw_dealer_outbounds.package_reg
```

原因：这些字段直接影响售后、库存、金额、导出逻辑。

---

## 8. 更新记录

### 2026-07-05

建立数据库结构锁定文档，记录当前 SPR 系统核心表、函数、trigger、唯一键共识。

补充当前前端代码依赖：

- `sales_orders.order_no` / `sales_orders.atom_code` 仍被页面查询和导出使用，修改前必须核对真实 schema。
- `sales_order_items.order_no`、`product_name`、`unit_price`、`amount`、`sale_unit`、`sale_qty`、`sale_unit_price` 是当前订单详情、送货单和管理后台导出的关键字段。
