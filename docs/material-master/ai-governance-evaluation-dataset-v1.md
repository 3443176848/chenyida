# AI治理离线评估数据集与确定性基线 V1

## 状态与边界

本文件记录`PHASE4-TASK02`交付的静态合成/去敏评估集、离线确定性基线、指标合同和第一次冻结 holdout 实测结果。

最终状态：`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`

最终判定：`PHASE4-TASK02 OFFLINE EVALUATOR AND DETERMINISTIC THRESHOLDS ACCEPTED — RELEASE NOT AUTHORIZED`

本交付只提供离线测量能力；D-111后续仅批准当前冻结本地确定性基线的评估阈值。它没有调用AI模型、接入外部服务、查询数据库、读取真实业务数据、创建Suggestion/Evidence候选层或授权发布。任何“外部模型准确率已通过”“production ready”或自动启动`PHASE4-TASK03`的解释都无效。

## 数据集身份与完整性

| 字段 | 值 |
| --- | --- |
| dataset_id | `synthetic-material-governance-v1` |
| version | `1.0.0` |
| sample schema | `ai-governance-evaluation-sample-v1` |
| deidentification policy | `ai-governance-deidentification-v1` |
| canonical JSON | `canonical-json-lexicographic-v1` |
| dataset digest rule | `sha256(canonical-json(manifest-without-dataset_digest))` |
| dataset digest | `4bde669dd59a3cbb239fcd4f9b62f7e8eccfd2b6921d45cb0545503ba4a34adb` |
| holdout policy | `FROZEN_NOT_FOR_TUNING` |

| Split | 文件 | 样本数 | 文件 SHA-256 |
| --- | --- | ---: | --- |
| calibration | `calibration.jsonl` | 32 | `d251271991566a877ee721392e39c9e0c8be1afcede47fa868aeb0376133ed95` |
| holdout | `holdout.jsonl` | 32 | `73e3d84337609d87e0b554fefb531c25c1f39a5ad74998500b7ee21bf633bde3` |
| 合计 | - | 64 | 由manifest canonical digest绑定 |

每个split均恰好包含`CLASSIFICATION`、`ATTRIBUTE_EXTRACTION`、`MATERIAL_MATCH`、`SUPPLIER_MAPPING`各8条。两个split合计覆盖`RES`11、`CAP`15、`IND`8、`IC`8、`CON`9、`OSC`7、`MECH`1、`OTHER`2、`UNKNOWN`3条。

场景覆盖正例、近似反例、冲突、多值、缺字段、等价单位、单位不兼容、重复候选、冻结/停用、客户专用、非法值、schema-like异常文本、异常长度、提示注入式文本、替代兼容但非同物以及必须放弃回答。64个scenario名称均稳定且每个split内样本ID按字典序固定。

加载器在计算任何指标前整体验证manifest、文件摘要、dataset digest、样本顺序、全局唯一ID、split标签、统计、未知字段、候选引用、合成身份、受控枚举和禁止数据；篡改、重排、重复、断裂引用、path traversal、URL或symlink均失败关闭。

## 去敏规则

- 所有source、candidate、supplier、customer、model、brand和part身份使用`SYN`、`FIXTURE`或`EXAMPLE`前缀；`GENERAL`只作为公开的全局scope哨兵。
- 禁止公司名、真实供应商/客户/人员、价格、邮箱、电话、地址、IP、账号、PO/RFQ/UAT编号、Bearer、Token、API Key、密码、数据库URL或可逆业务正文。
- 两个split都是仓库内静态JSONL，不随机生成、不在运行时改变，不访问网络、数据库或Volume。
- schema运行时扫描与独立禁止模式扫描均为0命中；冻结前发现并移除一条真实世界常见器件型号形态，最终SHA和dataset digest随后重新冻结，未运行holdout评分。
- holdout可审阅但不得用于规则、标签、实现或阈值调优；若发生泄漏，必须创建新semantic version，不能原地覆盖V1。

## 四项本地确定性基线

所有结果显式携带：provider=`LOCAL_DETERMINISTIC`、model_id=`NONE`、prompt_version=`NONE`、rule_version=`bom-material-governance-v1`、evaluator_version=`ai-governance-evaluator-v1`。不输出或伪造模型置信度。

1. 分类：只读复用`governMaterialSource`的分类证据；唯一受支持类别才`SUGGEST`，`MECH`、`OTHER`或无可靠类别时`ABSTAIN`。
2. 属性提取：把既有`GovernanceComponent`投影为类型化值、canonical unit和受控证据；缺失、冲突或非法字段逐字段`ABSTAIN`，不补造值。
3. 物料候选匹配：只在样本内合成candidate catalog比较identity digest；唯一、精确、ACTIVE且customer scope允许时才建议，歧义、冲突、无身份、生命周期或scope冲突时放弃；alternative compatibility不视为同物。
4. 供应商映射建议：只使用合成supplier identity、supplier part fact、identity digest、候选状态和customer scope；唯一ACTIVE精确事实且规格一致时才建议，否则放弃。此适配器不是正式mapping写逻辑。

所有适配器输出的formal actions为空，不绕过人工审核、不外发、不覆盖确定性门禁。

