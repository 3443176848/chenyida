# SELFHOST-PHASE2-TASK08 测试验收

日期：2026-07-25（Asia/Shanghai）

## 验收环境

- 根提交起点：`0ad0687a7b2f2502f68babbef1455df2a983421b`，Branch `main`。
- 隔离 PostgreSQL 16/17 与 TASK08 Compose project；数据库名均包含 `quality_test`/对应测试域标识，未连接生产。
- Node 22 容器复用仓库依赖；Python 使用 `/opt/erp/.venv/bin/python`。

## 专项结果

| 项目 | 结果 | 覆盖 |
| --- | --- | --- |
| Quality unit/UI | PASS 5/5 | 权限、枚举/精度、稳定来源、受保护写、legacy 生命周期合同 |
| Quality PostgreSQL/API | PASS 8/8 | IQC/IPQC/FQC、数量守恒/来源容量、缺陷上限、职责分离、处置/关闭/重开、并发 FQC 发货门禁、冲销恢复额度、幂等/CAS/CSRF/故障回滚 |
| Quality migration | PASS 3/3 | 空库升级、0011 存量、重复执行、legacy 保留、DDL 失败回滚、约束/索引/数据库 guard |
| Sales PostgreSQL/API | PASS 3/3 | FQC 前置、分批发货、冲销、金额来源、库存/SO 原子性与回滚 |
| Compose lifecycle | PASS | `0001`—`0012`、首次端到端、Web/Worker 重启后 inspection/result/event/audit 持久性 |

## 回归结果

- 共享 unit/UI：70/70。
- Identity 8/8、Master Data 3/3、Inventory 3/3、Procurement 7/7、Production 5/5 PostgreSQL/API 均通过。
- FileStorage 3/3、environment guard 6/6、TASK08 TypeScript typecheck、Vinext build 5/5 通过。
- ESLint 0 error；仅 `物料主数据治理落地包/build_material_workbook.mjs` 保留 1 条任务起点既有 warning。
- 凭证扫描：581 个版本库文件通过。
- Python：`server.py --self-test`、`smoke_test.py`、`go_live_check.py` 均通过。
- `git diff --check` 通过；`0010`/`0011` SHA 未变化，`0012` 最终 SHA-256 为 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`。

## 关键证据

- 失败检验必须在创建事务内附带 FAIL result 与 defect；缺陷累计不能超过 failed quantity。
- 创建人不能处置自己的检验；只有处置后可关闭，只有 manager/admin 可重开。
- Shipment 只消费 `CLOSED/RELEASED` FQC 额度；不足时 `FQC_RELEASE_INSUFFICIENT`，冲销后额度恢复，仍有有效发货时禁止重开。
- IQC/IPQC 创建不改写 Receipt、Report 或 pooled inventory；直接 UPDATE/DELETE quality facts 被数据库拒绝。
- 审计故障、幂等异正文、旧 expected version、错误权限和 CSRF 均 fail closed，关键事务无部分写入。

## 未验证/排除

- 未执行生产 migration、容量压测、真实数据试迁移或部署。
- 未实现批次/隔离库位、AQL/SPC、实验室仪器、供应商索赔、自动退供/报废、返工工艺或完整财务联动。
- 当前 pooled inventory 无法证明某 Receipt Line 的剩余库存，因此 IQC 不伪造全局冻结；该边界必须在批次/库位模型获批后另立任务。
