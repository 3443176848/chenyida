# PHASE0-TASK01-B Site 源码管理修复报告

## 任务范围

- 任务编号：`PHASE0-TASK01-B`
- 任务名称：解除 Site gitlink 并纳入根仓库管理
- 执行日期：2026-07-11（Asia/Shanghai）
- 提交消息：`fix: convert site gitlink to tracked source`
- 目录决策：保留 `chenyida_erp_app/` 和 `chenyida_erp_site/`，不重命名为 `backend/`、`frontend/`

本任务只修复源码管理结构。未修改 Site 的 app、db、worker、API、页面、数据库 schema、迁移、业务逻辑或生产环境。

## gitlink 问题原因

任务开始时，根仓库只记录以下索引项：

```text
160000 9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9 0 chenyida_erp_site
```

`git ls-files chenyida_erp_site` 只返回目录名，未返回目录内源码。仓库不存在 `.gitmodules`，执行 `git submodule status` 返回：

```text
fatal: no submodule mapping found in .gitmodules for path 'chenyida_erp_site'
```

本机 `chenyida_erp_site/.git/` 中虽然存在完整对象，但没有配置远端地址。根仓库克隆后既无法根据 `.gitmodules` 初始化子模块，也无法知道应从何处下载 Site 源码，因此 mode `160000` 条目不可恢复。

## 修复方式

1. 确认根仓库和 Site 工作区均干净。
2. 记录根仓库 gitlink、Site 当前提交和 77 个跟踪文件。
3. 从本机 Site 仓库把 `main` / `9f2c2dc` 的对象导入根仓库。
4. 以 `9f2c2dc` 作为最终任务提交的第二父节点，使 Site 主线历史进入根仓库可达提交图。
5. 从根索引移除 mode `160000` 条目，仅删除 `chenyida_erp_site/.git/` 元数据目录，不删除 Site 工作区或源码。
6. 把原 Site tree 的 77 个文件作为 mode `100644` 普通文件加入根仓库。
7. 保留 Site 自身 `.gitignore`，继续排除 `.env`、`node_modules/`、`.vinext/`、`.wrangler/`、`dist/` 和 `work/`。

## 文件变化

Git 结构变化：

- 删除：根索引中的 1 个 `chenyida_erp_site` gitlink。
- 新增：`chenyida_erp_site/` 下 77 个普通跟踪文件。
- 根仓库跟踪项：从 60 项变为 137 项，其中源码结构转换净增加 76 项，并新增本任务审计报告 1 项。
- mode `160000`：从 1 项变为 0 项。
- Site 内容完整性：暂存子树与原 `9f2c2dc` tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5`。

文档变化：

- `README.md`
- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/ARCHITECTURE.md`
- `docs/project/DECISIONS.md`
- `docs/project/STATUS.md`
- `docs/project/CHANGELOG.md`
- 本报告

未修改任何 Site 源码文件内容。Git 把文件从“嵌套仓库中的跟踪文件”表示为“根仓库中的新增普通文件”，但新旧 Site tree hash 完全相同。

## Commit 关系

```text
根仓库第一父提交 a1a8d6a
               \
                fix: convert site gitlink to tracked source
               /
Site 开发基线 9f2c2dc
  ├─ 第一父提交 2b4f178（当前生产 Site v3 对应源码）
  └─ 第二父提交 7748ade（既有公开仓库历史）
```

- 当前生产 Site：`2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`
- 纳入根仓库前的当前开发 Site：`9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`
- `2b4f178` 是 `9f2c2dc` 的祖先。
- 对 app、db、drizzle、public、worker、tests、构建配置及 hosting 配置比较，两者运行时代码无差异。
- 本任务没有创建、保存或部署新的生产 Site 版本。

## 测试结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 根仓库与 Site 转换前状态 | PASS | 两个工作区均干净；根仓库 `main` 为 `a1a8d6a` |
| 转换后 `git ls-files` | PASS | Site 下 77 个普通文件，全部 mode `100644`；无 mode `160000` |
| Site 目录与关键文件 | PASS | 目录存在，`app/`、`db/`、`worker/`、`public/`、`tests/`、`package.json` 均存在 |
| Site tree 完整性 | PASS | 纳管前后 tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5` |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时数据库 |
| `go_live_check.py --no-backup` | PASS | 本地数据库基线检查通过，未要求连接运行中服务 |
| `smoke_test.py` | FAIL（既有环境问题） | 创建临时备份时返回 `unable to open database file`；与 PM-000 基线一致，正式数据库大小和时间戳未变化 |
| `npm run lint` | PASS with warning | 0 错误；1 个既有未使用变量警告 |
| `npm test` / Site 构建 | PASS | 沙箱内首次因 `.vite-temp` 写权限失败；提升权限重跑后构建成功，测试 2/2 通过 |
| `tests/erp-api-smoke.mjs` | NOT RUN | 该脚本会写业务数据，当前尚无隔离 D1 和生产地址拒绝保护，不对生产 Site 执行 |
| 新 clone 恢复 | PASS | `git clone --no-local` 后 Site 为 77 个普通文件、0 个 gitlink；关键 app、db、worker、tests 和文档完整存在，Site 的 Git 顶层为根仓库 |
| 新 clone 依赖恢复 | PASS | 在克隆目录执行 `npm ci --offline`，安装 502 个包，审计结果为 0 漏洞 |
| 新 clone 测试 | PASS | 克隆目录内 `npm test` 构建成功、2/2 通过；本地 ERP `server.py --self-test` 输出 `SELF_TEST_OK` |
| `git diff --check` | FAIL（继承内容） | 报告原 `9f2c2dc` tree 中既有的行尾空白和 EOF 空行；为保持 Site tree hash 不变，本任务未修正这些文件 |

## 剩余风险

1. `smoke_test.py` 的临时备份目录错误仍存在，属于既有测试环境问题，不由本次源码管理任务修改。
2. `erp-api-smoke.mjs` 尚未具备隔离 D1 和生产地址拒绝保护，应由 `PHASE0-TASK02` 处理。
3. 生产 Site 仍为 `v3` / `2b4f178`，开发基线为 `9f2c2dc`；虽运行时代码一致，仍需在 `PHASE0-TASK03` 建立统一发布、迁移和回退记录。
4. Site tree 中包含此前合入的本地 ERP 与治理资料副本。本任务按“不删除 Site 内部代码和文件”要求完整保留，未做去重；后续如需清理必须单独审计和授权。
5. 原 Site tree 中部分文档、脚本和 CSV 存在 `git diff --check` 行尾告警；本次为保证逐字节纳管未修改，后续可在独立格式化任务中处理。
