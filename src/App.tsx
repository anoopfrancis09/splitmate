import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Eye,
  Home,
  Loader2,
  LogIn,
  LogOut,
  LockKeyhole,
  Plus,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { AppState, Expense, Member, SplitMode } from './types';
import { loadBillGroupFromCloud, saveBillGroupToCloud } from './cloudStore';
import { currencyOptions, formatMoney } from './money';
import { loadLocalState, saveLocalState } from './stateUtils';
import { isSupabaseConfigured, supabaseGroupId } from './supabaseClient';
import {
  calculateBalances,
  calculatePairwiseSettlements,
  calculateSimplifiedSettlements,
  getExpenseOwedAmounts,
  getMemberName,
} from './settlements';

const splitModeLabels: Record<SplitMode, string> = {
  equal: 'Equal split',
  shares: 'Share split',
  percentages: 'Percentage split',
};

type CloudStatus = 'idle' | 'loading' | 'saving' | 'success' | 'error';
type UserRole = 'admin' | 'guest';

const AUTH_STORAGE_KEY = 'splitmate-auth-role';
const ADMIN_PASSWORD = 'admin7535';

function getStoredRole(): UserRole | null {
  try {
    const storedRole = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return storedRole === 'admin' || storedRole === 'guest' ? storedRole : null;
  } catch {
    return null;
  }
}

function saveStoredRole(role: UserRole | null) {
  try {
    if (role) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, role);
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures. The user can still use the current session.
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function formatSyncTime(value: string | null): string {
  if (!value) return 'Not synced yet';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toInputNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function getEqualPercentages(memberIds: string[]): Record<string, string> {
  if (!memberIds.length) return {};

  const result: Record<string, string> = {};
  const base = Math.floor((10000 / memberIds.length)) / 100;
  let allocated = 0;

  memberIds.forEach((memberId, index) => {
    const value = index === memberIds.length - 1 ? Number((100 - allocated).toFixed(2)) : base;
    result[memberId] = toInputNumber(value);
    allocated = Number((allocated + value).toFixed(2));
  });

  return result;
}

function getDefaultSplitValues(memberIds: string[], mode: SplitMode): Record<string, string> {
  if (mode === 'percentages') return getEqualPercentages(memberIds);
  if (mode === 'shares') return Object.fromEntries(memberIds.map((memberId) => [memberId, '1']));
  return {};
}

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
        splitMode: 'equal',
        date: new Date().toISOString().slice(0, 10),
      },
      {
        id: crypto.randomUUID(),
        description: 'Groceries',
        amount: 90,
        paidBy: sampleMembers[1].id,
        splitBetween: [sampleMembers[0].id, sampleMembers[1].id],
        splitMode: 'shares',
        splitValues: {
          [sampleMembers[0].id]: 2,
          [sampleMembers[1].id]: 1,
        },
        date: new Date().toISOString().slice(0, 10),
      },
      {
        id: crypto.randomUUID(),
        description: 'Weekend stay',
        amount: 300,
        paidBy: sampleMembers[2].id,
        splitBetween: sampleMembers.map((member) => member.id),
        splitMode: 'percentages',
        splitValues: {
          [sampleMembers[0].id]: 50,
          [sampleMembers[1].id]: 25,
          [sampleMembers[2].id]: 25,
        },
        date: new Date().toISOString().slice(0, 10),
      },
    ],
    currency,
    simplifyDebts: true,
  };
}

