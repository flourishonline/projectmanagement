import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { requiredEnv } from '@/lib/env'

/**
 * Service-role client. Bypasses RLS entirely, so it is used only where the
 * work genuinely cannot be done as the signed-in user: rejecting an
 * out-of-domain account at sign-in, and closing retainer periods on schedule.
 *
 * Never import this into anything that renders.
 */
export function createSupabaseAdminClient() {
  return createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
