# Material Review Queue 与审核工作台 V1

状态：`IMPLEMENTED_NON_PRODUCTION / AWAITING_ACCEPTANCE`

任务：`PHASE1-TASK13`（设计）、`PHASE1-TASK14`（实施）

日期：2026-07-15

目标运行面：`chenyida_erp_site/` 在线 Site

低保真线框稿见 [material-review-ui-v1-wireframes.md](./material-review-ui-v1-wireframes.md)。

## 0. PHASE1-TASK14 实施结果

- 已实现 `/materials/review` 与 `/materials/:materialId/review` 两条原生 Vinext 路由，并在 `MaterialShell` 中按 `material.review.queue` 显示审核队列入口。
- 队列使用既有 `GET /api/material-master/review-queue`，由 URL 保存有界分页、筛选和 allowlist 排序；显示 `submitted_by`，但不伪造服务端尚未支持的提交人筛选。
- 工作台按批准的方案 A 实现：左侧完整只读详情，右侧约 310px sticky Validation、职责分离和审核操作；只读详情展示已提取为共享组件，既有详情页行为保持不变。
- 批准和驳回复用既有共享 Client、Session、CSRF 与 API；最终动作前重读统一详情。ERROR 禁止批准但不自动驳回；WARNING 需要绑定当前物料、版本和规范化 Validation 的明确确认。
- 前端按 `user.permissions` 独立控制 queue/approve/reject；创建人和最后修改人禁审，`submitted_by` 本身不禁审，服务端仍是权限、状态、职责分离和 Validation 的最终裁决者。
- approve/reject 各自维护页面内存幂等状态、不可变载荷和原 Key 安全重试；覆盖 `RESULT_UNKNOWN`、`IDEMPOTENCY_IN_PROGRESS`、冲突、限流、401/403/404/422/5xx、dirty/beforeunload 与对话框焦点保护。
- 新增并通过 Review UI 51/51；全量 Node 209/209、构建、lint 0 error/1 个既有 warning、隔离 D1 API smoke、233 文件凭证扫描、本地 SQLite 基线全部通过。
- 1366×768 本地浏览器验收通过：队列、310px sticky 右栏、WARNING 确认和批准后返回原队列完成完整往返。
- 未修改 API、Schema、Migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 D1、迁移真实数据或部署公开 Site。

## 1. 目标与设计结论

为 Material Master V2 设计并实现中文、桌面优先、只读复核优先的待审核队列和单条审核工作台。V1 只消费已经实现的 Session、统一详情、审核队列、批准和驳回 API；`PHASE1-TASK13` 形成书面规格与低保真线框，`PHASE1-TASK14` 在不修改 API、Schema、Migration、索引或部署配置的前提下完成前端实施。

已确认的核心结论：

- 审核队列路由为 `/materials/review`，单条工作台路由为 `/materials/:materialId/review`。
- 工作台推荐方案 A：左侧完整只读物料内容，右侧 sticky Validation、职责分离和审核操作栏；方案 B 仅保留为对比线框。
- 批准或驳回成功后默认返回原审核队列，并恢复筛选、排序和分页。
- 批准始终经过一次最终确认；存在 WARNING 时在同一对话框列出并要求明确确认。
- 工作台进入和批准前均重新 GET 统一详情；队列 Validation 只作为摘要，不能代替详情当前 Validation。
- ERROR 阻止批准但不自动驳回；WARNING 不阻止批准，但确认只对当前物料、当前版本和本次详情 Validation 有效。
- 审核者不得等于 `created_by` 或 `last_modified_by`；`submitted_by` 本身不构成禁审条件，无 admin 例外。
- approve 和 reject 使用相互独立、仅存在于页面内存的幂等操作状态。
- 本任务不实现批量审核、多级审核、认领、转交、审核页编辑、导入或 AI 功能。

## 2. 当前实现事实与设计边界

### 2.1 可直接复用的服务端契约

- `GET /api/session` 返回当前用户、`user.permissions` 和 `csrf_token`。
- `GET /api/material-master/review-queue` 只返回 `PENDING_REVIEW`，支持有界分页、allowlist 排序和当前页 `CURRENT_METADATA` Validation 摘要。
- `GET /api/material-master/materials/:materialId` 返回统一详情、类型化属性、当前 Validation、最近版本/变更摘要和 `last_rejection`。
- `POST /api/material-master/drafts/:materialId/approve` 接受 `expected_version` 和可选 `review_comment`，成功生成正式编码并转为 `ACTIVE`。
- `POST /api/material-master/drafts/:materialId/reject` 接受 `expected_version` 和必填 `reason`，成功转回 `DRAFT` 且不生成编码。
- 服务端在批准和驳回时重新执行状态、版本、职责分离、Validation、幂等和权限校验。

