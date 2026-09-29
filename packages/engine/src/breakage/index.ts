export { scan, type ContactState, type ScanResult, type ScanStats } from "./detect.ts";
export { summarize, fitCheck, silentAudit, closeRate, type DrawerSummary, type FitCheck, type SilentAudit, type TypeSummary } from "./forecast.ts";
export { ADJUST, AGE_DECAY, alwaysOnFor, ALWAYS_ON_MIN_DAYS, BAND, BREAKAGE_LABEL, FRESH_QUOTE_DAYS, RECOVERY_PRIOR, SALES_TYPES, TYPE_RANK, WINDOW } from "./assumptions.ts";
export { readiness, type DataGap, type Readiness } from "./readiness.ts";
export { shopProfile, type ShopProfile } from "./profile.ts";
export { BAD_CUSTOMER, cautionReasons, isBadCustomer } from "./caution.ts";
