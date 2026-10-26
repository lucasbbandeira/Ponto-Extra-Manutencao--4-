import type { Entry, EntryInput, ServiceActivity, Attachment } from './types.ts'
import { entryValidationError, timeMinutes, overtimeMinutes } from './time.ts'

export const MAX_ACTIVITIES = 20
export const MAX_ATTACHMENTS = 5
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']

// Offsets explícitos evitam ambiguidades em serviços que atravessam meia-noite.
export function activityOffset(time: string, nextDay: boolean): number {
  return timeMinutes(time) + (nextDay ? 1440 : 0)
}
export function activityLabel(activity: ServiceActivity): string {
  return `${activity.start}${activity.start_next_day ? ' (+1 dia)' : ''}–${activity.end}${activity.end_next_day ? ' (+1 dia)' : ''} — ${activity.description.trim()}`
}
export function detailedDescription(entry: Pick<Entry, 'note' | 'activities'>): string {
  return [entry.note, ...(entry.activities ?? []).map(activityLabel)].filter(Boolean).join('\n')
}
export function activityValidationError(input: EntryInput): string | null {
  const rows = input.activities ?? []
  if (!rows.length) return 'Adicione pelo menos uma atividade explicando o período da hora extra.'
  if (rows.length > MAX_ACTIVITIES) return `Use no máximo ${MAX_ACTIVITIES} atividades.`
  let cursor = timeMinutes(input.overtime_start)
  const end = timeMinutes(input.final_exit) + (input.final_exit_next_day ? 1440 : 0)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (typeof row.start_next_day !== 'boolean' || typeof row.end_next_day !== 'boolean') return `Confira o dia da atividade ${i + 1}.`
    const start = activityOffset(row.start, row.start_next_day), finish = activityOffset(row.end, row.end_next_day)
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return `Confira o início e o fim da atividade ${i + 1}.`
    if (start !== cursor) return `A atividade ${i + 1} deve começar onde a anterior terminou, sem lacunas ou sobreposição.`
    if (finish > end || start < timeMinutes(input.overtime_start)) return `A atividade ${i + 1} precisa estar dentro da hora extra.`
    if (!row.description.trim() || row.description.trim().length > 300) return `Descreva a atividade ${i + 1} em até 300 caracteres.`
    cursor = finish
  }
  if (cursor !== end) return 'As atividades devem explicar todo o período, até o término da hora extra.'
  return null
}
export function workflowValidationError(input: EntryInput, legacy = false): string | null {
  const base = entryValidationError(input)
  if (base) return base
  if (!legacy) {
    if (!input.location?.trim()) return 'Informe a localização do serviço.'
    if (!input.glpi?.trim()) return 'Informe o GLPI do serviço.'
    const detail = activityValidationError(input)
    if (detail) return detail
  }
  if (new Set(input.helper_ids ?? []).size !== (input.helper_ids ?? []).length) return 'Selecione cada participante apenas uma vez.'
  return null
}
export function attachmentError(files: Pick<File, 'type' | 'size' | 'name'>[], existing = 0): string | null {
  if (files.length + existing > MAX_ATTACHMENTS) return `Anexe no máximo ${MAX_ATTACHMENTS} arquivos por lançamento.`
  for (const file of files) {
    if (!MEDIA_TYPES.includes(file.type)) return `Formato não aceito: ${file.name}. Use JPG, PNG, WEBP, GIF, MP4, WEBM ou MOV.`
    if (file.size < 1 || file.size > MAX_FILE_BYTES) return `${file.name}: cada arquivo deve ter até 20 MB e não pode estar vazio.`
  }
  return null
}
export function attachmentIsImage(attachment: Pick<Attachment, 'mime'>) { return attachment.mime.startsWith('image/') }
export function activityTotal(input: EntryInput) { return overtimeMinutes(input.overtime_start, input.final_exit, input.final_exit_next_day) }
