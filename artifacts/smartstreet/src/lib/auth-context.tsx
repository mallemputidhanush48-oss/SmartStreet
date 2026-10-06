'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export type UserRole = 'admin' | 'technician' | 'citizen';

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  created_at?: string;
};

type SignUpInput = {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const client = useMemo(
    () => (configured ? createSupabaseBrowserClient() : null),
    [configured],
  );
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(
    configured
      ? null
      : 'SmartStreet needs its Supabase project URL and anon key in the project secrets before accounts can be used.',
  );

  const readProfile = useCallback(async (forUser: User): Promise<Profile | null> => {
    if (!client) return null;
    const { data, error: queryError } = await client
      .from('profiles')
      .select('id, full_name, email, phone, role, created_at')
      .eq('id', forUser.id)
      .maybeSingle();

    if (queryError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('SmartStreet profile lookup failed:', queryError);
      }
      const message = 'We could not load your account profile. Please try again.';
      setError(message);
      throw new Error(message);
    }

    if (!data) {
      const message = 'Your account is being prepared. Please sign in again in a moment.';
      setError(message);
      return null;
    }

    setError(null);
    return data as Profile;
  }, [client]);

  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }

    let active = true;
    let requestId = 0;
    const syncUser = async (nextUser: User | null) => {
      const currentRequest = ++requestId;
      if (!active) return;
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const nextProfile = await readProfile(nextUser);
        if (active && currentRequest === requestId) setProfile(nextProfile);
      } catch {
        // readProfile sets the user-facing error without exposing database details.
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      // Defer database access so it does not run while the auth callback holds its lock.
      queueMicrotask(() => void syncUser(nextUser));
    });

    void client.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      void syncUser(data.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, readProfile]);

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    if (!client) throw new Error('Supabase is not configured for this app.');
    const { data, error: authError } = await client.auth.getUser();
    if (authError || !data.user) {
      setUser(null);
      setProfile(null);
      return null;
    }
    setUser(data.user);
    const nextProfile = await readProfile(data.user);
    setProfile(nextProfile);
    return nextProfile;
  }, [client, readProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) throw new Error('Supabase is not configured for this app.');
    const { data, error: authError } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('SmartStreet sign-in failed:', authError);
      }
      throw new Error('We could not sign you in. Check your email and password, then try again.');
    }
    setUser(data.user);
    setError(null);
  }, [client]);

  const signUp = useCallback(async (input: SignUpInput) => {
    if (!client) throw new Error('Supabase is not configured for this app.');
    const { data, error: authError } = await client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: {
          full_name: input.fullName.trim(),
          phone: input.phone?.trim() || null,
        },
      },
    });
    if (authError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('SmartStreet sign-up failed:', authError);
      }
      throw new Error('We could not create your account. Check your details and try again.');
    }

    if (!data.session) {
      return { needsEmailConfirmation: true };
    }

    setUser(data.user);
    setError(null);
    return { needsEmailConfirmation: false };
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    const { error: authError } = await client.auth.signOut();
    if (authError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('SmartStreet sign-out failed:', authError);
      }
      throw new Error('We could not sign you out. Please try again.');
    }
    setUser(null);
    setProfile(null);
    setError(null);
  }, [client]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    error,
    configured,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  }), [user, profile, loading, error, configured, signIn, signUp, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
