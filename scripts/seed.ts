/**
 * Seeds clients, folders and projects from a CSV.
 *
 *   npm run seed -- data/launch.csv
 *
 * Re-runnable: projects are matched on client name plus project name, so
 * running it twice updates rather than duplicates. Nothing is ever deleted.
 *
 * Opening balances
 * ----------------
 * `opening_used_hours` is how many hours a client had already used at launch —
 * the number carried over from ClickUp or Toggl. It is written as a single
 * time entry against a `migration@<domain>` account rather than quietly shaved
 * off the allocation, so the dashboard maths stays honest and the adjustment
 * is visible in the project's own time log. That account exists only to hold
 * these entries; it can never sign in, because it has no Google identity.
 *
 * Columns (only `client`, `project` and `type` are required):
 *   client, project, folder, type, status, notes, hourly_rate,
 *   monthly_hours, billing_day, rollover, rollover_cap, start_date, end_date,
 *   purchased_hours, purchase_date, expiry_date, low_balance_threshold_pct,
 *   quoted_hours, fixed_fee, due_date,
 *   opening_used_hours, opening_date
 */

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** The service-role client, untyped against the schema — the seed writes raw rows. */
type SeedClient = SupabaseClient<any, any, any, any, any>
import { parseCsvRecords } from '../src/lib/csv.ts'

const OPENING_MARKER = 'Opening balance carried forward at launch'

function env(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Set it in .env.local or the shell before running the seed.`)
    process.exit(1)
  }
  return value
}

function loadDotEnvLocal(): void {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (match && !process.env[match[1]!]) {
        process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // No .env.local — rely on the shell environment.
  }
}

function num(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: string | undefined): boolean {
  return ['true', 'yes', 'y', '1', 'on'].includes((value ?? '').toLowerCase())
}

function date(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

async function main() {
  loadDotEnvLocal()

  const path = process.argv[2]
  if (!path) {
    console.error('Usage: npm run seed -- path/to/projects.csv')
    process.exit(1)
  }

  const domain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? 'flourishonline.com.au'
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const records = parseCsvRecords(readFileSync(path, 'utf8'))
  if (records.length === 0) {
    console.error('That CSV has no rows.')
    process.exit(1)
  }

  console.log(`Seeding ${records.length} project rows from ${path}\n`)

  // --- folders -------------------------------------------------------------
  const folderNames = [...new Set(records.map((row) => row.folder).filter(Boolean))] as string[]
  const folderIds = new Map<string, string>()

  for (const [index, name] of folderNames.entries()) {
    const { data: existing } = await supabase
      .from('folders')
      .select('id')
      .eq('name', name)
      .maybeSingle()

    if (existing) {
      folderIds.set(name, existing.id)
      continue
    }

    const { data, error } = await supabase
      .from('folders')
      .insert({ name, sort_order: (index + 1) * 10 })
      .select('id')
      .single()

    if (error) throw error
    folderIds.set(name, data.id)
    console.log(`  + folder ${name}`)
  }

  // --- clients -------------------------------------------------------------
  const clientNames = [...new Set(records.map((row) => row.client).filter(Boolean))] as string[]
  const clientIds = new Map<string, string>()

  for (const name of clientNames) {
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('name', name)
      .maybeSingle()

    if (existing) {
      clientIds.set(name, existing.id)
      continue
    }

    const { data, error } = await supabase.from('clients').insert({ name }).select('id').single()
    if (error) throw error
    clientIds.set(name, data.id)
    console.log(`  + client ${name}`)
  }

  // --- the account that carries opening balances ---------------------------
  const needsOpening = records.some((row) => (num(row.opening_used_hours) ?? 0) > 0)
  const migrationUserId = needsOpening ? await ensureMigrationUser(supabase, domain) : null

  // --- projects ------------------------------------------------------------
  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of records) {
    const clientId = clientIds.get(row.client ?? '')
    if (!clientId || !row.project) {
      console.warn(`  ! skipped a row with no client or project name`)
      continue
    }

    const type = row.type as 'retainer' | 'bundle' | 'standalone'
    if (!['retainer', 'bundle', 'standalone'].includes(type)) {
      console.warn(`  ! ${row.client} / ${row.project}: unknown type "${row.type}", skipped`)
      continue
    }

    // A project seeded without the numbers that define it would show on the
    // dashboard as a confident zero, which is worse than not being there.
    const missing = missingFields(type, row)
    if (missing.length > 0) {
      console.warn(`  ! ${row.client} / ${row.project}: missing ${missing.join(', ')} — skipped`)
      skipped += 1
      continue
    }

    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('client_id', clientId)
      .eq('name', row.project)
      .maybeSingle()

    const payload = {
      client_id: clientId,
      name: row.project,
      type,
      status: row.status || 'active',
      folder_id: row.folder ? folderIds.get(row.folder) ?? null : null,
      notes: row.notes || null,
    }

    let projectId: string
    if (existing) {
      const { error } = await supabase.from('projects').update(payload).eq('id', existing.id)
      if (error) throw error
      projectId = existing.id
      updated += 1
    } else {
      const { data, error } = await supabase.from('projects').insert(payload).select('id').single()
      if (error) throw error
      projectId = data.id
      created += 1
    }

    const rate = num(row.hourly_rate)
    if (rate !== null) {
      await supabase.from('project_rates').upsert({
        project_id: projectId,
        default_hourly_rate: rate,
        updated_at: new Date().toISOString(),
      })
    }

    if (type === 'retainer') {
      const rollover = bool(row.rollover)
      const { error } = await supabase.from('retainer_configs').upsert({
        project_id: projectId,
        monthly_hours: num(row.monthly_hours) ?? 0,
        billing_day_of_month: num(row.billing_day) ?? 1,
        rollover_enabled: rollover,
        rollover_cap_hours: rollover ? num(row.rollover_cap) : null,
        start_date: date(row.start_date) ?? new Date().toISOString().slice(0, 10),
        end_date: date(row.end_date),
      })
      if (error) throw error
    }

    if (type === 'bundle') {
      const { data: purchases } = await supabase
        .from('bundle_configs')
        .select('id')
        .eq('project_id', projectId)
        .limit(1)

      // Top-ups are rows of their own, so an existing bundle is left alone
      // rather than having its purchase history rewritten on every re-run.
      if (!purchases || purchases.length === 0) {
        const { error } = await supabase.from('bundle_configs').insert({
          project_id: projectId,
          purchased_hours: num(row.purchased_hours) ?? 0,
          purchase_date: date(row.purchase_date) ?? new Date().toISOString().slice(0, 10),
          expiry_date: date(row.expiry_date),
          low_balance_threshold_pct: num(row.low_balance_threshold_pct) ?? 75,
          note: 'Seeded at launch',
        })
        if (error) throw error
      }
    }

    if (type === 'standalone') {
      const { error } = await supabase.from('standalone_configs').upsert({
        project_id: projectId,
        quoted_hours: num(row.quoted_hours) ?? 0,
        fixed_fee: num(row.fixed_fee) ?? 0,
        start_date: date(row.start_date) ?? new Date().toISOString().slice(0, 10),
        due_date: date(row.due_date),
      })
      if (error) throw error
    }

    const openingHours = num(row.opening_used_hours) ?? 0
    if (openingHours > 0 && migrationUserId) {
      await writeOpeningBalance(supabase, {
        projectId,
        userId: migrationUserId,
        hours: openingHours,
        onDate: date(row.opening_date) ?? date(row.start_date) ?? date(row.purchase_date),
      })
    }
  }

  console.log(
    `\nDone. ${created} projects created, ${updated} updated${skipped > 0 ? `, ${skipped} skipped` : ''}.`,
  )
  if (skipped > 0) {
    console.log('Fill in the missing columns for the skipped rows and run the seed again.')
  }
  if (needsOpening) {
    console.log(
      `Opening balances were recorded against migration@${domain}. They appear in each\nproject's time log, so the adjustment is always visible rather than assumed.`,
    )
  }
}