### 2.2 可直接复用的前端边界

- `MaterialShell`、现有登录回跳和 Material 中文视觉语言。
- `public/erp/api-client.js` 作为唯一浏览器 HTTP 边界，支持显式受保护 Material 写请求上下文。
- `safeMaterialReturnTo()`、`MaterialStatusBadge`、`MaterialPagination` 和 `MaterialErrorState`。
- Draft UI 已实现的页面内存幂等控制、不可变载荷快照、`RESULT_UNKNOWN`、显式 CSRF 和 dirty/beforeunload 处理原则。
- 只读详情已实现基础字段、职责、类型化属性、Validation、版本和变更摘要展示规则。

### 2.3 当前组件现实

`PHASE1-TASK14` 已把既有只读详情中的基础字段网格、职责、类型化属性、Validation、最近版本和最近变更最小提取到 `material-detail-sections.tsx`，供原详情页和审核工作台共同复用：

- 基础字段展示。
- 类型化属性展示。
- Validation 面板。
- 状态及错误展示规则。

该提取未改变现有只读页面 API 契约或用户行为，未复制两套展示逻辑，也未引入大型依赖；Material 只读 UI 回归 37/37 通过。

## 3. 范围与禁止事项

### 3.1 包含

- 待审核队列、筛选、排序、服务端分页和 URL 状态。
- 单条只读审核工作台。
- 当前 metadata Validation 复核。
- 批准、驳回、职责分离、幂等、并发和状态变化交互。
- 登录失效、权限不足、隐藏对象、参数错误、Validation 失败、限流、网络和服务端错误状态。
- 未发送审核意见和 `RESULT_UNKNOWN` 的离开保护。
- 键盘、对话框、焦点、live region 和 1366×768 人工验收。
- 已实施的 51 项 Review UI 测试与 1366×768 浏览器验收。

### 3.2 不包含

- 新增或修改 API、Schema、Migration、索引、业务服务或部署配置。
- 批量审核、多级审核、审核认领、审核转交或强制审核。
- 审核人员创建、编辑草稿或“审核并编辑”。
- Excel/CSV 导入、AI 分类、候选匹配或正式物料编辑。
- `PENDING_APPROVAL` 收缩。
- BOM、采购、库存、生产或 Legacy SQLite 修改。
- 生产 D1 连接、快照、迁移、回填、部署或公开 Site 发布。
- 修复任务外既有 TypeScript 问题。

## 4. 页面路由与权限入口

| 页面 | 浏览器路由 | 数据来源 | 页面基础能力 |
| --- | --- | --- | --- |
| 审核队列 | `/materials/review` | `GET /api/material-master/review-queue` | `material.review.queue` |
| 审核工作台 | `/materials/:materialId/review` | `GET /api/material-master/materials/:materialId` | `material.review.queue`，详情 API 仍要求 `material.read` 和行级可见 |

写能力独立读取：

- 批准：`material.review.approve`。
- 驳回：`material.review.reject`。

能力只来自 `/api/session -> user.permissions`。前端不得按 `admin`、`manager`、`purchase`、`engineering` 或其他角色名判断。

### 4.1 页面标题

- 队列：`物料审核队列 - 晨亿达 ERP`。
- 工作台：`{standard_name} - 物料审核 - 晨亿达 ERP`。

### 4.2 直接访问工作台

- 未登录进入现有登录流程，并以安全 `return_to` 回到当前审核路由。
- 缺少 `material.review.queue` 时不加载受保护详情，显示通用 403 页面。
- 详情 API 缺少 `material.read`、对象不存在或行级不可见时遵守服务端结果；不存在或不可见统一显示“物料不存在或无权查看”。
- 状态不为 `PENDING_REVIEW` 时显示最新状态、关闭审核动作，并提供“查看详情”和“返回审核队列”。
- 只拥有 approve/reject 之一但没有 queue 权限，不构成工作台读取能力；不得先加载正文再隐藏页面。

## 5. 安全返回与浏览器历史

### 5.1 `return_to`

队列进入工作台时携带原队列完整相对 URL：

```text
/materials/456/review?return_to=%2Fmaterials%2Freview%3Fpage%3D3%26page_size%3D50%26sort%3Dsubmitted_at_desc
```

规则：

1. 只接受路径为 `/materials/review` 的同源相对 URL及其查询参数。
2. 拒绝 scheme、host、协议相对 URL、反斜杠和其他 Material 子路由。
3. `return_to` 只属于浏览器 UI，不发送给 Material API。
4. 非法或缺失时回退 `/materials/review?page=1&page_size=20&sort=submitted_at_desc`。
5. 浏览器原生后退不被拦截；从工作台返回时恢复历史中的原 URL。

