import csv
import re
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
OUTPUT = ROOT / "output"


def normalize(value):
    return re.sub(r"\s+", "", (value or "").upper())


def spec_text(value):
    return (value or "").upper().replace("μ", "U")


def remove_package_tokens(value):
    t = spec_text(value)
    return re.sub(r"\b(0201|0402|0603|0805|1206|SOD[- ]?523|QFN|BGA)\b", " ", t)


def parse_category(text):
    t = normalize(text)
    if "UF" in t or "NF" in t or "PF" in t:
        return "CAP"
    if re.search(r"(^|[^A-Z])\d+(\.\d+)?K([^A-Z]|$)", t) or re.search(r"(^|[^A-Z])\d+R([^A-Z]|$)", t):
        return "RES"
    if "CONN" in t or "CONNECTOR" in t or "PITCH" in t:
        return "CON"
    if "PI" in t or "ED" in t or "RA" in t:
        return "PI"
    if "TVS" in t or "SOD" in t:
        return "DIO"
    return ""


def parse_package(text):
    t = normalize(text)
    for pkg in ["0201", "0402", "0603", "0805", "1206", "SOD-523", "SOD523", "QFN", "BGA"]:
        if pkg in t:
            return pkg.replace("SOD523", "SOD-523")
    return ""


def parse_voltage(text):
    t = remove_package_tokens(text)
    m = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*V\b", t)
    return f"{m.group(1)}V" if m else ""


def parse_value(text):
    t = remove_package_tokens(text)

    m = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(UF|NF|PF)\b", t)
    if m:
        return f"{m.group(1)}{m.group(2)}"

    m = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(K|R|M)\b", t)
    if m:
        return f"{m.group(1)}{m.group(2)}"

    m = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(PITCH|P)\s*(\d+)\s*PIN\b", t)
    if m:
        return f"{m.group(1)}PITCH{m.group(3)}PIN"

    return ""


def parse_tolerance(text):
    t = spec_text(text)
    m = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*%", t)
    return f"{m.group(1)}%" if m else ""


def read_csv(path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def similarity(a, b):
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def score_candidate(raw, master):
    score = 0.0
    raw_text = " ".join([raw.get("raw_item_name", ""), raw.get("raw_spec", ""), raw.get("raw_mpn", "")])
    master_text = " ".join([
        master.get("standard_name", ""),
        master.get("package", ""),
        master.get("value_spec", ""),
        master.get("voltage", ""),
        master.get("mpn", ""),
    ])

    if parse_category(raw_text) and parse_category(raw_text) == master.get("item_category", ""):
        score += 0.25
    if parse_package(raw_text) and parse_package(raw_text) == master.get("package", ""):
        score += 0.25
    if parse_value(raw_text) and normalize(parse_value(raw_text)) == normalize(master.get("value_spec", "")):
        score += 0.25
    if parse_voltage(raw_text) and normalize(parse_voltage(raw_text)) == normalize(master.get("voltage", "")):
        score += 0.15
    if parse_tolerance(raw_text) and normalize(parse_tolerance(raw_text)) == normalize(master.get("tolerance", "")):
        score += 0.10
    score += min(0.10, similarity(raw_text, master_text) * 0.10)
    return round(min(score, 1.0), 2)


def classify(score):
    if score >= 0.85:
        return "自动匹配"
    if score >= 0.55:
        return "疑似匹配"
    return "新物料"


def main():
    master_rows = read_csv(TEMPLATES / "内部标准物料库.csv")
    mapping_rows = read_csv(TEMPLATES / "供应商物料映射表.csv")
    supplier_rows = read_csv(TEMPLATES / "供应商原始物料导入模板.csv")
    OUTPUT.mkdir(exist_ok=True)
    master_by_code = {row.get("internal_item_code", ""): row for row in master_rows}
    exact_mapping = {
        (normalize(row.get("supplier_name", "")), normalize(row.get("supplier_item_code", ""))): row
        for row in mapping_rows
        if row.get("supplier_item_code")
    }

    out_path = OUTPUT / "待确认清洗结果.csv"
    fieldnames = [
        "import_batch_no",
        "supplier_name",
        "raw_item_name",
        "raw_item_code",
        "raw_spec",
        "parsed_category",
        "parsed_package",
        "parsed_value",
        "parsed_voltage",
        "candidate_internal_code",
        "candidate_standard_name",
        "match_level",
        "confidence",
        "owner_role",
        "process_status",
    ]

    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for raw in supplier_rows:
            raw_text = " ".join([raw.get("raw_item_name", ""), raw.get("raw_spec", "")])
            exact = exact_mapping.get((normalize(raw.get("supplier_name", "")), normalize(raw.get("raw_item_code", ""))))
            if exact:
                exact_master = master_by_code.get(exact.get("internal_item_code", ""), {})
                writer.writerow({
                    "import_batch_no": raw.get("import_batch_no", ""),
                    "supplier_name": raw.get("supplier_name", ""),
                    "raw_item_name": raw.get("raw_item_name", ""),
                    "raw_item_code": raw.get("raw_item_code", ""),
                    "raw_spec": raw.get("raw_spec", ""),
                    "parsed_category": parse_category(raw_text),
                    "parsed_package": parse_package(raw_text),
                    "parsed_value": parse_value(raw_text),
                    "parsed_voltage": parse_voltage(raw_text),
                    "candidate_internal_code": exact.get("internal_item_code", ""),
                    "candidate_standard_name": exact_master.get("standard_name", ""),
                    "match_level": "自动匹配",
                    "confidence": 1.0,
                    "owner_role": "采购",
                    "process_status": "待处理",
                })
                continue

            ranked = sorted(
                ((score_candidate(raw, master), master) for master in master_rows),
                key=lambda x: x[0],
                reverse=True,
            )
            best_score, best_master = ranked[0]
            level = classify(best_score)
            owner = "采购" if level == "自动匹配" else "工程"
            writer.writerow({
                "import_batch_no": raw.get("import_batch_no", ""),
                "supplier_name": raw.get("supplier_name", ""),
                "raw_item_name": raw.get("raw_item_name", ""),
                "raw_item_code": raw.get("raw_item_code", ""),
                "raw_spec": raw.get("raw_spec", ""),
                "parsed_category": parse_category(raw_text),
                "parsed_package": parse_package(raw_text),
                "parsed_value": parse_value(raw_text),
                "parsed_voltage": parse_voltage(raw_text),
                "candidate_internal_code": best_master.get("internal_item_code", "") if level != "新物料" else "",
                "candidate_standard_name": best_master.get("standard_name", "") if level != "新物料" else "",
                "match_level": level,
                "confidence": best_score,
                "owner_role": owner,
                "process_status": "待处理",
            })

    print(f"已生成: {out_path}")


if __name__ == "__main__":
    main()
