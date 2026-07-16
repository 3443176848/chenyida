# Material Import Mapping Target Catalog V1

> 任务：PHASE2-TASK06
>
> 状态：`PROPOSED`
>
> 日期：2026-07-16
>
> 范围：只读兼容 API 的规格、OpenAPI 与未来实施测试计划；本任务不修改运行时代码、Mapping 语义、Schema、Migration、Metadata、前端或生产环境。

## 1. 目标与非目标

本规格定义 Material Import Mapping 编辑器所需的服务端权威目标目录。目录必须让 UI 安全取得当前可选择的基础字段、动态属性和特殊目标，并返回与 Mapping 保存、预览和 confirm 共用语义的 `metadata_digest`。

V1 只解决以下兼容能力：

- 当前用户可见批次中的可选择 Mapping 目标；
- 运行时 D1 动态属性，而不是 seed、fixture 或历史 Mapping；
- 稳定 target namespace/code、展示名称、值类型、确认必填、默认值和单位策略；
- 有界搜索、分组和 cursor；
- 权限、行级可见性、read rate limit、request_id 和安全 API 审计；
- 已失效历史 target 的 UI 识别边界。

本任务不实施 Catalog API，不修改现有 Mapping PUT/preview/confirm，不改变 Parser 或批次生命周期，不修改 Metadata 数据，不创建 Migration，不实现 UI，不连接生产 D1/R2/Queue，不迁移或部署生产环境。

## 2. 真实实现审计

### 2.1 当前 Mapping 契约

当前非生产实现使用以下精确目标身份，Catalog 不得为了 UI 展示改名：

```json
{"target_namespace":"basic","target_code":"STANDARD_NAME"}
{"target_namespace":"attribute","target_code":"THICKNESS"}
{"target_namespace":"category_hint","target_code":"CATEGORY_HINT"}
{"target_namespace":"supplier_reference","target_code":"SUPPLIER_ITEM_CODE"}
{"target_namespace":"ignore","target_code":"IGNORE"}
```

因此 `basic.standard_name`、`attribute.THICKNESS` 只能作为人类说明或派生 selector key；正式 PUT/preview/confirm 仍分别提交现有 `target_namespace` 与大小写敏感的 `target_code`。Catalog 响应同样返回这两个原值。

### 2.2 已核验事实

| 检查项 | 当前事实 | 本规格影响 |
| --- | --- | --- |
| 基础 allowlist | `parser-service.ts` 导出 11 个 `BASIC_TARGETS`；`mapping-service.ts` 直接复用 | 后续抽到共享 Target Registry，不能在 API route 再复制 |
| 供应商 allowlist | 同一文件导出 5 个 `SUPPLIER_TARGETS` | 归入 Catalog `SPECIAL` 组，但 namespace/code 不变 |
| 特殊目标 | `CATEGORY_HINT` 与 `IGNORE` 在 `validateDraft()` 单独判断 | Registry 必须正式定义，不从历史 Mapping 反推 |
| 动态属性 | `material_attribute_definitions` 读取 `attribute_code,data_type,status`；保存时仅 ACTIVE 可选 | Catalog 只返回 ACTIVE，禁止返回 `attribute_id` |
| Mapping 校验 | 保存/preview 共用 `validateDraft()`；confirm 再读 metadata 并重跑该校验 | Catalog 必须与它们共享同一 snapshot/registry |
| confirm 必填 | 实现只要求 `basic/STANDARD_NAME` 与 `basic/UNIT` 存在 | `required_for_confirm=true` 仅用于这两个基础目标；全局属性不得虚构为必填 |
| ignore | 多个源列可各自映射 `ignore/IGNORE`；ignore 不进入普通目标唯一性 | Catalog 必须明确它不同于“尚未处理” |
| GET `/mapping` | 返回历史 namespace/code、Mapping 版本与已保存 digest，不返回完整 target catalog | 保持不变；Catalog 使用独立路由 |
| 行级可见性 | owner 可读自己的批次，`material.import.read_any` 可读任意授权域批次；隐藏批次返回 404 | Catalog 复用同一判定，不能只在页面隐藏 |
| capability | admin/manager/purchase/engineering 当前有 map；`read_any` 不隐含 map | Catalog 同时要求 read、map 和行级可见性 |
| cursor | Import 列表已有不透明 cursor；Mapping Rows 使用页码 | Catalog 定义独立 cursor，不复用列表 cursor 或随机页码 |
| 错误形态 | Import handler 当前为顶层 `request_id` + `error.code/message`；UI 已计划兼容顶层/嵌套 request_id | Catalog 采用兼容过渡结构，两个 request_id 必须相同 |
| API 审计 | Mapping 写成功有业务审计，Import handler 对已认证失败写拒绝审计；普通 GET 成功未形成 route 级读取审计 | Catalog 实施时补充安全读取审计，不记录 q/cursor 正文 |
| 可复用 Metadata Query | `MaterialReferenceQueryService` 可复用 canonical JSON、unit policy 与属性投影思想，但其 Category Schema 是按叶子分类读取，且不提供全局 Mapping Catalog | 复用投影工具，不把 Category API 当 Catalog，也不读取 seed |

