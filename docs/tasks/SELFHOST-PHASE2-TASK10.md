# SELFHOST-PHASE2-TASK10：经营看板、备份恢复治理与 legacy iframe 退出

状态：`DONE`（非生产；未发布、未部署、未迁真实数据）

开始日期：2026-07-25（Asia/Shanghai）

## 起始基线

- Branch `main`；Task start HEAD `06a4413403869f4f41872c7a5cb98c434a44f095`（`feat: add self-hosted finance management`），工作区 clean。
- 包版本 `0.1.0-alpha.9`；PostgreSQL migration `0001`—`0013`。
- TASK02—TASK09 已分别独立提交并完成非生产验收；真实数据、生产部署和切换均未执行。

## 目标

1. 新建独立 Dashboard Query Service，从 TASK02—TASK09 权威关系表实时生成 `/api/summary` 与 `/api/management-dashboard`，不复制业务事实、不读取 legacy `erp_records`。
2. 新建原生根工作台，直接完成 setup/login/session/must-change/logout、经营指标、风险、模块入口和备份治理状态；根页不再加载 iframe。
3. 保留 `/erp/index.html` 作为显式 legacy 业务工作区和回滚来源，并支持受控 tab 深链；它不再是根页默认运行依赖。
4. 强化离线备份、校验和新空目标恢复脚本与文档；浏览器只读显示治理状态，不提供创建备份或原地恢复 API。

## 权限与披露

- 当前全部固定业务角色保留 `dashboard.read`，与既有跨域只读权限一致；指标按服务端固定合同返回，不接受浏览器指定 SQL、表或字段。
- 只有 admin 拥有 `system.backup.read`，可读取不含绝对路径、数据库 URL 或凭证的备份治理状态。
- 最近系统审计只在 actor 具备既有 `system.audit.read` 时返回；其他角色只得到空列表，不因看板绕过系统审计权限。

## 数据与恢复边界

- Dashboard 使用 PostgreSQL `numeric` 聚合并以字符串输出金额/数量；异单位库存不相加，只返回余额记录数、冻结记录数等可解释指标。
- TASK10 不新增 Dashboard projection/outbox，因此不创建 `0014`；`db/schema.ts` 与 `0001`—`0013` 不变。
- 备份制品必须包含 PostgreSQL custom dump、uploads、attachments、UTC 时间、manifest 和 SHA-256；校验通过不等于已完成恢复演练。
- 恢复只允许全新空数据库和空文件目录；禁止浏览器原地覆盖、drop/truncate 当前数据库或自动开放流量。

## 验收

- 覆盖空库/合成全域数据、权限裁剪、精度、风险、审计隐藏、备份状态文件校验和安全错误。
- 根页源码/构建产物不含 iframe；未登录、setup、must-change、已登录、错误、空数据和模块深链均有确定状态。
- 备份脚本覆盖成功、现有输出拒绝、损坏 checksum/危险 tar 拒绝、非空目标拒绝与新空目标恢复；全部使用隔离 PostgreSQL 和临时目录。
- Compose 空卷启动、Dashboard、离线 backup→新空目标 restore、Web/Worker 重启持久性通过。
- 运行 lint、build、凭证扫描、环境守卫、适用业务回归、Python 三项基线和 `git diff --check`。

## 禁止事项

- 不迁真实数据，不访问生产，不执行生产备份或恢复，不部署、不切流、不 push、不创建 PR。
- 不删除 legacy 静态源码、Python/SQLite 或历史 Sites/D1 证据；不双写，不补做 TASK02—TASK09 业务规则。
- 不在浏览器暴露数据库 URL、文件绝对路径、备份制品内容、凭证或原地恢复能力。

完成结果与完整验收证据见 `SELFHOST-PHASE2-TASK10-completion.md`；任务独立提交消息为 `feat: add self-hosted operations workbench`，实际哈希以 `git log` 为准。
