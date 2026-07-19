import re
from decimal import Decimal, InvalidOperation


NUMBER = r"-?\d+(?:\.\d+)?"
UNSIGNED_NUMBER = r"\d+(?:\.\d+)?"
UNIT_PATTERN = (
    r"GHz|MHz|kHz|Hz|pF|nF|uF|μF|mF|pH|nH|uH|μH|mH|"
    r"mV|kV|V|uA|μA|mA|A|mW|kW|W|mΩ|uΩ|μΩ|kΩ|MΩ|Ω|ohm"
)
ABSOLUTE_TOLERANCE_RE = re.compile(
    rf"(?:±|\+/-|\+-)\s*({NUMBER})\s*"
    rf"({UNIT_PATTERN})",
    re.I,
)
PERCENT_TOLERANCE_RE = re.compile(rf"(?:±|\+/-|\+-)?\s*({NUMBER})\s*%")
FRACTION_POWER_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*/\s*({UNSIGNED_NUMBER})\s*(mW|W)(?![A-Z0-9])",
    re.I,
)
RANGE_QUANTITY_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*({UNIT_PATTERN})"
    rf"\s*(?:~|～|至|TO|[-–—])\s*({UNSIGNED_NUMBER})\s*({UNIT_PATTERN})(?![A-Z0-9])",
    re.I,
)
FREQUENCY_IMPEDANCE_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*(GHz|MHz|kHz|Hz)\s*@\s*"
    rf"({UNSIGNED_NUMBER})\s*(mΩ|uΩ|μΩ|kΩ|MΩ|Ω|ohm)(?![A-Z0-9])",
    re.I,
)
BANDWIDTH_RE = re.compile(
    rf"(?<![A-Z0-9])(?:-\s*3\s*dB\s*)?BANDWIDTH\s*[:：=]?\s*"
    rf"({UNSIGNED_NUMBER})\s*(GHz|MHz|kHz|Hz)(?![A-Z0-9])",
    re.I,
)
DB_RE = re.compile(rf"(?<![A-Z0-9.])({NUMBER})\s*dB(?![A-Z0-9])", re.I)
QUANTITY_RE = re.compile(
    rf"(?<![A-Z0-9./])({NUMBER})\s*"
    rf"({UNIT_PATTERN})"
    r"(?![A-Z0-9])",
    re.I,
)
RESISTANCE_CODE_RE = re.compile(rf"(?<![A-Z0-9.])({NUMBER})\s*(R|K|M)(?![A-Z0-9])", re.I)
RESISTANCE_EMBEDDED_RE = re.compile(
    r"(?<![A-Z0-9.])(\d+)(R|K|M)(\d+)(?![A-Z0-9])",
    re.I,
)
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
SINGLE_LENGTH_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*(μm|um|mm|cm|mil|inch|英寸)(?![A-Z0-9])",
    re.I,
)
PIN_COUNT_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*(?:PINS?|针|位)(?![A-Z0-9])",
    re.I,
)
PIN_COUNT_SHORT_RE = re.compile(
    rf"(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*P(?![A-Z0-9])",
    re.I,
)
PITCH_RE = re.compile(
    rf"(?:(?<![A-Z0-9.])({UNSIGNED_NUMBER})\s*(?:mm)?\s*PITCH"
    rf"|(?<![A-Z0-9])PITCH\s*[:：=]?\s*({UNSIGNED_NUMBER})\s*(?:mm)?)(?![A-Z0-9])",
    re.I,
)
COPPER_WEIGHT_RE = re.compile(
    rf"(?<![A-Z0-9.])(?:(\d+)\s*/\s*(\d+)|({UNSIGNED_NUMBER}))\s*OZ(?![A-Z0-9])",
    re.I,
)

