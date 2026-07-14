# Material Draft 创建、编辑与提交审核界面 V1

状态：`APPROVED_SPECIFICATION_ONLY`

任务：`PHASE1-TASK10`

日期：2026-07-14

目标运行面：`chenyida_erp_site/` 在线 Site

实施状态：只完成书面规格与低保真线框稿；未实施前端、API、Schema、Migration 或生产变更。

低保真线框稿见 [material-draft-ui-v1-wireframes.md](./material-draft-ui-v1-wireframes.md)。

## 1. 目标与设计结论

设计中文、桌面优先、安全且可扩展的 Material Draft 创建、编辑与提交审核界面。V1 只覆盖人工草稿的创建、`DRAFT` 编辑、Validation 问题修正、提交审核、乐观锁冲突和驳回后的重新编辑/提交。

已批准的核心结论：

- 新建路由为 `/materials/new`，编辑路由为 `/materials/:materialId/edit`。
- 采用布局 C：顶部分类与基础信息并列，下方全宽动态属性，右侧快速定位与 Validation 摘要。
- 允许未选择分类时先填写基础字段；只有启用四级叶子、当前 Schema 加载成功且已构造最终属性集合后才能保存。
- 创建成功后进入编辑页，并通过统一详情 GET 重新加载服务端完整聚合。
- PATCH 是完整可编辑聚合替换，不是 Merge Patch；未发送的旧属性表示删除。
- “保存并提交审核”分为 PATCH、GET 最新详情与 Validation、WARNING 确认、submit 四个明确阶段。
- 写请求使用页面内存中的幂等操作状态机；网络结果不确定时只允许原 Key、原 method、原 endpoint 和原载荷安全重试。
- 冲突不自动合并、不强制覆盖、不重发旧版本。
- 未保存内容不写入 `localStorage` 或 `sessionStorage`。
- `/api/session` 现有 `user.permissions` 是能力来源，不硬编码角色名，不调整 Session API。
- `last_rejection` 是正式前端实施前置的最小只读 API 兼容项；本任务只定义契约，不实施 API。

## 2. 范围与禁止事项

### 2.1 包含

- 创建 `MANUAL` 物料草稿。
- 编辑当前用户有权编辑的 `DRAFT`。
- 分类树选择、当前分类 Schema 加载和 Schema 驱动属性表单。
- 本地基础格式检查和服务端结构化 Validation 展示。
- 保存草稿、保存并提交审核、直接提交未修改草稿。
- 保存成功但同步或提交失败的部分成功状态。
- Idempotency-Key、CSRF、重复点击、响应丢失与安全重试的前端设计。
- `VERSION_CONFLICT` 本地/服务器只读对照。
- dirty、`SAVED_UNSYNCED`、`RESULT_UNKNOWN` 和离开保护。
- 驳回原因只读展示、重新编辑和重新提交。
- 权限、状态、错误、键盘操作和可访问性。
- 实施阶段的单元、组件、集成、端到端和人工验收计划。

### 2.2 不包含

- 审核队列。
- 批准或驳回操作。
- Excel/CSV 导入、批量创建或批量操作。
- AI 分类、候选匹配或 AI 建议。
- 正式物料修改、冻结、停用、替代或删除。
- 新增写接口、validate-only API 或扩展创建响应。
- Schema、Migration、索引或 Material 业务服务修改。
- BOM、采购、库存、生产或 Legacy SQLite 修改。
- 生产 D1 连接、生产迁移、真实数据回填、生产部署或发布。

## 3. 当前实现事实与兼容结论

### 3.1 可直接复用

- 现有 `MaterialShell`、顶部栏、210px 左侧导航和 Material 视觉语言。
- 现有登录遮罩、`CYD_ERP_SESSION` 会话和安全 `return_to`。
- `GET /api/session` 返回的 `user.permissions` 与 `csrf_token`。
- `public/erp/api-client.js` 作为唯一浏览器 HTTP 边界。
- 分类树 `GET /api/material-master/categories?view=tree`。
- 四级叶子 Schema `GET /api/material-master/categories/:categoryId/schema`。
- 统一详情 `GET /api/material-master/materials/:materialId`。
- 创建、完整替换编辑和提交 API。
- Material 嵌套错误外壳、稳定错误 code、`request_id` 和现有登录失效事件。
- 现有按钮、表单、状态标签、toast 和 dialog 视觉样式；实施时可抽取 React 级可访问原语，但不得新建组件库。

### 3.2 共享 Client 的前端兼容调整

当前共享 Client 只为 POST 自动生成 Idempotency-Key，且没有统一注入 Material 写请求所需 CSRF。实施阶段必须在同一 Client 中增加显式写请求上下文：

```ts
type ProtectedWriteContext = {
  idempotencyKey: string;
  csrfToken: string;
};
```

要求：

