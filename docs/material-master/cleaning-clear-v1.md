# 清洗审核安全清空 V1

任务：`PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01`

状态：`DONE / DEPLOYED TO DEVELOPMENT SERVER`

日期：2026-07-18（Asia/Shanghai）

## 范围

在服务器本地 ERP 的“清洗审核”增加清空全部 Cleaning Rows 的管理员功能。
不删除导入批次、不可变原始行、归档原文件、内部物料或供应商映射。

## 安全边界

- 仅管理员可见按钮；服务端要求 `system` 权限，不能依赖页面隐藏。
- 浏览器使用明确确认对话框。
- API 还要求请求体 `confirmation=CLEAR_CLEANING_ROWS`，缺失时返回
  `CLEANING_CLEAR_CONFIRMATION_REQUIRED`，不删除任何记录。
- 执行清空前自动创建 SQLite 数据库备份。
- 删除和审计日志在同一 `BEGIN IMMEDIATE` 事务中完成；失败整体回滚。
- 审计记录操作者、删除行数和时间，不记录供应商业务正文。

## API

`POST /api/cleaning/clear`

请求：

```json
{
  "confirmation": "CLEAR_CLEANING_ROWS"
}
```

成功响应包含：

- `deleted_count`
- 自动备份的名称、大小和创建时间

## 页面

“清洗审核”右上角为管理员显示“清空清洗记录”。队列为空时按钮禁用。
确认文案明确说明会保留 Import Batch、Raw Rows 和归档原文件。

## 验证

- 清空单元测试 3/3：删除与审计、空队列幂等、系统权限。
- 与置信度排序联合单元 7/7。
- Smoke 覆盖缺确认拒绝且数据不变、成功自动备份、删除计数和清空结果。
- `server.py --self-test`、`go_live_check.py` 继续作为完整基线执行。
- systemd `enabled/active`，公网 HTML/JavaScript 已包含管理员按钮和确认逻辑。
- 部署过程中没有调用真实清空接口；当前 229 条 V700 Cleaning Rows 保持不变。
