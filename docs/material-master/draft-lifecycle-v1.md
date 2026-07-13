# Material Master V2 草稿生命周期、重新提交与审核队列 V1

状态：`APPROVED_IMPLEMENTED_AND_VERIFIED`

任务：`PHASE1-TASK07`

日期：2026-07-14

目标运行面：`chenyida_erp_site/` 服务端 TypeScript / Cloudflare D1

## 1. 目标

在现有 Material Validation、Draft/Review Service 和受认证授权 API 基础上，补齐物料草稿从创建、修订、提交、审核、驳回、再次修订到重新提交的完整生命周期，并提供有界、可筛选的审核队列。

本规格已于 2026-07-14 获项目负责人确认并完成非生产实现与验证。任何生产 migration、真实数据回填或部署仍需单独授权。

核心状态机为：

```text
DRAFT
  -> PENDING_REVIEW
  -> ACTIVE

PENDING_REVIEW
  -> DRAFT
  -> 修改
  -> PENDING_REVIEW
```

正式内部编码只允许在最终批准、状态原子转为 `ACTIVE` 的事务中生成。

## 2. 当前事实与差异

1. 现有创建 API 和 Draft Service 可创建 `DRAFT`，并写类型化属性、`material_versions`、`material_change_logs` 和 API 审计。
2. 现有 Review Service 直接审核 `DRAFT`；批准转为 `ACTIVE`，驳回仍保持 `DRAFT`。当前没有独立提交动作。
3. 现有数据库和 TypeScript 使用 `PENDING_APPROVAL`，本任务要求领域状态统一为 `PENDING_REVIEW`。
4. 现有 `material_master.updated_by` 表示最近关键操作人。审核驳回会把它改为审核人，因此不能用它判断“最后实质修改人”。
5. 现有 `material_versions` 已允许 `UPDATE`、`SUBMIT`、`APPROVE` 和 `REJECT`；`material_change_logs` 已允许 `UPDATE`、`STATUS_CHANGE`、`APPROVAL` 和 `REJECTION`，不需为这些事件新增同义表。
6. 现有 `material_api_idempotency.method` 只允许 `POST`。新增 `PATCH` 写接口需要前向 migration 扩展该约束，不能修改已执行的 `0002`。
7. 现有只读 Query Service 已支持有界分页、分类路径、当前 metadata 校验、版本和变更日志，可扩展审核队列，但不得把写规则复制进查询层。
8. `0001`、`0002` 尚未执行生产 migration；本任务仍不得连接、迁移或部署生产 D1。

## 3. 方案比较

| 方案 | 说明 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- | --- |
| A. 聚合根保存当前职责字段，历史继续进入版本/日志 | 在 `material_master` 增加 `last_modified_by`、`submitted_by`、`submitted_at`；状态、提交和审核历史继续追加到现有版本与变更日志 | 最小化新模型；审核队列查询直接；与现有版本设计一致 | 当前提交信息会被重新提交覆盖，必须依赖版本表查看历史 | **推荐** |
| B. 新增独立 `material_review_submissions` | 每次提交建立一条独立审核申请，保存提交、校验和决定 | 每次提交周期关系最清晰，适合未来多节点审核 | 当前只批准单步审核；会与既有版本历史重复，扩大本任务范围 | 暂不采用 |
| C. 数据库存 `PENDING_APPROVAL`，API 映射为 `PENDING_REVIEW` | 不改物料状态 CHECK，只在服务/API 做名称转换 | 状态 migration 较轻 | 长期形成两套状态名称，查询、审计和排障容易混淆 | 不推荐 |

推荐采用方案 A，并通过后续版本化 migration 把领域和存储状态统一到 `PENDING_REVIEW`。若项目负责人不批准物理状态更名，则必须明确采用方案 C，并把映射作为临时兼容债务记录，不能在实现时自行选择。

## 4. 状态机

### 4.1 状态定义

| 状态 | 含义 | 可编辑 | 可提交 | 可审核 | 正式编码 |
| --- | --- | ---: | ---: | ---: | --- |
| `DRAFT` | 新建或被驳回后待修订 | 是，按权限 | 是，完整校验通过后 | 否 | 必须为空 |
| `PENDING_REVIEW` | 已提交、等待单步最终审核 | 否 | 否 | 是 | 必须为空 |
| `ACTIVE` | 审核通过的正式物料 | 否 | 否 | 否 | 必须存在且唯一 |

