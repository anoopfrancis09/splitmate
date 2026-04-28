import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Analytics } from "@vercel/analytics/react"
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Home,
  Plus,
  ReceiptText,
  RefreshCcw,
  Trash2,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { AppState, Expense, Member } from './types';
import { currencyOptions, formatMoney } from './money';
import {
  calculateBalances,
  calculatePairwiseSettlements,
  calculateSimplifiedSettlements,
  getMemberName,
} from './settlements';

const STORAGE_KEY = 'splitmate-bill-splitter-state-v1';

const defaultState: AppState = {
  members: [],
  expenses: [],
  currency: 'AUD',
  simplifyDebts: true,
};

function createSampleState(currency = 'AUD'): AppState {
  const sampleMembers: Member[] = [
    { id: crypto.randomUUID(), name: 'Anoop' },
    { id: crypto.randomUUID(), name: 'Rachel' },
    { id: crypto.randomUUID(), name: 'Sam' },
  ];

  return {
    members: sampleMembers,
    expenses: [
      {
        id: crypto.randomUUID(),
        description: 'Dinner',
        amount: 96,
        paidBy: sampleMembers[0].id,
        splitBetween: sampleMembers.map((member) => member.id),
        date: new Date().toISOString().slice(0, 10),
      },
      {
        id: crypto.randomUUID(),
        description: 'Groceries',
        amount: 63.5,
        paidBy: sampleMembers[1].id,
        splitBetween: [sampleMembers[0].id, sampleMembers[1].id],
        date: new Date().toISOString().slice(0, 10),
      },
    ],
    currency,
    simplifyDebts: true,
  };
}

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState;

    const parsed = JSON.parse(saved) as AppState;

    return {
      ...defaultState,
      ...parsed,
      members: Array.isArray(parsed.members) ? parsed.members : defaultState.members,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : defaultState.expenses,
    };
  } catch {
    return defaultState;
  }
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [memberName, setMemberName] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [paidBy, setPaidBy] = useState(state.members[0]?.id ?? '');
  const [splitBetween, setSplitBetween] = useState<string[]>(state.members.map((member) => member.id));
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!state.members.some((member) => member.id === paidBy)) {
      setPaidBy(state.members[0]?.id ?? '');
    }

    setSplitBetween((current) => {
      const validIds = current.filter((id) => state.members.some((member) => member.id === id));
      return validIds.length ? validIds : state.members.map((member) => member.id);
    });
  }, [paidBy, state.members]);

  const balances = useMemo(() => calculateBalances(state.members, state.expenses), [state.members, state.expenses]);

  const settlements = useMemo(() => {
    return state.simplifyDebts ? calculateSimplifiedSettlements(balances) : calculatePairwiseSettlements(state.expenses);
  }, [balances, state.expenses, state.simplifyDebts]);

  const totalSpent = useMemo(
    () => state.expenses.reduce((total, expense) => total + expense.amount, 0),
    [state.expenses],
  );

  const memberLookup = useMemo(() => new Map(state.members.map((member) => [member.id, member.name])), [state.members]);

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = memberName.trim();

    if (!trimmedName) return;
    if (state.members.some((member) => member.name.toLowerCase() === trimmedName.toLowerCase())) {
      setError('That member is already in the group.');
      return;
    }

    const newMember = { id: crypto.randomUUID(), name: trimmedName };
    setState((current) => ({ ...current, members: [...current.members, newMember] }));
    setSplitBetween((current) => [...current, newMember.id]);
    setMemberName('');
    setError('');
  };

  const removeMember = (memberId: string) => {
    const hasExpenses = state.expenses.some(
      (expense) => expense.paidBy === memberId || expense.splitBetween.includes(memberId),
    );

    if (hasExpenses) {
      setError('This member is attached to existing expenses. Delete those expenses before removing the member.');
      return;
    }

    setState((current) => ({ ...current, members: current.members.filter((member) => member.id !== memberId) }));
    setSplitBetween((current) => current.filter((id) => id !== memberId));
    setError('');
  };

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const amount = Number(expenseAmount);
    const trimmedDescription = expenseDescription.trim();

    if (state.members.length < 2) {
      setError('Add at least two members before adding expenses.');
      return;
    }

    if (!trimmedDescription) {
      setError('Add a short description for this expense.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }

    if (!paidBy) {
      setError('Choose who paid this bill.');
      return;
    }

    if (!splitBetween.length) {
      setError('Select at least one member to split this bill with.');
      return;
    }

    const newExpense: Expense = {
      id: crypto.randomUUID(),
      description: trimmedDescription,
      amount,
      paidBy,
      splitBetween,
      date: expenseDate,
    };

    setState((current) => ({ ...current, expenses: [newExpense, ...current.expenses] }));
    setExpenseDescription('');
    setExpenseAmount('');
    setSplitBetween(state.members.map((member) => member.id));
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setError('');
  };

  const deleteExpense = (expenseId: string) => {
    setState((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== expenseId) }));
  };

  const toggleSplitMember = (memberId: string) => {
    setSplitBetween((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  };

  const resetDemo = () => {
    const sampleState = createSampleState(state.currency);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleState));
    setState(sampleState);
    setPaidBy(sampleState.members[0].id);
    setSplitBetween(sampleState.members.map((member) => member.id));
    setError('');
  };

  const clearAll = () => {
    const emptyState: AppState = { members: [], expenses: [], currency: state.currency, simplifyDebts: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyState));
    setState(emptyState);
    setMemberName('');
    setExpenseDescription('');
    setExpenseAmount('');
    setPaidBy('');
    setSplitBetween([]);
    setError('');
  };

  return (
    <main className="app-shell">
      <nav className="topbar">
        <button className="home-button" aria-label="Go home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Home size={19} />
        </button>
        <div className="brand">
          <div className="brand-mark">
            <WalletCards size={24} />
          </div>
          <div>
            <span className="brand-name">SplitMate</span>
            <span className="brand-subtitle">Group bill splitter</span>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="currency-select">
            <span>Currency</span>
            <select
              value={state.currency}
              onChange={(event) => setState((current) => ({ ...current, currency: event.target.value }))}
            >
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>
      </nav>

      <section className="hero-card">
        <div>
          <p className="eyebrow">Simple shared expenses</p>
          <h1>Track bills, split fairly, and settle up with fewer repayments.</h1>
          <p className="hero-copy">
            Add group members, record who paid, choose who shared the expense, and SplitMate calculates the
            consolidated repayments automatically.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>Total spent</span>
            <strong>{formatMoney(totalSpent, state.currency)}</strong>
          </div>
          <div className="stat-card">
            <span>Members</span>
            <strong>{state.members.length}</strong>
          </div>
          <div className="stat-card">
            <span>Expenses</span>
            <strong>{state.expenses.length}</strong>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="layout-grid">
        <div className="stacked-panels">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 1</p>
                <h2><UsersRound size={20} /> Group members</h2>
              </div>
              <span className="pill">{state.members.length} people</span>
            </div>

            <form className="inline-form" onSubmit={addMember}>
              <input
                value={memberName}
                onChange={(event) => setMemberName(event.target.value)}
                placeholder="Enter member name"
                aria-label="Member name"
              />
              <button type="submit" className="primary-button">
                <Plus size={17} /> Add
              </button>
            </form>

            <div className="member-list">
              {state.members.length ? (
                state.members.map((member) => (
                  <div key={member.id} className="member-chip">
                    <span>{member.name}</span>
                    <button onClick={() => removeMember(member.id)} aria-label={`Remove ${member.name}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-text">No members yet. Add at least two people to start splitting bills.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 2</p>
                <h2><ReceiptText size={20} /> Add expense</h2>
              </div>
              <span className="pill">Equal split</span>
            </div>

            <form className="expense-form" onSubmit={addExpense}>
              <label>
                Description
                <input
                  value={expenseDescription}
                  onChange={(event) => setExpenseDescription(event.target.value)}
                  placeholder="e.g. Dinner, fuel, hotel"
                />
              </label>

              <div className="two-column-form">
                <label>
                  Amount ({state.currency})
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseAmount}
                    onChange={(event) => setExpenseAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Date
                  <input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
                </label>
              </div>

              <label>
                Paid by
                <select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} disabled={!state.members.length}>
                  {state.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="split-box">
                <div className="split-box-header">
                  <span>Split between</span>
                  <button
                    type="button"
                    onClick={() => setSplitBetween(state.members.map((member) => member.id))}
                    className="ghost-button mini-button"
                  >
                    Select all
                  </button>
                </div>
                <div className="checkbox-grid">
                  {state.members.map((member) => (
                    <label key={member.id} className="checkbox-card">
                      <input
                        type="checkbox"
                        checked={splitBetween.includes(member.id)}
                        onChange={() => toggleSplitMember(member.id)}
                      />
                      <span>{member.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" className="primary-button full-width-button">
                <BadgeDollarSign size={18} /> Add bill
              </button>
            </form>
          </section>
        </div>

        <div className="stacked-panels">
          <section className="panel highlighted-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 3</p>
                <h2><CheckCircle2 size={20} /> Settlement summary</h2>
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={state.simplifyDebts}
                  onChange={(event) => setState((current) => ({ ...current, simplifyDebts: event.target.checked }))}
                />
                <span>Simplify debts</span>
              </label>
            </div>

            <div className="settlement-list">
              {settlements.length ? (
                settlements.map((settlement, index) => (
                  <div key={`${settlement.from}-${settlement.to}-${index}`} className="settlement-card">
                    <span>{getMemberName(state.members, settlement.from)}</span>
                    <ArrowRight size={17} />
                    <span>{getMemberName(state.members, settlement.to)}</span>
                    <strong>{formatMoney(settlement.amount, state.currency)}</strong>
                  </div>
                ))
              ) : (
                <div className="settled-state">
                  <CheckCircle2 size={34} />
                  <p>Everyone is settled up.</p>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Balances</p>
                <h2>Who is ahead or behind?</h2>
              </div>
            </div>

            <div className="balance-list">
              {balances.map((balance) => (
                <div key={balance.memberId} className="balance-row">
                  <span>{memberLookup.get(balance.memberId)}</span>
                  <strong className={balance.amount > 0 ? 'positive' : balance.amount < 0 ? 'negative' : ''}>
                    {balance.amount > 0 ? '+' : ''}{formatMoney(balance.amount, state.currency)}
                  </strong>
                </div>
              ))}
              {!balances.length ? <p className="empty-text">Balances will appear after adding members.</p> : null}
            </div>
          </section>
        </div>
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">History</p>
            <h2>Expense activity</h2>
          </div>
          <div className="button-row">
            <button className="ghost-button" onClick={resetDemo}>
              <RefreshCcw size={16} /> Load sample
            </button>
            <button className="danger-button" onClick={clearAll}>
              <Trash2 size={16} /> Clear all
            </button>
          </div>
        </div>

        <div className="expense-list">
          {state.expenses.length ? (
            state.expenses.map((expense) => (
              <article key={expense.id} className="expense-card">
                <div>
                  <h3>{expense.description}</h3>
                  <p>
                    Paid by <strong>{getMemberName(state.members, expense.paidBy)}</strong> · Split between{' '}
                    {expense.splitBetween.map((id) => getMemberName(state.members, id)).join(', ')} · {expense.date}
                  </p>
                </div>
                <div className="expense-card-actions">
                  <strong>{formatMoney(expense.amount, state.currency)}</strong>
                  <button onClick={() => deleteExpense(expense.id)} aria-label={`Delete ${expense.description}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-text">No expenses yet. Add your first bill above.</p>
          )}
        </div>
      </section>
      <Analytics />
    </main>
  );
}

export default App;
