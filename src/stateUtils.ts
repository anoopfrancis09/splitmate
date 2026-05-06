import type { AppState, Expense, SettledPayment } from './types';


export const defaultState: AppState = {
  members: [],
  expenses: [],
  settledPayments: [],
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

export function normalizeSettledPayment(payment: SettledPayment): SettledPayment {
  return {
    ...payment,
    amount: Number(payment.amount) || 0,
    date: payment.date || new Date().toISOString().slice(0, 10),
    settledAt: payment.settledAt || new Date().toISOString(),
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
    settledPayments: Array.isArray(parsed.settledPayments)
      ? parsed.settledPayments.map(normalizeSettledPayment)
      : defaultState.settledPayments,
    currency: parsed.currency || defaultState.currency,
    simplifyDebts: typeof parsed.simplifyDebts === 'boolean' ? parsed.simplifyDebts : defaultState.simplifyDebts,
  };
}