CATEGORY_PATTERNS = [
    (re.compile(r"电容|(?<![A-Z])CAP(?:ACITOR)?(?![A-Z])", re.I), "CAP", "电容"),
    (re.compile(r"电阻|(?<![A-Z])RES(?:ISTOR)?(?![A-Z])", re.I), "RES", "电阻"),
    (re.compile(r"电感|(?<![A-Z])IND(?:UCTOR)?(?![A-Z])", re.I), "IND", "电感"),
    (re.compile(r"磁珠|FERRITE\s*BEAD", re.I), "FBEAD", "磁珠"),
    (re.compile(r"二极管|DIODE|TVS", re.I), "DIO", "二极管"),
    (re.compile(r"连接器|CONNECTOR|CONN", re.I), "CON", "连接器"),
    (re.compile(r"(?<![A-Z])IC(?![A-Z])|集成电路|芯片", re.I), "IC", "集成电路"),
    (re.compile(r"麦克风|MICROPHONE", re.I), "MIC", "麦克风"),
    (re.compile(r"滤波器|FILTER", re.I), "FILTER", "滤波器"),
    (re.compile(r"开关|SWITCH", re.I), "SWITCH", "开关"),
    (re.compile(r"天线|ANTENNA", re.I), "ANT", "天线"),
]
MATERIAL_PATTERNS = [
    (re.compile(r"(?<![A-Z0-9])(?:C0G|COG|NP0|NPO)(?![A-Z0-9])", re.I), "C0G/NP0"),
    (re.compile(r"(?<![A-Z0-9])X7R(?![A-Z0-9])", re.I), "X7R"),
    (re.compile(r"(?<![A-Z0-9])X5R(?![A-Z0-9])", re.I), "X5R"),
    (re.compile(r"(?<![A-Z0-9])Y5V(?![A-Z0-9])", re.I), "Y5V"),
    (re.compile(r"(?<![A-Z0-9])Z5U(?![A-Z0-9])", re.I), "Z5U"),
]
INTERFACE_PATTERNS = [
    (re.compile(r"(?<![A-Z0-9])(?:USB[- ]?C|TYPE[- ]?C)(?![A-Z0-9])", re.I), "USB_TYPE_C"),
    (re.compile(r"(?<![A-Z0-9])USB\s*3(?:\.\d)?(?![A-Z0-9])", re.I), "USB_3"),
    (re.compile(r"(?<![A-Z0-9])USB\s*2(?:\.\d)?(?![A-Z0-9])", re.I), "USB_2"),
    (re.compile(r"(?<![A-Z0-9])FPC(?:/FFC)?(?![A-Z0-9])", re.I), "FPC"),
    (re.compile(r"(?<![A-Z0-9])(?:NANO\s*)?SIM(?:\s*CARD)?(?![A-Z0-9])", re.I), "SIM"),
    (re.compile(r"(?<![A-Z0-9])(?:TF|MICRO\s*SD)\s*CARD(?![A-Z0-9])", re.I), "TF_CARD"),
    (re.compile(r"(?<![A-Z0-9])(?:RF|COAXIAL)(?![A-Z0-9])", re.I), "RF"),
    (re.compile(r"MB[- ]?TO[- ]?SUB|BOARD[- ]?TO[- ]?BOARD", re.I), "BOARD_TO_BOARD"),
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
    "VOLTAGE_RANGE": "电压范围",
    "CURRENT_RANGE": "电流范围",
    "POWER_RANGE": "功率范围",
    "FREQUENCY_RANGE": "频率范围",
    "IMPEDANCE_AT_FREQUENCY": "频率/阻抗",
    "BANDWIDTH": "带宽",
    "GAIN_DB": "增益/衰减",
    "TOLERANCE_PERCENT": "百分比误差",
    "CAPACITANCE_TOLERANCE": "容量误差",
    "RESISTANCE_TOLERANCE": "阻值误差",
    "INDUCTANCE_TOLERANCE": "电感误差",
    "CURRENT_TOLERANCE": "电流误差",
    "VOLTAGE_TOLERANCE": "电压误差",
    "POWER_TOLERANCE": "功率误差",
    "MATERIAL": "介质/材质",
    "DIMENSION": "尺寸",
    "LENGTH": "长度/厚度",
    "PIN_COUNT": "针数",
    "PITCH": "间距",
    "COPPER_WEIGHT": "铜厚/铜重",
    "INTERFACE": "接口类型",
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
    "VOLTAGE_RANGE",
    "CURRENT_RANGE",
    "POWER_RANGE",
    "FREQUENCY_RANGE",
    "IMPEDANCE_AT_FREQUENCY",
    "BANDWIDTH",
    "GAIN_DB",
    "TOLERANCE_PERCENT",
    "CAPACITANCE_TOLERANCE",
    "RESISTANCE_TOLERANCE",
    "INDUCTANCE_TOLERANCE",
    "CURRENT_TOLERANCE",
    "VOLTAGE_TOLERANCE",
    "POWER_TOLERANCE",
    "MATERIAL",
    "DIMENSION",
    "LENGTH",
    "PIN_COUNT",
    "PITCH",
    "COPPER_WEIGHT",
    "INTERFACE",
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
    "VOLTAGE_RANGE": 0.18,
    "CURRENT_RANGE": 0.18,
    "POWER_RANGE": 0.16,
    "FREQUENCY_RANGE": 0.16,
    "IMPEDANCE_AT_FREQUENCY": 0.22,
    "BANDWIDTH": 0.16,
    "GAIN_DB": 0.10,
    "TOLERANCE_PERCENT": 0.14,
    "CAPACITANCE_TOLERANCE": 0.14,
    "RESISTANCE_TOLERANCE": 0.14,
    "INDUCTANCE_TOLERANCE": 0.14,
    "CURRENT_TOLERANCE": 0.12,
    "VOLTAGE_TOLERANCE": 0.12,
    "POWER_TOLERANCE": 0.12,
    "MATERIAL": 0.10,
    "DIMENSION": 0.12,
    "LENGTH": 0.10,
    "PIN_COUNT": 0.20,
    "PITCH": 0.20,
    "COPPER_WEIGHT": 0.16,
    "INTERFACE": 0.18,
    "MPN": 0.08,
    "BRAND": 0.03,
}
NON_DISCRIMINATIVE_KINDS = {"CATEGORY"}
AUTO_ANCHOR_KINDS = {
    "CAPACITANCE",
    "RESISTANCE",
    "INDUCTANCE",
    "IMPEDANCE_AT_FREQUENCY",
    "BANDWIDTH",
    "DIMENSION",
    "PIN_COUNT",
    "PITCH",
    "COPPER_WEIGHT",
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


def _normalized_quantity(value, unit):
    kind, base_unit, factor = _unit_info(unit)
    if not kind:
        return "", "", ""
    normalized = _decimal_text(Decimal(value) * Decimal(factor))
    return kind, base_unit, f"{normalized} {base_unit}"


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
    category_codes = {
        token["normalized"]
        for token in tokens
        if token["kind"] == "CATEGORY"
    }
    interface_context = any(pattern.search(source) for pattern, _canonical in INTERFACE_PATTERNS)
    connector_context = "CON" in category_codes or interface_context
    capacitance_shorthand_context = "CAP" in category_codes

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

    for match in FREQUENCY_IMPEDANCE_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        _, _, frequency = _normalized_quantity(match.group(1), match.group(2))
        _, _, impedance = _normalized_quantity(match.group(3), match.group(4))
        if frequency and impedance:
            tokens.append(
                _token(
                    "IMPEDANCE_AT_FREQUENCY",
                    match.group(0),
                    f"{frequency} @ {impedance}",
                )
            )
            occupied.append(match.span())

    for match in BANDWIDTH_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        _, _, normalized = _normalized_quantity(match.group(1), match.group(2))
        if normalized:
            tokens.append(_token("BANDWIDTH", match.group(0), normalized))
            occupied.append(match.span())

    for match in RANGE_QUANTITY_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        first_kind, first_unit, first = _normalized_quantity(match.group(1), match.group(2))
        second_kind, second_unit, second = _normalized_quantity(match.group(3), match.group(4))
        if not first or first_kind != second_kind or first_unit != second_unit:
            continue
        first_number = Decimal(first.split(" ", 1)[0])
        second_number = Decimal(second.split(" ", 1)[0])
        lower, upper = sorted((first_number, second_number))
        range_kind = f"{first_kind}_RANGE"
        if range_kind not in KIND_LABELS:
            continue
        normalized = f"{_decimal_text(lower)}..{_decimal_text(upper)} {first_unit}"
        tokens.append(_token(range_kind, match.group(0), normalized))
        occupied.append(match.span())

    for match in FRACTION_POWER_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        denominator = Decimal(match.group(2))
        if denominator == 0:
            continue
        value = Decimal(match.group(1)) / denominator
        _, base_unit, factor = _unit_info(match.group(3))
        normalized = _decimal_text(value * Decimal(factor))
        tokens.append(_token("POWER", match.group(0), f"{normalized} {base_unit}"))
        occupied.append(match.span())

    for match in DIMENSION_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        values = [part for part in match.groups()[:3] if part is not None]
        unit = (match.group(4) or "").lower()
        normalized = "x".join(_decimal_text(value) for value in values) + (f" {unit}" if unit else "")
        tokens.append(_token("DIMENSION", match.group(0), normalized))
        occupied.append(match.span())

    for match in SINGLE_LENGTH_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        unit = match.group(2).replace("μ", "u").lower()
        factor = {
            "um": Decimal("0.001"),
            "mm": Decimal("1"),
            "cm": Decimal("10"),
            "mil": Decimal("0.0254"),
            "inch": Decimal("25.4"),
            "英寸": Decimal("25.4"),
        }[unit]
        normalized = _decimal_text(Decimal(match.group(1)) * factor)
        tokens.append(_token("LENGTH", match.group(0), f"{normalized} mm"))
        occupied.append(match.span())

    for match in PIN_COUNT_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        tokens.append(_token("PIN_COUNT", match.group(0), _decimal_text(match.group(1))))
        occupied.append(match.span())

    if connector_context:
        for match in PIN_COUNT_SHORT_RE.finditer(source):
            if _overlaps(match.span(), occupied):
                continue
            tokens.append(_token("PIN_COUNT", match.group(0), _decimal_text(match.group(1))))
            occupied.append(match.span())

    for match in PITCH_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        value = match.group(1) or match.group(2)
        tokens.append(_token("PITCH", match.group(0), f"{_decimal_text(value)} mm"))
        occupied.append(match.span())

    for match in COPPER_WEIGHT_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        if match.group(1):
            denominator = Decimal(match.group(2))
            if denominator == 0:
                continue
            value = Decimal(match.group(1)) / denominator
        else:
            value = Decimal(match.group(3))
        tokens.append(_token("COPPER_WEIGHT", match.group(0), f"{_decimal_text(value)} OZ"))
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

    for match in DB_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        tokens.append(_token("GAIN_DB", match.group(0), f"{_decimal_text(match.group(1))} dB"))
        occupied.append(match.span())

    for match in RESISTANCE_CODE_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        multiplier = {"R": "1", "K": "1e3", "M": "1e6"}[match.group(2).upper()]
        normalized = _decimal_text(Decimal(match.group(1)) * Decimal(multiplier))
        tokens.append(_token("RESISTANCE", match.group(0), f"{normalized} OHM"))
        occupied.append(match.span())

    for match in RESISTANCE_EMBEDDED_RE.finditer(source):
        if _overlaps(match.span(), occupied):
            continue
        multiplier = {"R": "1", "K": "1e3", "M": "1e6"}[match.group(2).upper()]
        decimal_value = Decimal(f"{match.group(1)}.{match.group(3)}")
        normalized = _decimal_text(decimal_value * Decimal(multiplier))
        tokens.append(_token("RESISTANCE", match.group(0), f"{normalized} OHM"))
        occupied.append(match.span())

    for match in CAPACITANCE_SHORTHAND_RE.finditer(source):
        if not capacitance_shorthand_context:
            continue
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

    for pattern, canonical in MATERIAL_PATTERNS:
        match = pattern.search(source)
        if match:
            tokens.append(_token("MATERIAL", match.group(0), canonical))
            break

    for pattern, canonical in INTERFACE_PATTERNS:
        for match in pattern.finditer(source):
            tokens.append(_token("INTERFACE", match.group(0), canonical))

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
        elif (
            any(token["kind"] == "INTERFACE" for token in tokens)
            and any(token["kind"] in {"PIN_COUNT", "PITCH"} for token in tokens)
        ):
            tokens.insert(0, _token("CATEGORY", "连接器", "CON"))

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


def assess_specification_evidence(tokens):
    values = token_map(tokens)
    discriminative_kinds = (set(values) & SPEC_KINDS) - NON_DISCRIMINATIVE_KINDS
    parameter_count = sum(len(values[kind]) for kind in discriminative_kinds)
    kind_count = len(discriminative_kinds)
    evidence_strength = min(1.0, kind_count / 3)
    return {
        "evidence_sufficient": kind_count >= 2,
        "auto_eligible": kind_count >= 3 and bool(discriminative_kinds & AUTO_ANCHOR_KINDS),
        "evidence_strength": round(evidence_strength, 4),
        "discriminative_kind_count": kind_count,
        "discriminative_parameter_count": parameter_count,
        "discriminative_kinds": sorted(discriminative_kinds),
    }


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
    raw_similarity = 0.0 if hard_conflicts else intersection_weight / union_weight if union_weight else 0.0
    source_evidence = assess_specification_evidence(source_tokens)
    target_evidence = assess_specification_evidence(target_tokens)
    score = raw_similarity * source_evidence["evidence_strength"]
    full_signature = (
        not conflicts
        and not missing_in_target
        and not missing_in_source
        and source_evidence["auto_eligible"]
        and target_evidence["auto_eligible"]
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
        "raw_similarity": round(min(raw_similarity, 1.0), 4),
        "full_signature": full_signature,
        **source_evidence,
        "target_evidence_sufficient": target_evidence["evidence_sufficient"],
        "target_auto_eligible": target_evidence["auto_eligible"],
        "matched": matched,
        "missing_in_target": missing_in_target,
        "missing_in_source": missing_in_source,
        "conflicts": conflicts,
        "identifier_evidence": identifier_evidence,
    }
