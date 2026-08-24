import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TimeEntry } from '@/lib/db-types'
import { safeEndTime } from '@/lib/timer'

export interface RunningEntry {
  id: string
  project_id: string
  task_id: string | null
  started_at: string
  description: string | null
  billable: boolean
  projectName: string
  clientName: string
}

/** The one entry this user has running, if any. */
export async function getRunningEntry(
  supabase: SupabaseClient,
  userId: string,
): Promise<RunningEntry | null> {
  const { data } = await supabase
    .from('time_entries')
    .select('id, project_id, task_id, started_at, description, billable, projects(name, clients(name))')
    .eq('user_id', userId)
    .is('ended_at', null)
    .is('deleted_at', null)
    .maybeSingle<
      Pick<TimeEntry, 'id' | 'project_id' | 'task_id' | 'started_at' | 'description' | 'billable'> & {
        projects: { name: string; clients: { name: string } | null } | null
      }
    >()

  if (!data) return null

  return {
    id: data.id,
    project_id: data.project_id,
    task_id: data.task_id,
    started_at: data.started_at,
    description: data.description,
    billable: data.billable,
    projectName: data.projects?.name ?? 'Unknown project',
    clientName: data.projects?.clients?.name ?? '',
  }
}

/** Ends whatever this user has running. Returns the id it stopped, if any. */
export async function stopRunningEntry(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: running } = await supabase
    .from('time_entries')
    .select('id, started_at')
    .eq('user_id', userId)
    .is('ended_at', null)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; started_at: string }>()

  if (!running) return null

  const { error } = await supabase
    .from('time_entries')
    .update({ ended_at: safeEndTime(running.started_at) })
    .eq('id', running.id)

  if (error) throw error
  return running.id
}
