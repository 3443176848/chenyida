# SELFHOST-PHASE3-TASK03 测试验收

日期：2026-07-25（Asia/Shanghai）

| 测试组 | 结果 | 说明 |
| --- | --- | --- |
| Migration tool / materializer | PASS | tool 8/8；materializer PG 3/3；opening unit/PG/upgrade；staging PG E2E；SQLite 与 D1 export adapter |
| 事务/恢复/冲突 | PASS | 中断恢复、同 manifest 重放、不同/非空目标拒绝、digest 漂移、code 冲突、聚合回滚、上游阻断与恢复不重复 |
| TASK02—TASK10 unit/UI | PASS | Material、Mapping、Normalization、Review、Identity、Master Data、Inventory、Procurement、Production、Sales、Quality、Finance、Dashboard 全部适用脚本通过 |
| PostgreSQL/API | PASS | 基础、各业务域、Dashboard、TASK01 staging、TASK02 Opening、TASK03 public materializer 全部隔离脚本通过 |
| Migration upgrade | PASS | Mapping、Normalization、Identity、Master Data、Inventory、Procurement、Production、Sales、Quality、Finance、Opening 全部空库/升级/重复/失败回滚脚本通过 |
| Compose full journey | PASS | snapshot 后正常 Service/API 全域旅程、角色裁剪、Dashboard、23 GET、`erp_records=0` |
| Backup/restore/restart | PASS | 停服 backup/verify、新空目标 restore、同 manifest 重跑、PostgreSQL/Web/Worker 整体重启、文件 SHA 与 API 再核对 |
| Static/build | PASS | 8 组 typecheck、Schema consistency（No schema changes）、lint、Vinext build、credentials、environment、npm test |
| Python baseline | PASS | 只读源码挂载、临时 SQLite：`SELF_TEST_OK`、`SMOKE_TEST_OK`、`GO_LIVE_CHECK_OK` |

所有数据库与文件均为临时合成测试资源。未降低断言、跳过适用失败或把未运行项标为 PASS。结果只支持 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`；生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。