### 5.2 审核完成后的返回

- 批准或驳回成功后默认导航到已校验的 `return_to`。
- 成功信息通过当前应用内存或 History state 传递，不写入 URL、localStorage 或 sessionStorage。
- 批准反馈包含正式编码；驳回反馈明确状态已回到 DRAFT。
- 返回后重新请求队列，服务端 `total` 是唯一权威。
- 若当前页处理后为空且 `page > 1`，跳到服务端返回的最后有效页，并用 `replaceState` 规范化 URL，防止循环请求。
- 其他情况留在当前页；不得在前端手工永久减 total 或假设并发期间只有当前用户改变队列。

## 6. 审核队列 URL 状态

### 6.1 参数

| UI 参数 | API 参数 | 默认 | 规则 |
| --- | --- | --- | --- |
| `page` | `page` | `1` | 正安全整数；筛选变化后重置为 1 |
| `page_size` | `page_size` | `20` | UI 提供 20、50、100 |
| `keyword` | `keyword` | 无 | 去空白后 1..100；300ms debounce |
| `category_id` | `category_id` | 无 | 只选择启用叶子并精确匹配 |
| `source_type` | `source_type` | 无 | 现有 API allowlist |
| `creator` | `creator` | 无 | 精确匹配创建人账号 |
| `submitted_from` | 同名 | 无 | `YYYY-MM-DD`，API UTC 边界 |
| `submitted_to` | 同名 | 无 | `YYYY-MM-DD`，包含该 UTC 日期 |
| `sort` | `sort` | `submitted_at_desc` | 现有四个 allowlist 值 |

允许排序：

- `submitted_at_desc`。
- `submitted_at_asc`。
- `standard_name_asc`。
- `standard_name_desc`。

### 6.2 URL 行为

- 初次进入以 `replaceState` 规范化为显式 `page=1&page_size=20&sort=submitted_at_desc`。
- 固定参数顺序：`page,page_size,keyword,category_id,source_type,creator,submitted_from,submitted_to,sort`。
- keyword 连续输入使用 `replaceState`；下拉筛选、日期、排序、分页和重置使用 `pushState`。
- `popstate` 重新从 URL 解析并请求，不依赖陈旧组件状态。
- 新请求取消旧请求；旧响应不得覆盖较新的筛选结果。
- 未知或服务端拒绝的参数保留在地址栏供纠正，但页面不得尝试前端放宽 API allowlist。

## 7. 审核队列页面

### 7.1 结构

1. 面包屑：`首页 / 物料主数据 / 审核队列`。
2. 标题“物料审核队列”和“仅显示待审核物料”说明。
3. 两行紧凑筛选栏。
4. 已生效筛选摘要与重置动作。
5. 高密度横向滚动表格。
6. 紧邻表格的服务端分页。

1366×768、100% 缩放下不放统计卡片；筛选区目标不超过约 104px，首屏目标至少可见 8 条审核记录和 Validation 摘要。

### 7.2 表格列

| 顺序 | 列 | 字段/来源 | 行为 |
| ---: | --- | --- | --- |
| 1 | 标准名称 | `standard_name` | 固定左列，链接进入工作台 |
| 2 | 分类路径 | `category_path` | 单行省略，可键盘查看完整值 |
| 3 | 创建人 | `creator` | 账号名纯文本 |
| 4 | 最后修改人 | `last_modified_by` | 账号名纯文本 |
| 5 | 提交人 | `submitted_by` | 只展示，不提供筛选 |
| 6 | 提交时间 | `submitted_at` | Asia/Shanghai 展示；排序由 API 执行 |
| 7 | 当前版本 | `current_version` | `V{n}` |
| 8 | 来源 | `source_type` | 使用现有中文映射 |
| 9 | Validation | `validation_summary` | ERROR/WARNING 数量和 `CURRENT_METADATA` 文字 |
| 10 | 问题摘要 | `top_issues` | 最多 5 条安全问题摘要 |
| 11 | 操作 | 无 | “进入审核”链接 |

待审核物料尚无正式编码，队列不虚构或占位正式编码列。

### 7.3 Validation 摘要

- 只展示服务端当前页 `validation_summary`。
- ERROR、WARNING 使用中文文字、英文等级和数量，不只依赖颜色。
- `top_issues` 显示 code、field/attribute_code 和安全 message。
- 队列不重新实现 Validation，不使用摘要决定最终批准，不为筛选加载全部待审记录。
- `basis=CURRENT_METADATA` 必须可见，并提示“最终审核以工作台重新加载的详情为准”。

### 7.4 加载、空和错误状态

