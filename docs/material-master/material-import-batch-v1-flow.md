# Material Import Batch Foundation V1 数据流与状态图

- 任务编号：`PHASE2-TASK01`
- Status: `PROPOSED`
- 实施状态：未实施

本文件是 `material-import-batch-v1.md` 的图形化补充。图中所有组件、状态与迁移均为待审阅设计，不表示仓库已经具备 R2 或上传能力。

## 1. 组件与信任边界

```mermaid
flowchart LR
    U["已认证浏览器用户"]
    W["Worker API\n鉴权 / CSRF / 限流 / CAS / 流式接收"]
    D[("D1\n批次 / 文件元数据 / 幂等 / 事件 / 原始行契约")]
    R[("私有 R2\n原始文件对象")]
    P["PHASE2-TASK02\n后续解析器（不属于本任务）"]
    C["受控协调与清理任务\n后续实现"]

    U -->|"JSON 创建 / multipart 单文件 / 查询 / 取消"| W
    W -->|"事务、CAS、行级权限"| D
    W -->|"putIfAbsent / head / delete\n不公开 object_key"| R
    P -.->|"只在 FILE_READY 后读取"| R
    P -.->|"写 material_import_rows"| D
    C -.->|"核对与状态修复"| D
    C -.->|"HEAD / 受控读取 / 删除"| R

    subgraph B["服务端信任边界"]
      W
      D
      R
      C
    end
```

约束：

- 浏览器永远不获取 R2 凭证、公开 URL 或可直接访问的 object key。
- D1 与 R2 没有分布式事务；虚线任务代表未来受控后台能力，不在本任务创建。
- 测试以可注入的内存/隔离对象存储替身代替 R2，不连接生产 binding。

## 2. 正常上传数据流

```mermaid
sequenceDiagram
    autonumber
    actor U as 浏览器用户
    participant W as Worker API
    participant D as D1
    participant R as 私有 R2

    U->>W: POST /import-batches + Idempotency-Key
    W->>W: 会话 / 权限 / Origin / CSRF / 限流
    W->>D: 原子创建 CREATED 批次、幂等结果、BATCH_CREATED
    D-->>W: batch + version=1
    W-->>U: 201 + request_id + batch

    U->>W: POST /{id}/file multipart<br/>expected_version + declared SHA + duplicate_action
    W->>W: 有界读取 part headers<br/>构造规范化摘要（不含 boundary/原始字节）
    W->>D: 原子登记上传意图<br/>文件 UPLOAD_PENDING / 批次 UPLOAD_PENDING<br/>FILE_UPLOAD_STARTED / version+1
    D-->>W: file_id + deterministic object_key
    W->>R: HEAD object_key（不可覆盖）
    alt 对象不存在
        W->>R: 流式 putIfAbsent<br/>实际计数 + SHA-256 + 类型探测
        R-->>W: stored metadata
    else 对象已存在且哈希/大小匹配
        R-->>W: existing matching metadata
        Note over W,R: 响应丢失后的恢复，不重复 PUT
    else 对象已存在但不一致
        R-->>W: mismatch
        W->>D: RECONCILIATION_REQUIRED + 事件
        W-->>U: 202 协调状态，不返回成功
    end

    W->>W: 比较声明 SHA 与实际 SHA
    alt 哈希不一致
        W->>D: 记录 IMPORT_FILE_HASH_MISMATCH<br/>DELETE_PENDING 或 RECONCILIATION_REQUIRED
        W-->>U: 422，绝不 FILE_READY
    else 哈希一致
        W->>D: 原子记录 STORED + 实际 SHA/大小/类型<br/>security=PENDING / batch=SECURITY_CHECK_PENDING<br/>FILE_STORED / version+1
        W->>R: 对已存对象做文件级基础检查
        alt 基础检查通过
            W->>D: 原子 security=BASIC_CHECK_PASSED<br/>batch=FILE_READY<br/>两个完成事件 / version+1 / 幂等完成
            W-->>U: 200 FILE_READY + request_id
        else 基础检查拒绝
            W->>D: security=REJECTED<br/>failure_stage=FILE_SECURITY / batch=FAILED<br/>FILE_SECURITY_CHECK_FAILED / DELETE_PENDING
            W-->>U: 422 安全错误码
        end
    end
```

