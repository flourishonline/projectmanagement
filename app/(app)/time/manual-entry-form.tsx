'use client'

import { useActionState, useState } from 'react'
import { saveManualEntry, emptyState } from '@/app/actions/time'
import { Button, Card, ErrorText, Input, Select } from '@/components/ui'
import type { ProjectOption } from './entry-table'

/**
 * Manual entry is a first-class way in, not a fallback. It takes a date, a
 * start time and a number of hours — the way people actually reconstruct a
 * block of work they forgot to time.
 */
export function ManualEntryForm({
  projects,
  people,
  today,
}: {
  projects: ProjectOption[]
  people?: Array<{ id: string; name: string }>
  today: string
}) {
  const [state, action, pending] = useActionState(saveManualEntry, emptyState)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Add time manually
      </Button>
    )
  }

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-6">
          <label className="sm:col-span-2">
            <span className="text-xs font-medium text-ink-700">Project</span>
            <Select name="project_id" required defaultValue="">
              <option value="" disabled>
                Choose a project…
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className="text-xs font-medium text-ink-700">Date</span>
            <Input name="entry_date" type="date" defaultValue={today} required />
          </label>

          <label>
            <span className="text-xs font-medium text-ink-700">Start</span>
            <Input name="start_time" type="time" defaultValue="09:00" required />
          </label>

          <label>
            <span className="text-xs font-medium text-ink-700">Hours</span>
            <Input name="hours" type="number" step="0.25" min="0.25" placeholder="1.50" required />
          </label>

          <label className="flex items-end gap-2 pb-1.5 text-sm text-ink-700">
            <input
              type="checkbox"
              name="billable"
              defaultChecked
              className="size-4 rounded border-ink-300"
            />
            Billable
          </label>
        </div>

        {people && people.length > 0 ? (
          <label className="block max-w-xs">
            <span className="text-xs font-medium text-ink-700">On behalf of</span>
            <Select name="user_id" defaultValue="">
              <option value="">Me</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Description</span>
          <Input name="description" placeholder="What was the time spent on?" />
        </label>

        <ErrorText>{state.error}</ErrorText>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Log time'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          {state.ok ? <span className="text-sm text-healthy">Logged</span> : null}
        </div>
      </form>
    </Card>
  )
}
