# Material Master 只读管理界面 V1

状态：`APPROVED_IMPLEMENTED_AND_VERIFIED`

任务：`PHASE1-TASK09`

日期：2026-07-14

目标运行面：`chenyida_erp_site/` 在线 Site

## 1. 目标与设计结论

为 Material Master V2 设计中文、桌面优先、可扩展的只读管理界面。V1 只消费已经完成的 Reference & Query API，不实现任何写操作，不修改 API、Schema、Migration 或业务服务。

项目负责人已确认组合布局：

- 物料列表采用高信息密度企业表格型布局，筛选区默认紧凑展开，1366×768 首屏不放统计卡片。
- 物料详情采用高密度分区卡片，分别呈现基本信息、职责信息、类型化属性、当前校验结果和最近历史摘要。
- 版本历史和变更日志保留独立 URL 和深链接，视觉上作为同一物料详情工作区的页签。
- 完整详情、版本历史和变更日志都不使用弹窗承载。
- 当前操作区只提供“查看详情”，不出现创建、编辑、提交、审核、导入或 AI 按钮。

低保真文字线框稿见 `docs/material-master/material-read-ui-v1-wireframes.md`。

## 2. 范围

### 2.1 包含

- 物料列表、服务端筛选、服务端排序和服务端分页。
- 分类树浏览与分类筛选。
- 物料详情及类型化属性只读展示。
- 当前 Validation 结果展示。
- 最近 5 个版本和最近 5 条变更日志摘要。
- 完整版本历史和完整变更日志分页。
- 登录失效、权限不足、隐藏对象、参数错误、网络错误和服务端错误状态。
- URL 状态、深链接、刷新、浏览器前进后退和返回列表恢复。
- 1366×768 桌面可用性、键盘操作和基本无障碍要求。

### 2.2 不包含

- 创建或编辑草稿。
- 提交审核、批准、驳回或审核工作台。
- Excel/CSV 导入。
- AI 分类、AI 建议或候选匹配。
- 版本恢复、日志修改或日志删除。
- 物料冻结、废止、替代或其他状态写操作。
- API、Schema、Migration、索引、业务服务或 Legacy SQLite 修改。
- 生产 D1 连接、迁移、真实数据回填或部署。
- 修复本任务外既有 TypeScript 诊断。

## 3. 现有 Site 勘查结论

### 3.1 路由和页面壳

- 当前只有 `app/page.tsx` 页面入口，通过全屏 iframe 加载 `public/erp/index.html`。
- 当前 ERP 内部导航由 `data-tab` 和 `setTab()` 切换静态 section，不使用 URL 路由，也不监听 `popstate`。
- 当前页面刷新、复制 URL 和浏览器前进后退不能表达内部 tab 状态。
- `/api/[...path]` 是统一 API 入口，Material namespace 已在服务端精确分发。
- 因此，实施 `/materials` 路由时不能只在现有 sidebar 增加一个 `data-tab`；必须增加真正可刷新、可深链接的页面路由边界。

### 3.2 认证与会话

- 现有认证使用 `CYD_ERP_SESSION` HttpOnly Cookie 和 `/api/session`。
- 当前静态 UI 在启动时调用 `/api/session`，未认证时显示现有登录遮罩；401 也会回到该登录流程。
- Material API 继续使用同一会话和 `credentials: same-origin`，不得建立第二套 Token、角色缓存或登录状态。
- 当前用户栏使用 `display_name || username`；Material 查询接口只返回账号名，不额外暴露显示名或角色资料。

### 3.3 布局、组件和视觉基线

- 现有 Site 使用顶部栏、约 210px 左侧导航、内容区、白色 panel、紧凑表格和 sticky 表头。
- 表格使用横向滚动容器和最小宽度，适合沿用为 Material 列表基线。
- 现有 CSS 有按钮、表单、panel、table、pill、toast、dialog 和登录页样式，但没有独立组件库或设计令牌包。
- 现有状态 pill 只覆盖 legacy 匹配状态，不能直接作为 Material 生命周期映射。
- 当前没有通用分页组件、分类树组件、Skeleton、标准错误页或可复用的字段级错误摘要。
- 当前没有大型前端状态管理、请求缓存或数据表格依赖；V1 没有引入它们的明确收益。

### 3.4 请求与错误处理现状

- 当前 `public/erp/app.js` 有单一 `api()` 包装，使用相对 URL、同源凭证并处理 401。
- Legacy 错误外壳和 Material 嵌套错误外壳不同；Material 错误为 `error.code/message/request_id/details`，现有 `new Error(data.error)` 会把对象错误降为无意义文本。
- 实施前应把现有请求行为抽取或扩展为唯一的浏览器请求边界，使 legacy 和 Material 页面都复用同一套会话、401 和错误解析逻辑；不得在各路由组件内重复 `fetch` 包装。
- 本任务只记录上述实施约束，不修改当前前端代码。

