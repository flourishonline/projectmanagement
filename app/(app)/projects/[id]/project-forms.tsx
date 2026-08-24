'use client'

import { useActionState, useState } from 'react'
import {
  addBundleTopUp,
  saveProjectConfig,
  setProjectAssignment,
  updateProject,
} from '@/app/actions/projects'
import { emptyState } from '@/app/actions/time'
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui'
import { ProjectTypeFields, type TypeDefaults } from '../project-type-fields'
import type { Project, ProjectType } from '@/lib/db-types'

export function EditProjectForm({
  project,
  clients,
  folders,
  rate,
}: {
  project: Project
  clients: Array<{ id: string; name: string }>
  folders: Array<{ id: string; name: string }>
  rate: number | null
}) {
  const [state, action, pending] = useActionState(updateProject, emptyState)
  const [confirmArchive, setConfirmArchive] = useState(false)

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink-900">Project details</h2>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={project.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client">
            <Select name="client_id" defaultValue={project.client_id}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project name">
            <Input name="name" defaultValue={project.name} required />
          </Field>
          <Field label="Folder">
            <Select name="folder_id" defaultValue={project.folder_id ?? ''}>
              <option value="">Ungrouped</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select
              name="status"
              defaultValue={project.status}
              onChange={(event) => setConfirmArchive(event.target.value === 'archived')}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="complete">Complete</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Field label="Default hourly rate (AUD)">
            <Input
              name="default_hourly_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={rate ?? ''}
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea name="notes" defaultValue={project.notes ?? ''} />
        </Field>

        {confirmArchive ? (
          <p className="rounded border border-warning/50 bg-warning-bg px-2.5 py-1.5 text-sm text-ink-900">
            Archiving hides this project from the dashboard and the timer. Existing time is kept.
          </p>
        ) : null}

        <ErrorText>{state.error}</ErrorText>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {state.ok ? <span className="ml-2 text-sm text-healthy">Saved</span> : null}
      </form>
    </Card>
  )
}

export function ConfigForm({
  projectId,
  type,
  defaults,
  today,
}: {
  projectId: string
  type: ProjectType
  defaults: TypeDefaults
  today: string
}) {
  const [state, action, pending] = useActionState(saveProjectConfig, emptyState)

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink-900">Commercial arrangement</h2>
      <form action={action} className="space-y-3">
        <input type="hidden" name="project_id" value={projectId} />
        <ProjectTypeFields type={type} defaults={defaults} lockType today={today} />
        <ErrorText>{state.error}</ErrorText>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save arrangement'}
        </Button>
        {state.ok ? <span className="ml-2 text-sm text-healthy">Saved</span> : null}
      </form>
    </Card>
  )
}

export function TopUpForm({ projectId, today }: { projectId: string; today: string }) {
  const [state, action, pending] = useActionState(addBundleTopUp, emptyState)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Add a top-up
      </Button>
    )
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink-900">Top up this bundle</h2>
      <p className="text-xs text-ink-500">
        A top-up is recorded as a new purchase against the same project, so the history of what was
        bought and when stays intact.
      </p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours purchased">
            <Input name="purchased_hours" type="number" step="0.25" min="0.25" required />
          </Field>
          <Field label="Purchase date">
            <Input name="purchase_date" type="date" required defaultValue={today} />
          </Field>
          <Field label="Expiry date">
            <Input name="expiry_date" type="date" />
          </Field>
          <Field label="Low balance threshold (%)">
            <Input name="low_balance_threshold_pct" type="number" min="1" max="100" defaultValue={75} />
          </Field>
        </div>
        <Field label="Note">
          <Input name="note" placeholder="e.g. approved by email 14 Aug" />
        </Field>
        <ErrorText>{state.error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Record top-up'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

export function AssignmentList({
  projectId,
  people,
}: {
  projectId: string
  people: Array<{ id: string; name: string; assigned: boolean }>
}) {
  const [state, action] = useActionState(setProjectAssignment, emptyState)

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink-900">Who can see this project</h2>
      <p className="mt-1 text-xs text-ink-500">
        Members see only the projects they are assigned to, and never the figures above.
      </p>
      <ul className="mt-3 space-y-1.5">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-2 text-sm">
            <form action={action} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="user_id" value={person.id} />
              <input type="hidden" name="assign" value={String(!person.assigned)} />
              <span className="flex-1 text-ink-700">{person.name}</span>
              <Button type="submit" variant={person.assigned ? 'ghost' : 'secondary'}>
                {person.assigned ? 'Remove' : 'Assign'}
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <ErrorText>{state.error}</ErrorText>
    </Card>
  )
}
