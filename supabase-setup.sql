-- SplitMate Supabase Auth setup
-- Run this whole script in Supabase SQL Editor.
-- It keeps each user's bill sets private by using auth.uid() + Row Level Security.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bill_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null default 'Untitled bill set',
  currency text not null default 'AUD',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe migration for older versions of the app.
alter table public.bill_groups
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.bill_groups
alter column id set default gen_random_uuid();

alter table public.profiles enable row level security;
alter table public.bill_groups enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.bill_groups to authenticated;

-- Remove older public/anon policies from previous app versions.
drop policy if exists "Allow configured SplitMate group read" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group insert" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group update" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set read" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set insert" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set update" on public.bill_groups;
drop policy if exists "Allow public SplitMate bill set delete" on public.bill_groups;

-- Remove auth policies before recreating them so this script can be re-run.
drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can view their own bill groups" on public.bill_groups;
drop policy if exists "Users can create their own bill groups" on public.bill_groups;
drop policy if exists "Users can update their own bill groups" on public.bill_groups;
drop policy if exists "Users can delete their own bill groups" on public.bill_groups;

create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can view their own bill groups"
on public.bill_groups
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own bill groups"
on public.bill_groups
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own bill groups"
on public.bill_groups
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own bill groups"
on public.bill_groups
for delete
to authenticated
using (auth.uid() = user_id);

-- Existing rows created before this auth version may have user_id = null.
-- They will not be visible to any user until you assign them to a real auth.users.id.
-- Check them with:
-- select id, name, user_id, created_at from public.bill_groups order by created_at desc;