### 2.3 当前 digest 差异与前置重构

当前 Mapping digest 为：

```text
SHA-256(JSON.stringify({
  basic: BASIC_TARGETS,
  supplier: SUPPLIER_TARGETS,
  attributes: SELECT attribute_code,data_type,status ORDER BY attribute_code
}))
```

Parser Mapping 准备与 `mapping-service.ts` 各自实现了一次同语义投影。该 digest **不能安全直接作为 Catalog V1 digest**，因为它不包含：

- `CATEGORY_HINT`、`IGNORE`；
- target namespace、确认必填规则与可选择状态；
- mapping modes 与默认值策略；
- `canonical_unit`、兼容单位、decimal scale、枚举值和 normalization rule；
- confirm 实际需要使用的其他业务约束。

后续实施的硬前置是最小共享重构，状态保持 `PROPOSED`：

```text
MaterialImportMappingMetadataRepository
  -> MaterialImportMappingTargetRegistry
  -> MappingMetadataSnapshotV1
       -> Catalog projection/search/cursor
       -> Mapping preparation digest
       -> PUT/preview target validation
       -> confirm digest and final validation
```

不得先新增 Catalog 的第二套 digest，再让 confirm 继续使用旧算法。重构不得扩大可接受 Mapping 目标、改变 target code、自动替换历史目标或引入新的 Mapping 表达式。

## 3. 路由方案比较

### 3.1 方案 A：批次作用域（推荐）

```http
GET /api/material-master/import-batches/{batchId}/mapping-targets
```

优点：复用批次 owner/`read_any` 可见性和安全 404；可以绑定当前 `current_parse_run_id`；返回与当前 Mapping 流程一致的 digest；不会扩大成全局 Metadata 浏览接口。代价是同一页面切换批次必须重读 Catalog，且服务层要把批次授权与 Metadata 查询组合起来。

### 3.2 方案 B：全局作用域

```http
GET /api/material-master/import-mapping-targets
```

优点是跨批次缓存简单。缺点是缺少天然行级作用域，容易把 `material.import.map` 误当成全局 Metadata 浏览权；还必须另外证明 digest 与具体 parse run/批次状态兼容。V1 不推荐。

### 3.3 方案 C：混入现有 Mapping 聚合

```http
GET /api/material-master/import-batches/{batchId}/mapping
```

优点是少一个请求。缺点是污染 Mapping 聚合职责，使 Mapping payload 随动态属性数量膨胀，无法独立搜索和分页，也让历史 Mapping 与当前可选目标难以区分。V1 不采用。

## 4. 推荐 API 契约

### 4.1 请求

```http
GET /api/material-master/import-batches/{batchId}/mapping-targets
    ?namespace=BASIC|ATTRIBUTE|SPECIAL
    &q=<text>
    &limit=<1..100>
    &cursor=<opaque>
```