## 指标合同

- 每个ratio都包含十进制字符串以及分子、分母和`defined`；固定六位小数。
- 零分母输出`0/0`、`0.000000`、`defined=false`，不产生NaN/Infinity，也不删除指标。
- `ABSTAIN`保留在记录级分母；coverage内准确率另行报告。
- 分类输出micro/macro precision、recall、F1、label support和exact match。
- 属性输出逐字段precision/recall/F1、整行exact match、字段abstention/coverage。
- 候选类输出top-1/top-3 recall、错误候选率、发出候选数和错误候选数；按合同，必须ABSTAIN的负例仍保留在top-k记录分母中。
- 能力、material category、scenario和risk level均有分层；失败详情只含sample_id、受控差异和证据代码，不回显输入正文。
- 每个样本内部重复执行两次；动态run ID和时间不进入稳定result digest。

## 正式测量身份

| 字段 | 值 |
| --- | --- |
| feature source revision | `d69f6dff795377109244e788c2ffee73ef6194ec` |
| feature Parent | `432551b1c8dbf9213954d57a77f0b022c843227e` |
| package | `0.1.0-alpha.43` |
| report schema | `AI_GOVERNANCE_EVALUATION_REPORT_V1` |
| report generated_at | `2026-08-10T11:53:54.085Z` |
| Node | `v22.23.1` / linux x64 / network false / database false |
| report file SHA-256 | `e2ed87e629633d09ae5de079e105d82e74a393a8c13ab8817fdf04a93d0b8a5e` |
| stable result digest | `f1b5b6b95cc1fe1c624c910bb28aaa29b39db8a5b6a72088ecb773c8d26ac316` |

正式all-splits测量只运行一次。重新计算报告稳定投影得到相同result digest；`evaluation_run_id`与`generated_at`不参与该摘要。

## Calibration完整指标

| 指标 | 结果 |
| --- | --- |
| 记录决策exact | 32/32 = 1.000000 |
| abstention | 14/32 = 0.437500 |
| coverage | 18/32 = 0.562500 |
| covered accuracy | 18/18 = 1.000000 |
| evidence compliance | 32/32 = 1.000000 |
| stable reproduction | 32/32 = 1.000000 |
| critical safety violations | 0 |

| 能力 | 记录exact | Abstention | Coverage | Covered accuracy | 专项指标 |
| --- | --- | --- | --- | --- | --- |
| Classification | 8/8 = 1.000000 | 2/8 = 0.250000 | 6/8 = 0.750000 | 6/6 = 1.000000 | micro P/R/F1 = 8/8、8/8、16/16；macro P/R/F1 = 1/1；exact 8/8 |
| Attribute Extraction | 8/8 = 1.000000 | 0/8 = 0.000000 | 8/8 = 1.000000 | 8/8 = 1.000000 | field P/R/F1 = 30/30、30/30、60/60；row exact 8/8；field coverage 30/32；field abstention 2/32 |
| Material Match | 8/8 = 1.000000 | 6/8 = 0.750000 | 2/8 = 0.250000 | 2/2 = 1.000000 | top-1 8/8；top-3 8/8；error candidate 0/2；emitted 2 |
| Supplier Mapping | 8/8 = 1.000000 | 6/8 = 0.750000 | 2/8 = 0.250000 | 2/2 = 1.000000 | top-1 8/8；top-3 8/8；error candidate 0/2；emitted 2 |

分类label support为`ABSTAIN=2`，`CAP/CON/IC/IND/OSC/RES`各1；每个有support的label precision/recall/F1均1.000000。属性字段support为BRAND1、CAPACITANCE2、DIELECTRIC1、FREQUENCY1、INDUCTANCE1、MODEL3、PACKAGE7、PIN_COUNT1、PITCH1、POWER2、RATED_CURRENT1、RESISTANCE1、STRUCTURE1、TOLERANCE5、VOLTAGE2；每个有support的字段precision/recall/F1均1.000000。

## Holdout完整指标

| 指标 | 结果 |
| --- | --- |
| 记录决策exact | 32/32 = 1.000000 |
| abstention | 13/32 = 0.406250 |
| coverage | 19/32 = 0.593750 |
| covered accuracy | 19/19 = 1.000000 |
| evidence compliance | 32/32 = 1.000000 |
| stable reproduction | 32/32 = 1.000000 |
| critical safety violations | 0 |

| 能力 | 记录exact | Abstention | Coverage | Covered accuracy | 专项指标 |
| --- | --- | --- | --- | --- | --- |
| Classification | 8/8 = 1.000000 | 2/8 = 0.250000 | 6/8 = 0.750000 | 6/6 = 1.000000 | micro P/R/F1 = 8/8、8/8、16/16；macro P/R/F1 = 1/1；exact 8/8 |
| Attribute Extraction | 8/8 = 1.000000 | 1/8 = 0.125000 | 7/8 = 0.875000 | 7/7 = 1.000000 | field P/R/F1 = 23/23、23/23、46/46；row exact 8/8；field coverage 23/30；field abstention 7/30 |
| Material Match | 8/8 = 1.000000 | 5/8 = 0.625000 | 3/8 = 0.375000 | 3/3 = 1.000000 | top-1 8/8；top-3 8/8；error candidate 0/3；emitted 3 |
| Supplier Mapping | 8/8 = 1.000000 | 5/8 = 0.625000 | 3/8 = 0.375000 | 3/3 = 1.000000 | top-1 8/8；top-3 8/8；error candidate 0/3；emitted 3 |

