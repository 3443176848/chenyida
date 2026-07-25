# SELFHOST-PHASE3-TASK04：本机真实 SQLite 只读盘点与脱敏迁移 Dry-run

状态：`DONE`

开始日期：2026-07-25（Asia/Shanghai）

## 可信起点

- Branch `main`，HEAD `a541360eefe12869c090b2408bbcf07485fc77cb`，Parent `8f30798464476b53f435d53022c45ed731804e95`，工作区 clean，相对 `origin/main` ahead 15 / behind 0。
- 版本 `0.1.0-alpha.13`；PostgreSQL migration 严格为 `0001`—`0014`，固定 checksum 与 TASK03 完成基线一致。
- Python systemd 服务为 active，任务开始 PID `277640`。数据库配置经 unit、工作目录和 Python 默认路径复核后，只允许解析到授权文件。
- 当前没有运行中的容器；现存非默认 Docker 网络和卷属于其他 Compose 项目，本任务不触碰。

## 唯一范围

本任务只对获准的本机 Python SQLite 运行官方 online backup，随后只在仓库外、权限收紧的任务临时目录中对一致性快照执行 Schema、聚合数据质量和无 PostgreSQL 目标的迁移规划。提交物只包含不可逆摘要、聚合计数、固定枚举计数和 task-local HMAC opaque reference。

不访问 D1、远程 URL、PostgreSQL、附件正文、上传、归档、备份或其他数据库；不写原 SQLite、不停止或重启 Python、不物化、不部署、不切流、不 push、不创建 PR。

## 执行顺序

1. 完成安全设计、脱敏规则、字段映射复核和 Dry-run 验收计划。
2. 用完全合成 SQLite fixture 验证真实模式的所有前置守卫、online backup、一致性、脱敏聚合、问题引用和成功/失败清理。
3. 再次核对精确源路径、systemd 配置、Git commit、版本、migration checksum 和 Python PID。
4. 在 `mktemp -d` 且权限 `0700` 的任务目录中创建一致性快照，执行 integrity check、指纹、聚合盘点和无目标 Dry-run。
5. 扫描临时报告，抽取允许提交的聚合结果；无论成功或失败均删除快照和 task-local HMAC key。
6. 运行全量回归，更新项目治理文档并创建独立提交。

## 边界与完成语义

- PostgreSQL migration 保持 `0001`—`0014`；不创建 `0015`，不修改 `db/schema.ts` 或业务 Service 状态机。
- 任何模型缺口只记录为 `MODEL_GAP`，任何人工决策只生成脱敏处置清单，不自动修复或合并。
- DONE 的唯一结论词为 `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`。
- DONE 不表示真实迁移、PostgreSQL 导入、生产试迁移、上线批准、冲突解决、附件核对或 D1 盘点完成。

## 当前执行计划

- [x] 核验 TASK03 clean 提交、版本、migration checksum、systemd PID 和运行资源。
- [x] 完整阅读项目治理、TASK01—TASK03、迁移工具、Python Schema/migration 和 PostgreSQL `0001`—`0014`。
- [x] 实现只读快照、真实模式守卫、脱敏聚合 planner 和报告扫描。
- [x] 完成 TASK04 合成专项测试。
- [x] 执行一次获准的真实快照、盘点与无目标 Dry-run，并销毁临时资源。
- [x] 完成全量回归、文档同步、版本更新和独立提交。

完成报告：`docs/tasks/SELFHOST-PHASE3-TASK04-completion.md`。唯一完成结论：`REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`。
