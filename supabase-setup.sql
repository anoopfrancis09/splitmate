-- 1) Generate a UUID first in Supabase SQL Editor:
-- select gen_random_uuid();
--
-- 2) Replace the UUID below everywhere you see this value:
-- e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46
--
-- 3) Run this whole script.

create table if not exists public.bill_groups (
  id uuid primary key,
  name text not null default 'SplitMate group',
  currency text not null default 'AUD',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bill_groups enable row level security;

grant usage on schema public to anon;
grant select, insert, update on public.bill_groups to anon;

drop policy if exists "Allow configured SplitMate group read" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group insert" on public.bill_groups;
drop policy if exists "Allow configured SplitMate group update" on public.bill_groups;

create policy "Allow configured SplitMate group read"
on public.bill_groups
for select
to anon
using (id = 'e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46'::uuid);

create policy "Allow configured SplitMate group insert"
on public.bill_groups
for insert
to anon
with check (id = 'e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46'::uuid);

create policy "Allow configured SplitMate group update"
on public.bill_groups
for update
to anon
using (id = 'e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46'::uuid)
with check (id = 'e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46'::uuid);

insert into public.bill_groups (id, name, currency, data)
values (
  'e1e7e1da-4f68-42ef-a3b6-8f82a0c43c46'::uuid,
  'SplitMate group',
  'AUD',
  '{"members": [], "expenses": [], "currency": "AUD", "simplifyDebts": true}'::jsonb
)
on conflict (id) do nothing;
