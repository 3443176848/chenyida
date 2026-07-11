# 晨亿达 ERP 项目

这是深圳市晨亿达电子有限公司 ERP 项目，覆盖物料主数据治理、产品/BOM、采购、库存、生产、询价报价、销售、财务、品质和系统运维。

## 项目结构

- `chenyida_erp_app/`：本地 ERP 应用，使用 Python、SQLite 和原生网页。
- `chenyida_erp_site/`：在线 Site 应用，使用 Vinext、TypeScript、Cloudflare Worker 和 D1。
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

本地 ERP 和在线 Site 可分别进入各自目录开发和验证。在线 Site 保留现有 `package-lock.json`、构建脚本和 `.openai/hosting.json`：

```powershell
cd chenyida_erp_site
npm ci
npm test
```

## 快速启动

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\start_server.ps1
```

打开：

```text
http://127.0.0.1:8765
```

本地开发默认管理员：

```text
admin / admin123
```

首次本地投用后请立即修改管理员密码；该默认凭证不得用于生产环境。

## 主要文档

- `chenyida_erp_app/README.md`：应用说明、默认账号、验证命令。
- `chenyida_erp_site/README.md`：在线 Site 的开发、构建和部署说明。
- `docs/audits/phase0-task01-source-management-report.md`：Site gitlink 转普通目录的审计报告。
- `晨亿达ERP系统设计方案.md`：完整系统设计方案。
- `晨亿达ERP投用运行手册.md`：现场启动、检查、备份、恢复和故障处理。
- `物料主数据治理落地包/`：物料编码、字段字典、导入清洗 SOP 和模板。