- 覆盖 POST 创建、PATCH 保存和 POST submit。
- 显式提供 Key 时不得再自动生成第二个 Key。
- 受保护写请求没有显式 Key 或 CSRF 时 fail-closed，不得静默发送。
- Token 只来自当前 `/api/session`，不进入 URL、日志、错误对象或持久存储。
- 401 或会话更新后重新取得 Session/CSRF，不无限重放旧 Token。
- 该调整只修改前端请求边界，不改变后端 API 契约。

### 3.3 `source_ref` 的实际契约

- POST 创建的 `source_ref` 在现有 handler 中允许省略；省略或空字符串时服务端生成 `request:<operation_id>`。
- PATCH `basic_fields` 白名单不接受 `source_ref`；发送它会触发请求校验失败。
- 因此创建页不显示可编辑 `source_ref`，POST 省略该字段；编辑页只读展示服务端值，PATCH 不发送。
- `source_type` 固定为 `MANUAL`，页面显示“人工”，不提供其他来源选择器。

### 3.4 API 前置缺口

统一详情只内嵌最近 5 条历史，版本分页没有 `event_type=REJECT` 过滤，因此不能可靠投影最近一次驳回。正式前端实施前必须通过独立任务增加第 17 节定义的 `last_rejection` 只读字段。本任务不修改 API。

## 4. 路由、返回协议与页面入口

| 页面 | 路由 | 主要能力 |
| --- | --- | --- |
| 新建草稿 | `/materials/new` | `material.draft.create` |
| 编辑草稿 | `/materials/:materialId/edit` | `material.draft.edit_own` 或 `material.draft.edit_any` |

### 4.1 安全 `return_to`

- 继续使用现有 `safeMaterialReturnTo()`。
- 只接受 `/materials` 或其子路径的同源相对地址；拒绝 scheme、host、协议相对 URL 和反斜杠。
- 新建、编辑、详情跳转、提交成功和版本冲突刷新均保留已验证的 `return_to`。
- `return_to` 只属于 UI 路由，不发送给 Material API。
- 默认回退为 `/materials`。

### 4.2 页面标题

- 新建：`新建物料草稿 - 晨亿达 ERP`。
- 编辑：`{standard_name} - 编辑物料草稿 - 晨亿达 ERP`。
- 阻止状态仍使用编辑页标题，但必须在正文明确当前不可编辑原因。

## 5. 权限、所有权与状态边界

### 5.1 能力来源

页面只读取：

```text
GET /api/session -> user.permissions
```

不读取或硬编码 `admin`、`manager`、`purchase`、`engineering`。隐藏按钮只用于交互，服务端仍在每个写请求重新校验身份、权限、所有权、状态和版本。

### 5.2 新建页

- 缺少 `material.draft.create` 时使用现有 403 页面，不加载分类或表单业务数据。
- `must_change_password` 账号不得执行写操作；以服务端 `PASSWORD_CHANGE_REQUIRED` 为最终结论。

### 5.3 编辑页

显示可编辑表单必须同时满足：

1. 服务端返回状态为 `DRAFT`。
2. 用户拥有 `material.draft.edit_any`；或拥有 `material.draft.edit_own` 且详情 `created_by` 等于当前会话 `username`。
3. 当前 Schema 已成功加载并安全映射现有属性。

提交按钮还要求 `material.draft.submit`，并满足 own/edit-any 组合授权。

PENDING_REVIEW、ACTIVE 或其他不可编辑状态访问编辑页时，显示只读阻止页面和“查看详情”。不得通过改变前端状态绕过 PATCH 服务端校验。

### 5.4 权限或状态在页面期间变化

写请求返回 `403`、`DRAFT_NOT_EDITABLE` 或 `MATERIAL_NOT_SUBMITTABLE` 时：

1. 立即关闭保存和提交能力。
2. 停止后续自动请求。
3. 重新读取安全详情或状态。
4. 不再显示可能已经失去权限的服务端草稿正文。
5. 不把正文写入 localStorage、sessionStorage 或共享缓存。

## 6. 布局 C 与响应行为

### 6.1 桌面布局

- 沿用 64px 顶栏和约 210px 左侧导航。
- 页面内容使用 `minmax(0, 1fr) + 约 200px` 的主体/辅助栏布局。
- 1366×768、100% 缩放下，主要表单目标可用宽度不少于约 860px。
- 顶部左侧为分类，右侧为基础信息；两者在首屏并列。
- 动态属性在下方使用主体全宽，桌面优先三列。
- 右侧区域包含快速定位、Validation 摘要和当前保存状态，可 sticky，但不能遮挡字段或焦点。
- 底部操作区 sticky，包含返回、保存草稿、保存并提交审核及文字状态；正文为其预留空间，不能覆盖最后一个字段。

### 6.2 窄宽降级

- 当内容区不足以保持主体宽度时，快速定位和 Validation 摘要移动到表单顶部并可折叠。
- 不继续压缩主要表单。
- 分类与基础信息改为单列。
- 动态属性按空间从三列降为两列，再降为单列。
- sticky 辅助栏失效后，错误摘要仍位于保存动作之前且可快速发现。

