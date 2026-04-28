import type { Balance, Expense, Member, Settlement } from './types';
import { roundMoney } from './money';

function emptyBalances(members: Member[]): Record<string, number> {
  return Object.fromEntries(members.map((member) => [member.id, 0]));
}

function distributeAmount(amount: number, memberIds: string[], weights: number[]): Record<string, number> {
  const positiveWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const totalWeight = positiveWeights.reduce((total, weight) => total + weight, 0);

  if (!memberIds.length || totalWeight <= 0) return {};

  const shares: Record<string, number> = {};
  let allocated = 0;

  memberIds.forEach((memberId, index) => {
    const isLast = index === memberIds.length - 1;
    const share = isLast
      ? roundMoney(amount - allocated)
      : roundMoney((amount * positiveWeights[index]) / totalWeight);

    shares[memberId] = share;
    allocated = roundMoney(allocated + share);
  });

  return shares;
}

export function getExpenseOwedAmounts(expense: Expense): Record<string, number> {
  const splitBetween = expense.splitBetween.filter(Boolean);

  if (!expense.amount || expense.amount <= 0 || splitBetween.length === 0) return {};

  if (expense.splitMode === 'shares' || expense.splitMode === 'percentages') {
    const customWeights = splitBetween.map((memberId) => Number(expense.splitValues?.[memberId] ?? 0));
    const hasCustomWeights = customWeights.some((weight) => Number.isFinite(weight) && weight > 0);

    if (hasCustomWeights) {
      return distributeAmount(expense.amount, splitBetween, customWeights);
    }
  }

  return distributeAmount(
    expense.amount,
    splitBetween,
    splitBetween.map(() => 1),
  );
}

export function calculateBalances(members: Member[], expenses: Expense[]): Balance[] {
  const balances = emptyBalances(members);

  expenses.forEach((expense) => {
    const owedAmounts = getExpenseOwedAmounts(expense);
    const owedEntries = Object.entries(owedAmounts);

    if (!expense.amount || expense.amount <= 0 || owedEntries.length === 0) return;

    balances[expense.paidBy] = roundMoney((balances[expense.paidBy] ?? 0) + expense.amount);

    owedEntries.forEach(([memberId, owedAmount]) => {
      balances[memberId] = roundMoney((balances[memberId] ?? 0) - owedAmount);
    });
  });

  return members.map((member) => ({
    memberId: member.id,
    amount: roundMoney(balances[member.id] ?? 0),
  }));
}

export function calculatePairwiseSettlements(expenses: Expense[]): Settlement[] {
  const pairMap = new Map<string, number>();

  expenses.forEach((expense) => {
    const owedAmounts = getExpenseOwedAmounts(expense);

    if (!expense.amount || expense.amount <= 0 || !Object.keys(owedAmounts).length) return;

    Object.entries(owedAmounts).forEach(([debtorId, owedAmount]) => {
      if (debtorId === expense.paidBy || owedAmount <= 0) return;

      const forwardKey = `${debtorId}->${expense.paidBy}`;
      const reverseKey = `${expense.paidBy}->${debtorId}`;
      const reverseAmount = pairMap.get(reverseKey) ?? 0;

      if (reverseAmount > owedAmount) {
        pairMap.set(reverseKey, roundMoney(reverseAmount - owedAmount));
      } else if (reverseAmount < owedAmount) {
        pairMap.delete(reverseKey);
        pairMap.set(forwardKey, roundMoney((pairMap.get(forwardKey) ?? 0) + owedAmount - reverseAmount));
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