`R2 stored`、`D1 STORED` 与 `BASIC_CHECK_PASSED` 是不同事实。只有三者全部满足相关不变量，批次才可进入 `FILE_READY`。

## 3. 批次状态机

```mermaid
stateDiagram-v2
    [*] --> CREATED: BATCH_CREATED
    CREATED --> UPLOAD_PENDING: 登记上传意图
    CREATED --> CANCELLED: 取消 CAS 成功

    UPLOAD_PENDING --> SECURITY_CHECK_PENDING: R2 成功且 D1 记录 STORED
    UPLOAD_PENDING --> FAILED: 确定的存储失败
    UPLOAD_PENDING --> CANCELLED: 取消 CAS 先赢
    UPLOAD_PENDING --> RECONCILIATION_REQUIRED: 结果不确定或对象不一致

    SECURITY_CHECK_PENDING --> FILE_READY: 基础安全检查通过
    SECURITY_CHECK_PENDING --> FAILED: 基础安全检查拒绝
    SECURITY_CHECK_PENDING --> CANCELLED: 取消 CAS 先赢
    SECURITY_CHECK_PENDING --> RECONCILIATION_REQUIRED: D1/R2 或竞争结果不确定

    FILE_READY --> CANCELLED: V1 获批范围内取消
    FILE_READY --> RECONCILIATION_REQUIRED: 后续发现证据不一致

    RECONCILIATION_REQUIRED --> FILE_READY: 受控协调且安全检查已通过
    RECONCILIATION_REQUIRED --> FAILED: 受控协调确认失败
    RECONCILIATION_REQUIRED --> CANCELLED: 受控协调确认取消

    FAILED --> [*]
    CANCELLED --> [*]
```

终态规则：

- `FAILED`、`CANCELLED` 进入时设置 `terminal_at`，以后不得恢复或清空。
- 失败重试创建新批次，并设置 `retry_of_batch_id`；旧批次保持不变。
- `CANCELLED` 不是“对象已删除”的同义词。
- `QUEUED_FOR_PARSING` 至 `COMPLETED` 等状态仅为路线图，不加入 V1 CHECK。

## 4. 文件双状态机

```mermaid
stateDiagram-v2
    state Storage {
        [*] --> UPLOAD_PENDING
        UPLOAD_PENDING --> STORED: R2 与实际元数据已确认
        UPLOAD_PENDING --> STORAGE_FAILED: 确定的 R2 失败
        UPLOAD_PENDING --> RECONCILIATION_REQUIRED: 结果不确定
        STORED --> DELETE_PENDING: 取消 / 拒绝 / 保留到期
        STORED --> RECONCILIATION_REQUIRED: 证据不一致
        STORAGE_FAILED --> DELETE_PENDING: 发现残留对象
        RECONCILIATION_REQUIRED --> STORED: 协调确认同一对象
        RECONCILIATION_REQUIRED --> DELETE_PENDING: 协调决定清理
        DELETE_PENDING --> DELETED: 对象删除确认
        DELETE_PENDING --> RECONCILIATION_REQUIRED: 删除结果不确定
        DELETED --> [*]
    }

    state SecurityCheck {
        [*] --> NOT_STARTED
        NOT_STARTED --> PENDING: D1 已记录 STORED
        PENDING --> BASIC_CHECK_PASSED: 文件级检查通过
        PENDING --> REJECTED: 文件级检查拒绝
        BASIC_CHECK_PASSED --> [*]
        REJECTED --> [*]
    }
```

批次 `FILE_READY` 不变量：

```text
storage_status == STORED
AND security_check_status == BASIC_CHECK_PASSED
AND actual_sha256 IS NOT NULL
AND actual_size_bytes > 0
AND detected_file_type IN ('XLSX', 'CSV')
```

## 5. R2 成功、D1 完成失败的恢复

