import re
from decimal import Decimal, InvalidOperation


NUMBER = r"-?\d+(?:\.\d+)?"
ABSOLUTE_TOLERANCE_RE = re.compile(
    rf"(?:±|\+/-|\+-)\s*({NUMBER})\s*"
    r"(pF|nF|uF|μF|mF|pH|nH|uH|μH|mH|mV|kV|V|uA|μA|mA|A|mW|kW|W|"
    r"mΩ|uΩ|μΩ|kΩ|MΩ|Ω|ohm)",
    re.I,
)
PERCENT_TOLERANCE_RE = re.compile(rf"(?:±|\+/-|\+-)?\s*({NUMBER})\s*%")
QUANTITY_RE = re.compile(
    rf"(?<![A-Z0-9.])({NUMBER})\s*"
    r"(GHz|MHz|kHz|Hz|pF|nF|uF|μF|mF|pH|nH|uH|μH|mH|mV|kV|V|"
    r"uA|μA|mA|A|mW|kW|W|mΩ|uΩ|μΩ|kΩ|MΩ|Ω|ohm)"
    r"(?![A-Z0-9])",
    re.I,
)
RESISTANCE_CODE_RE = re.compile(rf"(?<![A-Z0-9.])({NUMBER})\s*(R|K|M)(?![A-Z0-9])", re.I)
CAPACITANCE_SHORTHAND_RE = re.compile(
    rf"(?<![A-Z0-9.])({NUMBER})\s*([PNU])(?![A-Z0-9])",
    re.I,
)
PACKAGE_RE = re.compile(
    r"(?<![A-Z0-9])(?:0201|0402|0603|0805|1206|1210|1812|2010|2512|"
    r"SOD[- ]?523|SOD[- ]?323|SOT[- ]?23|QFN(?:-\d+)?|BGA)(?![A-Z0-9])",
    re.I,
)
DIMENSION_RE = re.compile(
    rf"(?<![A-Z0-9.])({NUMBER})\s*[x×*]\s*({NUMBER})"
    rf"(?:\s*[x×*]\s*({NUMBER}))?\s*(mm|cm|mil|inch|英寸)?(?![A-Z0-9])",
    re.I,
)

CATEGORY_PATTERNS = [
    (re.compile(r"电容|(?<![A-Z])CAP(?:ACITOR)?(?![A-Z])", re.I), "CAP", "电容"),
    (re.compile(r"电阻|(?<![A-Z])RES(?:ISTOR)?(?![A-Z])", re.I), "RES", "电阻"),
    (re.compile(r"电感|(?<![A-Z])IND(?:UCTOR)?(?![A-Z])", re.I), "IND", "电感"),
    (re.compile(r"磁珠|FERRITE\s*BEAD", re.I), "FBEAD", "磁珠"),
    (re.compile(r"二极管|DIODE|TVS", re.I), "DIO", "二极管"),
    (re.compile(r"连接器|CONNECTOR|CONN", re.I), "CON", "连接器"),
]
MATERIAL_PATTERNS = [
    (re.compile(r"(?<![A-Z0-9])(?:C0G|COG|NP0|NPO)(?![A-Z0-9])", re.I), "C0G/NP0"),
    (re.compile(r"(?<![A-Z0-9])X7R(?![A-Z0-9])", re.I), "X7R"),
    (re.compile(r"(?<![A-Z0-9])X5R(?![A-Z0-9])", re.I), "X5R"),
    (re.compile(r"(?<![A-Z0-9])Y5V(?![A-Z0-9])", re.I), "Y5V"),
    (re.compile(r"(?<![A-Z0-9])Z5U(?![A-Z0-9])", re.I), "Z5U"),
]

