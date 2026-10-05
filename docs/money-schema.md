# Money layer schema plan (Postgres, separate from Notion)

Status: **partly applied.** The `ribahaus-money` Postgres database (Vercel Storage → Neon, connected to `ribahaus-os`, connection string `process.env.POSTGRES_URL`) has the Money tables live. Invoices, Expenses, and Subscriptions have live `lib/money-*.js` + `api/*.js` pairs with the `index.html` frontend wired up. **Ad Spend was dropped** from the product (its page is replaced by Retainers and Proposals, below); the `ad_spend` table already exists in the database but is unused and can be dropped. **Retainers and Proposals** are built in code (`lib/money-retainers.js`, `lib/money-proposals.js`, `api/retainers.js`, `api/proposals.js`, frontend views) but their tables are created and live in Neon. **Entry forms** for all five Money and Clients & Work screens are live, and invoices and expenses accept a Dropbox link. A **Finance** page (monthly P&L, cost breakdown, cash outlook, payroll and freelancer ledger) is live, backed by the new `team_payments` table. The computed Projections view is still pending.

## Why a separate store

Notion stays the source of truth for Sales, Clients, and Projects (per the v2 brief). The sections below — Invoices, Expenses, Subscriptions, Retainers, Proposals, and Projections — get their own Postgres database instead, because:

- They're transactional/numeric data (totals, running balances) rather than freeform records — a real database with SQL aggregation is a better fit than a page-based tool.
- Invoices and expenses need an actual file per record (the PDF/receipt), which is stored in Dropbox; Postgres holds only the metadata and a link to that file, never the file itself.
- The app's frontend/API code doesn't need to know or care which store backs which section — `api/invoices.js`, `api/retainers.js`, etc. will follow the exact same `{status: 'ok'|'not_connected'|'error', data}` contract already used by `api/crm.js` and `api/projects.js`. Swapping Postgres for Supabase later (both are plain Postgres) is a connection-string change, not a rewrite.

## Cross-referencing Notion records

Postgres has no knowledge of Notion's page IDs as real foreign keys, so every table that relates to a client stores two loose-coupled columns instead of a hard FK:

- `client_notion_id` (text, nullable) — the Notion page ID of the Sales CRM row, when the record is tied to a specific client.
- `client_name` (text) — denormalized display copy, so the UI never needs a live Notion lookup just to render a name, and so the row still means something if the Notion page is later renamed or deleted.

## Tables

### `ad_spend` (retired — table exists but is unused; no code reads it)
```sql
CREATE TABLE ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_notion_id text,
  client_name text,
  campaign_name text NOT NULL,
  platform text NOT NULL,           -- 'Meta' | 'Google' | 'TikTok' | 'LinkedIn' | 'Other'
  spend_amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  period_start date NOT NULL,
  period_end date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_spend_client_idx ON ad_spend (client_notion_id);
CREATE INDEX ad_spend_period_idx ON ad_spend (period_start, period_end);
```

### `invoices`
```sql
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  client_notion_id text,
  client_name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  issue_date date NOT NULL,
  due_date date,
  paid_date date,
  drive_file_id text,     -- legacy name; will become a provider-neutral file id (files live in Dropbox)
  drive_file_url text,    -- shareable link, for one-click open from the UI
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_status_idx ON invoices (status);
CREATE INDEX invoices_client_idx ON invoices (client_notion_id);
```

### `expenses`
```sql
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor text NOT NULL,
  category text NOT NULL,   -- 'Software' | 'Payroll' | 'Rent' | 'Contractors' | 'Marketing' | 'Other'
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  expense_date date NOT NULL,
  drive_file_id text,    -- receipt, same Drive pattern as invoices
  drive_file_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_category_idx ON expenses (category);
CREATE INDEX expenses_date_idx ON expenses (expense_date);
```

### `subscriptions`
```sql
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,             -- e.g. "Adobe Creative Cloud"
  vendor text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  billing_cycle text NOT NULL,    -- 'monthly' | 'quarterly' | 'yearly'
  next_renewal_date date,
  status text NOT NULL DEFAULT 'active',   -- 'active' | 'paused' | 'cancelled'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);
```

### `projection_scenarios` (optional — for saved what-ifs)
Projections themselves are **computed**, not hand-entered — the default Projections view will calculate revenue/cash-flow forecasts live from the Sales pipeline (Notion) plus Invoices/Expenses/Subscriptions (Postgres) at request time, no separate storage needed. This table only exists to let Omar save a named scenario with adjusted assumptions (e.g. "what if win rate drops to 30%") without touching the real data:
```sql
CREATE TABLE projection_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text NOT NULL,
  assumptions jsonb NOT NULL,   -- e.g. {"winRateOverridePct": 30, "expenseGrowthPct": 5}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `retainers`
Replaces the Ad Spend page. One row per client contract; feeds renewals and (later) Projections with recurring revenue. `contract_url` is a Dropbox shared link.
```sql
CREATE TABLE retainers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_notion_id text,
  client_name text NOT NULL,
  monthly_fee numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  scope text,
  start_date date NOT NULL,
  end_date date,              -- null = open-ended
  status text NOT NULL DEFAULT 'active',   -- active | paused | ended
  auto_renew boolean NOT NULL DEFAULT false,
  contract_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retainers_status_idx ON retainers (status);
