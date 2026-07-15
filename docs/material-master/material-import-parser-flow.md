# Material Import Parser 与 Mapping V1 流程图

状态：`APPROVED / PHASE2-TASK04 IMPLEMENTED IN NON-PRODUCTION`

业务与资源决定：`Status: APPROVED`

本图是 `PHASE2-TASK04` 非生产实施契约；生产 Queue、binding、migration 和部署仍未授权。

## 1. 业务状态

```mermaid
stateDiagram-v2
    [*] --> FILE_READY
    FILE_READY --> QUEUED_FOR_PARSING: parse API\nD1 CAS + pending Outbox
    QUEUED_FOR_PARSING --> PARSING: consumer obtains lease
    PARSING --> PARSED: atomic publish of verified parse_run
    PARSED --> AWAITING_MAPPING: mapping preparation CAS publish
    AWAITING_MAPPING --> MAPPING_CONFIRMED: user confirms mapping

    QUEUED_FOR_PARSING --> CANCELLED: cancel wins CAS
    PARSING --> CANCELLED: cooperative cancel wins before publish
    QUEUED_FOR_PARSING --> FAILED: terminal parser failure
    PARSING --> FAILED: malformed file or resource limit

    note right of PARSED
      Current allowed visible Sheets are fully published.
      Mapping preparation may still be running or failed.
      Raw rows are readable; Mapping cannot be confirmed.
    end note
```

## 2. D1、Outbox 与 Queue 边界

```mermaid
sequenceDiagram
    autonumber
    participant U as Authorized user
    participant API as Import API
    participant D1 as D1
    participant O as Outbox dispatcher
    participant Q as Queue adapter
    participant W as Parser worker

    U->>API: POST /parse + Idempotency-Key + expected_version
    API->>D1: transaction: create parse_run + PENDING outbox<br/>batch FILE_READY -> QUEUED_FOR_PARSING<br/>event + audit + idempotency result
    D1-->>API: committed
    API-->>U: 202 Accepted

    O->>D1: claim pending outbox by CAS
    O->>Q: send job(job_id, parse_run_id, stage)
    alt send confirmed
      O->>D1: CAS outbox -> DISPATCHED
    else failed or result unknown
      O->>D1: RETRY_WAIT or leave reclaimable
      O->>Q: safe duplicate send later
    end

    Q->>W: at-least-once job
    W->>D1: claim batch/run/stage lease
    W->>D1: save durable stage result and next pending outbox
    W-->>Q: explicit ack only after durable save
```

不存在“D1 创建 run 与 Queue 发送原子完成”的分布式事务。发送结果未知时允许重复消息，消费者以 `job_id + parse_run_id + stage` 幂等吸收。

## 3. Parser 持久阶段

```mermaid
flowchart TD
    A["INSPECT_WORKBOOK<br/>enumerate entries, workbook and Sheet metadata"]
    B["PREPARE_SHARED_RESOURCES<br/>bounded Shared Strings and styles"]
    C{"Next allowed visible Sheet?"}
    D["PARSE_SHEET<br/>bind batch, run, sheet and lease"]
    E["Write run-isolated raw rows<br/>progress, bytes, hashes and heartbeat"]
    F{"Sheet complete and verified?"}
    G["Mark Sheet complete"]
    H["VERIFY_PARSE_RUN<br/>counts, hashes and resource budgets"]
    I["PUBLISH_PARSE_RUN<br/>atomic current pointer switch"]
    J["PARSED"]
    K["PREPARE_MAPPING<br/>suggest Sheet/header and create draft"]
    L["PUBLISH_MAPPING_PREPARATION<br/>CAS current run and batch version"]
    M["AWAITING_MAPPING"]

    A --> B --> C
    C -->|yes| D --> E --> F
    F -->|yes| G --> C
    F -->|interrupted| R["Restart only the current incomplete Sheet"] --> D
    C -->|no| H --> I --> J --> K --> L --> M
```

每 500 行或约 10 秒保存的是观测、预算、心跳和幂等写入进度，不是可序列化 SAX/ZIP 游标。任务中断时从头重跑当前未完成 Sheet；已完成 Sheet 不重写。

## 4. 原始行隔离与发布

```mermaid
flowchart LR
    F["Existing current parse_run<br/>SUCCEEDED"]
    N["New parse_run<br/>QUEUED -> RUNNING"]
    S["Run-isolated Sheet metadata,<br/>Shared Strings and raw rows"]
    V["STAGED<br/>all allowed Sheets complete"]
    T{"Single D1 publish transaction"}
    P["New run SUCCEEDED<br/>batch.current_parse_run_id switched<br/>batch PARSED + version increment<br/>event + audit + idempotency<br/>PREPARE_MAPPING Outbox"]
    X["Old run SUPERSEDED<br/>rows retained for audit/retention"]
    E["Rollback<br/>old current result remains valid"]

    N --> S --> V --> T
    F --> T
    T -->|all guards pass| P
    T -->|all guards pass| X
    T -->|guard or write fails| E
```