`FROZEN`、`INACTIVE` 继续保留在既有数据库模型中，但不属于本任务的入口、转换或队列范围。

### 4.2 允许转换

| 操作 | 当前状态 | 目标状态 | 版本 | 编码 |
| --- | --- | --- | --- | --- |
| 创建 | 无 | `DRAFT` | `1` | 不生成 |
| 编辑 | `DRAFT` | `DRAFT` | `+1` | 不生成 |
| 提交 | `DRAFT` | `PENDING_REVIEW` | `+1` | 不生成 |
| 批准 | `PENDING_REVIEW` | `ACTIVE` | `+1` | 在同一事务生成 |
| 驳回 | `PENDING_REVIEW` | `DRAFT` | `+1` | 不生成 |
| 驳回后编辑 | `DRAFT` | `DRAFT` | 每次成功编辑 `+1` | 不生成 |
| 重新提交 | `DRAFT` | `PENDING_REVIEW` | `+1` | 不生成 |

### 4.3 禁止转换和动作

- `DRAFT -> ACTIVE`。
- `ACTIVE -> DRAFT` 或 `ACTIVE -> PENDING_REVIEW`。
- `PENDING_REVIEW` 直接编辑。
- `ACTIVE` 直接编辑。
- 删除已有草稿或正式物料。
- 批准或驳回 `DRAFT`。
- 重复提交 `PENDING_REVIEW`。
- 任何浏览器或调用方直接写状态、编码、操作者、版本或审核字段。

## 5. 当前职责字段与历史

推荐在 `material_master` 增加：

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| `last_modified_by` | TEXT NOT NULL | 最近一次真正改变物料业务内容的账号；创建时等于 `created_by` |
| `submitted_by` | TEXT NOT NULL DEFAULT `''` | 最近一次成功提交审核的账号 |
| `submitted_at` | TEXT NULL | 最近一次成功提交审核的服务端 UTC 时间 |

字段职责必须严格区分：

- `created_by`：首次创建人，永久不变。
- `last_modified_by`：最后一次实质内容修改人；只在创建或成功编辑时变化。
- `updated_by`：最近关键写操作人；编辑、提交、批准、驳回都可改变。
- `submitted_by/submitted_at`：最近一次成功提交审核的信息；重新提交时覆盖当前值，历史在 `material_versions` 和 `material_change_logs` 中保留。
- `approved_by/approved_at`：最终批准信息；只有进入 `ACTIVE` 时写入。

提交、批准或驳回不得把审核人或提交人写成 `last_modified_by`。驳回原因、审核人和审核时间不新增可覆盖的“最后驳回”主表字段，使用 `REJECT` 版本的 `change_reason`、`reviewed_by`、`reviewed_at` 和对应变更日志保存。

## 6. 权限与职责分离

### 6.1 拟新增权限

- `material.draft.edit_own`
- `material.draft.edit_any`
- `material.draft.submit`
- `material.review.queue`

继续复用：

- `material.read`
- `material.draft.create`
- `material.review.approve`
- `material.review.reject`

### 6.2 角色矩阵

| 角色 | 查看 | 创建 | 编辑自己的 DRAFT | 编辑任意 DRAFT | 提交 | 审核队列 | 批准/驳回 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `admin` | ✓ | ✓ | ✓ | ✓ | 任意 DRAFT | ✓ | ✓，受职责分离限制 |
| `manager` | ✓ | ✓ | ✓ | ✓ | 任意 DRAFT | ✓ | ✓，受职责分离限制 |
| `purchase` | ✓ | ✓ | ✓ |  | 仅自己创建的 DRAFT |  |  |
| `engineering` | ✓ | ✓ | ✓ |  | 仅自己创建的 DRAFT |  |  |
| 其他现有角色 | ✓ |  |  |  |  |  |  |

