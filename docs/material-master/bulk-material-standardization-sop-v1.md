# 大批量物料资料分批标准化 SOP V1

## 1. 目的

本 SOP 把 `SELFHOST-LANDING-TASK07` 的一次性整理方式固化为可长期重复执行、可跨多个 GPT 对话恢复、可审计且可最终汇总的批次流程。

核心原则是：**聊天只负责协作，文件中的版本、摘要、批次卡和状态才是权威记录。** 新对话不需要旧聊天全文，只要读取项目总控、本 SOP、私有总索引和目标批次卡，就能从唯一 `next_action` 继续。

本流程只覆盖 BOM、量产物料清单及可映射到物料明细的 XLS/XLSX/CSV。图纸、PDF、合同、报价、工艺说明和图片先分类为附件或独立资料类型，不强行塞进 13 列物料表。

## 2. 固定模板与规则版本

### 2.1 当前目标模板

- 模板 ID：`CYD-MATERIAL-13C-v1`
- 参考文件：`moban.xlsx`
- SHA-256：`581a0db72ed6ac207445e39bd8c9640a8765830ddcf385518ba177d74909a58c`
- 第一张 `原BOM`：真实原始数据示例。
- 第二张 `Sheet1`：整理后的目标格式。
- 13 列顺序固定为：

```text
序号、项目号、板子类型、内部型号、物料规格描述、品牌、用量、替代料、供应商、订单数量、需求数量、购买数量、库存数
```

### 2.2 规则包

- 规则包 ID：`CYD-MATERIAL-NORMALIZATION-v1`
- TASK07 提交 `78701d16dcea6b4ae5a2ff73d138c8ec838c8498` 是规则验证和文件专用实现的参考，不是任意新格式的通用执行器。
- 模板列、字段语义或整理规则发生变化时，必须发布新的模板或规则包版本；不得原地改写 V1 后重新覆盖旧结果。
- 每份输出必须同时记录模板 ID、模板摘要、规则包 ID、来源映射档案版本和执行器提交号。

## 3. 不变原则

1. 原始附件接收后立即复制到受控私有批次目录、计算 SHA-256 并改为只读；后续不编辑原文件。
2. 每批只处理一个有界文件集合；默认一个批次对应一个 GPT 对话和一个独立任务编号。
3. 已知结构只有在结构指纹与已批准映射档案一致时才能直接套用；文件名相似不能代替结构匹配。
4. 未知结构先生成字段预览和建议映射，项目负责人一次确认后才发布新的映射档案版本。
5. 来源明确的信息才填写；未知数量、板型、型号、供应商、库存和订单均留空并进入异常，不猜测。
6. 主料保留一行，只有能证明属于同一主料组的备选项才折叠到 `替代料`。
7. 当前 BOM/物料主表进入明细；更新记录、变更记录、说明页和空页只归档与追溯，不重复计入当前用量。
8. 标准化阶段保留不同项目、板型、BOM 和来源中的每次物料出现，不做跨来源模糊去重。
9. AI 最高只能把批次推进到 `REVIEW_REQUIRED`；只有项目负责人可以批准进入正式汇总候选。
10. 工作簿整理、正式物料去重/编码、数据库导入是三个独立阶段，不得合并成一步。

## 4. 批次编号与默认上限

批次编号采用 `CYD-MAT-YYYYMMDD-NNN`，同一批修订采用 `R001`、`R002` 递增。例如：`CYD-MAT-20260801-001/R001`。

默认单批同时满足以下上限：

- 最多 10 个源文件；
- 最多约 5,000 条候选物料原始行；
- 源文件压缩体积合计最多 100 MiB；
- 一次只运行一个解析、工作簿生成或测试任务。

任一文件单独超过行数或内存安全范围、包含异常超宽 Sheet、损坏 OOXML、大量公式/外链，或业务语义明显不同，应拆为独立批次。不得为了凑满 10 个文件跨部门、跨资料类型随意混批。

推荐的批次边界优先级为：项目/产品族 → 资料类型 → 来源部门或供应商 → 时间版本。一个工作簿原则上不跨批拆分；确需拆分时只能按完整 Sheet 拆分，并在两个批次中保留相同父文件 SHA 和互斥 Sheet 清单。

## 5. 私有目录和交付目录

业务正文不进入 Git。建议固定结构如下：