- `namespace` 可省略；省略表示跨组读取。
- `q` 去除首尾空白后长度 1–64；空白等价于省略。搜索仅覆盖 `target_code`、`display_name`、`description`，不接受 SQL、正则、JSONPath 或脚本。
- `limit` 默认 50，最大 100。
- `cursor` 最大 1024 字符，客户端必须视为不透明字符串。
- 未声明参数返回 `400 IMPORT_MAPPING_TARGET_QUERY_INVALID`。
- GET 不需要 CSRF 或 `Idempotency-Key`，但仍需认证、授权、读取限流、request_id 和审计。

### 4.2 响应

```json
{
  "batch_id": 123,
  "parse_run_id": 456,
  "metadata_digest": "64-lowercase-hex",
  "items": [
    {
      "group_code": "ATTRIBUTE",
      "target_namespace": "attribute",
      "target_code": "THICKNESS",
      "display_name": "板厚",
      "description": "",
      "value_type": "DECIMAL",
      "required_for_confirm": false,
      "mapping_modes": ["SOURCE", "SOURCE_WITH_DEFAULT", "DEFAULT"],
      "default_value_policy": {
        "allowed": true,
        "allowed_json_types": ["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"]
      },
      "unit_policy": {
        "mode": "CANONICAL",
        "canonical_unit": "mm",
        "allowed_units": ["mm", "um"]
      },
      "value_constraints": {
        "decimal_scale": 3,
        "enum_values": [],
        "normalization_rule": "DECIMAL_SCALE"
      },
      "enabled": true,
      "selectable": true,
      "constraints": []
    }
  ],
  "next_cursor": null,
  "request_id": "request-id"
}
```

Catalog 只返回当前可以建立**新 Mapping** 的目标，因此 V1 item 中 `enabled` 和 `selectable` 恒为 `true`。保留字段是为了让 UI 不从“出现于列表”隐式推断状态，并为未来兼容扩展提供稳定位置；禁用属性不返回。

`description` 对动态属性固定使用 D1 当前可提供的安全文本；现有属性定义表没有 description，因此当前应返回空字符串，不得从 seed、注释或名称生成描述。

### 4.3 分组与正式目标身份

| group_code | 实际 target_namespace | 来源 | 目标 |
| --- | --- | --- | --- |
| BASIC | `basic` | 共享 Target Registry | 现有 11 个 `BASIC_TARGETS` |
| ATTRIBUTE | `attribute` | D1 当前 ACTIVE 属性定义 | `target_code` 为稳定大写 attribute code |
| SPECIAL | `category_hint` | 共享 Target Registry | `CATEGORY_HINT` |
| SPECIAL | `supplier_reference` | 共享 Target Registry | 现有 5 个 `SUPPLIER_TARGETS` |
| SPECIAL | `ignore` | 共享 Target Registry | `IGNORE` |

`group_code` 只用于 Catalog 分组；PUT/preview/confirm 的 `target_namespace` 仍使用上述现有小写值。

### 4.4 基础与特殊目标规则

共享 Registry 必须正式保存基础/特殊目标的 display name、description、value type、mapping modes、默认值、单位策略、确认必填和稳定显示顺序。首版严格映射现有能力：

- `STANDARD_NAME`、`UNIT`：`required_for_confirm=true`；其余 false。
- 非 ignore 目标：`SOURCE`、`SOURCE_WITH_DEFAULT`、`DEFAULT`。
- `ignore/IGNORE`：仅 `IGNORE`，允许多个源列使用，不参加普通目标唯一性。
- `CATEGORY_HINT` 只是提示文本，不是 `category_id` 或分类合法性证明。
- supplier reference 只保存导入 DTO 意图，不创建供应商映射。
- enum 允许值必须来自现有 Material Master 常量/权威规则，不从 UI 推断。

首版静态 Registry 冻结为下表；`display_name` 是建议中文展示，正式实施时必须以本表建立可审阅定义，不能从 code 临时格式化：

