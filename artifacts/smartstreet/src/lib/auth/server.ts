import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile, UserRole } from '@/lib/auth-context';

export async function getCurrentProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || typeof userId !== 'string') return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('SmartStreet server profile lookup failed:', error);
    }
    return null;
  }

  return (data as Profile | null) ?? null;
}

export async function requireProfile(allowedRoles?: UserRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    redirect(roleHome(profile.role));
  }
  return profile;
}

export function roleHome(role: UserRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'technician') return '/technician';
  return '/citizen';
}
