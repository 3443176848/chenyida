# SELFHOST-LANDING-TASK06 完成报告

## 结论

- 状态：`DONE / OFFLINE EXPORT / REVIEW REQUIRED`。
- 固定结论：`OFFLINE INTERNAL MATERIAL LIBRARY CREATED — REVIEW REQUIRED`。
- 已生成 `/opt/erp/shujvbiao/内部物料库.xlsx`；这是离线整理和审核工作簿，不代表数据库已导入、物料已审核或生产已生效。
- 未连接或写入 PostgreSQL、SQLite、D1，未运行 Migration、build、restart、deploy、push 或 PR。

## 模板与输入

- 项目负责人确认：`moban.xlsx` 第一张 `原BOM` 只作原版对照，第二张 `Sheet1` 是整理后标准。
- `Sheet1` 首行 13 列逐字固定为：序号、项目号、板子类型、内部型号、物料规格描述、品牌、用量、替代料、供应商、订单数量、需求数量、购买数量、库存数；后续分段发生的列位变化统一映射回这 13 列。
- 8 份来源表与 `SELFHOST-LANDING-TASK02` manifest 的文件名、大小、inode、mode、uid/gid、mtime 和 SHA-256 全部一致；模板处理前后也完全不变。
- 来源 13 个 Sheet、1,113 行：160 行归档、953 行非归档物料来源；既有分类为 515 行整体合格、438 行待确认，物料级 806/147、BOM 级 488/291。

## 输出内容

- 输出文件：`/opt/erp/shujvbiao/内部物料库.xlsx`，345,691 bytes、root:root `0600`，SHA-256 `01d0239afc9dd5650fb577457c7c2ef85978fd59e8ca1d1b30ff9ba6527b5fa0`。
- `内部物料库` 724 行：532 个既有正式编码、147 个逐来源隔离候选、45 个模板隔离候选。候选正式编码全部为空；正式编码 532/532 唯一且只沿用既有离线映射。
- `标准BOM明细` 997 行：53 条人工模板行加所有未被模板严格承接的来源行。项目号、板型、内部型号和规格描述空值均为 0；110 个不能可靠提取的内部型号明确显示“待确认”，未知用量保持空白。
- `待确认` 484 行：438 条既有来源分类问题、45 条模板无法严格唯一关联问题和 1 条文件名/表内标题版本冲突。没有以名称、相似文本或供应商信息强行归并。
- `来源映射` 1,006 行，完整覆盖 953 条非归档来源和 53 条模板行；每行保留文件、Sheet、原始行号、来源引用、映射依据和标准明细序号。
- `来源与说明` 保存模板语义、输入 SHA、计数和禁止直接入库边界。逐行 root-only 统计报告位于 `/var/lib/chenyida-erp/intake/internal-material-library-20260730/report.json`。

## 数据与安全边界

- 只在模板规格与来源规格、型号或完整 MPN 规范化后严格相等，且只对应单一既有正式编码时建立模板关联；53 条模板行中 8 条通过，45 条 fail closed。
- 供应商只取第二张人工模板的明确供应商字段；来源生产厂商/品牌没有冒充供应商。替代料只保留来源证据，不创建正式替代关系。
- 来源自由备注、电话和联系人未进入结果。工作簿扫描为电话样式 0、敏感连接/凭据 0；外来文本按文本写入，唯一公式是标准明细 K/L 两列的 1,994 个需求/购买数量公式。
- 工作簿无宏、外部链接或来源公式注入；ZIP 完整性和 openpyxl 重新打开均通过。
- `shujvbiao/` 已加入根 `.gitignore`；源表、模板、生成工作簿、逐行业务报告和 root-only 证据均未暂存或提交。

## 工具与验证

- 新增通用离线导出器 `tools/real-bom-import/export-internal-library.py`：固定确认口令、输入 manifest 漂移门禁、稀疏 XLSX 区段读取、第二张模板解析、严格映射、候选隔离、原子输出和自校验。
- 新增合成集成测试，覆盖精确匹配而非子串、保守位号数量、既有编码唯一、候选无正式编码、哈希标识不被电话脱敏误伤、来源/待确认覆盖、模板列和公式合同。
- 专项与既有 classifier：7/7；Python `py_compile`、`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 全部通过，临时目录已自动清理。
- Node：宿主无 Node，首次环境检查在测试启动前返回 127；随后用本机既有 Node 22 镜像、断网、只读挂载、1 CPU/1 GiB、一次一个 `--rm` 容器复验。`npm test` 3/3，lint 0 error/8 个既有 warning，最终 credentials 1,070 个跟踪文件通过。
- 首次 go-live 包装命令因含安全策略禁止的 `rm -rf` 在创建进程前被拒绝；没有创建目录或执行测试，改用 Python `TemporaryDirectory` 保持同一断言后通过。

## 资源与清理

- 导出前约 2.4 GiB available、Swap 47 MiB、根盘可用 33 GiB、Load `0.14/0.29/0.40`；最终约 2.4 GiB/47 MiB/33 GiB、Load `0.79/0.67/0.50`。
- PostgreSQL/Web/Worker/Caddy 全程保持原容器，最终 healthy/healthy/running/running，RestartCount 0、OOMKilled false；任务时段内核 OOM 记录 0。
- 两个早期只读 openpyxl 探查进程因 A118 异常声明整表宽度而被精确终止，随后改为稀疏 XML；最终没有 Python 探查、Node 测试容器或 `/tmp/cyd-task06-*` 临时目录残留。
- 四个受保护持久卷未修改或删除；未执行 prune、缓存清理、服务重启或生产访问。