## 4. 路由与页面组织

| 页面 | 浏览器路由 | 数据来源 | 视觉位置 |
| --- | --- | --- | --- |
| 物料列表 | `/materials` | `GET /api/material-master/materials` | 主导航“物料主数据” |
| 物料详情 | `/materials/:materialId` | `GET /api/material-master/materials/:materialId` | 详情工作区“详情”页签 |
| 版本历史 | `/materials/:materialId/versions` | `GET /api/material-master/materials/:materialId/versions` | 详情工作区“版本历史”页签 |
| 变更日志 | `/materials/:materialId/change-logs` | `GET /api/material-master/materials/:materialId/change-logs` | 详情工作区“变更日志”页签 |

页面标题：

- 列表：`物料主数据 - 晨亿达 ERP`。
- 详情：`{standard_name} - 物料详情 - 晨亿达 ERP`。
- 版本：`{standard_name} - 版本历史 - 晨亿达 ERP`。
- 日志：`{standard_name} - 变更日志 - 晨亿达 ERP`。

### 4.1 独立 URL 与页签结论

采用“独立 URL + 统一详情工作区页签”，不采用只在详情页本地切换且 URL 不变的 Tab：

- 每个历史页面可以刷新、复制、收藏和直接打开。
- 浏览器前进后退自然恢复当前页面、分页和 page_size。
- 三个页面复用同一物料标题、面包屑、返回列表和页签导航。
- 页签使用普通链接而不是只修改本地状态；当前页签使用 `aria-current="page"`。
- 完整历史不在详情弹窗中展示。

### 4.2 返回列表协议

从列表打开详情时，在 UI 路由中携带安全的相对返回地址：

```text
/materials/456?return_to=%2Fmaterials%3Fpage%3D3%26page_size%3D50%26material_status%3DACTIVE%26sort%3Dupdated_at_desc
```

规则：

1. `return_to` 只属于浏览器 UI，不发送给 Material API。
2. 只接受以 `/materials` 开头、无 scheme、无 host、无反斜杠的同源相对地址；非法值忽略并回退 `/materials`。
3. 详情、版本历史和变更日志互相跳转时必须保留 `return_to`。
4. “返回列表”使用已校验的 `return_to`；没有该参数时返回 `/materials` 默认列表。
5. 浏览器原生后退不被拦截；用户按后退键时恢复历史记录中的原 URL。

## 5. 列表 URL 与查询状态

### 5.1 支持参数

| UI 参数 | API 参数 | 默认 | UI 规则 |
| --- | --- | --- | --- |
| `page` | `page` | `1` | 正整数；任何筛选变化后重置为 1 |
| `page_size` | `page_size` | `20` | 列表只提供 20、50、100 |
| `keyword` | `keyword` | 无 | 去空白；1..100 字符；300ms debounce |
| `material_status` | 同名 | 无 | 只发送当前 API allowlist |
| `category_id` | 同名 | 无 | 四级叶子精确筛选 |
| `category_path` | 同名 | 无 | 非叶子节点及启用后代范围筛选 |
| `source_type` | 同名 | 无 | API 受控值 |
| `created_by` | 同名 | 无 | 精确账号名 |
| `created_from/to` | 同名 | 无 | `YYYY-MM-DD` |
| `updated_from/to` | 同名 | 无 | `YYYY-MM-DD` |
| `sort` | `sort` | `updated_at_desc` | 只使用 API allowlist |

### 5.2 规范化序列化

- `/materials` 初次进入时按默认值解析；客户端使用 `replaceState` 规范化为显式的 `page=1&page_size=20&sort=updated_at_desc`，不额外制造一条后退历史。
- 参数以固定顺序序列化：`page,page_size,keyword,material_status,category_id,category_path,source_type,created_by,created_from,created_to,updated_from,updated_to,sort`。
- 空字符串、无效枚举和无效日期不发送；API 返回 400 时仍保留 URL，并在筛选区显示可修正错误。
- keyword 输入在 300ms 静默期后查询；连续输入使用 `replaceState`，避免每个字符都成为浏览器历史。
- 下拉筛选、日期、排序、分页和重置使用 `pushState`；`popstate` 必须重新从 URL 解析并请求。
- 离开页面前取消未完成请求；新请求使用 `AbortController` 或等效请求序号，较旧响应不得覆盖较新筛选结果。

### 5.3 分类参数语义

分类选择器从 `GET /api/material-master/categories?view=tree` 获取服务端树：

