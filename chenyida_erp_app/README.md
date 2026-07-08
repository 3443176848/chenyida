# 晨亿达 ERP 本地应用

这是晨亿达 ERP 的第一阶段可运行产品，当前聚焦“物料主数据治理、产品/BOM、采购、库存、生产协同、品质检验和销售交付闭环”。

## 已实现范围

- 内部标准物料库
- 供应商物料映射
- 供应商 CSV 批量导入
- 自动匹配、疑似匹配、新物料分流
- 清洗审核：确认映射、新建物料
- 产品工程卡：客户、产品类型、版本、层数、板厚、线宽、孔径、表面处理
- BOM 管理：BOM 主表、BOM 明细、单件用量、损耗率、工序阶段
- 齐套检查：按订单数量计算需求、可用库存和缺料数量
- 采购与库存：按 BOM 缺料生成采购建议，按供应商生成采购单，采购收货后自动增加库存
- 库存余额：查看现有库存、已预留数量、可用库存和更新时间
- 生产协同：按 BOM 生成生产工单，展开工单用料，按工单领料扣减原材料库存
- 完工入库：生产报工后自动生成成品物料并增加成品库存
- 品质管理：记录 IQC 来料、IPQC 过程和 FQC 成品检验，跟踪不良类型、责任环节和处置方式
- 销售交付：创建客户销售订单，按成品库存出货，出货后自动扣减成品库存并更新订单状态
- SQLite 本地数据库
- 浏览器操作界面
- CSV 导出

## 启动方式

推荐使用前台启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\run_server.ps1
```

看到启动提示后，保持这个窗口打开，然后访问：

```text
http://127.0.0.1:8765
```

后台启动脚本也已提供。如果本机允许后台常驻进程，可使用：

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\start_server.ps1
```

停止后台服务：

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\stop_server.ps1
```

也可以直接用 Python 前台启动：

```powershell
$py='C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py D:\erp\chenyida_erp_app\server.py
```

启动后打开：

```text
http://127.0.0.1:8765
```

## 数据位置

默认数据库：

```text
D:\erp\chenyida_erp_app\data\erp.sqlite3
```

首次启动会从以下模板导入初始数据：

```text
D:\erp\物料主数据治理落地包\templates
```

## 验证

```powershell
$py='C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py D:\erp\chenyida_erp_app\server.py --self-test
& $py D:\erp\chenyida_erp_app\smoke_test.py
```

如需做浏览器界面验证，并且本机已安装 Microsoft Edge：

```powershell
$node='C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node D:\erp\chenyida_erp_app\ui_smoke_test.mjs
```

验证通过后会生成界面截图：

```text
D:\erp\chenyida_erp_app\data\ui-smoke\quality-ui.png
```