KIND_LABELS = {
    "CATEGORY": "品类",
    "PACKAGE": "封装",
    "CAPACITANCE": "容量",
    "RESISTANCE": "阻值",
    "INDUCTANCE": "电感值",
    "CURRENT": "额定电流",
    "VOLTAGE": "耐压",
    "POWER": "功率",
    "FREQUENCY": "频率",
    "TOLERANCE_PERCENT": "百分比误差",
    "CAPACITANCE_TOLERANCE": "容量误差",
    "RESISTANCE_TOLERANCE": "阻值误差",
    "INDUCTANCE_TOLERANCE": "电感误差",
    "CURRENT_TOLERANCE": "电流误差",
    "VOLTAGE_TOLERANCE": "电压误差",
    "POWER_TOLERANCE": "功率误差",
    "MATERIAL": "介质/材质",
    "DIMENSION": "尺寸",
    "MPN": "型号/MPN",
    "BRAND": "品牌",
}

SPEC_KINDS = {
    "CATEGORY",
    "PACKAGE",
    "CAPACITANCE",
    "RESISTANCE",
    "INDUCTANCE",
    "CURRENT",
    "VOLTAGE",
    "POWER",
    "FREQUENCY",
    "TOLERANCE_PERCENT",
    "CAPACITANCE_TOLERANCE",
    "RESISTANCE_TOLERANCE",
    "INDUCTANCE_TOLERANCE",
    "CURRENT_TOLERANCE",
    "VOLTAGE_TOLERANCE",
    "POWER_TOLERANCE",
    "MATERIAL",
    "DIMENSION",
}
HARD_CONFLICT_KINDS = SPEC_KINDS
TOKEN_WEIGHTS = {
    "CATEGORY": 0.10,
    "PACKAGE": 0.14,
    "CAPACITANCE": 0.24,
    "RESISTANCE": 0.24,
    "INDUCTANCE": 0.24,
    "CURRENT": 0.14,
    "VOLTAGE": 0.14,
    "POWER": 0.12,
    "FREQUENCY": 0.12,
    "TOLERANCE_PERCENT": 0.14,
    "CAPACITANCE_TOLERANCE": 0.14,
    "RESISTANCE_TOLERANCE": 0.14,
    "INDUCTANCE_TOLERANCE": 0.14,
    "CURRENT_TOLERANCE": 0.12,
    "VOLTAGE_TOLERANCE": 0.12,
    "POWER_TOLERANCE": 0.12,
    "MATERIAL": 0.10,
    "DIMENSION": 0.12,
    "MPN": 0.08,
    "BRAND": 0.03,
}


def _decimal_text(value):
    try:
        normalized = Decimal(value).normalize()
    except InvalidOperation:
        return str(value)
    text = format(normalized, "f")
    return "0" if text in {"-0", ""} else text


def _unit_info(unit):
    normalized = unit.replace("μ", "u")
    lower = normalized.lower()
    if lower in {"pf", "nf", "uf", "mf"}:
        return "CAPACITANCE", "F", {"pf": "1e-12", "nf": "1e-9", "uf": "1e-6", "mf": "1e-3"}[lower]
    if lower in {"ph", "nh", "uh", "mh"}:
        return "INDUCTANCE", "H", {"ph": "1e-12", "nh": "1e-9", "uh": "1e-6", "mh": "1e-3"}[lower]
    if normalized == "H":
        return "INDUCTANCE", "H", "1"
    if normalized in {"mΩ", "uΩ"}:
        return "RESISTANCE", "OHM", {"mΩ": "1e-3", "uΩ": "1e-6"}[normalized]
    if normalized == "kΩ":
        return "RESISTANCE", "OHM", "1e3"
    if normalized == "MΩ":
        return "RESISTANCE", "OHM", "1e6"
    if lower in {"ω", "ohm"}:
        return "RESISTANCE", "OHM", "1"
    if lower in {"ua", "ma"}:
        return "CURRENT", "A", {"ua": "1e-6", "ma": "1e-3"}[lower]
    if normalized == "A":
        return "CURRENT", "A", "1"
    if lower == "mv":
        return "VOLTAGE", "V", "1e-3"
    if lower == "kv":
        return "VOLTAGE", "V", "1e3"
    if normalized == "V":
        return "VOLTAGE", "V", "1"
    if lower == "mw":
        return "POWER", "W", "1e-3"
    if lower == "kw":
        return "POWER", "W", "1e3"
    if normalized == "W":
        return "POWER", "W", "1"
    if lower in {"hz", "khz", "mhz", "ghz"}:
        return "FREQUENCY", "HZ", {"hz": "1", "khz": "1e3", "mhz": "1e6", "ghz": "1e9"}[lower]
    return "", "", ""


