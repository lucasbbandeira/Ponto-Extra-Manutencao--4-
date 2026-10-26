import type { Entry } from './types.ts'
export type ComparisonRow = { label: string; approved: number; pending: number; services: number }
const sum = (entries: Entry[], status: Entry['status']) => entries.filter(e => e.status === status).reduce((n, e) => n + e.minutes, 0)
// Um GLPI pode reaparecer em dias diferentes; participantes nunca geram horas adicionais.
export function uniqueServices(entries: Entry[]): number {
  return new Set(entries.map(e => e.glpi?.trim() ? `${e.work_date}|${e.glpi.trim()}` : `registro|${e.id}`)).size
}
export function comparison(entries: Entry[], from: string, to: string, worker = '') {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) throw new Error('Escolha um intervalo de meses válido.')
  const months: string[] = []
  let [year, month] = from.split('-').map(Number)
  while (`${year}-${String(month).padStart(2, '0')}` <= to) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    if (months.length > 60) throw new Error('Selecione no máximo 60 meses por comparação.')
    if (++month > 12) { year++; month = 1 }
  }
  const selected = entries.filter(e => e.work_date.slice(0,7) >= from && e.work_date.slice(0,7) <= to && (!worker || e.worker_id === worker))
  const row = (label: string, own: Entry[]): ComparisonRow => ({ label, approved: sum(own, 'approved'), pending: sum(own, 'pending'), services: uniqueServices(own.filter(e => e.status === 'approved')) })
  const monthly = months.map(m => row(m, selected.filter(e => e.work_date.startsWith(m))))
  const locations = [...new Set(selected.map(e => e.location?.trim() || 'Não informado'))].map(label => row(label, selected.filter(e => (e.location?.trim() || 'Não informado') === label))).sort((a,b) => b.approved - a.approved || a.label.localeCompare(b.label, 'pt-BR'))
  const previous = monthly.at(-2)?.approved ?? 0, current = monthly.at(-1)?.approved ?? 0
  return { selected, monthly, locations, approved: sum(selected,'approved'), pending: sum(selected,'pending'), services: uniqueServices(selected.filter(e => e.status === 'approved')), change: previous ? (current-previous)/previous*100 : null }
}
