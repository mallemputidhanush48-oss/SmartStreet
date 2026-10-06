import App from '@/App';
import { requireProfile } from '@/lib/auth/server';

export default async function AdminPage() {
  await requireProfile(['admin']);
  return <App />;
}
