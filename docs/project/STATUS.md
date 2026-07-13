# 晨亿达ERP状态快照

最后更新时间：2026-07-14（Asia/Shanghai）

## 自动统计摘要

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 总代码量 | 17,969 行 | 沿用既有运行时源码口径；PHASE1-TASK06 净新增 1,633 行运行时/API/schema 源码，排除测试、migration、seed、依赖、构建缓存、生成物和文档 |
| 源码文件 | 61 | 既有 55 个基础上新增 Material API 五模块和共享 Validation 输入映射；测试文件另计 |
| 根仓库跟踪项 | 提交前动态值 | 本任务新增 API 模块、`0002`、快照、回滚和两份测试；仓库仍无 mode `160000` |
| 主要目录 | 4 类 | `chenyida_erp_app/`、`chenyida_erp_site/`、`物料主数据治理落地包/`、`docs/` |
| 数据库实现 | 2 | 本地 SQLite、在线 Cloudflare D1 |
| 数据表 | 48（开发 schema） | 本地 SQLite 26；在线既有 D1 8；V2 12；Material API 安全表 2；未执行生产迁移，不能理解为生产现状 |
| 在线 API 路径 | 59 | 既有 54 个具体路径加本任务已实现的 5 个 Material 路由；生产公开站点尚未部署本提交 |
| 页面入口 | 3 | 本地 `static/index.html`、在线 `app/page.tsx`、在线 `public/erp/index.html` |
| 测试与安全检查文件 | 17 | 新增 Material API migration 与 API 集成测试各 1 份；既有 smoke/安全脚本同步扩展 |

## 当前版本与环境

| 项目 | 当前值 |
| --- | --- |
| 根仓库 Branch | `main` |
| PM-000 前根提交 | `bbefb2e388323213b51531fec117d67d5a28fe70` |
| Site 开发基线 | `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`；已作为普通目录纳入根仓库 |
| 生产 Site | active / public / v3 |
| 生产源码提交 | `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12` |
| PowerShell | 5.1.26100.8655 |
| Git | 2.52.0.windows.1 |
| Node.js | 26.3.0 |
| npm | 11.16.0 |
| 项目绑定 Python | 3.12.13 |
| 系统 `python` 命令 | 2.7.18，不适用于当前 ERP；启动脚本使用项目绑定 Python 3.12.13 |
| 环境配置 | `development` / `test` / `production`；生产地址运行时注入，不在代码硬编码 |
| 默认测试数据库 | 本机一次性 Miniflare D1；远程绑定关闭，结束后销毁 |

## Git 状态

`PHASE1-TASK06` 实施开始时，根仓库 `main` 位于设计提交 `e55318c`，工作区干净；`chenyida_erp_site/` 不是嵌套仓库。实现提交消息为 `feat: add material draft and review api`，实际哈希以 `git log -1` 为准。

转换前，`git ls-files --stage -- chenyida_erp_site` 只显示一个 mode `160000` gitlink。转换后，根仓库直接跟踪 Site 的 77 个 mode `100644` 文件，仓库中不再存在 mode `160000`。暂存 Site 子树 hash `541decf5a685a0efc238868ef958d3ae500174e5` 与原 `9f2c2dc` tree 完全一致。

`PHASE1-TASK06` 第一阶段设计提交为 `e55318c docs: design material draft and review api`；第二阶段实现不创建生产版本、不推送、不部署。

实时状态必须使用：

```powershell
git status --short
git -C chenyida_erp_site status --short
```

## 统计复现方式

1. 使用 `rg --files` 获取两个运行面的源码文件。
2. 排除 `data/`、`node_modules/`、`.next/`、`dist/`、`.wrangler/`、生成物和嵌套仓库中的重复导入目录。
3. 代码扩展名：`.py`、`.ps1`、`.ts`、`.tsx`、`.js`、`.mjs`、`.html`、`.css`、`.sql`。
4. API 统计从在线集中式处理器提取具体 `/api/...` 字符串并去重。
5. 数据表统计来自本地 `server.py` 建表语句及在线 `db/schema.ts`。

## 下次更新触发条件

- 任务状态或 Branch 变化
- 新提交、发布或生产 Site 版本变化
- 数据库迁移或表数量变化
- API、页面、测试或主要目录变化
- 统计口径变化

