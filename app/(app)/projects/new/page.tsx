import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { toBrisbaneDate } from '@/lib/dates'
import { EmptyState } from '@/components/ui'
import { NewProjectForm } from './new-project-form'

export const dynamic = 'force-dynamic'

export default async function NewProjectPage() {
  await requireAdmin()
  const supabase = await createSupabaseServerClient()

  const [clients, folders] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .returns<Array<{ id: string; name: string }>>(),
    supabase
      .from('folders')
      .select('id, name')
      .order('sort_order')
      .returns<Array<{ id: string; name: string }>>(),
  ])

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/projects" className="text-sm text-ink-500 hover:text-ink-900">
          ← Projects
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink-900">New project</h1>
      </div>

      {(clients.data ?? []).length === 0 ? (
        <EmptyState
          title="Add a client first"
          body="Every project belongs to a client. Create one on the Clients screen."
        />
      ) : (
        <NewProjectForm
          clients={clients.data ?? []}
          folders={folders.data ?? []}
          today={toBrisbaneDate(new Date())}
        />
      )}
    </div>
  )
}
