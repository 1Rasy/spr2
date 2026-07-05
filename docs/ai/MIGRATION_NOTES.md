# SPR2 迁移说明

## 1. 技术栈

SPR2 使用：

- React 18
- Vite
- TypeScript
- Supabase JS v2

## 2. 迁移目标

原 SPR 当前是移动端优先的静态 HTML + 原生 JavaScript 项目。SPR2 的目标不是直接重写业务规则，而是把页面状态、业务计算、Supabase 读写逐步迁移到可维护的 React 模块中。

## 3. 不可改动的业务口径

迁移中必须继续遵守旧项目规则：

- 售后 / 收回品项不参与正常销售品项叠加。
- 门店订单总览和卖进数据中，有售后订单要显示“有售后”。
- 管理后台导出订单详情时，售后项必须剔除。
- 商品匹配优先使用 barcode。
- 订单详情商品展示：规格栏使用 `products.spec`，口味行使用 `products.flavor`。
- 拼盒识别依赖 `sale_unit = '拼盒'`，拼盒导出必须按条码拆行。

## 4. 当前迁移边界

第一阶段先完成 React 项目结构和门店端基础流程。为了避免一次性重写导致业务逻辑失控，以下复杂功能暂不在第一版完全迁入：

- 拼盒开单完整交互。
- 送货单 html2canvas 生成。
- 经销商 Excel 导入解析。
- 管理后台导出。
- 完整旧订单编辑。

这些功能后续应按模块迁移，而不是继续堆全局补丁脚本。

## 5. 建议下一步

1. 拆分 `src/App.tsx` 为页面组件：`EmployeePage`、`StorePage`、`OrderPage`、`ReportPage`。
2. 把 `submitOrder` 拆成 order service 和 stock service。
3. 恢复拼盒 UI，所有拼盒计算集中在 `src/lib/rules.ts`。
4. 迁移送货单生成组件。
5. 迁移经销商导入页，并保证条码全程按文本处理。
