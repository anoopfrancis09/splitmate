import type { AppState } from './types';
import { normalizeState } from './stateUtils';
import { isSupabaseConfigured, supabase, supabaseGroupId } from './supabaseClient';

type BillGroupRow = {
  id: string;
  name: string | null;
  currency: string | null;
  data: unknown;
  updated_at: string | null;
};

export type CloudLoadResult = {
  state: AppState;
  updatedAt: string | null;
};

function assertSupabaseReady() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_SUPABASE_GROUP_ID.');
  }
}

export async function loadBillGroupFromCloud(): Promise<CloudLoadResult | null> {
  assertSupabaseReady();

  const { data, error } = await supabase!
    .from('bill_groups')
    .select('id, name, currency, data, updated_at')
    .eq('id', supabaseGroupId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as BillGroupRow;

  return {
    state: normalizeState(row.data),
    updatedAt: row.updated_at,
  };
}

export async function saveBillGroupToCloud(state: AppState): Promise<string | null> {
  assertSupabaseReady();

  const { data, error } = await supabase!
    .from('bill_groups')
    .upsert(
      {
        id: supabaseGroupId,
        name: 'SplitMate group',
        currency: state.currency,
        data: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('updated_at')
    .single();

  if (error) throw new Error(error.message);
  return (data as { updated_at: string | null } | null)?.updated_at ?? null;
}
