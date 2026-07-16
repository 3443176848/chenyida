# Material Import Normalization V1 数据流与状态图

> 任务：`PHASE3-TASK02`
> 状态：`APPROVED / IMPLEMENTED (NON-PRODUCTION)`；对应运行时、`0006` 与隔离测试，不代表生产已迁移或部署。

## 1. 端到端数据流

```mermaid
flowchart LR
    U["有 normalize 能力的操作者"] -->|"POST normalize\nexpected_version + processor_version\nIdempotency-Key + CSRF"| API["Normalization API"]
    API --> AUTH["认证、能力、行级可见性、限流"]
    AUTH --> SNAP["锁定事实快照\nbatch/current parse run\nconfirmed mapping/version\nmetadata digest"]
    SNAP --> TX1["D1 启动事务\ncreate normalization run\nwrite Outbox/event/audit/idempotency\nCAS batch"]
    TX1 --> DISP["可注入 Outbox dispatcher"]
    DISP --> Q["Queue 或隔离调度器\nat-least-once"]
    Q --> W["Normalization worker\n租约 + heartbeat + CAS"]

    MAP[("material_import_mappings\n+ mapping_items")] --> W
    RAW[("current material_import_rows\n不可变原始 cell")] --> W
    META[("Mapping Target Registry\nMetadata Snapshot") ] --> W

    W --> STAGE[("run-scoped normalized_rows\nrun-scoped issues\n处理中隔离")]
    STAGE --> VERIFY["完整性与资源核验\n行数/计数/hash/pointers/digest/lease"]
    VERIFY -->|"失败、取消或事实漂移"| KEEP["run FAILED/CANCELLED\n不切 current pointer"]
    VERIFY -->|"全部通过"| TX2["D1 原子发布事务"]
    TX2 --> CUR[("batch.current_normalization_run_id\n指向 SUCCEEDED run")]
    TX2 --> EVT[("业务事件 + API/系统审计\n幂等结果")]
    CUR --> GET["GET summary / rows / row detail / issues\n只读 current published run"]

    GET -.-> FUTURE["后续分类、匹配、Draft 任务\n本任务不实施"]
```

## 2. 批次状态机

```mermaid
stateDiagram-v2
    [*] --> MAPPING_CONFIRMED: Mapping 已确认
    MAPPING_CONFIRMED --> QUEUED_FOR_NORMALIZATION: 启动事务成功
    QUEUED_FOR_NORMALIZATION --> NORMALIZING: Worker 取得有效租约
    NORMALIZING --> NORMALIZED: 完整核验与原子发布成功

    QUEUED_FOR_NORMALIZATION --> CANCELLED: 首次运行取消 CAS 胜出
    NORMALIZING --> CANCELLED: 首次运行协作式取消

    QUEUED_FOR_NORMALIZATION --> MAPPING_CONFIRMED: 首次 run 执行失败
    NORMALIZING --> MAPPING_CONFIRMED: 首次 run 执行失败

    NORMALIZED --> QUEUED_FOR_NORMALIZATION: 新 processor_version 显式重跑
    QUEUED_FOR_NORMALIZATION --> NORMALIZED: 重跑失败/取消，保留旧 current run
    NORMALIZING --> NORMALIZED: 重跑失败/取消，保留旧 current run

    note right of NORMALIZED
      可包含 ERROR 行。
      只表示完整结果已发布，
      不表示分类、匹配、Draft
      或正式导入完成。
    end note
```

批次不新增 `NORMALIZATION_FAILED`。执行失败属于 normalization run；行级业务错误属于 normalized row。这样不会把可重试执行故障误当作批次终态 `FAILED`，也不会触发错误的清理/保留语义。

## 3. Normalization run 状态机

```mermaid
stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> RUNNING: claim lease
    RUNNING --> RUNNING: heartbeat / chunk checkpoint
    RUNNING --> STAGED: 全部目标行已暂存
    STAGED --> PUBLISHING: 发布 CAS
    PUBLISHING --> SUCCEEDED: 原子切换 current pointer
    SUCCEEDED --> SUPERSEDED: 新成功 run 发布

    QUEUED --> CANCELLED: cancel CAS
    RUNNING --> CANCELLED: 协作式取消
    STAGED --> CANCELLED: 发布前取消

    QUEUED --> FAILED: 不可恢复执行失败
    RUNNING --> FAILED: 资源/内部/事实错误
    STAGED --> FAILED: 完整性核验失败
    PUBLISHING --> FAILED: 发布未提交且判定失败

    note right of FAILED
      current_normalization_run_id
      从不指向 FAILED/CANCELLED run。
    end note
```