- 选择四级叶子时发送 `category_id`，语义为精确分类。
- 选择一级至三级非叶子时发送由服务端节点 code 组成的 `category_path`，语义为所选节点及其启用后代。
- V1 UI 不同时发送 `category_id` 和 `category_path`，避免让用户误解交集语义。
- 显示使用服务端 `full_path`；稳定筛选值使用 ID 或 code path，不把中文路径当业务标识。
- 前端不通过 `children.length` 或 `level` 推断 `is_leaf`，使用服务端 `is_leaf`。
- 分类树请求保留浏览器默认私有缓存与条件请求能力，复用 ETag/304；不得把完整 seed 打包进前端。

## 6. 物料列表页

### 6.1 页面结构

从上到下：

1. 面包屑：`首页 / 物料主数据`。
2. 页面标题“物料主数据”和“只读”说明。
3. 默认紧凑展开的两行筛选区。
4. 已生效筛选摘要、查询和重置动作。
5. 数据表格。
6. 紧邻表格的分页区。

1366×768 下：

- 沿用现有约 210px 左侧导航和紧凑顶部栏。
- 筛选区目标高度不超过约 104px，不使用大型卡片。
- 表头固定在表格滚动容器顶部。
- 分页位于表格下方正常文档流，不固定覆盖内容。
- 首屏目标至少可见 10 行正常密度数据；具体行数由最终字体和浏览器缩放验收。

### 6.2 表格列

| 顺序 | 列 | 字段 | 行为 |
| ---: | --- | --- | --- |
| 1 | 正式物料编码 | `material_code` | 第一固定列；空值显示 `—`；支持 API 编码排序 |
| 2 | 标准名称 | `standard_name` | 第二固定列；可进入详情；支持名称排序 |
| 3 | 状态 | `material_status` | 文字状态标签 |
| 4 | 分类路径 | `category_path` | 单行省略，键盘聚焦或悬停显示完整路径 |
| 5 | 基本单位 | `unit` | 原值安全转义 |
| 6 | 来源 | `source_type` | 中文显示映射 |
| 7 | 当前版本 | `current_version` | 显示 `V{n}` |
| 8 | 创建人 | `created_by` | 只显示 API 返回账号名 |
| 9 | 更新时间 | `updated_at` | 支持 API 更新时间排序 |
| 10 | 操作 | 无 | 仅“查看详情”链接 |

规则：

- 表格横向滚动，编码和标准名称固定在左侧；固定列要有明确分隔和正确 z-index。
- V1 不固定右侧操作列，避免窄内容区内左右固定列挤压中间字段。
- 长名称和分类路径使用省略；完整文本必须可被键盘访问，不能只依赖鼠标 title。
- 表格不加载属性、Validation、历史，也不对每行执行客户端权限过滤。
- 行点击不是唯一入口；“查看详情”必须是可聚焦的链接。
- 表头排序按钮只出现在 API 支持且实际显示的列：编码、标准名称、更新时间。紧凑筛选区另提供创建时间升/降序选项。状态、分类和来源不可伪装成可排序列。

### 6.3 分页

- 默认 `page=1`、`page_size=20`。
- page_size 选项：20、50、100；不提供“全部”。
- 展示总记录数、当前页/总页数、上一页、下一页和有界页码窗口。
- `total_pages=0` 时显示 0 页，不生成无效页码。
- API 返回当前 page 超出总页数时，UI 回到最后有效页并以 `replaceState` 修正 URL；不得循环请求。

### 6.4 加载与空状态

| 状态 | 展示 |
| --- | --- |
| 首次加载 | 保留筛选骨架、表头和 10 行 Skeleton；表格容器高度稳定 |
| 筛选加载 | 保留上一页数据，表格设 `aria-busy=true`，显示“正在更新结果”，阻止重复分页 |
| 空数据库 | 无筛选且 total=0：`尚无可查看的物料`；不展示创建入口 |
| 筛选无结果 | 有筛选且 total=0：`没有符合当前筛选条件的物料`，提供“清除筛选” |

## 7. 状态与来源显示

### 7.1 生命周期状态

| 原始值 | 中文 | 备注 |
| --- | --- | --- |
| `DRAFT` | 草稿 | 文字标签 |
| `PENDING_REVIEW` | 待审核 | 文字标签 |
| `ACTIVE` | 生效 | 文字标签 |
| `FROZEN` | 冻结 | 文字标签 |
| `INACTIVE` | 停用 | 当前 Query API 支持值 |
| `OBSOLETE` | 废止 | 预留显示映射；当前 API 不接受为筛选值 |
| `REPLACED` | 已替代 | 预留显示映射；当前 API 不接受为筛选值 |
| 其他 | 未知状态 | 可附安全原始 code；绝不当作 ACTIVE |

