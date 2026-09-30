export { scan, type ContactState, type ScanResult, type ScanStats } from "./detect.ts";
export { summarize, fitCheck, silentAudit, closeRate, onTheTable, type OnTheTable, type DrawerSummary, type FitCheck, type SilentAudit, type TypeSummary } from "./forecast.ts";
export { ADJUST, AGE_DECAY, alwaysOnFor, ALWAYS_ON_MIN_DAYS, BREAKAGE_LABEL, CALL_OVER_AMOUNT, FRESH_QUOTE_DAYS, MAX_NOTES_PER_THREAD, rangeFactor, RECOVERY_PRIOR, RECOVERY_RANGE, SALES_TYPES, TYPE_RANK, WINDOW } from "./assumptions.ts";
export { readiness, type DataGap, type Readiness } from "./readiness.ts";
export { shopProfile, type ShopProfile } from "./profile.ts";
export { BAD_CUSTOMER, cautionReasons, isBadCustomer, isCallListReason } from "./caution.ts";
export { callList, type CallList, type CallListEntry } from "./calllist.ts";
export { pct, quietRates, type QuietRate, type QuietRates } from "./quiet.ts";
