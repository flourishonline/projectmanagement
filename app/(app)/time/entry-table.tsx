'use client'

import { useActionState, useState } from 'react'
import { deleteEntry, updateEntry, emptyState } from '@/app/actions/time'
import { formatDurationHours } from '@/lib/calc'
import { brisbaneTimeInput, formatBrisbaneTime, formatShortDate, toBrisbaneDate } from '@/lib/dates'
import { Button, Card, ErrorText, Input, Select } from '@/components/ui'
import type { TimeEntry } from '@/lib/db-types'

export interface EntryRow extends TimeEntry {
  personName: string
  projectName: string
  clientName: string
}

export interface ProjectOption {
  id: string
  label: string
}

export function EntryTable({
  entries,
  projects,
  currentUserId,
  showPerson = false,
  canEdit,
}: {
  entries: EntryRow[]
  projects: ProjectOption[]
  currentUserId: string
  showPerson?: boolean
  /** Undefined means "own entries only". True means admin. */
  canEdit?: true
}) {
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            {showPerson ? <th className="px-3 py-2 font-medium">Who</th> : null}
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-200">
          {entries.map((entry) => {
            const mine = entry.user_id === currentUserId
            const editable = canEdit === true || mine
            const isEditing = editing === entry.id

            if (isEditing) {
              return (
                <tr key={entry.id}>
                  <td colSpan={showPerson ? 6 : 5} className="bg-ink-50 px-3 py-3">
                    <EditRow
                      entry={entry}
                      projects={projects}
                      onDone={() => setEditing(null)}
                    />
                  </td>
                </tr>
              )
            }

            const started = new Date(entry.started_at)
            const running = entry.ended_at === null

            return (
              <tr key={entry.id} className="hover:bg-ink-50">
                <td className="whitespace-nowrap px-3 py-2 text-ink-700">
                  <span className="nums">{formatShortDate(toBrisbaneDate(started))}</span>
                  <span className="nums ml-2 text-ink-500">{formatBrisbaneTime(started)}</span>
                </td>
                {showPerson ? <td className="px-3 py-2 text-ink-700">{entry.personName}</td> : null}
                <td className="px-3 py-2">
                  <span className="text-ink-500">{entry.clientName}</span>
                  {entry.clientName ? <span className="mx-1.5 text-ink-300">·</span> : null}
                  <span className="text-ink-900">{entry.projectName}</span>
                </td>
                <td className="px-3 py-2 text-ink-700">
                  {entry.description || <span className="text-ink-300">—</span>}
                  {!entry.billable ? (
                    <span className="ml-2 rounded border border-ink-200 px-1 py-0.5 text-[10px] uppercase text-ink-500">
                      non-billable
                    </span>
                  ) : null}
                  {entry.edited_at ? (
                    <span className="ml-2 text-[10px] uppercase text-ink-300">edited</span>
                  ) : null}
                </td>
                <td className="nums whitespace-nowrap px-3 py-2 text-right font-medium text-ink-900">
                  {running ? (
                    <span className="text-healthy">running</span>
                  ) : (
                    formatDurationHours(entry.duration_seconds ?? 0)
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable && !running ? (
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" onClick={() => setEditing(entry.id)}>
                        Edit
                      </Button>
                      <DeleteButton entryId={entry.id} />
                    </div>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function EditRow({
  entry,
  projects,
  onDone,
}: {
  entry: EntryRow
  projects: ProjectOption[]
  onDone: () => void
}) {
  const [state, action, pending] = useActionState(updateEntry, emptyState)
  const started = new Date(entry.started_at)

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={entry.id} />
      <div className="grid gap-2 sm:grid-cols-6">
        <label className="sm:col-span-2">
          <span className="text-xs text-ink-500">Project</span>
          <Select name="project_id" defaultValue={entry.project_id}>
            {projects.length === 0 ? (
              <option value={entry.project_id}>{entry.projectName}</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))
            )}
          </Select>
        </label>
        <label>
          <span className="text-xs text-ink-500">Date</span>
          <Input name="entry_date" type="date" defaultValue={toBrisbaneDate(started)} required />
        </label>
        <label>
          <span className="text-xs text-ink-500">Start</span>
          <Input name="start_time" type="time" defaultValue={brisbaneTimeInput(started)} required />
        </label>
        <label>
          <span className="text-xs text-ink-500">Hours</span>
          <Input
            name="hours"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={formatDurationHours(entry.duration_seconds ?? 0)}
            required
          />
        </label>
        <label className="flex items-end gap-2 pb-1.5 text-sm text-ink-700">
          <input
            type="checkbox"
            name="billable"
            defaultChecked={entry.billable}
            className="size-4 rounded border-ink-300"
          />
          Billable
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-ink-500">Description</span>
        <Input name="description" defaultValue={entry.description ?? ''} />
      </label>

      <ErrorText>{state.error}</ErrorText>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function DeleteButton({ entryId }: { entryId: string }) {
  const [state, action, pending] = useActionState(deleteEntry, emptyState)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    )
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={entryId} />
      <span className="text-xs text-ink-500">Sure?</span>
      <Button type="submit" variant="danger" disabled={pending}>
        Delete
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  )
}