### 6.3 明确文字状态

以下状态必须用中文文字表达，不只依赖图标、颜色或动画：

- 保存中。
- 同步中。
- 结果待确认。
- 已保存但尚未同步。
- 请求受限。
- 提交中。

## 7. 页面状态模型

页面维护五类业务状态：

| 状态 | 含义 |
| --- | --- |
| `serverSnapshot` | 最近一次从服务端读取，或写成功后被确认接受的规范化完整可编辑聚合 |
| `formDraft` | 当前表单输入；数值字段保留原始字符串 |
| `expectedVersion` | 最近一次服务端响应或同步 GET 确认的版本 |
| `schemaState` | 分类、`schema_version`、Schema、加载/失败/漂移状态 |
| `issues` | 分开保存的本地检查与服务端 Validation issues |

另维护页面同步状态：

```text
LOADING
READY
SAVING
SYNCING
SAVED_UNSYNCED
RESULT_UNKNOWN
SUBMITTING
BLOCKED
```

### 7.1 `SAVED_UNSYNCED`

写请求明确成功、但后续详情 GET 失败时进入：

- 采用写响应中的最新 `material_id`、`version`、`status`。
- 显示“草稿已保存，但无法同步最新详情”。
- 禁止继续 PATCH 或 submit。
- 只提供“重新加载最新详情”，不自动重复已成功写请求。
- 不显示为保存失败，不提示再次点击保存。
- 导航时说明数据已保存、当前页面尚未完成同步。
- GET 成功后更新五类状态并回到 READY。

### 7.2 dirty

dirty 只表示存在尚未成功写入服务端的本地修改。比较对象仅包括：

- `basic_fields`。
- `category_id`。
- `attributes`。

规范化要求：

- 对象 key 顺序不影响结果。
- attributes 按稳定 `attribute_code` 排序。
- `0`、`false`、空字符串、未提供和 `null` 的语义明确区分。
- 只读字段、错误、焦点、展开、格式展示和其他 UI 临时状态不参与比较。

写请求明确成功且服务端接受提交内容时清除 dirty。GET 同步失败使用 `SAVED_UNSYNCED`，不得把已保存内容重新标成 dirty。Validation 失败、版本冲突、Schema 漂移和明确写失败不清除 dirty。

## 8. 分类选择与 Schema 生命周期

### 8.1 未选择分类

- 允许填写基础字段。
- 不渲染可提交的动态属性集合。
- 不允许保存或提交。
- 页面明确提示“请选择启用的四级叶子分类并等待属性 Schema 加载完成”。

允许保存必须满足：

1. 已选择服务端标记为 `is_leaf=true` 的启用四级分类。
2. 当前分类 Schema 加载成功。
3. 页面属性模型与该 Schema 的 `schema_version` 对应。
4. 已按 Schema 构造最终 attributes 集合。

Schema 加载失败时不得使用旧 Schema、seed 或部分结果兜底。

### 8.2 分类切换

若已有任何动态属性输入：

1. 打开可访问确认对话框。
2. 列出将保留和将清除的数量；不得静默删除。
3. 用户取消时保留原分类、Schema 和输入。
4. 用户确认后加载新 Schema；加载成功前保持原输入在内存中且禁止保存。
5. 只保留新 Schema 中仍存在、类型相同、值可按新类型解释且单位仍在 `compatible_units` 的属性。
6. 不兼容或不再绑定的属性进入“待确认删除”区域，不得只隐藏。
7. 用户确认删除后才从最终完整聚合移除，并进入 dirty。

### 8.3 Schema 漂移与未知旧属性

编辑页加载详情和当前分类 Schema 后比较：

- `schema_version`。
- 当前属性 code 集合。
- Schema 允许的属性 code 集合。

已有属性在当前 Schema 中不存在、已禁用或无法识别时：

- 单独显示“当前 Schema 无法映射的现有属性”。
- 显示 `attribute_code`、原值和单位，纯文本渲染。
- 默认阻止保存。
- 只有用户明确确认删除后才允许从完整聚合移除。
- 删除确认进入 dirty。
- 不自动丢弃、重命名、转换或猜测映射。

保存返回 metadata 漂移相关错误时，保留全部本地输入，重新加载最新 Schema，并要求用户重新核对受影响字段。旧 WARNING 确认同时失效。

## 9. 基础字段与请求值集

基础字段必须覆盖现有完整写契约：