```text
/opt/erp/shujvbiao/material-pipeline/
  templates/
    CYD-MATERIAL-13C-v1/
  profiles/
    <profile-id>/<version>.json
  batches/
    CYD-MAT-YYYYMMDD-NNN/
      R001/
        source/                 # 原件，只读
        source-manifest.json    # 文件、Sheet、摘要与结构指纹
        batch-card.json         # 当前状态和唯一 next_action
        decisions.jsonl         # 人工决定，追加式
        output/
          <batch>-R001-standardized.xlsx
          <batch>-R001-report.json
  consolidation/
    provisional/               # 已机器验证但未全部人工批准
    approved/                  # 仅人工批准批次

/var/lib/chenyida-erp/intake/material-standardization/
  pipeline-index.json          # 全局私有总索引
  reports/                     # 私有验证证据

/mnt/data/
  <batch>-R001-standardized.xlsx   # 当前对话可点击下载副本
```

源文件、批次卡、报告和输出默认 `root:root 0600`；目录默认 `root:root 0700`。`/mnt/data` 只放需要交付的副本，稳定权威文件仍在批次目录。

## 6. 文件角色分类

每个可见 Sheet 必须先归入以下角色之一：

| 角色 | 是否进入标准明细 | 说明 |
| --- | --- | --- |
| `CURRENT_BOM` | 是 | 当前有效 BOM，主料与可证明备选料分组 |
| `CURRENT_MATERIAL_LIST` | 是 | 当前物料/辅料清单；缺单机用量时留空 |
| `CHANGE_LOG` | 否 | 历史修改证据，不重复计算当前物料 |
| `NOTE_ARCHIVE` | 否 | 注意事项、制作/审核、工艺说明等归档内容 |
| `EMPTY` | 否 | 空 Sheet |
| `UNKNOWN` | 否 | 无法证明语义，进入 `PROFILE_PENDING` |

文件角色和 Sheet 角色都写入来源 manifest。隐藏 Sheet 只记录安全元数据，未经明确确认不读取或输出业务正文。

## 7. 来源映射档案

一个映射档案至少包含：

- `profile_id` 和递增版本；
- 文件类型、可见 Sheet 选择规则和角色；
- 结构指纹：规范化表头、表头行范围、有效列数、合并单元格特征和关键标题模式；
- 原列到 13 列语义的映射；
- 主料/替代料/分段标题/板件本体/归档行识别规则；
- 用量来源优先级及禁止推断项；
- 已批准的样本 source SHA、测试夹具和已知限制。

结构指纹完全匹配已批准档案时可自动复用。以下任一情况必须进入 `PROFILE_PENDING`：

- 新表头或列位变化；
- 同名列语义变化；
- 数量列无法确认；
- 主料和替代料关系不明确；
- 文件名与表内项目/版本冲突；
- 同一指纹产生与历史档案不同的解析结果。

确认新布局时以一组映射决定覆盖同结构文件，不逐行问同一问题。确认后发布新档案版本并增加回归样本；旧档案不修改。

## 8. 批次状态机

```text
RECEIVED
  -> MANIFEST_LOCKED
  -> CLASSIFIED
  -> PROFILE_PENDING -> READY_TO_STANDARDIZE
                 \----> READY_TO_STANDARDIZE
  -> STANDARDIZED
  -> VALIDATED
  -> REVIEW_REQUIRED
  -> APPROVED_FOR_CONSOLIDATION
  -> CONSOLIDATED
```

补充状态：

- `INPUT_REQUIRED`：缺源文件、版本说明或人工决定；批次卡必须写明精确问题和恢复动作。
- `FAILED_VALIDATION`：输出合同或来源完整性校验失败；不得产生可批准结果。
- `SUPERSEDED`：被更高修订取代；旧文件和证据保留，但不得再进入最新汇总。

合法状态责任：

| 状态 | 可执行者 | 关键门禁 |
| --- | --- | --- |
| `RECEIVED`—`VALIDATED` | Codex | 只读源、确定性规则和自动校验 |
| `REVIEW_REQUIRED` | Codex | 输出与异常已冻结，等待人工决定 |
| `APPROVED_FOR_CONSOLIDATION` | 项目负责人 | 明确批次 ID、修订号和异常处置范围 |
| `CONSOLIDATED` | Codex | 只读取已批准且未被取代的不可变输出 |

