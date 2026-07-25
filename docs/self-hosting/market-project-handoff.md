# 市场到项目需求交接：数据模型与状态机

适用版本：`chenyida-erp-selfhosted@0.1.0-alpha.15`，PostgreSQL `0015_market_project_handoff.sql`。该模型仅属于自托管 Node/PostgreSQL 运行面。

## 关系模型

| 表 | 权威内容 | 关键约束 |
| --- | --- | --- |
| `business_projects` | 稳定项目、客户、市场/项目负责人、当前状态与 CAS 投影 | `PRJ-########` 唯一；稳定 FK；正 version；ACCEPTED 必须有项目负责人 |
| `project_requirement_versions` | 不可变需求正文版本与内容 SHA-256 | `(project_id, version_no)` 和 `(project_id, content_digest)` 唯一 |
| `project_requirement_items` | 关系化需求行、数量、单位状态、规格与可空 Product 链接 | 行号唯一；正数量；单位 ID/待确认二选一 |
| `project_document_links` | 既有 `material_import_files` 的受控引用与展示元数据 | 版本/文件/类型唯一；不保存路径或正文 |
| `project_handoffs` | MARKET → PROJECT 当前交接投影 | 每项目唯一；固定部门；提交/退回/接收字段与状态一致 |
| `project_handoff_events` | SUBMITTED/RETURNED/RESUBMITTED/ACCEPTED 只追加历史 | 稳定 FK、请求编号；RETURNED 必须有原因 |

Requirement Version、Item 与 Handoff Event 的 UPDATE/DELETE 被数据库触发器拒绝；Project/Handoff 的关键写入必须带 ProjectService 事务守卫。跨项目的 requirement/handoff/document/event 引用由 FK 和触发器共同拒绝。`0015` 不回填旧表、不修改 `0001`—`0014`。

## 状态机

```text
DRAFT --SUBMITTED--> SUBMITTED --ACCEPTED--> ACCEPTED
                           |
                           +--RETURNED--> RETURNED --RESUBMITTED--> SUBMITTED
```

- DRAFT/RETURNED：仅市场负责人可修订；每次保存插入新 requirement version 并 CAS 增加 project version。
- SUBMITTED：需求正文和资料引用不可修改；项目部队列可见。
- RETURNED：保存退回原因与不可变 RETURNED event；市场必须先形成明确修订记录才能重提。
- ACCEPTED：绑定实际接收的 engineering 用户；不触发任何下游对象。
- 提交人与接收人相同会被拒绝；并发接收使用行锁、状态条件和 expected_version，只允许一次成功。

## 事务与安全

所有写接口要求身份权限、CSRF、`Idempotency-Key`、`expected_version`（创建除外）和请求编号。业务投影、需求/事件、系统 Audit 与持久 Idempotency response 在单一 PostgreSQL 事务提交；同 key 不同正文返回 `IDEMPOTENCY_CONFLICT`。响应只包含中文稳定错误、`request_id` 和安全字段，不包含 SQL、堆栈、连接串或存储路径。