| 字段 | 控件与语义 |
| --- | --- |
| `standard_name` | 必填文本，1..200 字符 |
| `unit` | 必填文本/受控选择，1..32 字符 |
| `brand` | 可选文本，最多 200 字符 |
| `manufacturer` | 可选文本，最多 200 字符 |
| `manufacturer_part_number` | 可选文本，最多 200 字符 |
| `procurement_type` | 必填选择：PURCHASE、OUTSOURCE、SELF_MADE、NON_PURCHASABLE |
| `inventory_type` | 必填选择：STOCKED、NON_STOCKED、CONSIGNMENT |
| `lot_control_required` | 明确是/否，默认值只能按现有契约处理 |
| `shelf_life_days` | 可选非负安全整数或 null |
| `inspection_type` | 必填选择：NONE、NORMAL、TIGHTENED、REDUCED、FULL |
| `environmental_requirement` | 必填选择：UNSPECIFIED、ROHS、ROHS_REACH、HALOGEN_FREE、CUSTOMER_SPECIFIC |

界面显示中文 label，提交稳定 code。客户端不得提交状态、版本、编码、操作者、创建/提交/批准身份或其他服务端字段。

## 10. 动态属性控件与序列化

### 10.1 通用展示

每个属性至少显示：

- 中文名称。
- `attribute_code`。
- 是否必填。
- `data_type`。
- 标准单位或当前单位。
- 非空 description。
- 本地检查与服务端 Validation 问题。

当前 Schema 没有语义分组字段。V1 不读取 seed，也不根据名称或 code 猜测分组；按 `display_order` 稳定排列。属性较多时只按固定数量形成“动态属性 1–12、13–24”等中性视觉段。

### 10.2 类型规则

#### TEXT

- 使用文本输入。
- 可选空值不进入最终 attributes。
- 空白是否为有效值服从服务端 Validation；本地可以提示，但不重写业务规则。

#### INTEGER

- 表单阶段保存原始字符串。
- 提交前完整匹配整数格式，不使用 `parseInt`。
- 转换后必须通过 `Number.isSafeInteger`。
- 小数、尾随字符、空字符串、NaN 和 Infinity 均不得提交。
- 空字符串不转换为 0。

#### DECIMAL

- 表单阶段保存原始字符串。
- 使用严格十进制格式，不使用宽松 `parseFloat`。
- 按 `decimal_scale` 检查小数位。
- 拒绝非法字符、NaN 和 Infinity。
- 不自动舍入，不执行单位换算。
- 最终按 API 契约发送有限原生 number。

#### BOOLEAN

- 使用“请选择 / 是 / 否”三态控件。
- `false` 是有效值，未选择不等同于 false。
- 必填 BOOLEAN 未选择时本地提示；服务端仍为最终结论。

#### ENUM

- 使用选择控件，显示 label，提交稳定 code。
- label 缺失时显示 code。
- 不翻译、转大写或猜测枚举。

#### 单位

- 只在 Schema 允许时显示。
- 只可从 `compatible_units` 选择。
- 无单位属性不得发送 unit。
- 有必填单位的数值属性未选择单位时阻止请求。
- 不在前端执行 mm/um 或其他数值换算。

`0` 和 `false` 必须通过显式存在性判断保留，不能因 falsy 判断被省略。

### 10.3 完整 attributes

PATCH 的 attributes 是表单当前最终完整集合：

- 包含所有已填写且可序列化的属性。
- 包含合法 `0` 和 `false`。
- 省略可选空项。
- 省略的旧属性被服务端视为删除。
- 未知旧属性必须先经过第 8.3 节明确删除确认，否则阻止 PATCH。

## 11. Validation 展示与 WARNING 确认

### 11.1 两类问题分离

- `issues.local` 标记“本地检查”。
- `issues.server` 标记“服务端校验”。
- 服务端结果始终为最终结论。
- 本地只检查必填输入为空、严格数值格式、枚举 code、必填单位和明显请求形态；不得复制完整业务规则。

### 11.2 展示和定位

- 页面顶部或右侧显示错误/警告摘要。
- 字段附近显示问题；点击摘要使用稳定字段 ID 滚动并聚焦控件。
- 无法映射的 issue 保留在通用问题区。
- ERROR 和 WARNING 同时使用中文文字、英文等级和数量，不能只靠颜色。
- 保留服务端结构化 code、field、attribute_code 和安全 message。
- 未知 code 使用安全通用文案，不显示 SQL、堆栈、路径或内部异常。

### 11.3 保存或提交失败

`422 MATERIAL_VALIDATION_FAILED`：

- 保留 formDraft。
- 不清除 dirty。
- 展示完整安全 details。
- 提交阶段若此前 PATCH 已成功，明确显示“草稿已保存，但未提交审核”。
- 不自动重复 PATCH 或 submit。

### 11.4 提交前 WARNING

不得使用页面中可能过期的 Validation 直接提交：

1. 保存后或直接提交前 GET 最新详情。
2. 使用该详情的当前 metadata Validation。
3. ERROR 阻止提交。
4. WARNING 打开确认对话框，列出安全问题。
5. 确认只绑定当前 material_id、version、schema_version 和 Validation 摘要。
6. 任一版本、Schema、表单或 Validation 变化使旧确认失效。
7. 用户确认后调用 submit；服务端仍重新完整校验。

