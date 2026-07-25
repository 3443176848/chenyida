# SELFHOST-PHASE3-TASK03 合成业务表物化报告

日期：2026-07-25（Asia/Shanghai）

结论：`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`

生产结论：`NO-GO FOR REAL DATA / PRODUCTION`

## 隔离范围

- 来源是任务内即时生成、带 `SYNTHETIC_MIGRATION_TEST_ONLY` 标记的临时 SQLite；未读取仓库既有 SQLite/D1、真实账号、备份、上传、附件或归档。
- 两个 PostgreSQL 目标均为独立 Compose project、回环随机端口、名称含 `_migration_test` 的新空数据库。
- Python systemd 仅只读记录，未重启；未访问远程/生产地址，未部署、切流、push 或创建 PR。

## Cutover snapshot

| 项目 | 结果 |
| --- | --- |
| Source records | 30 |
| Snapshot actual public targets | 18 |
| Archive-only source activities | 12 |
| Inventory Opening | 2；on-hand 合计 `112.000000`，frozen 合计 `4.000000` |
| Finance Opening | AR `6.500000 CNY`；AP `7.250000 CNY` |
| Synthetic file | 1；17 bytes；SHA-256 `19ae05a8872e4000652f2efe7e9123cfc5e64aa2d69f9afb5511f80e21d66346` |
| Public ID map | 18；全部保存 actual target table/ID、source/target digest、request/operation/time |
| Legacy staging | 保留为迁移证据，不作为 Dashboard 权威；`erp_records` 增量 0 |

Identity 只创建受控测试管理员；迁移账号不迁 Session/旧 hash，默认 disabled、`must_change_password=true`。Reference、Material、Party、Product/Version、Supplier Mapping、BOM/Line 使用显式稳定关系；Inventory/Finance Opening 复用 TASK02 Service，来源活动不作为历史单据重放。

## 事务、幂等和失败门禁

- 每个受控聚合在独立事务中写 business row、public ID map、target digest 和审计；故障注入确认当前聚合整体回滚，已完成上游保留。
- code 冲突阻断下游写入；移除合成冲突后同 run 恢复，Identity、Unit、Material 均未重复。
- 相同 manifest/run 可重放；不同 run、非空目标、source/mapping/plan/checkpoint/target digest 变化均 fail closed。
- 文件通过 Local FileStorage 原子写；重复执行校验既有正文，missing/mismatch 阻断。文件目录 run marker 随 backup/restore 保存，防止恢复后误判为其他 run。
- public reconcile 在只读 repeatable-read 快照逐一读取 actual target；target 缺失或 digest 漂移失败。

## 恢复核对

停服备份 `backup-20260725T100150Z-8f3079846447` 已通过 manifest、14 个 migration checksum、数据库 dump 和两个文件 tar 校验，并恢复到第二个新空 PostgreSQL/空文件目录。恢复前后关键计数一致：public map 18、Material 9、Customer 6、Supplier 4、Product 5、BOM 5、PO 2、WO 3、SO 3、Quality 4、Finance Document 4、`erp_records` 0。恢复后同 manifest 重跑仍为 18 maps、1 file，没有重复业务记录。

## 边界

本报告只证明完全合成输入可以受控物化到 public 业务表并恢复。它没有证明真实数据质量、真实账号策略、历史活动分类、文件规模、容量、异故障域恢复或生产切换；不得据此读取真实源或进入生产。