每个状态标签同时包含中文文字和可访问名称。颜色只能作为辅助，不是唯一表达方式。

现有 API 契约的筛选 allowlist 为 `DRAFT,PENDING_REVIEW,ACTIVE,FROZEN,INACTIVE`。本任务不修改 API；`OBSOLETE` 和 `REPLACED` 只作为防御性显示映射，不能出现在 V1 筛选请求中。

### 7.2 来源

| 原始值 | 中文 |
| --- | --- |
| `MANUAL` | 人工 |
| `LEGACY_D1` | 旧版在线系统 |
| `LEGACY_SQLITE` | 本地旧版系统 |
| `GOVERNANCE_TEMPLATE` | 治理模板 |
| `API` | API |
| 其他 | 未知来源 |

## 8. 物料详情页

### 8.1 详情工作区头部

- 面包屑：`物料主数据 / {material_code 或 standard_name}`。
- 返回列表：使用第 4.2 节 `return_to`。
- 标题：标准名称、正式编码和状态文字标签。
- 页签：详情、版本历史、变更日志。
- 后续写功能只预留一个权限驱动操作区容器；V1 不渲染空按钮、禁用按钮或任何写操作提示。

### 8.2 分区卡片

#### 基本信息

- `material_code`
- `standard_name`
- `material_status`
- 四级 `category_path`
- `unit`
- `source_type`
- `source_ref`
- `current_version`
- 现有详情 API 提供的品牌、制造商、制造商型号、采购/库存类型、批次、保质期、检验和环保字段可放在“扩展基本信息”，不抢占首要字段。

#### 职责信息

- `created_by`
- `last_modified_by`
- `submitted_by`
- `submitted_at`
- `approved_by`
- `approved_at`
- `created_at`
- `updated_at`

Material API 只返回账号名时直接显示账号名，不另查用户目录。顶部会话用户若显示名为空，使用 `username`；两者都缺失时显示 `当前用户`，不得显示 `undefined`。

#### 类型化属性

- 以 API 返回顺序展示；显示名作为主标签，`attribute_code` 作为辅助文本。
- 三列紧凑网格为 1366×768 默认；内容过长时单元格跨列或在窄宽下退化为两列。
- 不渲染编辑控件，不把详情展示数组反向转换成写命令。

| 类型 | 展示规则 |
| --- | --- |
| `TEXT` | 安全转义的文本；保留合理换行，不解析 HTML |
| `INTEGER` | 整数；0 是有效值 |
| `DECIMAL` | 有限数值，不擅自换算或舍入；单位紧邻数值 |
| `BOOLEAN` | `是` / `否`；不得显示原始 true/false |
| `ENUM` | 显示受控 label；当前 metadata 没有 label 时等于 code，不自行翻译 |
| 空值 | 统一显示 `—`；false 和 0 不属于空值 |
| 未知类型 | `无法显示的属性类型`，显示 attribute_code，不猜测值 |

#### 当前校验结果

- 使用服务端返回的 `validation.valid`、`errors`、`warnings` 和 `basis`。
- ERROR 显示“错误”，WARNING 显示“警告”，均包含文字、数量、code、字段和安全消息。
- 数量是对服务端返回数组的展示计数，不在浏览器重新执行校验规则。
- `valid=false` 不触发前端写操作，也不改变物料状态。
- 不显示 SQL、堆栈、数据库路径或原始内部异常。

#### 最近历史摘要

- 版本摘要最多 5 条，变更日志摘要最多 5 条，直接使用详情 API 的固定上限。
- 显示总数和 `has_more`。
- “查看完整版本历史”和“查看完整变更日志”链接进入对应独立 URL，并保留 `return_to`。
- 摘要不展示完整 snapshot、old_value 或 new_value。

## 9. 版本历史

### 9.1 列表

- 默认 `page=1`、`page_size=20`；只提供 20、50，最大值遵循 API 的 50。
- 固定排序：`version DESC`，UI 不提供无效排序控件。
- 列：版本、动作、操作者、状态变化、时间、comment 摘要、快照。
- `event_type` 使用稳定中文映射并保留原始 code 作为辅助：CREATE 创建、UPDATE 更新、SUBMIT 提交、APPROVE 批准、REJECT 驳回；未知值显示“未知动作”。
- 状态变化从安全 snapshot/changed fields 中展示；无法确定时显示 `—`，不自行推断生命周期。
- comment 默认单行截断；展开后在当前行下方显示完整安全文本，不使用弹窗。
- 空页显示 `暂无版本历史`，仍保留物料标题、页签和返回列表。

### 9.2 版本快照

