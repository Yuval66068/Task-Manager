import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'replace-me',
  isConfigured:
    Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
}

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseConfig.isConfigured) {
    console.warn(
      'Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a local .env file.',
    )
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  }

  return supabaseClient
}

export function getSupabaseConnectionStatus() {
  return {
    configured: supabaseConfig.isConfigured,
    url: supabaseConfig.url,
    hasAnonKey: Boolean(supabaseConfig.anonKey && supabaseConfig.anonKey !== 'replace-me'),
  }
}
