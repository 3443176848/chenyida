# Material Import Workspace UI V1 — 状态矩阵

> Status: PROPOSED
> 任务：PHASE2-TASK05
> 服务端批次状态、Mapping preparation、版本、权限与幂等结果是权威；`view` 只决定合法状态内的优先展示。

## 1. 主状态矩阵

缩写：D=批次详情，S=Sheets，R=Rows，M=Mapping；`C/P/X/Map` 分别为 create/parse/cancel/map capability。任何写操作还要求 CSRF、独立 Idempotency-Key、最新版本、fresh 数据、无冲突写和无 RESULT_UNKNOWN。

| 批次状态 | preparation | 合法 view | 可读 API | 可执行写操作 | capability | 轮询 | Stepper | 主要文案 | RESULT_UNKNOWN 互斥 | dirty 保护 | 错误/恢复动作 | 实施门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CREATED | — | file | D | 重新选 File 后上传；取消 | read；上传沿创建授权；X | 稳定，不轮询 | 文件=当前；后续锁定 | 继续选择并上传文件 | 任一 unknown 锁冲突写 | 不适用 | 不恢复本地 File；重选、刷新、取消 | 无 |
| UPLOAD_PENDING | — | file | D | 仅原上传恢复；取消 | read；X | 活跃：2/5/10s | 文件=当前/活动；后续锁定 | 正在等待上传/服务端处理 | 上传 unknown 只许原重放；禁新批次 | 不适用 | 手动刷新；取消不承诺立即删对象 | 无 |
| FILE_READY | — | parse | D | 启动解析；取消 | P；X | 稳定 | 文件完成；解析当前；后续锁定 | 文件已就绪，可启动解析 | parse/cancel unknown 互斥 | 不适用 | 写前重读安全状态和版本 | 无 |
| QUEUED_FOR_PARSING | — | parse | D | 取消 | X | 活跃：2/5/10s | 文件完成；解析当前 | 解析请求排队中 | cancel unknown 禁 parse/新取消 | 不适用 | 刷新；不推断 Queue 位置/ETA | 无 |
| PARSING | — | parse | D | 协作式取消 | X | 活跃：2/5/10s | 文件完成；解析当前 | 服务端正在解析；仅最近更新时间 | cancel unknown 禁其他冲突写 | 不适用 | 刷新；不推断阶段/百分比/heartbeat | 无 |
| PARSED | NOT_STARTED | sheet | D,S,R（可见 Sheet） | 无 Mapping 写 | read | 活跃：2/5/10s | 文件/解析完成；Sheet 只读当前；Mapping 锁 | 解析结果已发布，正在准备字段映射 | 既有 unknown 未权威清除则继续锁 | 不允许建立可保存 dirty | 查看 Sheets/Rows，受控刷新 | 50×256 验收 |
| PARSED | QUEUED | sheet | D,S,R | 无 Mapping 写 | read | 活跃：2/5/10s | 同上 | 字段映射准备排队中 | 同上 | 同上 | 刷新 | 50×256 验收 |
| PARSED | RUNNING | sheet | D,S,R | 无 Mapping 写 | read | 活跃：2/5/10s | 同上 | 字段映射准备中 | 同上 | 同上 | 刷新 | 50×256 验收 |
| PARSED | FAILED | sheet/处置 | D,S,R | 无；不重新 parse | read | 稳定 | 解析完成；Sheet 只读；失败标记在 Mapping 准备 | 解析结果已发布，但字段映射准备失败 | 写均锁定 | 不允许新 dirty | 刷新、联系管理员；无伪重试 | 50×256 验收 |
| PARSED | READY | sheet | D,S,R | 无；客户端不解锁 | read | 立即 GET 一次，再有界轮询 | 解析完成；Sheet 只读；Mapping 仍锁 | 正在确认字段映射准备状态 | 写均锁定 | 不允许新 dirty | 等待服务端进入 AWAITING_MAPPING | 50×256 验收 |
| AWAITING_MAPPING | READY/契约实际值 | sheet 或 mapping | D,S,R,M | PUT 保存；preview；confirm | Map（读仍按 read） | 稳定 | 文件/解析完成；Sheet/Mapping 当前；确认锁/待就绪 | 请选择 Sheet、Header 并配置字段映射 | save unknown 禁 preview/confirm；preview unknown 禁 confirm；confirm unknown 禁编辑/写 | sheet/header/离页需 guard；保存成功才清对应 dirty | 冲突重读；metadata 错保留映射并失效 preview | **BLOCKED_BY_MAPPING_TARGET_CATALOG**；50×256验收 |
| MAPPING_CONFIRMED | READY/契约实际值 | confirmed；sheet 只读 | D,S,R,M | 无 | read | 稳定 | 全部完成但 Sheet/Header/Mapping 只读 | 字段映射已确认；不代表物料已创建 | 不应有新写；遗留 confirm unknown 先权威恢复 | 无编辑 dirty | 只显示真实字段；无确认人/时间推断 | 50×256验收（Rows） |
| FAILED | — | 状态处置 | D | 仅明确重复失败的新批次流程；原批次不写 | C（新批次）/read | 稳定 | 对应阶段失败；后续锁定 | 按安全 stage/code 分类 | 明确业务失败不算 unknown；若原写仍 unknown 不得直接重试批次 | 不适用 | 刷新；安全 request_id；重复需同 SHA 新批次 | 无 |
| CANCELLED | — | 状态处置 | D | 无 | read | 稳定 | 取消标记；后续锁定 | 批次已取消 | 清除已权威解析的 unknown；禁止新写 | 不适用 | 刷新/返回列表 | 无 |
| RECONCILIATION_REQUIRED | — | 状态处置 | D | 普通用户无 | read | 稳定 | 协调失败标记；后续锁定 | 当前批次需要后台协调 | 禁止上传/解析/普通协调写 | 不适用 | 刷新、联系管理员、safe request_id | 无普通用户绕过 |

