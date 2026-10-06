import { createClient } from '@supabase/supabase-js'
import type { EntryInput, Profile, DataSet, Invitation, Event, Role } from './types'
import { entryValidationError } from './time'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configured = Boolean(url?.startsWith('https://') && key && !url.includes('SEU-PROJETO'))
export const supabase = configured ? createClient(url!, key!, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
}) : null

function client() {
  if (!supabase) throw new Error('Configure as variáveis do Supabase antes de usar o sistema.')
  return supabase
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

// Supabase limita respostas a 1.000 linhas por padrão. Paginar preserva relatórios mensais completos.
async function allRows<T>(table: 'profiles' | 'overtime_entries' | 'invitations'): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await client().from(table).select('*').order('id').range(from, from + 499)
    check(error)
    rows.push(...(data as T[]))
    if (!data || data.length < 500) return rows
  }
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await client().from('profiles').select('*').eq('id', id).maybeSingle()
  check(error)
  return data as Profile | null
}

export async function loadData(role: Role): Promise<DataSet> {
  const [profiles, entries, invitations] = await Promise.all([
    allRows<Profile>('profiles'), allRows<import('./types').Entry>('overtime_entries'),
    role === 'admin' ? allRows<Invitation>('invitations') : Promise.resolve([]),
  ])
  return { profiles, entries, invitations }
}

export async function submitEntry(input: EntryInput) {
  const invalid = entryValidationError(input)
  if (invalid) throw new Error(invalid)
  const { error } = await client().rpc('submit_entry_v2', {
    p_work_date: input.work_date, p_normal_entry: input.normal_entry,
    p_point_exit: input.point_exit, p_final_exit: input.final_exit,
    p_overtime_start: input.overtime_start,
    p_final_exit_next_day: input.final_exit_next_day, p_note: input.note.trim(),
  })
  check(error)
}

export async function reviseEntry(id: string, input: EntryInput) {
  const invalid = entryValidationError(input)
  if (invalid) throw new Error(invalid)
  const { error } = await client().rpc('revise_entry_v2', {
    p_entry_id: id, p_work_date: input.work_date, p_normal_entry: input.normal_entry,
    p_point_exit: input.point_exit, p_final_exit: input.final_exit,
    p_overtime_start: input.overtime_start,
    p_final_exit_next_day: input.final_exit_next_day, p_note: input.note.trim(),
  })
  check(error)
}

export async function reviewEntry(id: string, decision: 'approved' | 'rejected', reason?: string) {
  const { error } = await client().rpc('review_entry', {
    p_entry_id: id, p_decision: decision, p_reason: reason || null,
  })
  check(error)
}

export async function createInvitation(email: string, name: string, role: Role, adminId: string) {
  const { error } = await client().from('invitations').insert({
    email: email.trim().toLowerCase(), full_name: name.trim(), role, invited_by: adminId,
  })
  check(error)
}

export async function changeInvitation(id: string, status: 'pending' | 'revoked') {
  const { error } = await client().from('invitations').update({ status }).eq('id', id)
  check(error)
}

export async function updateProfile(profile: Profile, name: string, role: Role, active: boolean, approve: boolean, exportReport: boolean) {
  const { error } = await client().rpc('admin_set_profile', {
    p_target: profile.id, p_full_name: name, p_role: role, p_active: active,
    p_can_approve: approve, p_can_export: exportReport,
  })
  check(error)
}

export async function reviewProfile(id: string, approve: boolean) {
  const { error } = await client().rpc('admin_review_profile', {
    p_target: id, p_approve: approve,
  })
  check(error)
}

export async function deleteProfile(id: string) {
  const { error } = await client().rpc('admin_delete_profile', { p_target: id })
  check(error)
}

export async function getHistory(id: string): Promise<Event[]> {
  const { data, error } = await client().from('entry_events').select('*').eq('entry_id', id).order('created_at', { ascending: false })
  check(error)
  return data as Event[]
}

export async function deleteEntry(id: string) {
  const { data, error } = await client().from('overtime_entries').delete().eq('id', id).select('id')
  check(error)
  if (!data?.length) throw new Error('Lançamento não encontrado ou acesso não autorizado. Atualize a página.')
}
