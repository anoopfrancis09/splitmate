# SplitMate - React Bill Splitter

A simple Splitwise-style bill splitting app built with React, TypeScript, Vite and optional Supabase cloud storage.

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
- Persist data in browser local storage by default
- Save/load the whole app state as one JSON object in Supabase
- Load sample data or clear all data

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Supabase setup

This app stores the full bill splitter state in one row in `public.bill_groups.data` as JSONB.

### 1. Create a Supabase project

Create a free Supabase project and copy:

- Project URL
- anon/public key

### 2. Create the table and RLS policies

Open the Supabase SQL Editor and run:

```sql
select gen_random_uuid();
```

Copy the generated UUID.

Open `supabase-setup.sql`, replace every instance of:

```txt
00000000-0000-4000-8000-000000000001
```

with your generated UUID, then run the full SQL script in Supabase.

### 3. Add environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_SUPABASE_GROUP_ID=your-generated-uuid
```

Restart the dev server after changing env variables.

### 4. Save and load

Once env variables are configured, the app shows a **Cloud storage** card with:

- **Load from cloud**
- **Save to cloud**

The app still saves locally in the browser as a fallback.

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

Then redeploy.

## Security note

This version is intentionally simple and uses one configured Supabase row. The anon key is safe to put in the browser only when Row Level Security is enabled and policies are limited. For proper private multi-group or multi-user support, add Supabase Auth later and tie each group row to `auth.uid()`.
