import 'server-only'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/db-types'

/** The signed-in staff member, or null. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient()

  // getUser, not getSession: it re-validates the token with Supabase rather
  // than trusting whatever is in the cookie.
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .maybeSingle<Profile>()

  if (!profile || !profile.active) return null
  return profile
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  return profile
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')
  return profile
}

export function displayName(profile: Pick<Profile, 'full_name' | 'email'>): string {
  return profile.full_name?.trim() || profile.email.split('@')[0] || profile.email
}
