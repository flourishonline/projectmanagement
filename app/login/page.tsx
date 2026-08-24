import { ALLOWED_EMAIL_DOMAIN } from '@/lib/env'
import { GoogleSignInButton } from './google-sign-in-button'

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Please try again.',
  exchange_failed: 'Google sign-in did not complete. Please try again.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const message = params.error ? ERROR_MESSAGES[params.error] ?? null : null

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Flourish Ops</h1>
        <p className="mt-2 text-sm text-ink-500">
          Time and project tracking for Flourish Online.
        </p>

        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
          <GoogleSignInButton next={params.next ?? '/'} />
          <p className="mt-4 text-xs text-ink-500">
            Sign in with your <span className="font-medium text-ink-700">@{ALLOWED_EMAIL_DOMAIN}</span>{' '}
            account. No other accounts can be used.
          </p>
        </div>

        {message ? (
          <p className="mt-4 rounded-md border border-critical/30 bg-critical-bg px-3 py-2 text-sm text-critical">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  )
}
