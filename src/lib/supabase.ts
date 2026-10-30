import { newId } from './id'
import { createClient } from '@supabase/supabase-js'
import type { EntryInput, Profile, DataSet, Invitation, Event, Role, Attachment, Coworker } from './types'
import { entryValues } from './time'
import { workflowValidationError, attachmentError } from './workflow'

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

function check(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === 'PGRST202' && /(?:submit|revise)_entry_v[456]|admin_set_profile_v[23]|he_coworkers/.test(error.message)) {
    throw new Error('Falta aplicar a atualização no Supabase. Execute ATUALIZAR-CADASTRO-SIMPLIFICADO.sql antes de usar o novo cadastro.')
  }
  throw new Error(error.message)
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
  const [profiles, entries, invitations, coworkers] = await Promise.all([
    allRows<Profile>('profiles'), allRows<import('./types').Entry>('overtime_entries'),
    role === 'admin' ? allRows<Invitation>('invitations') : Promise.resolve([]),
    role === 'maintainer' ? client().rpc('he_coworkers').then(({data,error}) => { check(error); return data as Coworker[] }) : Promise.resolve([]),
  ])
  return { profiles, entries, invitations, coworkers }
}

export async function submitEntry(input: EntryInput) {
  const invalid = workflowValidationError(input)
  if (invalid) throw new Error(invalid)
  const values = entryValues(input)
  const { error } = await client().rpc('submit_entry_v6', {
    p_request_id: input.request_id, p_activities: input.activities ?? [], p_helper_ids: input.helper_ids ?? [], p_attachments: input.attachments ?? [],
    p_work_date: input.work_date, p_normal_entry: values.normal_entry,
    p_point_exit: values.point_exit, p_final_exit: input.final_exit,
    p_is_holiday: values.is_holiday, p_overtime_only: input.overtime_only ?? false, p_location: values.location, p_glpi: values.glpi,
    p_overtime_start: input.overtime_start,
    p_final_exit_next_day: input.final_exit_next_day, p_note: input.note.trim(),
  })
  check(error)
}

export async function reviseEntry(id: string, input: EntryInput, legacy = false) {
  const invalid = workflowValidationError(input, legacy)
  if (invalid) throw new Error(invalid)
  const values = entryValues(input)
  const { error } = await client().rpc('revise_entry_v6', {
    p_activities: input.activities ?? [], p_helper_ids: input.helper_ids ?? [], p_attachments: input.attachments ?? [],
    p_entry_id: id, p_work_date: input.work_date, p_normal_entry: values.normal_entry,
    p_point_exit: values.point_exit, p_final_exit: input.final_exit,
    p_is_holiday: values.is_holiday, p_overtime_only: input.overtime_only ?? false, p_location: values.location, p_glpi: values.glpi,
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

export async function updateProfile(profile: Profile, name: string, role: Role, active: boolean, approve: boolean, exportReport: boolean, receiveReminders = false, delayHours = 48) {
  const { error } = await client().rpc('admin_set_profile_v3', {
    p_delay_hours: delayHours, p_target: profile.id, p_full_name: name, p_role: role, p_active: active,
    p_can_approve: approve, p_can_export: exportReport, p_receive_he_reminders: receiveReminders,
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
  const { data: original } = await client().from('overtime_entries').select('attachments').eq('id', id).maybeSingle()
  const { data, error } = await client().from('overtime_entries').delete().eq('id', id).select('id')
  check(error)
  if (!data?.length) throw new Error('Lançamento não encontrado ou acesso não autorizado. Atualize a página.')
  const paths = (original?.attachments as Attachment[] | undefined)?.map(a => a.path) ?? []
  if (paths.length) await client().storage.from('he-service-media').remove(paths)
}

const stagedFiles = new WeakMap<File, Attachment>()
const extension: Record<string,string> = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov' }
export async function uploadMedia(files: File[], requestId: string, workerId: string): Promise<Attachment[]> {
  const invalid = attachmentError(files)
  if (invalid) throw new Error(invalid)
  const uploaded: Attachment[] = []
  try {
    for (const file of files) {
      let media = stagedFiles.get(file)
      if (!media) {
        media = { path: `${workerId}/${requestId}/${newId()}.${extension[file.type]}`, name: file.name.slice(0,200), mime: file.type, size: file.size }
        stagedFiles.set(file, media)
      }
      const { error } = await client().storage.from('he-service-media').upload(media.path, file, {contentType:file.type, upsert:false})
      if (error && String((error as {statusCode?:string}).statusCode) !== '409') throw error
      uploaded.push(media)
    }
    return uploaded
  } catch (error) {
    await discardMedia(uploaded)
    throw error
  }
}
export async function discardMedia(items: Attachment[]) {
  if (items.length) await client().storage.from('he-service-media').remove(items.map(a => a.path))
}
export async function mediaUrl(path: string) {
  const { data, error } = await client().storage.from('he-service-media').createSignedUrl(path, 300)
  check(error)
  if (!data?.signedUrl) throw new Error('Não foi possível abrir o anexo.')
  return data.signedUrl
}