提交授权采用组合规则：调用者必须有 `material.draft.submit`，并且满足“自己创建”或同时拥有 `material.draft.edit_any`。这样不额外创造 `submit_own/submit_any` 同义权限。

### 6.3 审核职责分离

批准和驳回都必须满足：

```text
reviewer != created_by
reviewer != last_modified_by
```

不提供 admin 例外或 break-glass。`submitted_by` 不自动成为第三个禁止条件；若提交人既不是创建人也不是最后修改人，按本规格可审核，但此点必须由项目负责人确认。

若仅有两名具备审核角色的人员，而两人又分别成为创建人和最后修改人，可能没有合法审核者。系统必须返回明确错误并保留待办，不能让 admin 绕过。

## 7. 草稿编辑 API

### 7.1 路由

```http
PATCH /api/material-master/drafts/:materialId
```

请求至少包含：

```json
{
  "expected_version": 3,
  "basic_fields": {},
  "category_id": 123,
  "attributes": {}
}
```

### 7.2 请求语义

推荐 V1 采用“完整可编辑聚合替换”语义，而不是逐字段 Merge Patch：

- `basic_fields` 必须包含创建 API 中全部可编辑的业务字段；创建来源 `source_type/source_ref` 不属于可编辑集合。
- `category_id` 必填。
- `attributes` 表示编辑后的完整属性集合；未出现的旧属性将被删除。
- 清空可选字符串使用空字符串，清空 `shelf_life_days` 使用 `null`。
- `source_type`、`source_ref`、`created_by`、`created_at`、`last_modified_by`、`submitted_by`、`submitted_at`、`approved_by`、`approved_at`、`internal_material_code`、`material_status`、`version` 和所有 context/actor 字段不得由客户端指定。

选择完整替换是为了让 Validation、类型化属性写入、属性删除、版本快照和 changed-fields 计算都基于同一个确定聚合。若需要局部字段 PATCH，必须先单独定义删除语义和属性合并规则。

### 7.3 服务规则

1. 认证、临时密码状态、权限、严格 Origin、CSRF、请求大小和 DTO 白名单通过。
2. 读取当前物料；不存在返回 `MATERIAL_NOT_FOUND`。
3. 只允许 `DRAFT`，否则返回 `DRAFT_NOT_EDITABLE`。
4. 校验 own/any 权限；服务端从会话取得操作者。
5. 比较 `expected_version`；不一致返回 `409 VERSION_CONFLICT`。
6. 调用现有 Validation Service。推荐 V1 与现有创建服务保持一致：任一 `ERROR` 阻断保存，`WARNING` 返回但不阻断。若业务要允许保存不完整草稿，需要独立候选存储或明确可持久化错误分类，不能在实现时临时放宽。
7. 重新读取类型化存储 metadata，并使用现有 metadata/属性守卫防止 TOCTOU。
8. 计算规范化后的实际差异。没有任何实质变化时返回 `409 DRAFT_NOT_CHANGED`，不递增版本，也不改变 `last_modified_by`。
9. 在一个 D1 batch 中更新主字段、替换属性、`version + 1`、写 `last_modified_by/updated_by/updated_at/request_id`、追加版本、逐字段变更日志、幂等完成和通用 API 成功审计。
10. 不生成或预留正式编码，不修改创建、提交或批准身份字段。

成功响应建议为 `200`：

```json
{
  "data": {
    "material_id": 456,
    "material_status": "DRAFT",
    "version": 4,
    "internal_material_code": null,
    "last_modified_by": "buyer01",
    "validation_summary": {
      "valid": true,
      "error_count": 0,
      "warning_count": 1
    }
  },
  "operation_id": "...",
  "request_id": "..."
}
```

## 8. 提交审核 API

### 8.1 路由与请求

```http
POST /api/material-master/drafts/:materialId/submit
```

```json
{
  "expected_version": 4,
  "submit_comment": "已补充规格和证明材料"
}
```

`submit_comment` 可选，去空白后最多 1,000 字符；作为 `SUBMIT` 版本和状态变更日志的 `change_reason` 保存，不在主表增加自由文本字段。

### 8.2 服务规则