详情刷新失败时不 submit，显示“无法确认当前校验状态，尚未提交审核”。确认后 submit 因 metadata 再次变化返回 422 时，保留最新版本和本地内容并展示新错误。

## 12. 创建流程

```text
验证 Session 与 material.draft.create
  -> 可先填写基础字段
  -> 选择启用四级叶子
  -> 加载当前分类 Schema
  -> 填写动态属性
  -> 本地基础检查
  -> POST /api/material-master/drafts
  -> 201：取得 material_id/version/status
  -> 跳转 /materials/:materialId/edit
  -> GET 统一详情
  -> 初始化 serverSnapshot/formDraft/expectedVersion/schemaState/issues
  -> 允许继续编辑
```

固定规则：

- `source_type = MANUAL`。
- 客户端不能选择或提交 SUPPLIER_IMPORT、AI、LEGACY_SQLITE、SYSTEM 或其他未批准来源。
- POST 使用显式 CSRF 和 Idempotency-Key。
- 创建进行中重复点击复用同一个进行中操作，不生成第二个草稿。
- GET 完成前不允许继续编辑或提交。
- 创建成功后不继续使用创建前的临时版本信息。

## 13. 编辑与完整替换流程

```text
验证 Session/permissions
  -> GET 统一详情
  -> 确认 DRAFT 与 own/edit-any
  -> GET 当前分类 Schema
  -> 保护未知旧属性
  -> 用户修改 formDraft
  -> 构造完整 basic_fields/category_id/attributes/expected_version
  -> PATCH /api/material-master/drafts/:materialId
  -> 200：采用新 version/status
  -> GET 统一详情同步
  -> READY 或 SAVED_UNSYNCED
```

PATCH 不允许：

- 只发送变化字段。
- 修改状态、编码、source_type、source_ref 或任何职责字段。
- 使用旧 expected_version 自动重试。
- 隐藏旧属性后静默删除。

`DRAFT_NOT_CHANGED` 时显示“没有可保存的实质变更”，重新 GET；只有 GET 成功且规范化聚合一致时才清除 dirty。GET 失败不清除 dirty，也不宣称已同步。

## 14. 保存并提交与直接提交

### 14.1 有修改时

```text
PATCH 完整聚合
  -> 写响应新 version
  -> GET 最新详情、Schema 与 Validation
  -> ERROR：停止
  -> WARNING：确认
  -> POST /api/material-master/drafts/:materialId/submit
  -> 成功进入只读详情
```

- submit 使用 GET 确认后的最新 `expected_version`，不得使用保存前版本。
- PATCH 成功后的任何后续失败不得自动重复 PATCH。
- GET 失败进入 `SAVED_UNSYNCED`。
- 保存成功、submit 失败时显示“草稿已保存，但尚未提交审核”，保留最新版本并提供单独重新提交入口。

### 14.2 未修改时

1. GET 最新详情。
2. 确认仍为 DRAFT 并更新 expectedVersion、Schema 和 Validation。
3. ERROR 阻止。
4. WARNING 经当前版本确认。
5. submit。

从 GET 开始到发出 submit 期间，如用户修改表单，取消提交准备，旧 Validation 和 WARNING 确认失效，并要求先保存修改。

### 14.3 submit 网络结果不确定

- 使用原 submit Key、原 POST endpoint 和完全相同的 submit 载荷安全重试。
- 不再次执行 PATCH。
- 不生成新 submit Key，除非服务端明确失败且用户明确重新发起操作。

## 15. IdempotencyKeyController

### 15.1 操作状态机

```text
IDLE -> PENDING -> SUCCEEDED

PENDING -> RESULT_UNKNOWN -> PENDING（安全重试）
                         -> SUCCEEDED / FAILED
```

每个操作在页面内存记录：

- Idempotency-Key。
- HTTP method。
- 具体 endpoint。
- 规范化载荷摘要。
- 不可变的原始操作载荷快照。
- 操作类型：CREATE、SAVE 或 SUBMIT。
- 当前状态。

### 15.2 规则

- 同一 Key 只能用于完全相同的 method、endpoint 和规范化载荷。
- 网络超时或响应丢失标记 `RESULT_UNKNOWN`。
- 安全重试必须复用原 Key 和原始操作载荷快照。
- 用户之后修改表单不得改变正在重试的载荷。
- 不得用同一 Key 发送修改后的 formDraft。
- 操作明确成功、明确失败或用户明确放弃后才能结束。
- Key、完整载荷摘要和载荷快照只在当前页面内存。
- 响应未确定前禁止对同一物料启动其他写操作。
- 按钮 disabled 只是交互措施；共享 promise、操作记录和服务端幂等共同防重。

### 15.3 限流和冲突

- 429 读取 `Retry-After`，显示明确可重试时间，不高频自动重试；到期后由用户主动重试。
- `IDEMPOTENCY_CONFLICT` 不自动生成新 Key 立即重试；要求用户核对内容并明确重新发起。
- Key 不进入 URL、日志、错误对象或持久存储。