/** Which required columns a row is missing, given its type. */
function missingFields(type: string, row: Record<string, string>): string[] {
  const missing: string[] = []

  if (type === 'retainer') {
    if (!((num(row.monthly_hours) ?? 0) > 0)) missing.push('monthly_hours')
    if (!date(row.start_date)) missing.push('start_date')
  }

  if (type === 'bundle') {
    if (!((num(row.purchased_hours) ?? 0) > 0)) missing.push('purchased_hours')
    if (!date(row.purchase_date)) missing.push('purchase_date')
  }

  if (type === 'standalone') {
    if (!((num(row.quoted_hours) ?? 0) > 0)) missing.push('quoted_hours')
    if (num(row.fixed_fee) === null) missing.push('fixed_fee')
    if (!date(row.start_date)) missing.push('start_date')
  }

  return missing
}

async function ensureMigrationUser(
  supabase: SeedClient,
  domain: string,
): Promise<string> {
  const email = `migration@${domain}`

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle<{ id: string }>()

  if (profile) return profile.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: 'Opening balances (migration)' },
  })

  if (error || !data.user) {
    throw new Error(`Could not create ${email}: ${error?.message ?? 'unknown error'}`)
  }

  console.log(`  + ${email} — holds opening balance entries only`)
  return data.user.id
}

async function writeOpeningBalance(
  supabase: SeedClient,
  input: { projectId: string; userId: string; hours: number; onDate: string | null },
): Promise<void> {
  // Replace rather than accumulate, so re-running the seed cannot double-count.
  await supabase
    .from('time_entries')
    .delete()
    .eq('project_id', input.projectId)
    .eq('user_id', input.userId)
    .eq('description', OPENING_MARKER)

  const day = input.onDate ?? new Date().toISOString().slice(0, 10)
  const startedAt = new Date(`${day}T09:00:00+10:00`)
  const endedAt = new Date(startedAt.getTime() + Math.round(input.hours * 3600) * 1000)

  const { error } = await supabase.from('time_entries').insert({
    user_id: input.userId,
    project_id: input.projectId,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    description: OPENING_MARKER,
    billable: true,
  })

  if (error) throw error
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