1. 只允许 `DRAFT`；否则返回 `MATERIAL_NOT_SUBMITTABLE`。
2. 权限与所有权按 6.2 执行。
3. 必须提交并匹配 `expected_version`。
4. 从 D1 重新加载当前主记录和类型化属性，不接受客户端重传业务内容作为提交依据。
5. 使用当前 D1 metadata 执行完整 `validateForReview()`；任一 `ERROR` 返回 `422 MATERIAL_VALIDATION_FAILED`，不写任何记录。
6. 在一个 D1 batch 中把状态改为 `PENDING_REVIEW`、版本递增、写 `submitted_by/submitted_at`、更新 `updated_by/updated_at/request_id`、追加 `SUBMIT` 版本、状态变更日志、幂等完成和 API 成功审计。
7. `last_modified_by` 保持不变；正式编码、批准字段保持为空。
8. 相同幂等请求重放不得重复递增版本；不同 Key 的并发提交只有一个 `expected_version` 能成功。

成功返回 `200`：

```json
{
  "data": {
    "material_id": 456,
    "material_status": "PENDING_REVIEW",
    "version": 5,
    "internal_material_code": null,
    "submitted_by": "buyer01",
    "submitted_at": "2026-07-14T08:00:00.000Z"
  },
  "operation_id": "...",
  "request_id": "..."
}
```

## 9. 审核队列 API

### 9.1 路由与权限

```http
GET /api/material-master/review-queue
```

需要 `material.review.queue`。默认且唯一业务状态为 `PENDING_REVIEW`；V1 不接受任意状态参数，也不把它扩展成第二个通用列表接口。

### 9.2 查询参数

| 参数 | 默认 | 约束 |
| --- | --- | --- |
| `page` | `1` | 正安全整数 |
| `page_size` | `20` | `1..100`，禁止请求全部 |
| `category_id` | 无 | 正安全整数 |
| `source_type` | 无 | Schema 受控值 |
| `creator` | 无 | 精确匹配 `created_by` |
| `submitted_from` | 无 | `YYYY-MM-DD`，UTC 当日起点 |
| `submitted_to` | 无 | `YYYY-MM-DD`，包含该 UTC 整日 |
| `keyword` | 无 | 去空白后 `1..100` 字符 |
| `sort` | `submitted_at_desc` | 固定 allowlist，见下文 |

`submitted_from` 晚于 `submitted_to` 时返回 `REQUEST_VALIDATION_FAILED`。`keyword` 使用参数化并转义的包含查询，覆盖标准名称、制造商和制造商型号；待审核记录没有正式编码，不把空编码作为主要搜索字段。

允许排序：

- `submitted_at_desc`：`submitted_at DESC, id DESC`。
- `submitted_at_asc`：`submitted_at ASC, id ASC`。
- `standard_name_asc`：`standard_name ASC, id ASC`。
- `standard_name_desc`：`standard_name DESC, id DESC`。

禁止把客户端 `sort` 原样拼入 SQL。

### 9.3 响应

```json
{
  "data": [
    {
      "material_id": 456,
      "standard_name": "普通 FR4 覆铜板",
      "category_path": "PCB 材料 / 覆铜板 / 刚性覆铜板 / FR4 覆铜板",
      "creator": "buyer01",
      "last_modified_by": "engineer01",
      "submitted_by": "buyer01",
      "submitted_at": "2026-07-14T08:00:00.000Z",
      "current_version": 5,
      "source_type": "MANUAL",
      "validation_summary": {
        "basis": "CURRENT_METADATA",
        "valid": true,
        "error_count": 0,
        "warning_count": 1,
        "top_issues": []
      }
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 1,
    "total_pages": 1
  },
  "request_id": "..."
}
```

推荐 `validation_summary` 使用当前 D1 metadata，最多返回 5 条安全结构化 issue 摘要；它只帮助审核人排序和发现规则漂移，最终批准仍必须在写事务前重新执行完整校验。查询必须先分页，再仅对当前页做有界批量加载和校验，禁止先校验全部待审记录。

## 10. 现有批准与驳回调整

### 10.1 共同规则