## 9. 每批标准执行步骤

### 步骤 1：接收与固化

1. 为附件创建批次 ID/R001。
2. 从 GPT 临时附件目录复制到批次 `source/`，设置只读权限。
3. 记录原始文件名、大小、SHA-256、Sheet、可见性和基本安全特征。
4. 同一 SHA 已存在时只报告重复，不静默重复纳入；是否允许作为另一业务批次由项目负责人决定。

输出：`source-manifest.json`，状态 `MANIFEST_LOCKED`。

### 步骤 2：盘点与分类

逐文件/Sheet 判断当前 BOM、物料清单、变更记录、说明、空页或未知。只预览足够判断结构的有界区域，不把联系人、电话、账号或自由备注带入标准表。

输出：Sheet 角色、原始候选行数、异常结构清单，状态 `CLASSIFIED`。

### 步骤 3：选择映射档案

- 指纹命中：记录 `profile_id/version/digest`，进入 `READY_TO_STANDARDIZE`。
- 指纹未命中：生成字段对照样例和最多三组批量问题，进入 `PROFILE_PENDING`；用户确认后发布新档案版本。

### 步骤 4：标准化

按 13 列合同逐来源生成标准页，再生成批次汇总页：

- 项目、板型、内部型号只从文件/Sheet 标题、已确认分段或模板证据补全；
- 规格保留可识别物料身份的关键电气/结构参数；型号敏感件保留完整 MPN；
- 品牌和供应商分开，制造商不得自动冒充供应商；
- 用量只取明确正数或可验证位号计数；未知留空；
- 订单、库存未知时留空；需求和购买数量使用受控公式；
- 来源、主料行、备选行、档案版本和规则写入 `来源追溯`；
- 所有缺项、冲突、排除和重复处理写入 `整理异常`。

状态：`STANDARDIZED`。

### 步骤 5：机器校验

至少同时通过：

1. 来源 manifest 处理前后一致；
2. 每个源文件和可见 Sheet 均有角色及处理结果；
3. 每个纳入的标准行有唯一来源追溯；
4. 每个来源主料组恰好进入标准行、明确排除或异常，不静默丢行；
5. 13 列标题、顺序、数量类型和公式合同正确；
6. ZIP/openpyxl 重开、宏/外链/公式注入/敏感信息扫描通过；
7. 标准页行数之和等于批次汇总行数；
8. 输出和报告权限、摘要及重新运行幂等通过。

失败进入 `FAILED_VALIDATION`；通过进入 `VALIDATED`，随后冻结输出并进入 `REVIEW_REQUIRED`。

### 步骤 6：人工批量复核

人工复核看摘要和异常组，不要求默认逐行审 5,000 行。异常至少按 `问题代码 + 来源档案 + 字段 + 建议动作` 聚组。常用问题代码：

- `PROFILE_UNKNOWN`
- `SOURCE_VERSION_CONFLICT`
- `PROJECT_CONTEXT_MISSING`
- `BOARD_TYPE_MISSING`
- `INTERNAL_MODEL_MISSING`
- `QUANTITY_MISSING`
- `SPEC_IDENTITY_INCOMPLETE`
- `SUPPLIER_AMBIGUOUS`
- `ALTERNATIVE_UNBOUND`
- `DUPLICATE_SECTION_EXACT`
- `DUPLICATE_SECTION_CONFLICT`
- `BOARD_BASE_EXCLUDED`
- `ARCHIVE_ONLY`
- `SOURCE_DRIFT`

项目负责人可以对一个异常组作一次决定，但决定必须限定 `batch_id/revision/profile/issue_code/row_set_digest`，不能用模糊的“以后都这样”覆盖未知结构。

### 步骤 7：批准与冻结

批准指令必须明确批次 ID 和修订号。批准后：

- 锁定输出 SHA、报告 SHA、来源 manifest SHA 和决定日志摘要；
- 状态变为 `APPROVED_FOR_CONSOLIDATION`；
- 如需修正，创建 R002 并把 R001 标为 `SUPERSEDED`，不得覆盖 R001。

## 10. 两级汇总

为兼顾进度和正式性，汇总分两类：

### 10.1 临时全量汇总

- 可包含 `VALIDATED/REVIEW_REQUIRED` 的最新非取代修订；
- 文件名和说明必须标记“临时，含待确认”；
- 用于统计进度和发现跨批问题，不是数据库导入源。

