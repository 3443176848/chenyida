# SELFHOST-PHASE3-TASK01 完成报告

状态：`DONE`（合成迁移框架和生产前准入证据完成）

完成日期：2026-07-25（Asia/Shanghai）

## 交付结果

- 在 `chenyida_erp_site/tools/selfhost-migration/` 建立显式 CLI 迁移工具：环境拒绝、SQLite/D1 export adapter、PostgreSQL target adapter、manifest、mapping registry、稳定 ID map、checkpoint、计划/验证、合成 commit、核对和去敏报告。
- 实现 10 状态、9 阶段的可恢复执行模型；checkpoint 绑定 source/mapping/target/plan digest，中断可续跑，输入变化 fail closed。
- 新增 valid/reviewable/blocked/resume/repeat 五类完全合成 fixture 和 SQLite/D1 生成器；不保存真实样本或业务正文。
- synthetic commit 仅写新空测试 PostgreSQL 的独立 `migration_tool` schema；保持业务 PostgreSQL migration `0001`—`0013` 和 `db/schema.ts` 不变，不创建 `0014`。
- 版本更新为 `chenyida-erp-selfhosted@0.1.0-alpha.11`；仍为 `NOT_RELEASED / NOT_DEPLOYED / NOT_MIGRATED / NOT_APPROVED_FOR_PRODUCTION`。

## 验收

迁移工具单元 8/8、PostgreSQL E2E 1/1、非数据库 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、typecheck 8/8、build、lint、凭据扫描、隔离 backup/restore、两组 Compose 重启和 Python 三项全部通过。完整计数、首次环境问题与重跑证据见 `docs/audits/SELFHOST-PHASE3-TASK01-synthetic-migration-report.md`。

## 边界与后续阻断

- 未读取、导出、复制或修改真实 SQLite、D1、PostgreSQL、备份、上传、附件或归档；Python 常驻服务未重启。
- 未部署、切流、访问生产、push 或创建 PR。
- 当前 Finance 不能表达无 Shipment/Receipt 来源的历史期初，记录为 `MODEL_GAP`，禁止伪造来源或顺手新增 `0014`。
- 本轮只证明隔离 staging 的关系和核对框架，不证明真实业务表物化、真实 Dashboard 核对、真实容量或生产恢复。

生产结论保持 `NO-GO FOR REAL DATA / PRODUCTION`。下一任务不得自动开始；真实数据只读盘点、脱敏试迁移、业务模型补口、生产恢复或切换均须独立授权。