## 16. VERSION_CONFLICT 与服务器对照

收到 `409 VERSION_CONFLICT`：

1. 保留本地 formDraft 和 dirty。
2. 获取最新服务器聚合用于只读对照。
3. 不立即替换 expectedVersion，不用新版本绕过冲突。
4. “查看服务器版本”只读，不产生写请求。
5. “放弃本地修改并使用服务器版本”必须二次确认。
6. 确认后才替换 formDraft、Schema、serverSnapshot 和 expectedVersion，并清除 dirty。
7. V1 不自动字段合并、不强制覆盖、不重发旧版本。

对照至少覆盖：

- category_id 与分类路径。
- 全部 basic_fields。
- attributes 按 attribute_code 的新增、删除和变化。
- 服务端状态与版本。

若最新状态不再是 DRAFT，立即关闭编辑能力并提供“查看详情”。若最新详情因权限或可见性变化不可读，使用统一安全错误，不泄露是否被其他人接管或隐藏；本地输入只保留在当前页面内存，直到用户离开。

## 17. 驳回后重新编辑与 `last_rejection`

### 17.1 界面行为

- REJECT 后状态回到 DRAFT，使用正常 PATCH 和 submit。
- 页面头部显示最近一次驳回原因、审核人、时间和对应版本。
- 历史只读，不可编辑、删除或覆盖。
- 修改和重新提交追加新历史，旧原因继续保留。
- 旧驳回原因不自动写入 `submit_comment`。
- 没有驳回记录时不显示空卡片。

### 17.2 前置只读契约

```ts
type LastRejection = {
  version: number;
  reason: string;
  reviewed_by: string;
  reviewed_at: string;
} | null;
```

要求：

- 从完整不可变版本或变更历史投影。
- 最新事件使用 `version DESC`，再以事件 ID 或 `created_at DESC` 确定性排序。
- reason 使用现有安全文本处理。
- 不返回内部审计字段、SQL 或敏感请求信息。
- 无记录返回 null。
- 不新增 Schema/Migration，不修改写服务。

该字段未实现前可以在线框稿展示，但不得宣称能够可靠显示最近驳回，不得扫描详情最近 5 条后冒充完整历史。`last_rejection` 完成是正式前端实施验收的阻断前置条件。

## 18. 未保存保护

- 站内导航、返回列表、返回详情和分类切换在 dirty 时确认。
- `beforeunload` 只在 dirty 或 RESULT_UNKNOWN 时注册。
- 正常无修改页面不注册无意义提醒。
- `SAVED_UNSYNCED` 使用单独提示，不声称数据未保存。
- RESULT_UNKNOWN 离开提示明确说明结果仍待确认。
- 保存明确成功后，相同内容不再视为未保存。
- 保存 Validation 失败、VERSION_CONFLICT、Schema 漂移和明确写失败不清除 dirty。
- 不把完整草稿持久化到 localStorage、sessionStorage、IndexedDB、Service Worker 或跨用户查询缓存。
- return_to 继续安全校验并保持不变。

## 19. 错误处理

| HTTP/Code | 页面行为 |
| --- | --- |
| 400 `REQUEST_VALIDATION_FAILED` | 保留输入；映射安全字段问题，无法映射的进入通用问题区 |
| 401 `AUTH_REQUIRED` | 初始加载进入现有登录回跳；dirty/RESULT_UNKNOWN 时先停止写并提示重新登录会离开页面，不自动重放 |
| 403 `FORBIDDEN` | 初始不加载正文；写期间关闭写能力并刷新安全状态 |
| 404 `MATERIAL_NOT_FOUND` | `草稿不存在或无权查看`，不区分不存在与隐藏 |
| 409 `VERSION_CONFLICT` | 进入第 16 节对照流程 |
| 409 `IDEMPOTENCY_CONFLICT` | 不自动换 Key；要求用户核对并明确重发 |
| 409 `DRAFT_NOT_EDITABLE` | 关闭写能力，安全刷新状态 |
| 409 `DRAFT_NOT_CHANGED` | 提示无实质变化；GET 一致后才清 dirty |
| 409 `MATERIAL_NOT_SUBMITTABLE` | 关闭提交和保存，安全刷新状态 |
| 422 `MATERIAL_VALIDATION_FAILED` | 保留输入与 dirty，展示服务端 details |
| 429 `RATE_LIMITED` | 显示 Retry-After，不高频自动重试 |
| 500 `INTERNAL_ERROR` | 安全文案和服务端 request_id，不显示内部异常 |
| 网络失败 | 读请求允许普通重试；已发出的写请求进入 RESULT_UNKNOWN，只能安全重试 |

分类树或 Schema 的 404/409/500：

- 阻止保存和提交。
- 不使用旧 Schema、seed 或部分 Schema 兜底。
- 已有输入只保留在当前页面内存。
- Schema 恢复后要求重新核对受影响属性。

