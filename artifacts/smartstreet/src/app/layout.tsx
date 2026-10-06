import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'leaflet/dist/leaflet.css';
import '../index.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SmartStreet — Hyderabad streetlight service',
  description: 'Track streetlight faults from resident report to verified repair.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