def _token(kind, value, normalized):
    return {
        "kind": kind,
        "label": KIND_LABELS[kind],
        "value": value.strip(),
        "normalized": normalized,
    }


def _overlaps(span, occupied):
    return any(span[0] < other[1] and other[0] < span[1] for other in occupied)


def extract_tokens(text, category="", model="", brand=""):
    source = str(text or "")
    tokens = []
    occupied = []

    category_value = str(category or "").strip()
    if category_value:
        canonical_category = None
        for pattern, code, label in CATEGORY_PATTERNS:
            if pattern.search(category_value):
                canonical_category = (code, label)
                break
        if canonical_category:
            code, label = canonical_category
            tokens.append(_token("CATEGORY", label, code))
        else:
            normalized_category = category_value.upper()
            tokens.append(_token("CATEGORY", category_value, normalized_category))
    else:
        for pattern, code, label in CATEGORY_PATTERNS:
            if pattern.search(source):
                tokens.append(_token("CATEGORY", label, code))
                break

    for match in ABSOLUTE_TOLERANCE_RE.finditer(source):
        kind, base_unit, factor = _unit_info(match.group(2))
        if not kind:
            continue
        normalized = _decimal_text(Decimal(match.group(1)) * Decimal(factor))
        tolerance_kind = f"{kind}_TOLERANCE"
        if tolerance_kind not in KIND_LABELS:
            continue
        tokens.append(_token(tolerance_kind, match.group(0), f"{normalized} {base_unit}"))
        occupied.append(match.span())

    for match in PERCENT_TOLERANCE_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        normalized = _decimal_text(match.group(1))
        tokens.append(_token("TOLERANCE_PERCENT", match.group(0), f"{normalized} %"))
        occupied.append(match.span())

    for match in QUANTITY_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        kind, base_unit, factor = _unit_info(match.group(2))
        if not kind:
            continue
        normalized = _decimal_text(Decimal(match.group(1)) * Decimal(factor))
        tokens.append(_token(kind, match.group(0), f"{normalized} {base_unit}"))
        occupied.append(match.span())

    for match in RESISTANCE_CODE_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        multiplier = {"R": "1", "K": "1e3", "M": "1e6"}[match.group(2).upper()]
        normalized = _decimal_text(Decimal(match.group(1)) * Decimal(multiplier))
        tokens.append(_token("RESISTANCE", match.group(0), f"{normalized} OHM"))
        occupied.append(match.span())

    for match in CAPACITANCE_SHORTHAND_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        factor = {"P": "1e-12", "N": "1e-9", "U": "1e-6"}[match.group(2).upper()]
        normalized = _decimal_text(Decimal(match.group(1)) * Decimal(factor))
        tokens.append(_token("CAPACITANCE", f"{match.group(1)}{match.group(2).upper()}F", f"{normalized} F"))
        occupied.append(match.span())

    for match in PACKAGE_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        value = re.sub(r"\s+", "", match.group(0).upper())
        tokens.append(_token("PACKAGE", value, value))
        occupied.append(match.span())

    for match in DIMENSION_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        values = [part for part in match.groups()[:3] if part is not None]
        unit = (match.group(4) or "").lower()
        normalized = "x".join(_decimal_text(value) for value in values) + (f" {unit}" if unit else "")
        tokens.append(_token("DIMENSION", match.group(0), normalized))
        occupied.append(match.span())

    for pattern, canonical in MATERIAL_PATTERNS:
        match = pattern.search(source)
        if match:
            tokens.append(_token("MATERIAL", match.group(0), canonical))
            break

    if model:
        value = str(model).strip()
        if value:
            tokens.append(_token("MPN", value, re.sub(r"\s+", "", value.upper())))
    if brand:
        value = str(brand).strip()
        if value:
            tokens.append(_token("BRAND", value, re.sub(r"\s+", "", value.upper())))

    if not any(token["kind"] == "CATEGORY" for token in tokens):
        inferred_categories = {
            "CAPACITANCE": ("CAP", "电容"),
            "RESISTANCE": ("RES", "电阻"),
            "INDUCTANCE": ("IND", "电感"),
        }
        inferred = {
            inferred_categories[token["kind"]]
            for token in tokens
            if token["kind"] in inferred_categories
        }
        if len(inferred) == 1:
            code, label = inferred.pop()
            tokens.insert(0, _token("CATEGORY", label, code))

    deduplicated = []
    seen = set()
    for token in tokens:
        key = (token["kind"], token["normalized"])
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(token)
    return deduplicated


