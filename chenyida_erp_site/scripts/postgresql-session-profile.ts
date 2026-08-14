export const CONTROLLED_SEARCH_PATH = "pg_catalog,public,pg_temp";
export const CONTROLLED_STARTUP_OPTIONS = `-c search_path=${CONTROLLED_SEARCH_PATH}`;
// Leaving pg_catalog implicit keeps it first for lookups while making public
// the creation target for the historical, unqualified migration DDL. Listing
// pg_temp explicitly after public also prevents temporary relation shadowing.
export const CONTROLLED_MIGRATION_SEARCH_PATH = "public,pg_temp";
