import Link from 'next/link'
import { requireProfile, displayName } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getRunningEntry } from '@/lib/server/time'
import { TimerBar, type TimerProjectOption } from '@/components/timer-bar'
import type { Client, Project } from '@/lib/db-types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()
  const supabase = await createSupabaseServerClient()

  const [running, projectsResult, clientsResult] = await Promise.all([
    getRunningEntry(supabase, profile.id),
    supabase
      .from('projects')
      .select('id, name, client_id')
      .in('status', ['active', 'paused'])
      .order('name')
      .returns<Array<Pick<Project, 'id' | 'name' | 'client_id'>>>(),
    supabase.from('clients').select('id, name').returns<Array<Pick<Client, 'id' | 'name'>>>(),
  ])

  const clientNames = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]))
  const timerProjects: TimerProjectOption[] = (projectsResult.data ?? []).map((project) => ({
    id: project.id,
    label: `${clientNames.get(project.client_id) ?? 'Unknown'} — ${project.name}`,
  }))

  const isAdmin = profile.role === 'admin'

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink-900">
            Flourish Ops
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/projects">Projects</NavLink>
            <NavLink href="/time">Time</NavLink>
            {isAdmin ? <NavLink href="/clients">Clients</NavLink> : null}
            {isAdmin ? <NavLink href="/admin">Admin</NavLink> : null}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-ink-500">
              {displayName(profile)}
              {isAdmin ? <span className="ml-1.5 text-xs text-ink-300">admin</span> : null}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded px-2 py-1 text-ink-700 hover:bg-ink-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <TimerBar running={running} projects={timerProjects} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded px-2 py-1 text-ink-700 hover:bg-ink-100">
      {children}
    </Link>
  )
}
