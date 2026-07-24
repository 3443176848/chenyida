# SELFHOST-PHASE2-TASK03：自托管主数据、产品与 BOM

状态：`DONE`（非生产实施；最终提交通过 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK03-completion.md` 解析）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准本任务范围与禁止事项）

## 1. 起始基线

- Branch：`main`。
- Task start HEAD：`2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`。
- 起始工作区：clean；本地 `main` 领先 `origin/main` 3 个提交。
- 自托管版本：`chenyida-erp-selfhosted@0.1.0-alpha.2`，非生产、尚未发布。
- PostgreSQL migration：`0001`—`0006`；仓库 SHA-256 与 `RELEASES.md` 一致。
- 根仓库没有 gitlink、submodule 或嵌套仓库。

## 2. 任务范围

- 关系化客户、供应商、产品、产品版本、BOM Header、BOM Version、BOM Line 和并发安全业务编码序列。
- 供应商物料映射关联稳定 supplier ID 与 ACTIVE Material ID，提供版本、有效期、状态和不可变价格历史。
- 新建独立 `master-data-selfhost/` 与 `bom-selfhost/` Repository/Service/Handler；`selfhost-api.ts` 只做精确委托。
- 实现客户、供应商、产品、BOM、BOM Line、供应商映射与 ACTIVE Material 的 legacy 兼容读取/写入投影。
- 发布 BOM 版本后数据库禁止修改或删除其行；修订必须新建版本。
- TASK04 前的 BOM readiness 只返回结构完整性、所需数量和状态，不读取库存余额。

## 3. 固定业务边界

- 新关系引用 bigint 内部 ID；code 是唯一业务标识但不是关系主键，名称不参与 upsert 命中。
- 客户/供应商仅软停用，不物理删除；更新和状态变化使用 expected version。
- 产品以稳定 header 加不可变版本保存工程属性；产品版本发布后只可新增版本。
- BOM 版本从 DRAFT 发布为 RELEASED；已发布内容不可变。BOM 行只引用 ACTIVE Material 和启用单位，数量大于零、损耗率在 `[0,1)`。
- Supplier Mapping 新写必须关联 ACTIVE Supplier、ACTIVE Material 和启用单位；有效期不能重叠；价格历史只追加，不原地改写。
- 写操作必须执行 Session、服务端权限、CSRF、正文上限、持久幂等、乐观锁/行锁、请求编号和同事务审计。

## 4. 验收与禁止事项

验收覆盖领域单元、legacy UI 契约、隔离 PostgreSQL/API、migration 空库/0006 存量升级/重复 runner/失败回滚/约束/索引、权限、CSRF、幂等、并发、故障回滚、Compose smoke/restart 与全部适用回归。

禁止实现或写入库存、采购、工单、生产、销售、品质、财务、Dashboard 或备份；禁止读取或迁移真实主数据；禁止生产 migration、部署、push 或创建 PR。

## 5. 验收结论

- 新增 PostgreSQL `0007_master_data_bom.sql`，SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`；`0001`—`0006` checksum 全部保持不变。
- Customer、Supplier、Product/Product Version、BOM Header/Version/Line、Supplier Mapping/Price History 已由关系化 PostgreSQL 与独立服务端模块承载；不写 `erp_records`。
- 发布的 Product/BOM 版本和 BOM 行由数据库 trigger 保持不可变；BOM readiness 明确只做结构检查并返回 `inventory_evaluated=false`。
- 专项单元、UI 契约、PostgreSQL/API、migration 升级、权限、CSRF、幂等、CAS、并发、限流、失败回滚和 Compose 重启持久化通过；全部适用 Node/PostgreSQL/Python 回归通过。
- 未读取或迁移真实业务数据，未访问生产，未部署，未 push，未创建 PR；完整结果见独立完成报告。
