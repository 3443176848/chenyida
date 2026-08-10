# PHASE4-TASK02 — 建立版本化去敏评估集、确定性基线与离线 Evaluator

## 任务状态

`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`

日期：2026-08-10（Asia/Shanghai）

负责人：Codex（离线 Evaluator、静态合成评估集、专项测试、冻结 holdout 测量、阈值收口文档与独立提交）、项目负责人（D-111准确率阈值和最低coverage决定）

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
- 实现与正式测量阶段只测量，不批准准确率阈值或最低coverage；后续项目负责人以独立docs-only授权创建`D-111`并收口本任务，仍不启动`PHASE4-TASK03`。

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

## 最终判定

`PHASE4-TASK02 OFFLINE EVALUATOR AND DETERMINISTIC THRESHOLDS ACCEPTED — RELEASE NOT AUTHORIZED`

本任务已经交付可复现的离线测量工具与第一份冻结holdout实测报告；项目负责人随后通过D-111批准仅适用于当前冻结本地确定性基线的阈值档案。机器报告生成时的历史状态固定为：

- `dataset_integrity=PASS`
- `critical_safety_gate=PASS`
- `accuracy_measurement=MEASURED`
- `threshold_status=UNAPPROVED`
- `release_decision=NOT_AUTHORIZED`

D-111不回写机器报告，而是在治理层追加`THRESHOLD_ASSESSMENT=PASS`。`release_decision`继续为`NOT_AUTHORIZED`，外部AI、真实数据、试点、候选层和部署均未获授权。

## 冻结制品

- 功能提交：`d69f6dff795377109244e788c2ffee73ef6194ec`，Parent `432551b1c8dbf9213954d57a77f0b022c843227e`。
- 数据集：`synthetic-material-governance-v1@1.0.0`，dataset digest `4bde669dd59a3cbb239fcd4f9b62f7e8eccfd2b6921d45cb0545503ba4a34adb`。
- calibration：32 条，SHA-256 `d251271991566a877ee721392e39c9e0c8be1afcede47fa868aeb0376133ed95`。
- holdout：32 条，SHA-256 `73e3d84337609d87e0b554fefb531c25c1f39a5ad74998500b7ee21bf633bde3`，策略 `FROZEN_NOT_FOR_TUNING`。
- 正式报告：`chenyida_erp_site/evals/ai-governance/material-v1/reports/deterministic-baseline-alpha43.json`，文件 SHA-256 `e2ed87e629633d09ae5de079e105d82e74a393a8c13ab8817fdf04a93d0b8a5e`，稳定 result digest `f1b5b6b95cc1fe1c624c910bb28aaa29b39db8a5b6a72088ecb773c8d26ac316`。

## 正式测量摘要

| Split | 样本 | 决策精确匹配 | Abstention | Coverage | Coverage 内准确率 | 证据合规 | 稳定复现 | 关键安全违规 |
| --- | ---: | --- | --- | --- | --- | --- | --- | ---: |
| calibration | 32 | 32/32 = 1.000000 | 14/32 = 0.437500 | 18/32 = 0.562500 | 18/18 = 1.000000 | 32/32 = 1.000000 | 32/32 = 1.000000 | 0 |
| holdout | 32 | 32/32 = 1.000000 | 13/32 = 0.406250 | 19/32 = 0.593750 | 19/19 = 1.000000 | 32/32 = 1.000000 | 32/32 = 1.000000 | 0 |
| overall | 64 | 64/64 = 1.000000 | 27/64 = 0.421875 | 37/64 = 0.578125 | 37/37 = 1.000000 | 64/64 = 1.000000 | 64/64 = 1.000000 | 0 |

calibration 和 holdout 的失败 sample_id 都为空。该结果只描述此静态合成数据集与当前确定性规则的可复现测量，不是总体准确率门槛、外部有效性证明或 production-ready 结论。逐能力、逐字段、品类、scenario 和风险分层见[数据集与测量说明](../material-master/ai-governance-evaluation-dataset-v1.md)及机器报告。

## D-111阈值决定

批准档案`deterministic-ai-governance-thresholds-v1`只绑定当前provider/model/prompt/rule/evaluator/dataset/source revision，不自动适用于外部模型或新版本：

| 门禁 | 最低要求 |
| --- | --- |
| 数据/安全 | dataset integrity PASS；禁止数据、formal action、关键安全违规均为0 |
| 通用正确性 | 决策exact、证据合规、稳定复现、coverage内准确率均为1.000000 |
| Classification | 已定义micro/macro P/R/F1和exact均1.000000；coverage ≥ 0.750000 |
| Attribute Extraction | 已定义字段P/R/F1、row exact、covered accuracy均1.000000；记录coverage和字段coverage均 ≥ 0.750000 |
| Material Match | top-1/top-3及covered accuracy均1.000000；错误候选0；coverage ≥ 0.250000 |
| Supplier Mapping | top-1/top-3及covered accuracy均1.000000；错误候选0；coverage ≥ 0.250000 |
| Overall | coverage ≥ 0.500000；ABSTAIN保留在分母，零support保持undefined |

当前冻结结果逐项满足该档案。按品类、scenario和风险的有样本分层仍要求decision exact/evidence 1.000000和安全违规0；零coverage层不获得能力声明。正式holdout没有因阈值决定而重跑，Evaluator、数据集、标签、机器报告、代码、测试、package和治理规则均未修改。

## 验证与边界

- 实现与测量阶段的专项测试 17/17、专项 typecheck、既有治理回归 61/61、`npm test` 3/3 通过；lint 为 0 error、11 条既有 warning、任务新增 warning 0。
- D-111 docs-only收口验证九份Markdown、54个本地引用、状态/阈值/报告完整性、敏感信息和`git diff --check`通过；Python self-test、smoke、临时测试库go-live及断网只读源码容器`npm test` 3/3通过，没有重跑正式holdout。
- 收口起点/验证后available约`2.2/2.2GiB`、Swap`346/346MiB`/1GiB、根盘`17/17GiB`、Load`0.38/0.18/0.21`→`0.05/0.07/0.12`；任务期内核OOM匹配0、四服务restart0/OOM false，临时测试资源自动清理，四个受保护Volume保持。
- provider=`LOCAL_DETERMINISTIC`、model_id=`NONE`、prompt_version=`NONE`、rule_version=`bom-material-governance-v1`、evaluator_version=`ai-governance-evaluator-v1`。
- 源码候选为 `0.1.0-alpha.43`；运行 UAT 仍为 alpha.42 原镜像，Migration 仍为 `0040`。
- 未调用 AI 或外部服务，未读取真实业务数据、数据库或受保护 Volume 正文，未修改 Schema/Migration/API/UI/Worker/既有治理规则，未 build、部署或重启。
- `D-110`不变，`D-111`已批准当前确定性阈值并将本任务收口为`DONE`；`PHASE4-TASK03`仍为`TODO`且没有自动启动。
