# Tally Cloud (UAE)

A keyboard-first, Tally-style accounting system for UAE businesses: double-entry books, inventory,
bill-wise receivables/payables and UAE VAT (Form VAT 201).

## Run it

```bash
npm install
npm run dev        # API on :4000, web on http://localhost:5173
```

No database install is needed: the API uses **PGlite** (real PostgreSQL compiled to WebAssembly) and
stores data in `server/data/`. To use a PostgreSQL server instead, set `DATABASE_URL`
(e.g. `postgres://user:pass@localhost:5432/tally`) before starting.

On first launch press **Alt+M** for a demo company (Al Noor Trading LLC, Dubai) with a year of vouchers,
or **Alt+C** to create your own.

```bash
npm test -w server  # database integrity checks against a throwaway in-memory DB
```

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19 + TypeScript + Vite + Tailwind CSS 4, own keyboard layer (no mouse needed) |
| API | Node + Express 5 + Zod validation |
| DB | PostgreSQL (PGlite embedded, or any Postgres via `DATABASE_URL`) with Drizzle ORM |
| Money | `NUMERIC(20,4)` in the DB, `decimal.js` in code, strings over JSON — never JS floats |

## Integrity rules enforced by the database

These live in `server/src/db/migrations/0002_integrity.sql`, so no code path can bypass them:

- **Double entry**: a deferred constraint trigger rejects any voucher whose ledger entries do not sum to zero, checked at COMMIT.
- **Period lock**: no voucher can be created, altered or deleted on or before the company's lock date, or before books begin.
- **Predefined masters** (the 28 groups, Profit & Loss A/c, base voucher types) cannot be deleted.
- Every create / alter / cancel / delete is written to an **audit log** with before and after state.

## Features

**Company**: multiple companies, financial year and books-beginning dates, VAT registration and TRN, period lock (Alt+K).

**Masters** (Gateway → Create / Alter, or Alt+G): the 28 predefined Tally groups and your own sub-groups; ledgers with
opening balances, bill-wise tracking and credit days, mailing details, emirate, VAT treatment and TRN, bank details (IBAN/SWIFT),
default VAT category; voucher types with prefix and automatic numbering; stock groups, stock items (VAT category, selling price,
reorder level, opening stock by godown), units, godowns. Chart of Accounts tree.

**Vouchers**: Contra F4, Payment F5, Receipt F6, Journal F7, Sales F8, Purchase F9, Credit Note Ctrl+F8, Debit Note Ctrl+F9,
Stock Journal Alt+F7, Physical Stock Alt+F10.
- Payment / receipt / contra in Tally's single-entry mode; journal in Dr/Cr mode with auto-balancing.
- Invoices with item lines (qty, rate, discount, godown) and ledger lines (services, freight, discounts), per-line VAT.
- Bill-wise allocation (Agst Ref / New Ref / Advance / On Account) against pending bills, oldest first.
- Alter, cancel (Alt+X, keeps the number), delete (Alt+D), optional vouchers (Ctrl+L), print tax invoice (Alt+P).

**UAE VAT**: standard 5%, zero-rated, exempt, out of scope, reverse charge (imported services) and import of goods, with the
self-assessed output and recoverable input VAT posted automatically. Defaults follow the party: exports to GCC/overseas default
to zero-rated, purchases from overseas suppliers to reverse charge. Box 1 of VAT 201 is split by emirate of supply. Printable
**Tax Invoice / Tax Credit Note** with supplier and recipient TRN.

**Reports** (all drill down to the voucher with Enter; F2 changes the period; Alt+E exports CSV; Ctrl+P prints):
Balance Sheet, Profit & Loss A/c (trading + P&L, Tally horizontal layout), Trial Balance (condensed/detailed, opening and
transactions), Group Summary, Day Book, Sales / Purchase / Journal registers, Ledger and Cash/Bank book with running balance,
Stock Summary (weighted average cost, by godown, reorder flags), Bills Receivable / Payable with ageing, VAT 201, Ratio Analysis,
Bank Reconciliation (enter bank dates), Audit Trail.

Year-end is automatic: income and expense ledgers restart each financial year and the prior result rolls into Profit & Loss A/c.

## Keyboard

| Key | Action |
| --- | --- |
| Letter shown underlined | Open that menu item |
| ↑ ↓ Enter / Esc | Move, open / go back |
| Enter / Backspace on empty field | Next / previous field |
| Ctrl+A | Accept (save) |
| F2 | Change period and current date |
| F3 | Change company |
| Alt+G | Go To any report or voucher |
| Alt+C (in lists) | Create master |
| "End of List" in a line table | Finish the table and move on |

Dates accept shortcuts: `12`, `12-2`, `12/2/26`, `12-Feb-2026`.

## Not built yet

Planned next, in rough priority order:

- Users, roles and sign-in (it is single-user today), and hosting / multi-tenant cloud deployment
- Cost centres and budgets
- Multi-currency vouchers and forex revaluation
- Sales / purchase orders, delivery and receipt notes, batches and expiry
- Payroll (UAE WPS)
- Cheque printing, bank statement import (CSV/MT940) with auto-matching
- PDF export of reports and invoices (browser print works today), Excel import of masters
- UAE e-invoicing (PINT AE) and Corporate Tax computation
- VAT 201 boxes 2 (tourist refunds) and 7 (import adjustments), and blocked input VAT (e.g. entertainment)
