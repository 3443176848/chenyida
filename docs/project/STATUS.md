# 晨亿达ERP状态快照

最后更新时间：2026-07-11（Asia/Shanghai）

## 自动统计摘要

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 总代码量 | 13,575 行 | 只统计本地 ERP 与在线 Site 的源码；排除 `node_modules`、数据库、构建缓存、生成物、文档及嵌套仓库中的重复导入树 |
| 源码文件 | 40 | 同上口径；本地 11，在线 29 |
| 根仓库跟踪项 | 137 | 原 60 项中移除 1 个 gitlink，加入 Site 的 77 个普通文件，并新增 1 份任务审计报告；根仓库已无 mode `160000` |
| 主要目录 | 4 类 | `chenyida_erp_app/`、`chenyida_erp_site/`、`物料主数据治理落地包/`、`docs/` |
| 数据库实现 | 2 | 本地 SQLite、在线 Cloudflare D1 |
| 数据表 | 34 | 本地 SQLite 26；在线 D1 8；两套模型不等价，不能直接相加理解为统一 schema |
| 在线 API 路径 | 54 | `app/lib/erp-api.ts` 中具体 `/api/...` 路径去重，排除仅用于前缀判断的 `/api/financial-` |
| 页面入口 | 3 | 本地 `static/index.html`、在线 `app/page.tsx`、在线 `public/erp/index.html` |
| 测试文件 | 5 | 本地 3 个测试/检查文件，在线 2 个测试文件；`server.py --self-test` 为内置入口，未另计文件 |

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

## Git 状态

`PHASE0-TASK01-B` 开始时，根仓库 `main` 位于 `a1a8d6a`，工作区干净并比 `origin/main` 超前 1 个提交；Site 嵌套仓库 `main` 位于 `9f2c2dc`，工作区干净且没有远端配置。

转换前，`git ls-files --stage -- chenyida_erp_site` 只显示一个 mode `160000` gitlink。转换后，根仓库直接跟踪 Site 的 77 个 mode `100644` 文件，仓库中不再存在 mode `160000`。暂存 Site 子树 hash `541decf5a685a0efc238868ef958d3ae500174e5` 与原 `9f2c2dc` tree 完全一致。

任务提交采用两个父节点：第一父节点连接根仓库 `a1a8d6a`，第二父节点连接 Site 开发基线 `9f2c2dc`。生产提交 `2b4f178` 是 `9f2c2dc` 的祖先，因此生产和开发来源均可从根仓库提交图追溯。

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