function App() {
  const [state, setState] = useState<AppState>(() => loadLocalState());
  const [memberName, setMemberName] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [paidBy, setPaidBy] = useState(state.members[0]?.id ?? '');
  const [splitBetween, setSplitBetween] = useState<string[]>(state.members.map((member) => member.id));
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');
  const [cloudMessage, setCloudMessage] = useState(
    isSupabaseConfigured
      ? 'Cloud sync is ready. Load from Supabase or save your current data.'
      : 'Cloud sync is not configured yet. The app will keep using this browser only.',
  );
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(() => getStoredRole());
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [viewSimplifyDebts, setViewSimplifyDebts] = useState(state.simplifyDebts);

  const isAdmin = role === 'admin';
  const isGuest = role === 'guest';
  const canEdit = isAdmin;
  const isCloudBusy = cloudStatus === 'loading' || cloudStatus === 'saving';
  const shouldSimplifyDebts = isAdmin ? state.simplifyDebts : viewSimplifyDebts;

  useEffect(() => {
    saveLocalState(state);
  }, [state]);

  useEffect(() => {
    setViewSimplifyDebts(state.simplifyDebts);
  }, [state.simplifyDebts]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialCloudState() {
      if (!isSupabaseConfigured) return;

      try {
        setCloudStatus('loading');
        setCloudMessage('Checking Supabase for saved group data...');
        const cloudData = await loadBillGroupFromCloud();

        if (cancelled) return;

        if (cloudData) {
          setState(cloudData.state);
          setPaidBy(cloudData.state.members[0]?.id ?? '');
          setSplitBetween(cloudData.state.members.map((member) => member.id));
          setSplitMode('equal');
          setSplitValues({});
          setCloudUpdatedAt(cloudData.updatedAt);
          setCloudStatus('success');
          setCloudMessage('Loaded the latest data from Supabase.');
        } else {
          setCloudStatus('idle');
          setCloudMessage('No cloud record exists yet. Click Save to cloud once to create it.');
        }
      } catch (loadError) {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudMessage(getErrorMessage(loadError));
      }
    }

    loadInitialCloudState();

    return () => {
      cancelled = true;
    };
  }, []);

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
    return shouldSimplifyDebts ? calculateSimplifiedSettlements(balances) : calculatePairwiseSettlements(state.expenses);
  }, [balances, state.expenses, shouldSimplifyDebts]);

  const totalSpent = useMemo(
    () => state.expenses.reduce((total, expense) => total + expense.amount, 0),
    [state.expenses],
  );

  const memberLookup = useMemo(() => new Map(state.members.map((member) => [member.id, member.name])), [state.members]);

  const selectedSplitValues = useMemo(() => {
    return splitBetween.map((memberId) => ({
      memberId,
      name: getMemberName(state.members, memberId),
      value: splitValues[memberId] ?? '',
    }));
  }, [splitBetween, splitValues, state.members]);

  const customSplitTotal = useMemo(() => {
    return selectedSplitValues.reduce((total, item) => total + (Number(item.value) || 0), 0);
  }, [selectedSplitValues]);

  const splitPreview = useMemo(() => {
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !splitBetween.length) return [];

    const previewExpense: Expense = {
      id: 'preview',
      description: expenseDescription || 'Preview',
      amount,
      paidBy,
      splitBetween,
      splitMode,
      splitValues:
        splitMode === 'equal'
          ? undefined
          : Object.fromEntries(splitBetween.map((memberId) => [memberId, Number(splitValues[memberId] ?? 0)])),
      date: expenseDate,
    };

    const owedAmounts = getExpenseOwedAmounts(previewExpense);

    return splitBetween.map((memberId) => ({
      memberId,
      amount: owedAmounts[memberId] ?? 0,
    }));
  }, [expenseAmount, expenseDescription, expenseDate, paidBy, splitBetween, splitMode, splitValues]);

  const applyLoadedState = (nextState: AppState) => {
    setState(nextState);
    setPaidBy(nextState.members[0]?.id ?? '');
    setSplitBetween(nextState.members.map((member) => member.id));
    setSplitMode('equal');
    setSplitValues({});
    setMemberName('');
    setExpenseDescription('');
    setExpenseAmount('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setError('');
  };

  const requireAdmin = (message = 'Only the admin can make changes in this app.') => {
    if (isAdmin) return true;
    setError(message);
    return false;
  };

  const handleAdminLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loginPassword === ADMIN_PASSWORD) {
      setRole('admin');
      saveStoredRole('admin');
      setLoginPassword('');
      setLoginError('');
      setError('');
      return;
    }

    setLoginError('Incorrect password. Continue as guest for read-only access, or try again.');
  };

  const continueAsGuest = () => {
    setRole('guest');
    saveStoredRole('guest');
    setLoginPassword('');
    setLoginError('');
    setError('');
  };

  const logout = () => {
    setRole(null);
    saveStoredRole(null);
    setLoginPassword('');
    setLoginError('');
    setError('');
  };

  const saveToCloud = async () => {
    if (!requireAdmin('Only admin users can save changes to Supabase.')) return;
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before saving to cloud.');
      return;
    }

    try {
      setCloudStatus('saving');
      setCloudMessage('Saving the current group data to Supabase...');
      const updatedAt = await saveBillGroupToCloud(state);
      setCloudUpdatedAt(updatedAt);
      setCloudStatus('success');
      setCloudMessage('Saved to Supabase.');
    } catch (saveError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(saveError));
    }
  };

  const loadFromCloud = async () => {
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before loading from cloud.');
      return;
    }

    try {
      setCloudStatus('loading');
      setCloudMessage('Loading group data from Supabase...');
      const cloudData = await loadBillGroupFromCloud();

      if (!cloudData) {
        setCloudStatus('idle');
        setCloudMessage('No cloud record exists yet. Save once to create it.');
        return;
      }

      applyLoadedState(cloudData.state);
      setCloudUpdatedAt(cloudData.updatedAt);
      setCloudStatus('success');
      setCloudMessage('Loaded from Supabase.');
    } catch (loadError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(loadError));
    }
  };

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireAdmin('Only admin users can add group members.')) return;
    const trimmedName = memberName.trim();

    if (!trimmedName) return;
    if (state.members.some((member) => member.name.toLowerCase() === trimmedName.toLowerCase())) {
      setError('That member is already in the group.');
      return;
    }

    const newMember = { id: crypto.randomUUID(), name: trimmedName };
    setState((current) => ({ ...current, members: [...current.members, newMember] }));
    setSplitBetween((current) => [...current, newMember.id]);
    setSplitValues((current) => {
      if (splitMode === 'percentages') return getEqualPercentages([...splitBetween, newMember.id]);
      if (splitMode === 'shares') return { ...current, [newMember.id]: '1' };
      return current;
    });
    setMemberName('');
    setError('');
  };

  const removeMember = (memberId: string) => {
    if (!requireAdmin('Only admin users can remove group members.')) return;
    const hasExpenses = state.expenses.some(
      (expense) => expense.paidBy === memberId || expense.splitBetween.includes(memberId),
    );

    if (hasExpenses) {
      setError('This member is attached to existing expenses. Delete those expenses before removing the member.');
      return;
    }

    setState((current) => ({ ...current, members: current.members.filter((member) => member.id !== memberId) }));
    setSplitBetween((current) => current.filter((id) => id !== memberId));
    setSplitValues((current) => {
      const next = { ...current };
      delete next[memberId];
      return next;
    });
    setError('');
  };

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireAdmin('Only admin users can add expenses.')) return;

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

    if (splitMode === 'shares') {
      const hasInvalidShare = splitBetween.some((memberId) => !Number.isFinite(Number(splitValues[memberId])) || Number(splitValues[memberId]) <= 0);
      if (hasInvalidShare) {
        setError('Add a positive share value for every selected member.');
        return;
      }
    }

    if (splitMode === 'percentages') {
      const hasInvalidPercentage = splitBetween.some(
        (memberId) => !Number.isFinite(Number(splitValues[memberId])) || Number(splitValues[memberId]) <= 0,
      );

      if (hasInvalidPercentage) {
        setError('Add a positive percentage for every selected member.');
        return;
      }

      if (Math.abs(customSplitTotal - 100) > 0.01) {
        setError(`Percentage split must add up to 100%. Current total is ${toInputNumber(customSplitTotal)}%.`);
        return;
      }
    }

    const newExpense: Expense = {
      id: crypto.randomUUID(),
      description: trimmedDescription,
      amount,
      paidBy,
      splitBetween,
      splitMode,
      splitValues:
        splitMode === 'equal'
          ? undefined
          : Object.fromEntries(splitBetween.map((memberId) => [memberId, Number(splitValues[memberId])])),
      date: expenseDate,
    };

    setState((current) => ({ ...current, expenses: [newExpense, ...current.expenses] }));
    setExpenseDescription('');
    setExpenseAmount('');
    setSplitBetween(state.members.map((member) => member.id));
    setSplitMode('equal');
    setSplitValues({});
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setError('');
  };

  const deleteExpense = (expenseId: string) => {
    if (!requireAdmin('Only admin users can delete expenses.')) return;
    setState((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== expenseId) }));
  };

  const handleSplitModeChange = (mode: SplitMode) => {
    if (!requireAdmin('Only admin users can change expense split details.')) return;
    setSplitMode(mode);
    setSplitValues((current) => {
      if (mode === 'equal') return {};
      if (mode === 'percentages') return getEqualPercentages(splitBetween);
      return Object.fromEntries(splitBetween.map((memberId) => [memberId, current[memberId] || '1']));
    });
  };

  const selectAllSplitMembers = () => {
    if (!requireAdmin('Only admin users can change expense split details.')) return;
    const allMemberIds = state.members.map((member) => member.id);
    setSplitBetween(allMemberIds);
    setSplitValues(getDefaultSplitValues(allMemberIds, splitMode));
  };

  const toggleSplitMember = (memberId: string) => {
    if (!requireAdmin('Only admin users can change expense split details.')) return;
    setSplitBetween((current) => {
      const next = current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];

      setSplitValues((values) => {
        if (splitMode === 'equal') return {};
        if (splitMode === 'percentages') return getEqualPercentages(next);

        const nextValues = { ...values };
        if (next.includes(memberId)) {
          nextValues[memberId] = nextValues[memberId] || '1';
        } else {
          delete nextValues[memberId];
        }
        return nextValues;
      });

      return next;
    });
  };

  const updateSplitValue = (memberId: string, value: string) => {
    if (!requireAdmin('Only admin users can change expense split details.')) return;
    setSplitValues((current) => ({ ...current, [memberId]: value }));
  };

  const resetCustomSplit = () => {
    if (!requireAdmin('Only admin users can change expense split details.')) return;
    setSplitValues(getDefaultSplitValues(splitBetween, splitMode));
  };

  const resetDemo = () => {
    if (!requireAdmin('Only admin users can load sample data.')) return;
    const sampleState = createSampleState(state.currency);

    saveLocalState(sampleState);
    setState(sampleState);
    setPaidBy(sampleState.members[0].id);
    setSplitBetween(sampleState.members.map((member) => member.id));
    setSplitMode('equal');
    setSplitValues({});
    setError('');
  };

  const clearAll = () => {
    if (!requireAdmin('Only admin users can clear all data.')) return;
    const emptyState: AppState = { members: [], expenses: [], currency: state.currency, simplifyDebts: true };
    saveLocalState(emptyState);
    setState(emptyState);
    setMemberName('');
    setExpenseDescription('');
    setExpenseAmount('');
    setPaidBy('');
    setSplitBetween([]);
    setSplitMode('equal');
    setSplitValues({});
    setError('');
  };

  const getExpenseSplitLabel = (expense: Expense) => {
    const mode = expense.splitMode ?? 'equal';
    const memberNames = expense.splitBetween.map((id) => getMemberName(state.members, id));

    if (mode === 'equal') return `Equal split between ${memberNames.join(', ')}`;

    const splitDetails = expense.splitBetween
      .map((memberId) => {
        const value = expense.splitValues?.[memberId] ?? 0;
        const suffix = mode === 'percentages' ? '%' : value === 1 ? ' share' : ' shares';
        return `${getMemberName(state.members, memberId)} ${value}${suffix}`;
      })
      .join(', ');

    return `${splitModeLabels[mode]}: ${splitDetails}`;
  };

  if (!role) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="login-brand">
            <div className="brand-mark">
              <WalletCards size={28} />
            </div>
            <div>
              <span className="brand-name">SplitMate</span>
              <span className="brand-subtitle">Group bill splitter</span>
            </div>
          </div>

          <div className="login-heading">
            <p className="eyebrow">Secure entry</p>
            <h1>Login to manage expenses or continue as a guest.</h1>
            <p>Admin users can add, delete, save, and manage bills. Guests can only view the group, balances, and settlements.</p>
          </div>

          <form className="login-form" onSubmit={handleAdminLogin}>
            <label>
              Admin password
              <div className="password-input">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                />
              </div>
            </label>
            {loginError ? <div className="error-banner compact">{loginError}</div> : null}
            <button type="submit" className="primary-button full-width-button">
              <LogIn size={18} /> Login as admin
            </button>
          </form>

          <button type="button" className="ghost-button full-width-button guest-login-button" onClick={continueAsGuest}>
            <Eye size={18} /> Continue as guest
          </button>

          <p className="auth-note">
            This is a lightweight client-side login for personal/admin convenience. For sensitive data, use Supabase Auth and server-side/RLS permissions.
          </p>
        </section>
      </main>
    );
  }

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
          <div className={`role-badge ${isAdmin ? 'admin' : 'guest'}`}>
            {isAdmin ? <ShieldCheck size={16} /> : <Eye size={16} />}
            {isAdmin ? 'Admin' : 'Guest view'}
          </div>
          <label className="currency-select">
            <span>Currency</span>
            <select
              value={state.currency}
              disabled={!canEdit}
              title={canEdit ? 'Change currency' : 'Guests cannot change the currency'}
              onChange={(event) => {
                if (canEdit) setState((current) => ({ ...current, currency: event.target.value }));
              }}
            >
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button logout-button" type="button" onClick={logout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      <section className="hero-card">
        <div>
          <p className="eyebrow">Simple shared expenses</p>
          <h1>Track bills, split fairly, and settle up with fewer repayments.</h1>
          <p className="hero-copy">
            Add group members, record who paid, choose who shared the expense, and split bills equally, by shares,
            or by custom percentages.
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

      {isGuest ? (
        <section className="access-banner">
          <LockKeyhole size={20} />
          <div>
            <strong>Guest read-only mode</strong>
            <span>You can view balances, settlements, and history, but only the admin can add, delete, clear, or save data.</span>
          </div>
        </section>
      ) : null}

      <section className={`sync-card ${isSupabaseConfigured ? 'connected' : 'local-only'}`}>
        <div className="sync-main">
          <div className="sync-icon" aria-hidden="true">
            {isSupabaseConfigured ? <Cloud size={22} /> : <CloudOff size={22} />}
          </div>
          <div>
            <p className="panel-kicker">Cloud storage</p>
            <h2>{isSupabaseConfigured ? 'Supabase sync enabled' : 'Local browser storage only'}</h2>
            <p>{cloudMessage}</p>
            {isSupabaseConfigured ? (
              <small>
                Group ID: <code>{supabaseGroupId}</code> · Last sync: {formatSyncTime(cloudUpdatedAt)}
              </small>
            ) : (
              <small>Add Supabase env variables to enable save/load from the cloud.</small>
            )}
          </div>
        </div>
        <div className="sync-actions">
          <button className="ghost-button" type="button" onClick={loadFromCloud} disabled={!isSupabaseConfigured || isCloudBusy}>
            {cloudStatus === 'loading' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            Load from cloud
          </button>
          <button className="primary-button" type="button" onClick={saveToCloud} disabled={!isSupabaseConfigured || isCloudBusy || !canEdit}>
            {cloudStatus === 'saving' ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            Save to cloud
          </button>
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

            {canEdit ? (
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
            ) : (
              <p className="read-only-note">Guests can view members, but only admin users can add or remove them.</p>
            )}

            <div className="member-list">
              {state.members.length ? (
                state.members.map((member) => (
                  <div key={member.id} className="member-chip">
                    <span>{member.name}</span>
                    {canEdit ? (
                      <button onClick={() => removeMember(member.id)} aria-label={`Remove ${member.name}`}>
                        <Trash2 size={15} />
                      </button>
                    ) : null}
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
              <span className="pill">{splitModeLabels[splitMode]}</span>
            </div>

            {canEdit ? (
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
                  <span>Split method</span>
                </div>
                <div className="split-mode-grid">
                  {(['equal', 'shares', 'percentages'] as SplitMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`mode-card ${splitMode === mode ? 'active' : ''}`}
                      onClick={() => handleSplitModeChange(mode)}
                    >
                      <strong>{splitModeLabels[mode]}</strong>
                      <span>
                        {mode === 'equal'
                          ? 'Same amount each'
                          : mode === 'shares'
                            ? 'e.g. 2 shares vs 1 share'
                            : 'Must total 100%'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="split-box">
                <div className="split-box-header">
                  <span>Split between</span>
                  <button
                    type="button"
                    onClick={selectAllSplitMembers}
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

              {splitMode !== 'equal' && splitBetween.length ? (
                <div className="split-box">
                  <div className="split-box-header">
                    <span>{splitMode === 'shares' ? 'Shares per member' : 'Percentage per member'}</span>
                    <button type="button" className="ghost-button mini-button" onClick={resetCustomSplit}>
                      {splitMode === 'shares' ? 'Reset to 1 each' : 'Split 100% equally'}
                    </button>
                  </div>
                  <div className="split-value-list">
                    {selectedSplitValues.map((item) => (
                      <label key={item.memberId} className="split-value-row">
                        <span>{item.name}</span>
                        <div className="split-input-wrapper">
                          <input
                            type="number"
                            min="0"
                            step={splitMode === 'shares' ? '0.5' : '0.01'}
                            value={item.value}
                            onChange={(event) => updateSplitValue(item.memberId, event.target.value)}
                            placeholder={splitMode === 'shares' ? '1' : '0'}
                          />
                          <em>{splitMode === 'shares' ? 'shares' : '%'}</em>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className={`split-total ${splitMode === 'percentages' && Math.abs(customSplitTotal - 100) > 0.01 ? 'warning' : ''}`}>
                    {splitMode === 'shares'
                      ? `Total shares: ${toInputNumber(customSplitTotal)}`
                      : `Total percentage: ${toInputNumber(customSplitTotal)}%`}
                  </p>
                </div>
              ) : null}

              {splitPreview.length ? (
                <div className="split-preview">
                  <span>Preview</span>
                  {splitPreview.map((item) => (
                    <div key={item.memberId}>
                      <span>{getMemberName(state.members, item.memberId)}</span>
                      <strong>{formatMoney(item.amount, state.currency)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              <button type="submit" className="primary-button full-width-button">
                <BadgeDollarSign size={18} /> Add bill
              </button>
            </form>
            ) : (
              <div className="read-only-card">
                <LockKeyhole size={28} />
                <h3>Expense editing is locked for guests</h3>
                <p>Login as admin to add bills, choose split shares or percentages, and save updates to Supabase.</p>
              </div>
            )}
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
                  checked={shouldSimplifyDebts}
                  onChange={(event) => {
                    if (isAdmin) {
                      setState((current) => ({ ...current, simplifyDebts: event.target.checked }));
                    } else {
                      setViewSimplifyDebts(event.target.checked);
                    }
                  }}
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
          {canEdit ? (
            <div className="button-row">
              <button className="ghost-button" onClick={resetDemo}>
                <RefreshCcw size={16} /> Load sample
              </button>
              <button className="danger-button" onClick={clearAll}>
                <Trash2 size={16} /> Clear all
              </button>
            </div>
          ) : (
            <span className="pill muted-pill">Read-only</span>
          )}
        </div>

        <div className="expense-list">
          {state.expenses.length ? (
            state.expenses.map((expense) => (
              <article key={expense.id} className="expense-card">
                <div>
                  <h3>{expense.description}</h3>
                  <p>
                    Paid by <strong>{getMemberName(state.members, expense.paidBy)}</strong> · {getExpenseSplitLabel(expense)} · {expense.date}
                  </p>
                </div>
                <div className="expense-card-actions">
                  <strong>{formatMoney(expense.amount, state.currency)}</strong>
                  {canEdit ? (
                    <button onClick={() => deleteExpense(expense.id)} aria-label={`Delete ${expense.description}`}>
                      <Trash2 size={16} />
                    </button>
                  ) : null}
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