| group | namespace/code | display_name | value_type | confirm 必填 | 约束摘要 |
| --- | --- | --- | --- | --- | --- |
| BASIC | `basic/STANDARD_NAME` | 标准名称 | TEXT | 是 | 非空文本 |
| BASIC | `basic/UNIT` | 基本单位 | TEXT | 是 | 非空单位 code |
| BASIC | `basic/BRAND` | 品牌 | TEXT | 否 | 文本 |
| BASIC | `basic/MANUFACTURER` | 制造商 | TEXT | 否 | 文本 |
| BASIC | `basic/MANUFACTURER_PART_NUMBER` | 制造商料号 | TEXT | 否 | 文本 |
| BASIC | `basic/PURCHASE_TYPE` | 采购类型 | ENUM | 否 | `PURCHASE`,`OUTSOURCE`,`SELF_MADE`,`NON_PURCHASABLE` |
| BASIC | `basic/INVENTORY_TYPE` | 库存类型 | ENUM | 否 | `STOCKED`,`NON_STOCKED`,`CONSIGNMENT` |
| BASIC | `basic/LOT_CONTROL` | 批次控制 | BOOLEAN | 否 | 布尔值 |
| BASIC | `basic/SHELF_LIFE_DAYS` | 保质期天数 | INTEGER | 否 | 非负安全整数 |
| BASIC | `basic/INSPECTION_TYPE` | 检验类型 | ENUM | 否 | `NONE`,`NORMAL`,`TIGHTENED`,`REDUCED`,`FULL` |
| BASIC | `basic/ENVIRONMENTAL_REQUIREMENT` | 环保要求 | ENUM | 否 | `UNSPECIFIED`,`ROHS`,`ROHS_REACH`,`HALOGEN_FREE`,`CUSTOMER_SPECIFIC` |
| SPECIAL | `category_hint/CATEGORY_HINT` | 分类提示 | TEXT | 否 | 仅后续分类提示，不是分类 ID |
| SPECIAL | `supplier_reference/SUPPLIER_NAME` | 供应商名称 | TEXT | 否 | 仅供应商参考 |
| SPECIAL | `supplier_reference/SUPPLIER_ITEM_CODE` | 供应商料号 | TEXT | 否 | 仅供应商参考 |
| SPECIAL | `supplier_reference/SUPPLIER_ITEM_NAME` | 供应商物料名称 | TEXT | 否 | 仅供应商参考 |
| SPECIAL | `supplier_reference/SUPPLIER_SPECIFICATION` | 供应商规格 | TEXT | 否 | 仅供应商参考 |
| SPECIAL | `supplier_reference/PURCHASE_UOM` | 采购单位 | TEXT | 否 | 仅供应商参考 |
| SPECIAL | `ignore/IGNORE` | 明确忽略 | NONE | 否 | 仅 `IGNORE` mode；可被多个源列使用 |

所有静态非 ignore 目标沿用当前 `SOURCE`、`SOURCE_WITH_DEFAULT`、`DEFAULT`；`IGNORE` 不允许默认值。静态目标的 `unit_policy.mode=NOT_APPLICABLE`，因为 `UNIT`/`PURCHASE_UOM` 自身是单位 code 值，而不是带计量单位的数值目标。

### 4.5 动态属性边界

- Repository 只查询 `status='ACTIVE'` 的稳定 attribute code、中文名、data type、decimal scale、canonical unit、allowed values、normalization rule 和 version。
- 不返回 `attribute_id`、数据库列名、表名、SQL、seed version 或内部审计字段。
- Catalog 出现某属性只表示该 code 当前可作为 Mapping 目标，不表示它适用于每一条最终物料。
- 当前尚无正式自动分类；`category_hint` 不等于 category id。
- 动态属性全局 `required_for_confirm=false`。属性最终是否适用于物料、是否必填，仍由后续分类、清洗和 Material Validation 决定。
- enum values 最多 200 项；损坏、重复、超限或不受支持的 metadata 使 Catalog fail closed 为 `IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE`，不得返回半真半假的目标。

