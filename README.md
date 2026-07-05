# SPR2

SPR2 是从 `1Rasy/spr` 迁移出来的 React + Vite + TypeScript 版本。

## 当前状态

这是第一阶段迁移版本，目标是先把原来分散在静态 HTML / 原生 JS 里的门店端核心流程迁入 React 项目结构，方便后续继续拆组件和维护。

当前已迁入：

- 员工选择。
- 门店选择。
- 门店订单历史。
- 订单详情基础展示。
- 卖进数据按日期筛选。
- 库存查看。
- 基础新增开单：散数、价格、收回数。
- 售后 / 收回订单在统计中剔除正常销售叠加。

尚未完全迁入：

- 拼盒完整开单 UI。
- 送货单图片生成。
- 经销商 Excel 导入页。
- 管理后台导出。
- 旧订单编辑完整流程。

## 开发

```bash
npm install
npm run dev
```

## 环境变量

项目已内置旧 SPR 的 Supabase publishable key 作为开发 fallback，也可以复制 `.env.example` 为 `.env.local` 后自行配置：

```bash
cp .env.example .env.local
```

## 迁移原则

继续迁移时必须遵守 `docs/ai/MIGRATION_NOTES.md`，并以原项目文档为规则来源：

- `docs/ai/PROJECT_STATE.md`
- `docs/ai/DATA_RULE_ENGINE.md`
- `docs/ai/SCHEMA_LOCK.md`
- `docs/ai/IMPORT_MAPPING.md`