- V1 支持“查看快照”，因为 API 已返回解析后的 snapshot。
- 同一时间只展开一个版本快照，放在表格行下方的只读详情面板。
- 快照优先按基本字段、状态/职责、类型化属性分区展示；不默认显示原始 JSON。
- 不提供恢复、复制为草稿或比较并写回。
- 过大的嵌套值最多渲染 4 层和 4KB 文本预览；超界时显示“内容过长，界面仅展示有界预览”。完整审计导出不在 V1 范围。

## 10. 变更日志

### 10.1 列表

- 默认 `page=1`、`page_size=20`；只提供 20、50。
- 固定排序：`created_at DESC`，UI 不提供无效排序控件。
- 列：动作、操作者、发生时间、原版本、新版本、变更摘要、追踪信息、详情。
- API 当前日志项不单独返回原版本/新版本；V1 只能在 `field_name`、`old_value/new_value` 或安全上下文明确提供时显示，否则统一 `—`，不得猜测。
- 摘要优先显示 `change_type`、`field_name`、`change_reason` 和有界前后值预览。
- 空页显示 `暂无变更日志`，仍保留物料标题、页签和返回列表。

### 10.2 有界详情和追踪信息

- 详情在当前行下方展开，展示 old_value/new_value 的结构化只读对比，不使用弹窗。
- 同一时间只展开一行；对象最多展开 4 层，文本最多 4KB，数组最多显示前 100 项并明确截断。
- 页面不展示 Token、Cookie、Header、SQL、数据库路径或服务端堆栈。
- 使用 API 返回的 `operation_id` 作为等效追踪信息；表格只显示末 8 位，例如 `…9fe21c2a`。
- 可提供“复制完整追踪编号”按钮；不在普通表格中铺开完整 UUID，也不把它解释为会话或安全凭证。
- V1 不提供日志修改、删除或无界原始 JSON 下载。

## 11. 错误、权限与数据隐藏

### 11.1 统一错误映射

| 场景 | 页面行为 | 用户文案 |
| --- | --- | --- |
| 网络失败 | 保留当前 URL 和旧数据；提供重试 | `网络连接失败，请检查网络后重试` |
| 401 `AUTH_REQUIRED` | 进入现有登录流程并保留当前 URL；登录后回原页 | `登录状态已失效，请重新登录` |
| 403 `FORBIDDEN` | 页面级权限状态，不查询对象细节 | `当前账号没有查看此功能的权限` |
| 404 `MATERIAL_NOT_FOUND` | 详情/历史统一状态 | `物料不存在或无权查看` |
| 400 `REQUEST_VALIDATION_FAILED` | 筛选区错误摘要；安全 details 可关联字段 | `查询条件有误，请检查后重试` |
| 500 | 脱敏错误页或表格错误区，显示 request_id | `系统暂时无法加载数据，请稍后重试` |

- request_id 只用于排障，不作为业务编号。
- toast 只能作为补充反馈，页面级错误必须留在内容区并可由键盘访问。
- 重试使用当前 URL 重新请求，不清空筛选。
- 服务器未返回 request_id 时不生成伪造编号。

### 11.2 权限边界

- 前端不根据角色名实现行级过滤，也不从总数、分页或状态推测隐藏记录。
- 列表和 total 完全相信服务端授权后的结果。
- 不存在与无行级可见权统一按 404 展示。
- 403 只表示用户明确缺少当前路由基础权限。
- 页面没有写按钮；未来操作区必须由服务端权限驱动，但隐藏按钮仍不能替代服务端授权。

### 11.3 缓存

- `/materials`、详情、版本、变更日志使用服务端 `private, no-store`；客户端不建立跨路由持久查询缓存。
- 分类树和分类 Schema 可使用服务端私有 ETag/304。
- 不把其他用户的 Material 查询结果写入 localStorage、IndexedDB 或 Service Worker。
- 用户退出或会话切换后清空当前内存态；页面重新从服务端读取。

## 12. 日期、文本和格式化

- API UTC ISO 时间在界面按 `Asia/Shanghai` 显示。
- 列表使用 `YYYY-MM-DD HH:mm`；详情和历史使用 `YYYY-MM-DD HH:mm:ss`。
- 日期范围输入保持 `YYYY-MM-DD`，与 API UTC 日期边界语义一致；界面帮助文字明确“按 UTC 日期筛选”，避免把本地午夜误当服务端边界。
- 所有用户或业务文本按纯文本渲染，不解释 HTML。
- 缺失值统一为 `—`；未知枚举使用明确“未知…”文案，不静默降级。

## 13. 可访问性与键盘操作

