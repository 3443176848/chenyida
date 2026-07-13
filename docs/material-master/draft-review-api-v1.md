# Material Master V2 Draft/Review API V1

状态：`APPROVED_IMPLEMENTED_AND_VERIFIED`

任务：`PHASE1-TASK06`

日期：2026-07-13

后续修订：`PHASE1-TASK07` 已于 2026-07-14 扩展草稿生命周期。涉及编辑、提交、审核队列、`PENDING_REVIEW`、职责分离和 migration 的内容，以 [draft-lifecycle-v1.md](./draft-lifecycle-v1.md) 及其 [OpenAPI 契约](./draft-lifecycle-v1.openapi.yaml) 为准。

目标运行面：`chenyida_erp_site/` 服务端 TypeScript / Cloudflare D1

## 1. 目标

通过受认证、受授权、具备 CSRF 防护、持久幂等、乐观锁和审计的服务端 API，开放现有 Material Master Draft/Review Service。

本规格已于 2026-07-14 获项目负责人确认并完成非生产实现。任何生产 migration、真实数据操作或部署仍需单独授权。

API 层必须调用现有 `material-validation` 和 `material-master` 服务，不得复制创建、校验、状态转换或正式编码规则。

## 2. 当前代码事实

1. 在线 ERP 的实际身份源是 `app_users`、`app_sessions` 和 `CYD_ERP_SESSION`，不是未被 ERP 调用的 `chatgpt-auth.ts`。
2. 会话 Token 只以 SHA-256 摘要保存；Cookie 为 `HttpOnly`、`SameSite=Lax`，HTTPS 时增加 `Secure`，会话采用 8 小时滑动过期。
3. 当前角色只有粗粒度 `read`、`material` 等权限；未知 POST 路径会回退到 `read`，新 Material 写路由必须显式匹配，不能使用该默认分支。
4. 当前没有 Origin 或 CSRF Token 校验；`SameSite=Lax` 不能单独满足本任务要求。
5. 现有 `idempotency_keys` 没有请求摘要和处理状态，以全局 `key` 为主键，并采用“先查、业务执行、后 `INSERT OR REPLACE`”流程，不能防止同 Key 异载荷、并发重复或业务提交后的崩溃窗口。
6. 现有 Material Draft/Review Service 已实现创建、批准、驳回、审核前重校验、乐观锁、编码 CAS、版本和 `material_change_logs`；API 只能构造可信命令并调用这些服务。
7. 现有 Material Repository 没有列表、分类路径、版本历史或变更日志查询能力；GET API 需要独立的只读 Query Repository/Service。

## 3. 范围与禁止事项

### 3.1 本任务实施阶段包含

- 八个 Draft/Review/Lifecycle 路由。
- 复用现有会话认证，增加细粒度 Material 权限。
- 五个写路由的严格同源与 CSRF 校验。
- 创建、批准、驳回的持久幂等和并发占位。
- 现有 Material Service 到 HTTP 契约的适配。
- 草稿列表和详情只读 Query Service。
- 稳定错误映射、请求编号和脱敏审计。
- 版本化扩展 migration、迁移测试和一次性 Miniflare D1 API 测试。

### 3.2 禁止

- 前端页面开发。
- Excel/CSV 导入、AI 分类、批量审核或草稿修订。
- 停用、删除、BOM、采购、库存或生产 API 修改。
- Legacy Python/SQLite 修改。
- 真实物料迁移、生产 D1 连接、生产 migration 或部署。
- 修改已执行的 `0000`、`0001` migration。
- 修复无关的既有 TypeScript 问题。
- 创建第二套登录或身份体系。

## 4. 方案比较与结论

| 方案 | 说明 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- | --- |
| A. Catch-all 先识别 namespace，再分发到独立 Material API 模块 | 保留 `/api/[...path]` 入口；先识别 Material namespace 并生成服务端请求编号，再由专用模块完成认证、授权和后续适配 | 复用现有会话和 Worker/D1 注入；Material 的 401/403/500 也能使用专用契约；避免继续把业务 SQL 塞进 1,415 行处理器 | 需要为成功写入向现有事务增加受控的幂等/通用审计伴随项 | **推荐** |
| B. 直接在 `erp-api.ts` 增加分支并复用 `idempotency_keys` | 沿用现有集中式函数和后置记忆逻辑 | 表面改动少 | 权限默认回退不安全；现有幂等语义不合格；继续扩大单文件；崩溃和并发窗口未解决 | 不采用 |
| C. 新建独立 Next/Vinext 路由和身份中间件 | 每个 Material 路由使用独立 route 文件 | 路由物理隔离 | 容易复制会话、权限、错误和 D1 绑定；形成第二套安全边界；改动面大 | 不采用 |

实施采用方案 A。`erp-api.ts` 在 legacy 请求编号和默认权限逻辑之前，以 `path === "/api/material-master" || path.startsWith("/api/material-master/")` 识别 namespace：

1. 每次物理 HTTP 尝试生成新的服务端 UUID `request_id`，不接受客户端值作为权威编号。
2. Material namespace 由专用 responder 处理认证、密码状态、授权、路由、错误和未知异常；401/403/404/500 都使用本规格嵌套格式。
3. Material namespace 不进入未知 POST 的默认 `read` 权限回退。
4. legacy 路径继续使用现有请求编号、权限和扁平错误格式，避免破坏现有页面。

Material HTTP 适配、只读查询和安全组件放在边界明确的新模块中；现有会话解析逻辑可以提取为共享函数，但不得复制身份体系。

## 5. API 路由

| 方法 | 路由 | 权限 | CSRF | Idempotency-Key |
| --- | --- | --- | --- | --- |
| `POST` | `/api/material-master/drafts` | `material.draft.create` | 必须 | 必须 |
| `GET` | `/api/material-master/drafts` | `material.read` | 不需要 | 不需要 |
| `GET` | `/api/material-master/drafts/:id` | `material.read` | 不需要 | 不需要 |
| `PATCH` | `/api/material-master/drafts/:id` | `material.draft.edit_own` 或 `material.draft.edit_any` | 必须 | 必须 |
| `POST` | `/api/material-master/drafts/:id/submit` | `material.draft.submit` 且满足 own/edit-any | 必须 | 必须 |
| `GET` | `/api/material-master/review-queue` | `material.review.queue` | 不需要 | 不需要 |
| `POST` | `/api/material-master/drafts/:id/approve` | `material.review.approve` | 必须 | 必须 |
| `POST` | `/api/material-master/drafts/:id/reject` | `material.review.reject` | 必须 | 必须 |

动态 `:id` 只接受十进制正安全整数。Material namespace 采用显式方法和完整路径模板匹配；任何未知 Material 路径返回 `404 NOT_FOUND`，合法路径使用错误方法返回 `405 METHOD_NOT_ALLOWED`，均不回退到 legacy `read` 权限。

为保证 Material 的错误方法也进入专用 responder，catch-all 显式转发 `PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`；其中仅草稿详情路径按 TASK07 契约支持 `PATCH`，其他未声明的方法仍返回嵌套 405。`HEAD` 按 HTTP 语义返回无正文 405，并通过 `X-Request-Id` 与 `X-Error-Code: METHOD_NOT_ALLOWED` 暴露稳定结果。legacy namespace 保持现有扁平 405，不执行任何业务写入。

