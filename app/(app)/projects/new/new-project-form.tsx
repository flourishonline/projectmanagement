'use client'

import { useActionState, useState } from 'react'
import { createProject } from '@/app/actions/projects'
import { emptyState } from '@/app/actions/time'
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui'
import { ProjectTypeFields } from '../project-type-fields'
import type { ProjectType } from '@/lib/db-types'

export function NewProjectForm({
  clients,
  folders,
  today,
}: {
  clients: Array<{ id: string; name: string }>
  folders: Array<{ id: string; name: string }>
  today: string
}) {
  const [state, action, pending] = useActionState(createProject, emptyState)
  const [type, setType] = useState<ProjectType>('retainer')

  return (
    <form action={action} className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client">
            <Select name="client_id" required defaultValue="">
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Project name">
            <Input name="name" required placeholder="Monthly retainer" />
          </Field>

          <Field label="Folder" hint="Grouping for navigation only.">
            <Select name="folder_id" defaultValue="">
              <option value="">Ungrouped</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Default hourly rate (AUD)" hint="Optional. Only admins can see this.">
            <Input name="default_hourly_rate" type="number" step="0.01" min="0" />
          </Field>
        </div>

        <ProjectTypeFields type={type} onTypeChange={setType} today={today} />

        <Field label="Notes">
          <Textarea name="notes" placeholder="Anything worth remembering about the arrangement." />
        </Field>
      </Card>

      <ErrorText>{state.error}</ErrorText>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create project'}
      </Button>
    </form>
  )
}