| 状态 | 行为 |
| --- | --- |
| 首次加载 | 保留筛选骨架、表头和 8–10 行 Skeleton |
| 筛选加载 | 保留上一页，表格 `aria-busy=true`，显示“正在更新结果” |
| 无待审核物料 | 无筛选且 total=0：`当前没有待审核物料` |
| 筛选无结果 | 有筛选且 total=0：`没有符合当前筛选条件的待审核物料`，提供重置 |
| 401 | 进入现有登录流程并保留当前 URL |
| 403 | 不加载队列正文，显示通用无权限页 |
| 400 | 保留 URL，在筛选区显示可修正参数错误 |
| 500 | 安全文案、request_id 和重试 |
| 网络失败 | 保留当前 URL和旧结果，提供重试 |

## 8. 工作台布局方案

### 8.1 方案 A：左侧内容 + 右侧审核栏

推荐并已确认采用。

- 顶部摘要横跨工作区。
- 左侧主栏展示基础信息、职责、类型化属性、最近版本和最近变更。
- 右侧约 280–320px sticky 栏展示当前 Validation、职责分离提示、审核意见和动作。
- 属性较多时左侧自然增长，右侧关键风险和动作保持可见。
- 内容区变窄时右栏移到主体顶部，操作区降为底部 sticky，不继续挤压只读内容。

### 8.2 方案 B：顶部摘要 + 页签 + 底部操作区

仅作为对比，不推荐。

- 基础信息、属性、Validation 和历史拆成页签。
- 审核操作固定在底部。
- 优点是单屏规整；缺点是关键信息分散，审核人可能在未重新查看 Validation 或职责信息时操作，属性和历史对照需要频繁切换。

## 9. 审核工作台内容

### 9.1 顶部摘要

- `material_code`：待审时显示“尚无正式编码”。
- `standard_name`。
- `material_status`。
- `category_path`。
- `current_version`。
- `source_type`。
- 返回队列链接。

### 9.2 左侧只读内容

#### 基础字段

展示统一详情全部基础字段：标准名称、基本单位、品牌、制造商、制造商型号、采购类型、库存类型、批次控制、保质期、检验类型、环保要求、来源和来源引用。

#### 职责信息

- `created_by`。
- `last_modified_by`。
- `submitted_by`。
- `submitted_at`。

待审核状态不显示虚构的批准人或批准时间。

#### 类型化属性

- 按统一详情现有顺序展示 TEXT、INTEGER、DECIMAL、BOOLEAN、ENUM、单位、0、false 和空值。
- 不渲染输入控件，不把展示数组转换成写命令。
- Validation 问题可通过稳定 `attribute_code` 定位并聚焦对应只读属性容器。

#### 最近历史

- 最近版本和最近变更各最多 5 条。
- 支持进入现有完整版本和变更日志 URL，并保留审核队列 `return_to`。
- 不通过弹窗展示完整详情，不在工作台返回完整快照或无界历史。

## 10. 操作权限与职责分离

### 10.1 动作显示

| 能力组合 | 操作区 |
| --- | --- |
| 仅 approve | 只显示“审核通过” |
| 仅 reject | 只显示“驳回修改” |
| 两者都有 | 显示两个动作 |
| 两者都无 | 保留只读工作台，显示“当前账号没有批准或驳回权限”，不渲染伪禁用按钮 |

按钮显示只用于交互；服务端继续对每次写请求最终授权。

### 10.2 职责分离预提示

当前会话 `username` 等于：

- `created_by`：显示“创建人不能审核自己创建的物料”。
- `last_modified_by`：显示“当前版本最后修改人不能审核该版本”。
- 同时命中：显示“你既是该物料的创建人，也是当前版本最后修改人，不能审核该物料。”

命中任一规则后批准和驳回均关闭，但仍可按读取权限查看。`submitted_by` 不单独禁止审核。

前端预提示只比较 Session 中的稳定 `username` 与详情稳定账号字段；不得使用显示名、角色名或自行大小写归一化代替服务端身份判断。

### 10.3 服务端职责分离错误

以现有稳定 API 为准：

- `SELF_REVIEW_FORBIDDEN`：HTTP 403。
- `LAST_EDITOR_REVIEW_FORBIDDEN`：HTTP 403。

前端必须先读取结构化 `error.code`：

- 命中上述 code 时刷新详情、清除旧确认、展示具体职责提示并关闭审核动作。
- 普通 `FORBIDDEN` 显示通用无权限文案，不猜测职责原因。
- 本任务不要求把职责分离错误改为 409，也不修改 API。

## 11. 当前 Validation 复核

### 11.1 详情 Validation