分类label support同calibration，所有有support的label precision/recall/F1均1.000000。属性字段support为CAPACITANCE2、DIELECTRIC2、INDUCTANCE1、MODEL2、PACKAGE6、PIN_COUNT1、PITCH1、POWER1、RESISTANCE1、STRUCTURE1、TOLERANCE4、VOLTAGE1，均为1.000000；BRAND、FREQUENCY、RATED_CURRENT的support为0，其precision/recall/F1明确为`0/0`、`0.000000`、`defined=false`，不能解释为失败或成功。

## 总体与分层

总体为64/64决策exact、27/64 abstention、37/64 coverage、37/37 covered accuracy、64/64 evidence compliance、64/64 stable reproduction、关键安全违规0。Material Match与Supplier Mapping均top-1/top-3 16/16、错误候选0/5；属性field coverage为53/62、field abstention 9/62、row exact 16/16。

| Split | Category coverage（count/total） |
| --- | --- |
| calibration | CAP 5/8；CON 2/5；IC 2/4；IND 2/4；MECH 0/1；OSC 2/3；RES 5/6；UNKNOWN 0/1 |
| holdout | CAP 3/7；CON 4/4；IC 3/4；IND 4/4；OSC 3/4；OTHER 0/2；RES 2/5；UNKNOWN 0/2 |

| Split | Risk coverage（count/total） |
| --- | --- |
| calibration | CRITICAL 0/7；HIGH 2/9；LOW 8/8；MEDIUM 8/8 |
| holdout | CRITICAL 1/8；HIGH 7/13；LOW 2/2；MEDIUM 9/9 |

所有category、risk和64个scenario分层的decision exact与evidence compliance均1.000000、关键安全违规均0。MECH、OTHER、UNKNOWN等coverage为0的层，其covered accuracy明确为`0/0`、`defined=false`。calibration、holdout和overall的失败sample_id均为`NONE`。

## 阈值状态

正式机器报告生成时仍是：dataset integrity=`PASS`、critical safety gate=`PASS`、accuracy measurement=`MEASURED`、threshold status=`UNAPPROVED`、release decision=`NOT_AUTHORIZED`。D-111不修改该历史制品，而是在治理层追加`THRESHOLD_ASSESSMENT=PASS`；release decision继续为`NOT_AUTHORIZED`。

项目负责人通过D-111批准`deterministic-ai-governance-thresholds-v1`，且只绑定provider=`LOCAL_DETERMINISTIC`、model/prompt=`NONE/NONE`、rule=`bom-material-governance-v1`、evaluator=`ai-governance-evaluator-v1`、本数据集1.0.0和source revision `d69f6dff795377109244e788c2ffee73ef6194ec`：

| 范围 | 批准阈值 |
| --- | --- |
| 数据、安全与通用正确性 | dataset integrity PASS；禁止数据、formal action、关键安全违规0；decision exact、evidence、stable reproduction、covered accuracy均1.000000 |
| Classification | 已定义micro/macro P/R/F1及exact均1.000000；coverage ≥ 0.750000 |
| Attribute Extraction | 已定义field P/R/F1、row exact、covered accuracy均1.000000；record coverage和field coverage均 ≥ 0.750000 |
| Material Match | top-1/top-3与covered accuracy均1.000000；错误候选0；coverage ≥ 0.250000 |
| Supplier Mapping | top-1/top-3与covered accuracy均1.000000；错误候选0；coverage ≥ 0.250000 |
| Overall/分层 | overall coverage ≥ 0.500000；有样本分层decision exact/evidence均1.000000且安全违规0；零support保持undefined |

当前calibration/holdout均满足全部门禁。较低的Match/Mapping coverage是对歧义和冲突的安全放弃，不得通过猜测提高；MECH、OTHER、UNKNOWN及其他零coverage层不获得支持声明。正式holdout未因D-111重跑，机器报告、Evaluator、数据集、标签、规则、测试和package均保持冻结。

本数据集是人为设计、静态、合成、规则语义覆盖集，样本量仅64；32/32 holdout结果不能证明真实业务分布、外部模型或未来漂移上的准确率。任何外部模型、新数据集或版本变化仍须重新评估并由项目负责人独立批准，不能复用本决定自动放行。

## 运行与审阅

CLI只接受批准的数据集名、`calibration|holdout|all`和40位source revision；默认向stdout输出去敏canonical JSON，也可写入数据集`reports/`或`/tmp/phase4-task02-*`，拒绝覆盖现有文件。

常规开发只允许运行calibration。固定holdout已经正式测量，后续不得为提高结果修改V1；任何再评估都必须先明确目的、绑定新source revision并保留原报告。机器报告是完整分层和失败详情的权威制品，本文只提供审阅摘要。
