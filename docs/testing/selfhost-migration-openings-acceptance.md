# SELFHOST-PHASE3-TASK02 专项验收计划

覆盖四组门禁：

1. Migration：空库/0013 升级、重复、失败回滚、约束/索引、旧校验和、零自动数据、direct SQL guard。
2. Inventory：合法/冻结边界/负数/精度/Base Unit/ACTIVE/重复/摘要冲突/幂等/故障回滚/并发/全额冲销/消费后拒绝/Ledger-Balance 核对。
3. Finance：OPENING_AR/AP、主体互斥、CNY/正数/精度、重复/幂等、普通核销、Dashboard、收付款存在时冲销拒绝、收付款冲销后期初冲销、并发与故障回滚。
4. Security/E2E：无 HTTP 路由、production/真实路径/远程或非测试库/非空未授权目标拒绝、安全错误、不泄露正文；隔离 Compose 完成 dry-run、commit、查询、核销/冲销、重启、backup/restore 和清理。

## 执行结果

四组门禁均已执行并通过：专项 unit 3/3、PostgreSQL 2/2、migration upgrade 3/3；既有 PostgreSQL/API 42/42、Material/Mapping/Normalization/Review 20/20、全 migration upgrade 30/30。隔离 Compose 构建、健康检查、Web/Worker 重启、停服 backup/verify 和全新空库 restore 通过；恢复后 14 个 migration、4 个来源、库存 `112/4` 及 AR/AP 余额逐项一致。

安全扫描、environment guard、schema consistency、typecheck、lint、build、`npm test` 与 Python 三项基线通过。未执行真实源、生产目标、远程数据库、部署或切流。完整证据见 `docs/audits/SELFHOST-PHASE3-TASK02-synthetic-opening-report.md`。