- 进入工作台必须 GET 最新统一详情。
- 使用详情 `validation`，明确显示 `basis=CURRENT_METADATA` 和 `validated_at`。
- 显示全部 ERROR 和 WARNING；未知 issue 保留在通用问题区。
- 不复制完整规则，不以队列缓存摘要代替详情，不读取 seed 推断规则。

### 11.2 ERROR 与 WARNING

- ERROR：关闭批准，显示“该物料需要驳回修改”；驳回仍按权限可用，不自动执行。
- WARNING：不关闭批准，但必须进入最终确认并明确勾选。
- Validation metadata 不可用或损坏时按服务端 500 fail-closed，不显示可误用的部分审核内容。

### 11.3 WARNING 确认绑定

前端确认绑定：

- `material_id`。
- `current_version`。
- 当前 Validation 规范化摘要。

规范化摘要包含 `basis`、`valid` 以及稳定顺序的 errors/warnings 中的 `code`、`severity`、`field`、`attribute_code`、`message` 和安全 metadata；展示时间不作为业务内容。页面另保存本次详情加载标识，任何重新加载都会使旧确认失效。

该摘要只是前端确认的新鲜度标记，不是 metadata 不变性的安全保证：

1. approve 前重新 GET 最新详情。
2. 基于该次响应生成摘要。
3. 版本、Validation 内容、物料对象或重新加载发生变化时旧确认立即失效。
4. WARNING 确认后尽快发送 approve。
5. approve 服务端最终重新校验是唯一业务安全边界。
6. approve 返回 422、版本冲突或状态冲突时旧确认失效并重新读取详情。
7. V1 不新增 metadata version API。

## 12. 审核通过流程

### 12.1 审核意见

- `review_comment` 可选。
- 去除首尾空白后最多 1000 字符，纯文本渲染。
- 空白内容视为未填写。
- 客户端不得发送 `approved_by`、`material_code`、新状态、操作者或其他未声明字段。

### 12.2 流程

1. 审核人检查只读详情、职责和当前 Validation。
2. 点击“审核通过”。
3. GET 最新统一详情。
4. 确认对象仍相同、状态仍为 `PENDING_REVIEW`、版本和 Validation 未发生未复核变化。
5. ERROR 阻止；无 ERROR 进入最终批准确认。
6. 最终对话框显示名称、版本、Validation 数量和审核意见摘要。
7. 有 WARNING 时列出安全问题，并要求勾选“我已核对当前版本和当前 Validation”。
8. 使用确认时的 `expected_version`、可选 comment、独立 approve Key 和当前 CSRF 调用 approve。
9. 成功取得 `ACTIVE`、新版本和正式编码。
10. 返回原队列，并以克制 live region 显示“审核通过，正式编码：{code}”。

批准始终确认；无 WARNING 时不要求额外勾选，但仍显示最终确认对话框。不得串联两个连续确认对话框。

## 13. 审核驳回流程

### 13.1 驳回原因

- `reason` 必填。
- 去除首尾空白后 1..1000 字符。
- 可见 label、字符计数和字段错误。
- 纯文本，不解释 HTML。
- 客户端不得发送 `reviewed_by`、状态或其他未声明字段。

### 13.2 流程

1. 点击“驳回修改”打开可访问对话框。
2. 显示物料名称、当前版本、必填原因，并说明“驳回后状态回到 DRAFT，创建或编辑人员可以重新修改和提交”。
3. 用户填写原因并提交最终确认。
4. GET 最新统一详情；状态或版本变化时停止，保留原因在页面内存并要求重新检查。
5. 使用最新 `expected_version`、原因、独立 reject Key 和当前 CSRF 调用 reject。
6. 成功后关闭活动动作，不生成正式编码。
7. 返回原队列并显示“已驳回为草稿”。
8. 后续只读详情以现有 `last_rejection` 验证原因、审核人、时间和版本。

## 14. 未发送审核意见保护

- 批准意见和驳回原因分别管理，不互相复制。
- 从批准转到驳回时保留批准意见在页面内存，并明确提示“批准意见不会作为驳回原因”。
- 存在任一未发送意见或 `RESULT_UNKNOWN` 时注册 `beforeunload`，并拦截站内离开。
- 无意见且无未知结果时不注册无意义提醒。
- 审核成功、明确取消或明确失败后按实际状态更新 dirty。
- 不把意见、Key、摘要或载荷写入 localStorage、sessionStorage、IndexedDB、Service Worker 或 URL。

## 15. 幂等、CSRF 与重复操作

approve 和 reject 各自维护独立操作记录：

```text
IDLE -> PENDING -> SUCCEEDED

PENDING -> RESULT_UNKNOWN -> PENDING（原请求安全重试）
                         -> SUCCEEDED / FAILED
```

每个记录包含：