发布事务核验允许的可见 Sheet、行数、哈希、总规范化字节、总解码文本、Shared Strings、warning/error 预算、租约、批次状态与版本。失败 run 不切换 current pointer，也不得删除已成功发布的旧 run。

## 5. 隐藏 Sheet 与 PARSED 范围

```mermaid
flowchart TD
    W["Workbook Sheets"] --> V["VISIBLE"]
    W --> H["HIDDEN"]
    W --> VH["VERY_HIDDEN"]
    V --> VM["Save metadata and business rows<br/>eligible for suggestion and Mapping"]
    H --> HM["Save safe metadata and skipped warning only"]
    VH --> VHM["Save safe metadata and skipped warning only"]
    HM --> N["Not eligible for Mapping"]
    VHM --> N
```

`PARSED` 汇总分别记录 workbook、visible、hidden、very-hidden、parsed、skipped Sheet 数以及 parsed rows 和 skipped warnings。

## 6. Shared Strings 有界读取

```mermaid
flowchart LR
    XML["sharedStrings.xml stream"] --> C["Decode with item/byte limits"]
    C --> B["Run-level bounded chunks"]
    B --> D1["Recommended candidate:<br/>D1 temporary Shared Strings table"]
    D1 --> P["Chunk prefetch by index range"]
    P --> L["Bounded LRU/window cache"]
    L --> S["PARSE_SHEET"]

    R2["Alternative after separate approval:<br/>R2 chunk index object"] -.-> P
```

禁止为每个单元格单独查询 D1，也禁止默认将 200,000 项全部作为 JavaScript 字符串常驻内存。

## 7. Mapping 准备失败与恢复

```mermaid
stateDiagram-v2
    [*] --> NOT_STARTED
    NOT_STARTED --> QUEUED: parse publish writes Outbox
    QUEUED --> RUNNING: preparation lease
    RUNNING --> READY: suggestions and mapping draft CAS published
    RUNNING --> FAILED: safe preparation failure
    FAILED --> QUEUED: internal coordinator or manual operations retry
    READY --> [*]

    note right of FAILED
      Batch remains PARSED.
      Do not reread the original file.
      Do not rewrite material_import_rows.
      Retry only for current_parse_run_id.
    end note
```

`PUBLISH_MAPPING_PREPARATION` 只有在 `parse_run_id == batch.current_parse_run_id` 且批次版本匹配时才能把批次推进到 `AWAITING_MAPPING`。

## 8. Mapping 编辑、确认与重新解析

```mermaid
sequenceDiagram
    autonumber
    participant U as Mapping user
    participant API as Mapping API
    participant D1 as D1

    U->>API: PUT mapping<br/>batch version + parse_run + mapping version
    API->>D1: validate current run, Sheet/header,<br/>target allowlist and metadata
    D1-->>API: DRAFT mapping version + 1

    U->>API: POST mapping/preview (bounded rows)
    API->>D1: read current run raw sample
    API-->>U: raw-to-target candidates and explicit issues

    U->>API: POST mapping/confirm<br/>batch/run/mapping/metadata versions
    API->>D1: transaction: revalidate metadata and CAS<br/>mapping CONFIRMED + batch MAPPING_CONFIRMED<br/>event + audit + idempotency
    D1-->>API: confirmed result
```

新 parse run 只允许从 `PARSED` 或 `AWAITING_MAPPING` 的后续显式操作开始。新 run 发布后，旧 Mapping 转 `STALE` 或 `SUPERSEDED` 并保留审计；历史 Mapping 和其绑定旧 run 的预览能力只供受控审计 Repository/运维使用，V1 不新增公开历史枚举端点。`MAPPING_CONFIRMED` 在 V1 禁止重新解析。

## 9. 失败分类

```mermaid
flowchart TD
    E{"Failure stage"}
    E -->|inspect/shared resources/Sheet/verify/publish| P["IMPORT_PARSE_*<br/>run FAILED, never PARSED"]
    E -->|prepare/publish mapping preparation| M["IMPORT_MAPPING_PREPARATION_FAILED<br/>batch remains PARSED"]
    E -->|user mapping edit/preview/confirm| U["IMPORT_MAPPING_*<br/>batch remains AWAITING_MAPPING"]

    P --> C["Clean unpublished run data<br/>retain bounded safe summary"]
    M --> R["Retry preparation only"]
    U --> F["Return safe error with request_id"]
```

所有错误响应都必须截断并脱敏，不包含堆栈、SQL、ZIP/XML 内部路径、对象凭证、Token、完整公式或恶意单元格内容。

## 10. 实施与生产门禁

```mermaid
flowchart LR
    S["Specification confirmed"] --> I["Separate implementation authorization"]
    I --> C["Library/runtime compatibility matrix"]
    C --> M["0005 + migration tests"]
    M --> T["Parser/Mapping isolated tests and load tests"]
    T --> P["Separate production Queue/R2/D1/deployment approval"]
```

`PHASE2-TASK04` 已完成到隔离 Parser/Mapping 测试节点；生产 Queue/R2/D1 migration 和部署审批节点未开始。