- 只能操作 `PENDING_REVIEW`；`DRAFT` 返回 `MATERIAL_NOT_REVIEWABLE`。
- 继续要求认证、细粒度权限、严格 Origin、CSRF、`Idempotency-Key` 和 `expected_version`。
- 在幂等预留后、调用服务前，从数据库读取 `created_by` 和 `last_modified_by`，分别返回 `SELF_REVIEW_FORBIDDEN` 或 `LAST_EDITOR_REVIEW_FORBIDDEN`。
- 权限和职责分离必须在服务端再次保持不可绕过的边界；页面隐藏按钮不构成控制。

### 10.2 批准

- 从 D1 重载待审物料及当前属性。
- 执行完整 `validateForReview()`；存在 `ERROR` 时阻断。
- 在同一事务中领取编码序列、写唯一正式编码、状态改为 `ACTIVE`、写批准信息、版本、变更日志、幂等完成和 API 审计。
- `last_modified_by`、`submitted_by`、`submitted_at` 保留，供追溯本次批准依据。

### 10.3 驳回

- `reason` 必填，去空白后 `1..1000` 字符；缺失返回 `REVIEW_REASON_REQUIRED`。
- 状态原子改回 `DRAFT`，版本递增，不生成或消耗编码。
- `last_modified_by` 不变；`updated_by` 改为审核人。
- 最近提交字段保留，供详情显示上一轮提交信息；下一次成功提交覆盖当前字段。
- 在 `REJECT` 版本中保存原因、审核人、审核时间和提交版本快照，并写对应变更日志与 API 审计。

## 11. 幂等、CSRF、并发与事务

PATCH、submit、approve、reject 共同要求：

1. 复用现有 ERP 会话认证，不接受客户端操作者。
2. `must_change_password` 账号禁止写。
3. 验证路由权限和 own/any 规则。
4. 验证严格同源 Origin 和现有 host-only 双提交 CSRF。
5. 要求 8..128 字符的 `Idempotency-Key`。
6. 复用现有 24 小时持久幂等、120 秒租约、接管 CAS、完成守卫和有界清理。
7. 幂等作用域继续为 `username + method + concrete path + key digest`；PATCH 的 method 必须参与摘要和唯一作用域。
8. 相同作用域同 Key 不同 canonical 载荷返回 `409 IDEMPOTENCY_CONFLICT`。
9. 每个写请求必须提交 `expected_version`；版本不一致返回 `409 VERSION_CONFLICT`。
10. 继续使用每用户每分钟 60 次物理写尝试和 20 个新 Key；admin 不豁免。
11. 业务记录、属性、状态、版本、变更日志、幂等完成和成功 API 审计必须在一个 D1 batch 中提交；任一守卫失败全部回滚。
12. API 不因版本冲突自动重试业务命令，不覆盖其他用户修改。

## 12. 版本与审计契约

| 动作 | `material_versions.event_type` | `material_change_logs.change_type` | 关键内容 |
| --- | --- | --- | --- |
| 编辑 | `UPDATE` | `UPDATE` | 修改后的完整快照、实际 changed fields、逐字段前后值、操作者 |
| 提交 | `SUBMIT` | `STATUS_CHANGE` | `DRAFT -> PENDING_REVIEW`、提交说明、提交人和时间 |
| 批准 | `APPROVE` | `APPROVAL` + `CODE_ASSIGNMENT` | 待审快照、审核人、编码、`PENDING_REVIEW -> ACTIVE` |
| 驳回 | `REJECT` | `REJECTION` | 待审快照、原因、审核人和时间、`PENDING_REVIEW -> DRAFT` |

要求：

- `material_versions` 每个成功写版本唯一，版本号与 `material_master.version` 一致。
- 编辑日志只记录真正变化的字段；属性字段使用稳定路径，如 `attributes.THICKNESS`。
- 快照可保存历史 JSON，但当前状态、职责字段和审核队列条件必须来自关系化列。
- Material Service 的 `request_id` 继续使用稳定 `operation_id`；通用 API 审计同时保留物理 `request_id`。
- API 审计 route code 新增 `MATERIAL_DRAFT_EDIT`、`MATERIAL_DRAFT_SUBMIT`、`MATERIAL_REVIEW_QUEUE`；幂等重放必须从 method 与完整 route scope 恢复正确动作，不能把新路由误记为创建。
- 不记录原始 Idempotency-Key、Session/CSRF Token、完整请求正文、SQL、堆栈或数据库路径。

