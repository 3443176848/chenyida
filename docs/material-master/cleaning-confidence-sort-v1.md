# 清洗审核匹配置信度排序 V1

任务：`PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01`

状态：`DONE / DEPLOYED TO DEVELOPMENT SERVER`

日期：2026-07-18（Asia/Shanghai）

## 范围

在服务器本地 ERP 的“清洗审核”列表增加匹配置信度排序，不改变 Mapping、
规格提取、审核、物料建档或数据库结构。

## 行为

- 默认：最新记录，`id DESC`。
- 由高到低：`confidence DESC, id DESC`。
- 由低到高：`confidence ASC, id DESC`。
- 同一置信度下，较新的记录优先，保证结果稳定。
- 排序字段是清洗列表的“匹配置信度”，不是“规格置信度”。
- 服务端先对完整查询结果排序，再应用 500 条列表上限；浏览器不对局部数组
  做伪全量排序。

## API

`GET /api/cleaning` 增加白名单查询参数：

- `confidence_sort=newest`
- `confidence_sort=desc`
- `confidence_sort=asc`

未知值安全回退为 `newest`。SQL 排序片段只来自服务端固定白名单，用户输入
不会直接拼入 SQL。

## 页面

“清洗审核”右上角增加“匹配置信度排序”下拉框：

- 最新记录
- 由高到低
- 由低到高

切换时只重新请求和渲染清洗列表，不刷新其他 ERP 模块。

## 验证

- 排序单元测试 4/4：升序、降序、同分稳定顺序、排序后限制及未知值回退。
- Smoke 覆盖 API 升序、降序与未知值回退。
- `server.py --self-test`、`smoke_test.py`、`go_live_check.py` 通过。
- systemd `enabled/active`，公网 HTML 与 JavaScript 已包含排序控件和查询参数。
- 部署核对期间，项目负责人已重新导入 V700，产生 229 条 Cleaning Rows、
  21 个置信度层级（0.00～1.00）；真实开发库的升序和降序序列均通过检查。