## 20. 可访问性

分类切换、WARNING 确认、放弃本地修改和离开 dirty 页面使用可访问对话框。每个对话框必须定义：

- 初始焦点。
- Tab/Shift+Tab 焦点循环。
- Escape 取消行为；危险确认处理中不得因 Escape 造成歧义。
- 关闭后焦点回到触发控件。
- 明确中文确认和取消按钮。

其他要求：

- 页面语言 `zh-CN`，标题随路由更新。
- ERROR、WARNING、必填、状态和加载不能只靠颜色。
- 每个输入有可见中文 label。
- 属性辅助展示 code、类型、单位和必填状态。
- 错误摘要链接稳定字段 ID，定位后滚动并聚焦。
- 合理使用 `aria-busy`；live region 只播报保存结果、同步失败、提交结果等重要变化。
- 操作目标至少符合现有 Material 约 32×32px 规范。
- sticky 区域不能遮挡焦点环。
- 用户及服务端文本按纯文本渲染，不解释 HTML。

## 21. 前端组件边界

| 单元 | 单一职责 |
| --- | --- |
| `MaterialDraftCreatePage` | 新建路由、create 能力和初始状态 |
| `MaterialDraftEditPage` | 路由 ID、详情、所有权和 DRAFT 状态入口 |
| `MaterialDraftPageController` | 五类状态、页面同步状态、dirty 和数据流编排 |
| `MaterialDraftForm` | 完整可编辑聚合和分区布局 |
| `MaterialCategorySelector` | 分类树、切换确认和 Schema 生命周期 |
| `MaterialBasicFieldsSection` | 固定基础字段 |
| `MaterialDynamicAttributes` | Schema 顺序、中性分段和未知属性保护 |
| `MaterialAttributeField` | 单个类型化属性控件与 issue 定位 |
| `MaterialValidationSummary` | 本地/服务端问题分层、定位和 WARNING 确认入口 |
| `MaterialDraftActions` | 保存、保存并提交、部分成功和文字状态 |
| `MaterialUnsavedChangesGuard` | 站内导航和 beforeunload |
| `MaterialVersionConflictPanel` | 本地/服务器只读对照与放弃确认 |
| `IdempotencyKeyController` | Key、载荷快照、摘要和操作状态机 |

名称可按现有项目规范调整，但不得创建第二套认证状态、第二套 HTTP Client，或引入大型状态管理库、表单库、请求库、新 UI 组件库。

## 22. 测试计划

### 22.1 单元测试

至少覆盖：

1. `user.permissions` capabilities 判断。
2. 安全 return_to。
3. 规范化 dirty 比较和对象 key 顺序。
4. 完整 PATCH 序列化与旧属性删除。
5. source_ref：POST 省略、PATCH 不发送。
6. INTEGER 完整格式、safe integer 和空字符串。
7. DECIMAL 完整格式、scale、NaN/Infinity 和禁止舍入。
8. `0` 与 `false` 保留。
9. Schema version 漂移。
10. 未知属性保护和明确删除确认。
11. 分类切换的保留/清除集合。
12. Validation 字段路径和 attribute_code 映射。
13. Idempotency 操作状态机和载荷快照不可变。
14. Retry-After 解析和展示。
15. WARNING 确认绑定版本、Schema 和 Validation。

### 22.2 组件测试

至少覆盖：

1. TEXT。
2. INTEGER。
3. DECIMAL。
4. BOOLEAN 三态。
5. ENUM code/label。
6. compatible unit 选择和无单位禁止。
7. Schema 加载、失败、恢复和旧输入保留。
8. Validation 摘要定位与通用问题区。
9. sticky 操作区不遮挡最后字段。
10. 对话框键盘、Escape 和焦点恢复。
11. SAVED_UNSYNCED。
12. RESULT_UNKNOWN。
13. 保存成功但提交失败。
14. 版本冲突只读对照。
15. 快速定位在窄宽移到顶部。

### 22.3 集成测试

至少覆盖：

1. POST 创建。
2. PATCH 完整替换。
3. PATCH -> GET -> submit。
4. 直接提交未修改草稿。
5. 幂等重放。
6. 响应丢失后的原 Key 安全重试。
7. VERSION_CONFLICT。
8. 权限、所有权或状态变化。
9. 400、401、403、404、409、422、429、500。
10. 写成功、GET 失败进入 SAVED_UNSYNCED。
11. submit RESULT_UNKNOWN 不重复 PATCH。

### 22.4 端到端验收

完整覆盖原任务 47 项：

