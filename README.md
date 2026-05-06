# SplitMate - React Bill Splitter

A simple Splitwise-style bill splitting app built with React, TypeScript, Vite and Supabase.

## Features

- User registration and login using Supabase Auth sessions
- Username + password UI, backed by Supabase email/password auth under the hood
- Each user only sees their own saved bill sets using Supabase Row Level Security
- Add and remove group members
- Add expenses in AUD by default, with a currency selector for future scaling
- Choose who paid for each bill
- Split expenses using equal split, custom shares, or custom percentages
- Preview each member's share before adding the expense
- Show consolidated balances
- Toggle simplified debt settlement to reduce the number of repayments
- Mark settlement rows as paid with the **Settled** button
- Save settled payment records to the selected Supabase bill set
- Recalculate balances and settlement summaries after payments are settled
- View settled payment history and expense history
- Save multiple bill sets in Supabase
- Select any saved bill set from the list and load its members, expenses, balances, and settlements
- Supabase is the only persistence layer; no bill data is saved in browser localStorage

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

This app stores each bill set as a separate row in `public.bill_groups`. The full bill splitter state for that bill set is stored in the `data jsonb` column.

Each bill set row has a `user_id` column. RLS policies only allow the logged-in user to select, insert, update, or delete rows where `user_id = auth.uid()`.

### 1. Create a Supabase project

Create a free Supabase project and copy:

- Project URL
- anon/public key

### 2. Enable email/password auth

In Supabase:

```txt
Authentication > Providers > Email
```

Enable the Email provider.

Because this app uses username-style login by converting usernames into internal emails like `anoop@splitmate.local`, you should disable email confirmation for this simple personal app:

```txt
Authentication > Providers > Email > Confirm email = Off
```

If you keep email confirmation enabled, newly registered users may not be able to login because `@splitmate.local` is not a real inbox.

### 3. Create/update tables and RLS policies

Open the Supabase SQL Editor and run the full contents of:

```txt
supabase-setup.sql
```

This script:

- Creates `public.profiles`
- Creates/updates `public.bill_groups`
- Adds `user_id` to `bill_groups` if it does not already exist
- Enables RLS
- Removes the older public/anon policies from previous versions
- Adds authenticated policies so users only access their own data

Existing rows created before the auth version may have `user_id = null`. They will not be visible to any user after RLS is enabled unless you assign them to a real Supabase Auth user ID.

### 4. Add environment variables

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

You do not need `VITE_SUPABASE_GROUP_ID`; the app now loads bill sets for the logged-in user.

## Vercel deployment

Use these settings when importing the GitHub repo into Vercel:

```txt
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Add the same environment variables in Vercel:

```txt
Project > Settings > Environment Variables
```

Required variables:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Redeploy after adding/changing env variables.

## Important security note

This version uses Supabase Auth and RLS. Do not expose the Supabase `service_role` key in the frontend or in Vercel variables for this Vite app. Only use the anon/public key.