```mermaid
flowchart TD
    A["请求携带相同 Idempotency-Key"] --> B["读取 PENDING 记录、batch/file 状态和 lease"]
    B --> C{"lease 可接管？"}
    C -->|否| D["返回 IDEMPOTENCY_REQUEST_IN_PROGRESS"]
    C -->|是| E["HEAD 确定性 object_key"]
    E --> F{"对象存在？"}
    F -->|否| G{"D1 是否允许重新接收字节？"}
    G -->|是| H["同一上传意图继续流式 PUT"]
    G -->|否或不确定| I["RECONCILIATION_REQUIRED"]
    F -->|是| J{"安全元数据的 SHA 与大小匹配？"}
    J -->|否| I
    J -->|是| K["不重复 PUT，重放 D1 STORED 完成"]
    K --> L["执行或恢复基础安全检查"]
    L --> M{"通过？"}
    M -->|是| N["原子进入 FILE_READY 并完成幂等响应"]
    M -->|否| O["安全拒绝、FAILED、受控删除"]
```

禁止行为：

- 看到同 key 就盲目重新 PUT。
- 对已存在、元数据不一致的 object key 执行覆盖。
- 因 D1 完成失败就把已经存储的对象当作永久丢失。
- 在安全检查未通过时通过协调直接进入 `FILE_READY`。

## 6. 取消与上传完成竞争

```mermaid
sequenceDiagram
    autonumber
    participant C as 取消请求
    participant D as D1 CAS
    participant U as 上传完成请求
    participant R as R2

    par 并发竞争
        C->>D: expected_version=v, status in allowed -> CANCELLED
        U->>D: expected_version=v, UPLOAD_PENDING -> SECURITY_CHECK_PENDING/FILE_READY
    end

    alt 取消 CAS 先成功
        D-->>C: CANCELLED, version=v+1, terminal_at set
        D-->>U: CAS 0 rows
        U->>R: 若对象已存在，保留证据并请求受控删除
        U->>D: DELETE_PENDING 或 RECONCILIATION_REQUIRED + 事件
        Note over U,D: 不允许后到完成把批次改回 FILE_READY
    else 上传完成 CAS 先成功
        D-->>U: 最新状态与 version=v+1
        D-->>C: CAS 0 rows
        C->>D: 重新读取、按最新状态和版本判断
        Note over C,D: FILE_READY 若仍允许取消，用户须基于新版本重试
    end
```

## 7. 终态、保留与清理

```mermaid
flowchart LR
    T["进入 FAILED / CANCELLED / 未来 COMPLETED"] --> S["同一 D1 事务设置 terminal_at"]
    S --> R1["raw_data_retention_until\n建议 terminal_at + 30 天"]
    S --> R2["record_retention_until\n建议 terminal_at + 1095 天"]
    R1 --> Q["到期扫描 + CAS -> DELETE_PENDING"]
    Q --> DR["删除私有 R2 对象"]
    DR -->|成功| DD["D1 -> DELETED\nFILE_DELETED"]
    DR -->|失败/不确定| DF["保持可恢复状态\nFILE_DELETE_FAILED / 协调"]
    R1 --> RR["分块、幂等删除原始行"]
    DD --> EH["保留批次和事件历史"]
    RR --> EH
    R2 -.-> AR["独立、受控的长期归档/删除流程\n不得由原始对象清理顺带执行"]
```

两个保留期限均为 `PROPOSED`；图示不代表已经配置生命周期规则或清理任务。

## 8. 实施前验证门槛

- 12 项决定逐项由用户选择，并收到统一回复“规格确认”。
- 另行审阅版本化 Migration、R2 环境隔离、binding 和生产创建计划。
- 使用脱敏 PCB/FPC/SMT 历史文件样本验证 10 MiB 上限、编码、ZIP 展开边界和解析成本。
- 使用隔离 D1 与对象存储替身覆盖全部 Saga、取消、孤立对象和清理故障。
- 任何生产 bucket、binding、密钥、迁移或部署都需要新的显式授权。