## 5. digest 冻结语义

### 5.1 `metadata_digest`

算法标识为 `material-import-mapping-metadata-v1`。使用 UTF-8、规范 JSON、对象键字典序、数组按正式稳定顺序，计算 SHA-256 小写十六进制。digest 输入包含每个目标的：

- `target_namespace`、`target_code`、group；
- enabled/selectable；
- value type；
- required-for-confirm；
- mapping modes；
- default value policy；
- unit policy；
- decimal scale、enum codes、normalization rule；
- 其他 PUT/preview/confirm 实际使用的业务约束。

以下纯展示内容不进入 `metadata_digest`：

- `display_name`；
- `description`；
- UI 分组标题与展示顺序。

因此业务语义变化一定改变 digest；纯文案变化不会使已保存 Mapping 失效。digest 不是访问凭证、确认结果、幂等键或客户端可自行生成的可信值。

### 5.2 搜索 cursor 的展示快照

展示文案虽然不进入 Mapping digest，却可能改变 `q` 的搜索命中。服务端 cursor 另外绑定内部 `search_projection_digest`，其输入包含 code、display name、description 和排序键。它只用于分页一致性，不返回客户端，也不参与 confirm。

任何 Mapping 业务 metadata 或搜索投影在翻页间变化，旧 cursor 返回：

```http
409 IMPORT_MAPPING_TARGET_CATALOG_CHANGED
```

并在安全 details 中返回 `restart_from_first_page=true`。服务端不得把不同 Metadata 版本的页面静默拼接，也不得自动把 cursor 当作第一页。

## 6. 搜索、排序与 cursor

V1 对 BASIC、ATTRIBUTE、SPECIAL 使用统一平铺分页；不采用“基础/特殊永远完整、只有属性分页”的混合响应。这样 `limit` 始终是整个响应的真实上限，搜索和 cursor 语义一致。

稳定顺序为：

```text
group_rank(BASIC=10, ATTRIBUTE=20, SPECIAL=30)
-> registry/display_order
-> target_namespace ASCII ascending
-> target_code ASCII ascending
```

动态属性没有全局 category display order，使用 `attribute_code` 作为稳定顺序。搜索不改变排序，只过滤命中项。

cursor 是版本化 base64url 规范 JSON，绑定：cursor version、`metadata_digest`、内部 search projection digest、namespace、规范化 q 的 SHA-256、limit 和最后排序键。客户端不得解析；服务端严格验证长度、版本、类型和绑定条件。cursor 不需要成为秘密或访问凭证，所有查询仍重新认证、授权并使用绑定参数；篡改或查询条件不匹配返回 `400 IMPORT_MAPPING_TARGET_QUERY_INVALID`。

## 7. 权限、行级可见性与缓存

检查顺序固定：

1. 无有效 Session：`401 AUTH_REQUIRED`；
2. 缺 `material.import.read`：`403 FORBIDDEN`，不查询目标批次；
3. 以列表/详情相同的 owner/`read_any` 条件读取批次；不可见统一 `404 IMPORT_BATCH_NOT_FOUND`；
4. 缺 `material.import.map`：`403 FORBIDDEN`；
5. 绑定批次当前 `current_parse_run_id`；只允许 `PARSED`、`AWAITING_MAPPING`、`MAPPING_CONFIRMED`，其他状态返回 `409 IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE`；
6. 消耗读取限流，生成 Catalog。

`read_any` 不自动包含 map。Catalog 不返回其他用户批次信息、owner、文件信息、Sheet 内容或历史 Mapping。

缓存方案比较：

| 方案 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- |
| A `private, no-store` | 权限变化后不会复用旧受保护 Catalog；最简单 | 每次重新读取 metadata | **V1 推荐** |
| B private revalidation + ETag | 可减少响应体 | 需精确定义账户/批次/权限变化与 304 审计 | 后续候选 |
| C 浏览器长期缓存 | 请求少 | 可能跨账号、批次或权限复用 | 禁止 |

