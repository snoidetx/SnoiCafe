import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const supabase =
  url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_')
    ? createClient(url, key, {
        auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
      })
    : null
export function appUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}
