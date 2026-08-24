'use client'

import { useActionState, useState } from 'react'
import { saveClient } from '@/app/actions/projects'
import { emptyState } from '@/app/actions/time'
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui'
import type { Client } from '@/lib/db-types'

export function NewClientForm() {
  const [state, action, pending] = useActionState(saveClient, emptyState)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        New client
      </Button>
    )
  }

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <Field label="Client name">
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Notes">
          <Textarea name="notes" />
        </Field>
        <ErrorText>{state.error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Add client'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

export function ClientRow({ client, projectCount }: { client: Client; projectCount: number }) {
  const [state, action, pending] = useActionState(saveClient, emptyState)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="flex-1">
          <span className="font-medium text-ink-900">{client.name}</span>
          {client.status === 'archived' ? (
            <span className="ml-2 rounded border border-ink-200 px-1 py-0.5 text-[10px] uppercase text-ink-500">
              archived
            </span>
          ) : null}
          {client.notes ? <span className="ml-2 text-ink-500">{client.notes}</span> : null}
        </span>
        <span className="nums text-ink-500">
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </span>
        <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </li>
    )
  }

  return (
    <li className="bg-ink-50 px-4 py-3">
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={client.id} />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="sm:col-span-2">
            <span className="text-xs text-ink-500">Name</span>
            <Input name="name" defaultValue={client.name} required />
          </label>
          <label>
            <span className="text-xs text-ink-500">Status</span>
            <Select name="status" defaultValue={client.status}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-ink-500">Notes</span>
          <Input name="notes" defaultValue={client.notes ?? ''} />
        </label>
        <ErrorText>{state.error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  )
}
