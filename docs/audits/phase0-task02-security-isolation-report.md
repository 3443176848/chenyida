# PHASE0-TASK02 开发测试生产隔离与安全基线报告

审计日期：2026-07-11（Asia/Shanghai）

## 1. 当前风险

任务开始时存在以下风险：

- 在线 `erp-api-smoke.mjs` 可接受任意 `ERP_TEST_URL`，会执行账号、导入、库存、生产、销售、财务和备份恢复写操作，没有生产 URL 拒绝。
- Site 烟测没有自动创建、销毁隔离 D1，也没有失败清理机制。
- 本地烟测的 SQLite 主库已使用临时路径，但备份仍指向正式本地数据目录，曾导致验证失败和测试备份残留风险。
- 环境只有零散变量，没有统一列出数据库、API、Site、日志级别和调试模式。
- `.env.example` 只描述初始化令牌，缺少环境识别；没有自动凭证与托管配置检查。
- 公开 Site 的同库备份仍位于同一 D1 故障域；本任务只能在隔离测试库验证函数行为，不能把它认定为生产灾备。
- 本地旧版仍包含固定默认账号和密码，虽仅用于本地兼容运行，仍不得用于生产。

## 2. 修改内容

- 新增 `config/environments.json`，统一声明 `development`、`test`、`production`。
- 扩充根目录和 Site 的 `.env.example`，并加强根 `.gitignore`。
- 新增 Site 环境守卫、凭证扫描、环境单元测试和一次性 D1 烟测运行器。
- 修改 Site 本地 Vite 配置：测试 D1 必须位于系统临时目录，Cloudflare 远程绑定固定关闭，测试时禁用项目 `.env` 加载。
- 给烟测合成数据增加 `TEST-` 标识；直接运行烟测也必须先通过环境守卫。
- 为本地 SQLite 增加可配置数据目录和测试守卫；新增环境测试与备份恢复测试，不修改备份业务函数。
- 更新 README，并新增 `docs/testing/test-environment.md` 和本报告。

没有修改 ERP 业务功能、物料模块、数据库业务结构、迁移或生产数据。

## 3. 环境结构

| 环境 | Site 数据库 | 地址策略 | 日志/调试 |
| --- | --- | --- | --- |
| development | 项目内本地 Miniflare D1 | 固定本机开发地址 | `debug` / 开启 |
| test | 每次运行新建的临时 Miniflare D1 | 动态 HTTP 回环地址 | `info` / 关闭 |
| production | 托管控制面注入的逻辑 D1 绑定 | API/Site 地址必须运行时注入 | `warn` / 关闭 |

本任务未创建远程 Test D1。未来流程已记录，但默认入口仍为本机一次性 D1。

## 4. 安全措施

- 默认拒绝：测试只接受 `ERP_ENV=test`、HTTP 回环地址和带测试标识的系统临时目录。
- 双重保护：烟测入口和 Vite D1 配置分别校验临时路径；任一失败都在危险操作前退出。
- 远程隔离：本地 Cloudflare 插件设置 `remoteBindings: false`。
- 凭证隔离：测试禁用项目 `.env` 读取，随机凭证只传给本次子进程。
- 数据清理：成功和失败都停止进程并删除完整 D1 目录；不新增删除/批量清理 API。
- 日志去敏：失败日志不保留数据库、正文、授权头、Cookie、密码或令牌。
- Git 检查：拒绝跟踪 `.env`、私钥、数据库、备份、日志和常见令牌格式；托管配置只允许 `project_id`、`d1`、`r2`。
- 生产拒绝验证：以 `ERP_ENV=production` 启动烟测时退出码为 1，临时目录数量不增加。

## 5. 测试结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Site 环境保护测试 | PASS | 6/6；覆盖三环境字段、production、公开 URL、非临时 D1 路径和非法环境名 |
| Python 环境保护测试 | PASS | 4/4；production/development 拒绝发生在数据库创建前 |
| 凭证和 hosting 配置检查 | PASS | 扫描 149 个已跟踪或待提交文件，未发现真实凭证或危险文件 |
| 一次性 D1 API 烟测 | PASS | 在本机 Miniflare D1 完成写入、备份、恢复和失败提示验证，随后销毁数据库 |
| production 烟测入口拒绝 | PASS | 退出码 1，未创建新临时目录 |
| `server.py --self-test` | PASS | `SELF_TEST_OK`，使用临时 SQLite |
| `smoke_test.py` | PASS | `SMOKE_TEST_OK`，数据库和备份均位于临时目录 |
| `backup_restore_test.py` | PASS | 创建、恢复、非法名称提示和最终清理通过 |
| `go_live_check.py --no-backup` | PASS | 使用临时 SQLite；未要求服务运行，未创建正式备份 |
| `npm run lint` | PASS with warning | 0 错误；1 个既有未使用变量警告，不在本任务范围 |
| `npm test` | PASS | 构建成功，Node 测试 8/8 通过；沙箱首次阻止 Vite 缓存写入，获准在沙箱外重跑通过 |
| `npm run build` | PASS | 最终独立构建完成；未连接数据库或网络 |
| `git diff --check` | PASS | 无新增空白错误；仅显示 Windows 行尾转换提示 |
| 生产地址硬编码检查 | PASS | Python/JavaScript/TypeScript/JSON 代码和配置中未发现生产 Site 地址 |
| 临时状态检查 | PASS | 无 `chenyida-erp-test-*` 临时目录，无残留 Node/workerd/Python 测试进程 |

最终验证未访问生产 URL、生产 D1、托管 API 或部署入口。

## 6. 剩余风险

- 尚未建立远程 Test D1；因此没有覆盖真实远程 D1 的权限、延迟、配额和网络行为。
- 生产 Site 的同库快照不能替代外部灾备，生产级备份和恢复演练需要单独授权与后续任务。
- 本地旧版固定默认账号仍存在，只允许兼容和迁移用途；生产账号生命周期治理未在本任务修改。
- Site API 仍包含运行时建表和集中式业务处理器，迁移权威与模块边界需由后续任务处理。
- 失败日志虽已去敏，仍需按团队保留期限定期删除被忽略的 `work/test-logs/`。

结论：当前开发和自动化测试已有可执行的本机数据库隔离与生产拒绝基线；本任务没有访问、修改或部署生产环境。