- 页面语言为 `zh-CN`，页面标题随路由更新。
- 筛选控件有可见 label；分类树使用可访问树或分层 list 语义。
- 表格有可访问名称和 caption；表头使用 `scope=col`，排序列维护 `aria-sort`。
- 固定列、横向滚动和焦点样式不能遮挡键盘焦点。
- 页签使用链接和 `aria-current`；不依赖鼠标拖动。
- 状态、ERROR、WARNING、加载和失败均用文字表达。
- Skeleton 设为装饰；加载区域使用 `aria-busy` 和克制的 live region。
- 省略文本可通过键盘聚焦查看完整内容。
- 目标最小点击区域约 32×32px；正文和表格在 100% 浏览器缩放下可读。

## 14. 前端模块边界

以下为实施阶段的建议边界，不代表当前已存在文件或已授权代码：

```text
Material route shell
  -> Session boundary（复用现有 /api/session 和 Cookie）
  -> Shared browser API client（唯一 fetch/error/401 边界）
  -> URL query codec
  -> Material list page
       -> Compact filter bar
       -> Category tree picker
       -> Material table
       -> Pagination
  -> Material detail workspace
       -> Detail cards
       -> Attribute read renderer
       -> Validation panel
       -> History summary
       -> Version history page
       -> Change log page
```

### 14.1 路由组件

- 推荐使用原生 Vinext 页面路由承载 `/materials/...`：共享 `materials` layout、列表 page、`[materialId]` 详情 page，以及 versions/change-logs 子 page；不能仅增加 iframe 内部 tab。
- 现有根页面和 legacy iframe 行为保持不变，Material 页面作为边界清晰的只读路由模块接入，不把新逻辑继续堆入现有单文件 `app.js`。
- 新主导航使用普通同源链接进入 `/materials`。
- 实施计划先用最小路由原型验证 Vinext catch-all、刷新和 Sites 构建；若原生路由在当前 Vinext 版本不可用，必须停止并修订规格，不能静默退化为 hash 或仅 iframe tab。

### 14.2 API Client

- 只使用相对 API 路径、`credentials: same-origin`、JSON Accept 和服务端 Cookie。
- 统一解析 legacy 与 Material 两种错误外壳，Material 优先读取 `error.code/message/request_id/details`。
- GET 不发送 Idempotency-Key、CSRF 或 Content-Type 请求正文头。
- 不在组件中硬编码生产地址，不读取生产密钥，不直接访问 D1。
- 不允许列表、详情和历史各自再封装一套 fetch。
- 当前 legacy `api()` 不能正确解析 Material 嵌套错误。实施任务必须先形成一个共享浏览器请求边界，并让旧包装和新 Material 路由委托同一错误/401 核心；若构建边界无法共享，应暂停并请求架构确认，不能并存两套长期 HTTP Client。

### 14.3 类型定义

- 类型从已批准 OpenAPI 字段手工对齐或由受控工具生成；不得让运行时 UI 假定 unknown enum 必然属于联合类型。
- 区分 `MaterialListItem`、`MaterialDetail`、`MaterialAttributeView`、`ValidationResult`、`MaterialVersion`、`MaterialChangeLog`、`Pagination` 和 `MaterialApiError`。
- 运行时仍需验证关键响应外壳；TypeScript 类型不能替代不可信 JSON 检查。

### 14.4 客户端状态与依赖

- URL 是列表筛选、排序和分页的权威状态；组件状态只保存输入草稿、加载、展开行和当前响应。
- 不引入 Redux、Zustand、TanStack Query 或新的大型 Data Grid。
- 使用浏览器 History、AbortController 和现有 React/Vinext 能力即可满足 V1。
- 不做跨用户查询缓存；分类 Reference 只依赖 HTTP ETag。

### 14.5 数据加载方式

- 当前 Site 没有可复用 loader/server-fetch 模式；Material 页面采用客户端同源 GET，以便 URL 筛选、AbortController、401 登录恢复和 `private, no-store` 保持一致。
- 不在服务端页面层复制 Material 权限或缓存物料响应；服务端 API 仍是行级可见性权威。
- 首次路由壳可服务端静态渲染布局和 Skeleton，但受保护业务数据由浏览器通过现有会话读取。

### 14.6 组件清单

| 单元 | 单一职责 |
| --- | --- |
| `MaterialRouteLayout` | 面包屑、标题、返回列表、详情工作区页签 |
| `MaterialFilterBar` | 紧凑筛选输入、已选摘要、查询和重置 |
| `MaterialCategoryPicker` | 分类树、叶子/非叶子语义和 ETag 请求 |
| `MaterialTable` | sticky 列、服务端排序入口、查看详情 |
| `Pagination` | page/page_size、总数和有界页码 |
| `MaterialStatusTag` | 已知/未知状态文字映射 |
| `MaterialDetailCards` | 基本、职责和扩展信息分区 |
| `ReadOnlyAttributeRenderer` | TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位/空值 |
| `ValidationPanel` | valid、ERROR、WARNING 和安全 issue |
| `HistorySummary` | 两类最多 5 条摘要和完整历史链接 |
| `VersionHistoryTable` | 版本分页、comment 和有界快照 |
| `ChangeLogTable` | 日志分页、有界前后值和 operation_id |
| `MaterialErrorState` | 网络、401、403、404、400 和 500 映射 |

