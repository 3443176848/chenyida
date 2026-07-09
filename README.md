# 晨亿达 ERP 项目

这是深圳市晨亿达电子有限公司 ERP 本地可运行项目，覆盖物料主数据治理、产品/BOM、采购、库存、生产、询价报价、销售、财务、品质和系统运维。

## 快速启动

```powershell
powershell -ExecutionPolicy Bypass -File D:\erp\chenyida_erp_app\start_server.ps1
```

打开：

```text
http://127.0.0.1:8765
```

默认管理员：

```text
admin / admin123
```

首次投用后请立即修改管理员密码。

## 主要文档

- `chenyida_erp_app/README.md`：应用说明、默认账号、验证命令。
- `晨亿达ERP系统设计方案.md`：完整系统设计方案。
- `晨亿达ERP投用运行手册.md`：现场启动、检查、备份、恢复和故障处理。
- `物料主数据治理落地包/`：物料编码、字段字典、导入清洗 SOP 和模板。