响应固定 `Cache-Control: private, no-store`、`Pragma: no-cache`，不发送公共缓存指令。前端只能在当前页面会话内按 account + batch + parse run + digest 缓存，不写 localStorage/sessionStorage/IndexedDB。

## 8. 禁用与历史失效目标

V1 不增加 code resolver 或按 code 批量解析接口，避免扩大 API：

- `GET /mapping` 继续返回历史保存的 namespace/code 和 items；
- Catalog 只返回当前 selectable 目标；
- UI 以精确 `(target_namespace,target_code)` 连接，未命中显示“已失效目标”；
- UI 不自动删除、替换或把失效属性改成同名属性；
- 保存、preview、confirm 由服务端返回稳定 target invalid/metadata conflict；
- 历史 item 不被 Catalog 读取删除。

只有实际 UI 证明无法安全展示历史 code 时，才另立受控 resolver 任务。

## 9. 错误、限流与 API 审计

### 9.1 稳定错误

| HTTP | code | 使用场景 |
| ---: | --- | --- |
| 400 | `IMPORT_MAPPING_TARGET_QUERY_INVALID` | namespace/q/limit/cursor/未知参数无效 |
| 401 | `AUTH_REQUIRED` | 未认证 |
| 403 | `FORBIDDEN` | 缺 read 或 map capability |
| 404 | `IMPORT_BATCH_NOT_FOUND` | 批次不存在或行级不可见 |
| 409 | `IMPORT_MAPPING_TARGET_CATALOG_CHANGED` | cursor 所绑定 Metadata/搜索投影已变化 |
| 429 | `RATE_LIMITED` | 读取限流；必须带 `Retry-After` |
| 503 | `IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE` | 共享 Registry/Metadata 损坏、超限或暂不可用 |
| 500 | `INTERNAL_ERROR` | 其他安全内部错误 |

为兼容当前 Import handler 与 UI 归一化，过渡错误响应同时保留顶层和嵌套 request id，二者必须完全相同：

```json
{
  "request_id": "request-id",
  "error": {
    "code": "IMPORT_MAPPING_TARGET_QUERY_INVALID",
    "message": "查询条件无效",
    "request_id": "request-id",
    "details": []
  }
}
```

不得返回 SQL、堆栈、数据库表/列、attribute id、数据库路径、Token、Cookie、CSRF、完整 cursor、完整 q 或未清理 Metadata 正文。

### 9.2 read rate limit

当前 Import GET 没有专用读取限流器。实施必须注入独立 `MaterialImportReadRateLimiter`，不能用读取请求消耗现有写请求/new-key 配额。建议默认每用户每分钟 120 次 Catalog 请求，admin 不豁免，阈值可按测试/部署配置降低；生产限流后端或资源仍需单独批准。限流不可用时生产实现 fail closed，测试使用确定性内存替身。

### 9.3 安全审计

每次已认证 Catalog 请求记录 route code、actor、batch id、结果、稳定 error code、request id 和时间。成功审计只记录 namespace、limit、是否有 q、q 长度和是否有 cursor；不记录 q/cursor 正文、items、attribute metadata 或响应。未认证失败不写用户审计；审计写失败不得把内部异常返回浏览器。

## 10. 与 Mapping UI 的集成

```text
GET batch detail
  -> GET current mapping
  -> GET mapping target catalog page(s)
  -> exact namespace/code join
  -> edit with current metadata_digest
  -> PUT complete mapping
  -> bounded preview
  -> confirm re-reads shared snapshot and digest
```

以下事件使页面内 Catalog、preview 和写准备失效：

- `metadata_digest` 变化；
- `current_parse_run_id` 变化；
- 批次权限或账号变化；
- 保存响应返回不同 digest；
- preview/confirm 返回 target invalid 或 catalog changed；
- 页面重新登录为其他账号。

