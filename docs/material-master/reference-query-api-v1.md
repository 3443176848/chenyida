# Material Master Reference & Query API V1

状态：`PROPOSED_AWAITING_SPEC_CONFIRMATION`

任务：`PHASE1-TASK08`

日期：2026-07-14

目标运行面：`chenyida_erp_site/` 服务端 TypeScript / Cloudflare D1

## 1. 目标

设计只读的 Material Master Reference & Query API，为后续物料页面、导入字段映射和候选匹配提供稳定查询契约。本阶段只完成书面规格和 OpenAPI，不修改 Schema、migration、API 代码、业务服务或前端，不连接、迁移或部署生产 D1。

设计采用已确认的方案 A：

- `/materials` 是覆盖全部生命周期状态的统一新查询入口。
- `/drafts` 保留为工作流兼容适配层，复用同一 Query Service、可见性规则和详情组装能力。
- `/review-queue` 保持独立审核入口，不扩展为通用列表。
- 分类树一次返回 101 个节点规模下的完整启用树，并支持 `tree`、`flat` 两种表示。
- 详情只内嵌固定上限的历史摘要，完整历史使用独立分页子资源。
- 分类树和分类 Schema 使用内容摘要 ETag；物料、历史和工作流响应使用 `private, no-store`。

## 2. 当前基线和范围

### 2.1 已有事实

1. Material Master V2 已有关系化 D1 schema、101 个分类节点、39 个四级叶子、34 个属性定义和 228 条显式叶子绑定。
2. 现有 Validation Service 从 D1 metadata 读取分类、绑定、必填、类型、标准单位和枚举，不以 seed 作为运行时规则。
3. 现有 Query Service 已提供 `/drafts` 列表、详情和 `/review-queue`，详情可还原类型化属性、分类路径、当前 Validation、版本和变更日志。
4. 现有 `/drafts` 只校验 `material.read`，尚未按创建人和工作流权限收紧行级可见性。
5. 当前开发 schema 同时接受过渡旧值 `PENDING_APPROVAL` 和新值 `PENDING_REVIEW`；应用只写、只返回 `PENDING_REVIEW`。
6. 当前生产仍未执行 `0001`、`0002`、`0003`，本规格不构成生产迁移或部署授权。

### 2.2 本规格包含

- 分类树 Reference API。
- 四级叶子分类属性 Schema API。
- 统一物料列表和详情 API。
- 独立版本历史和变更日志分页 API。
- `/drafts` 兼容、安全收紧和迁移提示。
- 认证、授权、行级可见性、缓存、错误、性能和实施测试计划。

### 2.3 本规格不包含

- 新增或修改任何写接口、生命周期、审核规则或编码规则。
- 前端、Excel/CSV 导入、AI 分类、候选匹配、批量或多级审核。
- BOM、采购、库存、生产或 legacy SQLite 修改。
- 真实物料迁移、生产 D1 访问、migration 或部署。
- `PENDING_APPROVAL` 收缩。
- 本任务外既有 TypeScript 诊断修复。

## 3. 方案结论与模块边界

### 3.1 已确认方案 A

统一扩展现有只读边界：

```text
Material API Handler
  -> 服务端认证与权限快照
  -> Material Visibility Policy
  -> Reference Query Service
       -> 分类树 / 分类 Schema
  -> Material Query Service
       -> 统一列表
       -> 统一详情组装
       -> 版本 / 变更日志分页
  -> Response Adapter
       -> /materials 新契约
       -> /drafts 兼容契约
       -> /review-queue 审核契约
```

职责约束：

- Visibility Policy 只根据可信服务端会话用户名和权限集合生成 SQL 可组合的授权谓词；不得接受客户端角色或可见范围声明。
- Query Service 负责参数化查询、行级可见性、确定性排序、类型还原、分类路径和有界历史。
- 现有 Material Repository/Validation Service 继续是物料聚合读取和校验权威；查询层不得复制写规则。
- `/materials` 与 `/drafts` 共享查询和详情组装，不维护两套 SQL、Validation 映射或属性还原逻辑。
- 兼容适配器可以保持旧响应核心字段，但不得放宽统一授权谓词。

### 3.2 不采用的方案

- `/materials` 只查正式物料、草稿继续完全由 `/drafts` 管理：会让前端继续维护两套详情和状态模型。
- 不新增 `/materials`、继续扩展 `/drafts`：接口命名与正式物料语义冲突，不能成为稳定统一入口。