## 6. 公共 HTTP 契约

### 6.1 请求约束

- 写请求必须为 `Content-Type: application/json`；其他媒体类型返回 `415 UNSUPPORTED_MEDIA_TYPE`。
- 写请求正文上限为 64 KiB；超过上限返回 `413`。
- JSON 对象中未声明字段一律拒绝，避免静默接收伪造身份或未来字段。
- `Idempotency-Key` 为 8 至 128 个 ASCII 字符，只允许字母、数字、`.`、`_`、`:`、`-`。
- `X-CSRF-Token` 只放请求头，不得出现在 URL。
- 服务端为每次 HTTP 尝试生成 UUID `request_id`；客户端 `X-Request-Id` 不作为权威请求编号。
- 每个通过幂等预留的写操作另有稳定 UUID `operation_id`。Material Service 的 `context.request_id` 使用 `operation_id`，使物料版本/变更日志关联同一逻辑写操作。

### 6.2 成功响应

所有新 Material API 成功响应包含 `data`（按路由可以是对象或数组）和本次物理请求的 `request_id`：

```json
{
  "data": {},
  "request_id": "3e0f8422-5060-44ca-8fa8-540da49e73e8"
}
```

三个写响应还包含稳定的 `operation_id`。幂等重放返回首次业务状态码、`data` 或安全错误结果以及同一 `operation_id`，但使用本次重放尝试的新 `request_id`；因此请求追踪元数据可以变化，业务结果不得变化。

同时返回：

- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: no-store`
- `X-Request-Id: <request_id>`
- 幂等重放时增加 `Idempotency-Replayed: true`

### 6.3 错误响应

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "物料已被其他用户修改，请刷新后重试",
    "request_id": "3e0f8422-5060-44ca-8fa8-540da49e73e8",
    "details": []
  }
}
```

新格式只应用于本任务的 Material API；不得全局替换 legacy 错误格式，以免破坏现有页面对 `data.error` 字符串的读取。

`details` 始终是数组。非 Validation 错误通常为 `[]`；Validation 失败按服务的稳定顺序合并为 `errors` 后接 `warnings`，每项保持以下安全结构：

```json
{
  "code": "MATERIAL_ATTRIBUTE_REQUIRED",
  "severity": "ERROR",
  "field": "attributes.THICKNESS",
  "message": "缺少必填属性：厚度",
  "attribute_code": "THICKNESS",
  "metadata": {}
}
```

`attribute_code` 和 `metadata` 没有值时省略。已建立幂等预留的写错误另返回 `error.operation_id`。

## 7. 创建草稿

### 7.1 请求

```http
POST /api/material-master/drafts
Origin: https://example.invalid
X-CSRF-Token: <token>
Idempotency-Key: mm-create-20260713-0001
Content-Type: application/json
```

```json
{
  "basic_fields": {
    "standard_name": "普通 FR4 覆铜板",
    "unit": "PCS",
    "source_type": "MANUAL",
    "source_ref": "",
    "brand": "KINGBOARD",
    "manufacturer": "KINGBOARD",
    "manufacturer_part_number": "KB-6160",
    "procurement_type": "PURCHASE",
    "inventory_type": "STOCKED",
    "lot_control_required": true,
    "shelf_life_days": 365,
    "inspection_type": "NORMAL",
    "environmental_requirement": "ROHS"
  },
  "category_id": 123,
  "attributes": {
    "THICKNESS": {
      "value": 1.6,
      "unit": "mm",
      "source": "MANUAL",
      "confidence": 1
    }
  }
}
```

任务附件中的简化示例没有包含现有 Draft Service 要求的采购、库存、检验和环保字段。API 不得私自补业务默认值，因此上述四个字段必须由客户端明确提交。

字段边界：

- `standard_name`：去空白后 `1..200` 字符。
- `unit`：去空白后 `1..32` 字符。
- `brand`、`manufacturer`、`manufacturer_part_number`：可选，各不超过 200 字符。
- `procurement_type`、`inventory_type`、`inspection_type`、`environmental_requirement`：必须属于已批准 Schema 值集。
- `lot_control_required`：可选原生布尔值；省略时沿用现有服务的 `false`。
- `shelf_life_days`：可选非负安全整数或 `null`；省略时沿用现有服务的 `null`。
- `source_ref`：可选，最长 255 字符，不允许控制字符；为空时由服务端生成。
- `attributes`：必须是 code 索引对象，最多 128 项；属性 code、原生类型、单位和枚举继续由 Validation Service 权威校验。
- 属性文本值最长 1,000 字符，`unit` 最长 32 字符；API 只做请求大小与形态保护，不改变 Validation 的业务结论。

### 7.2 API 到现有服务的映射

| 公共 API 字段 | `CreateMaterialDraftCommand` |
| --- | --- |
| `category_id` | `basic_fields.category_id` |
| `basic_fields.source_type` | 顶层 `source_type` |
| 其余 `basic_fields` | 对应服务 `basic_fields` |
| `attributes` | 原样交给现有服务校验和类型化存储 |
| 当前会话 `username` | `context.actor` |
| 幂等预留生成的稳定 `operation_id` | `context.request_id` |

V1 人工 API 只接受 `source_type = MANUAL`；`LEGACY_D1`、`LEGACY_SQLITE`、`GOVERNANCE_TEMPLATE` 和 `API` 属于后续受控适配器，不得通过此人工入口伪造。

`source_ref` 为空或省略时，适配器使用稳定逻辑操作编号生成 `request:<operation_id>`；非空时按上述长度和控制字符规则透传。属性 `source` 省略时由现有服务继承物料来源，提供时 V1 同样只允许 `MANUAL`。`confidence` 若提供，必须是 `0..1` 的有限数值；它仍不参与 Validation 决策。

以下客户端字段在任何层级出现时返回 `REQUEST_VALIDATION_FAILED`，不能静默忽略：

- `actor`
- `context`
- `request_id`
- `created_by`
- `updated_by`
- `approved_by`
- `reviewed_by`
- `internal_material_code`
- `material_status`
- `version`
- `attribute_id`

### 7.3 响应

成功返回 `201`：

```json
{
  "data": {
    "material_id": 456,
    "material_status": "DRAFT",
    "version": 1,
    "internal_material_code": null
  },
  "operation_id": "6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c",
  "request_id": "3e0f8422-5060-44ca-8fa8-540da49e73e8"
}
```

API 必须调用现有 `createDraft()`；草稿没有正式编码。Validation `ERROR` 映射为 `422 MATERIAL_VALIDATION_FAILED`，结构化 issues 放入 `details`。

## 8. 草稿列表

### 8.1 查询参数

| 参数 | 默认 | 约束 |
| --- | --- | --- |
| `page` | `1` | 正整数 |
| `page_size` | `20` | `1..100`；禁止使用 `0`、负数或特殊值请求全部数据 |
| `material_status` | `DRAFT` | `DRAFT`,`PENDING_APPROVAL`,`ACTIVE`,`FROZEN`,`INACTIVE` |
| `category_id` | 无 | 正整数 |
| `source_type` | 无 | Schema 受控值 |
| `keyword` | 无 | 去空白后 `1..100` 字符 |
| `created_by` | 无 | 现有账号名格式 |
| `created_from` | 无 | `YYYY-MM-DD`，按 UTC 当日 `00:00:00.000Z` 起算 |
| `created_to` | 无 | `YYYY-MM-DD`，包含该 UTC 日期整日 |

