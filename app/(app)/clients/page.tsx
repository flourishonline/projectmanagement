import { requireAdmin } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, EmptyState } from '@/components/ui'
import { ClientRow, NewClientForm } from './client-forms'
import type { Client, Project } from '@/lib/db-types'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  await requireAdmin()
  const supabase = await createSupabaseServerClient()

  const [clientsResult, projectsResult] = await Promise.all([
    supabase.from('clients').select('*').order('name').returns<Client[]>(),
    supabase.from('projects').select('id, client_id').returns<Array<Pick<Project, 'id' | 'client_id'>>>(),
  ])

  const counts = new Map<string, number>()
  for (const project of projectsResult.data ?? []) {
    counts.set(project.client_id, (counts.get(project.client_id) ?? 0) + 1)
  }

  const clients = clientsResult.data ?? []

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">Clients</h1>
        <NewClientForm />
      </div>

      {clients.length === 0 ? (
        <EmptyState title="No clients yet" body="Add one to start creating projects." />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-200">
            {clients.map((client) => (
              <ClientRow key={client.id} client={client} projectCount={counts.get(client.id) ?? 0} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
