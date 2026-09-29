/**
 * GraphQL documents for the Jobber pull and note-writing.
 *
 * Every field below was checked on 2026-09-29 against (a) the live schema, read by unauthenticated
 * introspection of https://api.getjobber.com/api/graphql with X-JOBBER-GRAPHQL-VERSION 2026-09-25, and
 * (b) the "Important Objects" reference at https://developer.getjobber.com/docs (Client, Quote, Job,
 * Invoice, Request, Property, Assessment, User), and/or (c) the production queries of the open-source
 * amp-labs Jobber connector (github.com/amp-labs/connectors, providers/jobber/graphql).
 *
 * Schema facts that shaped these documents (all from introspection):
 * - quoteNumber: String!, jobNumber: Int!, invoiceNumber: String!  (ids are EncodedId strings)
 * - Quote.lastTransitioned { approvedAt changesRequestedAt convertedAt } — no archivedAt; archived quotes use
 *   Quote.transitionedAt ("time the quote transitioned to its current status").
 * - Quote.sentAt is the time the quote was LAST sent.
 * - QuoteLineItem.recommended: "When the line item is optional, is it recommended or has it been selected to be
 *   included by the client?" (`selected` is deprecated in favour of `recommended`).
 * - Filters: clients/quotes/invoices/requests(filter: { updatedAt: Iso8601DateTimeRangeInput { after before eq } }).
 *   jobs has NO updatedAt filter (JobFilterAttributes: createdAt/startAt/endAt/completedAt/status/...), but
 *   jobs(sort: [{ key: UPDATED_AT, direction: DESCENDING }]) exists — incremental job pulls walk newest-first
 *   and stop at `since`.
 * - Mutations: quoteCreateNote(quoteId: EncodedId!, input: QuoteCreateNoteInput! { message pinned ... })
 *   and clientCreateNote(clientId: EncodedId!, input: ClientCreateNoteInput! { message pinned ... }),
 *   both returning { userErrors { message path } }. Verified by introspection only (not in the narrative docs).
 *
 * Deliberately NOT queried (exists in the schema but isn't in the public reference or a known production query,
 * so a visibility rule could fail the whole query): Client.leadSource, SourceAttribution subfields,
 * Quote.quoteTransitionHistory. Job line items are skipped to keep cost down (breakage uses quote lines).
 *
 * Cost: page sizes keep every page's estimated requestedQueryCost under ~5,000 of the 10,000-point bucket
 * (see estimateQueryCost; the test suite asserts it): clients ~3,350, quotes ~4,060, jobs ~1,500, invoices ~1,250,
 * requests ~1,450. Quotes page at 20 because each carries up to 20 line items. Jobber subtracts the ACTUAL cost
 * (real node counts, far lower), so the bucket rarely runs dry; the requested cost only has to fit what is available.
 */

export const PAGE_SIZE = 50;
export const QUOTE_PAGE_SIZE = 20;
export const QUOTE_LINE_ITEMS = 20;
export const CLIENT_TAGS = 10;
export const CLIENT_PROPERTIES = 5;
/** Target ceiling for one page's requested cost. */
export const PAGE_COST_BUDGET = 5_000;

const ADDRESS = `street1 street2 city province postalCode`;
/** Enough of the client to stand in for it when the client itself wasn't in this pull (incremental syncs). */
const CLIENT_REF = `client { id name firstName lastName companyName isCompany }`;

export const ACCOUNT_QUERY = /* GraphQL */ `
  query QaAccount {
    account { id name }
  }
`;

