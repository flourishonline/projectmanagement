'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { ALLOWED_EMAIL_DOMAIN } from '@/lib/env'

export function GoogleSignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)

    const supabase = createSupabaseBrowserClient()
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          // Asks Google to only offer accounts on the workspace domain. This is
          // a convenience, not the control — the callback and the database both
          // reject anything else.
          hd: ALLOWED_EMAIL_DOMAIN,
          prompt: 'select_account',
        },
      },
    })

    if (signInError) {
      setError(signInError.message)
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-300 bg-white px-4 py-2.5 text-sm font-medium text-ink-900 hover:bg-ink-50 focus:outline-2 focus:outline-offset-2 focus:outline-accent disabled:opacity-60"
      >
        <GoogleMark />
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
    </>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.9 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.9c-.6 3-2.3 5.6-4.9 7.3l7.6 5.9c4.4-4.1 7.3-10.2 7.3-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-3.7-13.6-8.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  )
}
