import type { Entry, EntryInput } from './types'

export function timeMinutes(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

// Os lançamentos anteriores não tinham início separado: preservar a referência original.
export function overtimeStart(entry: Pick<Entry, 'point_exit' | 'overtime_start'>): string {
  return (entry.overtime_start || entry.point_exit).slice(0, 5)
}

export function overtimeMinutes(overtimeStart: string, finalExit: string, nextDay: boolean): number {
  return timeMinutes(finalExit) + (nextDay ? 1440 : 0) - timeMinutes(overtimeStart)
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export function validOvertime(overtimeStart: string, finalExit: string, nextDay: boolean): boolean {
  const minutes = overtimeMinutes(overtimeStart, finalExit, nextDay)
  return minutes >= 1 && minutes <= 960
}

export function entryValidationError(input: EntryInput): string | null {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.work_date) ? new Date(`${input.work_date}T12:00:00Z`) : null
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.work_date) return 'Informe uma data de trabalho válida.'
  if (![input.normal_entry, input.point_exit, input.overtime_start, input.final_exit].every(t => Number.isFinite(timeMinutes(t)))) return 'Preencha todos os horários: entrada normal, saída normal, início e término da hora extra.'
  if (!input.note.trim()) return 'Preencha a descrição do serviço realizado.'
  if (input.note.trim().length > 1000) return 'A descrição pode ter até 1.000 caracteres.'
  if (typeof input.final_exit_next_day !== 'boolean') return 'Confira se o término ocorreu no dia seguinte.'
  if (timeMinutes(input.overtime_start) < timeMinutes(input.point_exit)) return 'O início da hora extra deve ser igual ou posterior à saída normal.'
  if (!validOvertime(input.overtime_start, input.final_exit, input.final_exit_next_day)) return 'Confira os horários. A extra precisa ser maior que zero e não pode exceder 16 horas. Se o término foi no dia seguinte, marque essa opção.'
  return null
}

export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
}

export function monthName(month: number): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2024, month - 1, 1))
}