## 4. 持久阶段与 Outbox

```mermaid
sequenceDiagram
    participant API as Normalize API
    participant DB as D1
    participant O as Outbox Dispatcher
    participant Q as Queue / Isolated Scheduler
    participant W as Worker

    API->>DB: transaction: run QUEUED + START_NORMALIZATION + batch CAS + idempotency
    DB-->>API: committed 202 operation
    API->>O: best-effort dispatch hint
    O->>DB: claim pending Outbox by dispatch_version
    O->>Q: send stable IDs only
    Q->>W: at-least-once message
    W->>DB: claim run lease / CAS batch NORMALIZING
    W->>DB: LOAD_MAPPING and verify bound snapshot
    loop bounded source chunks
        W->>DB: READ_SOURCE_ROWS by parse_run + sheet + row range
        W->>DB: idempotent normalized rows/issues + checkpoint + next Outbox
    end
    W->>DB: VERIFY_RESULT counts, hashes, limits, pointers, digest
    W->>DB: PUBLISH_RESULT atomic batch
    DB-->>W: SUCCEEDED + current pointer + event/audit
    W-->>Q: ack only after durable state
```

逻辑阶段为 `LOAD_MAPPING`、`READ_SOURCE_ROWS`、`NORMALIZE_ROWS`、`VERIFY_RESULT`、`PUBLISH_RESULT`。Outbox job type 可以合并读行与规范化为 `NORMALIZE_ROW_CHUNK`；run 的 `current_stage` 仍保存业务阶段。一个逻辑 100 行块不等于单条 100 行 INSERT，实际语句必须按 D1 绑定参数和字节预算拆分。

## 5. 原子发布边界

```mermaid
flowchart TD
    A["run 已 STAGED"] --> B{"租约仍有效？"}
    B -- 否 --> X["停止；不切 pointer"]
    B -- 是 --> C{"parse run / mapping id+version+status / metadata digest 未变？"}
    C -- 否 --> X
    C -- 是 --> D{"全部目标行、计数、hash、issue 与资源预算一致？"}
    D -- 否 --> X
    D -- 是 --> E{"batch status + expected_version + cancel guard 匹配？"}
    E -- 否 --> X
    E -- 是 --> T["单一 D1 batch 事务"]
    T --> T1["旧 current run -> SUPERSEDED（若有）"]
    T --> T2["当前 run -> SUCCEEDED"]
    T --> T3["切 current_normalization_run_id"]
    T --> T4["batch -> NORMALIZED\ncurrent_version + 1"]
    T --> T5["event + audit + idempotency result"]
    T5 --> OK["发布完成"]
```

事务中的任一步失败时全部回滚。处理中的 run-scoped 行与 issue 可以保留供安全诊断/重试或由受控清理删除，但公共查询永远不会把它们当成 current 结果。

## 6. 取消竞争

```mermaid
sequenceDiagram
    participant U as User
    participant API as Cancel API
    participant DB as D1
    participant W as Worker

    par cancel
        U->>API: cancel + expected_version + idempotency
        API->>DB: CAS batch/run and revoke lease
    and publish
        W->>DB: publish with lease + expected_version + all bindings
    end
    alt cancel CAS wins
        DB-->>API: CANCELLED or restore prior NORMALIZED
        DB-->>W: publish CAS fails
    else publish CAS wins
        DB-->>W: NORMALIZED committed
        DB-->>API: state conflict; no false cancellation
    end
```

取消是协作式的：不能承诺立即终止正在运行的 isolate 或已投递 Queue 消息。安全保证是取消 CAS 胜出后，旧租约和旧消息不能发布。

## 7. 下游边界

Normalization 输出是候选快照，不是物料主数据：

```text
normalized row
  -> future category proposal/confirmation
  -> future candidate matching/dedup review
  -> future Material Draft construction
  -> existing Material Validation with real category_id
  -> existing Draft/Review write service
```

任何后续阶段都必须保留 `normalization_run_id + normalized_row_id + payload_hash` lineage。不得把 `category_hint` 当 `category_id`，不得绕过 Material Validation、Draft/Review 或正式编码事务。
