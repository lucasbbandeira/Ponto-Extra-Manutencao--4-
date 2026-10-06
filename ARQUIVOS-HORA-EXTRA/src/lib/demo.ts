import { entryValidationError, formatDate, localToday, overtimeMinutes } from './time'
import type { DataSet, Entry, EntryInput, Event, Invitation, Profile, Role } from './types'

const now = new Date().toISOString()
const today = localToday()
const daysAgo = (days: number) => {
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const people: [string, string, Role][] = [
  ['maycon', 'Maycon', 'maintainer'], ['paulo', 'Paulo', 'maintainer'],
  ['elciney', 'Elciney', 'maintainer'], ['mathus', 'Mathus', 'maintainer'],
  ['marcelo', 'Marcelo Bogo', 'supervisor'], ['admin', 'Administrador', 'admin'],
]

export const demoProfiles: Profile[] = people.map(([id, name, role]) => ({
  id, full_name: name, email: `${id}@exemplo.com`, role, active: true,
  approval_status: 'approved',
  can_approve: role !== 'maintainer', can_export: role !== 'maintainer',
  created_at: now, updated_at: now,
}))

let entries: Entry[] = [
  record('01', 'maycon', 0, '17:10', '19:45', 'pending', 'Acompanhamento de máquina'),
  record('02', 'paulo', 0, '18:00', '20:20', 'pending', 'Reparo no setor de produção'),
  record('03', 'elciney', 1, '22:40', '00:10', 'pending', 'Atendimento após o turno', true),
  record('04', 'mathus', 1, '17:00', '18:30', 'approved', 'Manutenção preventiva'),
  record('05', 'maycon', 2, '17:10', '19:10', 'approved', 'Troca de componente'),
  record('06', 'paulo', 3, '18:00', '19:30', 'approved', 'Ajuste de equipamento'),
  record('07', 'elciney', 4, '17:00', '18:20', 'rejected', 'Chamado emergencial'),
  record('08', 'mathus', 5, '17:00', '20:15', 'approved', 'Fechamento de ordem de serviço'),
]

function record(id: string, worker_id: string, ago: number, point_exit: string,
  final_exit: string, status: Entry['status'], note: string, nextDay = false): Entry {
  return {
    id, worker_id, work_date: daysAgo(ago), normal_entry: '08:00:00',
    point_exit, final_exit, final_exit_next_day: nextDay,
    minutes: overtimeMinutes(point_exit, final_exit, nextDay), note, status,
    rejection_reason: status === 'rejected' ? 'Confira o horário da saída final.' : null,
    reviewed_by: status === 'pending' ? null : 'marcelo',
    reviewed_at: status === 'pending' ? null : now,
    submitted_at: new Date(Date.now() - ago * 86400000).toISOString(), updated_at: now,
  }
}

let invitations: Invitation[] = []
let current = 'admin'
let events: Event[] = entries.map((e, i) => ({
  id: i + 1, entry_id: e.id, actor_id: e.worker_id, action: 'submitted', snapshot: { ...e }, created_at: e.submitted_at,
}))

export const demoRole = () => demoProfiles.find(p => p.id === current)!
export const setDemoRole = (id: string) => { current = id }
export const demoNotice = `Demonstração com dados fictícios. ${formatDate(today)} · Alterações não são salvas no Supabase.`

export const demoApi = {
  async loadData(): Promise<DataSet> {
    return {
      profiles: demoProfiles.map(p => ({ ...p })),
      entries: entries.filter(e => current === 'admin' || current === 'marcelo' || e.worker_id === current).map(e => ({ ...e })),
      invitations: current === 'admin' ? invitations.map(i => ({ ...i })) : [],
    }
  },
  async submitEntry(input: EntryInput) {
    if (demoRole().role !== 'maintainer') throw new Error('Use o acesso de manutentor para registrar horas.')
    const invalid = entryValidationError(input)
    if (invalid) throw new Error(invalid)
    const e = record(crypto.randomUUID(), current, 0, input.point_exit, input.final_exit,
      'pending', input.note, input.final_exit_next_day)
    e.work_date = input.work_date
    e.normal_entry = input.normal_entry
    e.overtime_start = input.overtime_start
    e.note = input.note.trim()
    e.minutes = overtimeMinutes(input.overtime_start, input.final_exit, input.final_exit_next_day)
    entries = [e, ...entries]
    events = [{ id: Date.now(), entry_id: e.id, actor_id: current, action: 'submitted', snapshot: { ...e }, created_at: now }, ...events]
  },
  async reviseEntry(id: string, input: EntryInput) {
    const invalid = entryValidationError(input)
    if (invalid) throw new Error(invalid)
    const e = entries.find(x => x.id === id)
    if (!e || e.worker_id !== current || e.status !== 'rejected') throw new Error('Lançamento indisponível para correção.')
    Object.assign(e, input, { note: input.note.trim(), minutes: overtimeMinutes(input.overtime_start, input.final_exit, input.final_exit_next_day),
      status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null, submitted_at: now })
    events = [{ id: Date.now(), entry_id: id, actor_id: current, action: 'revised', snapshot: { ...e }, created_at: now }, ...events]
  },
  async reviewEntry(id: string, decision: 'approved' | 'rejected', reason?: string) {
    const e = entries.find(x => x.id === id)
    if (!e || e.status !== 'pending') throw new Error('Este lançamento já foi analisado.')
    e.status = decision
    e.reviewed_by = current
    e.reviewed_at = now
    e.rejection_reason = decision === 'rejected' ? reason || 'Horário não confirmado' : null
    events = [{ id: Date.now(), entry_id: id, actor_id: current, action: decision, snapshot: { ...e }, created_at: now }, ...events]
  },
  async createInvitation(email: string, name: string, role: Role, adminId: string) {
    if (invitations.some(i => i.email === email)) throw new Error('Este e-mail já foi autorizado.')
    invitations = [{ id: crypto.randomUUID(), email, full_name: name, role, status: 'pending',
      invited_by: adminId, claimed_by: null, created_at: now, claimed_at: null }, ...invitations]
  },
  async changeInvitation(id: string, status: 'pending' | 'revoked') {
    invitations = invitations.map(i => i.id === id ? { ...i, status } : i)
  },
  async updateProfile(profile: Profile, name: string, role: Role, active: boolean, approve: boolean, exportReport: boolean) {
    const p = demoProfiles.find(x => x.id === profile.id)
    if (!p) throw new Error('Usuário não encontrado.')
    if (p.id === 'admin' && (!active || role !== 'admin')) throw new Error('O administrador principal deve permanecer ativo.')
    Object.assign(p, { full_name: name, role, active,
      can_approve: role === 'admin' || (role === 'supervisor' && approve),
      can_export: role === 'admin' || (role === 'supervisor' && exportReport) })
  },
  async reviewProfile(id: string, approve: boolean) {
    const p = demoProfiles.find(x => x.id === id)
    if (!p) throw new Error('Usuário não encontrado.')
    p.active = approve
    p.approval_status = approve ? 'approved' : 'rejected'
  },
  async deleteEntry(id: string) {
    const actor = demoRole()
    if (actor.role !== 'admin' || !actor.active) throw new Error('Somente administradores podem excluir lançamentos.')
    if (!entries.some(e => e.id === id)) throw new Error('Lançamento não encontrado.')
    entries = entries.filter(e => e.id !== id)
    events = events.filter(e => e.entry_id !== id)
  },
  async deleteProfile(id: string) {
    if (id === 'admin') throw new Error('O administrador principal não pode ser excluído.')
    if (entries.some(e => e.worker_id === id)) throw new Error('Este usuário possui lançamentos. Desative o acesso em vez de excluir o perfil.')
    const index = demoProfiles.findIndex(p => p.id === id)
    if (index < 0) throw new Error('Usuário não encontrado.')
    demoProfiles.splice(index, 1)
    invitations = invitations.filter(i => i.claimed_by !== id && i.invited_by !== id)
  },
  async getHistory(id: string) { return events.filter(e => e.entry_id === id) },
}
