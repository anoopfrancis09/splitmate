import type { AppState } from './types';
import { defaultState, normalizeState } from './stateUtils';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type BillGroupRow = {
  id: string;
  name: string | null;
  currency: string | null;
  data: unknown;
  created_at: string | null;
  updated_at: string | null;
};

export type BillGroupSummary = {
  id: string;
  name: string;
  currency: string;
  createdAt: string | null;
  updatedAt: string | null;
  memberCount: number;
  expenseCount: number;
  totalSpent: number;
};

export type CloudLoadResult = {
  id: string;
  name: string;
  state: AppState;
  updatedAt: string | null;
};

function assertSupabaseReady() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

function toSummary(row: BillGroupRow): BillGroupSummary {
  const normalized = normalizeState(row.data);

  return {
    id: row.id,
    name: row.name || 'Untitled bill set',
    currency: row.currency || normalized.currency || defaultState.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: normalized.members.length,
    expenseCount: normalized.expenses.length,
    totalSpent: normalized.expenses.reduce((total, expense) => total + expense.amount, 0),
  };
}

export async function listBillGroupsFromCloud(): Promise<BillGroupSummary[]> {
  assertSupabaseReady();

  const { data, error } = await supabase!
    .from('bill_groups')
    .select('id, name, currency, data, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as BillGroupRow[]).map(toSummary);
}

export async function loadBillGroupFromCloud(groupId: string): Promise<CloudLoadResult | null> {
  assertSupabaseReady();

  const { data, error } = await supabase!
    .from('bill_groups')
    .select('id, name, currency, data, created_at, updated_at')
    .eq('id', groupId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as BillGroupRow;
  const normalized = normalizeState(row.data);

  return {
    id: row.id,
    name: row.name || 'Untitled bill set',
    state: {
      ...normalized,
      currency: row.currency || normalized.currency,
    },
    updatedAt: row.updated_at,
  };
}

export async function createBillGroupInCloud(name: string, state: AppState): Promise<CloudLoadResult> {
  assertSupabaseReady();

  const now = new Date().toISOString();
  const { data, error } = await supabase!
    .from('bill_groups')
    .insert({
      name,
      currency: state.currency,
      data: state,
      created_at: now,
      updated_at: now,
    })
    .select('id, name, currency, data, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);

  const row = data as BillGroupRow;
  return {
    id: row.id,
    name: row.name || name,
    state: normalizeState(row.data),
    updatedAt: row.updated_at,
  };
}

export async function saveBillGroupToCloud(groupId: string, name: string, state: AppState): Promise<string | null> {
  assertSupabaseReady();

  const { data, error } = await supabase!
    .from('bill_groups')
    .update({
      name,
      currency: state.currency,
      data: state,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .select('updated_at')
    .single();

  if (error) throw new Error(error.message);
  return (data as { updated_at: string | null } | null)?.updated_at ?? null;
}

export async function deleteBillGroupFromCloud(groupId: string): Promise<void> {
  assertSupabaseReady();

  const { error } = await supabase!.from('bill_groups').delete().eq('id', groupId);

  if (error) throw new Error(error.message);
}
