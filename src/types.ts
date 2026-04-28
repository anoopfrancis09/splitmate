export type Member = {
  id: string;
  name: string;
};

export type CurrencyCode = 'AUD' | 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'NZD' | string;

export type SplitMode = 'equal' | 'shares' | 'percentages';

export type Expense = {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  splitBetween: string[];
  splitMode?: SplitMode;
  splitValues?: Record<string, number>;
  date: string;
  notes?: string;
};

export type Settlement = {
  from: string;
  to: string;
  amount: number;
};

export type Balance = {
  memberId: string;
  amount: number;
};

export type AppState = {
  members: Member[];
  expenses: Expense[];
  currency: CurrencyCode;
  simplifyDebts: boolean;
};