## 15. 测试计划

### 15.1 单元测试

1. 列表参数解析、默认值、固定顺序序列化和无效值处理。
2. 筛选变化重置 page，分页变化保留筛选。
3. `return_to` 同源校验和恶意 URL 拒绝。
4. 状态映射覆盖已知、INACTIVE、OBSOLETE、REPLACED 和 unknown。
5. 来源映射和 unknown fallback。
6. TEXT、INTEGER、DECIMAL、BOOLEAN、ENUM、单位、0、false 和空值格式化。
7. 日期按 Asia/Shanghai 格式化。
8. legacy/Material 错误外壳、401/403/404/400/500 和网络失败映射。
9. operation_id 有界显示和复制完整值。
10. 大型 snapshot/diff 的深度、字符和数组上限。

### 15.2 组件与集成测试

1. 未登录用户进入任一路由后进入现有登录流程并保留 URL。
2. 默认列表请求显式使用 page=1、page_size=20、updated_at_desc。
3. URL 筛选在刷新和 popstate 后恢复。
4. keyword debounce 不产生逐字符历史。
5. 状态、分类 ID、分类 path、来源、创建人和日期筛选正确映射 API。
6. 分类树 ETag/304 与会话先认证兼容。
7. 表格固定编码/名称列和横向滚动可用。
8. 首次加载、筛选加载、空数据库和筛选无结果状态。
9. 401、403、400、500、网络失败和安全 request_id 文案。
10. 隐藏详情 404 统一为“物料不存在或无权查看”。
11. 详情基本/职责/属性/Validation/历史摘要完整分区。
12. ERROR/WARNING 文字、数量和 issue 列表正确。
13. 最近版本和变更摘要各不超过 5 条。
14. 版本和变更日志独立分页默认 20、最大 50。
15. 快照和变更详情只读、有界、单行展开且无恢复按钮。
16. 从列表到详情再返回恢复原筛选、排序和分页。
17. 详情、版本、变更页签保持 return_to 和各自分页参数。
18. 不请求无界数据，不在客户端执行行级权限过滤。
19. 不渲染 Token、Cookie、Header、SQL、堆栈或内部数据库信息。
20. 页面不存在创建、编辑、提交、批准、驳回、导入和 AI 操作。

### 15.3 端到端验收

按任务要求至少覆盖以下 30 项：

1. 未登录进入页面。
2. 列表成功加载。
3. 默认分页。
4. URL 筛选恢复。
5. keyword 搜索。
6. 状态筛选。
7. 分类筛选。
8. 来源筛选。
9. 排序。
10. 空数据库。
11. 筛选无结果。
12. API 失败。
13. 401。
14. 403。
15. 隐藏详情 404。
16. 详情字段。
17. TEXT。
18. INTEGER/DECIMAL。
19. BOOLEAN。
20. ENUM。
21. 单位。
22. Validation ERROR/WARNING。
23. 版本分页。
24. 变更日志分页。
25. 分类树 ETag/304。
26. 浏览器前进后退。
27. 不请求无界数据。
28. 不执行客户端行级过滤。
29. 不泄露 Token 或内部错误。
30. 现有后端测试继续通过。

所有写入型测试必须使用 `ERP_ENV=test` 和本机一次性 Miniflare D1，拒绝公开生产 URL、远程绑定和生产 D1。前端只读 E2E 也使用合成数据和隔离环境。

## 16. 实施阶段验收标准

- 1366×768、100% 缩放下列表首屏无统计卡片，筛选紧凑，至少可见 10 行正常密度数据。
- 编码和标准名称固定列在横向滚动时可读、可聚焦且不遮挡。
- URL 可复制；刷新、前进、后退和返回列表恢复正确。
- 详情分区清楚，属性密度适合 PCB/FPC/SMT 日常查阅。
- 版本和变更日志拥有独立 URL，视觉上保持详情工作区页签。
- 所有状态、ERROR、WARNING、加载和错误均有文字表达。
- 不存在任何写按钮、写 API 调用或生产连接。
- `npm run lint`、`npm test`、隔离 `npm run test:api` 和适用 E2E 通过。
- 本地 Python 基线在临时 SQLite 下继续通过。
- 凭证扫描、`git diff --check` 和最终范围检查通过。

