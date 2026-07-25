# SELFHOST-PHASE4-TASK02 API/UI 验收清单

## 自动验证

| 范围 | 必须结果 |
| --- | --- |
| Migration | 空库 0001→0016、0015→0016 管理员/十旧角色/TASK01 事实保留、重复执行、失败回滚、FK/索引/写守卫 |
| Identity | 正式 planning 角色；engineering=read/prepare/submit，planning=read/accept，manager/admin=全部，production 不代替 planning |
| 关系校验 | 非 ACCEPTED、非负责人、客户不一致、未发布版本、错误 BOM 关系、失效 Material/Unit、未解析明细全部阻断 |
| 包快照 | numeric 毛数量、完整 digest、安全规格/文件元数据、提交后不可变、退回后新版本 |
| 状态/并发 | submit、return(reason)、RESUBMITTED、最终 accept；幂等重放/异正文冲突、CAS、并发接收仅一次成功 |
| 原子性 | 包头/明细/BOM/事件/Audit/Idempotency 任一故障时零半记录 |
| UI | engineering 解析/预览/版本历史/重提；planning 待办/详情/退回/接收/历史；权限、刷新、空/错状态 |
| 回归 | TASK01 事实不改；Identity、Project、Material、Master Data/BOM、Schema、lint、build、credentials、Python 三项 |

## 并行环境实际旅程

1. 只将既有 `chenyida-erp-parallel` 从 0015 升到 0016；Web 仍只绑定回环。
2. 创建临时 engineering/planning 验收账号及合成 Customer、Product/Released Version、Released BOM、ACTIVE Material。
3. 完成项目接收→明细 Resolution→包 v1→提交→planning 退回→项目部包 v2→重提→planning 最终接收。
4. 重启 Compose，验证包版本、事件、Audit、角色和 migration 持久。
5. 使用“0016 已应用、验收数据未创建”的 root-only 恢复点清理；最终只留管理员、Schema 和 16 migrations。

不得读取真实 SQLite 业务内容，不得创建物料需求、采购申请、采购订单或生产记录，不得启用 HTTPS/公网/切流。