## 13. 稳定错误码

| HTTP | Code | 场景 |
| ---: | --- | --- |
| 400 | `REVIEW_REASON_REQUIRED` | 驳回 reason 缺失或为空 |
| 403 | `SELF_REVIEW_FORBIDDEN` | 审核人等于创建人 |
| 403 | `LAST_EDITOR_REVIEW_FORBIDDEN` | 审核人等于最后实质修改人 |
| 409 | `DRAFT_NOT_EDITABLE` | 非 `DRAFT` 执行编辑 |
| 409 | `DRAFT_NOT_CHANGED` | PATCH 规范化后没有实质变化 |
| 409 | `MATERIAL_NOT_SUBMITTABLE` | 非 `DRAFT` 执行提交 |
| 409 | `MATERIAL_NOT_REVIEWABLE` | 非 `PENDING_REVIEW` 执行批准或驳回 |

继续复用：

- `AUTH_REQUIRED`
- `FORBIDDEN`
- `PASSWORD_CHANGE_REQUIRED`
- `CSRF_INVALID`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`
- `IDEMPOTENCY_IN_PROGRESS`
- `VERSION_CONFLICT`
- `MATERIAL_VALIDATION_FAILED`
- `MATERIAL_METADATA_CONFLICT`
- `RATE_LIMITED`
- `REQUEST_VALIDATION_FAILED`
- `MATERIAL_NOT_FOUND`
- `PAYLOAD_TOO_LARGE`
- `UNSUPPORTED_MEDIA_TYPE`
- `INTERNAL_ERROR`

所有错误继续使用 Material API 嵌套响应、中文用户提示和服务端请求编号，不返回内部异常。

## 14. Migration 设计

### 14.1 结论

需要新增版本化 migration；不能只改 TypeScript，也不能修改或重排 `0001`、`0002`。

至少需要处理：

1. `material_master.last_modified_by`。
2. `material_master.submitted_by`。
3. `material_master.submitted_at`。
4. `material_master.material_status` 从旧名 `PENDING_APPROVAL` 向 `PENDING_REVIEW` 的兼容扩展和回填。
5. `material_api_idempotency.method` 从只允许 `POST` 扩展为 `POST`、`PATCH`。
6. 审核队列索引。

### 14.2 扩展、回填、切换、收缩

SQLite/D1 不能原地修改已有 CHECK。实施必须拆分步骤，不能把破坏性收缩与业务切换合并：

1. **扩展**：新增职责字段；重建受 CHECK 约束的表时保留全部原字段、数据、外键和索引，并让状态暂时同时接受 `PENDING_APPROVAL`、`PENDING_REVIEW`，幂等 method 同时接受 `POST`、`PATCH`。
2. **回填**：`last_modified_by` 对既有记录使用 `created_by`。现有代码没有编辑能力，因此这是可验证的保守事实；若发现任何 `PENDING_APPROVAL` 记录，必须先从可信 `SUBMIT` 历史恢复提交人/时间，否则迁移预检失败，不得伪造。
3. **切换**：服务双读旧/新待审状态但只写 `PENDING_REVIEW`；完成隔离数据回填后，队列和审核入口统一使用新状态。
4. **收缩**：移除 `PENDING_APPROVAL` 兼容值属于后续独立 migration；只有确认不存在旧值且所有运行实例已切换后才执行。

具体 migration 编号以实施开始时 journal 为准，当前基线预计从 `0003` 开始。不得在部署启动时自动回填生产业务数据。

### 14.3 字段与索引约束

- `submitted_by` 与 `submitted_at` 必须成对为空或成对有值。
- `PENDING_REVIEW` 必须拥有非空提交人和提交时间，且编码为空。
- `ACTIVE` 继续要求正式编码和批准信息。
- 推荐审核队列索引：
  - `(material_status, submitted_at, id)`
  - `(material_status, category_id, submitted_at, id)`
  - `(material_status, source_type, submitted_at, id)`
  - `(material_status, created_by, submitted_at, id)`
- 实施前必须用隔离 D1 查询计划验证索引；无证据不得增加更多组合索引。

### 14.4 回滚和恢复

- Up 前在受控目标生成可恢复快照；本任务不执行生产快照。
- 空隔离库可使用对应 Down 重建回旧结构。
- 已产生生命周期、版本或审计数据后，生产不使用 Down 丢弃字段；停用新路由并前向修复。
- 表重建必须验证行数、主键、外键、索引、状态分布、版本最大值、提交字段配对和孤儿引用。
- 任何生产 migration、回填、快照、回退或部署仍需单独明确授权。

## 15. 测试方案

全部写测试使用 `ERP_ENV=test` 和本机一次性 Miniflare D1，显式应用版本化 migration，禁止远程绑定、生产 URL 和生产 D1。

### 15.1 服务与 API 必测场景

1. 创建后状态为 `DRAFT`、版本为 1、编码为空，`created_by = last_modified_by`。
2. 创建人可编辑自己的 `DRAFT`。
3. 非创建人没有 own 权限时不能编辑他人草稿。
4. admin/manager 可用 edit-any 编辑草稿，且成为新的 `last_modified_by`。
5. `PENDING_REVIEW` 不能编辑。
6. `ACTIVE` 不能编辑。
7. 缺少必填属性不能提交。
8. 提交成功变为 `PENDING_REVIEW`，写提交人/时间且不改变最后修改人。
9. `DRAFT` 不能直接批准或驳回。
10. `PENDING_REVIEW` 可由合法审核者批准。
11. 批准后只生成一个唯一正式编码。
12. 驳回后回到 `DRAFT`，提交字段保留，编码仍为空。
13. 驳回原因必填。
14. 驳回后可修改并重新提交，当前提交字段被新提交覆盖，历史仍完整。
15. 创建人不能自审。
16. 最后实质修改人不能审核当前版本。
17. 并发编辑只有一个成功。
18. 并发提交只有一个成功。
19. 幂等重放不重复递增版本、不重复写历史。
20. 审核队列只返回 `PENDING_REVIEW`。
21. 审核队列分页、筛选、日期边界、sort allowlist 和确定性次排序正确。
22. 客户端不能伪造操作者、创建人、最后修改人、提交人、审核人、状态、版本或编码。
23. 测试运行器在任何业务写入前拒绝生产 URL、production 环境和远程 D1。

### 15.2 补充边界

- PATCH 完整属性替换会删除已省略的旧属性，并在同一事务写版本/日志。
- PATCH 无实际变化不递增版本。
- 编辑 Validation ERROR 或 metadata 不可用时不产生部分写入。
- 提交前 metadata 改变会重新校验并阻断。
- 提交后、审核前 metadata 改变会在批准时重新校验并阻断。
- approve/reject 并发只有一个成功。
- 创建人与最后修改人相同或不同的职责分离组合均覆盖。
- 合法 reviewer 不足时返回稳定职责分离错误，admin 不能绕过。
- PATCH 与 POST 的相同原始 Key 因 method/route 作用域不同不会互相覆盖。
- 相同 Key 不同 PATCH 载荷返回 `IDEMPOTENCY_CONFLICT`。
- 业务成功但幂等完成、版本、变更日志或 API 审计失败时整体回滚。
- 审核队列只校验当前页，不执行无界 N+1 查询。
- 审计、幂等和错误响应不含敏感正文或 Token。

### 15.3 Migration 测试

- 空库依次升级全部 migration。
- 已有合成 DRAFT/ACTIVE/版本/日志数据升级，记录数和汇总不变。
- 旧 `PENDING_APPROVAL` 合成数据的预检、可恢复回填和失败路径。
- migration 防重和失败回滚。
- 空隔离库 Down 与重新升级。
- 新字段配对约束、状态/编码约束和 `POST/PATCH` method 约束。
- 主表或幂等表重建后的外键、索引、序列和孤儿引用核对。
- 审核队列查询计划使用预期索引。

### 15.4 任务基线

- `npm run lint`
- `npm test`
- `npm run test:api`
- 使用临时 SQLite 运行本地 `environment_guard_test.py`、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py`、`go_live_check.py --no-backup`
- `npm run security:credentials`
- `git diff --check`
- 检查最终差异不包含生产变量、数据库、备份、日志或临时输出

