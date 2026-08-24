import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { requiredEnv } from '@/lib/env'

/**
 * Supabase client for server components, route handlers and server actions.
 * Carries the caller's session, so every query it makes is subject to RLS.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Server components cannot set cookies. The middleware refreshes
            // the session on every request, so nothing is lost here.
          }
        },
      },
    },
  )
}
