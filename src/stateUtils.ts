import type { AppState, Expense } from './types';

export const STORAGE_KEY = 'splitmate-bill-splitter-state-v1';

export const defaultState: AppState = {
  members: [],
  expenses: [],
  currency: 'AUD',
  simplifyDebts: true,
};

export function normalizeExpense(expense: Expense): Expense {
  return {
    ...expense,
    splitMode: expense.splitMode ?? 'equal',
    splitValues: expense.splitValues ?? undefined,
  };
}

export function normalizeState(value: unknown): AppState {
  const parsed = value as Partial<AppState> | null | undefined;

  if (!parsed || typeof parsed !== 'object') return defaultState;

  return {
    ...defaultState,
    ...parsed,
    members: Array.isArray(parsed.members) ? parsed.members : defaultState.members,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses.map(normalizeExpense) : defaultState.expenses,
    currency: parsed.currency || defaultState.currency,
    simplifyDebts: typeof parsed.simplifyDebts === 'boolean' ? parsed.simplifyDebts : defaultState.simplifyDebts,
  };
}

export function loadLocalState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState;
    return normalizeState(JSON.parse(saved));
  } catch {
    return defaultState;
  }
}

export function saveLocalState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
