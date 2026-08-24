import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the Supabase session on every request and keeps unauthenticated
 * traffic out of the app. Page-level checks still run — this is the coarse
 * gate, not the authorisation model.
 *
 * Next 16 calls this convention `proxy`; it is what earlier versions called
 * middleware.
 */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/denied']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const { data } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

  if (!data.user && !isPublic) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = path === '/' ? '' : `?next=${encodeURIComponent(path)}`
    return NextResponse.redirect(login)
  }

  if (data.user && path === '/login') {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    home.search = ''
    return NextResponse.redirect(home)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
