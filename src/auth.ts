import { isSupabaseConfigured, supabase } from './supabaseClient';

export type AuthMode = 'login' | 'register';

function assertSupabaseReady() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function usernameToEmail(username: string) {
  const normalized = normalizeUsername(username);
  return `${normalized}@splitmate.local`;
}

export function validateUsername(username: string) {
  const normalized = normalizeUsername(username);

  if (normalized.length < 3) {
    return 'Username must be at least 3 characters.';
  }

  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    return 'Username can only contain letters, numbers, dots, underscores, or hyphens.';
  }

  return '';
}

export async function registerWithUsername(username: string, password: string) {
  assertSupabaseReady();

  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const normalizedUsername = normalizeUsername(username);
  const { data, error } = await supabase!.auth.signUp({
    email: usernameToEmail(normalizedUsername),
    password,
    options: {
      data: {
        username: normalizedUsername,
      },
    },
  });

  if (error) throw new Error(error.message);

  if (data.user) {
    const { error: profileError } = await supabase!
      .from('profiles')
      .upsert({ id: data.user.id, username: normalizedUsername }, { onConflict: 'id' });

    if (profileError) throw new Error(profileError.message);
  }

  return data;
}

export async function loginWithUsername(username: string, password: string) {
  assertSupabaseReady();

  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  const { data, error } = await supabase!.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function logoutCurrentUser() {
  assertSupabaseReady();
  const { error } = await supabase!.auth.signOut();
  if (error) throw new Error(error.message);
}
