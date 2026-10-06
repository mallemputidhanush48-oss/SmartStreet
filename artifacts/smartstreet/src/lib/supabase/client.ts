'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig, missingSupabaseConfigError } from './config';

let browserClient: SupabaseClient | undefined;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const config = getSupabasePublicConfig();
  if (!config) throw missingSupabaseConfigError();

  browserClient = createBrowserClient(config.url, config.key);
  return browserClient;
}