Catalog 成功不表示 Metadata 之后不会改变，也不表示 Mapping 已通过 confirm。Catalog 不可用时 `MaterialImportTargetSelector` 整体阻断，已有 Mapping 可只读显示 namespace/code，但不得从 seed、fixture、硬编码或历史 Mapping 构造可选项。

## 11. 服务实现边界

推荐后续模块：

```text
MaterialImportMappingMetadataRepository
  - 只读 D1 ACTIVE attribute definitions

MaterialImportMappingTargetRegistry
  - 正式定义 BASIC 和 SPECIAL
  - 合并 Repository 动态 ATTRIBUTE
  - 生成 MappingMetadataSnapshotV1

MaterialImportMappingTargetCatalogService
  - 批次可见性和 map capability
  - search/cursor/page DTO
  - metadata_digest
  - read rate limit and audit input
```

Mapping preparation、PUT、preview、confirm 必须调用同一 Registry/Snapshot，不得由 API route 复制 allowlist、属性查询、default policy、unit policy 或 digest 算法。Category Reference Query 可以复用 canonical JSON、unit policy 和安全属性投影工具，但不能代替全局 Catalog Repository。

## 12. 未来实施测试计划（43 项）

实施测试只使用本机一次性 Miniflare D1/确定性替身，拒绝生产 URL 和远程 binding，结束后销毁测试数据。

1. 未登录读取返回 401；
2. 无 `material.import.read` 返回 403；
3. 有 read 无 map 返回 403；
4. 隐藏批次返回 404；
5. owner 批次可读，响应绑定正确 batch id 与 current parse run id；
6. `read_any` 可读其他授权域批次；
7. BASIC 11 个现有目标完整且 code 一致；
8. SPECIAL 包含 category hint、5 个 supplier reference 和 ignore；
9. ACTIVE 动态属性成为 ATTRIBUTE 目标；
10. INACTIVE 属性不成为新目标；
11. 响应不包含 `attribute_id`；
12. 响应不包含数据库表/列名；
13. target namespace/code 与 Mapping Service 一致；
14. `STANDARD_NAME` 标记 confirm 必填；
15. `UNIT` 标记 confirm 必填；
16. 多源可各自使用 ignore；
17. value type 来自正式 Registry/D1；
18. default value policy 与共享校验一致；
19. unit policy 与共享校验一致；
20. namespace 单组筛选；
21. q 按允许显示字段/code 搜索并保持稳定顺序；
22. q 长度、控制字符和未知参数拒绝；
23. cursor 分页不重不漏；
24. cursor 是不透明字符串且不作为凭证；
25. cursor 绑定 namespace/q/limit；
26. Metadata 或展示搜索投影变化使旧 cursor 409；
27. 同一语义快照在不同查询顺序下 digest 稳定；
28. target 业务规则变化使 digest 变化；
29. 纯 display name/description 变化不改变 Mapping digest；
30. Mapping 保存使用同一 digest snapshot；
31. confirm 使用同一 Registry/Metadata snapshot；
32. 历史失效 target 在 GET mapping 保留、Catalog 不返回 selectable；
33. limit 缺失使用默认且上限拒绝；
34. 429 含 `Retry-After` 且不与写配额混用；
35. 500/503 只返回安全错误；
36. 顶层与嵌套 request_id 一致；
37. display/description/错误均为纯文本；
38. 运行时不读取 seed/fixture；
39. API 审计不记录 q/cursor/metadata 正文；
40. OpenAPI 3.1 YAML 可解析且本地引用有效；
41. 一次性 Miniflare D1 端到端读取；
42. 环境守卫拒绝生产 URL/远程 binding；
43. 当前全量 Node 288/288 与本地 SQLite 基线继续通过。

## 13. 待确认决策

以下 12 项全部保持 `Status: PROPOSED`，只有项目负责人审阅本规格和 OpenAPI 后回复“规格确认”才能进入后续实现任务。