def token_map(tokens):
    result = {}
    for token in tokens or []:
        result.setdefault(token["kind"], set()).add(token["normalized"])
    return result


def specification_richness(text):
    tokens = extract_tokens(text)
    meaningful = [token for token in tokens if token["kind"] not in {"CATEGORY", "MPN", "BRAND"}]
    return len({token["kind"] for token in meaningful}), len(meaningful)


def compare_tokens(source_tokens, target_tokens):
    source = token_map(source_tokens)
    target = token_map(target_tokens)
    kinds = sorted((set(source) | set(target)) & SPEC_KINDS)
    matched = []
    missing_in_target = []
    missing_in_source = []
    conflicts = []
    intersection_weight = 0.0
    union_weight = 0.0

    for kind in kinds:
        weight = TOKEN_WEIGHTS.get(kind, 0.05)
        union_weight += weight
        source_values = source.get(kind, set())
        target_values = target.get(kind, set())
        if source_values and target_values:
            common = source_values & target_values
            if source_values == target_values:
                matched.append({"kind": kind, "values": sorted(common)})
                intersection_weight += weight
            else:
                conflicts.append({
                    "kind": kind,
                    "source": sorted(source_values),
                    "target": sorted(target_values),
                    "hard": kind in HARD_CONFLICT_KINDS or kind == "MPN",
                })
        elif source_values:
            missing_in_target.append({"kind": kind, "values": sorted(source_values)})
        else:
            missing_in_source.append({"kind": kind, "values": sorted(target_values)})

    hard_conflicts = [conflict for conflict in conflicts if conflict["hard"]]
    score = 0.0 if hard_conflicts else intersection_weight / union_weight if union_weight else 0.0
    source_spec_kinds = set(source) & SPEC_KINDS
    target_spec_kinds = set(target) & SPEC_KINDS
    full_signature = (
        not conflicts
        and not missing_in_target
        and not missing_in_source
        and len(source_spec_kinds | target_spec_kinds) >= 2
    )
    identifier_evidence = []
    for kind in ("MPN", "BRAND"):
        source_values = source.get(kind, set())
        target_values = target.get(kind, set())
        if not source_values and not target_values:
            continue
        identifier_evidence.append({
            "kind": kind,
            "source": sorted(source_values),
            "target": sorted(target_values),
            "matched": bool(source_values and source_values == target_values),
        })
    return {
        "score": round(min(score, 1.0), 4),
        "full_signature": full_signature,
        "matched": matched,
        "missing_in_target": missing_in_target,
        "missing_in_source": missing_in_source,
        "conflicts": conflicts,
        "identifier_evidence": identifier_evidence,
    }
