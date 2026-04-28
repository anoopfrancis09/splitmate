import type { CurrencyCode } from './types';

export const currencyOptions: CurrencyCode[] = ['AUD', 'USD', 'EUR', 'GBP', 'INR', 'CAD', 'NZD'];

export function formatMoney(amount: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