- Idempotency-Key。
- method 和具体 endpoint。
- 规范化载荷摘要。
- 不可变原始载荷快照。
- 操作类型 APPROVE 或 REJECT。
- 当前状态。

规则：

- 同一操作重复点击共享进行中 promise 和同一个 Key。
- approve Key 不得用于 reject。
- 审核意见或驳回原因变化后，旧操作明确结束，下一操作生成新 Key。
- 网络超时或响应丢失进入 `RESULT_UNKNOWN`；只允许原 Key、原 method、原 endpoint 和原载荷重试。
- `RESULT_UNKNOWN` 时关闭全部相反或第二个审核动作。
- 缺少显式 CSRF 或 Key 时共享 Client fail-closed，不发送请求。
- Key 不进入 URL、日志、错误对象或持久存储。

## 16. 并发与状态变化

### 16.1 `VERSION_CONFLICT`

1. 不自动重试旧版本。
2. 重新 GET 最新详情。
3. 保留未提交批准意见和驳回原因在页面内存，但不得自动提交。
4. 清除 WARNING 确认和所有准备中的新动作。
5. 显示旧版本和新版本，并要求重新检查完整内容与 Validation。
6. 不自动合并、不强制覆盖、不用新版本直接重发旧审核结论。

### 16.2 状态不再可审核

- `MATERIAL_NOT_REVIEWABLE` 或 `INVALID_MATERIAL_STATE` 后重新 GET。
- 关闭批准与驳回，显示最新状态。
- 提供查看详情或返回队列。
- 不披露其他审核人的评论、身份或敏感操作细节。

### 16.3 幂等冲突和处理中

- `IDEMPOTENCY_CONFLICT`：不自动换 Key，要求核对载荷并明确重新发起。
- `IDEMPOTENCY_IN_PROGRESS`：显示处理中和 `Retry-After`，禁止相反动作。
- 服务端已返回完成重放时按原业务结果处理；物理 `request_id` 可变化，业务结果和 `operation_id` 不得变化。

## 17. 错误处理

错误分派先读取结构化 `error.code`，HTTP 状态只作为辅助。

| HTTP/Code | 页面行为 |
| --- | --- |
| 400 `REQUEST_VALIDATION_FAILED` | 队列保留 URL；工作台保留意见，显示安全字段问题 |
| 400 `REVIEW_REASON_REQUIRED` | 聚焦驳回原因并显示必填错误 |
| 401 `AUTH_REQUIRED` | 进入现有登录流程；有 dirty/RESULT_UNKNOWN 时先提示会丢失页面内存状态 |
| 403 `FORBIDDEN` | 通用无权限文案，不加载或继续展示受保护正文 |
| 403 `SELF_REVIEW_FORBIDDEN` | 显示创建人职责提示，关闭动作，刷新详情 |
| 403 `LAST_EDITOR_REVIEW_FORBIDDEN` | 显示最后修改人职责提示，关闭动作，刷新详情 |
| 404 `MATERIAL_NOT_FOUND` | `物料不存在或无权查看` |
| 409 `VERSION_CONFLICT` | 进入第 16.1 节流程 |
| 409 `IDEMPOTENCY_CONFLICT` | 不自动换 Key |
| 409 `IDEMPOTENCY_IN_PROGRESS` | 读取 Retry-After，禁止第二动作 |
| 409 状态冲突 | 刷新详情并关闭动作 |
| 422 `MATERIAL_VALIDATION_FAILED` | 清除旧确认，重新 GET 并展示最新结构化 Validation |
| 429 `RATE_LIMITED` | 读取 Retry-After，不高频自动重试 |
| 500 `INTERNAL_ERROR` | 安全文案和服务端 request_id |
| 网络失败 | GET 可普通重试；已发送写请求进入 RESULT_UNKNOWN |

任何错误、历史或用户正文不得显示 SQL、堆栈、Token、Cookie、数据库路径、D1 绑定或原始异常。服务器文本只按纯文本渲染。

## 18. 可访问性

- 页面语言 `zh-CN`，标题随路由更新。
- ERROR、WARNING、职责分离、加载、处理中和结果未知均有明确文字。
- 批准、WARNING、驳回和离开确认使用可访问对话框。
- 对话框定义初始焦点、Tab/Shift+Tab 焦点循环、Escape 行为和关闭后焦点恢复。
- 危险提交进行中不得用 Escape 造成结果歧义。
- 驳回原因有可见 label、字符计数和字段错误，并通过 `aria-describedby` 关联。
- Validation 问题可定位、滚动并聚焦稳定属性容器；只读属性容器可通过 `tabIndex=-1` 程序聚焦。
- sticky 审核栏和降级后的底部操作区不得遮挡内容、焦点环或最后一个可聚焦元素。
- 审核结果使用克制 live region；不重复播报整页详情。
- 所有用户、历史和服务端文本按纯文本渲染。
- 交互目标沿用现有 Material 至少约 32×32px 规范。

