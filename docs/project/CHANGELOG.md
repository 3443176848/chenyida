# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-07-11

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
