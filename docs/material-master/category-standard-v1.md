# 晨亿达行业物料分类与属性标准 V1

## 1. 适用范围

本标准对应版本化 seed `material-category-v1`，适用于 PCB、FPC、SMT 行业 Material Master V2 的测试与本地初始化。标准包含 101 个分类节点、34 个属性定义、39 个四级叶子和 228 条显式属性绑定。

物料只能选择四级叶子。属性只绑定四级叶子；模板复制会生成独立绑定，不存在父级继承、覆盖或运行时传播。该原则见 `docs/project/DECISIONS.md` 的 D-009。

## 2. Code 规范

- 分类和属性 code 必须匹配 `^[A-Z][A-Z0-9_]{1,63}$`。
- code 全局唯一、不能为空，发布后作为稳定标识，不因中文名称调整而修改。
- 分类采用领域前缀和英文缩写，例如 `PCB_FPC`、`RES_CHIP`、`PASTE_LEAD_FREE_STD`。
- 四级通用叶子使用 `_STD`；中间通用分组使用 `_GENERAL`。
- seed 在写数据库前校验重复 code、空 code、非法父子级别、未知属性和非叶子绑定。

## 3. 四级分类树

### 3.1 PCB/FPC 材料（`PCB_FPC`）

- 基材 `PCB_SUBSTRATE`
  - FR4 `SUB_FR4`：普通 FR4 `FR4_STANDARD`、高 TG FR4 `FR4_HIGH_TG`、无卤 FR4 `FR4_HALOGEN_FREE`
  - PI `SUB_PI`：PI 薄膜 `PI_FILM`、覆铜 PI `PI_CCL`
  - CCL `SUB_CCL`：单面覆铜板 `CCL_SINGLE`、双面覆铜板 `CCL_DOUBLE`
- 铜箔 `PCB_COPPER_FOIL`
  - 电解铜箔 `FOIL_ED`：标准电解铜箔 `FOIL_ED_STD`
  - 压延铜箔 `FOIL_RA`：标准压延铜箔 `FOIL_RA_STD`
- PP `PCB_PP`
  - FR4 半固化片 `PP_FR4`：标准 FR4 PP `PP_FR4_STD`
- Coverlay `PCB_COVERLAY`
  - PI Coverlay `COVERLAY_PI`：标准 PI Coverlay `COVERLAY_PI_STD`
- 补强 `PCB_STIFFENER`
  - PI 补强 `STIFFENER_PI`：标准 PI 补强 `STIFFENER_PI_STD`
  - 钢片补强 `STIFFENER_STEEL`：标准钢片补强 `STIFFENER_STEEL_STD`
  - FR4 补强 `STIFFENER_FR4`：标准 FR4 补强 `STIFFENER_FR4_STD`
- 胶类 `PCB_ADHESIVE`
  - 胶膜 `ADHESIVE_FILM`：标准胶膜 `ADHESIVE_FILM_STD`
  - 液态胶 `ADHESIVE_LIQUID`：标准液态胶 `ADHESIVE_LIQUID_STD`

### 3.2 电子元件（`ELECTRONIC`）

- 被动元件 `EL_PASSIVE`
  - 电阻 `PASS_RESISTOR`：贴片电阻 `RES_CHIP`
  - 电容 `PASS_CAPACITOR`：贴片电容 `CAP_CHIP`
  - 电感 `PASS_INDUCTOR`：贴片电感 `IND_CHIP`
- 半导体 `EL_SEMICONDUCTOR`
  - IC `SEMI_IC`：BGA `IC_BGA`、QFN `IC_QFN`
  - 二极管 `SEMI_DIODE`：贴片二极管 `DIODE_SMD`
  - MOS `SEMI_MOS`：贴片 MOS `MOS_SMD`
- 连接器 `EL_CONNECTOR`
  - 板端连接器 `CONN_BOARD`：标准板端连接器 `CONN_BOARD_STD`
  - FPC 连接器 `CONN_FPC`：标准 FPC 连接器 `CONN_FPC_STD`

### 3.3 SMT 辅料（`SMT_AUX`）

- 锡膏 `SMT_SOLDER_PASTE` → 无铅锡膏 `PASTE_LEAD_FREE` → 标准无铅锡膏 `PASTE_LEAD_FREE_STD`
- 红胶 `SMT_RED_GLUE` → 贴片红胶 `RED_GLUE_SMD` → 标准贴片红胶 `RED_GLUE_SMD_STD`
- 助焊剂 `SMT_FLUX` → 液态助焊剂 `FLUX_LIQUID` → 标准液态助焊剂 `FLUX_LIQUID_STD`
- 钢网 `SMT_STENCIL` → 激光钢网 `STENCIL_LASER` → 标准激光钢网 `STENCIL_LASER_STD`
- 清洗剂 `SMT_CLEANER` → 液态清洗剂 `SMT_CLEANER_LIQUID` → 标准 SMT 清洗剂 `SMT_CLEANER_STD`

### 3.4 生产耗材（`PROD_CONSUMABLE`）

以下各路径均为“二级品类 → 通用三级 → 标准四级叶子”：