## 4. 路由总览

| 方法 | 路由 | 基础权限 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/material-master/categories` | `material.read` | 完整启用分类树或扁平表 |
| `GET` | `/api/material-master/categories/:categoryId/schema` | `material.read` | 启用四级叶子的当前输入 Schema |
| `GET` | `/api/material-master/materials` | `material.read` | 按当前用户可见范围统一搜索物料 |
| `GET` | `/api/material-master/materials/:materialId` | `material.read` + 行级可见 | 统一物料详情与有界历史摘要 |
| `GET` | `/api/material-master/materials/:materialId/versions` | `material.read` + 行级可见 | 完整版本历史分页 |
| `GET` | `/api/material-master/materials/:materialId/change-logs` | `material.read` + 行级可见 | 完整变更日志分页 |
| `GET` | `/api/material-master/drafts` | `material.read` + 行级可见 | 兼容工作流列表，仅草稿/待审 |
| `GET` | `/api/material-master/drafts/:materialId` | `material.read` + 行级可见 | 兼容工作流详情 |
| `GET` | `/api/material-master/review-queue` | `material.review.queue` | 独立待审核队列 |

所有路由继续由 Material namespace 精确匹配。未知路径返回 `404 NOT_FOUND`，已声明路径使用错误方法返回 `405 METHOD_NOT_ALLOWED`，不得回退 legacy 权限。

## 5. 公共只读 HTTP 契约

### 5.1 认证和请求身份

- 复用现有 `app_users`、`app_sessions` 和 `CYD_ERP_SESSION`。
- 未登录、会话过期或账号停用返回 `401 AUTH_REQUIRED`。
- 已登录但缺少路由基础权限返回 `403 FORBIDDEN`。
- 用户名和权限只从服务端会话取得；客户端角色、用户名 Header 或查询参数不构成授权。
- GET 不要求 `Idempotency-Key`，不创建幂等记录。
- GET 不要求 CSRF Token；API 不开放跨源凭证 CORS，浏览器使用同源会话 Cookie。
- 每次物理请求由服务端生成 `request_id`，通过响应正文或 `X-Request-Id` 返回。

### 5.2 成功响应

非 `304` 成功响应延续 Material API 外壳：

```json
{
  "data": {},
  "request_id": "3e0f8422-5060-44ca-8fa8-540da49e73e8"
}
```

分页响应另外包含：

```json
{
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

`total` 必须在授权谓词和全部查询条件应用后计算，不能包含隐藏记录。

### 5.3 参数处理

- 只接受每个路由明确列出的参数；未知参数返回 `400 REQUEST_VALIDATION_FAILED`。
- 整数使用正安全整数；日期使用 `YYYY-MM-DD`。
- `from` 按 UTC 当日 `00:00:00.000Z` 起算，`to` 包含指定 UTC 日期整日并在 SQL 中转换为次日独占上界。
- 所有字符串先去首尾空白再校验长度；SQL 使用绑定参数，排序只使用服务端 allowlist。

## 6. 行级可见性与最小披露

### 6.1 正式状态

所有拥有 `material.read` 的用户可查看：

- `ACTIVE`
- `FROZEN`
- `INACTIVE`

这些状态已经完成审核并拥有正式编码，不因只读角色不同而隐藏。

### 6.2 `DRAFT`

同时拥有 `material.read` 且满足任一条件时可见：

- `created_by = 当前会话 username`；或
- 拥有 `material.draft.edit_any`。

`material.draft.edit_own` 本身不授予查看其他人草稿的权限。

### 6.3 `PENDING_REVIEW`

同时拥有 `material.read` 且满足任一条件时可见：

- `created_by = 当前会话 username`；或
- 拥有 `material.draft.edit_any`；或
- 拥有 `material.review.queue`。

`material.read` 本身不授予全部待审物料可见权限。

### 6.4 查询与隐藏语义

- 列表在 SQL 查询和 `COUNT(*)` 中应用相同授权谓词，不返回占位记录，不暴露隐藏物料的名称、创建人、数量或存在性。
- `material_status`、`category_id`、`keyword` 等条件与授权范围取交集，不能替代或扩大授权范围。
- 对存在但当前用户无行级可见权的草稿或待审物料，详情及历史统一返回 `404 MATERIAL_NOT_FOUND`，不返回 403。
- 若用户缺少路由基础权限，必须在对象查询前返回 `403 FORBIDDEN`。
- `/review-queue` 必须要求 `material.review.queue`；仅有 `material.read` 返回 403。

### 6.5 个人字段最小披露

- 只返回任务契约要求的账号名：`created_by`、`last_modified_by`、`submitted_by`、`approved_by` 和历史操作者。
- 不返回用户显示名、角色、邮箱、会话状态或其他账号资料。
- 不通过本组接口返回 `audit_log`、认证/授权拒绝、幂等摘要、CSRF、Session、API 请求正文或内部审计详情。

## 7. 分类树 API

### 7.1 请求

```http
GET /api/material-master/categories?view=tree
```

参数：

| 参数 | 默认 | 合法值 |
| --- | --- | --- |
| `view` | `tree` | `tree`, `flat` |

V1 不提供 `parent_id` 懒加载，不提供包含停用节点的客户端开关。101 个节点规模下，一次读取、校验并组装完整启用树的成本可控，也能避免前端多次往返和自行推断叶子。

### 7.2 节点契约

每个节点至少返回：

```json
{
  "category_id": 123,
  "code": "FR4_STANDARD",
  "name": "普通 FR4",
  "level": 4,
  "parent_id": 45,
  "full_path": "PCB/FPC 材料 / 基材 / FR4 / 普通 FR4",
  "enabled": true,
  "is_leaf": true,
  "display_order": 10,
  "children": []
}
```

- `tree`：`data` 为一级节点数组，`children` 递归包含后代。
- `flat`：`data` 为按完整树遍历顺序排列的数组，`children` 固定为空数组，便于统一类型。
- `is_leaf` 由服务端按有效 metadata 明确返回。V1 的合法物料叶子必须是启用的四级节点；前端不得通过 `level` 或空 `children` 自行推断。
- `full_path` 是按中文显示名组成的展示字符串；稳定业务标识仍是每段 category code 和 `category_id`。
- 不返回 `version`、`request_id`、审计字段、description 或数据库行结构等无关字段。

### 7.3 启用、层级与排序

- 只返回从启用根节点连续可达的启用节点。
- 若启用子节点指向停用/缺失父节点、层级不连续、存在循环、同一节点重复或层级超过 4，采用 fail-closed，返回 `500 CATEGORY_TREE_INVALID`，不能静默提升或截断节点。
- 同级排序固定为 `sort_order ASC, category_code ASC, id ASC`。
- `flat` 使用上述同级顺序的深度优先先序遍历，因此两种 view 对同一 metadata 具有一致顺序。

## 8. 分类属性 Schema API

### 8.1 请求和适用分类

```http
GET /api/material-master/categories/123/schema
```

只允许查询存在、启用且为四级叶子的分类：

- 不存在：`404 CATEGORY_NOT_FOUND`。
- 已停用：`409 CATEGORY_DISABLED`。
- 不是四级叶子：`409 CATEGORY_NOT_LEAF`。

### 8.2 响应

```json
{
  "data": {
    "category_id": 123,
    "category_code": "FR4_STANDARD",
    "category_name": "普通 FR4",
    "category_path": "PCB/FPC 材料 / 基材 / FR4 / 普通 FR4",
    "schema_version": "sha256:7b6d...",
    "attributes": [
      {
        "attribute_code": "THICKNESS",
        "name": "厚度",
        "description": "",
        "data_type": "DECIMAL",
        "required": true,
        "standard_unit": "mm",
        "compatible_units": ["mm", "um"],
        "enum_options": [],
        "display_order": 10,
        "enabled": true,
        "input_contract": {
          "json_type": "number",
          "control": "decimal",
          "unit_mode": "REQUIRED",
          "decimal_scale": 3
        }
      }
    ]
  },
  "request_id": "..."
}
```

规则：

- 运行时只读取当前 D1 的 `material_categories`、`material_category_attributes` 和 `material_attribute_definitions`，不读取 seed。
- 只返回状态为 `ACTIVE` 的绑定和属性定义；禁用属性完全不返回。
- 属性以 `sort_order ASC, attribute_code ASC, attribute_definition_id ASC` 稳定排序；`attribute_definition_id` 不返回。
- `attribute_code` 是写入和查询的稳定业务标识。
- 当前数据库没有属性 description 列，V1 返回空字符串；未来增加受控描述 metadata 必须另行设计和 migration，不能读取 seed 补齐。
- 当前枚举 metadata 只保存稳定 code 数组，没有独立显示名。V1 返回 `{code, label}`，其中 `label = code`；未来本地化显示名需要独立受控 metadata 扩展。
- `compatible_units` 必须由 Validation Service 共用的单位策略生成，不复制另一套规则。`mm`/`um` 互相兼容；其他有单位属性至少包含标准单位；无单位属性为空数组。

### 8.3 前端输入契约

| `data_type` | JSON 值 | 控件建议 | 单位规则 |
| --- | --- | --- | --- |
| `TEXT` | string | text | 禁止单位 |
| `INTEGER` | integer number | integer | `standard_unit` 非空时必填兼容单位，否则禁止 |
| `DECIMAL` | finite number | decimal | `standard_unit` 非空时必填兼容单位，否则禁止；不得静默舍入超过 `decimal_scale` 的值 |
| `BOOLEAN` | boolean | checkbox/switch | 禁止单位 |
| `ENUM` | enum code string | select | 禁止单位；提交 code，不提交 label |

`DATE` 或未知类型不属于 Validation V1 支持范围。只要当前叶子包含不支持类型、非法枚举 JSON、非法 scale、缺失属性定义或其他不可安全解释的 metadata，整个 Schema 请求返回 `500 CATEGORY_SCHEMA_INVALID`，不得返回部分 Schema。

## 9. 统一物料列表 API

### 9.1 请求参数

```http
GET /api/material-master/materials?page=1&page_size=20&material_status=ACTIVE&sort=updated_at_desc
```

| 参数 | 默认 | 约束 |
| --- | --- | --- |
| `page` | `1` | 正安全整数 |
| `page_size` | `20` | `1..100`；无“全部”值 |
| `keyword` | 无 | 去空白后 `1..100` 字符 |
| `material_status` | 无 | `DRAFT`,`PENDING_REVIEW`,`ACTIVE`,`FROZEN`,`INACTIVE` |
| `category_id` | 无 | 精确匹配正安全整数 ID |
| `category_path` | 无 | 从根开始、以 `/` 分隔的 category code 路径；匹配末节点及其启用后代 |
| `source_type` | 无 | 已批准 Material source_type |
| `created_by` | 无 | 精确账号名 |
| `created_from`, `created_to` | 无 | UTC 日期范围 |
| `updated_from`, `updated_to` | 无 | UTC 日期范围 |
| `sort` | `updated_at_desc` | 固定 allowlist |

`category_id` 与 `category_path` 同时提供时取交集。路径必须逐段存在且父子连续；非法或不存在的路径返回 `REQUEST_VALIDATION_FAILED`，不降级为字符串前缀匹配。

允许排序及稳定次排序：

- `updated_at_desc`：`updated_at DESC, id DESC`。
- `updated_at_asc`：`updated_at ASC, id ASC`。
- `created_at_desc`：`created_at DESC, id DESC`。
- `created_at_asc`：`created_at ASC, id ASC`。
- `standard_name_asc`：`standard_name ASC, id ASC`。
- `standard_name_desc`：`standard_name DESC, id DESC`。
- `material_code_asc`：正式编码非空优先并升序，`id ASC`；空编码最后。
- `material_code_desc`：正式编码非空优先并降序，`id DESC`；空编码最后。

### 9.2 Keyword 语义

V1 只匹配：

- `standard_name`
- `internal_material_code`
- `manufacturer`
- `manufacturer_part_number`

查询使用绑定参数和转义后的字面包含匹配；`%`、`_` 和反斜杠不作为客户端通配符。物料编码和 MPN 按规范化 ASCII 大小写不敏感匹配，中文名称没有大小写转换。

V1 不搜索属性、供应商映射、别名或历史快照。这些字段需要不同索引和歧义处理，必须在候选匹配或搜索专项中另行设计。

### 9.3 响应

列表项至少包含：

```json
{
  "material_id": 456,
  "material_code": "CYD-PCB-FR4-000001",
  "standard_name": "普通 FR4 覆铜板",
  "material_status": "ACTIVE",
  "category_id": 123,
  "category_path": "PCB/FPC 材料 / 基材 / FR4 / 普通 FR4",
  "unit": "PCS",
  "source_type": "MANUAL",
  "current_version": 6,
  "created_by": "buyer01",
  "last_modified_by": "engineer01",
  "submitted_by": "buyer01",
  "submitted_at": "2026-07-14T08:00:00.000Z",
  "created_at": "2026-07-14T06:00:00.000Z",
  "updated_at": "2026-07-14T09:00:00.000Z"
}
```

- 草稿和待审物料的 `material_code` 为 `null`。
- 列表不返回完整属性、Validation、版本或变更日志。
- 列表不对每条记录执行完整 Validation。
- 当前页主记录和分类路径应批量加载，禁止逐记录查询分类路径。

## 10. 统一物料详情 API

### 10.1 请求和可见性

```http
GET /api/material-master/materials/456
```

先校验 `material.read`，再按第 6 节执行行级可见性。不存在或不可见均返回 `404 MATERIAL_NOT_FOUND`。

### 10.2 详情结构

`data` 至少包含：

- `material`：基础字段、`material_code`、状态、版本、创建/修改/提交/批准职责字段和时间。
- `category_path`：最多四个 `{category_id, category_code, category_name, level}` 节点。
- `attributes`：按 Schema 顺序展示的数组，每项包含 `attribute_code`、名称、类型、还原后的原生值、单位和安全来源类型。
- `validation`：基于当前 D1 metadata 的一次有界 `validateForReview()` 结果，包含 `basis=CURRENT_METADATA` 和服务端时间。
- `history_summary`：最新最多 5 个版本摘要、最新最多 5 个变更日志摘要、各自总数与 `has_more`。

当前属性继续使用展示数组，便于保留顺序和名称；每项的 `attribute_code` 是稳定索引。写 API 仍使用 `Record<attribute_code, {value, unit?}>`。客户端需要编辑时必须显式把展示数组转换为 code 索引对象；服务端不得把只读展示对象直接当作写命令。

详情复用现有 `MaterialRecord -> MaterialValidationInput` 映射和类型还原函数，不复制校验或属性转换规则。Validation 业务错误可作为详情结果返回；metadata 不可用或损坏时 fail-closed，返回脱敏 `500 INTERNAL_ERROR`，不返回可能被误用的部分详情。

### 10.3 有界历史摘要

- 版本固定按 `version_no DESC, id DESC` 取 5 条，只返回版本号、事件、原因、变更字段、操作者、审核人和时间，不在详情内返回完整 snapshot。
- 变更日志固定按 `created_at DESC, id DESC` 取 5 条，只返回类型、字段、原因、操作者和时间，不在详情内返回完整前后值。
- `history_summary` 不接受扩容参数。需要完整 snapshot 或前后值时调用独立分页子资源。

## 11. 独立历史分页 API

### 11.1 版本历史

```http
GET /api/material-master/materials/456/versions?page=1&page_size=20
```

- 默认 `page=1`、`page_size=20`，最大 `50`。
- 固定排序 `version_no DESC, id DESC`。
- 每项返回解析并验证后的 `snapshot` 对象、`changed_fields` 数组、事件、原因、操作者、审核人、时间和 `operation_id`。
- 原始 `snapshot_json` 不直接返回；解析或结构校验失败时返回脱敏 `500 INTERNAL_ERROR`，不能把损坏 JSON 当字符串透传。

### 11.2 变更日志

```http
GET /api/material-master/materials/456/change-logs?page=1&page_size=20
```

- 默认 `page=1`、`page_size=20`，最大 `50`。
- 固定排序 `created_at DESC, id DESC`。
- 每项返回解析后的 `old_value`、`new_value`、变更类型、字段、原因、操作者、时间和 `operation_id`。

两个子资源都先执行目标物料行级可见性；不可见和不存在统一返回 `MATERIAL_NOT_FOUND`。分页 `total` 只在目标物料可见后计算。

## 12. `/drafts` 兼容策略

### 12.1 定位

保留：

- `GET /api/material-master/drafts`
- `GET /api/material-master/drafts/:materialId`

它们是工作流兼容接口，不再是覆盖正式物料的通用查询入口。

### 12.2 兼容行为

- 只返回 `DRAFT` 和 `PENDING_REVIEW`，并应用第 6 节相同授权谓词。
- 列表默认仍为 `DRAFT`；若提供 `material_status`，只接受 `DRAFT` 或 `PENDING_REVIEW`。
- 不删除路由，不改变现有响应主体的核心字段、分页外壳和历史分页字段。
- 详情聚合、属性还原、分类路径、Validation 和历史加载复用统一 Query Service；兼容适配器只负责旧字段名称和外壳。
- 可返回 `Deprecation: true` 和 `Link: </api/material-master/materials>; rel="successor-version"`；V1 不设置 `Sunset` 或强制删除日期。
- 后续前端新代码优先使用 `/materials`；审核页面继续使用 `/review-queue`。

可见范围收紧属于明确批准的安全修正：仅有 `material.read` 的用户不再能查看全部草稿。不可见详情返回 `404 MATERIAL_NOT_FOUND`。

## 13. `/review-queue` 边界

- 继续要求 `material.review.queue`，不因本规格增加 `material.read` 回退。
- 只返回 `PENDING_REVIEW`，继续使用自己的筛选、排序和当前页 Validation 摘要契约。
- 审核队列不替代 `/materials`，也不接受其他状态。
- 本任务只在文档中要求它与统一可见性策略一致，不改变已确认的审核角色、职责分离或写服务。

## 14. 缓存与一致性

### 14.1 分类树与分类 Schema

两个 Reference API 使用强内容摘要 ETag：

```text
ETag: "sha256-<base64url digest>"
Cache-Control: private, max-age=300, must-revalidate
Vary: Cookie, Accept-Encoding
```

选择私有可验证缓存而不是公共缓存，是因为路由仍要求 ERP 会话认证；共享缓存不得在未重新认证的请求间传播受保护响应。

摘要输入：

- 分类树：`view`、所有返回节点的 ID/code/name/level/parent/status/sort 和确定性顺序。
- 分类 Schema：分类路径、所有有效绑定和属性定义的返回字段、枚举 code、decimal scale，以及 Validation 共用单位策略的显式版本。

摘要基于规范化响应内容，不依赖单实例内存计数器。任何会改变响应的 metadata 或单位策略变化都会改变 ETag。

处理顺序：认证与授权 -> 读取并验证当前 metadata -> 计算 ETag -> 比较 `If-None-Match`。匹配返回 `304`、空正文、`ETag`、`Cache-Control`、`Vary` 和 `X-Request-Id`；不得在认证前直接返回 304。

### 14.2 物料和历史

以下响应统一：

```text
Cache-Control: private, no-store
Pragma: no-cache
```

- `/materials` 列表、详情、版本和变更日志。
- `/drafts` 列表、详情。
- `/review-queue`。
- 所有包含身份、权限差异、DRAFT 或 PENDING_REVIEW 的错误或成功响应。

这些接口不返回 ETag，避免权限、状态、版本和当前 Validation 变化造成陈旧或跨用户缓存。

## 15. 稳定错误格式

继续使用：

```json
{
  "error": {
    "code": "CATEGORY_NOT_LEAF",
    "message": "所选分类不是可用的四级叶子分类",
    "request_id": "...",
    "details": []
  }
}
```

| HTTP | Code | 场景 |
| ---: | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | 参数、日期、路径、分页或 sort 非法 |
| 401 | `AUTH_REQUIRED` | 未登录、会话过期或账号停用 |
| 403 | `FORBIDDEN` | 缺少路由基础权限 |
| 404 | `CATEGORY_NOT_FOUND` | 分类不存在 |
| 404 | `MATERIAL_NOT_FOUND` | 物料不存在或当前用户不可见 |
| 409 | `CATEGORY_DISABLED` | 分类已停用 |
| 409 | `CATEGORY_NOT_LEAF` | 分类不是启用四级叶子 |
| 500 | `CATEGORY_TREE_INVALID` | 分类层级、父子或循环 metadata 损坏 |
| 500 | `CATEGORY_SCHEMA_INVALID` | 属性绑定、类型、枚举、单位或定义 metadata 损坏 |
| 500 | `INTERNAL_ERROR` | 其他脱敏服务端错误 |

要求：

- metadata 损坏 fail-closed，不返回部分树、部分 Schema 或部分详情。
- 不返回 SQL、堆栈、数据库路径、D1 绑定、Token、Cookie 或原始异常。
- 无权查看的草稿和待审物料不通过不同状态码、消息或 details 泄露存在性。
- `details` 只包含安全的字段路径和稳定问题 code，不回显敏感值。

## 16. 性能与查询计划

### 16.1 分类 Reference

- 101 个分类节点一次查询并在内存中组装，避免按父节点四次往返。
- 39 个叶子 Schema 不预先常驻单实例内存。每次按分类读取当前 metadata，通过浏览器私有 ETag 缓存减少重复传输。
- 服务端若未来增加跨实例缓存，必须以内容摘要或持久 metadata 版本为键并保证变更失效；不在本任务设计内存唯一版本号。

### 16.2 物料列表

- 授权谓词必须进入列表和 count SQL，不能先读出全部记录后在应用层过滤。
- 先分页主记录，再批量加载当前页分类路径；不得逐项递归查询。
- 列表不加载属性、版本、变更日志或执行 Validation。
- `%keyword%` 包含匹配在大数据量下可能全表扫描；V1 不假定普通 B-tree 能优化该条件，也不在本任务擅自引入 FTS。

### 16.3 详情与历史

- 详情最多对一个可见物料执行一次当前 Validation。
- 主记录、属性、分类路径、两个 5 条摘要和计数应使用固定数量查询，可并行的只读查询可以并行。
- 完整历史只能通过独立分页资源读取，禁止无界返回。

## 17. 索引验证计划

本阶段不创建 migration 或索引。现有索引已覆盖部分状态、分类、审核队列和名称场景，但新统一查询的默认排序、授权 OR 谓词和组合筛选仍需证据。

实施阶段必须在一次性 Miniflare D1 中：

1. 显式应用 `0000` 至 `0003`，生成 1,000、10,000、100,000 条不含真实信息的合成物料，覆盖正式、草稿、待审状态和不同创建人倾斜分布。
2. 对普通 read、创建人、edit-any 和 review-queue 四种权限范围运行 `EXPLAIN QUERY PLAN`。
3. 覆盖默认列表、状态、分类、来源、创建人、日期、category_path、keyword、稳定排序和 count 查询。
4. 记录扫描行数代理、临时排序、平均及 P95 延迟、索引体积和写放大；热身后至少重复 20 次。
5. 只有在常见非 keyword 查询出现全表扫描/临时 B-tree，且候选索引在 100,000 行下带来可重复的实质改善时，才提出独立 migration。

待验证候选，不代表批准创建：

- `(material_status, updated_at, id)`。
- `(category_id, material_status, updated_at, id)`。
- `(source_type, material_status, updated_at, id)`。
- `(created_by, material_status, updated_at, id)`。

授权 OR 谓词可能使单一组合索引失效；实施者必须比较 OR、`UNION ALL` 去重和分支查询计划，但不得为了命中索引改变可见性语义。Keyword 若在 100,000 行规模下不满足目标，应提出独立 FTS/规范化搜索设计，不得把 FTS 混入本任务。

未经再次审批，不得新增索引 migration。

## 18. 实施阶段测试方案

全部 D1 测试使用 `ERP_ENV=test` 和本机一次性 Miniflare D1，显式关闭远程绑定并在结束后销毁。

### 18.1 认证、授权和隐藏

1. 未登录返回 `401 AUTH_REQUIRED`。
2. 缺少 `material.read` 返回 `403 FORBIDDEN`。
3. 普通 read 只看到正式状态。
4. 创建人额外看到自己的 DRAFT/PENDING_REVIEW。
5. edit-any 看到全部 DRAFT/PENDING_REVIEW。
6. review-queue 看到全部 PENDING_REVIEW，但不能据此看到非本人 DRAFT。
7. 列表 `total` 不包含隐藏记录，组合筛选不能扩大范围。
8. 不可见详情和历史返回 `404 MATERIAL_NOT_FOUND`。
9. `/review-queue` 仅凭 material.read 返回 403。
10. 响应不暴露用户角色、显示名或 API 审计信息。

### 18.2 分类树和 Schema

11. 分类树只返回连续可达的启用节点。
12. tree/flat 包含相同节点、叶子标记和稳定顺序。
13. 不支持 `parent_id` 懒加载或未知参数。
14. Schema 拒绝不存在、停用和非叶子分类。
15. Schema 正确返回必填、类型、精度、单位、枚举和 input contract。
16. 禁用绑定/属性完全不返回。
17. DATE、损坏枚举、孤儿绑定或无效单位 metadata fail-closed。
18. ETag 相同时返回 304；任一响应 metadata 或单位策略变化后 ETag 改变。

### 18.3 物料查询和历史

19. 默认 page_size=20，最大 100，禁止一次返回全部。
20. 状态、分类 ID/路径、来源、创建/更新时间和 keyword 筛选正确。
21. sort allowlist、null 编码规则和稳定次排序正确。
22. 列表不加载完整属性、历史或逐项 Validation。
23. 详情正确还原当前类型化属性和当前 Validation。
24. 详情版本/日志摘要各不超过 5 条且不返回完整 snapshot/前后值。
25. 两个历史子资源默认 20、最大 50、确定性分页并解析 JSON。
26. 损坏历史 JSON fail-closed，不泄露原始存储内容。
27. `/drafts` 核心响应兼容，但只返回授权范围内的 DRAFT/PENDING_REVIEW。
28. `/drafts` 提供无强制日期的替代接口提示。

### 18.4 缓存、安全和回归

29. Reference 304 仍先认证，并返回 ETag/Cache-Control/Vary/Request ID。
30. materials、drafts、review-queue 和历史统一 `private, no-store`。
31. 错误不泄露 SQL、堆栈、数据库路径、Token 或隐藏对象存在性。
32. 查询计划按第 17 节生成证据，未审批时数据库 schema 和索引不变。
33. 现有 62 个 Node 测试继续通过。
34. `npm run lint`、`npm test`、`npm run test:api`、凭证检查和 `git diff --check` 通过。
35. 本地 Python 基线使用临时 SQLite，通过环境守卫、自测、烟测、备份恢复和 `go_live_check --no-backup`。
36. 测试运行器在任何写入前拒绝 production、公开 URL 和远程 D1。

## 19. 本阶段验证与变更边界

第一阶段文档提交运行不写生产数据的现有隔离基线，并确认：

- 只新增本规格、OpenAPI 和项目治理文档。
- 未修改 `chenyida_erp_site/app/`、`db/schema.ts`、`drizzle/`、测试业务代码或前端。
- 未连接生产 D1、未执行 migration、未迁移真实物料、未部署。
- `git diff --check` 和凭证检查通过。

2026-07-14 实际验证结果：

- OpenAPI 3.1 YAML 解析通过；9 个 path、35 个 schema，内部 `$ref` 全部存在，operationId 无重复。
- Markdown 与 OpenAPI 的 9 个路由逐项一致，无 `TBD`、`TODO` 或占位符。
- `npm run lint`：0 error，保留 1 个任务外既有未使用变量 warning。
- `npm test`：build 通过，Node 62/62 通过。
- `npm run test:api`：本机一次性 Miniflare D1 smoke 通过，临时数据由运行器清理。
- `npm run security:credentials`：196 个仓库文件扫描通过。
- 项目 Python 3.12 临时 SQLite 环境：环境守卫 4/4、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py` 和 `go_live_check.py --no-backup` 通过；临时目录已清理。
- `git diff --check` 通过；最终变更不包含运行时代码、schema、migration、测试代码或部署配置。

## 20. 已确认事项与待确认事项

项目负责人已确认：

1. 采用方案 A：统一 `/materials`，`/drafts` 为兼容适配层，`/review-queue` 独立。
2. 正式状态对全部 material.read 用户可见；DRAFT/PENDING_REVIEW 按创建人和工作流权限执行第 6 节行级可见性。
3. 不可见详情返回 404，列表完全过滤且不计入 total。
4. 分类树一次返回完整启用节点，支持 `view=tree|flat`，不实现 parent_id 懒加载。
5. 详情仅有界历史摘要，完整历史使用独立分页子资源。
6. 分类树和 Schema 使用内容摘要 ETag；物料和历史统一 private/no-store。
7. 本阶段不创建 migration；候选索引必须有 EXPLAIN QUERY PLAN 和数据规模证据，并再次审批。

规格确认前仍待人工确认：

- 本文件和 `reference-query-api-v1.openapi.yaml` 的最终字段、状态码、分页上限和缓存 Header 是否作为实施冻结契约。
- V1 枚举因现有 metadata 无独立显示名而采用 `label = code`，属性 description 返回空字符串的兼容表达是否接受。

收到“规格确认”后才可建立后续实施计划。规格确认不自动授权任何 migration、索引、生产连接、生产迁移或部署。
