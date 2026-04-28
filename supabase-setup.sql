-- SplitMate multi bill-set setup
-- Run this whole script in Supabase SQL Editor.
-- This version lets the app create multiple rows in public.bill_groups.

create extension if not exists pgcrypto;

create table if not exists public.bill_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled bill set',
  currency text not null default 'AUD',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If you created the older single-row version, this safely adds the generated UUID default.
alter table public.bill_groups
alter column id set default gen_random_uuid();

alter table public.bill_groups enable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on public.bill_groups to anon;

-- Remove policies from the earlier single-row setup, if they exist.
drop policy if exists "Allow configured SplitMate group read" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group insert" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group update" on public.bill_groups;

-- Remove policies from this setup, so the script can be safely re-run.
drop policy if exists "Allow public SplitMate bill set read" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set insert" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set update" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set delete" on public.bill_groups;

-- Lightweight policy for the current client-side admin/guest app.
-- Guests are read-only in the UI, but the anon key still has write access here.
-- For proper security later, replace this with Supabase Auth-based policies.
create policy "Allow public SplitMate bill set read"
on public.bill_groups
for select
to anon
using (true);

create policy "Allow public SplitMate bill set insert"
on public.bill_groups
for insert
to anon
with check (true);

create policy "Allow public SplitMate bill set update"
on public.bill_groups
for update
to anon
using (true)
with check (true);

create policy "Allow public SplitMate bill set delete"
on public.bill_groups
for delete
to anon
using (true);