## PHASE1-TASK06 Draft/Review API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 项目负责人已确认八项业务/安全选择；实现、测试和项目文档完成，等待功能提交后人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | `docs/material-master/draft-review-api-v1.md` 已记录确认选择和实施结果 |
| 认证边界 | VERIFIED | 复用 `app_users`/`app_sessions` 和服务端会话 actor；未使用未接入 ERP 的 ChatGPT Header 身份；禁止客户端伪造操作者 |
| 授权边界 | PASS | admin/manager 审核，purchase/engineering 创建，其他角色只读；所有角色包括 admin 禁止自审 |
| CSRF | PASS | 登录轮换 host-only 双提交 Token；Material POST 严格验证同源 Origin、Cookie/Header，Session Cookie 继续 HttpOnly |
| 幂等与限流 | PASS | 专用持久表保存 canonical 请求摘要、租约和 24 小时结果；完成/成功审计与业务 batch 原子提交；60 次写/20 个新 Key，测试可降低阈值 |
| Query | PASS | 列表默认 20/最大 100；详情当前 metadata 校验、分类路径、版本和变更日志均有界分页 |
| Migration | PASS | `0002` Up/Down、schema、snapshot/journal、已有数据升级、约束、防重、空状态回滚和重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 新增 5 路由、Material API 五模块、共享 Validation 映射、2 张安全表和审计扩展；未开发页面或下游业务 |
| Site 基线 | PASS | build 成功；Node 58/58；lint 0 error/1 个既有 warning；一次性 D1 登录/CSRF/API smoke 和凭证检查通过 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite `go_live_check --no-backup` 通过 |
| 差异检查 | PASS | `git diff --check` 通过；敏感正文、原始 Key、Session/CSRF Token 不进入 Material 审计或错误响应 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK05 草稿创建与审核写服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-13 完成实现、验证、文档和独立功能提交 |
| 模块边界 | PASS | Types、D1 Repository、Draft Service、Review Service、Code Service 和统一导出保持独立；PHASE1-TASK06 通过受信适配调用，未复制业务规则 |
| 创建草稿 | PASS | Validation 无 ERROR 后原子写 `DRAFT`、类型化属性、`CREATE` 版本和 `CREATE_DRAFT` 审计；正式编码为空 |
| 批准启用 | PASS | 从 D1 重载并重新校验；单一 batch 原子领取序号、转 `ACTIVE`、写编码/批准信息、`APPROVE` 版本及两条审计 |
| 拒绝 | PASS | 保持 `DRAFT`、version + 1、追加 `REJECT` 版本和审计；不读取或消耗编码规则 |
| 属性存储 | PASS | 按 definition 类型列保存 TEXT/ENUM/INTEGER/DECIMAL/BOOLEAN，DECIMAL 精确缩放；保留 unit、source_type、source_ref、created_by/created_at |
| 并发与编码 | PASS | 同草稿双审核一成功一版本冲突；同规则双草稿读取同一旧序列后 CAS 重试并生成不同编码；唯一索引竞争路径跳过占用序号 |
| 规则漂移保护 | PASS | 创建和批准均比较 metadata/属性守卫；校验后品类/属性规则变化时事务冲突回滚 |
| 事务回滚 | PASS | 故障注入使最后一条编码审计失败，规则、物料状态、版本和审计全部保持事务前值 |
| 服务测试 | PASS | 新增 12/12 隔离 D1 场景；完整 Node 52/52 |
| Site 基线 | PASS | build 成功；lint 0 error/1 个既有 warning；隔离 API smoke、176 文件凭证检查和 `git diff --check` 通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍为既有 Drizzle 自引用类型错误 |
| 数据库/API 变化 | NONE | 未修改 schema、migration、API、页面、导入、BOM、采购、库存或生产 |
| 生产影响 | NONE | 未连接生产 D1，未迁移真实数据，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无多角色节点、草稿编辑/重新提交、API 权限/幂等；拒绝状态复用 `DRAFT`；编码规则仍需后续受控初始化 |

## PHASE1-TASK04 物料校验服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-12 完成实现、验证、文档和独立功能提交 |
| 设计审批 | PASS | 采用 Repository + Rules + Service；D1 metadata 是运行时分类和属性规则唯一来源 |
| 接口边界 | PASS | attributes 按稳定大写 attribute code 索引；禁止 attribute_id；保留 source/confidence 扩展字段 |
| 服务实现 | PASS | Types、D1/Memory Repository、Rules、Service 和统一导出已完成；25 个结构化 code 中 24 ERROR、1 WARNING |
| Metadata 变化 | PASS | 隔离 D1 中标准单位、枚举、必填、属性定义/绑定/分类状态变化均在下一次校验生效 |
| 校验测试 | PASS | 新增 22 个顶层测试和 6 个子测试，共 28/28；Memory Repository 与指定 FR4/电阻/锡膏矩阵通过 |
| Site 基线 | PASS | build 成功；Node 40/40；lint 0 错误/1 个既有警告；隔离 API 烟测和凭证检查通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍有 PHASE1-TASK02 已记录的 Drizzle 自引用类型错误 |
| 业务变化 | NONE | 未修改 API、页面、迁移、真实物料或 BOM/采购/库存 |
| 生产影响 | NONE | 未连接生产 D1，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无品牌字典、不做单位数值换算、不支持 DATE、不检测跨物料冲突，source/confidence 暂不参与决策 |

