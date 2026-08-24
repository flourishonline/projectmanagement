import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/server/dashboard'
import { formatHours } from '@/lib/calc'
import { toBrisbaneDate } from '@/lib/dates'
import { Card, EmptyState, ProgressBar, Select, StateChip } from '@/components/ui'
import type { Client, Folder, Project } from '@/lib/db-types'

export const dynamic = 'force-dynamic'

const TYPE_LABEL = { retainer: 'Retainer', bundle: 'Bundle', standalone: 'Fixed fee' } as const

interface Filters {
  folder?: string
  client?: string
  type?: string
  status?: string
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>
}) {
  const profile = await requireProfile()
  const filters = await searchParams
  const supabase = await createSupabaseServerClient()
  const today = toBrisbaneDate(new Date())

  const status = filters.status ?? 'active'

  let query = supabase.from('projects').select('*').order('name')
  if (status !== 'all') query = query.eq('status', status)
  if (filters.folder) query = query.eq('folder_id', filters.folder)
  if (filters.client) query = query.eq('client_id', filters.client)
  if (filters.type) query = query.eq('type', filters.type)

  const [projectsResult, clientsResult, foldersResult] = await Promise.all([
    query.returns<Project[]>(),
    supabase.from('clients').select('*').order('name').returns<Client[]>(),
    supabase.from('folders').select('*').order('sort_order').returns<Folder[]>(),
  ])

  const projects = projectsResult.data ?? []
  const clientNames = new Map((clientsResult.data ?? []).map((c) => [c.id, c.name]))
  const folderNames = new Map((foldersResult.data ?? []).map((f) => [f.id, f.name]))

  // Burn figures are admin-only; members get the list without them.
  const burnByProject =
    profile.role === 'admin'
      ? new Map((await loadDashboard(supabase, today)).cards.map((card) => [card.project.id, card.burn]))
      : new Map()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">Projects</h1>
        {profile.role === 'admin' ? (
          <Link
            href="/projects/new"
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink-50"
          >
            New project
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <FilterSelect name="status" label="Status" value={status} options={[
          { value: 'active', label: 'Active' },
          { value: 'paused', label: 'Paused' },
          { value: 'complete', label: 'Complete' },
          { value: 'archived', label: 'Archived' },
          { value: 'all', label: 'All' },
        ]} />
        <FilterSelect name="type" label="Type" value={filters.type ?? ''} options={[
          { value: '', label: 'Any type' },
          { value: 'retainer', label: 'Retainer' },
          { value: 'bundle', label: 'Bundle' },
          { value: 'standalone', label: 'Fixed fee' },
        ]} />
        <FilterSelect name="client" label="Client" value={filters.client ?? ''} options={[
          { value: '', label: 'Any client' },
          ...(clientsResult.data ?? []).map((c) => ({ value: c.id, label: c.name })),
        ]} />
        <FilterSelect name="folder" label="Folder" value={filters.folder ?? ''} options={[
          { value: '', label: 'Any folder' },
          ...(foldersResult.data ?? []).map((f) => ({ value: f.id, label: f.name })),
        ]} />
        <button
          type="submit"
          className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink-50"
        >
          Apply
        </button>
      </form>

      {projects.length === 0 ? (
        <EmptyState title="No projects match these filters" />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Folder</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {profile.role === 'admin' ? (
                  <th className="px-4 py-2 text-right font-medium">Burn</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {projects.map((project) => {
                const burn = burnByProject.get(project.id)
                return (
                  <tr key={project.id} className="hover:bg-ink-50">
                    <td className="px-4 py-2">
                      <Link href={`/projects/${project.id}`} className="block">
                        <span className="text-ink-500">{clientNames.get(project.client_id) ?? '—'}</span>
                        <span className="mx-1.5 text-ink-300">·</span>
                        <span className="font-medium text-ink-900">{project.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-700">{TYPE_LABEL[project.type]}</td>
                    <td className="px-4 py-2 text-ink-700">
                      {project.folder_id ? folderNames.get(project.folder_id) ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-2 capitalize text-ink-700">{project.status}</td>
                    {profile.role === 'admin' ? (
                      <td className="px-4 py-2">
                        {burn ? (
                          <div className="ml-auto flex w-44 items-center gap-2">
                            <div className="flex-1">
                              <ProgressBar percent={burn.percentUsed} state={burn.state} />
                            </div>
                            <span className="nums w-14 text-right text-xs text-ink-700">
                              {Number.isFinite(burn.percentUsed)
                                ? `${formatHours(burn.percentUsed)}%`
                                : '—'}
                            </span>
                            <StateChip state={burn.state} />
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-ink-300">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-700">{label}</span>
      <Select name={name} defaultValue={value} className="min-w-36">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  )
}