- 钻针 `PC_DRILL` → `PC_DRILL_GENERAL` → `PC_DRILL_STD`
- 铣刀 `PC_ROUTER` → `PC_ROUTER_GENERAL` → `PC_ROUTER_STD`
- 胶带 `PC_TAPE` → `PC_TAPE_GENERAL` → `PC_TAPE_STD`
- 保护膜 `PC_PROTECT_FILM` → `PC_PROTECT_FILM_GENERAL` → `PC_PROTECT_FILM_STD`
- 包装材料 `PC_PACKAGING` → `PC_PACKAGING_GENERAL` → `PC_PACKAGING_STD`

### 3.5 化学材料（`CHEMICAL`）

以下各路径均为“二级品类 → 通用三级 → 标准四级叶子”：

- 油墨 `CH_INK` → `CH_INK_GENERAL` → `CH_INK_STD`
- 药水 `CH_POTION` → `CH_POTION_GENERAL` → `CH_POTION_STD`
- 胶水 `CH_GLUE` → `CH_GLUE_GENERAL` → `CH_GLUE_STD`
- 清洗剂 `CH_CLEANER` → `CH_CLEANER_GENERAL` → `CH_CLEANER_STD`

## 4. 属性字典

| 属性组 | 属性 code | 类型与标准单位 |
| --- | --- | --- |
| 通用识别 | `BRAND`, `MODEL`, `MPN`, `MATERIAL` | `TEXT` |
| 尺寸 | `THICKNESS`, `WIDTH`, `LENGTH`, `PITCH`, `DIAMETER` | `DECIMAL / mm` |
| PCB/FPC | `COPPER_THICKNESS`, `PI_THICKNESS`, `ADHESIVE_THICKNESS` | `DECIMAL / um` |
| PCB/FPC | `TG` | `DECIMAL / °C` |
| PCB/FPC | `COLOR` | `ENUM` |
| PCB/FPC | `FLAMMABILITY` | `TEXT` |
| PCB/FPC | `HALOGEN_FREE` | `BOOLEAN` |
| 电阻 | `RESISTANCE`, `TOLERANCE`, `POWER`, `PACKAGE` | `DECIMAL / ohm`, `DECIMAL / %`, `DECIMAL / W`, `TEXT` |
| 电容/电感 | `CAPACITANCE`, `INDUCTANCE`, `RATED_VOLTAGE` | `DECIMAL / F`, `DECIMAL / H`, `DECIMAL / V` |
| 元件结构 | `PIN_COUNT` | `INTEGER` |
| SMT | `ALLOY`, `POWDER_GRADE` | `ENUM` |
| 重量与工艺 | `WEIGHT`, `VISCOSITY`, `SOLID_CONTENT`, `MESH` | `DECIMAL / kg`, `DECIMAL / Pa.s`, `DECIMAL / %`, `INTEGER` |
| 胶类 | `ADHESIVE_TYPE` | `ENUM` |
| 化学/保质 | `SHELF_LIFE_DAYS`, `CONCENTRATION`, `PH` | `INTEGER / day`, `DECIMAL / %`, `DECIMAL` |

业务要求中的 `NUMBER` 映射到既有数据库类型 `INTEGER`，不修改 `0001` migration。首版单位至少实际覆盖 `mm`、`um`、`ohm`、`%`、`W` 和 `kg`。

## 5. 关键叶子模板

以下属性均为显式绑定并必填：

- FR4 三个叶子：`BRAND`, `MODEL`, `THICKNESS`, `COPPER_THICKNESS`, `TG`, `FLAMMABILITY`, `HALOGEN_FREE`。
- Coverlay：`BRAND`, `MODEL`, `PI_THICKNESS`, `ADHESIVE_THICKNESS`, `COLOR`。
- 贴片电阻：`RESISTANCE`, `TOLERANCE`, `POWER`, `PACKAGE`, `BRAND`, `MPN`。
- 标准无铅锡膏：`BRAND`, `ALLOY`, `POWDER_GRADE`, `WEIGHT`, `SHELF_LIFE_DAYS`。

其他叶子的完整绑定以版本化 TypeScript seed 为机器权威；本文件用于业务审阅。所有叶子均经自动测试确认至少有一项绑定。

## 6. Seed 初始化

在 `chenyida_erp_site/` 下执行：

```powershell
$env:ERP_ENV='test' # 或 local
npm run seed:material-categories -- --config <本地wrangler配置> --persist-to <本地D1目录>
```

执行器只接受 `test` 或 `local`，要求显式本地持久化目录，拒绝 `--remote`、production/prod 参数。执行结果以 JSON 输出 seed 版本，以及分类、属性、绑定的 `inserted` 与 `updated` 统计。批量写入使用 Miniflare D1 `batch()` 原子提交；任一语句失败时整个批次不落库。

## 7. 后续扩展规则

1. 不修改已发布的 seed 版本；新增 `material-category-v2` 等后续版本。
2. 新分类必须补足四级路径、稳定 code、排序和中文名。
3. 新四级叶子必须在同一版本中配置完整属性绑定；禁止依赖父级属性。
4. 相同模板可在声明数据中复制展开，但展开结果必须是独立的 `category -> attributes` 绑定。
5. 新属性应优先复用属性字典；新增枚举必须使用稳定枚举 code。
6. 删除或改名不得直接破坏现有引用；采用停用和前向 seed 变更。
7. 每个版本必须覆盖结构、绑定、重复执行、环境保护和 migration 回归测试。