## 17. 已确认与待确认

### 17.1 已确认

1. 列表采用方案 A：高密度筛选和企业表格，首屏无统计卡片。
2. 详情吸收方案 B：基本、职责、属性、校验和历史摘要分区卡片。
3. 版本与变更日志为独立 URL，并以详情工作区页签呈现。
4. 浏览器历史、刷新、深链接和返回列表必须保留路由状态。
5. 编码和标准名称优先固定；操作区只有“查看详情”。
6. 不展示或实施任何写操作、导入或 AI 功能。

### 17.2 规格确认时一并确认

1. 接受 `return_to` 安全相对 URL 作为确定性返回列表协议。
2. 接受叶子使用 `category_id`、非叶子使用 `category_path` 的分类筛选语义。
3. 接受列表 page_size 为 20/50/100，历史 page_size 为 20/50。
4. 接受版本快照和变更详情只在行下方有界展开，不使用弹窗。
5. 接受当前 API 状态差异：INACTIVE 显示“停用”，OBSOLETE/REPLACED 仅作防御性显示映射，V1 不发送为筛选值。
6. 接受实施阶段先验证真正的 `/materials/...` 路由壳，并抽取唯一浏览器请求边界；不新增大型前端依赖。

## 18. 生产与实施保护

项目负责人已于 2026-07-14 回复“规格确认”，并批准在 `PHASE1-TASK09` 范围内实施本文只读页面。该授权不包含 API、Schema、Migration、索引、生产连接、生产迁移或部署。

未经单独明确授权，不得：

- 修改 API、Schema、Migration、索引或业务服务。
- 连接、迁移、回填或部署生产 D1。
- 修改 legacy SQLite。
- 创建写页面或调用写接口。
- 发布生产 Site。

## 19. 本阶段验证结果

2026-07-14 对本次文档-only 变更完成以下非生产验证：

- 规格自检：两份文档无未完成占位标记或未解释占位内容；四条页面路由、状态、错误、组件、历史和测试章节完整。
- `npm run lint`：0 error，保留治理工具中 1 个任务外既有未使用变量 warning。
- `npm test`：Vinext build 通过，Node 66/66 通过。
- `npm run test:api`：本机一次性 Miniflare D1 smoke 通过，运行器清理测试数据。
- `npm run security:credentials`：203 个仓库文件扫描通过。
- 项目 Python 3.12 临时 SQLite：环境守卫 4/4、`server.py --self-test`、`smoke_test.py`、`backup_restore_test.py` 和 `go_live_check.py --no-backup` 通过；临时目录已清理。
- 最终范围只包含两份 Material UI 规格和项目治理文档；未修改运行时代码、前端、API、Schema、Migration、测试代码或部署配置。
- 未连接生产 D1、未迁移真实数据、未部署生产 Site。

## 20. 实施与验证结果

2026-07-14 已按批准的组合布局完成非生产前端实现：

- 新增原生 Vinext `/materials`、`/materials/:materialId`、`/versions` 和 `/change-logs` 四条页面路由，刷新和深链接不依赖 hash 或 iframe 内 tab。
- 列表使用紧凑两行筛选、高密度横向滚动表格、固定编码/名称列、服务端分页/排序、300ms keyword debounce、分类树和 URL 权威状态。
- 详情使用基本信息、职责信息、类型化属性、当前校验和两类最近历史摘要分区；完整历史使用独立 URL、服务端分页和有界行下展开。
- legacy 页面和 Material 路由共同委托 `public/erp/api-client.js`，复用同源 Cookie、相对 API、401 事件和 Material/legacy 错误解析；未建立第二套 HTTP Client。
- Material 路由未建立登录表单。未认证时携带安全 `return_to` 返回现有根页面登录遮罩，登录成功后回到原 Material URL；恶意、协议相对、外部或 scheme URL 回退 `/materials`。
- 状态兼容覆盖 `INACTIVE=停用`、`OBSOLETE=废止`、`REPLACED=已替代` 和未知状态；筛选仍只发送 Query API allowlist。
- 新增 37 个 UI 单元/契约测试，覆盖任务要求的 36 类场景；Site 全量 Node 测试、隔离 API smoke、lint、build、凭证扫描和临时 SQLite 基线通过。
- 本地 Vinext 开发运行面四条页面路由均返回 200；普通 Node production start 因当前构建的 `cloudflare:` 模块加载限制不能作为本地 HTTP 验证入口，最终路由验证使用项目既有开发运行面和正式 build。
- 未修改 API、Schema、Migration、索引、Material 服务、legacy SQLite 或部署配置；未连接生产 D1、迁移真实数据或部署生产 Site。
