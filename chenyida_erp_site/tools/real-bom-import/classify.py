#!/usr/bin/env python3
"""Deterministically classify profiled real BOM rows without emitting row contents."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

RULE_VERSION = "real-bom-deterministic-classification-v2"
ARCHIVE_FILENAMES = {"A200量产注意事项.xls"}
MATERIAL_ONLY_FILENAMES = {"A200量产物料清单.xlsx"}

# Ordered, conservative rules. Every matching category is a countable physical item;
# length/mass/liquid consumables deliberately remain review-only when the source unit is absent.
CATEGORY_RULES = (
    ("RB_RES", "电阻", r"电阻|排阻|热敏|压敏|\bRES(?:ISTOR)?\b"),
    ("RB_CAP", "电容", r"电容|\bCAP(?:ACITOR)?\b"),
    ("RB_IND", "电感磁性件", r"电感|磁珠|磁环|线圈|共模|扼流|\bIND(?:UCTOR)?\b"),
    ("RB_IC", "集成电路", r"集成电路|芯片|\bIC\b|MCU|EEPROM|FLASH|DRAM|SRAM|运放|放大器|控制器"),
    ("RB_MOS", "MOS器件", r"MOSFET|MOS管|\bMOS\b"),
    ("RB_TRANS", "晶体管", r"三极管|晶体管|场效应管|\bTRANSISTOR\b"),
    ("RB_DIODE", "二极管", r"二极管|整流管|稳压管|肖特基|TVS|ESD管|\bDIODE\b"),
    ("RB_OPTO", "光电器件", r"发光二极管|指示灯|红外灯|光耦|光敏|数码管|\bLED\b|OPTO"),
    ("RB_CONN", "连接器", r"连接器|连接座|插座|排针|排母|端子|卡座|插针|插头|USB座|TYPE.?C|RJ45|FPC座"),
    ("RB_XTAL", "晶体晶振", r"晶振|晶体|谐振器|振荡器|OSCILLATOR|CRYSTAL"),
    ("RB_SWITCH", "开关按键", r"开关|按键|按钮|拨码|轻触"),
    ("RB_FUSE", "保险保护器件", r"保险丝|保险管|熔断|自恢复保险|PTC"),
    ("RB_RELAY", "继电器", r"继电器|\bRELAY\b"),
    ("RB_XFMR", "变压器", r"变压器|\bTRANSFORMER\b"),
    ("RB_SENSOR", "传感器", r"传感器|SENSOR|陀螺仪|加速度计"),
    ("RB_AUDIO", "声学器件", r"蜂鸣器|喇叭|扬声器|咪头|麦克风|受话器|BUZZER|SPEAKER|MICROPHONE"),
    ("RB_DISPLAY", "显示器件", r"显示屏|液晶屏|触摸屏|LCD|OLED|DISPLAY"),
    ("RB_MOTOR", "电机马达", r"电机|马达|MOTOR"),
    ("RB_BAT", "电池", r"电池|BATTERY"),
    ("RB_ANT", "天线", r"天线|ANTENNA"),
    ("RB_MODULE", "电子模块", r"模块|模组|MODULE"),
    ("RB_PCB", "PCB/FPC/PCBA", r"PCBA|PCB|FPC|线路板|电路板|主板|控制板|小板"),
    ("RB_CABLE", "成品线缆", r"线束|连接线|排线|转接线|电源线|成品线|CABLE|HARNESS"),
    ("RB_FASTENER", "紧固件", r"螺丝|螺钉|螺母|铆钉|卡扣|扣环|紧固"),
    ("RB_METAL", "金属结构件", r"屏蔽罩|支架|弹片|五金|金属件|铁片|钢片|铜片|散热片"),
    ("RB_PLASTIC", "塑胶结构件", r"外壳|壳体|塑胶|塑料|胶壳|面壳|底壳|按键帽"),
    ("RB_LABEL", "标签铭牌", r"标签|标贴|铭牌|贴纸|条码贴"),
    ("RB_PACK", "计件包装件", r"纸箱|彩盒|包装盒|吸塑|托盘|包装袋|珍珠棉|泡棉|EVA"),
)

NON_COUNTABLE = re.compile(r"胶水|锡膏|助焊剂|清洗剂|油墨|酒精|溶剂|散装线|导线|胶带|胶纸|保护膜|双面胶|背胶|热缩管", re.I)
REFERENCE_CATEGORIES = (
    ("RB_RES", "电阻", {"R", "RN", "VR"}), ("RB_CAP", "电容", {"C", "EC"}),
    ("RB_IND", "电感磁性件", {"L", "FB"}), ("RB_IC", "集成电路", {"U", "IC"}),
    ("RB_DIODE", "二极管", {"D"}), ("RB_TRANS", "晶体管", {"Q"}),
    ("RB_CONN", "连接器", {"J", "CN", "CON", "P"}), ("RB_XTAL", "晶体晶振", {"Y", "X"}),
    ("RB_SWITCH", "开关按键", {"SW"}), ("RB_FUSE", "保险保护器件", {"F"}),
    ("RB_RELAY", "继电器", {"K"}), ("RB_XFMR", "变压器", {"T"}),
    ("RB_AUDIO", "声学器件", {"BZ", "SPK", "MIC"}),
)


def norm(value: object) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")).strip()).upper()


def digest(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def category(row: dict[str, str]) -> tuple[str, str] | None:
    text = " ".join(row.get(key, "") for key in ("material_name", "specification", "model", "manufacturer_part_no", "package"))
    if NON_COUNTABLE.search(text):
        return None
    for code, name, pattern in CATEGORY_RULES:
        if re.search(pattern, text, re.I):
            return code, name
    prefixes = {match.group(1).upper() for match in re.finditer(r"(?<![A-Z0-9])([A-Z]{1,3})\d+(?![A-Z0-9])", str(row.get("reference", "")), re.I)}
    if len(prefixes) == 1:
        for code, name, accepted in REFERENCE_CATEGORIES:
            if prefixes <= accepted:
                return code, name
    return None


def positive_quantity(value: str) -> str | None:
    try:
        number = Decimal(str(value or "").replace(",", ""))
    except InvalidOperation:
        return None
    if not number.is_finite() or number <= 0 or -number.as_tuple().exponent > 6:
        return None
    return format(number, "f")


def explicit_reference_quantity(value: str) -> str | None:
    text = unicodedata.normalize("NFKC", str(value or "")).upper().strip()
    if not text or "-" in text or "~" in text or "至" in text:
        return None
    tokens = re.findall(r"(?<![A-Z0-9])([A-Z]{1,3}\d+)(?![A-Z0-9])", text)
    remainder = re.sub(r"(?<![A-Z0-9])[A-Z]{1,3}\d+(?![A-Z0-9])", "", text)
    remainder = re.sub(r"[\s,，;；、/]+", "", remainder)
    if not tokens or remainder:
        return None
    unique = list(dict.fromkeys(tokens))
    return str(len(unique)) if len(unique) == len(tokens) else None


def identity(row: dict[str, str], category_code: str) -> tuple[str, str] | None:
    code, mpn = norm(row.get("internal_code")), norm(row.get("manufacturer_part_no"))
    manufacturer = norm(row.get("manufacturer"))
    if code:
        return "SOURCE_CODE", f"{code}"
    if mpn:
        return "MPN", f"{manufacturer}|{mpn}"
    name, spec, model, package = (norm(row.get(key)) for key in ("material_name", "specification", "model", "package"))
    if (name and (spec or model or package)) or (spec and model):
        return "STRICT_SPEC_COMPOSITE", f"{category_code}|{name}|{spec}|{model}|{package}"
    return None


def source_signature(row: dict[str, str], category_code: str) -> str:
    return digest({key: norm(row.get(key)) for key in ("material_name", "specification", "model", "manufacturer_part_no", "manufacturer", "package")} | {"category": category_code})


def source_product_key(filename: str, sheet: str, file_sha: str) -> str:
    family = "A200" if filename.startswith("A200") else file_sha
    return f"product:{digest([family, sheet])[:24]}"


def main(mapping_csv: Path, manifest_json: Path, output_json: Path, review_csv: Path, mapping_output: Path | None = None) -> dict[str, object]:
    manifest = json.loads(manifest_json.read_text(encoding="utf-8"))
    with mapping_csv.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    candidates: list[dict[str, object]] = []
    identity_groups: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for source in rows:
        if source["classification"] == "ARCHIVE_ONLY" or source["filename"] in ARCHIVE_FILENAMES:
            candidates.append({"source": source, "classification": "ARCHIVE_ONLY", "reasons": source["reason_codes"].split("|") if source["reason_codes"] else []})
            continue
        classified = category(source)
        if not classified:
            candidates.append({"source": source, "classification": "NEEDS_REVIEW", "reasons": ["CATEGORY_OR_COUNT_UNIT_NOT_DETERMINISTIC"]})
            continue
        category_code, category_name = classified
        stable = identity(source, category_code)
        if not stable:
            candidates.append({"source": source, "classification": "NEEDS_REVIEW", "reasons": ["STABLE_MATERIAL_IDENTITY_MISSING"]})
            continue
        item = {"source": source, "classification": "PENDING", "reasons": [], "category_code": category_code, "category_name": category_name, "identity_method": stable[0], "identity_key": stable[1], "signature": source_signature(source, category_code)}
        candidates.append(item)
        identity_groups[(stable[0], stable[1])].append(item)

    materials_by_key: dict[str, dict[str, object]] = {}
    for (_method, _key), group in identity_groups.items():
        signatures = {str(item["signature"]) for item in group}
        if len(signatures) != 1:
            for item in group:
                item["classification"] = "NEEDS_REVIEW"
                item["reasons"] = ["STABLE_IDENTITY_CONFLICT"]
            continue
        first = group[0]
        source = first["source"]
        assert isinstance(source, dict)
        stable_key = f"material:{digest([first['identity_method'], first['identity_key']])[:32]}"
        material = materials_by_key.setdefault(stable_key, {
            "stable_key": stable_key, "category_code": first["category_code"], "category_name": first["category_name"],
            "identity_method": first["identity_method"], "standard_name": (source.get("material_name") or source.get("model") or source.get("specification"))[:200],
            "manufacturer": source.get("manufacturer", "")[:160], "manufacturer_part_number": source.get("manufacturer_part_no", "")[:160],
            "specification": source.get("specification", "")[:1000], "model": source.get("model", "")[:200], "package": source.get("package", "")[:120],
            "source_rows": [],
        })
        for item in group:
            item["classification"] = "ELIGIBLE"
            item["material_key"] = stable_key
            src = item["source"]
            assert isinstance(src, dict)
            material["source_rows"].append({"source_ref": src["source_ref"], "file_sha256": src["file_sha256"], "sheet": src["sheet"], "source_row": int(src["source_row"]), "source_record_digest": digest(src), "mapping_method": item["identity_method"]})

    category_sequences: dict[str, int] = defaultdict(int)
    for stable_key in sorted(materials_by_key):
        material = materials_by_key[stable_key]
        code = str(material["category_code"])
        category_sequences[code] += 1
        material["internal_code"] = f"CYD-{code}-{category_sequences[code]:06d}"

    product_map: dict[tuple[str, str], dict[str, object]] = {}
    bom_map: dict[tuple[str, str], dict[str, object]] = {}
    for item in candidates:
        src = item["source"]
        assert isinstance(src, dict)
        if src["filename"] in MATERIAL_ONLY_FILENAMES or src["filename"] in ARCHIVE_FILENAMES or item["classification"] == "ARCHIVE_ONLY":
            continue
        key = (src["filename"], src["sheet"])
        product = product_map.setdefault(key, {
            "stable_key": source_product_key(*key, src["file_sha256"]), "product_code": f"PRD-RB-{digest([src['file_sha256'], src['sheet']])[:10].upper()}",
            "product_name": Path(src["filename"]).stem[:160], "version_code": f"HIST-{digest([src['file_sha256'], src['sheet'], src.get('version','')])[:8].upper()}",
            "source_ref": f"product-{digest([src['file_sha256'], src['sheet']])[:20]}", "file_sha256": src["file_sha256"], "sheet": src["sheet"],
        })
        bom = bom_map.setdefault(key, {
            "stable_key": f"bom:{digest([src['file_sha256'], src['sheet']])[:24]}", "bom_code": f"BOM-RB-{digest([src['file_sha256'], src['sheet']])[:10].upper()}",
            "product_key": product["stable_key"], "version_code": product["version_code"], "source_ref": f"bom-{digest([src['file_sha256'], src['sheet']])[:20]}",
            "file_sha256": src["file_sha256"], "sheet": src["sheet"], "lines_by_material": {}, "unresolved_source_refs": [],
        })
        if item["classification"] != "ELIGIBLE":
            bom["unresolved_source_refs"].append(src["source_ref"])
            continue
        qty = positive_quantity(src.get("quantity", "") or src.get("quantity_raw", "")) or explicit_reference_quantity(src.get("reference", ""))
        if not qty:
            bom["unresolved_source_refs"].append(src["source_ref"])
            item["bom_classification"] = "NEEDS_REVIEW"
            item["reasons"] = sorted(set(item["reasons"] + ["BOM_QUANTITY_NOT_VALID"]))
            continue
        item["bom_classification"] = "ELIGIBLE"
        material_key = str(item["material_key"])
        line = bom["lines_by_material"].setdefault(material_key, {"material_key": material_key, "quantity": "0", "unit": "PCS", "source_rows": []})
        line["quantity"] = format(Decimal(str(line["quantity"])) + Decimal(qty), "f")
        line["source_rows"].append({"source_ref": src["source_ref"], "file_sha256": src["file_sha256"], "sheet": src["sheet"], "source_row": int(src["source_row"]), "source_record_digest": digest(src), "mapping_method": "COUNTABLE_COMPONENT_PCS"})

    boms = []
    for key in sorted(bom_map):
        bom = bom_map[key]
        lines = list(bom.pop("lines_by_material").values())
        lines.sort(key=lambda line: str(line["material_key"]))
        for index, line in enumerate(lines, 1):
            line["line_no"] = index * 10
        bom["lines"] = lines
        bom["status"] = "DRAFT" if bom["unresolved_source_refs"] else "RELEASED"
        if lines:
            boms.append(bom)

    material_classifications = Counter(str(item["classification"]) for item in candidates)
    bom_classifications = Counter(str(item.get("bom_classification", "NOT_BOM")) for item in candidates)
    review_rows = []
    for item in candidates:
        if item["classification"] == "NEEDS_REVIEW" or item.get("bom_classification") == "NEEDS_REVIEW":
            src = item["source"]
            assert isinstance(src, dict)
            review_rows.append({"source_ref": src["source_ref"], "file_sha256": src["file_sha256"], "sheet": src["sheet"], "source_row": src["source_row"], "classification": "NEEDS_REVIEW", "reason_codes": "|".join(sorted(set(item["reasons"])))})

    for item in candidates:
        item["overall_classification"] = "NEEDS_REVIEW" if item["classification"] == "NEEDS_REVIEW" or item.get("bom_classification") == "NEEDS_REVIEW" else item["classification"]
    classifications = Counter(str(item["overall_classification"]) for item in candidates)
    payload = {
        "schema_version": 1, "marker": "REAL_BOM_OFFLINE_IMPORT_V2", "rule_version": RULE_VERSION,
        "manifest_sha256": manifest["manifest_sha256"],
        "source_files": [{key: (str(value) if isinstance(value, int) else value) for key, value in item.items()} for item in manifest["files"]],
        "units": [{"code": "PCS", "name": "件", "symbol": "PCS", "unit_type": "COUNT"}],
        "materials": [materials_by_key[key] for key in sorted(materials_by_key)], "products": [product_map[key] for key in sorted(product_map)], "boms": boms,
        "source_classifications": [{"source_ref": item["source"]["source_ref"], "classification": item["overall_classification"], "material_classification": item["classification"], "bom_classification": item.get("bom_classification", "NOT_BOM"), "reason_codes": item["reasons"]} for item in candidates],
        "summary": {"source_rows": len(candidates), "classification_counts": dict(sorted(classifications.items())), "material_classification_counts": dict(sorted(material_classifications.items())), "bom_classification_counts": dict(sorted(bom_classifications.items())), "materials": len(materials_by_key), "products": len(product_map), "boms": len(boms), "bom_lines": sum(len(bom["lines"]) for bom in boms), "review_rows": len(review_rows), "duplicate_source_rows_merged": sum(max(0, len(material["source_rows"]) - 1) for material in materials_by_key.values())},
    }
    payload["payload_digest"] = digest(payload)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    with review_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["source_ref", "file_sha256", "sheet", "source_row", "classification", "reason_codes"])
        writer.writeheader(); writer.writerows(review_rows)
    if mapping_output:
        fields = ["source_ref", "file_sha256", "sheet", "source_row", "classification", "material_classification", "bom_classification", "reason_codes", "mapping_rule_version", "internal_stable_id", "internal_code", "category_code", "unit", "mapping_method"]
        with mapping_output.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
            for item in candidates:
                source = item["source"]
                material = materials_by_key.get(str(item.get("material_key", "")), {})
                writer.writerow({"source_ref": source["source_ref"], "file_sha256": source["file_sha256"], "sheet": source["sheet"], "source_row": source["source_row"], "classification": item["overall_classification"], "material_classification": item["classification"], "bom_classification": item.get("bom_classification", "NOT_BOM"), "reason_codes": "|".join(sorted(set(item["reasons"]))), "mapping_rule_version": RULE_VERSION, "internal_stable_id": item.get("material_key", ""), "internal_code": material.get("internal_code", ""), "category_code": item.get("category_code", ""), "unit": "PCS" if item["classification"] == "ELIGIBLE" else "", "mapping_method": item.get("identity_method", "")})
        mapping_output.chmod(0o600)
    output_json.chmod(0o600); review_csv.chmod(0o600)
    return payload["summary"]


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument("--mapping", type=Path, required=True); parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--output", type=Path, required=True); parser.add_argument("--review", type=Path, required=True); parser.add_argument("--mapping-output", type=Path)
    args = parser.parse_args(); print(json.dumps(main(args.mapping, args.manifest, args.output, args.review, args.mapping_output), ensure_ascii=False, sort_keys=True))
