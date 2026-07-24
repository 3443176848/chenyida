# Cloudflare / OpenAI Site 旧实现处置

自托管运行路径已不导入 `cloudflare:workers`，不配置 `@cloudflare/vite-plugin`、Wrangler、D1、R2、Queue 或 OpenAI Sites packager；这些包已从直接依赖和 lockfile 顶层移除。`vite.config.ts` 只启动 Vinext，API route 使用 `selfhost-api.ts`，Worker 使用 `worker/selfhost.ts`。

旧 `erp-api.ts`、R2/Queue adapters、Cloudflare Worker entry、`.openai/hosting.json`、D1 `drizzle/` migrations 和 Miniflare 测试暂时保留为只读历史与后续数据迁移依据，不在 Compose、Dockerfile、npm start/worker/migrate 入口的可达依赖图中。旧测试通过 `test:legacy` 明确区分；它们不能作为自托管验收结论。

后续在完成旧数据迁移映射、业务 API PostgreSQL 全量移植和审计归档后，可另立任务把历史实现移动到 `legacy/cloudflare/` 或删除。当前不删除，避免丢失行为证据。
