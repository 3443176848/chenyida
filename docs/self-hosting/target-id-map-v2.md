# 合成 public 物化 Target ID Map V2

每个成功物化记录保存：`migration_run_id`、`manifest_sha256`、`source_system`、`source_kind`、`source_stable_reference_digest`、`source_record_digest`、`mapping_digest`、`plan_digest`、`target_table`、`actual_target_id`、`materialized_status`、`request_id`、`operation_id`、`materialized_at`、`target_digest`。

`actual_target_id` 是 public 业务表真实 bigint ID；Identity 使用实际 username stable key。它不能是计划 UUID、名称或 staging synthetic record ID。BOM Line 等子记录各自映射到真实子表 ID；Product/BOM 聚合另保留 Header 与 Version 的显式关系。

唯一键为同一 manifest/run 下的 source system + kind + stable reference digest。相同来源和摘要重放返回原映射；source/manifest/mapping/plan 摘要变化 fail closed。另一个 manifest 不能复用旧映射或向已有目标追加。

Reconcile 必须按 table allowlist 读取实际记录，重新计算 target digest 并确认 ID 存在。表名不来自外部输入，provenance 不保存业务正文、密码/hash、Session、Token、绝对路径或连接串。
