import App from '@/App';
import { requireProfile } from '@/lib/auth/server';

export default async function CitizenPage() {
  await requireProfile(['citizen']);
  return <App />;
}
