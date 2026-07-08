import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(__dirname, "templates");
const outputDir = path.join(__dirname, "output");
const previewDir = path.join(outputDir, "previews");
const finalXlsx = path.join(outputDir, "物料主数据治理模板.xlsx");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function colName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function usedRangeAddress(rowCount, colCount) {
  return `A1:${colName(colCount - 1)}${rowCount}`;
}

function styleTable(sheet, rows, tableName) {
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedRows = rows.map((row) => {
    const next = [...row];
    while (next.length < colCount) next.push("");
    return next.slice(0, colCount);
  });
  const rowCount = normalizedRows.length;
  const address = usedRangeAddress(rowCount, colCount);
  const range = sheet.getRange(address);

  range.values = normalizedRows;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);

  const header = sheet.getRange(`A1:${colName(colCount - 1)}1`);
  header.format = {
    fill: "#155E75",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };

  range.format = {
    borders: { preset: "all", style: "thin", color: "#D9E2EC" },
    wrapText: true,
  };
  header.format = {
    fill: "#155E75",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  range.format.autofitColumns();
  range.format.autofitRows();

  try {
    const table = sheet.tables.add(address, true, tableName);
    table.showFilterButton = true;
    table.showBandedColumns = false;
  } catch {
    // The formatted range is still usable if table creation is unavailable.
  }
}

function styleInstructionSheet(sheet) {
  sheet.showGridLines = false;
  sheet.getRange("A1:F1").merge();
  sheet.getRange("A1").values = [["物料主数据治理执行工作簿"]];
  sheet.getRange("A1").format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF", size: 16 },
  };
  sheet.getRange("A3:B11").values = [
    ["使用顺序", "说明"],
    ["1", "先在“内部物料库”维护晨亿达标准物料。"],
    ["2", "供应商原始清单统一填入“供应商导入”。"],
    ["3", "运行清洗工具后查看“清洗结果”。"],
    ["4", "自动匹配由采购批量确认。"],
    ["5", "疑似匹配由工程或采购确认。"],
    ["6", "新物料进入“新物料审核”。"],
    ["7", "确认后的供应商叫法写入“供应商映射”。"],
    ["8", "客户专用料和替代料分别维护，避免误用。"],
  ];
  sheet.getRange("A3:B3").format = {
    fill: "#155E75",
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("A3:B11").format = {
    borders: { preset: "all", style: "thin", color: "#D9E2EC" },
    wrapText: true,
  };
  sheet.getRange("D3:F8").values = [
    ["首期目标", "" , ""],
    ["高频物料标准化率", "90%以上", ""],
    ["新增物料查重率", "100%", ""],
    ["BOM使用内部编码", "100%", ""],
    ["冲突物料", "每周清零", ""],
    ["人工角色", "从录入转为审核", ""],
  ];
  sheet.getRange("D3:F3").merge();
  sheet.getRange("D3").format = {
    fill: "#155E75",
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("D4:F8").format = {
    borders: { preset: "all", style: "thin", color: "#D9E2EC" },
    wrapText: true,
  };
  sheet.getRange("A:F").format.autofitColumns();
}

const sheets = [
  ["内部物料库", "内部标准物料库.csv", "InternalItems"],
  ["供应商映射", "供应商物料映射表.csv", "SupplierMap"],
  ["供应商导入", "供应商原始物料导入模板.csv", "SupplierImport"],
  ["待清洗池", "待清洗物料池.csv", "CleaningPool"],
  ["新物料审核", "新物料申请审核表.csv", "NewItemReview"],
  ["替代料", "替代料关系表.csv", "AlternateItems"],
  ["客户专用料", "客户专用料表.csv", "CustomerSpecific"],
  ["属性模板", "物料属性模板.csv", "AttributeTemplate"],
  ["清洗结果", path.join("output", "待确认清洗结果.csv"), "CleaningResult"],
];

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const workbook = Workbook.create();
const instructionSheet = workbook.worksheets.add("使用说明");
styleInstructionSheet(instructionSheet);

for (const [sheetName, fileName, tableName] of sheets) {
  const csvPath = path.isAbsolute(fileName) ? fileName : path.join(__dirname, fileName.startsWith("output") ? fileName : path.join("templates", fileName));
  const csvText = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  const sheet = workbook.worksheets.add(sheetName);
  styleTable(sheet, rows, tableName);
}

const sheetList = await workbook.inspect({
  kind: "sheet",
  include: "name",
  maxChars: 2000,
});
console.log(sheetList.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
  maxChars: 2000,
});
console.log(formulaErrors.ndjson);

for (const sheetName of ["使用说明", ...sheets.map(([sheetName]) => sheetName)]) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(finalXlsx);
console.log(`已导出: ${finalXlsx}`);