## 2. view 规范化矩阵

| 请求 view | 服务端状态 | 规范化结果 | history 行为 |
| --- | --- | --- | --- |
| 缺失 | 任意 | 按主矩阵默认落点 | 必要时 replace，不产生额外历史 |
| file | CREATED/UPLOAD_PENDING | 保留 | 无 |
| file | 其他 | 改为状态默认 | replaceState |
| parse | FILE_READY/QUEUED/PARSING | 保留 | 无 |
| parse | 其他 | 改为状态默认 | replaceState |
| sheet | PARSED/AWAITING/MAPPING_CONFIRMED | 保留；仍检查 Sheet 列表 | 无/必要时 replace |
| mapping | AWAITING_MAPPING | 保留；仍需 map capability 才能写 | 无 |
| mapping | PARSED | 改 sheet，只读 | replaceState |
| mapping | MAPPING_CONFIRMED | 改 confirmed | replaceState |
| confirmed | MAPPING_CONFIRMED | 保留 | 无 |
| 任意未知字符串 | 任意 | 安全默认；原值不进请求/不回显 | replaceState |
| 任意 | FAILED/CANCELLED/RECONCILIATION_REQUIRED | 状态处置页 | replaceState |

## 3. Mapping preparation 细分

| preparation | 批次应有状态 | Sheets/Rows | Mapping 控件 | 轮询/恢复 |
| --- | --- | --- | --- | --- |
| NOT_STARTED | PARSED | 可读已发布可见数据 | 锁定 | 正常活跃轮询 |
| QUEUED | PARSED | 可读 | 锁定 | 正常活跃轮询 |
| RUNNING | PARSED | 可读 | 锁定 | 正常活跃轮询 |
| FAILED | PARSED | 可读 | 锁定 | 稳定；刷新/管理员，无伪重试 |
| READY | 通常 AWAITING_MAPPING | PARSED 短暂态仍可读 | PARSED 时锁定 | 立即 GET；仍 PARSED 则有界轮询，不客户端推进 |

## 4. 写操作与 RESULT_UNKNOWN 互斥

| 当前操作 | Key 与载荷 | 进入 unknown 后允许 | 禁止 | 权威清除条件 |
| --- | --- | --- | --- | --- |
| 创建批次 | create 独立 Key + 不可变创建载荷 | 原操作重放；允许的服务端查询辅助 | 新建第二批次、新 Key | 权威幂等结果/明确终态 |
| REJECT 上传 | upload 独立 Key + File/SHA/version/REJECT | 原 File/Key/endpoint/载荷重放；GET 辅助 | 新批次、ALLOW_DUPLICATE、再解析 | 权威上传结果/明确批次终态 |
| ALLOW_DUPLICATE 上传 | 新批次、新 upload Key + ALLOW_DUPLICATE | 原操作重放；GET 辅助 | 复用 REJECT Key/改原 FAILED 批次 | 新批次权威结果 |
| 启动解析 | parse 独立 Key + version/parser constant | 原 parse 重放；GET 辅助 | 再 parse、cancel、upload、Mapping 写 | 幂等结果或明确后续/终态 |
| 取消 | cancel 独立 Key + version/reason | 原 cancel 重放；GET 辅助 | 新 Key 取消、parse、其他冲突写 | 幂等结果或明确终态 |
| 保存 Mapping | save 独立 Key + 完整快照 | 原 PUT 重放；GET Mapping 辅助 | preview、confirm、新 save 覆盖 | 幂等结果或服务端明确保存版本 |
| preview | preview 独立 Key + 已保存版本 | 原 preview 重放；GET 辅助 | confirm、新 preview 覆盖 | 权威 preview 结果；随后仍校验绑定 |
| confirm | confirm 独立 Key + 保存版本 | 原 confirm 重放；GET 辅助 | 编辑、save、preview、新 confirm | 幂等结果或 MAPPING_CONFIRMED 终态 |

`IDEMPOTENCY_CONFLICT` 是同 Key 不同请求，不属于 unknown；不得自动换 Key。服务端明确“处理中”也不是业务失败，只能等待或原载荷重放。

## 5. Dirty 与失效矩阵