| # / 决定 | 可选方案 | 推荐方案 | 推荐理由 | API 影响 | 服务层影响 | 安全影响 | UI 影响 | 性能影响 | 实施复杂度 | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 路由作用域 | 批次 / 全局 / 混入 Mapping | 批次作用域 A | 复用可见性、current run 和安全 404 | 新增一个 GET | 组合批次与 Catalog Service | 不扩大 Metadata 浏览面 | 与工作区天然绑定 | 每批重读 | 中 | PROPOSED |
| 2 capability | read / map / 两者 | read + map + 行级可见性 | `read_any` 不等于可编辑 | 401/403/404 顺序冻结 | 显式双能力检查 | 最小权限 | 无 map 时不建立 selector | 可忽略 | 低 | PROPOSED |
| 3 分组模型 | namespace 直出 / 三组 | BASIC/ATTRIBUTE/SPECIAL，保留实际 namespace | UI 可分组且不改 Mapping 身份 | 增加 group_code | Registry 投影 | 不暴露内部分类 | 搜索分组明确 | 低 | 低中 | PROPOSED |
| 4 target DTO | 最小 code / 完整约束摘要 | 本规格 DTO | UI 不靠硬编码判断类型/默认/单位 | 响应字段冻结 | 共享投影 | 不返回 ID/列名 | 可安全渲染 selector | 响应略增 | 中 | PROPOSED |
| 5 基础来源 | route 常量 / Parser 常量 / 共享 Registry | 抽共享 Registry | 避免 route/confirm 漂移 | 无 code 变化 | 最小重构 | 单一校验源 | 无感 | 低 | 中 | PROPOSED |
| 6 动态属性来源 | seed / 历史 Mapping / D1 | 当前 ACTIVE D1 metadata | D1 是运行时权威 | ATTRIBUTE 动态 | 新只读 Repository | 禁止 ID/seed 泄露 | 可实时更新 | 有界查询 | 中 | PROPOSED |
| 7 digest | 复用旧 / Catalog 第二套 / 共享新 snapshot | 共享 Snapshot V1 | 旧 digest 缺必要语义，第二套必漂移 | 返回统一 digest | preparation/save/preview/confirm 共用 | digest 非凭证 | 保存和恢复可靠 | 每快照计算一次 | 中高 | PROPOSED |
| 8 展示字段进 digest | 全进 / 全不进 / 双摘要 | Mapping digest 不进，cursor 搜索摘要进入 | 文案不使 Mapping 失效，分页仍一致 | cursor 内部绑定 | 两种明确投影 | 防混页 | 文案更新不阻塞旧 Mapping | 少量 hash | 中 | PROPOSED |
| 9 搜索/cursor | 页码 / 混合分页 / 统一 cursor | 三组统一 cursor | limit 语义一致且有界 | q/limit/cursor | 稳定合并排序 | 无 SQL/regex 输入 | 跨组搜索一致 | 不无界返回 | 中高 | PROPOSED |
| 10 历史失效展示 | resolver / Catalog 含禁用 / 精确 miss | 不增 resolver，UI 精确 miss | 最小 API 且不泄露禁用 metadata | GET mapping 保持 | 无额外查询 | 不暴露禁用详情 | 显示“已失效目标” | 最低 | 低 | PROPOSED |
| 11 缓存/ETag | no-store / private ETag / 长缓存 | private, no-store | 权限变化后不复用 | 固定响应头 | 无 304 分支 | 最稳妥 | 页面会话内缓存 | Metadata 每次读 | 低 | PROPOSED |
| 12 Catalog 不可用 | 降级基础字段 / 历史反推 / 整体阻断 | 503 整体阻断 selector | 禁止半真 Catalog 绕门禁 | 稳定 NOT_AVAILABLE | fail closed | 不误导写入 | 可只读看旧 Mapping | 无额外回退 | 低 | PROPOSED |

## 14. 完成边界

PHASE2-TASK06 完成正式规格、OpenAPI、项目台账、docs-only 验证和独立提交后停止，等待“规格确认”。不得自动开始 API 实现、UI、Schema/Migration、Metadata 修改、生产资源、生产连接、迁移或部署。