## 19. 前端组件边界

实际实施模块：

| 单元 | 单一职责 |
| --- | --- |
| `MaterialReviewQueuePage` | 队列路由、Session 能力、URL 状态、筛选、表格和服务端分页编排 |
| `MaterialReviewWorkspace` | 最新详情、推荐布局 A、职责分离、approve/reject、冲突、结果未知和离开保护 |
| `DialogShell` | 工作台内部共享的最终确认与离开确认焦点边界 |
| `material-detail-sections.tsx` | 原详情页与审核工作台共享的只读基础、职责、属性、Validation 和历史展示 |
| `material-review.ts` | URL codec、安全返回、权限、职责、Validation 指纹与意见规范化纯函数 |

共享边界：

- 复用 `MaterialShell` 和唯一共享 API Client。
- 复用安全 return_to、状态、分页和错误展示。
- 已最小提取现有只读基础字段、属性和 Validation 展示，没有复制两套逻辑。
- 复用 Draft UI 的幂等状态机原则，但 approve/reject 操作记录必须独立。
- 不引入 Redux、Zustand、TanStack Query、表单库、Data Grid 或新 UI 组件库。

## 20. 三项 API 兼容结论

### 20.1 `submitted_by` 筛选缺口

现有审核队列 API 只支持 `creator`，不支持 `submitted_by` 筛选。

V1：

- 展示 `submitted_by`。
- 不提供提交人筛选控件。
- 不加载全部队列后前端筛选。
- 不用 `creator` 冒充 `submitted_by`。
- 将提交人精确筛选记录为后续只读 API 候选。
- 此缺口不阻断当前审核工作台实施。

### 20.2 职责分离 HTTP 状态

现有稳定 API 对 `SELF_REVIEW_FORBIDDEN` 和 `LAST_EDITOR_REVIEW_FORBIDDEN` 使用 HTTP 403，而不是任务原始错误清单中的 409。V1 按结构化 code 区分具体职责提示与普通 `FORBIDDEN`，不要求修改 API。

### 20.3 Validation 版本标识

详情没有独立 metadata version。V1 使用 `material_id + current_version + 当前 Validation 规范化摘要 + 本次加载标识` 绑定前端确认；该摘要不是 metadata 安全保证，approve 服务端最终重校验仍是唯一安全边界。本任务不新增 metadata version API。

## 21. 实施测试与验收

以下 51 项 Review UI 测试已全部实施并通过；UI 纯函数与组件边界测试不写数据库，既有 API smoke 使用 `ERP_ENV=test` 和一次性本地隔离 D1，显式拒绝 production、公共 URL 和远程 D1 binding并在结束后销毁数据。

### 21.1 权限与队列（1–12）

1. 未登录访问审核队列。
2. 无 `material.review.queue` 权限时不加载队列正文。
3. 队列默认加载 `page=1&page_size=20&sort=submitted_at_desc`。
4. URL 筛选在刷新和 popstate 后恢复。
5. 服务端分页和 allowlist 排序。
6. 分类筛选只发送 `category_id`。
7. 来源筛选。
8. 创建人和提交时间筛选；同时断言不出现 `submitted_by` 筛选控件、不用 creator 冒充。
9. 无待审核物料。
10. 筛选无结果。
11. 队列 CURRENT_METADATA Validation 摘要和最多 5 条问题。
12. 从队列以安全 return_to 进入审核工作台。

### 21.2 详情与 Validation（13–16）

13. 工作台使用最新统一详情 Validation，不使用队列缓存替代。
14. ERROR 禁止批准但不自动驳回。
15. WARNING 在最终批准确认中明确勾选后允许批准。
16. WARNING 确认绑定 material_id、版本、规范化 Validation 和本次加载；任一刷新或变化后失效。

### 21.3 批准、驳回与职责分离（17–28）

17. 批准成功生成正式编码并返回原队列。
18. 可选审核评论、纯文本和 1000 字符上限。
19. 驳回原因必填、去空白、字符计数和字段错误。
20. 驳回成功回到 DRAFT 且不生成编码。
21. 后续详情 `last_rejection` 展示正确。
22. 创建人禁止审核，结构化 code 为 403 `SELF_REVIEW_FORBIDDEN`。
23. 最后修改人禁止审核，结构化 code 为 403 `LAST_EDITOR_REVIEW_FORBIDDEN`。
24. `submitted_by` 本身不单独禁止审核。
25. approve 权限单独控制。
26. reject 权限单独控制。
27. 只有 approve 权限时只显示批准动作。
28. 只有 reject 权限时只显示驳回动作；两者都无时为只读提示。

