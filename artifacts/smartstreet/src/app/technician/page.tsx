import App from '@/App';
import { requireProfile } from '@/lib/auth/server';

export default async function TechnicianPage() {
  await requireProfile(['technician']);
  return <App />;
}