| 事件 | Rows 缓存 | Header 编辑 | Mapping dirty | Preview | Catalog/metadata 绑定 | 写操作准备 |
| --- | --- | --- | --- | --- | --- | --- |
| 切换查看 URL sheet，无正式编辑 | 按 Sheet 切换 | 已存 Mapping 选择不被覆盖 | 不变 | 不变，除非绑定正式 Sheet 变化 | 不变 | 不变 |
| 确认切换正式 Sheet | 清旧 Sheet 相关 | 重置/取建议 | 清除（先 dirty guard） | 失效 | 重新校验 | 清旧准备 |
| 修改 Header mode/row | 原始 Rows 不变 | 更新 | items 需重验 | 失效 | metadata digest 不自动改变 | 清 Mapping 写准备 |
| 本地 Mapping item/default 改变 | 不变 | 不变 | 是 | 立即失效 | 保留但不能证明新鲜 | 清 save 后依赖准备 |
| Mapping 保存成功 | 不变 | 采用服务端值 | 清对应 dirty | 失效，需新 preview | 采用真实 digest | 建立新 preview 准备 |
| batch current_version 变化 | 重新核对 | 重新核对 | 标冲突/可恢复 | 失效 | 重验 | 全清 |
| mapping version 变化 | 不变 | 以服务端为基线前需 guard | 本地副本标冲突 | 失效 | 重验 | 全清 |
| current_parse_run_id 变化 | 全清 | 全清 | STALE/清除前确认 | 失效 | 全清 | 全清 |
| 页面刷新 | 从服务端重取 | 恢复已保存值 | 未保存内容丢失并预先告知 | 失效 | 重取 | 页面内存操作均不可恢复 |
| 403 | 清 | 清 | 清 | 清 | 清 | 终止未发送准备 |

## 6. 取消语义矩阵

| 状态 | 确认文案重点 | 竞争结果 |
| --- | --- | --- |
| CREATED | 取消尚未上传文件的空批次 | 服务端最终判定 |
| UPLOAD_PENDING | 请求/对象协调可能仍在结束，不表示立即删除 | send 后上传状态可能需协调 |
| FILE_READY | 不再进入解析，文件按保留/清理策略处理 | parse 若先成功则取消冲突 |
| QUEUED_FOR_PARSING | 阻止尚未完成结果发布，不承诺 Queue 消息物理删除 | 取消 CAS 成功则旧任务不得发布 |
| PARSING | 协作式取消，后台可短暂继续计算 | 解析先原子发布则旧版本取消冲突 |

## 7. 权限变化矩阵

| 响应 | 轮询 | 已加载正文 | 写控件/准备 | 页面文案 |
| --- | --- | --- | --- | --- |
| 401 | 停止 | 按现有会话安全流程处理 | 移除/终止未发送 | 登录已失效，安全 return_to |
| 403 | 停止 | 立即清除批次、Rows、Mapping、缓存 | 移除/终止未发送 | 当前无权查看或继续 |
| 404 | 停止 | 清除 | 移除 | 导入批次不存在或无权查看 |

## 8. 实施门禁矩阵

| Gate | 当前状态 | 阻断内容 | 通过证据 | 失败处置 |
| --- | --- | --- | --- | --- |
| BLOCKED_BY_MAPPING_TARGET_CATALOG | BLOCKED | 完整 TargetSelector、动态属性 Mapping、metadata 恢复、完整确认流 | 独立只读 API 规格获批；实现/权限/安全/测试通过；OpenAPI 更新 | 不得 seed/硬编码/测试数据/历史 Mapping 绕过 |
| PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED | REQUIRED，未验证 | 50×256 Rows 的实施验收；UI 是否开放 page_size=100 | 初渲染、翻页、横滚、sticky、展开、键盘、DOM、内存、读屏、1366、窄屏记录通过 | 停止验收，另立窗口化/轻量虚拟化任务；不截列、不引大型 Grid |

## 9. 稳定错误处置摘要

| 类别 | 页面状态 | 恢复 |
| --- | --- | --- |
| 文件存储/安全/资源失败 | FAILED 安全分类 | 刷新、request_id、允许时重新开始新流程 |
| Parser 失败 | FAILED Parser 分类 | 不伪造重试；按真实后续 API |
| Mapping preparation 失败 | PARSED + FAILED | Sheets/Rows 可读，Mapping 锁，管理员说明 |
| VERSION_CONFLICT | 冲突对话框 | 保留可恢复 dirty；重读并人工核对 |
| Mapping 字段 422 | 控件级/顶部安全问题 | 修正后以新操作保存 |
| Metadata/target invalid | Mapping 保留、preview 失效 | 重读；catalog 可用后标失效目标；重新保存/预览/确认 |
| 429 | 暂停 | 严格 Retry-After |
| RESULT_UNKNOWN | 独立 unknown 处置 | 只原 Key/endpoint/载荷重放，GET 辅助 |
| RECONCILIATION_REQUIRED | 后台协调处置页 | 刷新/联系管理员；无普通用户强制操作 |
