# 晨亿达 ERP 投用运行手册

## 1. 每天启动

推荐后台启动：

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\start_server.ps1
```

看到 `SERVER_STARTED http://127.0.0.1:8765` 后，打开：

```text
http://127.0.0.1:8765
```

## 2. 登录与初始密码

首次投用先用管理员账号登录：

```text
账号：admin
密码：admin123
```

登录后立刻点击右上角“修改密码”。各岗位初始账号见 `chenyida_erp_app/README.md`。

## 3. 上线检查

启动前可检查数据库、默认账号和备份能力：

```powershell
$py='C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py D:\erp\chenyida_erp_app\go_live_check.py
```

启动后再检查服务是否已经可用：

```powershell
& $py D:\erp\chenyida_erp_app\go_live_check.py --require-running
```

看到 `GO_LIVE_CHECK_OK` 即可投入当天使用。

## 4. 日常业务顺序

1. 采购进入“供应商导入”，贴入或选择供应商 CSV。
2. 工程/采购进入“清洗审核”，确认映射或新建物料。
3. 工程维护“产品工程”和“BOM 管理”。
4. 采购在“采购与库存”生成缺料建议、采购单并收货入库。
5. 生产在“生产协同”生成工单、领料、完工入库。
6. 品质在“品质管理”记录 IQC、IPQC、FQC。
7. 销售在“销售交付”创建订单并按成品库存出货。
8. 财务在“财务结算”生成应收、应付，并登记收款、付款。
9. 管理层在“系统运维”查看风险、指标、操作记录和备份。

## 5. 备份与恢复

进入“系统运维”，点击“创建备份”。备份文件保存在：

```text
D:\erp\chenyida_erp_app\data\backups
```

恢复备份只允许系统管理员操作。恢复前建议先创建一个新的当前备份，避免误恢复后丢失当天数据。

## 6. 停止服务

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\stop_server.ps1
```

## 7. 故障处理

- 打不开页面：先运行 `stop_server.ps1`，再运行 `start_server.ps1`。
- 登录失败：确认账号密码；管理员可直接检查用户清单。
- 误导入或误操作：进入“系统运维”恢复最近可用备份。
- 服务启动失败：查看 `D:\erp\chenyida_erp_app\data\server.log`。
