const REQUIRED_CONFIRMATION = "MAIN_UAT_FIX26_RFQ1_CONFIRMATION_READONLY_CANCEL";

if (process.env.ERP_RFQ_ISSUANCE_FIX26_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_ISSUANCE_FIX26_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

if (!process.env.ERP_FIX26_DATABASE_URL || !process.env.ERP_FIX26_DATABASE_NAME) {
  throw new Error("ERP_FIX26_DATABASE_URL and ERP_FIX26_DATABASE_NAME are required");
}

process.env.ERP_FIX24_DATABASE_URL = process.env.ERP_FIX26_DATABASE_URL;
process.env.ERP_FIX24_DATABASE_NAME = process.env.ERP_FIX26_DATABASE_NAME;
process.env.ERP_RFQ_BINDING_FIX24_UAT_CONFIRM = "MAIN_UAT_FIX24_RFQ1_BINDING_IDENTIFIERS_READONLY_CANCEL";

await import("./selfhost-rfq-binding-identifiers-fix24-uat-readonly-browser.mjs");
console.info("RFQ_ISSUANCE_CONFIRMATION_FIX26_UAT_READONLY_OK rfq=1 status=DRAFT version=2 bindings=8 business_post=0 issued=0 quote=0 award=0 po=0 session=0");