第一阶段文档提交至少运行不写生产数据的现有基线，并确认业务代码、migration 和部署配置没有变化。

## 16. 禁止事项

本任务不包含：

- 前端页面。
- Excel/CSV 导入。
- AI 分类。
- 批量审核。
- 物料停用、冻结或删除。
- break-glass 自审。
- 多节点会签。
- 真实物料迁移。
- BOM、采购、库存或生产修改。
- Legacy Python/SQLite 修改。
- 生产 D1 连接、migration 或部署。
- 修复无关的既有 TypeScript 诊断。

## 17. 已确认实施选择

项目负责人于 2026-07-14 回复“规格确认”，九项选择全部采用方案 A：

1. 是否批准方案 A：主表新增三个当前职责字段，提交/审核历史继续使用现有版本和日志，不新增审核申请表。
2. 是否批准把数据库领域状态从 `PENDING_APPROVAL` 分阶段统一为 `PENDING_REVIEW`；若不批准，是否接受临时 API 映射方案 C。
3. 是否批准 PATCH 使用完整可编辑聚合替换，省略旧属性即删除，而不是局部 Merge Patch。
4. 是否批准 V1 编辑与创建保持同一 Validation 阻断规则；若要允许保存不完整草稿，需另行定义可持久化错误范围。
5. 是否批准“提交人不自动禁止审核”，只禁止创建人和最后实质修改人。
6. 是否批准审核队列 `validation_summary` 使用当前 metadata，并只对当前分页做有界校验。
7. 是否批准 `submit_comment` 可选且只进入 `SUBMIT` 版本与变更日志。
8. 是否批准推荐的权限矩阵和“submit + own/edit-any”组合授权规则。
9. 是否批准 migration 采用扩展、回填、双读切换、后续收缩的分步方案；生产执行仍需另行授权。

