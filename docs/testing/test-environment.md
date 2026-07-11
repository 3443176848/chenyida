# 测试环境与数据管理基线

适用任务：`PHASE0-TASK02`。本基线只允许本机一次性测试数据库，不创建云端 D1，不连接生产 D1，不部署 Site。

## 环境识别

统一非敏感配置位于 `config/environments.json`，支持以下三个环境：

| 环境 | 数据库连接 | API 地址 | Site 地址 | 日志级别 | 调试模式 |
| --- | --- | --- | --- | --- | --- |
| `development` | 项目内 Miniflare D1：`chenyida_erp_site/.wrangler/state` | `http://127.0.0.1:3000/api` | `http://127.0.0.1:3000` | `debug` | 开启 |
| `test` | 操作系统临时目录中的一次性 Miniflare D1 | 运行时分配的 HTTP 回环端口 `/api` | 运行时分配的 HTTP 回环地址 | `info` | 关闭 |
| `production` | Sites 管理的逻辑绑定 `DB`；仓库不保存数据库 ID | 运行时必须注入 `ERP_API_URL` | 运行时必须注入 `ERP_SITE_URL` | `warn` | 关闭 |

生产 URL 不写入代码。根目录和 Site 目录的 `.env.example` 仅提供本机值与凭证占位符；真实 `.env` 被 Git 忽略。

## Site 测试数据库创建

执行 `chenyida_erp_site` 下的 `npm run test:api` 时：

1. 若显式设置的 `ERP_ENV` 不是 `test`，在创建目录和网络请求前拒绝运行。
2. 运行器在操作系统临时目录创建带 `chenyida-erp-test-` 标识的唯一目录。
3. 自动分配空闲本机端口，并将 `ERP_D1_PERSIST_PATH` 指向该临时目录下的 `d1`。
4. Vite/Cloudflare 本地插件使用 `persistState` 连接该路径，并设置 `remoteBindings: false`。
5. 测试期间禁用从项目 `.env` 加载 Cloudflare 开发凭证，初始化令牌和管理员密码只在当前子进程环境中随机生成。

守卫只接受 `ERP_ENV=test`、`http://localhost`/`http://127.0.0.1`/`http://[::1]` 和系统临时目录。HTTPS、公开主机、production 环境或项目内持久化目录都会被拒绝。

## 数据初始化与来源

- D1 表由现有 API 初始化流程在空数据库中创建；本任务不修改 schema 或迁移。
- 管理员由烟测使用本次运行随机生成的一次性初始化令牌创建。
- 烟测数据由 `tests/erp-api-smoke.mjs` 内的合成数据生成，业务可识别字段统一采用 `TEST-` 前缀，例如 `TEST-MATERIAL-001`、`TEST-PRODUCT-*` 和 `TEST-IMPORT-*`。
- 禁止把生产导出、客户资料、供应商个人信息或真实账号密码作为测试种子。

## 自动清理与失败日志

运行器在 `finally` 阶段先停止本地 Site，再验证临时目录名称带测试标识，最后递归删除整个目录。测试成功和失败都执行同一清理，因此无需增加可能误触生产的“批量清理测试数据”API。

失败时只在被 Git 忽略的 `chenyida_erp_site/work/test-logs/` 保存去敏运行诊断。日志删除令牌、密码、授权头和 Cookie，不保存 D1 文件、请求正文、响应正文或业务快照。数据库销毁失败视为测试失败，必须人工清理并记录。

## 本地 SQLite 测试

本地 ERP 的自测和烟测使用 `CYD_ERP_DATA_DIR`、`CYD_ERP_DB` 指向带 `chenyida-erp-test-` 标识的系统临时目录。显式 `development` 或 `production` 环境会被测试守卫拒绝。

`backup_restore_test.py` 在临时 SQLite 上验证：

- 可以创建非零字节备份；
- 可以把测试数据库恢复到备份时点；
- 非法备份文件名返回明确中文错误；
- Windows 文件句柄释放后重试清理，最终不得保留数据库或备份。

现有备份创建和恢复函数未修改；只增加了数据目录的环境配置入口，保证验证不会写入正式本地数据目录。

## 验证命令

```powershell
cd D:\erp\chenyida_erp_site
npm run test:environment
npm run security:credentials
npm run test:api
npm run lint
npm test
npm run build
```

```powershell
cd D:\erp\chenyida_erp_app
$py='C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py environment_guard_test.py
& $py server.py --self-test
& $py smoke_test.py
& $py backup_restore_test.py
```

`go_live_check.py` 在自动化验证中也必须通过 `ERP_ENV=test`、临时 `CYD_ERP_DATA_DIR` 和临时 `CYD_ERP_DB` 执行；使用 `--no-backup`，不得检查或修改正式数据库。

## 恢复方式

一次性 D1 不做跨测试保留。失败后的恢复方式是根据去敏日志修复问题并重新运行，运行器会创建全新空库。备份恢复能力在同一次性库内验证，测试结束后备份和数据库一起销毁。

## 未来远程 Test D1 流程（本任务不执行）

未来只有获得项目负责人明确授权后，才能建立远程 Test D1：

1. 在与生产可明确区分的测试项目中创建独立 D1，使用独立资源名称、访问权限和预算。
2. 记录测试数据库责任人、资源 ID、迁移版本、数据保留期和销毁流程；资源 ID 不写入公开源码。
3. 只在测试控制面注入 `ERP_ENV=test`、测试 Site/API 地址和测试凭证，不复用生产令牌或生产初始化凭证。
4. 扩展守卫为显式测试主机允许列表；默认仍拒绝所有远程 URL，生产主机永久列入拒绝集合。
5. 先用空库执行版本化迁移，再导入纯合成 `TEST-` 数据；禁止复制生产数据。
6. 建立按测试批次清理、过期自动销毁、失败告警和审计记录。
7. 备份恢复只能恢复到该 Test D1，不得把测试备份导入生产。
8. 完成生产拒绝、权限隔离和清理演练后，才可把远程测试作为可选入口；本机一次性 D1 继续作为默认基线。
