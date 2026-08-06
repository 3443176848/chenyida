const REQUIRED_CONFIRMATION = "MAIN_UAT_FIX26_RFQ1_PROTECTION_READONLY";

if (process.env.ERP_RFQ_ISSUANCE_FIX26_PROTECTION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_ISSUANCE_FIX26_PROTECTION_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

if (!process.env.ERP_FIX26_DATABASE_URL || !process.env.ERP_FIX26_DATABASE_NAME) {
  throw new Error("ERP_FIX26_DATABASE_URL and ERP_FIX26_DATABASE_NAME are required");
}

process.env.ERP_FIX24_DATABASE_URL = process.env.ERP_FIX26_DATABASE_URL;
process.env.ERP_FIX24_DATABASE_NAME = process.env.ERP_FIX26_DATABASE_NAME;
if (process.env.ERP_FIX26_EXPECTED_HASH) process.env.ERP_FIX24_EXPECTED_HASH = process.env.ERP_FIX26_EXPECTED_HASH;

await import("./selfhost-rfq-binding-identifiers-fix24-protection.mjs");
console.info("RFQ_ISSUANCE_CONFIRMATION_FIX26_PROTECTION_OK rfq=1 status=DRAFT version=2 bindings=8 issued=0 quote=0 award=0 po=0");