补充确认：历史版本、变更日志和 API 审计快照中的旧状态文字不得改写；创建人禁审永久有效，最后实质修改人禁审只针对当前提交版本；审核队列默认只查询 `PENDING_REVIEW`，按 `submitted_at DESC, id DESC` 排序，并须批量加载当前页数据避免明显 N+1；本任务不执行破坏性状态收缩。

## 18. 规格确认后的实施顺序

1. 将确认结果写入 `DECISIONS.md`，把本规格状态改为 `APPROVED`。
2. 形成详细实施计划，冻结 migration 和 API 契约。
3. 先实现并验证扩展/回填 migration、Drizzle schema、snapshot/journal 和迁移测试。
4. 扩展 Material Types、Repository、Draft/Edit/Submit/Review Service，并保持单一业务写边界。
5. 扩展 Material API 路由、权限、CSRF、幂等 method/route、错误和审核队列 Query Service。
6. 完成服务、迁移、并发和一次性 Miniflare HTTP 测试。
7. 运行完整非生产基线，更新项目文档并创建独立功能提交。

任何生产 migration、真实数据回填或部署不在上述实施授权内。

## 19. 实施结果

2026-07-14 已按九项方案 A 完成非生产实现：

- `0003_material_draft_lifecycle.sql` 增加三个职责字段、双状态过渡约束、PATCH 幂等 method 和审核队列索引；可恢复旧待审记录会转为 `PENDING_REVIEW`，无法可靠恢复提交职责时预检失败。
- 服务端实现完整替换 PATCH、提交、驳回后编辑/重新提交和有界审核队列；批准/驳回只接受 `PENDING_REVIEW`。
- 权限、创建人/最后修改人职责分离、CSRF、24 小时幂等、60/20 限流、乐观锁、版本、变更日志和 API 审计均已接入。
- 隔离 D1 的迁移、Down/重升、失败回滚、并发 PATCH/提交/审核和一次性 HTTP smoke 已通过。

OpenAPI 契约见 `docs/material-master/draft-lifecycle-v1.openapi.yaml`。本次未连接、迁移或部署生产 D1；`PENDING_APPROVAL` 收缩仍须独立任务和生产授权。
