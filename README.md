# 晨亿达 ERP 项目

这是深圳市晨亿达电子有限公司 ERP 项目，覆盖物料主数据治理、产品/BOM、采购、库存、生产、询价报价、销售、财务、品质和系统运维。

## 项目结构

- `chenyida_erp_app/`：历史 Python/SQLite 业务参考和迁移来源，不再作为未来生产底座。
- `chenyida_erp_site/`：当前自托管应用，使用 Vinext/React/TypeScript、标准 Node.js、PostgreSQL、本地持久化文件和独立 Worker。
- `docs/`：项目管理、架构、审计和物料主数据规划文档。
- `物料主数据治理落地包/`：物料编码、字段、导入、审核和清洗资料。

`chenyida_erp_site/` 已作为普通目录由根仓库直接管理，不再是 gitlink 或子模块。新克隆根仓库后即可获得两个应用的完整源码，无需执行 `git submodule` 命令。

在线 Site 的版本关系：

- 当前生产 Site 源码提交：`2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`
- 纳入根仓库前的当前开发 Site 提交：`9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`

两个提交的 Site 运行时代码一致。本次源码管理调整不修改、发布或迁移生产 Site。

## 克隆与开发

```powershell
git clone https://github.com/3443176848/chenyida.git
cd chenyida
```

新开发只在 `chenyida_erp_site` 的自托管运行面进行。旧 D1/Cloudflare 和 Python/SQLite 实现仅用于行为核对与后续数据迁移：

```powershell
cd chenyida_erp_site
npm ci
npm test
```

## 环境配置与安全测试

复制 Site 的 `.env.example` 作为本机配置；真实 `.env`、令牌、密码、数据库和日志均被 Git 忽略。测试必须使用名称带 `test` 的独立 PostgreSQL 数据库和临时文件目录：

```powershell
cd chenyida_erp_site
npm test
npm run test:postgres
npm run security:credentials
```

旧 Miniflare/D1 测试仅作为 Cloudflare 历史回归保留，不是自托管验收入口。生产环境地址和凭证只允许由受控运行环境注入，不得写入源码或 `.env.example`。

## 快速启动

进入 `chenyida_erp_site`，复制并安全填写 `.env.example`，再运行 `docker compose -f compose.yml up -d --build postgres migrate web worker`。仓库不提供默认管理员密码；初始化必须使用一次性命令显式传入。详细步骤见 `docs/self-hosting/deployment.md`。

## 主要文档

- `chenyida_erp_app/README.md`：应用说明、默认账号、验证命令。
- `chenyida_erp_site/README.md`：自托管开发、构建和部署入口。
- `docs/self-hosting/`：架构、PostgreSQL migration、Linux 部署、备份恢复和旧 Cloudflare 处置。
- `docs/audits/phase0-task01-source-management-report.md`：Site gitlink 转普通目录的审计报告。
- `晨亿达ERP系统设计方案.md`：完整系统设计方案。
- `晨亿达ERP投用运行手册.md`：现场启动、检查、备份、恢复和故障处理。
- `物料主数据治理落地包/`：物料编码、字段字典、导入清洗 SOP 和模板。
