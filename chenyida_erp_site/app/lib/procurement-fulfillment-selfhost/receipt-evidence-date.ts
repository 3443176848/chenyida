import { ProcurementError } from "../procurement-selfhost/errors.ts";

export const RECEIPT_EVIDENCE_FUTURE_DATE_MESSAGE = "送货凭证日期不能晚于服务端实际收货日期";

function isLeapYear(year: number) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

export function isCanonicalReceiptEvidenceDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function receiptEvidenceDate(value: unknown) {
  const result = String(value ?? "");
  if (!isCanonicalReceiptEvidenceDate(result)) {
    throw new ProcurementError("RECEIPT_EVIDENCE_DATE_INVALID", "送货凭证日期必须是有效的YYYY-MM-DD日期", 422);
  }
  return result;
}

export function optionalReceiptEvidenceDate(value: string | null) {
  return value === null ? null : receiptEvidenceDate(value);
}

export function assertReceiptEvidenceDateNotFuture(evidenceDate: string, serverDateShanghai: string) {
  if (evidenceDate > serverDateShanghai) {
    throw new ProcurementError("RECEIPT_EVIDENCE_FUTURE_DATE", RECEIPT_EVIDENCE_FUTURE_DATE_MESSAGE, 422);
  }
}