## PHASE1-TASK03 分类与属性模板状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 分类数据 | PASS | 101 个节点、5 个一级分类、39 个四级叶子；父子级别连续 |
| 属性定义 | PASS | 34 个复用定义；覆盖 TEXT、INTEGER（NUMBER 语义）、DECIMAL、BOOLEAN、ENUM 与要求单位 |
| 属性绑定 | PASS | 228 条绑定全部指向四级叶子；叶子 39/39 均有完整模板，不存在父级继承 |
| Seed 幂等 | PASS | 首次写入后第二次 inserted 为 0，记录总数不变并输出 updated 统计 |
| 环境保护 | PASS | 仅接受 test/local；production 和 `--remote` 在数据库访问前拒绝 |
| 数据库影响 | NONE | `0001` migration、schema 和快照未修改；未连接生产 D1 |
| Site 基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 12/12（包含 migration）通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 本任务新增文件无类型错误；`db/schema.ts` 第 129、243 行存在 PHASE1-TASK02 已有的 Drizzle 自引用类型错误 |

## PHASE1-TASK02 Schema 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 目标运行面 | CONFIRMED | 仅在线 Site/D1 schema；本地 SQLite 未修改 |
| 设计审批 | PASS | 已吸收正式编码审核后生成、生命周期、变更日志、供应商五要素时效唯一性和应用层校验调整 |
| 数据库变化 | IMPLEMENTED | 新增 12 张 V2 表的 Drizzle schema、`0001` Up/Down、snapshot 和 journal |
| 业务变化 | NONE | 未修改 BOM、采购、库存、生产、导入、AI、API 或页面 |
| 数据操作 | NONE | 未连接生产 D1，未迁移真实数据，未创建生产表 |
| 隔离迁移 | PASS | 空库 Up、防重、结构/约束、Down、重建通过；临时 D1 已清理 |
| 完整基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 9/9；隔离 API 烟测、本地三项临时基线、凭证扫描和 `git diff --check` 通过 |

## PHASE0-TASK02 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Site 环境守卫 | PASS | Node 6/6；production、公开 URL、非临时 D1 路径和非法环境名均拒绝 |
| 本地环境守卫 | PASS | Python 4/4；production/development 在数据库创建前拒绝 |
| 一次性 D1 API 烟测 | PASS | 完成合成写入、备份、恢复与错误提示验证；测试后数据库目录和进程均清理 |
| production 入口拒绝 | PASS | 退出码 1，未创建新临时目录 |
| 凭证检查 | PASS | `.env` 未跟踪；仓库文件、常见令牌格式和 hosting 键检查通过 |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时 SQLite |
| `smoke_test.py` | PASS | 输出 `SMOKE_TEST_OK`，数据库和备份均位于临时目录 |
| `backup_restore_test.py` | PASS | 创建、恢复、非法名称提示和最终数据清理通过 |
| `go_live_check.py --no-backup` | PASS | 使用临时 SQLite；未写正式数据或备份 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告 |
| `npm test` | PASS | 构建成功，Node 测试 8/8 通过；沙箱缓存写入限制下获准在沙箱外重跑 |
| `npm run build` | PASS | 最终独立构建通过，未连接数据库或网络 |
| 最终仓库检查 | PASS | 149 个仓库文件凭证扫描通过；`git diff --check` 无空白错误；代码中无生产地址硬编码 |

任务没有创建云端 D1、连接生产 D1、修改生产数据、保存 Site 版本或执行部署。

## PHASE0-TASK01-B 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时数据库 |
| `go_live_check.py --no-backup` | PASS | 数据库检查通过；本地服务未启动，不要求在线健康检查 |
| `smoke_test.py` | FAIL（既有环境问题） | 临时测试进行到备份创建时返回 `unable to open database file`；与 PM-000 基线一致，未接触生产数据 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告，位于 Site 中此前合入的治理工具 |
| `npm test` | PASS | 沙箱内首次因 Vite 无权写 `node_modules/.vite-temp` 失败；按环境规则在沙箱外重跑后构建成功，渲染测试 2/2 通过 |
| Site tree 对比 | PASS | 纳管后的暂存子树 hash 与原 `9f2c2dc` tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5` |
| Git 索引检查 | PASS | `chenyida_erp_site` 显示 77 个普通文件，仓库无 mode `160000` |
| 新 clone 恢复 | PASS | 使用 `git clone --no-local` 创建全新工作区；Site 为 77 个普通文件、0 个 gitlink，关键源码和文档完整存在，工作区干净 |
| 新 clone 依赖与测试 | PASS | Site 执行 `npm ci --offline` 安装 502 个包且 0 漏洞；`npm test` 构建成功、2/2 通过；本地 ERP `--self-test` 输出 `SELF_TEST_OK` |
| `git diff --check` | FAIL（继承内容） | 报告原 `9f2c2dc` tree 中既有的行尾空白和 EOF 空行；为保持 Site tree 完全一致，本任务未修改这些文件 |
| 在线 `erp-api-smoke.mjs` | NOT RUN | 脚本会写数据且尚无生产地址拒绝，禁止对公开生产 Site 执行 |

测试前后 `chenyida_erp_app/data/erp.sqlite3` 均为 233,472 字节，最后修改时间戳保持不变，本任务未修改正式本地数据库。
