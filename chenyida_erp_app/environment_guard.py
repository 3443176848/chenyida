import os
import tempfile
from pathlib import Path


VALID_ENVIRONMENTS = {"development", "test", "production"}


def current_environment(source=None):
    source = source or os.environ
    name = source.get("ERP_ENV", "development").strip().lower()
    if name not in VALID_ENVIRONMENTS:
        raise RuntimeError(f"ERP_ENV 必须是 development、test 或 production，当前值为 {name or '<empty>'}")
    return name


def prepare_test_environment(temp_dir, database_name="test.sqlite3", source=None):
    source = source or os.environ
    requested = current_environment(source)
    if "ERP_ENV" in source and requested != "test":
        raise RuntimeError(f"拒绝执行测试：ERP_ENV={requested}，必须显式使用 test 环境")

    root = Path(temp_dir).resolve()
    system_temp = Path(tempfile.gettempdir()).resolve()
    try:
        root.relative_to(system_temp)
    except ValueError as exc:
        raise RuntimeError("拒绝执行测试：测试数据目录必须位于操作系统临时目录") from exc
    if not root.name.startswith("chenyida-erp-test-"):
        raise RuntimeError("拒绝执行测试：临时目录缺少 chenyida-erp-test- 标识")

    source["ERP_ENV"] = "test"
    source["CYD_ERP_DATA_DIR"] = str(root)
    source["CYD_ERP_DB"] = str(root / database_name)
    return root
