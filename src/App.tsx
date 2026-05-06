import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Cloud,
  CloudOff,
  FolderOpen,
  Home,
  Loader2,
  LogIn,
  Save,
  LogOut,
  LockKeyhole,
  Plus,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { AppState, Expense, Member, Settlement, SplitMode } from './types';
import {
  createBillGroupInCloud,
  deleteBillGroupFromCloud,
  listBillGroupsFromCloud,
  loadBillGroupFromCloud,
  saveBillGroupToCloud,
  type BillGroupSummary,
} from './cloudStore';
import { currencyOptions, formatMoney } from './money';
import { defaultState } from './stateUtils';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { loginWithUsername, logoutCurrentUser, normalizeUsername, registerWithUsername, type AuthMode } from './auth';
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

function getUsernameFromUser(user: User | null) {
  if (!user) return '';
  const metadataUsername = typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : '';
  return metadataUsername || user.email?.replace('@splitmate.local', '') || 'User';
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
    settledPayments: [],
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
  const [state, setState] = useState<AppState>(defaultState);
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
      ? 'Cloud storage is ready. Select a saved bill set or create a new one.'
      : 'Cloud sync is not configured yet. Add Supabase environment variables to use this app.',
  );
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  const [cloudGroups, setCloudGroups] = useState<BillGroupSummary[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroupName, setActiveGroupName] = useState('No bill set selected');
  const [newGroupName, setNewGroupName] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const canEdit = Boolean(user);
  const isCloudBusy = cloudStatus === 'loading' || cloudStatus === 'saving';
  const shouldSimplifyDebts = state.simplifyDebts;


  useEffect(() => {
    let mounted = true;

    async function initialiseSession() {
      if (!isSupabaseConfigured || !supabase) {
        setAuthLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      }
    }

    initialiseSession();

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        mounted = false;
      };
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (!session?.user) {
        applyLoadedState(defaultState);
        setCloudGroups([]);
        setActiveGroupId(null);
        setActiveGroupName('No bill set selected');
        setCloudUpdatedAt(null);
        setCloudStatus('idle');
        setCloudMessage(
          isSupabaseConfigured
            ? 'Login to load your saved bill sets from Supabase.'
            : 'Cloud sync is not configured yet. Add Supabase environment variables to use this app.',
        );
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialCloudGroups() {
      if (!isSupabaseConfigured || !user) return;

      applyLoadedState(defaultState);
      setActiveGroupId(null);
      setActiveGroupName('No bill set selected');
      setCloudUpdatedAt(null);

      try {
        setCloudStatus('loading');
        setCloudMessage('Loading saved bill sets from Supabase...');
        const groups = await listBillGroupsFromCloud();

        if (cancelled) return;

        setCloudGroups(groups);

        if (!groups.length) {
          applyLoadedState(defaultState);
          setActiveGroupId(null);
          setActiveGroupName('No bill set selected');
          setCloudUpdatedAt(null);
          setCloudStatus('idle');
          setCloudMessage('No saved bill sets exist yet. Create one to save your data to Supabase.');
          return;
        }

        const firstGroup = groups[0];
        const cloudData = await loadBillGroupFromCloud(firstGroup.id);

        if (cancelled) return;

        if (cloudData) {
          setState(cloudData.state);
          setPaidBy(cloudData.state.members[0]?.id ?? '');
          setSplitBetween(cloudData.state.members.map((member) => member.id));
          setSplitMode('equal');
          setSplitValues({});
          setActiveGroupId(cloudData.id);
          setActiveGroupName(cloudData.name);
          setCloudUpdatedAt(cloudData.updatedAt);
          setCloudStatus('success');
          setCloudMessage(`Loaded “${cloudData.name}” from Supabase.`);
        }
      } catch (loadError) {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudMessage(getErrorMessage(loadError));
      }
    }

    loadInitialCloudGroups();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!state.members.some((member) => member.id === paidBy)) {
      setPaidBy(state.members[0]?.id ?? '');
    }

    setSplitBetween((current) => {
      const validIds = current.filter((id) => state.members.some((member) => member.id === id));
      return validIds.length ? validIds : state.members.map((member) => member.id);
    });
  }, [paidBy, state.members]);

  const balances = useMemo(
    () => calculateBalances(state.members, state.expenses, state.settledPayments),
    [state.members, state.expenses, state.settledPayments],
  );

  const settlements = useMemo(() => {
    return shouldSimplifyDebts
      ? calculateSimplifiedSettlements(balances)
      : calculatePairwiseSettlements(state.expenses, state.settledPayments);
  }, [balances, state.expenses, state.settledPayments, shouldSimplifyDebts]);

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

  const applyLoadedState = (
    nextState: AppState,
    cloudGroup?: { id: string; name: string; updatedAt: string | null },
  ) => {
    setState(nextState);
    setPaidBy(nextState.members[0]?.id ?? '');
    setSplitBetween(nextState.members.map((member) => member.id));
    setSplitMode('equal');
    setSplitValues({});
    setMemberName('');
    setExpenseDescription('');
    setExpenseAmount('');
    setExpenseDate(new Date().toISOString().slice(0, 10));

    if (cloudGroup) {
      setActiveGroupId(cloudGroup.id);
      setActiveGroupName(cloudGroup.name);
      setCloudUpdatedAt(cloudGroup.updatedAt);
    }

    setError('');
  };

  const refreshCloudGroupList = async () => {
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before loading cloud bill sets.');
      return [] as BillGroupSummary[];
    }

    const groups = await listBillGroupsFromCloud();
    setCloudGroups(groups);
    return groups;
  };

  const requireAdmin = (message = 'Please login before making changes in this app.') => {
    if (user) return true;
    setError(message);
    return false;
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');

    try {
      setAuthLoading(true);
      if (authMode === 'register') {
        await registerWithUsername(authUsername, authPassword);
      } else {
        await loginWithUsername(authUsername, authPassword);
      }
      setAuthUsername('');
      setAuthPassword('');
      setError('');
    } catch (authSubmitError) {
      setAuthError(getErrorMessage(authSubmitError));
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    try {
      await logoutCurrentUser();
      setAuthUsername('');
      setAuthPassword('');
      setAuthError('');
      setError('');
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    }
  };

  const refreshGroupsFromCloud = async () => {
    try {
      setCloudStatus('loading');
      setCloudMessage('Refreshing saved bill sets from Supabase...');
      const groups = await refreshCloudGroupList();
      setCloudStatus('success');
      setCloudMessage(groups.length ? 'Bill set list refreshed.' : 'No saved bill sets found yet.');
    } catch (loadError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(loadError));
    }
  };

  const loadCloudGroup = async (groupId: string) => {
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before loading from cloud.');
      return;
    }

    try {
      setCloudStatus('loading');
      const groupName = cloudGroups.find((group) => group.id === groupId)?.name ?? 'selected bill set';
      setCloudMessage(`Loading “${groupName}” from Supabase...`);
      const cloudData = await loadBillGroupFromCloud(groupId);

      if (!cloudData) {
        setCloudStatus('idle');
        setCloudMessage('That bill set was not found. Refresh the list and try again.');
        return;
      }

      applyLoadedState(cloudData.state, {
        id: cloudData.id,
        name: cloudData.name,
        updatedAt: cloudData.updatedAt,
      });
      setCloudStatus('success');
      setCloudMessage(`Loaded “${cloudData.name}” from Supabase.`);
    } catch (loadError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(loadError));
    }
  };

  const createNewCloudGroup = async () => {
    if (!requireAdmin('Please login to create new bill sets.')) return;
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before saving to cloud.');
      return;
    }

    const trimmedName = newGroupName.trim();
    if (!trimmedName) {
      setError('Add a name for the new bill set before saving it.');
      return;
    }

    try {
      setCloudStatus('saving');
      setCloudMessage(`Creating “${trimmedName}” in Supabase...`);
      if (!user) {
        setError('Please login before creating a bill set.');
        return;
      }
      const createdGroup = await createBillGroupInCloud(trimmedName, state, user.id);
      applyLoadedState(createdGroup.state, {
        id: createdGroup.id,
        name: createdGroup.name,
        updatedAt: createdGroup.updatedAt,
      });
      setNewGroupName('');
      const groups = await refreshCloudGroupList();
      setCloudStatus('success');
      setCloudMessage(`Created “${createdGroup.name}”. You now have ${groups.length} saved bill set${groups.length === 1 ? '' : 's'}.`);
    } catch (saveError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(saveError));
    }
  };

  const saveToCloud = async () => {
    if (!requireAdmin('Please login to save changes to Supabase.')) return;
    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before saving to cloud.');
      return;
    }

    if (!activeGroupId) {
      setError('Create a new bill set or select an existing one before saving changes.');
      return;
    }

    try {
      setCloudStatus('saving');
      setCloudMessage(`Saving “${activeGroupName}” to Supabase...`);
      const updatedAt = await saveBillGroupToCloud(activeGroupId, activeGroupName, state);
      setCloudUpdatedAt(updatedAt);
      await refreshCloudGroupList();
      setCloudStatus('success');
      setCloudMessage(`Saved “${activeGroupName}” to Supabase.`);
    } catch (saveError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(saveError));
    }
  };

  const deleteActiveCloudGroup = async () => {
    if (!requireAdmin('Please login to delete saved bill sets.')) return;
    if (!activeGroupId) {
      setError('Select a saved bill set before deleting it.');
      return;
    }

    const confirmed = window.confirm(`Delete “${activeGroupName}” from Supabase? This cannot be undone.`);
    if (!confirmed) return;

    try {
      setCloudStatus('saving');
      setCloudMessage(`Deleting “${activeGroupName}” from Supabase...`);
      await deleteBillGroupFromCloud(activeGroupId);
      const groups = await refreshCloudGroupList();

      if (groups.length) {
        const nextGroup = groups[0];
        await loadCloudGroup(nextGroup.id);
      } else {
        applyLoadedState(defaultState);
        setActiveGroupId(null);
        setActiveGroupName('No bill set selected');
        setCloudUpdatedAt(null);
        setCloudStatus('success');
        setCloudMessage('Deleted the bill set. No saved bill sets remain in Supabase.');
      }
    } catch (deleteError) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(deleteError));
    }
  };

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireAdmin('Please login to add group members.')) return;
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
    if (!requireAdmin('Please login to remove group members.')) return;
    const hasExpenses = state.expenses.some(
      (expense) => expense.paidBy === memberId || expense.splitBetween.includes(memberId),
    );
    const hasSettledPayments = state.settledPayments.some(
      (payment) => payment.from === memberId || payment.to === memberId,
    );

    if (hasExpenses || hasSettledPayments) {
      setError('This member is attached to existing expenses or settled payments. Delete those records before removing the member.');
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
    if (!requireAdmin('Please login to add expenses.')) return;

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
    if (!requireAdmin('Please login to delete expenses.')) return;
    setState((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== expenseId) }));
  };

  const handleSplitModeChange = (mode: SplitMode) => {
    if (!requireAdmin('Please login to change expense split details.')) return;
    setSplitMode(mode);
    setSplitValues((current) => {
      if (mode === 'equal') return {};
      if (mode === 'percentages') return getEqualPercentages(splitBetween);
      return Object.fromEntries(splitBetween.map((memberId) => [memberId, current[memberId] || '1']));
    });
  };

  const selectAllSplitMembers = () => {
    if (!requireAdmin('Please login to change expense split details.')) return;
    const allMemberIds = state.members.map((member) => member.id);
    setSplitBetween(allMemberIds);
    setSplitValues(getDefaultSplitValues(allMemberIds, splitMode));
  };

  const toggleSplitMember = (memberId: string) => {
    if (!requireAdmin('Please login to change expense split details.')) return;
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
    if (!requireAdmin('Please login to change expense split details.')) return;
    setSplitValues((current) => ({ ...current, [memberId]: value }));
  };

  const resetCustomSplit = () => {
    if (!requireAdmin('Please login to change expense split details.')) return;
    setSplitValues(getDefaultSplitValues(splitBetween, splitMode));
  };

  const resetDemo = () => {
    if (!requireAdmin('Please login to load sample data.')) return;
    const sampleState = createSampleState(state.currency);

    setState(sampleState);
    setPaidBy(sampleState.members[0].id);
    setSplitBetween(sampleState.members.map((member) => member.id));
    setSplitMode('equal');
    setSplitValues({});
    setError('');
  };

  const clearAll = () => {
    if (!requireAdmin('Please login to clear all data.')) return;
    const emptyState: AppState = { members: [], expenses: [], settledPayments: [], currency: state.currency, simplifyDebts: true };
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

  const markSettlementAsSettled = async (settlement: Settlement) => {
    if (!requireAdmin('Please login to mark settlements as paid.')) return;

    if (!activeGroupId) {
      setError('Select or create a saved bill set before marking a settlement as paid, so the change can be saved to Supabase.');
      return;
    }

    if (!isSupabaseConfigured) {
      setCloudStatus('error');
      setCloudMessage('Add your Supabase environment variables before saving settled payments.');
      return;
    }

    const settledPayment = {
      id: crypto.randomUUID(),
      from: settlement.from,
      to: settlement.to,
      amount: settlement.amount,
      date: new Date().toISOString().slice(0, 10),
      settledAt: new Date().toISOString(),
    };

    const nextState: AppState = {
      ...state,
      settledPayments: [settledPayment, ...state.settledPayments],
    };

    try {
      setState(nextState);
      setCloudStatus('saving');
      setCloudMessage(`Marking payment as settled and saving “${activeGroupName}” to Supabase...`);
      const updatedAt = await saveBillGroupToCloud(activeGroupId, activeGroupName, nextState);
      setCloudUpdatedAt(updatedAt);
      await refreshCloudGroupList();
      setCloudStatus('success');
      setCloudMessage(`Marked ${getMemberName(state.members, settlement.from)} → ${getMemberName(state.members, settlement.to)} as settled and saved to Supabase.`);
      setError('');
    } catch (saveError) {
      setState(state);
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(saveError));
      setError('Could not save the settled payment. The local change was rolled back.');
    }
  };

  const deleteSettledPayment = async (paymentId: string) => {
    if (!requireAdmin('Please login to delete settled payment records.')) return;

    const nextState: AppState = {
      ...state,
      settledPayments: state.settledPayments.filter((payment) => payment.id !== paymentId),
    };

    if (!activeGroupId || !isSupabaseConfigured) {
      setState(nextState);
      setError('Settled payment removed locally. Select a cloud bill set and save to persist the change.');
      return;
    }

    try {
      setState(nextState);
      setCloudStatus('saving');
      setCloudMessage(`Updating settled payment history for “${activeGroupName}”...`);
      const updatedAt = await saveBillGroupToCloud(activeGroupId, activeGroupName, nextState);
      setCloudUpdatedAt(updatedAt);
      await refreshCloudGroupList();
      setCloudStatus('success');
      setCloudMessage('Removed the settled payment record and saved the update to Supabase.');
      setError('');
    } catch (saveError) {
      setState(state);
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(saveError));
      setError('Could not remove the settled payment record. The local change was rolled back.');
    }
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

  if (authLoading && !user) {
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
          <div className="settled-state">
            <Loader2 size={32} className="spin" />
            <p>Checking your session...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
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
            {/* <p className="eyebrow">Supabase account</p> */}
            <h1>{authMode === 'login' ? 'Login' : 'Create your account.'}</h1>
          </div>

          {!isSupabaseConfigured ? (
            <div className="error-banner compact">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before using account login.</div>
          ) : null}

          <form className="login-form" onSubmit={handleAuthSubmit}>
            <label>
              Username
              <div className="password-input">
                <LogIn size={18} />
                <input
                  type="text"
                  value={authUsername}
                  onChange={(event) => setAuthUsername(normalizeUsername(event.target.value))}
                  placeholder="e.g. johndoe"
                  autoComplete="username"
                />
              </div>
            </label>
            <label>
              Password
              <div className="password-input">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder={authMode === 'login' ? 'Enter your password' : 'Create a password'}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
            </label>
            {authError ? <div className="error-banner compact">{authError}</div> : null}
            <button type="submit" className="primary-button full-width-button" disabled={authLoading || !isSupabaseConfigured}>
              {authLoading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
              {authMode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>

          <button
            type="button"
            className="ghost-button full-width-button guest-login-button"
            onClick={() => {
              setAuthMode((current) => (current === 'login' ? 'register' : 'login'));
              setAuthError('');
            }}
          >
            {authMode === 'login' ? 'New user? Register here' : 'Already registered? Login'}
          </button>

          {/* <p className="auth-note">
            This uses Supabase Auth sessions. Your rows are protected by Row Level Security, so logged-in users only load their own bill sets.
          </p> */}
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
          <div className={`role-badge admin`}>
            <ShieldCheck size={16} />
            {getUsernameFromUser(user)}
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

            <section className={`sync-card ${isSupabaseConfigured ? 'connected' : 'local-only'}`}>
        <div className="sync-main">
          <div className="sync-icon" aria-hidden="true">
            {isSupabaseConfigured ? <Cloud size={22} /> : <CloudOff size={22} />}
          </div>
          <div>
            <p className="panel-kicker">Cloud storage</p>
            <h2>{isSupabaseConfigured ? 'Supabase account storage enabled' : 'Supabase storage not configured'}</h2>
            <p>{cloudMessage}</p>
            {isSupabaseConfigured ? (
              <small>
                Active bill set: <code>{activeGroupName}</code> · Last sync: {formatSyncTime(cloudUpdatedAt)}
              </small>
            ) : (
              <small>Add Supabase env variables to enable save/load from the cloud.</small>
            )}
          </div>
        </div>
        <div className="sync-actions">
          <button className="ghost-button" type="button" onClick={refreshGroupsFromCloud} disabled={!isSupabaseConfigured || isCloudBusy}>
            {cloudStatus === 'loading' ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
            Refresh list
          </button>
          <button className="primary-button" type="button" onClick={saveToCloud} disabled={!isSupabaseConfigured || isCloudBusy || !canEdit || !activeGroupId}>
            {cloudStatus === 'saving' ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            Save selected
          </button>
        </div>
      </section>

      <section className="panel full-width-panel bill-set-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Saved bill sets</p>
            <h2><FolderOpen size={20} /> Select an expense set to view</h2>
          </div>
          <span className="pill">{cloudGroups.length} saved</span>
        </div>

        {canEdit ? (
          <div className="bill-set-create">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="New bill set name, e.g. April house bills"
              aria-label="New bill set name"
            />
            <button className="primary-button" type="button" onClick={createNewCloudGroup} disabled={!isSupabaseConfigured || isCloudBusy}>
              <Plus size={16} /> Save as new set
            </button>
            <button className="danger-button" type="button" onClick={deleteActiveCloudGroup} disabled={!isSupabaseConfigured || isCloudBusy || !activeGroupId}>
              <Trash2 size={16} /> Delete selected
            </button>
          </div>
        ) : (
          <p className="read-only-note">Login is required to create, save, or delete bill sets.</p>
        )}

        <div className="bill-set-list">
          {cloudGroups.length ? (
            cloudGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`bill-set-card ${activeGroupId === group.id ? 'active' : ''}`}
                onClick={() => loadCloudGroup(group.id)}
                disabled={isCloudBusy}
              >
                <div>
                  <strong>{group.name}</strong>
                  <span>
                    {group.expenseCount} expense{group.expenseCount === 1 ? '' : 's'} · {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · Updated {formatSyncTime(group.updatedAt)}
                  </span>
                </div>
                <em>{formatMoney(group.totalSpent, group.currency)}</em>
              </button>
            ))
          ) : (
            <p className="empty-text">
              {isSupabaseConfigured
                ? 'No saved bill sets yet. Enter a name and click “Save as new set”.'
                : 'Configure Supabase to list saved bill sets here.'}
            </p>
          )}
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
              <p className="read-only-note">Login is required to add or remove members.</p>
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
                <h3>Expense editing is locked</h3>
                <p>Login to add bills, choose split shares or percentages, and save updates to Supabase.</p>
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
                    setState((current) => ({ ...current, simplifyDebts: event.target.checked }));
                  }}
                />
                <span>Simplify debts</span>
              </label>
            </div>

            <div className="settlement-list">
              {settlements.length ? (
                settlements.map((settlement, index) => (
                  <div key={`${settlement.from}-${settlement.to}-${index}`} className="settlement-card">
                    <div className="settlement-flow">
                      <span>{getMemberName(state.members, settlement.from)}</span>
                      <ArrowRight size={17} />
                      <span>{getMemberName(state.members, settlement.to)}</span>
                    </div>
                    <div className="settlement-actions">
                      <strong>{formatMoney(settlement.amount, state.currency)}</strong>
                      {canEdit ? (
                        <button
                          type="button"
                          className="primary-button mini-button"
                          onClick={() => markSettlementAsSettled(settlement)}
                          disabled={!activeGroupId || !isSupabaseConfigured || isCloudBusy}
                          title={!activeGroupId ? 'Select a saved bill set first' : 'Mark this amount as paid'}
                        >
                          <CheckCircle2 size={15} /> Settled
                        </button>
                      ) : null}
                    </div>
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
            <p className="panel-kicker">Paid off</p>
            <h2><CheckCircle2 size={20} /> Settled payments</h2>
          </div>
          <span className="pill">{state.settledPayments.length} settled</span>
        </div>

        <div className="settled-payment-list">
          {state.settledPayments.length ? (
            state.settledPayments.map((payment) => (
              <article key={payment.id} className="settled-payment-card">
                <div>
                  <strong>
                    {getMemberName(state.members, payment.from)} paid {getMemberName(state.members, payment.to)}
                  </strong>
                  <span>Settled on {payment.date}</span>
                </div>
                <div className="expense-card-actions">
                  <strong>{formatMoney(payment.amount, state.currency)}</strong>
                  {canEdit ? (
                    <button type="button" onClick={() => deleteSettledPayment(payment.id)} aria-label="Delete settled payment record">
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <p className="empty-text">No payments have been marked as settled yet.</p>
          )}
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
            <span className="pill muted-pill">Signed in</span>
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
    </main>
  );
}

export default App;