CREATE INDEX retainers_client_idx ON retainers (client_notion_id);
CREATE INDEX retainers_end_idx ON retainers (end_date);
```
`GET /api/retainers` returns the list plus stats: active count, monthly recurring revenue, retainers ending within 30/60/90 days, and active retainers already past their end date.

### `proposals`
Sits between a Sales lead and a signed retainer. `file_url` is a Dropbox shared link.
```sql
CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  client_notion_id text,
  client_name text NOT NULL,
  value numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  status text NOT NULL DEFAULT 'draft',    -- draft | sent | accepted | lost
  sent_date date,
  valid_until date,
  file_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposals_status_idx ON proposals (status);
CREATE INDEX proposals_client_idx ON proposals (client_notion_id);
```
`GET /api/proposals` returns the list plus stats: open count and value (draft + sent), accepted value, and win rate (accepted / accepted + lost).

### `team_payments`
Salaries, freelancers, and bonuses, one row per payment per month. Feeds the Finance page. `file_url` is a Dropbox shared link (payslip or freelancer invoice). Log payroll and freelancers here rather than as Expenses, so nothing is counted twice.
```sql
CREATE TABLE team_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_name text NOT NULL,
  payee_type text NOT NULL DEFAULT 'salary',   -- salary | freelancer | bonus
  role text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  period_month date NOT NULL,                  -- first day of the month the payment is for
  pay_date date,
  status text NOT NULL DEFAULT 'pending',      -- pending | paid
  file_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_payments_period_idx ON team_payments (period_month);
CREATE INDEX team_payments_status_idx ON team_payments (status);
```
`GET /api/finance?months=6` returns the monthly P&L, cost breakdown, 30/60/90-day cash outlook, and the ledger. Income is cash (invoices marked paid, in the month paid). Team costs count in the month they are for, expenses by date, and subscriptions at today's monthly run-rate. `POST /api/finance` adds a payment (or copies last month's salaries with `{ "action": "copySalaries", "from": "2026-09", "to": "2026-10" }`), and `PATCH /api/finance?id=...` updates one, for example marking it paid.

## Hosting note: Vercel Hobby allows 12 API files
`api/` is at that limit (the Google Drive status endpoint was removed to make room for `api/finance.js`). New endpoints should extend an existing file (as Finance does for team payments) or wait for a plan upgrade.

## File storage: Dropbox (links first)

Invoices, expense receipts, contracts, proposals, and reports are created by hand and filed in Dropbox, which has the larger storage. Postgres never holds files, only references.

- **Phase 1 (current plan):** each record carries a pasted Dropbox shared link and the UI shows a "view file" button. No Dropbox API, app, or secrets needed. `retainers.contract_url` and `proposals.file_url` already work this way. `invoices` and `expenses` store the link in the older `drive_file_url` column (with an unused `drive_file_id`), which will be renamed to provider-neutral names (for example `file_provider`, `file_id`, `file_url`) in a follow-up.
- **Phase 2 (when the agency brain is built):** a Dropbox app with read access so the knowledge base can index the folders, plus an optional picker and upload from the UI. Credentials go straight into Vercel environment variables, never into chat or code.
- Keep a consistent folder and naming convention (for example `/Invoices/2026/INV-0042 - Client.pdf`); the brain's search quality depends on it.

## Rollout order

1. ✅ Create the Vercel Postgres database, run the `CREATE TABLE` statements above. (`ribahaus-money` on Neon, connected to `ribahaus-os`.)
2. ✅ Add `lib/db.js` (a thin Postgres client wrapper, same shape as `lib/notion-crm.js`) plus one `lib/money-*.js` + `api/*.js` pair per section, following the existing `{connected, reason}` / `{status, data}` contracts. (`lib/db.js` uses `@neondatabase/serverless`; declared in `package.json`.)
3. ✅ Wire Invoices, Expenses, and Subscriptions end to end — backend and frontend. `lib/money-invoices.js` + `api/invoices.js`, `lib/money-expenses.js` + `api/expenses.js`, and `lib/money-subscriptions.js` + `api/subscriptions.js` are all live (`GET` for list + rollup stats, `POST` to create, `PATCH ?id=...` to update). `index.html` now calls all three on view-show and renders the stat grid, connection banner, and row list for each, matching the pattern already used for Sales/Clients/Projects.
4. ✅ (code) Replace Ad Spend with Retainers and Proposals: backend files and frontend views are written and tested against a mocked database. ✅ The `retainers` and `proposals` tables are created in Neon (via a single `DO $$ ... $$` block, since the console runs one statement at a time).
5. ✅ Dropbox link field on Invoices and Expenses (stored in `drive_file_url`; rows show a "View file" / "View receipt" link).
6. ⏳ Computed Projections view, using retainer recurring revenue plus the Sales pipeline and the other Money tables.
7. ✅ Entry forms: the "New …" button on Retainers, Proposals, Invoices, Expenses, and Subscriptions opens a modal that POSTs to the matching endpoint. Editing existing rows (for example marking an invoice paid) is not built yet; the PATCH endpoints exist.
8. ✅ Finance page with payroll and freelancer ledger (`team_payments`, `lib/money-team.js`, `lib/money-finance.js`, `api/finance.js`). It stores salary data behind an open API, so login comes next.
9. ⏳ Auth and team roles, then the agency brain (pgvector knowledge base, same Postgres) last.
