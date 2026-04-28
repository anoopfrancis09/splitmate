# SplitMate - React Bill Splitter

A simple Splitwise-style bill splitting app built with React, TypeScript, Vite and Supabase cloud storage.

## Features

- Add and remove group members
- Add expenses in AUD by default, with a currency selector for future scaling
- Choose who paid for each bill
- Split expenses using:
  - Equal split
  - Custom shares, such as 2 shares vs 1 share
  - Custom percentages, with validation that the total is 100%
- Preview each member's share before adding the expense
- Show consolidated balances
- Toggle simplified debt settlement to reduce the number of repayments
- View expense history
- Save multiple bill sets in Supabase
- Select any saved bill set from the list and load its members, expenses, balances, and settlements
- Persist data in browser local storage as a fallback
- Login page with Admin and Guest access
- Admin password: `admin7535`
- Guest users can view and load saved bill sets but cannot add, remove, clear, save, or delete data

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Login access

When the app opens, users can either:

- Login as **Admin** using `admin7535`
- Continue as **Guest**

Admin users can add members, add expenses, delete expenses, remove members, change currency, clear data, load sample data, create bill sets, save the selected bill set, and delete saved bill sets.

Guest users can load and view cloud data, balances, settlements, and history. Guests cannot add, delete, clear, save, create, or delete bill sets. They can toggle the settlement view locally without saving it.

> Important: this is a lightweight client-side login for personal use. It is not a replacement for real backend authentication. For real private/admin security, use Supabase Auth and RLS policies tied to logged-in users, or route writes through a server/API.

## Supabase setup

This app stores each bill set as a separate row in `public.bill_groups`. The full bill splitter state for that bill set is stored in the `data jsonb` column.

### 1. Create a Supabase project

Create a free Supabase project and copy:

- Project URL
- anon/public key

### 2. Create/update the table and RLS policies

Open the Supabase SQL Editor and run the full contents of:

```txt
supabase-setup.sql
```

This script:

- Creates `public.bill_groups` if it does not already exist
- Adds a generated UUID default to `id`
- Enables RLS
- Drops the older single-row policies if you used the previous version
- Adds policies that allow the frontend to list, create, update, and delete bill-set rows using the anon key

### 3. Add environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Restart the dev server after changing env variables.

You no longer need `VITE_SUPABASE_GROUP_ID`; the app now loads all rows from `bill_groups` and lets the user select one.

### 4. Save and load bill sets

Once env variables are configured, the app shows:

- **Refresh list** - reloads all saved bill sets from Supabase
- **Save selected** - updates the currently selected bill set
- **Save as new set** - creates a new row in `bill_groups`
- **Delete selected** - deletes the active bill set, admin only

## Vercel deployment

Use these settings when importing the GitHub repo into Vercel:

```txt
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Also add the same Supabase environment variables in:

```txt
Vercel Project > Settings > Environment Variables
```

Required variables:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Then redeploy.

## Security note

This version intentionally keeps the app simple and uses client-side admin/guest access. Guests are blocked from editing through the UI, but the Supabase anon key is still available in the browser. The included SQL policies allow anon writes so the frontend can save data.

For proper private/admin security, add Supabase Auth or a Vercel serverless API and lock Supabase writes behind authenticated server-side logic.