`created_from` 晚于 `created_to` 时返回 `REQUEST_VALIDATION_FAILED`。`keyword` 使用参数化、转义后的包含查询，覆盖标准名称、正式编码、制造商和制造商型号；不得拼接 SQL。

固定排序为 `created_at DESC, id DESC`，保证同一数据快照内的确定性顺序。V1 使用 page/offset 语义；并发创建或状态变化可能使相邻页出现重复或遗漏，因此不承诺跨请求快照一致性。客户端对审核队列执行批量动作前必须按详情中的当前版本再次确认，不能把列表页视为锁定快照。

响应包含总数和总页数：

```json
{
  "data": [
    {
      "material_id": 456,
      "internal_material_code": null,
      "standard_name": "普通 FR4 覆铜板",
      "category_id": 123,
      "category_name": "FR4 覆铜板",
      "material_status": "DRAFT",
      "source_type": "MANUAL",
      "version": 1,
      "created_by": "buyer01",
      "created_at": "2026-07-13T08:00:00.000Z",
      "updated_at": "2026-07-13T08:00:00.000Z"
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

## 9. 草稿详情

```http
GET /api/material-master/drafts/456?version_page=1&version_page_size=50&change_log_page=1&change_log_page_size=50
```

四个历史参数均默认 page `1`、page_size `50`，page_size 上限 `100`。版本历史和变更日志独立分页，禁止无界返回。

响应示例：

```json
{
  "data": {
    "material": {
      "material_id": 456,
      "internal_material_code": null,
      "category_id": 123,
      "standard_name": "普通 FR4 覆铜板",
      "unit": "PCS",
      "brand": "KINGBOARD",
      "manufacturer": "KINGBOARD",
      "manufacturer_part_number": "KB-6160",
      "procurement_type": "PURCHASE",
      "inventory_type": "STOCKED",
      "lot_control_required": true,
      "shelf_life_days": 365,
      "inspection_type": "NORMAL",
      "environmental_requirement": "ROHS",
      "source_type": "MANUAL",
      "source_ref": "request:6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c",
      "material_status": "DRAFT",
      "version": 3,
      "created_by": "buyer01",
      "created_at": "2026-07-13T08:00:00.000Z",
      "updated_by": "manager01",
      "updated_at": "2026-07-13T09:00:00.000Z",
      "approved_by": "",
      "approved_at": null
    },
    "attributes": [
      {
        "attribute_code": "THICKNESS",
        "data_type": "DECIMAL",
        "value": 1.6,
        "unit": "mm",
        "source_type": "MANUAL",
        "source_ref": "request:6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c"
      }
    ],
    "category_path": [
      { "category_id": 1, "category_code": "PCB", "category_name": "PCB 材料", "level": 1 },
      { "category_id": 12, "category_code": "CCL", "category_name": "覆铜板", "level": 2 },
      { "category_id": 45, "category_code": "RIGID", "category_name": "刚性覆铜板", "level": 3 },
      { "category_id": 123, "category_code": "FR4", "category_name": "FR4 覆铜板", "level": 4 }
    ],
    "validation": {
      "basis": "CURRENT_METADATA",
      "validated_at": "2026-07-13T09:30:00.000Z",
      "valid": true,
      "errors": [],
      "warnings": []
    },
    "versions": {
      "items": [
        {
          "version": 3,
          "event_type": "REJECT",
          "change_reason": "缺少供应商材料证明",
          "changed_fields": ["review_result"],
          "snapshot": {},
          "changed_by": "manager01",
          "reviewed_by": "manager01",
          "reviewed_at": "2026-07-13T09:00:00.000Z",
          "created_at": "2026-07-13T09:00:00.000Z",
          "operation_id": "6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c"
        }
      ],
      "pagination": { "page": 1, "page_size": 50, "total": 3, "total_pages": 1 }
    },
    "change_logs": {
      "items": [
        {
          "change_type": "REJECTION",
          "field_name": "REJECT",
          "old_value": null,
          "new_value": { "result": "REJECT", "material_status": "DRAFT" },
          "change_reason": "缺少供应商材料证明",
          "changed_by": "manager01",
          "created_at": "2026-07-13T09:00:00.000Z",
          "operation_id": "6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c"
        }
      ],
      "pagination": { "page": 1, "page_size": 50, "total": 1, "total_pages": 1 }
    }
  },
  "request_id": "..."
}
```

`snapshot_json`、`changed_fields_json`、`old_value_json` 和 `new_value_json` 必须在服务端解析并验证后分别返回 `snapshot` 对象、`changed_fields` 数组、`old_value` 和 `new_value`；不得把原始 JSON 字符串直接暴露。响应不得包含内部 `reviewGuard`、metadata guard、SQL 或 D1 行结构。

详情 Validation 必须复用与审核服务相同的 `MaterialRecord -> MaterialValidationInput` 纯映射；实施时应把当前审核服务私有映射提取为共享函数，不得复制校验规则。

不存在的 ID 返回 `404 MATERIAL_NOT_FOUND`。

## 10. 审核通过

### 10.1 请求

```json
{
  "expected_version": 3,
  "review_comment": "规格和证明材料已核对"
}
```

- `expected_version` 必须是正安全整数。
- `review_comment` 可选，最大 1,000 字符，映射到现有 Review Service 的 `reason`。
- `material_id` 只来自 URL。
- 审核人只来自当前服务端会话。

API 必须调用现有 `approveDraft()`。该服务从 D1 重载草稿、重新调用 `validateForReview()`、执行 `expected_version` 乐观锁，并在原子 batch 中生成唯一正式编码和转为 `ACTIVE`。API 不得直接调用 Repository 的批准写方法。

成功返回 `200`：

```json
{
  "data": {
    "material_id": 456,
    "material_status": "ACTIVE",
    "version": 4,
    "internal_material_code": "CYD-PCB-FR4-000001"
  },
  "operation_id": "6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c",
  "request_id": "..."
}
```

## 11. 审核驳回

请求：

```json
{
  "expected_version": 3,
  "reason": "缺少供应商材料证明"
}
```

- `reason` 必须是去空白后 `1..1000` 字符。
- API 必须调用现有 `rejectDraft()`。
- 成功后保持 `DRAFT`、版本递增、不生成或消耗编码，并由现有服务写入 `material_versions` 和 `material_change_logs`。

成功返回 `200`：

```json
{
  "data": {
    "material_id": 456,
    "material_status": "DRAFT",
    "version": 4,
    "internal_material_code": null
  },
  "operation_id": "6fb49bf5-fbb4-4b60-90cc-3a2da16ed52c",
  "request_id": "..."
}
```

## 12. 认证与权限

### 12.1 认证

- 继续使用现有 ERP `app_users` / `app_sessions` 和 `CYD_ERP_SESSION`。
- 不使用 `chatgpt-auth.ts` Header 身份代替 ERP 用户，不创建第二套登录。
- 未登录、会话过期或用户停用统一返回 `401 AUTH_REQUIRED`。
- `must_change_password = true` 的账号可以调用两个只读路由，但三个 Material POST 返回 `403 PASSWORD_CHANGE_REQUIRED`；临时密码账号不得创建或审核主数据。
- `actor`、`created_by`、`approved_by`、`reviewed_by` 必须来自服务端会话 `username`。

### 12.2 路由权限矩阵

| 操作 | `material.read` | `material.draft.create` | `material.review.approve` | `material.review.reject` |
| --- | ---: | ---: | ---: | ---: |
| 列表/详情 | ✓ |  |  |  |
| 创建草稿 |  | ✓ |  |  |
| 审核通过 |  |  | ✓ |  |
| 审核驳回 |  |  |  | ✓ |

每个请求在服务端独立校验；页面隐藏按钮不构成授权。已登录但无权限返回 `403 FORBIDDEN`。

### 12.3 现有角色拟议映射

| 角色 | read | draft.create | review.approve | review.reject | 状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| `admin` | ✓ | ✓ | ✓ | ✓ | 禁止自审，无紧急例外 |
| `manager` | ✓ | ✓ | ✓ | ✓ | 禁止自审 |
| `purchase` | ✓ | ✓ |  |  | 沿用现有 `material` 能力 |
| `engineering` | ✓ | ✓ |  |  | 沿用现有 `material` 能力 |
| `production` | ✓ |  |  |  | 只读 |
| `warehouse` | ✓ |  |  |  | 只读 |
| `quality` | ✓ |  |  |  | 只读；多节点审核未确认 |
| `sales` | ✓ |  |  |  | 只读 |
| `finance` | ✓ |  |  |  | 只读 |
| `operations` | ✓ |  |  |  | 只读 |

`material.read` 映射所有现有角色，`material.draft.create` 映射 `admin`、`manager`、`purchase`、`engineering`。批准和驳回只映射 `admin`、`manager`，且所有角色都禁止审核自己创建的草稿。V1 不提供 admin 紧急自审例外。

## 13. CSRF 防护

三个 Material POST 的执行顺序统一为：认证、`must_change_password`、精确路由权限、严格 Origin、CSRF、受限正文/Key 解析、物理尝试限流、幂等、新 Key 限流、输入适配、服务调用。

采用“严格 Origin + host-only 双提交 Token”方案，不新增第二套会话：

1. setup/login 成功时总是生成并轮换至少 256 bit 随机 Token；已认证 `/api/session` 只在 Cookie 缺失时补发当前页面所需 Token。
2. Token 写入 host-only `CYD_ERP_CSRF` Cookie，不设置 `Domain`；Cookie 为 `Path=/; SameSite=Strict`，HTTPS 时必须 `Secure`，并允许同源 JavaScript 读取。
3. CSRF Cookie 的 `Max-Age` 不超过当前会话剩余期限。会话响应同时返回 `csrf_token`，客户端在 Material POST 的 `X-CSRF-Token` Header 中发送。
4. 服务端要求 `Origin` 存在且与请求 URL 的 origin 完全相同。
5. 服务端常量时间比较 Header 与 CSRF Cookie；任一缺失、不一致或 Origin 异源均返回 `403 CSRF_INVALID`。
6. logout、当前用户修改密码、管理员重置密码或其他会话撤销路径清除当前响应可触达的 CSRF Cookie；其他浏览器中遗留的 CSRF Cookie 没有身份能力，其 Session 失效后不能调用 API。
7. 新登录必须轮换 Token，禁止沿用旧账号或旧会话留下的 Cookie 值。
8. Token 不进入 URL、审计、错误详情或日志。

Session Cookie 继续保持 `HttpOnly`。CSRF Cookie 不是身份凭证，不能单独认证用户。既有其他 POST 的 CSRF 治理属于独立安全债务；本任务只修改新增三个 Material 写路由及取得 Token 所需的最小会话响应。

## 14. 幂等设计

### 14.1 结论

需要新增专用 `material_api_idempotency` 表。现有 `idempotency_keys` 不可直接复用，也不得修改 `0000` 来改变其历史语义。

原因：现表没有请求摘要和处理状态，全局单列主键与任务要求的用户/接口作用域不符，`INSERT OR REPLACE` 会覆盖记录，后置保存存在并发和崩溃窗口，且没有实际清理流程。

### 14.2 请求作用域与摘要

- 作用域：`username + method + 规范化具体路径 + key_digest`。
- 相同原始 Key 可由不同用户或不同具体路径独立使用；同一用户、同一路径的 Key 才构成同一幂等作用域。
- `key_digest = SHA-256(Idempotency-Key)`；D1 和审计均不保存原始 Key。
- `request_digest = SHA-256(method + "\n" + 规范化具体路径 + "\n" + canonical_json)`。
- `canonical_json` 对对象键递归排序，保留数组顺序、JSON 类型和数值语义；不包含 Cookie、CSRF Token、Session Token 或服务端 actor。
- 创建时 `source_ref` 缺失与空字符串规范化为同一值，避免服务端生成请求编号导致重试摘要变化。
- 首次预留生成稳定 `operation_id`；每次 HTTP 尝试仍有独立 `request_id`。现有 Material Service 的 `context.request_id` 使用 `operation_id`，通用 API 审计同时保存两者。

### 14.3 表设计

计划在经批准的 `0002_material_draft_review_api.sql` 中新增：

| 字段 | 约束/用途 |
| --- | --- |
| `id` | INTEGER PK |
| `username` | 登录账号，外键引用 `app_users.username`，`ON DELETE RESTRICT` |
| `method` | `TEXT NOT NULL CHECK(method = 'POST')` |
| `route_scope` | 规范化具体路径，非空且最长 255 字符 |
| `key_digest` | `TEXT NOT NULL`，长度 64 的小写 SHA-256 十六进制摘要 |
| `request_digest` | `TEXT NOT NULL`，长度 64 的小写 SHA-256 十六进制摘要 |
| `operation_id` | 稳定 UUID，唯一且非空 |
| `state` | `TEXT NOT NULL CHECK(state IN ('PENDING','COMPLETED'))` |
| `lease_token_digest` | 当前执行租约的 SHA-256 摘要，服务端不保存或返回原始租约 Token |
| `lease_expires_at` | `PENDING` 时为正整数 epoch 秒；租约固定 120 秒 |
| `status_code` | `COMPLETED` 时必填且 `100..599` |
| `response_json` | `COMPLETED` 时为合法 JSON；保存不含物理 `request_id` 的稳定业务响应模板 |
| `material_id` | 字段可空并外键引用 `material_master.id`、`ON DELETE RESTRICT`；2xx Material 成功结果必须非空并由事务守卫验证 |
| `old_version` / `new_version` | 可空非负/正整数，审核成功时必须对应预期版本和新版本 |
| `created_at` / `updated_at` | 服务端 UTC ISO-8601 时间，非空 |
| `expires_at` | `COMPLETED` 时为正整数 epoch 秒；`PENDING` 不用它清理 |

唯一约束：

```text
(username, method, route_scope, key_digest)
```

索引：

- `(state, expires_at)` 用于清理。
- `(state, lease_expires_at)` 用于发现长期失联的 `PENDING`。
- `operation_id` 用于业务与 API 审计追踪。

状态 CHECK 还必须保证：

- `PENDING`：`lease_token_digest` 为 64 位摘要、`lease_expires_at > 0`、`status_code/response_json/expires_at` 为空。
- `COMPLETED`：`status_code/response_json/expires_at` 非空；保留完成者的 `lease_token_digest` 供事务守卫核对，`lease_expires_at` 清空。
- `response_json` 只保存本规格允许的成功或脱敏错误字段，不保存 Header、Cookie、Token、原始 Key 或请求正文。
- API 使用当前认证身份写入 `username`，并通过外键和服务端等值检查防止跨用户占位。

### 14.4 状态与并发流程

1. 通过认证、密码状态、权限、CSRF、基础 JSON/Key 解析和 14.5 的物理尝试限流后，先定向删除同作用域且已过 24 小时的 `COMPLETED` 行；若不存在可重放记录，再取得新 Key 槽并插入 `PENDING`、`operation_id` 和 120 秒租约。未过期结果继续重放，`PENDING` 不得被此步骤删除。
2. 首次插入成功者才可调用 Material Service。
3. 同作用域同 Key 已存在时：
   - `request_digest` 不同：返回 `409 IDEMPOTENCY_CONFLICT`。
   - 摘要相同且 `COMPLETED`：原状态码、稳定业务响应和原 `operation_id` 重放；响应使用本次 HTTP 尝试的新 `request_id`，不执行服务。
   - 摘要相同且有效租约仍为 `PENDING`：返回 `409 IDEMPOTENCY_IN_PROGRESS` 和 `Retry-After`，不执行服务。
   - 摘要相同且租约已过期：以 `id + PENDING + old_lease_token_digest + lease_expires_at` CAS 领取新租约摘要。旧执行者稍后提交时，完成守卫失败并使整个旧业务 batch 回滚。
4. API 通过服务命令携带只读、受信的 `MaterialApiTransactionCompanion`，至少包含幂等记录 ID、物理 `request_id`、稳定 `operation_id`、请求摘要、Key 摘要、路由 code 和租约 Token。客户端不能构造该对象。
5. Repository 在候选 `material_id`、正式编码和新版本已经确定、但 batch 尚未提交时，调用共享纯序列化函数生成稳定成功响应模板。模板只含 `data` 和 `operation_id`；物理 `request_id` 由每次 HTTP responder 添加，因此无需在业务提交后补写响应。
6. 现有 Material Repository 的业务 batch 追加：
   - 条件更新幂等记录：以 `id + PENDING + lease_token_digest + request_digest` 改为 `COMPLETED`，保存响应模板、物料 ID、旧/新版本、状态码和 24 小时过期时间。
   - 通用成功审计插入兼作约束守卫：关键非空字段从一个同时验证 `state = COMPLETED`、完成者 `lease_token_digest`、`request_digest`、`operation_id`、目标物料、版本和响应模板的标量子查询取得。条件不满足时子查询返回 `NULL`，触发 `audit_log.username NOT NULL` 或新增关键列约束失败。
7. 单独的条件 `UPDATE` 命中 0 行不会让 SQLite/D1 batch 失败，因此第 6 步的约束守卫是强制要求，不能只检查 `meta.changes` 或在 batch 后补偿。
8. 任一伴随写或守卫失败，业务记录、版本、`material_change_logs`、最终批准 batch 内的序列领取、幂等完成和通用成功审计全部回滚。现有编码服务为跳过已占用正式编码而在最终批准 batch 之前独立提交的序列推进，继续按 D-011 的“不回收占用序号”语义保留，不宣称回滚。
9. 该调整只给现有 Repository 增加可选的受信事务伴随上下文和共享响应序列化，不改变 Draft/Review 的 SQL 规则、Validation、状态或编码语义；API 仍调用现有 Service。
10. 在业务 batch 前确定的 4xx 使用独立 D1 batch 完成；该 batch 必须以 `id + PENDING + lease_token_digest + request_digest` 条件更新并追加与成功路径同等级的非空子查询守卫及失败审计。失去租约的执行者不得写错误结果。认证、权限或 CSRF 等发生在预留前的拒绝只写通用审计，不创建幂等记录。
11. 对任何服务异常，API 先重新读取幂等记录：
    - 已为 `COMPLETED`：说明业务 batch 已成功，返回已存结果，不把成功误报为 500。
    - 仍为当前租约的 `PENDING`：由于成功业务 batch 必须同时完成幂等记录和守卫，业务不可能已单独提交；在幂等/审计存储可写时，以 `id + PENDING + lease_token_digest + request_digest` CAS 和非空子查询守卫的独立 batch 保存脱敏 `500 INTERNAL_ERROR` 及失败审计，后续同 Key 重放该 500。
    - 为 `PENDING` 但租约摘要已属于另一执行者：旧执行者禁止写 500、失败结果或完成审计；先重读一次，若已完成则重放，否则只为本次物理请求记录 `IDEMPOTENCY_IN_PROGRESS` 尝试审计并返回 409。
    - 幂等或审计存储本身不可用：返回脱敏 500，保留 `PENDING`。有效租约内重试返回 `IDEMPOTENCY_IN_PROGRESS`；租约过期后才能 CAS 接管。旧执行者因租约守卫不能晚提交。
12. 不允许通过删除或无条件重置 `PENDING` 来重试创建；任何接管或错误完成必须使用租约 CAS 和事务约束守卫。
13. 客户端预留后永久断开且不再重试时，维护清理每次最多选择 20 条 `updated_at` 已超过 24 小时且租约过期的 `PENDING`。维护者先以旧租约摘要 CAS 领取专用租约，再用相同完成守卫把它转为可重放的脱敏 `500 INTERNAL_ERROR`、写 `MATERIAL_IDEMPOTENCY_ABANDONED` 审计并设置 24 小时 `expires_at`；之后才可由正常 `COMPLETED` 清理删除。禁止直接删除失联 `PENDING`。

幂等记录默认保留 24 小时。惰性清理使用 D1 可移植的有界子查询，每次最多删除 100 条：

```sql
DELETE FROM material_api_idempotency
WHERE id IN (
  SELECT id
  FROM material_api_idempotency
  WHERE state = 'COMPLETED' AND expires_at <= ?
  ORDER BY id
  LIMIT 100
);
```

`PENDING` 记录禁止按 `expires_at` 删除，只能通过租约 CAS 接管或按第 13 步受控终止。当前由写请求触发有界维护；未来可增加受控定时清理，但本任务不创建生产调度。

### 14.5 速率限制

为避免已认证用户持续更换或重复 Key 造成无界 429 幂等行、审计行或冲突查询，限流使用独立、有界的 `material_api_rate_limit_buckets`，而不是给每个被拒绝请求写记录。

最小字段：

- `username`：外键引用 `app_users.username`。
- `bucket_start`：UTC 分钟 epoch，和 username 构成唯一键。
- `attempt_count`：所有物理写尝试，`0..60`。
- `new_key_count`：已获得预留资格的新 Key，`0..20`。
- `rejected_count`：非负整数，达到整数上限时饱和。
- `last_attempt_token_digest`：最近成功分配物理尝试槽位的服务端摘要。
- `last_new_key_token_digest`：最近成功分配新 Key 槽位的服务端摘要。
- `first_rejected_at`、`last_rejected_at`、`created_at`、`updated_at`。

流程：

1. 每个通过 CSRF 和有界 JSON/Key 解析的写请求生成 attempt Token 摘要，以单条条件 Upsert 在 `attempt_count < 60` 时递增并写 `last_attempt_token_digest`。未获得物理槽位时不读取或写入逐 Key 幂等数据。
2. 获得物理槽位后查询同作用域幂等记录；重放、冲突或处理中不增加 `new_key_count`。
3. 只有不存在幂等记录的新 Key 才生成 new-key Token。新 Key 槽和 `PENDING` 预留在同一 D1 batch：条件 Upsert 在 `new_key_count < 30` 时递增并写 `last_new_key_token_digest`，幂等插入用标量子查询验证本次 Token。
4. 并发同 Key 的唯一冲突使整个新 Key batch 回滚，随后读取既有幂等记录；不同 Key 的第 20 个获得槽位，第 21 个没有槽位。
5. 任一硬限额未命中时，只在同一桶增加 `rejected_count` 和 `last_rejected_at`。首次拒绝写一条聚合 `RATE_LIMITED` 审计；后续拒绝由桶内计数和最后时间聚合，不再逐请求新增幂等或审计行。
6. 返回 `429 RATE_LIMITED`、本次物理 `request_id` 和 `Retry-After`，不生成 `operation_id`。限流发生在幂等预留前，是持久幂等契约的明确安全前置例外；下一分钟可重新申请。

两次 Upsert 都必须通过 Token 子查询或结果元数据确认获得槽位，禁止应用层 `COUNT` 后单独写。速率桶按 `(bucket_start)` 建清理索引，只保留 24 小时并每次有界删除 100 条。每用户每分钟至多一行，因此重复或不同 Key 洪泛不会导致无界表增长。确认阈值为每用户每分钟 60 次物理写尝试和 20 个新 Key；admin 不豁免。测试可注入不超过生产上限的更低阈值。

## 15. 乐观锁与并发

- approve 和 reject 必须提交 `expected_version`。
- API 把 URL 中的 `material_id`、正文中的 `expected_version` 和会话上下文传给现有 Review Service。
- 服务返回 `MATERIAL_VERSION_CONFLICT` 时映射为 `409 VERSION_CONFLICT`。
- 版本冲突不得重试业务服务、覆盖其他用户操作、生成编码或留下部分版本/审计数据。
- 同一草稿批准/批准或批准/驳回并发时，只有一个预期版本可成功。
- 正式编码仍由现有编码规则 CAS 和唯一索引保证；API 不生成、预留或修改编码。
- 幂等重放与业务乐观锁职责不同：前者保证同一逻辑请求不重复执行，后者处理不同逻辑请求间的并发。

## 16. 稳定错误映射

| HTTP | API Code | 场景 |
| ---: | --- | --- |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | 写请求缺少 Key |
| 400 | `REQUEST_VALIDATION_FAILED` | JSON、字段、ID、版本、分页或 Key 格式非法 |
| 400 | `SOURCE_TYPE_NOT_ALLOWED` | 人工创建入口传入非 `MANUAL` 来源 |
| 401 | `AUTH_REQUIRED` | 未登录、会话过期或账号停用 |
| 403 | `FORBIDDEN` | 已登录但无路由权限 |
| 403 | `CSRF_INVALID` | Origin、Cookie 或 Header Token 校验失败 |
| 403 | `PASSWORD_CHANGE_REQUIRED` | 临时密码账号尝试 Material 写操作 |
| 403 | `SELF_REVIEW_FORBIDDEN` | 创建人尝试批准或驳回自己的草稿 |
| 404 | `NOT_FOUND` | 未知 Material 路径 |
| 404 | `MATERIAL_NOT_FOUND` | 草稿 ID 不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 合法 Material 路径使用未支持方法 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同作用域同 Key 不同请求摘要 |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | 相同逻辑请求仍在处理 |
| 409 | `INVALID_MATERIAL_STATE` | 当前状态不可审核 |
| 409 | `VERSION_CONFLICT` | `expected_version` 不匹配 |
| 409 | `MATERIAL_METADATA_CONFLICT` | Validation 后属性存储 metadata 发生竞态变化 |
| 409 | `CODE_GENERATION_CONFLICT` | 编码规则缺失、歧义、非法、耗尽或分配冲突 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求正文超过 64 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 写请求不是 JSON |
| 422 | `MATERIAL_VALIDATION_FAILED` | 创建或审核 Validation 存在 `ERROR` |
| 429 | `RATE_LIMITED` | 每用户写操作超限 |
| 500 | `INTERNAL_ERROR` | 脱敏后的未知服务端错误 |

现有服务错误映射：

| Material Service Code | API Code |
| --- | --- |
| `MATERIAL_CREATE_VALIDATION_FAILED`, `MATERIAL_REVIEW_VALIDATION_FAILED` | 通常为 `MATERIAL_VALIDATION_FAILED`；若 issues 含 `MATERIAL_VALIDATION_METADATA_UNAVAILABLE`、`MATERIAL_ATTRIBUTE_METADATA_INVALID`、`MATERIAL_CATEGORY_RULES_MISSING` 或 `MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED`，则为 `INTERNAL_ERROR` |
| `MATERIAL_DRAFT_INPUT_INVALID` | `REQUEST_VALIDATION_FAILED` |
| 既有宽泛 `MATERIAL_ATTRIBUTE_STORAGE_INVALID` | 兼容性兜底为 `INTERNAL_ERROR`，禁止按中文 message 判断；新路径已使用下述细分 code |
| 新 `MATERIAL_ATTRIBUTE_VALUE_INVALID` | `MATERIAL_VALIDATION_FAILED`，用于小数精度等客户端属性值问题 |
| 新 `MATERIAL_ATTRIBUTE_STORAGE_METADATA_INVALID` | `INTERNAL_ERROR`，用于无效规范化或类型存储 metadata |
| 新 `MATERIAL_ATTRIBUTE_STORAGE_METADATA_CONFLICT` | `MATERIAL_METADATA_CONFLICT`，用于 Validation 后 metadata 竞态 |
| `MATERIAL_DRAFT_NOT_FOUND` | `MATERIAL_NOT_FOUND` |
| `MATERIAL_DRAFT_NOT_REVIEWABLE` | `INVALID_MATERIAL_STATE` |
| `MATERIAL_VERSION_CONFLICT` | `VERSION_CONFLICT` |
| `MATERIAL_CODE_RULE_NOT_FOUND`, `MATERIAL_CODE_RULE_AMBIGUOUS`, `MATERIAL_CODE_RULE_INVALID`, `MATERIAL_CODE_SEQUENCE_EXHAUSTED`, `MATERIAL_CODE_ALLOCATION_CONFLICT` | `CODE_GENERATION_CONFLICT` |
| `MATERIAL_WRITE_FAILED` | `INTERNAL_ERROR` |

现有 `MATERIAL_ATTRIBUTE_STORAGE_INVALID` 同时覆盖客户端精度、存储 metadata 错误和 metadata 竞态。API 实施前必须在现有服务中按上表拆成三个安全机器 code；这只是错误分类收窄，不改变 Validation、存储或状态规则。API 禁止检查中文 message 决定 HTTP 状态。

Validation 的 `errors` 和 `warnings` 以安全结构化 issue 进入 `error.details`。规则缺失、类型不受 V1 支持、metadata 不可用或损坏都属于服务端规则源异常，不得伪装成客户端 422；映射为脱敏 500，但仍可保留 Validation Service 已保证安全的 issue code、field、message 和 metadata。任何响应不得返回 SQL、堆栈、Cookie、Token、数据库路径、D1 绑定或原始异常消息。

## 17. 审计责任

### 17.1 双层审计

- `material_versions`：不可变物料版本快照，由现有服务负责。
- `material_change_logs`：物料业务动作和字段级变化，由现有服务事务负责。
- `audit_log`：API 尝试、授权拒绝、CSRF、幂等冲突/重放、读取和写入结果，由 API 安全层负责。

### 17.2 通用审计字段

复用 `audit_log` 作为通用载体，但关键审计字段必须关系化。拟议 `0002` 对现有表执行新增式扩展：

| 新列 | 用途 |
| --- | --- |
| `route_code` | 稳定动作路由，如 `MATERIAL_DRAFT_APPROVE` |
| `material_id` | 可空目标物料引用；能确定时引用 `material_master.id` |
| `operation_id` | 写操作的稳定逻辑 UUID；读取和预留前拒绝为空字符串 |
| `idempotency_key_digest` | 写请求完整 SHA-256 摘要；读取和预留前拒绝为空字符串 |
| `old_version` / `new_version` | 可空版本边界 |
| `error_code` | 失败时稳定 API code，成功为空字符串 |

`username`、`action`、`request_id`、`result`、`created_at` 继续使用现有列。`request_id` 标识每次物理 HTTP 尝试，`operation_id` 关联幂等重试和 Material 业务版本/变更日志。

`detail` 只允许保存非关键的脱敏补充说明，例如 `{"replayed":false}`；不得再用自由文本 JSON 承载对象 ID、幂等摘要、版本或错误码。

新增审计列使用兼容 CHECK：`operation_id` 为空或为 UUID 形态，`idempotency_key_digest` 为空或长度 64，版本为空或为非负整数，`material_id` 为空或通过外键/同事务等价校验存在；`route_code` 和 `error_code` 使用服务端 allowlist。旧审计行的空默认值必须继续通过约束。

必须记录：

- 登录用户；未认证拒绝时用户名为空但 action 明确。
- 服务端物理请求编号；写请求还记录稳定操作编号。
- 稳定动作 code。
- 物料 ID（能确定时）。
- 成功、失败、冲突或重放结果。
- 时间。
- 幂等 Key 摘要（写请求）。
- 原版本与新版本（能确定时）。
- 稳定错误码（失败时）。

禁止记录 Session/CSRF Token、密码、原始 Idempotency-Key、完整请求头、完整正文、SQL、堆栈或数据库路径。

成功写 API 的通用审计和幂等完成标记加入现有 Material 业务 batch。读取成功审计在查询后写入；若读取审计不可用，返回脱敏 `INTERNAL_ERROR`。认证拒绝、授权拒绝、密码状态、CSRF、幂等冲突/处理中和重放都必须写通用审计；速率限制每用户/分钟桶写一条聚合通用审计，后续拒绝次数与最后时间记录在有界速率桶。早期拒绝使用独立的安全审计写，不得因审计异常泄露内部信息。

Material API 审计在线保留 1095 天；`retention_until` 为关系化 epoch 秒字段。`admin` 可完整查看，`manager` 只读查看，其他角色不得查看 Material API 审计；受控导出服务支持在到期清理前分页导出。`material_change_logs` 不随 API 审计或 24 小时幂等清理删除。本任务不创建自动生产清理调度。

## 18. Query Service 设计

新增独立只读接口，不扩展写 Repository 的职责：

```ts
interface MaterialMasterQueryService {
  listDrafts(query: MaterialDraftListQuery): Promise<MaterialDraftPage>;
  getDraftDetail(query: MaterialDraftDetailQuery): Promise<MaterialDraftDetail | null>;
}
```

职责：

- 参数化列表筛选、总数、确定性排序和有界 page/offset 分页。
- 当前属性值类型还原。
- 使用递归 CTE 生成四级分类路径，并设置最大深度 4 防止异常循环。
- 分页读取版本和变更日志。
- 调用共享 Validation 输入映射及现有 Validation Service 返回当前校验结果。

不负责：

- 创建、批准、驳回、编码或状态转换。
- 直接读取 legacy `erp_records` 作为 V2 数据。
- 缓存或重新定义分类/属性规则。

拟议 `0002` 同时增加：

- `material_master(material_status, created_at, id)`：默认审核队列。
- `material_master(created_by, created_at, id)`：创建人筛选。
- `material_master(source_type, created_at, id)`：当前 schema 没有 `source_type` 索引。

`category_id` 已有 `(category_id, material_status)` 索引；组合筛选继续通过参数化查询和分页上限控制。若隔离查询计划证明还需额外组合索引，必须先更新规格，不能在实施时临时增加。

## 19. Migration 设计

规格确认后的实现新增：

```text
chenyida_erp_site/drizzle/0002_material_draft_review_api.sql
chenyida_erp_site/drizzle/rollback/0002_material_draft_review_api.down.sql
chenyida_erp_site/drizzle/meta/0002_snapshot.json
```

并同步更新 `db/schema.ts` 和 Drizzle journal。

Up 只做扩展：

1. 新增 `material_api_idempotency`。
2. 为幂等表声明 `username -> app_users.username`、`material_id -> material_master.id` 外键，digest/状态/租约/HTTP 状态/JSON/版本/时间 CHECK，以及唯一约束和查询/清理索引。
3. 新增有界 `material_api_rate_limit_buckets`，声明用户外键、用户/分钟唯一约束、计数/时间 CHECK 和清理索引。
4. 以新增列方式扩展 `audit_log`：`route_code`、`material_id`、`operation_id`、`idempotency_key_digest`、`old_version`、`new_version`、`error_code`；现有行使用空字符串或 NULL 兼容默认值。`material_id` 优先声明到 `material_master.id` 的受限外键；若 D1 对现有表加外键列受限，则由 API 同事务存在性校验和迁移孤儿测试提供等价引用保护，并在实施报告明确记录。
5. 新增 `audit_log(request_id)`、`audit_log(operation_id)` 和 `audit_log(material_id, created_at)` 索引。
6. 新增本规格明确的三个 Material 列表索引。

不修改 `0000`、`0001`，不回填业务数据，不创建默认用户/角色，不初始化编码规则，不执行生产 migration。

Down 只用于空的隔离测试库：先验证专用幂等表和速率桶没有需保留记录且新增审计列没有任务数据，再按依赖逆序删除本 migration 的索引、审计扩展列和两张专用表。实施前必须在目标 D1/SQLite 版本验证 `DROP COLUMN` 支持；若不支持，隔离 Down 使用经审阅的表重建，生产仍禁止用 Down 丢弃审计。生产若已经产生 API/审计数据，使用停用新路由和前向修复。

## 20. 测试方案

### 20.1 单元测试

- 精确路由和方法匹配，未知 Material POST 不回退 `read`。
- 角色权限矩阵。
- Material namespace 在认证失败、授权失败、错误方法和未知异常时仍使用专用 request ID 与嵌套 responder；legacy 契约不变。
- `must_change_password` 账号只读允许、三个写路由拒绝。
- Origin/CSRF Cookie/Header 校验。
- DTO 白名单、伪造身份字段、正文上限和路径 ID。
- canonical JSON 和请求摘要稳定性。
- 服务错误到 HTTP code 的完整映射，包括 metadata 不可用的 500 和存储 metadata 竞态的 409。
- 分页、日期、状态、关键字和历史上限。
- 成功/错误响应结构、物理 `request_id` 和稳定 `operation_id`。

### 20.2 Migration 与 Query 集成测试

使用本机一次性 Miniflare D1 显式应用 `0000`、`0001`、`0002`：

- 空库升级、已有合成数据升级、防重、失败回滚、Down 和重升。
- 幂等外键、digest、状态/租约、HTTP 状态、JSON、版本约束、唯一作用域、过期/失联索引，以及速率桶唯一性/计数/清理约束和列表索引。
- 新增审计列、默认兼容值、引用保护及 request/operation/material 索引。
- 列表组合筛选、确定性排序、默认 DRAFT 和 100 条上限。
- 详情属性类型、分类路径、当前 Validation、版本及日志分页。
- `COMPLETED` 清理每批最多 100 条，`PENDING` 不会被清理。
- 测试结束销毁 D1。

### 20.3 HTTP/API 集成测试

现有烟测需扩展为每个用户独立 Cookie jar，并显式发送 Origin 和 CSRF。启动 Site 前，安全运行器必须对同一个临时持久化 D1 目录显式应用 `0000`、`0001`、`0002`，再写入合成分类、属性定义/绑定、编码规则和测试账号；不得依赖 `ensureSchema()` 创建 V2/API 表，也不得把 migration 或 seed 放入生产启动路径。

至少覆盖：

1. 未登录访问返回 `401 AUTH_REQUIRED`。
2. 无权限创建返回 `403 FORBIDDEN`。
3. 无权限审核返回 `403 FORBIDDEN`。
4. CSRF 缺失、错误或异源被拒绝。
5. 创建草稿成功且无正式编码。
6. 非法属性创建返回结构化 Validation details。
7. 相同幂等请求不会重复创建。
8. 相同幂等 Key 不同载荷返回 `409 IDEMPOTENCY_CONFLICT`。
9. 同 Key 并发只有一个业务执行者。
10. 过期租约 CAS 阻断旧执行者晚提交；条件更新零行后约束守卫使整个业务 batch 回滚。
11. 审核前重新校验。
12. 审核成功生成唯一正式编码。
13. 并发审核只有一个成功。
14. `expected_version` 错误返回 `409 VERSION_CONFLICT`。
15. 驳回原因缺失时失败。
16. 驳回后保持 `DRAFT` 且版本递增。
17. 稳定嵌套错误结构、每次新的 `X-Request-Id` 和重放保持不变的 `operation_id`。
18. 客户端无法伪造 `actor`、`created_by`、`approved_by`、`request_id`。
19. 业务成功但幂等完成、约束守卫或通用成功审计故障时整体回滚。
20. 列表和详情不允许无界数据返回。
21. 写速率上限返回 `429`，已存在幂等 Key 的重放不重复占用新 Key 槽位。
22. 测试脚本在数据库写入前拒绝生产 URL、production 环境和远程 D1。
23. 不同用户或不同具体路由可以安全复用相同原始 Key，不能互相覆盖。
24. 预留后的 4xx 和脱敏 5xx 使用租约 CAS 与失败守卫完成并按既定策略重放；已被接管的旧执行者不能覆盖新结果。
25. 已完成请求在 Site 进程重启后仍可从同一临时 D1 重放，证明幂等不是内存状态。
26. 过期 `COMPLETED` 每次最多清理 100 条；长期失联 `PENDING` 每次最多 20 条，经维护租约 CAS 和守卫转成可过期终态，绝不直接删除。
27. 成功、失败、重放、幂等冲突/处理中、认证/授权/密码状态和 CSRF 拒绝均写规定审计字段。
28. `audit_log`、幂等表和失败输出中不存在原始 Key、Session/CSRF Token、完整正文、SQL、堆栈或数据库路径。
29. 双层审计可通过 `operation_id` 关联，物理 API 尝试可通过 `request_id` 区分。
30. 并发第 20/21 个新 Key 和第 60/61 个物理尝试严格执行条件槽位；大量重复或不同 Key 的 429 只增长一个用户/分钟桶和一条聚合审计，不创建逐 Key 幂等行。
31. 裸 `/api/material-master`、HEAD、OPTIONS 和其他错误方法遵守本规格定义的 namespace/405 契约。

### 20.4 任务基线

- `npm run lint`
- `npm test`
- `npm run test:api`
- 使用临时 SQLite 运行本地 `environment_guard_test.py`、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py`、`go_live_check.py --no-backup`
- `npm run security:credentials`
- `git diff --check`
- 检查最终差异不包含生产变量、数据库、备份、日志或临时输出

