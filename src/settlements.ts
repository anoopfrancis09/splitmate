import type { Balance, Expense, Member, Settlement } from './types';
import { roundMoney } from './money';

function emptyBalances(members: Member[]): Record<string, number> {
  return Object.fromEntries(members.map((member) => [member.id, 0]));
}

export function calculateBalances(members: Member[], expenses: Expense[]): Balance[] {
  const balances = emptyBalances(members);

  expenses.forEach((expense) => {
    if (!expense.amount || expense.amount <= 0 || expense.splitBetween.length === 0) return;

    const splitAmount = expense.amount / expense.splitBetween.length;
    balances[expense.paidBy] = roundMoney((balances[expense.paidBy] ?? 0) + expense.amount);

    expense.splitBetween.forEach((memberId) => {
      balances[memberId] = roundMoney((balances[memberId] ?? 0) - splitAmount);
    });
  });

  return members.map((member) => ({
    memberId: member.id,
    amount: roundMoney(balances[member.id] ?? 0),
  }));
}


//calculations

export function calculatePairwiseSettlements(expenses: Expense[]): Settlement[] {
  const pairMap = new Map<string, number>();

  expenses.forEach((expense) => {
    if (!expense.amount || expense.amount <= 0 || expense.splitBetween.length === 0) return;

    const splitAmount = expense.amount / expense.splitBetween.length;

    expense.splitBetween.forEach((debtorId) => {
      if (debtorId === expense.paidBy) return;

      const forwardKey = `${debtorId}->${expense.paidBy}`;
      const reverseKey = `${expense.paidBy}->${debtorId}`;
      const reverseAmount = pairMap.get(reverseKey) ?? 0;

      if (reverseAmount > splitAmount) {
        pairMap.set(reverseKey, roundMoney(reverseAmount - splitAmount));
      } else if (reverseAmount < splitAmount) {
        pairMap.delete(reverseKey);
        pairMap.set(forwardKey, roundMoney((pairMap.get(forwardKey) ?? 0) + splitAmount - reverseAmount));
      } else {
        pairMap.delete(reverseKey);
      }
    });
  });

  return Array.from(pairMap.entries())
    .map(([key, amount]) => {
      const [from, to] = key.split('->');
      return { from, to, amount: roundMoney(amount) };
    })
    .filter((settlement) => settlement.amount > 0.009)
    .sort((a, b) => b.amount - a.amount);
}

export function calculateSimplifiedSettlements(balances: Balance[]): Settlement[] {
  const creditors = balances
    .filter((balance) => balance.amount > 0.009)
    .map((balance) => ({ memberId: balance.memberId, amount: roundMoney(balance.amount) }))
    .sort((a, b) => b.amount - a.amount);

  const debtors = balances
    .filter((balance) => balance.amount < -0.009)
    .map((balance) => ({ memberId: balance.memberId, amount: roundMoney(Math.abs(balance.amount)) }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount));

    if (amount > 0.009) {
      settlements.push({ from: debtor.memberId, to: creditor.memberId, amount });
    }

    debtor.amount = roundMoney(debtor.amount - amount);
    creditor.amount = roundMoney(creditor.amount - amount);

    if (debtor.amount <= 0.009) debtorIndex += 1;
    if (creditor.amount <= 0.009) creditorIndex += 1;
  }

  return settlements;
}

export function getMemberName(members: Member[], memberId: string): string {
  return members.find((member) => member.id === memberId)?.name ?? 'Unknown member';
}
