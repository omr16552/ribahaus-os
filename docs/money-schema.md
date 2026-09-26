# Money layer schema plan (Postgres, separate from Notion)

Status: **draft, not yet applied.** Nothing in this file exists in a live database yet — this is the plan to execute the moment a `POSTGRES_URL` is available in the Vercel project's environment variables.

## Why a separate store

Notion stays the source of truth for Sales, Clients, and Projects (per the v2 brief). The sections below — Ad Spend, Invoices, Expenses, Subscriptions, and Projections — get their own Postgres database instead, because:

- They're transactional/numeric data (totals, running balances) rather than freeform records — a real database with SQL aggregation is a better fit than a page-based tool.
- Invoices and expenses need an actual file per record (the PDF/receipt), which is stored in Google Drive; Postgres holds only the metadata and a link to that file, never the file itself.
- The app's frontend/API code doesn't need to know or care which store backs which section — `api/ad-spend.js`, `api/invoices.js`, etc. will follow the exact same `{status: 'ok'|'not_connected'|'error', data}` contract already used by `api/crm.js` and `api/projects.js`. Swapping Postgres for Supabase later (both are plain Postgres) is a connection-string change, not a rewrite.

## Cross-referencing Notion records

Postgres has no knowledge of Notion's page IDs as real foreign keys, so every table that relates to a client stores two loose-coupled columns instead of a hard FK:

- `client_notion_id` (text, nullable) — the Notion page ID of the Sales CRM row, when the record is tied to a specific client.
- `client_name` (text) — denormalized display copy, so the UI never needs a live Notion lookup just to render a name, and so the row still means something if the Notion page is later renamed or deleted.

## Tables

### `ad_spend`
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
  drive_file_id text,     -- Google Drive file id of the actual invoice PDF
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

## Google Drive attachment pattern

For Invoices and Expenses, the file itself never touches Postgres:

1. A Google service account (Drive API scope) gets edit access to one Drive folder per record type (or one shared folder with subfolders).
2. A new `api/drive-upload.js` serverless function accepts a file, uploads it to that folder via the service account, and returns `{fileId, fileUrl}`.
3. The invoice/expense row stores `drive_file_id` and `drive_file_url` from that response — nothing else changes about how the row is queried or displayed.

This keeps the database small and fast, keeps the actual documents in a place Omar can also browse directly in Drive, and means switching file storage later (e.g. to S3) only touches `drive-upload.js`, not the data model.

## Rollout order once credentials arrive

1. Create the Vercel Postgres database, run the `CREATE TABLE` statements above.
2. Add `lib/db.js` (a thin Postgres client wrapper, same shape as `lib/notion-crm.js`) plus one `lib/money-*.js` + `api/*.js` pair per section, following the existing `{connected, reason}` / `{status, data}` contracts.
3. Wire the Invoices view first (it's the one with the clearest manual workflow — issue, send, mark paid), then Expenses and Subscriptions, then the computed Projections view last since it depends on all the others having real data.
4. Add the Google service account and `drive-upload.js` alongside the Invoices wiring, since that's the first section that needs file attachments.