### 21.4 幂等、并发与状态（29–36）

29. VERSION_CONFLICT 保留意见、刷新详情并清除旧确认。
30. 状态已变化时关闭动作，不泄露其他审核人的敏感细节。
31. 批准和驳回提交前都重新刷新详情。
32. 相同 Key/载荷幂等重放不重复审核。
33. 响应丢失后只以原 Key 和原载荷安全重试。
34. RESULT_UNKNOWN 禁止相反或第二个审核动作。
35. IDEMPOTENCY_CONFLICT 不自动换 Key。
36. 422 后清除确认、重新 GET 并展示最新 Validation。

### 21.5 错误、导航与可访问性（37–46）

37. 401 进入现有登录流程并保护未发送意见。
38. 普通 403 使用通用文案且不加载受保护正文。
39. 404 统一文案“物料不存在或无权查看”。
40. 429 读取和展示 Retry-After，不高频自动重试。
41. 500 显示安全文案和服务端 request_id。
42. 未发送批准意见或驳回原因离开确认。
43. 安全 return_to 拒绝外部、协议相对、反斜杠和其他路由。
44. 浏览器前进后退恢复队列；最后一项处理后回退最后有效页。
45. 对话框初始焦点、焦点循环、Escape 和焦点恢复。
46. 1366×768 sticky 审核栏/操作区不遮挡内容或焦点。

### 21.6 范围与回归（47–51）

47. 工作台不出现草稿编辑控件或“审核并编辑”。
48. 不出现批量审核、多级审核、认领或转交。
49. 不在前端重新实现权限、行级过滤或完整 Validation。
50. 测试运行器在任何业务写入前拒绝 production、公共 URL 和远程 D1 binding。
51. 现有 158 个以上 Node 测试继续全部通过；以实施时实际基线数量为准并记录。

## 22. 1366×768 人工视觉验收

在 1366×768、100% 缩放下确认：

1. 保留现有约 210px 左侧导航。
2. 队列筛选紧凑，首屏无统计卡片，可见至少 8 条正常密度记录。
3. Validation 数量、等级和问题摘要可读，不只依赖颜色。
4. 工作台顶部摘要不挤压名称、状态、版本和分类路径。
5. 左侧属性增加到 24 项以上时滚动稳定。
6. 右侧审核栏宽度约 280–320px，不遮挡主体；内容区不足时正确降级。
7. sticky 审核栏或底部操作区不覆盖最后内容和焦点环。
8. ERROR/WARNING 定位后对应属性可见且获得焦点。
9. 驳回原因输入、字符计数和错误信息可读。
10. 对话框可完整键盘操作并恢复焦点。
11. 审核完成返回队列后原筛选、排序、分页和成功反馈正确。

## 23. 文档阶段验证与范围检查

文档提交前运行：

- `npm run lint`。
- `npm test`。
- 隔离 `npm run test:api`。
- `npm run security:credentials`。
- 临时 SQLite 环境守卫、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py` 和 `go_live_check.py --no-backup`。
- `git diff --check`。
- 占位符、内部矛盾、路由/API 字段、51 项测试编号和最终文件范围检查。

本次文档阶段实际结果：

| 验证项 | 结果 |
| --- | --- |
| `npm run lint` | PASS；0 error，1 个任务外既有 warning |
| `npm test` | PASS；构建成功，Node 158/158 |
| 隔离 `npm run test:api` | PASS；回环地址、一次性本地 D1、远程 binding 关闭 |
| `npm run security:credentials` | PASS；扫描 226 个仓库文件 |
| 临时 SQLite 环境守卫 | PASS；4/4 |
| `server.py --self-test` | PASS；`SELF_TEST_OK` |
| `smoke_test.py` | PASS；`SMOKE_TEST_OK` |
| `backup_restore_test.py` | PASS；`BACKUP_RESTORE_TEST_OK` |
| `go_live_check.py --no-backup` | PASS；`GO_LIVE_CHECK_OK` |
| 文档一致性 | PASS；51 项连续编号、三项 API 兼容和线框状态覆盖已核对 |
| 临时数据 | PASS；一次性 D1 与临时 SQLite 均已清理 |

最终差异不得包含：

- 前端运行时代码或测试业务代码。
- API、Schema、Migration、索引或 Material 业务服务。
- 部署配置、环境变量或生产地址修改。
- 数据库、备份、日志、截图或临时导出。
- 生产环境操作。

## 24. 规格确认门禁

本文件和线框稿提交后停止，等待项目负责人回复“规格确认”。该确认只批准后续独立前端实施任务的设计基线，不授权 API、Schema、Migration、索引、生产连接、生产迁移或部署。
