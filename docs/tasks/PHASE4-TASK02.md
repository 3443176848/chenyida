# PHASE4-TASK02 — 建立版本化去敏评估集、确定性基线与离线 Evaluator

## 任务状态

`DOING / OFFLINE_EVALUATOR_IMPLEMENTATION`

日期：2026-08-10（Asia/Shanghai）

负责人：Codex（离线 Evaluator、静态合成评估集、专项测试、冻结 holdout 测量、文档与独立提交）、项目负责人（后续准确率阈值和最低 coverage 决策）

依赖：`PHASE4-TASK01`、`D-110`

## 严格起点

- Branch：`main`。
- HEAD：`432551b1c8dbf9213954d57a77f0b022c843227e`；Parent：`f17cc31d60bac70d6d3545f1904de6d54feeb4dd`。
- 唯一 worktree：`/opt/erp`；工作区和索引 clean。
- public `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，behind `0` / ahead `191`。
- `recovery-private/main`：`432551b1c8dbf9213954d57a77f0b022c843227e`，behind `0` / ahead `0`。
- 源码和非生产 UAT 都为 `0.1.0-alpha.42`；Migration 为 `0001`—`0040`。
- 运行 Web Image ID 为 `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。
- Web、Worker、PostgreSQL、Caddy 均为 `RestartCount=0`、`OOMKilled=false`；四个受保护 Volume 存在。
- 起点没有其他 `DOING` 任务、没有本任务文档、没有 `D-111`。

## 本轮范围

- 在独立 `chenyida_erp_site/tools/ai-governance-evaluation/` 边界实现离线工具。
- 建立版本化、静态、可审阅的合成/去敏 calibration 与固定 holdout。
- 只读复用既有 `governMaterialSource`、`governMaterialBatch` 和治理规则版本，不修改既有确定性规则。
- 分别测量分类、属性提取、物料候选匹配和供应商映射建议。
- 源码候选版本升为 `0.1.0-alpha.43`；运行 UAT 保持 alpha.42，不 build、不制作镜像、不部署。
- 本任务只测量，不批准准确率阈值或最低 coverage；不创建 `D-111`，不启动 `PHASE4-TASK03`。

## 禁止事项

- 不调用 AI 模型、外部服务、网络或数据库，不创建、读取或接收 API Key/凭据。
- 不读取真实供应商、客户、价格、人员、UAT 业务数据、数据库或受保护 Volume 正文。
- 不修改 Schema、Migration、数据库、API、页面、Worker、运行时路由、治理引擎或治理配置。
- 不创建正式 Suggestion/Evidence 候选层，不 build、不部署、不重启服务。
- holdout 不用于规则、标签、实现或阈值调优；泄漏时必须新建数据集版本。

## 冻结与提交顺序

1. 仅使用 calibration 开发和验证 Evaluator。
2. 冻结 Evaluator、Schema、评估集和 manifest。
3. 完成专项测试、typecheck、治理回归、lint、npm test 和安全扫描。
4. 创建功能提交 `feat: add offline AI governance evaluator`。
5. 功能提交后不再修改 Evaluator、数据集、标签、package 或确定性规则。
6. 从功能提交完整 SHA 执行一次正式 all-splits 测量。
7. 如实记录 calibration/holdout；普通准确率或 coverage 不足不触发改标签或改规则。
8. 只以机器报告和 Markdown 创建 `docs: record AI governance baseline metrics`。

最终状态和实测结果在正式 holdout 测量后补充。
