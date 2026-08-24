/**
 * Hand-maintained mirror of the Supabase schema.
 *
 * Regenerate-from-database is available (`supabase gen types typescript`) but
 * this file is small enough to keep by hand and gives clearer names at the
 * call site. If a migration changes a table, change it here in the same commit.
 */

export type UserRole = 'admin' | 'member'
export type ClientStatus = 'active' | 'archived'
export type ProjectType = 'retainer' | 'bundle' | 'standalone'
export type ProjectStatus = 'active' | 'paused' | 'complete' | 'archived'
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole
  active: boolean
  created_at: string
}

export interface Folder {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export interface Client {
  id: string
  name: string
  status: ClientStatus
  notes: string | null
  created_at: string
}

export interface Project {
  id: string
  client_id: string
  folder_id: string | null
  name: string
  type: ProjectType
  status: ProjectStatus
  notes: string | null
  created_at: string
  archived_at: string | null
}

export interface ProjectRate {
  project_id: string
  default_hourly_rate: number
  updated_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  created_at: string
}

export interface RetainerConfig {
  project_id: string
  monthly_hours: number
  billing_day_of_month: number
  rollover_enabled: boolean
  rollover_cap_hours: number | null
  start_date: string
  end_date: string | null
  created_at: string
}

export interface RetainerPeriod {
  id: string
  project_id: string
  period_start: string
  period_end: string
  allocated_hours: number
  rolled_in_hours: number
  closed: boolean
  closed_at: string | null
  created_at: string
}

export interface BundleConfig {
  id: string
  project_id: string
  purchased_hours: number
  purchase_date: string
  expiry_date: string | null
  low_balance_threshold_pct: number
  note: string | null
  created_at: string
}

export interface StandaloneConfig {
  project_id: string
  quoted_hours: number
  fixed_fee: number
  start_date: string
  due_date: string | null
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  estimate_hours: number | null
  sort_order: number
  created_at: string
  completed_at: string | null
}

export interface TimeEntry {
  id: string
  user_id: string
  project_id: string
  task_id: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  description: string | null
  billable: boolean
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  deleted_by: string | null
}
