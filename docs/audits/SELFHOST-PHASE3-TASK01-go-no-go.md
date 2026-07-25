# SELFHOST-PHASE3-TASK01 生产 Go/No-Go 准入矩阵

当前结论：`NO-GO FOR REAL DATA / PRODUCTION`。本表在任务完成后也只能证明合成迁移准备度。

| 准入项 | 当前状态 | Go 条件 |
| --- | --- | --- |
| 合成环境拒绝守卫 | PASS | 连接/读取前拒绝 production、真实路径、公开/远程目标、非测试库、非空目标 |
| SQLite/D1 source inventory | 已诊断源码 | 真实来源只读快照、schema fingerprint 和数据质量须另任务授权 |
| 映射注册表 | SYNTHETIC PASS / REAL REVIEW | 合成映射确定且不按名称猜测；业务负责人仍须逐域确认真实字段/状态/单位/角色映射 |
| 幂等/checkpoint/恢复 | PASS | 合成 E2E、中断恢复、重复执行和 digest 失效全部 PASS |
| 库存期初 | `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL` / REAL BLOCKED | `0014` 受控物化、Ledger/Balance、冲销、幂等和恢复通过；真实余额、负库存、冻结、单位和库位须人工处置 |
| Finance 期初 | `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL` / REAL BLOCKED | `0014` 关系化 OPENING_AR/AP、核销/冲销、Dashboard、并发和恢复通过；真实主体、金额、币种和截止日须人工核验 |
| 身份 | SYNTHETIC PASS / REAL BLOCKED | 合成固定十角色、disabled/首改与未知角色阻断通过；管理员初始化和通知流程须批准 |
| 文件 | SYNTHETIC PASS / REAL BLOCKED | 合成 MATCHED/MISSING/MISMATCH 通过；真实附件清单、权限、恶意文件扫描和 SHA 处置未做 |
| 容量/RPO/RTO | 未证明 | 使用脱敏规模模型或授权真实只读统计，完成压力与异故障域演练 |
| 真实试迁移 | 禁止/未运行 | 单独授权、快照、只读源、新空目标、逐行处置和业务验收 |
| 生产迁移/部署/切流 | 禁止/未批准 | 独立维护窗口、执行/回退责任人、审批、监控与用户通知 |

任何红项均为 NO-GO；不得把合成 PASS 推断成真实数据或生产 Go-Live 批准。
