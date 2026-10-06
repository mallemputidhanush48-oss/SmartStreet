import { redirect } from 'next/navigation';
import { getCurrentProfile, roleHome } from '@/lib/auth/server';

export default async function HomePage() {
  const profile = await getCurrentProfile();
  redirect(profile ? roleHome(profile.role) : '/login');
}