### 10.2 已批准全量汇总

- 只包含 `APPROVED_FOR_CONSOLIDATION` 或已经 `CONSOLIDATED` 的最新非取代修订；
- 以 `(batch_id, revision, output_sha256)` 防止重复纳入；
- 逐批拼接标准行，不重新解析原文件；
- 保留全局来源追溯、批次清单、异常决定和生成 manifest；
- 标准化阶段不做跨批模糊去重。

正式物料去重、稳定内部编码、单位归一、供应商映射、替代关系和 BOM 内部 ID 绑定属于后续“主数据决议包”，必须单独 dry-run、人工审批和数据库任务。

## 11. 跨对话协议

### 11.1 开始新批次

项目负责人发送附件时可直接复制：

```text
新建一个物料整理批次。先读 docs/project/MASTER.md 和
docs/material-master/bulk-material-standardization-sop-v1.md。
本对话只处理这一批，使用 CYD-MATERIAL-13C-v1，不写数据库。
资料范围/项目：<填写；不知道可写“待识别”>。
```

### 11.2 继续未完成批次

```text
继续批次 <CYD-MAT-YYYYMMDD-NNN>/<Rxxx>。
先读取私有 pipeline-index.json 和该批 batch-card.json，
核对摘要后只执行 checkpoint.next_action，不依赖旧聊天，不写数据库。
```

### 11.3 批准批次

```text
批准批次 <batch_id>/<revision> 按当前 output_sha256 进入已批准汇总。
异常决定：<引用异常组编号或写“保持空白待数据库前复核”>。
```

若用户只说“继续”而未给批次号，Codex 只能在私有总索引中存在唯一 `active_batch_id` 时继续；存在多个未完成批次必须先列出脱敏批次摘要让用户选择。

## 12. 每个对话结束时必须交付

1. 批次 ID、修订号和当前状态；
2. GPT 内可点击下载的标准化工作簿；
3. 文件数、原始候选行、标准行、替代料行和异常分组计数；
4. 模板、规则包、映射档案和源/输出摘要；
5. 明确说明是否存在未知用量、板型、版本冲突或被排除 Sheet；
6. 数据库写入数必须为 0，除非用户在独立任务中明确授权；
7. `batch-card.json` 的唯一 `next_action`；
8. 测试、资源和清理结果。

## 13. 幂等、修订和恢复

- 同一来源 manifest、模板摘要、规则包、映射档案和人工决定摘要必须产生相同业务内容摘要；不允许同条件下静默产生不同结果。
- 源文件发生任何字节变化都必须重新计算 manifest；不能沿用旧结果。
- 下载副本丢失时可从权威批次输出重新复制，不重新解析来源。
- 对话中断时，先把已完成步骤和下一动作原子写入批次卡；没有写入 checkpoint 的聊天结论不视为完成。
- 全局索引只保存批次摘要和指针，不复制逐行业务正文。
- 任何修订都保留 `supersedes` 和 `superseded_by`，全量汇总只选最新已批准版本。

## 14. 安全与资源边界

- 原始公司资料、业务工作簿、逐行追溯、异常正文和私有索引不进入 Git，不生成公开下载链接。
- GPT 下载副本只放 `/mnt/data`，输出权限 `0600`；需要再次下载时按摘要重新复制。
- 联系人、电话、密码、Token、数据库连接和自由备注默认不进入标准工作簿。
- 低资源服务器上所有解析、测试和汇总串行；任何批次都服从 `AGENTS.md` 的内存、Swap、磁盘、Load、OOM 和 Docker 停止门禁。
- 本流程默认不连接数据库，不运行 Migration，不 build/restart/deploy。

## 15. 实施顺序

当前完成的是流程设计。大规模正式执行前推荐两个独立后续任务：

1. **通用批次执行器任务**：把 TASK07 的固定文件分支提取为版本化规则包、来源档案注册表、批次 init/resume/validate/consolidate 命令及合成测试。
2. **代表性试点批次**：先发送 5—10 份覆盖主要来源布局的资料，建立首批映射档案并验证异常分组，再按项目/供应商分波次扩大。

在通用执行器完成前仍可人工按本 SOP 处理新批次，但不得声称当前 TASK07 文件专用脚本已经能安全自动处理所有未来资料。