## 21. 已确认的业务与安全决策

项目负责人于 2026-07-14 确认：

1. `admin`、`manager` 可批准和驳回；`purchase`、`engineering` 可创建但不可审核。
2. 所有人（包括 `admin`）禁止自审；本任务不提供 break-glass 例外。
3. V1 只实现 `DRAFT -> APPROVE -> ACTIVE` 单步最终审核，不实现多级会签。
4. 批准和驳回使用相同角色集合。
5. 幂等完成结果保留 24 小时；`PENDING` 只允许租约 CAS 接管或受控终止，禁止直接删除。
6. 每用户每分钟最多 60 次写尝试和 20 个新 Key；admin 不豁免，测试可配置更低阈值。
7. API 审计在线保留 1095 天；admin 完整查看、manager 只读查看，其他角色无权查看；到期清理前支持受控导出。
8. 公共人工创建 API 只允许 `MANUAL`；非 MANUAL 返回 `400 SOURCE_TYPE_NOT_ALLOWED`。

## 22. 规格确认后的实施顺序

1. 将本规格和待确认选择记录为 `ACCEPTED` 决策。
2. 新增并验证 `0002` migration、Down、schema、snapshot 和 journal。
3. 实现 Material API 安全组件、只读 Query Service 和精确路由分发。
4. 以可选事务伴随上下文最小扩展现有 Material Repository batch，不改变 Draft/Review 业务语义。
5. 完成单元、migration、Miniflare D1 集成和 HTTP 测试。
6. 运行完整非生产基线，更新项目文档并创建独立功能提交。

上述步骤已在非生产隔离环境完成；生产 migration 和部署仍未授权。

## 23. 实施结果

- 五个路由已由 catch-all 精确分发到独立 Material API 模块，未知路径和错误方法不再回退 legacy `read`。
- 复用现有 ERP 会话；新增细粒度权限、自审拦截、严格 Origin 和双提交 CSRF。
- 新增 `0002_material_draft_review_api.sql`、Down、Drizzle snapshot/journal、`material_api_idempotency`、有界速率桶、审计扩展列和查询索引。
- Material 成功写的幂等完成标记与通用成功审计作为受信事务伴随项加入原有业务 batch；服务错误使用租约 CAS 和守卫完成。
- 新增只读 Query Service、当前 metadata 校验、分类路径和版本/变更日志分页；新增受控审计导出服务但不新增前端页面。
- 隔离 migration、服务/API、并发、限流、审计脱敏和实际登录/CSRF smoke 通过；完整 Node 测试 58/58，lint 0 error/1 个既有 warning。
- 未连接生产 D1、未迁移真实物料、未部署，也未修改页面、Excel/AI、BOM、采购、库存或 legacy SQLite。