1. 未登录访问创建页。
2. 无创建权限。
3. 创建页成功加载分类树。
4. 选择四级叶子并加载 Schema。
5. 非叶子分类处理。
6. TEXT 属性输入。
7. INTEGER 输入。
8. DECIMAL 输入。
9. BOOLEAN 输入。
10. ENUM 选择。
11. compatible unit 选择。
12. 无单位属性不发送 unit。
13. 分类切换确认。
14. 分类切换清理不兼容属性。
15. 创建草稿成功。
16. source_type 固定为 MANUAL。
17. 客户端不能伪造身份字段。
18. 重复点击创建不生成两个草稿。
19. 编辑页加载完整聚合。
20. PATCH 发送完整属性集合。
21. 省略旧属性的删除语义。
22. DRAFT 可编辑。
23. PENDING_REVIEW 不可编辑。
24. ACTIVE 不可编辑。
25. Validation ERROR 字段定位。
26. WARNING 不阻断。
27. 保存成功更新 expectedVersion。
28. 保存并提交使用新版本。
29. 保存成功、提交失败的部分成功提示。
30. 提交成功进入只读详情。
31. VERSION_CONFLICT 不覆盖服务器。
32. VERSION_CONFLICT 保留本地输入。
33. IDEMPOTENCY_CONFLICT。
34. RATE_LIMITED 读取 Retry-After。
35. 401 处理。
36. 403 处理。
37. 404 统一文案。
38. 500 与 request_id。
39. 未保存修改导航确认。
40. 保存成功清除 dirty。
41. Validation 失败保留 dirty。
42. 驳回原因展示。
43. 重新编辑并提交。
44. 安全 return_to。
45. 不在前端复制完整 Validation 规则。
46. 不连接生产 URL 或生产 D1。
47. 现有 103 个 Node 测试继续通过；若基线数量增长，以实际完整通过数量为准并记录。

新增验收：

48. 创建后详情 GET 完成前禁止编辑。
49. 未知旧属性阻止保存。
50. 删除未知属性必须确认并进入 dirty。
51. WARNING 确认绑定当前版本和当前 Validation。
52. SAVED_UNSYNCED 不显示为保存失败。
53. RESULT_UNKNOWN 阻止同一物料启动第二个写操作。
54. last_rejection 未完成时阻断正式前端实施验收。

### 22.5 人工视觉验收

实施阶段在 1366×768、100% 缩放下检查：

- 主体表单宽度。
- 快速定位区域降级行为。
- 属性数量增加后的布局。
- sticky 底部操作区是否遮挡字段。
- 键盘焦点顺序。
- 错误摘要定位。
- 对话框焦点恢复。
- 横向和纵向滚动行为。

### 22.6 测试隔离

所有写测试使用 `ERP_ENV=test` 和一次性本地隔离 D1，显式拒绝 production、公共 URL、远程 D1 binding、真实生产物料和生产部署。测试结束销毁数据。

## 23. 文档阶段验证与范围检查

本任务完成前运行：

- `npm run lint`。
- `npm test`。
- 隔离 `npm run test:api`。
- `npm run security:credentials`。
- 临时 SQLite 下的环境守卫、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py` 和 `go_live_check.py --no-backup`。
- `git diff --check`。
- 最终差异和敏感信息范围检查。

最终差异不得包含：

- 前端运行时代码。
- API。
- Schema。
- Migration。
- Material 业务服务。
- 测试业务代码。
- 生产配置或部署修改。
- 数据库、备份、日志、截图或临时导出。

## 24. 后续实施门禁

本规格已获项目负责人确认，但不构成前端实施或生产授权。后续顺序固定为：

1. 独立批准并实施 `last_rejection` 最小只读 API 兼容项。
2. 更新并确认对应 Query API/OpenAPI 文档和测试。
3. 项目负责人另行指定前端实施任务。
4. 前端实施按本规格执行全部隔离测试和人工验收。
5. 任何生产 migration 或部署仍需单独明确授权。

在上述门禁完成前，不得开始 PHASE1-TASK10 的前端编码，也不得把本任务标记为生产可用。

## 25. 文档阶段实际验证结果

2026-07-14 在未连接生产资源的条件下完成：

- `npm run lint`：PASS，0 error；保留 1 个既有 `build_material_workbook.mjs` 未使用变量 warning。
- `npm test`：PASS，构建成功，Node 测试 103/103 通过。首次与 lint 并行运行时迁移用例达到 120 秒超时；该用例随后单独以 106 秒通过，完整测试再单独复跑 103/103 通过，无断言失败或取消项。
- 一次性本地隔离 D1 `npm run test:api`：PASS，返回 `ok: true`，只创建 `TEST-*` 合成记录。
- `npm run security:credentials`：PASS，219 个仓库文件通过凭证扫描。
- 一次性临时 SQLite：PASS；环境守卫 4/4、`SELF_TEST_OK`、`SMOKE_TEST_OK`、`BACKUP_RESTORE_TEST_OK`、`GO_LIVE_CHECK_OK`，临时目录已清理。
- `git diff --check`、最终文件范围和敏感信息检查：提交前复核并记录在项目状态；差异仅允许本规格、线框稿和项目治理文档。

以上是文档阶段回归结果，不表示页面、`last_rejection` API 或任何生产功能已经实施。