export const CLIENTS_QUERY = /* GraphQL */ `
  query QaClients($first: Int!, $after: String, $filter: ClientFilterAttributes) {
    clients(first: $first, after: $after, filter: $filter) {
      nodes {
        id
        name
        firstName
        lastName
        companyName
        isCompany
        isLead
        isArchived
        createdAt
        updatedAt
        receivesFollowUps
        receivesQuoteFollowUps
        emails { address primary }
        phones { number primary }
        billingAddress { ${ADDRESS} }
        tags(first: ${CLIENT_TAGS}) { nodes { label } }
        clientProperties(first: ${CLIENT_PROPERTIES}) { nodes { address { ${ADDRESS} } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const QUOTES_QUERY = /* GraphQL */ `
  query QaQuotes($first: Int!, $after: String, $filter: QuoteFilterAttributes) {
    quotes(first: $first, after: $after, filter: $filter) {
      nodes {
        id
        quoteNumber
        quoteStatus
        title
        createdAt
        updatedAt
        sentAt
        clientHubViewedAt
        transitionedAt
        lastTransitioned { approvedAt changesRequestedAt convertedAt }
        amounts { subtotal total }
        ${CLIENT_REF}
        property { address { ${ADDRESS} } }
        salesperson { name { full } }
        request { id }
        jobs(first: 5) { nodes { jobNumber } }
        lineItems(first: ${QUOTE_LINE_ITEMS}) {
          nodes { name description quantity unitPrice totalPrice optional recommended textOnly }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const JOBS_QUERY = /* GraphQL */ `
  query QaJobs($first: Int!, $after: String, $sort: [JobsSortInput!]) {
    jobs(first: $first, after: $after, sort: $sort) {
      nodes {
        id
        jobNumber
        title
        jobStatus
        jobType
        createdAt
        updatedAt
        startAt
        endAt
        completedAt
        total
        ${CLIENT_REF}
        quote { quoteNumber }
        property { address { ${ADDRESS} } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const INVOICES_QUERY = /* GraphQL */ `
  query QaInvoices($first: Int!, $after: String, $filter: InvoiceFilterAttributes) {
    invoices(first: $first, after: $after, filter: $filter) {
      nodes {
        id
        invoiceNumber
        subject
        invoiceStatus
        createdAt
        updatedAt
        issuedDate
        dueDate
        receivedDate
        amounts { total invoiceBalance }
        ${CLIENT_REF}
        jobs(first: 3) { nodes { jobNumber } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const REQUESTS_QUERY = /* GraphQL */ `
  query QaRequests($first: Int!, $after: String, $filter: RequestFilterAttributes) {
    requests(first: $first, after: $after, filter: $filter) {
      nodes {
        id
        title
        requestStatus
        createdAt
        updatedAt
        source
        assessment { startAt completedAt }
        ${CLIENT_REF}
        property { address { ${ADDRESS} } }
        quotes(first: 3) { nodes { quoteNumber } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Resolve a quote number (what CSV imports know) to Jobber's EncodedId before writing a note. */
export const QUOTE_BY_NUMBER_QUERY = /* GraphQL */ `
  query QaQuoteByNumber($number: Int!) {
    quotes(first: 1, filter: { quoteNumber: { eq: $number } }) {
      nodes { id quoteNumber }
    }
  }
`;

/**
 * Note mutations — signatures verified by schema introspection (2026-09-25), not exercised against a live account.
 * Kept behind one constant so they're easy to swap if Jobber changes them.
 */
export const NOTE_MUTATIONS = {
  quote: /* GraphQL */ `
    mutation QaQuoteNote($id: EncodedId!, $message: String!) {
      quoteCreateNote(quoteId: $id, input: { message: $message }) {
        quoteNote { id }
        userErrors { message path }
      }
    }
  `,
  client: /* GraphQL */ `
    mutation QaClientNote($id: EncodedId!, $message: String!) {
      clientCreateNote(clientId: $id, input: { message: $message }) {
        clientNote { id }
        userErrors { message path }
      }
    }
  `,
} as const;

/* ------------------------------------------------------------------ */
/* Response node shapes (only what we select)                          */
/* ------------------------------------------------------------------ */

export interface ApiAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

export interface ApiClientRef {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isCompany?: boolean | null;
}

export interface ApiClient extends ApiClientRef {
  isLead?: boolean | null;
  isArchived?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  receivesFollowUps?: boolean | null;
  receivesQuoteFollowUps?: boolean | null;
  emails?: { address: string; primary?: boolean | null }[] | null;
  phones?: { number: string; primary?: boolean | null }[] | null;
  billingAddress?: ApiAddress | null;
  tags?: { nodes: { label: string }[] } | null;
  clientProperties?: { nodes: { address?: ApiAddress | null }[] } | null;
}

export interface ApiLineItem {
  name: string;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  optional?: boolean | null;
  recommended?: boolean | null;
  textOnly?: boolean | null;
}

export interface ApiQuote {
  id: string;
  quoteNumber: string | number;
  quoteStatus: string;
  title?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sentAt?: string | null;
  clientHubViewedAt?: string | null;
  transitionedAt?: string | null;
  lastTransitioned?: { approvedAt?: string | null; changesRequestedAt?: string | null; convertedAt?: string | null } | null;
  amounts?: { subtotal?: number | null; total?: number | null } | null;
  client?: ApiClientRef | null;
  property?: { address?: ApiAddress | null } | null;
  salesperson?: { name?: { full?: string | null } | null } | null;
  request?: { id: string } | null;
  jobs?: { nodes: { jobNumber: number | string }[] } | null;
  lineItems?: { nodes: ApiLineItem[] } | null;
}

export interface ApiJob {
  id: string;
  jobNumber: number | string;
  title?: string | null;
  jobStatus: string;
  jobType?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  completedAt?: string | null;
  total?: number | null;
  client?: ApiClientRef | null;
  quote?: { quoteNumber: string | number } | null;
  property?: { address?: ApiAddress | null } | null;
}

export interface ApiInvoice {
  id: string;
  invoiceNumber: string | number;
  subject?: string | null;
  invoiceStatus: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  issuedDate?: string | null;
  dueDate?: string | null;
  receivedDate?: string | null;
  amounts?: { total?: number | null; invoiceBalance?: number | null } | null;
  client?: ApiClientRef | null;
  jobs?: { nodes: { jobNumber: number | string }[] } | null;
}

export interface ApiRequest {
  id: string;
  title?: string | null;
  requestStatus: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  source?: string | null;
  assessment?: { startAt?: string | null; completedAt?: string | null } | null;
  client?: ApiClientRef | null;
  property?: { address?: ApiAddress | null } | null;
  quotes?: { nodes: { quoteNumber: string | number }[] } | null;
}
