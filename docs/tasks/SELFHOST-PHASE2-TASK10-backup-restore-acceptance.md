# TASK10 备份恢复验收计划

范围仅限合成数据、隔离 PostgreSQL/Compose 和临时目录。

| 场景 | 期望 |
| --- | --- |
| Web/Worker 未确认停止 | backup 拒绝缺少 `--confirm-services-stopped YES` |
| production 环境或含 prod 的 URL | 在数据库访问前拒绝 |
| `/`、HOME、仓库、源目录或已有输出 | 拒绝且不修改目标 |
| PG/files/migration 正常 | 生成 3 个非零组件、migration 清单，manifest 最后写入，权限 0600 |
| 组件被截断或 checksum 改变 | verify/restore 拒绝，不写 VERIFIED 状态 |
| tar 包含绝对路径、`..` 或 link | verify 拒绝 |
| 未知 schema、缺组件、零字节组件 | verify 拒绝 |
| 目标数据库或文件目录非空 | restore 拒绝，不覆盖 |
| 新空目标 | 单事务恢复 PG，staging 恢复文件，migration/记录数/SHA 核对通过 |
| 恢复后 Compose 重启 | health、Session、Dashboard 与关键数据仍可读取 |

本地通过只能证明工具在隔离合成环境工作；不能证明跨故障域、副本保留期、生产容量、RTO/RPO 或生产灾备。
