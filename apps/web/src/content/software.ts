import type { SourceSystem } from "@qa/engine";

export interface ExportGuide {
  id: SourceSystem;
  label: string;
  note: string;
  /** The one file that matters most. */
  main: { title: string; steps: string[]; heads?: string };
  /** Files that make the scan sharper (past customers, jobs, invoices). */
  extras: { title: string; steps: string[]; why: string }[];
}

export const SOFTWARE_GUIDES: ExportGuide[] = [
  {
    id: "jobber",
    label: "Jobber",
    note: "Works on every Jobber plan. No add-ons, nothing to install.",
    main: {
      title: "Quotes report",
      steps: ["Open Insights → Reports", "Under Work reports, open Quotes", "Set the date range to All time", "Tap Export → CSV, and include all columns"],
      heads: "Jobber emails the file to your login address instead of downloading it. Open that email and drop the file here.",
    },
    extras: [
      { title: "Clients", steps: ["Clients → ⋯ → Export clients"], why: "Finds past customers who never came back. Jobber sends 1,500 rows per file; drop them all." },
      { title: "Jobs", steps: ["Insights → Reports → One-off jobs (and Recurring jobs) → All time → Export"], why: "Shows who already came back so we never bother them, and when each job was done." },
      { title: "Invoices", steps: ["Insights → Reports → Invoices → All time → Export"], why: "Lets us measure what came back in dollars." },
      { title: "Requests", steps: ["Insights → Reports → Requests → All time → Export"], why: "Finds people who asked for a price and never got one." },
    ],
  },
  {
    id: "housecall_pro",
    label: "Housecall Pro",
    note: "Pipeline only follows up on estimates sent after you turned it on. We go back through all of them.",
    main: {
      title: "Estimates",
      steps: ["Open the Estimates tab", "Filter → Outcome: Open, Lost and Won", "Actions → Export → Send file"],
      heads: "Housecall Pro emails the file to whoever ran the export. You need reporting access for the tab to show.",
    },
    extras: [
      { title: "Customers", steps: ["Customers → Export"], why: "Finds past customers who are due again." },
      { title: "Jobs", steps: ["Jobs → filter all dates → Export"], why: "Shows who already came back." },
    ],
  },
  {
    id: "servicetitan",
    label: "ServiceTitan",
    note: "Dismissed and 'won' opportunities hide their other unsold estimates. We find those too.",
    main: {
      title: "Opportunity and Estimate Follow Up report",
      steps: ["Reports → Opportunity and Estimate Follow Up", "Date range: as far back as it goes", "Export to Excel or CSV"],
    },
    extras: [{ title: "Customers", steps: ["Reports → Customer list → Export"], why: "Adds emails and addresses the estimate report leaves out." }],
  },
  {
    id: "quickbooks",
    label: "QuickBooks",
    note: "QuickBooks never follows up on an estimate. Every 'Pending' one is fair game.",
    main: {
      title: "Estimates by Customer",
      steps: ["Reports → search 'Estimates by Customer'", "Report period: All dates", "Export → Export to Excel (or CSV)"],
    },
    extras: [
      { title: "Customer contact list", steps: ["Reports → Customer Contact List → Export"], why: "Adds the emails the estimate report doesn't include." },
      { title: "Sales by Customer Detail", steps: ["Reports → Sales by Customer Detail → All dates → Export"], why: "Shows who paid you and when." },
    ],
  },
  {
    id: "spreadsheet",
    label: "A spreadsheet",
    note: "Any layout works. We read the columns ourselves.",
    main: {
      title: "Your quote list",
      steps: ["Save it as CSV (File → Save As → CSV) or export from Google Sheets (File → Download → CSV)", "Name, email, what you quoted, the price and the date are all we need"],
    },
    extras: [],
  },
  {
    id: "unknown",
    label: "Something else",
    note: "Arborgold, SingleOps, Yardbook, LMN, Aspire, Service Autopilot, Workiz, ZenMaid, GorillaDesk and more.",
    main: {
      title: "Estimates or proposals export",
      steps: ["Look for Reports → Estimates (or Proposals)", "Choose all dates and export to CSV or Excel", "Stuck? Message your software's support: \"How do I export all my estimates to a CSV?\" They answer this every day."],
    },
    extras: [{ title: "Customer list", steps: ["Customers → Export"], why: "Finds past customers who are due again." }],
  },
];
