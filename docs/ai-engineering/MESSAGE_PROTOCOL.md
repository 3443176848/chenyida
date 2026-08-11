# Agent Message Contract v1

## 1. 目标

Agent之间只通过有界结构化消息交接。聊天记录、思维过程和“我认为没问题”不能作为控制输入。消息绑定一个任务、一个Agent身份和一个冻结输入；所有重要Claim必须有可复核Evidence。

## 2. 顶层合同

以下字段全部必需；无内容时使用空数组或明确的`null`，不得省略关键语义。

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `schema_version` | string | 固定`erp-agent-message/v1` |
| `message_id` | string | UUID或控制器生成的全局唯一ID |
| `message_type` | enum | `PLAN`、`HANDOFF`、`FINDING`、`VERIFICATION`、`VETO`、`MINORITY_REPORT`、`CHECKPOINT`、`RECOVERY`、`CLOSURE` |
| `created_at` | timestamp | 控制器时间，RFC 3339；Agent不得伪造业务时间 |
| `task_id` | string | 必须匹配active Task Packet |
| `agent` | object | `agent_id`、`instance_id`、`capability_profile`、`context_manifest_digest` |
| `role` | string | Task Packet允许的单一角色 |
| `input` | object | `base_sha`、`candidate_sha`、Task Packet revision、路径/工件摘要 |
| `assumptions` | array | 每项含ID、陈述、来源或待验证状态；不能把假设写成事实 |
| `evidence` | array | 每项含ID、kind、locator、digest/exit_code、observed_at和去敏说明 |
| `changes` | array | 修改路径、动作、目的；只读角色必须为空 |
| `tests` | array | 命令ID、环境、结果、退出码、原始工件引用；未执行原因显式记录 |
| `risks` | array | 严重度、概率、影响、触发条件、缓解和剩余风险 |
| `blockers` | array | 分类、已尝试动作、证据、解除主体；空表示无真阻塞 |
| `recommendation` | object | `decision`、理由、下一有界动作；不能隐含新权限 |
| `status` | enum | `IN_PROGRESS`、`PASS`、`FAIL`、`VETOED`、`BLOCKED`、`COMPLETE`、`RESULT_UNKNOWN` |
| `minority_report` | object/null | 非空时遵守第6节 |

## 3. 示例

```json
{
  "schema_version": "erp-agent-message/v1",
  "message_id": "00000000-0000-4000-8000-000000000001",
  "message_type": "VERIFICATION",
  "created_at": "2026-08-11T12:00:00+08:00",
  "task_id": "EXAMPLE-TASK",
  "agent": {
    "agent_id": "qa-01",
    "instance_id": "attempt-02",
    "capability_profile": "TEST_EXECUTION",
    "context_manifest_digest": "sha256:example-context-digest"
  },
  "role": "Independent Verifier",
  "input": {
    "base_sha": "example-base-sha",
    "candidate_sha": "example-candidate-sha",
    "task_packet_revision": 3,
    "artifacts": ["diff:sha256:example-diff-digest"]
  },
  "assumptions": [],
  "evidence": [
    {
      "id": "E-001",
      "kind": "COMMAND_RESULT",
      "locator": "artifact://EXAMPLE-TASK/qa/test-01.json",
      "digest": "sha256:example-result-digest",
      "exit_code": 0,
      "observed_at": "2026-08-11T12:00:00+08:00",
      "redaction": "no business data"
    }
  ],
  "changes": [],
  "tests": [
    {
      "id": "T-001",
      "command_id": "repo-approved-unit-test",
      "environment": "isolated-read-only-source",
      "result": "PASS",
      "exit_code": 0,
      "artifact": "E-001"
    }
  ],
  "risks": [],
  "blockers": [],
  "recommendation": {
    "decision": "PASS_CURRENT_GATE",
    "reason": "The selected regression evidence matches the frozen candidate.",
    "next_action": "REQUEST_SECURITY_REVIEW"
  },
  "status": "PASS",
  "minority_report": null
}
```

示例摘要是占位值，不是可接受的真实证据。运行时必须校验真实SHA-256、存在的artifact和精确candidate SHA。

## 4. Evidence规则

允许的证据类型包括：

- `GIT_OBJECT`：commit/tree/blob/diff及完整对象ID；
- `FILE_SNAPSHOT`：允许文件的路径、摘要和行号；
- `COMMAND_RESULT`：白名单命令、cwd、环境指纹、exit code、stdout/stderr去敏工件；
- `TEST_REPORT`：测试集合、数量、失败ID、稳定报告摘要；
- `DATABASE_ASSERTION`：仅隔离DB或获准只读环境的查询模板ID、事务模式、汇总与摘要；
- `HTTP_OBSERVATION`：目标环境身份、method/path、状态码、request ID和去敏响应摘要；
- `HUMAN_AUTHORIZATION`：项目文档中可定位的决定/任务状态，不保存聊天秘密或凭据；
- `RESOURCE_SNAPSHOT`：内存、Swap、磁盘、Load、容器restart/OOM和临时资源清单。

Evidence必须可定位、绑定时间和候选SHA、能够由另一身份复核。Agent自然语言总结只能引用Evidence，不能替代Evidence。包含凭据、完整敏感正文、SQL错误堆栈或真实个人信息的工件必须拒绝进入控制存储。

## 5. 消息验证与幂等

- `message_id`不可复用；相同ID不同摘要是安全错误。
- 同一`agent_id + candidate_sha + gate + attempt`最多一个最终消息；补充信息使用新消息并指向被替代消息。
- 不匹配active task、过期capability、错误base/candidate、未知字段、缺少Evidence或违反角色写权限的消息全部拒绝。
- 消息被追加而非原地修改；撤销通过新事件表达。
- 新candidate SHA使旧候选的`PASS`、`VETOED`和测试签核失效，除非控制器记录了精确的、可证明不受影响的复用决定。

## 6. Minority Report合同

`minority_report`非空时至少含：

```json
{
  "claim_id": "MR-001",
  "opposed_claim": "candidate is safe to accept",
  "evidence_refs": ["E-003"],
  "potential_harm": "inventory posting may be duplicated after retry",
  "falsification_test": "inject timeout after commit and replay the same key",
  "requested_disposition": "FIX_OR_ESCALATE"
}
```

Orchestrator必须产生一条引用该`claim_id`的处置消息。没有处置证据时，相关门禁保持未完成。

## 7. 不保存推理历史

消息只保存结论、假设、证据、风险和动作，不要求或保存私有思维链。长期运行依赖结构化检查点和权威文件，而不是无限聊天上下文。
