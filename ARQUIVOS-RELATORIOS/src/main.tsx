import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3,
  ClipboardList, Download, FileSpreadsheet, LayoutDashboard, LockKeyhole, LogOut,
  Mail, Menu, Plus, RotateCcw, Search, ShieldCheck, UsersRound, X,
} from 'lucide-react'
import { configured, supabase, getProfile, loadData, submitEntry, reviseEntry,
  reviewEntry, createInvitation, changeInvitation, updateProfile, reviewProfile, deleteProfile, deleteEntry, getHistory } from './lib/supabase'
import { demoApi, demoNotice, demoProfiles, demoRole, setDemoRole } from './lib/demo'
import { formatDate, formatDateTime, formatMinutes, localToday, monthName, overtimeMinutes, validOvertime } from './lib/time'
import { makeReport, selectReport } from './lib/report'
import type { DataSet, Entry, EntryInput, Event, Invitation, Profile, Role, Status } from './lib/types'
import './style.css'

const demo = new URLSearchParams(window.location.search).has('demo')
const blank: DataSet = { profiles: [], entries: [], invitations: [] }
const api = demo ? demoApi : { loadData, submitEntry, reviseEntry, reviewEntry,
  createInvitation, changeInvitation, updateProfile, reviewProfile, deleteProfile, deleteEntry, getHistory }
type Page = 'overview' | 'entries' | 'team' | 'reports'
const roleName: Record<Role, string> = { admin: 'Administrador', supervisor: 'Gestor', maintainer: 'Manutentor' }
const statusName: Record<Status, string> = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Devolvida' }
const actionName: Record<Event['action'], string> = { submitted: 'Enviado', approved: 'Aprovado', rejected: 'Devolvido', revised: 'Corrigido e reenviado' }

function usePeriod() { return useState(localToday().slice(0, 7)) }
function initials(name: string) { return name.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase() }
function errorText(e: unknown) { return e instanceof Error ? e.message : 'Não foi possível concluir a operação.' }

function App() {
  const [userId, setUserId] = useState<string | null>(demo ? demoRole().id : null)
  const [checking, setChecking] = useState(!demo)
  const [profileLoading, setProfileLoading] = useState(!demo)
  const [recovery, setRecovery] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(demo ? demoRole() : null)
  const knownUser = useRef<string | null>(demo ? demoRole().id : null)

  useEffect(() => {
    if (demo || !supabase) return
    let alive = true
    supabase.auth.getUser().then(({ data, error }) => {
      if (!alive) return
      const next = error ? null : data.user?.id ?? null
      if (knownUser.current !== next) { knownUser.current = next; setProfileLoading(Boolean(next)) }
      setUserId(next)
      setChecking(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      const next = session?.user?.id ?? null
      if (knownUser.current !== next) {
        knownUser.current = next; setProfile(null); setProfileLoading(Boolean(next))
      }
      setUserId(next)
      setChecking(false)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!userId || demo) return
    let alive = true
    setProfileLoading(true)
    getProfile(userId).then(p => { if (alive) setProfile(p) })
      .catch(() => { if (alive) setProfile(null) })
      .finally(() => { if (alive) setProfileLoading(false) })
    return () => { alive = false }
  }, [userId])

  if (!configured && !demo) return <Setup />
  if (checking || (userId && profileLoading)) return <div className="loading-screen"><div className="brand-icon">P<span>+</span></div><p>Carregando seu espaço…</p></div>
  if (recovery) return <ResetPassword onDone={() => setRecovery(false)} />
  if (!userId) return <Login />
  if (!profile) return <NoAccess onExit={() => supabase?.auth.signOut()} />
  if (!profile.active) return <NoAccess pending={profile.approval_status === 'pending'} inactive onExit={() => supabase?.auth.signOut()} />
  return <Workspace key={`${userId}-${profile.role}`} profile={profile}
    onProfile={setProfile} onExit={() => { if (demo) { setDemoRole('admin'); setProfile(demoRole()); setUserId('admin') }
      else supabase?.auth.signOut() }} />
}

function Setup() {
  return <div className="auth-bg"><div className="setup-card"><div className="brand-icon">P<span>+</span></div>
    <span className="eyebrow">PROJETO PRONTO PARA CONFIGURAR</span><h1>Seu sistema está preparado.</h1>
    <p>Informe a URL e a chave pública do Supabase nas variáveis de ambiente e execute a migração SQL. O arquivo <code>COMECE-AQUI.md</code> explica cada etapa.</p>
    <a className="button primary" href="/?demo=1">Abrir demonstração <ArrowRight size={17}/></a>
    <small>A demonstração contém apenas dados fictícios.</small></div></div>
}

function Login() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function send(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMessage(''); setBusy(true)
    try {
      if (!supabase) return
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { emailRedirectTo: window.location.origin, data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        setMessage(data.session ? 'Cadastro recebido. Aguarde a análise do administrador.' :
          'O cadastro foi recebido. O acesso será liberado após a aprovação do administrador.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setMessage('Se o e-mail estiver cadastrado, você receberá um link para criar outra senha.')
      }
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="auth-bg"><div className="auth-frame">
    <div className="auth-story"><div className="brand white"><div className="brand-icon">P<span>+</span></div><div><strong>PONTO EXTRA</strong><small>MANUTENÇÃO</small></div></div>
      <div className="story-content"><div className="story-chip"><span className="live-dot"/> ROTINA MAIS SIMPLES</div>
        <h1>O tempo da equipe,<br/><em>sob controle.</em></h1><p>Registre as horas após a batida de ponto, acompanhe as aprovações e entregue o relatório mensal em poucos cliques.</p></div>
      <div className="story-footer"><span>01 &nbsp; REGISTRE</span><span>02 &nbsp; APROVE</span><span>03 &nbsp; EXPORTE</span></div>
    </div>
    <div className="auth-form-wrap"><div className="auth-mobile-brand"><div className="brand-icon">P<span>+</span></div><strong>PONTO EXTRA</strong></div>
      <div className="auth-heading"><span className="eyebrow">ACESSO DA EQUIPE</span><h2>{mode === 'login' ? 'Bem-vindo de volta.' : mode === 'signup' ? 'Crie sua conta.' : 'Recupere o acesso.'}</h2>
        <p>{mode === 'login' ? 'Entre com seu e-mail e senha para continuar.' : mode === 'signup' ? 'Cadastre seus dados; o administrador analisará o acesso.' : 'Enviaremos um link para redefinir sua senha.'}</p></div>
      <form onSubmit={send} className="auth-form">
        <label>E-mail corporativo<div className="field-icon"><Mail size={18}/><input required type="email" autoComplete="email" placeholder="seu.email@empresa.com" value={email} onChange={e => setEmail(e.target.value)}/></div></label>
        {mode === 'signup' && <label>Nome completo<div className="field-icon"><UsersRound size={18}/><input required minLength={2} autoComplete="name" placeholder="Seu nome completo" value={fullName} onChange={e => setFullName(e.target.value)}/></div></label>}
        {mode !== 'forgot' && <label>Senha<div className="field-icon"><LockKeyhole size={18}/><input required minLength={mode === 'signup' ? 8 : undefined} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Sua senha" value={password} onChange={e => setPassword(e.target.value)}/><button className="icon-only" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? 'Ocultar' : 'Mostrar'}</button></div></label>}
        {mode === 'login' && <button className="text-link align-right" type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Esqueceu a senha?</button>}
        {error && <div role="alert" className="form-error">{error}</div>}{message && <div role="status" className="form-success">{message}</div>}
        <button disabled={busy} className="button primary full" type="submit">{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar no sistema' : mode === 'signup' ? 'Criar minha conta' : 'Enviar link'} <ArrowRight size={18}/></button>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'Primeiro acesso?' : 'Já tem uma conta?'} <button className="text-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Criar conta' : 'Voltar para o login'}</button></p>
    </div>
  </div></div>
}

function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      if (password.length < 8) throw new Error('Use pelo menos 8 caracteres.')
      const { error } = await supabase!.auth.updateUser({ password })
      if (error) throw error
      onDone()
    } catch (e) { setMessage(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="auth-bg"><div className="setup-card"><div className="brand-icon">P<span>+</span></div><h1>Nova senha</h1><p>Escolha uma senha com pelo menos 8 caracteres.</p><form onSubmit={submit} className="auth-form"><label>Senha nova<input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)}/></label>{message && <div role="alert" className="form-error">{message}</div>}<button className="button primary full" disabled={busy}>Salvar senha</button></form></div></div>
}

function NoAccess({ pending = false, inactive = false, onExit }: { pending?: boolean; inactive?: boolean; onExit: () => void }) {
  const title = pending ? 'Cadastro em análise.' : inactive ? 'Acesso desativado.' : 'Aguardando autorização.'
  const detail = pending ? 'Seu cadastro foi recebido. O administrador precisa aprovar seu acesso antes de liberar o sistema.' : inactive ? 'Peça ao administrador para reativar sua conta.' : 'Sua conta foi criada, mas este e-mail ainda não está autorizado no sistema. Peça ao administrador para conferir o endereço cadastrado.'
  return <div className="auth-bg"><div className="setup-card"><div className="brand-icon">P<span>+</span></div><span className="eyebrow">ACESSO DA EQUIPE</span><h1>{title}</h1>
    <p>{detail}</p>
    <button className="button secondary" onClick={onExit}>Sair da conta</button></div></div>
}

function Workspace({ profile, onProfile, onExit }: { profile: Profile; onProfile: (p: Profile) => void; onExit: () => void }) {
  const [page, setPage] = useState<Page>('overview')
  const [period, setPeriod] = usePeriod()
  const [data, setData] = useState<DataSet>(blank)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Entry | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [refreshAt, setRefreshAt] = useState(new Date())
  const manager = profile.role !== 'maintainer'
  const canApprove = profile.role === 'admin' || (profile.role === 'supervisor' && profile.can_approve)
  const canExport = profile.role === 'admin' || (profile.role === 'supervisor' && profile.can_export)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await api.loadData(profile.role)
      setData(result)
      setRefreshAt(new Date())
      if (demo) onProfile(demoRole())
      else {
        const latest = await getProfile(profile.id)
        if (latest) onProfile(latest)
      }
    } catch (e) { setError(errorText(e)) }
    finally { setLoading(false) }
  }, [profile.id, profile.role, onProfile])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(true) }, 30000)
    const visible = () => { if (!document.hidden) void refresh(true) }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success); await refresh(true); return true }
    catch (e) { setError(errorText(e)); return false }
    finally { setBusy(false) }
  }

  function switchRole(id: string) {
    setDemoRole(id); onProfile(demoRole()); setPage('overview'); setSelected(null); setShowForm(false)
  }

  const monthly = data.entries.filter(e => e.work_date.startsWith(period))
  const pending = data.entries.filter(e => e.status === 'pending')
  const totalMinutes = monthly.filter(e => e.status === 'approved').reduce((sum, e) => sum + e.minutes, 0)
  const names = new Map(data.profiles.map(p => [p.id, p.full_name]))
  const nav: { id: Page; title: string; icon: React.ElementType; count?: number }[] = [
    { id: 'overview', title: 'Visão geral', icon: LayoutDashboard },
    { id: 'entries', title: 'Lançamentos', icon: ClipboardList, count: manager ? pending.length : undefined },
    ...(profile.role === 'admin' ? [{ id: 'team' as Page, title: 'Equipe e acessos', icon: UsersRound }] : []),
    ...(canExport ? [{ id: 'reports' as Page, title: 'Relatórios', icon: FileSpreadsheet }] : []),
  ]
  const title: Record<Page, string> = { overview: manager ? 'Visão geral da equipe' : 'Minhas horas extras',
    entries: 'Lançamentos', team: 'Equipe e acessos', reports: 'Relatórios' }

  return <div className="app-shell">
    {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-icon">P<span>+</span></div><div><strong>PONTO EXTRA</strong><small>MANUTENÇÃO</small></div></div>
      <div className="sidebar-label">ESPAÇO DE TRABALHO</div>
      <nav aria-label="Menu principal">{nav.map(item => <button key={item.id} className={`nav-link ${page === item.id ? 'selected' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); setError(''); setNotice('') }}><item.icon size={18}/><span>{item.title}</span>{item.count ? <b>{item.count}</b> : null}</button>)}</nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-tip"><div className="tip-icon"><Clock3 size={20}/></div><strong>Como funciona?</strong><p>A contagem começa na batida de saída do expediente normal.</p></div>
      <div className="sidebar-user"><div className="avatar">{initials(profile.full_name)}</div><div className="user-text"><strong>{profile.full_name}</strong><small>{roleName[profile.role]}</small></div><button title="Sair" aria-label="Sair" onClick={onExit}><LogOut size={17}/></button></div>
    </aside>
    <main className="main-area">
      {demo && <div className="demo-banner"><span>{demoNotice}</span><label>Ver como <select aria-label="Trocar usuário na demonstração" value={profile.id} onChange={e => switchRole(e.target.value)}>{demoProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name} · {roleName[p.role]}</option>)}</select></label></div>}
      <header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMobileNav(true)}><Menu size={23}/></button><div className="breadcrumb">Painel <ChevronRight size={14}/> <span>{title[page]}</span></div><div className="top-actions"><span className="sync-mark"><span className="live-dot"/> Atualizado {refreshAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span><button className="circle-button" title="Atualizar" aria-label="Atualizar" onClick={() => void refresh(true)}><RotateCcw size={17}/></button><div className="avatar small">{initials(profile.full_name)}</div></div></header>
      <div className="content">
        {error && <div role="alert" className="toast error"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar"><X size={16}/></button></div>}
        {notice && <div role="status" className="toast success"><CheckCircle2 size={18}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fechar"><X size={16}/></button></div>}
        {loading && data.profiles.length === 0 ? <div className="loading-inline">Carregando informações…</div> : <>
          {page === 'overview' && <><div className="page-head"><div><span className="eyebrow">{manager ? 'ACOMPANHAMENTO EM TEMPO REAL' : 'SEU ESPAÇO'}</span><h1>{manager ? 'Tudo em um só lugar.' : `Olá, ${profile.full_name.split(' ')[0]}.`}</h1><p>{manager ? 'Acompanhe os lançamentos e mantenha as aprovações em dia.' : 'Acompanhe suas horas registradas e o andamento de cada aprovação.'}</p></div>{!manager && <button className="button primary" onClick={() => { setEditing(null); setShowForm(true) }}><Plus size={18}/> Nova hora extra</button>}</div>
            <div className="period-strip"><span><CalendarDays size={17}/> Período</span><input type="month" value={period} onChange={e => setPeriod(e.target.value)}/><span className="period-label">{monthName(Number(period.slice(5)))} de {period.slice(0, 4)}</span></div>
            <div className="stats-grid"><Stat icon={Clock3} label="Horas aprovadas" value={formatMinutes(totalMinutes)} sub="Neste mês" color="amber"/><Stat icon={ClipboardList} label="Aguardando análise" value={String(monthly.filter(e => e.status === 'pending').length).padStart(2, '0')} sub="Lançamentos no mês" color="blue"/><Stat icon={CheckCircle2} label="Aprovadas" value={String(monthly.filter(e => e.status === 'approved').length).padStart(2, '0')} sub="Lançamentos no mês" color="green"/><Stat icon={Activity} label={manager ? 'Manutentores ativos' : 'Registros no mês'} value={String(manager ? data.profiles.filter(p => p.role === 'maintainer' && p.active).length : monthly.length).padStart(2, '0')} sub={manager ? 'Equipe cadastrada' : 'Enviados por você'} color="purple"/></div>
            <div className="overview-grid"><section className="card activity-card"><div className="section-heading"><div><span className="eyebrow">MOVIMENTAÇÃO</span><h2>Últimos lançamentos</h2></div><button className="text-link arrow-link" onClick={() => setPage('entries')}>Ver todos <ArrowRight size={16}/></button></div><div className="recent-list">{[...data.entries].sort((a,b) => b.submitted_at.localeCompare(a.submitted_at)).slice(0, 5).map(e => <button className="recent-row" key={e.id} onClick={() => setSelected(e)}><div className="recent-avatar">{initials(names.get(e.worker_id) ?? 'M')}</div><div className="recent-main"><strong>{names.get(e.worker_id) ?? 'Manutentor'}</strong><span>{formatDate(e.work_date)} · {e.point_exit.slice(0,5)} até {e.final_exit.slice(0,5)}{e.final_exit_next_day ? ' (+1 dia)' : ''}</span></div><strong className="recent-hours">{formatMinutes(e.minutes)}</strong><StatusPill value={e.status}/></button>)}{data.entries.length === 0 && <Empty title="Nenhum lançamento ainda" detail="Os registros aparecerão aqui depois do primeiro envio."/>}</div></section>
              <section className="card team-card"><div className="section-heading"><div><span className="eyebrow">{manager ? 'POR PROFISSIONAL' : 'SEU RESUMO'}</span><h2>{manager ? 'Horas por manutentor' : 'Seu progresso no mês'}</h2></div></div>{manager ? <div className="team-bars">{data.profiles.filter(p => p.role === 'maintainer').map(p => { const min = monthly.filter(e => e.worker_id === p.id && e.status === 'approved').reduce((s,e) => s + e.minutes,0); const max = Math.max(60, ...data.profiles.map(person => monthly.filter(e => e.worker_id === person.id && e.status === 'approved').reduce((s,e) => s + e.minutes,0))); const last = data.entries.filter(e => e.worker_id === p.id).sort((a,b) => b.submitted_at.localeCompare(a.submitted_at))[0]; return <div className="team-bar-row" key={p.id}><div className="team-bar-label"><span className="mini-avatar">{initials(p.full_name)}</span><div><strong>{p.full_name}</strong><small>{last ? `Último envio ${formatDateTime(last.submitted_at)}` : 'Sem lançamentos'}</small></div><b>{formatMinutes(min)}</b></div><div className="track"><div style={{ width: `${Math.max(min ? 4 : 0, min / max * 100)}%` }}/></div></div> })}{!data.profiles.some(p => p.role === 'maintainer') && <Empty title="Equipe ainda não cadastrada" detail="Autorize os e-mails na área Equipe e acessos."/>}</div> : <div className="personal-note"><div className="note-art"><Clock3 size={38}/></div><h3>Seu tempo, registrado com clareza.</h3><p>Informe a batida do ponto e o horário em que terminou a hora extra. O sistema calcula a diferença automaticamente.</p><button className="button secondary" onClick={() => { setEditing(null); setShowForm(true) }}>Adicionar lançamento <ArrowRight size={17}/></button></div>}</section></div>
            {manager && <ManagerCharts profiles={data.profiles} entries={monthly}/>} 
          </>}
          {page === 'entries' && <Entries entries={data.entries} profiles={data.profiles} manager={manager} canApprove={canApprove} busy={busy} onAdd={() => { setEditing(null); setShowForm(true) }} onSelect={setSelected} onReview={async (id, decision, reason) => { if (await run(() => api.reviewEntry(id, decision, reason), decision === 'approved' ? 'Hora extra aprovada.' : 'Lançamento devolvido ao manutentor.')) setSelected(null) }}/>} 
          {page === 'team' && profile.role === 'admin' && <Team profile={profile} data={data} busy={busy} run={run}/>}
          {page === 'reports' && canExport && <Reports entries={data.entries} profiles={data.profiles} period={period} setPeriod={setPeriod}/>}
        </>}
      </div>
    </main>
    {showForm && <EntryForm entry={editing} busy={busy} onClose={() => setShowForm(false)} onSave={async input => { const ok = await run(() => editing ? api.reviseEntry(editing.id, input) : api.submitEntry(input), editing ? 'Lançamento corrigido e reenviado.' : 'Hora extra enviada para aprovação.'); if (ok) { setShowForm(false); setEditing(null) } }}/>} 
    {selected && <EntryDetail canDelete={profile.role === 'admin' && profile.active} onDelete={async () => {
      if (!window.confirm(`Excluir definitivamente o lançamento de ${names.get(selected.worker_id) ?? 'Manutentor'} em ${formatDate(selected.work_date)}, das ${selected.point_exit.slice(0,5)} às ${selected.final_exit.slice(0,5)} (${formatMinutes(selected.minutes)})? O lançamento e seu histórico serão apagados, e as horas sairão dos totais e dos próximos relatórios. A conta será mantida. Esta ação não pode ser desfeita.`)) return
      if (await run(() => api.deleteEntry(selected.id), 'Lançamento excluído. Totais atualizados.')) setSelected(null)
    }} entry={data.entries.find(e => e.id === selected.id) ?? selected} names={names} manager={manager} canApprove={canApprove} busy={busy} onClose={() => setSelected(null)} onCorrect={() => { setEditing(selected); setSelected(null); setShowForm(true) }} onReview={async (decision, reason) => { const ok = await run(() => api.reviewEntry(selected.id, decision, reason), decision === 'approved' ? 'Hora extra aprovada.' : 'Lançamento devolvido ao manutentor.'); if (ok) setSelected(null) }}/>} 
  </div>
}

function Stat({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub: string; color: string }) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}><Icon size={21}/></div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
}

function ManagerCharts({ profiles, entries }: { profiles: Profile[]; entries: Entry[] }) {
  const colors = ['#d8954e', '#5b9db1', '#7e77b7', '#5ca27e', '#c66f78', '#8a9aa3']
  const maintainers = profiles.filter(p => p.role === 'maintainer')
  const totals = maintainers.map(person => ({ person, minutes: entries.filter(e => e.worker_id === person.id && e.status === 'approved').reduce((sum, e) => sum + e.minutes, 0) }))
  const totalMinutes = totals.reduce((sum, item) => sum + item.minutes, 0)
  let cursor = 0
  const gradient = totalMinutes > 0
    ? `conic-gradient(${totals.map((item, index) => { const start = cursor / totalMinutes * 100; cursor += item.minutes; const end = cursor / totalMinutes * 100; return `${colors[index % colors.length]} ${start}% ${end}%` }).join(', ')})`
    : '#edf2f3'
  const statuses: Array<{ key: Status; label: string; color: string }> = [
    { key: 'approved', label: 'Aprovadas', color: '#5ca27e' },
    { key: 'pending', label: 'Pendentes', color: '#d8954e' },
    { key: 'rejected', label: 'Devolvidas', color: '#c66f78' },
  ]
  const statusCounts = statuses.map(item => ({ ...item, count: entries.filter(e => e.status === item.key).length }))
  const maxCount = Math.max(1, ...statusCounts.map(item => item.count))
  return <div className="charts-grid">
    <section className="card chart-card"><div className="section-heading"><div><span className="eyebrow">DISTRIBUIÇÃO</span><h2>Horas por manutentor</h2></div><span className="chart-period">Aprovadas</span></div>
      <div className="pie-layout"><div className="pie-chart" style={{ background: gradient }} role="img" aria-label="Distribuição das horas aprovadas por manutentor"><div><strong>{formatMinutes(totalMinutes)}</strong><small>Total</small></div></div><div className="chart-legend">{totals.map((item, index) => <div className="legend-row" key={item.person.id}><span className="legend-dot" style={{ background: colors[index % colors.length] }}/><span>{item.person.full_name}</span><b>{totalMinutes ? `${Math.round(item.minutes / totalMinutes * 100)}%` : '0%'}</b></div>)}{totals.length === 0 && <span className="chart-empty">Nenhum manutentor cadastrado.</span>}</div></div>
    </section>
    <section className="card chart-card"><div className="section-heading"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Situação dos lançamentos</h2></div><span className="chart-period">No mês</span></div>
      <div className="status-bars">{statusCounts.map(item => <div className="status-bar-row" key={item.key}><div className="status-bar-head"><span><i style={{ background: item.color }}/>{item.label}</span><b>{item.count}</b></div><div className="status-bar-track"><div style={{ width: `${item.count / maxCount * 100}%`, background: item.color }}/></div></div>)}{entries.length === 0 && <span className="chart-empty">Nenhum lançamento neste período.</span>}</div>
    </section>
  </div>
}

function StatusPill({ value }: { value: Status }) { return <span className={`status ${value}`}><span className="status-dot"/>{statusName[value]}</span> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><ClipboardList size={26}/><strong>{title}</strong><p>{detail}</p></div> }

function Entries({ entries, profiles, manager, canApprove, busy, onAdd, onSelect, onReview }: {
  entries: Entry[]; profiles: Profile[]; manager: boolean; canApprove: boolean; busy: boolean;
  onAdd: () => void; onSelect: (e: Entry) => void;
  onReview: (id: string, decision: 'approved'|'rejected', reason?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [search, setSearch] = useState('')
  const [worker, setWorker] = useState('all')
  const [period, setPeriod] = usePeriod()
  const names = new Map(profiles.map(p => [p.id, p.full_name]))
  const filtered = entries.filter(e => e.work_date.startsWith(period) && (filter === 'all' || e.status === filter)
    && (worker === 'all' || e.worker_id === worker)
    && `${names.get(e.worker_id) ?? ''} ${e.note}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
    .sort((a,b) => b.work_date.localeCompare(a.work_date) || b.submitted_at.localeCompare(a.submitted_at))
  return <><div className="page-head"><div><span className="eyebrow">CONTROLE DE HORAS</span><h1>{manager ? 'Lançamentos da equipe.' : 'Seus lançamentos.'}</h1><p>{manager ? 'Confira os horários informados antes de aprovar ou devolver.' : 'Veja o andamento das horas que você enviou.'}</p></div>{!manager && <button className="button primary" onClick={onAdd}><Plus size={18}/> Nova hora extra</button>}</div>
    <section className="card table-card"><div className="table-toolbar"><div className="tabs" role="group" aria-label="Filtrar por situação">{(['all','pending','approved','rejected'] as const).map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'Todos' : statusName[item]}</button>)}</div><div className="filters"><div className="search-field"><Search size={17}/><input aria-label="Buscar lançamentos" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}/></div><input aria-label="Mês dos lançamentos" type="month" value={period} onChange={e => setPeriod(e.target.value)}/>{manager && <select aria-label="Filtrar manutentor" value={worker} onChange={e => setWorker(e.target.value)}><option value="all">Todos os manutentores</option>{profiles.filter(p => p.role === 'maintainer').map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}</div></div>
      <div className="table-wrap"><table><thead><tr><th>MANUTENTOR</th><th>DATA</th><th>BATIDA DO PONTO</th><th>SAÍDA FINAL</th><th>HORA EXTRA</th><th>SITUAÇÃO</th><th>AÇÃO</th></tr></thead><tbody>{filtered.map(e => <tr key={e.id}><td><div className="name-cell"><span className="mini-avatar">{initials(names.get(e.worker_id) ?? 'M')}</span><strong>{names.get(e.worker_id) ?? 'Manutentor'}</strong></div></td><td>{formatDate(e.work_date)}</td><td>{e.point_exit.slice(0,5)}</td><td>{e.final_exit.slice(0,5)}{e.final_exit_next_day && <small className="next-day">+1 dia</small>}</td><td className="bold-cell">{formatMinutes(e.minutes)}</td><td><StatusPill value={e.status}/></td><td><button className="table-action" disabled={busy} onClick={() => onSelect(e)}>{canApprove && e.status === 'pending' ? 'Analisar' : 'Detalhes'} <ArrowRight size={15}/></button></td></tr>)}</tbody></table>{filtered.length === 0 && <Empty title="Nenhum registro neste filtro" detail="Mude o mês ou a situação para ver outros lançamentos."/>}</div>
      <div className="table-footer"><span>{filtered.length} lançamento{filtered.length === 1 ? '' : 's'} encontrado{filtered.length === 1 ? '' : 's'}</span>{canApprove && filtered.some(e => e.status === 'pending') && <span>Analise os horários antes da aprovação.</span>}</div></section>
    {canApprove && filtered.filter(e => e.status === 'pending').length > 0 && <div className="quick-review"><strong>Prontos para análise</strong><div>{filtered.filter(e => e.status === 'pending').slice(0,3).map(e => <div key={e.id}><span>{names.get(e.worker_id)} · {formatDate(e.work_date)} · {formatMinutes(e.minutes)}</span><button className="button tiny" disabled={busy} onClick={() => void onReview(e.id, 'approved')}>Aprovar <Check size={14}/></button></div>)}</div></div>}
  </>
}

function EntryForm({ entry, busy, onClose, onSave }: { entry: Entry | null; busy: boolean; onClose: () => void; onSave: (input: EntryInput) => Promise<void> }) {
  const [input, setInput] = useState<EntryInput>({ work_date: entry?.work_date ?? localToday(), normal_entry: entry?.normal_entry?.slice(0,5) ?? null,
    point_exit: entry?.point_exit?.slice(0,5) ?? '', final_exit: entry?.final_exit?.slice(0,5) ?? '',
    final_exit_next_day: entry?.final_exit_next_day ?? false, note: entry?.note ?? '' })
  const minutes = input.point_exit && input.final_exit ? overtimeMinutes(input.point_exit, input.final_exit, input.final_exit_next_day) : 0
  const valid = validOvertime(input.point_exit, input.final_exit, input.final_exit_next_day)
  const change = <K extends keyof EntryInput>(key: K, value: EntryInput[K]) => setInput(old => ({ ...old, [key]: value }))
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal form-modal" role="dialog" aria-modal="true" aria-label={entry ? 'Corrigir lançamento' : 'Nova hora extra'}><div className="modal-head"><div><span className="eyebrow">{entry ? 'CORREÇÃO SOLICITADA' : 'NOVO LANÇAMENTO'}</span><h2>{entry ? 'Corrigir hora extra' : 'Registrar hora extra'}</h2></div><button className="circle-button" onClick={onClose} aria-label="Fechar"><X size={20}/></button></div>
    {entry?.rejection_reason && <div className="form-error">Motivo da devolução: {entry.rejection_reason}</div>}
    <form onSubmit={e => { e.preventDefault(); if (valid) void onSave(input) }}><div className="modal-body"><div className="help-box"><Clock3 size={20}/><p>A hora extra começa quando você <strong>bate o ponto de saída do expediente normal</strong> e termina na sua saída final.</p></div>
      <div className="form-grid"><label>Data do trabalho <span>*</span><input required type="date" value={input.work_date} onChange={e => change('work_date', e.target.value)}/></label><label>Entrada normal <small>(opcional)</small><input type="time" value={input.normal_entry ?? ''} onChange={e => change('normal_entry', e.target.value || null)}/></label><label>Batida de saída do ponto <span>*</span><input required type="time" value={input.point_exit} onChange={e => change('point_exit', e.target.value)}/></label><label>Saída final após a extra <span>*</span><input required type="time" value={input.final_exit} onChange={e => change('final_exit', e.target.value)}/></label></div>
      <label className="check-line"><input type="checkbox" checked={input.final_exit_next_day} onChange={e => change('final_exit_next_day', e.target.checked)}/> A saída final foi no dia seguinte</label>
      <label className="full-label">Observação <small>(opcional)</small><textarea maxLength={1000} rows={3} placeholder="Ex.: atendimento emergencial no equipamento" value={input.note} onChange={e => change('note', e.target.value)}/></label>
      <div className={`calculation ${minutes && !valid ? 'invalid' : ''}`}><div><span>TOTAL CALCULADO</span><strong>{valid ? formatMinutes(minutes) : '—'}</strong></div><p>{minutes && !valid ? 'Confira os horários. A extra precisa ser maior que zero e não pode exceder 16 horas.' : 'A contagem começa na batida do ponto.'}</p></div>
    </div><div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button disabled={busy || !valid} className="button primary" type="submit">{busy ? 'Enviando…' : entry ? 'Reenviar para análise' : 'Enviar para aprovação'} <ArrowRight size={17}/></button></div></form></div></div>
}

function EntryDetail({ entry, names, manager, canApprove, canDelete, onDelete, busy, onClose, onCorrect, onReview }: { canDelete: boolean; onDelete: () => Promise<void>; entry: Entry; names: Map<string,string>; manager: boolean; canApprove: boolean; busy: boolean; onClose: () => void; onCorrect: () => void; onReview: (d: 'approved'|'rejected', reason?: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [history, setHistory] = useState<Event[]>([])
  useEffect(() => { let active = true; api.getHistory(entry.id).then(h => { if (active) setHistory(h) }).catch(() => {}); return () => { active = false } }, [entry.id])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal detail-modal" role="dialog" aria-modal="true" aria-label="Detalhes do lançamento"><div className="modal-head"><div><span className="eyebrow">DETALHES DO LANÇAMENTO</span><h2>{names.get(entry.worker_id) ?? 'Manutentor'}</h2></div><button className="circle-button" onClick={onClose} aria-label="Fechar"><X size={20}/></button></div><div className="modal-body"><div className="detail-hero"><div><span>HORA EXTRA REGISTRADA</span><strong>{formatMinutes(entry.minutes)}</strong><small>{formatDate(entry.work_date)}</small></div><StatusPill value={entry.status}/></div>
    <div className="detail-grid"><div><span>Entrada normal</span><strong>{entry.normal_entry?.slice(0,5) || 'Não informada'}</strong></div><div><span>Batida do ponto</span><strong>{entry.point_exit.slice(0,5)}</strong></div><div><span>Saída final</span><strong>{entry.final_exit.slice(0,5)}{entry.final_exit_next_day ? ' · dia seguinte' : ''}</strong></div><div><span>Enviado em</span><strong>{formatDateTime(entry.submitted_at)}</strong></div></div>
    {entry.note && <div className="detail-note"><span>OBSERVAÇÃO</span><p>{entry.note}</p></div>}{entry.rejection_reason && <div className="detail-rejection"><strong>Motivo da devolução</strong><p>{entry.rejection_reason}</p></div>}
    {entry.reviewed_at && <p className="review-stamp">{entry.status === 'approved' ? 'Aprovado' : 'Devolvido'} por {names.get(entry.reviewed_by ?? '') ?? 'Gestor'} em {formatDateTime(entry.reviewed_at)}</p>}
    {canApprove && entry.status === 'pending' && rejecting && <label className="full-label">Por que está devolvendo? <span>*</span><textarea autoFocus required maxLength={1000} rows={3} placeholder="Explique o que precisa ser corrigido" value={reason} onChange={e => setReason(e.target.value)}/></label>}
    <div className="history"><strong>Histórico</strong>{history.map(h => <div className="history-row" key={h.id}><span className="history-dot"/><div><b>{actionName[h.action]}</b><small>{formatDateTime(h.created_at)}{h.actor_id ? ` · ${names.get(h.actor_id) ?? 'Equipe'}` : ''}</small></div></div>)}</div>
  </div><div className="modal-footer">{canDelete && <button className="button danger" disabled={busy} onClick={() => void onDelete()}>Excluir lançamento</button>}{!manager && entry.status === 'rejected' && <button className="button secondary" onClick={onCorrect}>Corrigir e reenviar</button>}{canApprove && entry.status === 'pending' && (rejecting ? <><button className="button ghost" onClick={() => setRejecting(false)}>Cancelar</button><button className="button danger" disabled={busy || !reason.trim()} onClick={() => void onReview('rejected', reason)}>Confirmar devolução</button></> : <><button className="button ghost" onClick={() => setRejecting(true)}>Devolver</button><button className="button primary" disabled={busy} onClick={() => void onReview('approved')}>Aprovar horas <Check size={17}/></button></>)}{(!canApprove || entry.status !== 'pending') && <button className="button ghost" onClick={onClose}>Fechar</button>}</div></div></div>
}

function Team({ profile, data, busy, run }: { profile: Profile; data: DataSet; busy: boolean; run: (action: () => Promise<void>, success: string) => Promise<boolean | undefined> }) {
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('maintainer')
  const [editing, setEditing] = useState<Profile | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<Role>('maintainer')
  const [editActive, setEditActive] = useState(true)
  const [approve, setApprove] = useState(false)
  const [exportReport, setExportReport] = useState(false)
  const people = [...data.profiles].sort((a,b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const pendingProfiles = people.filter(p => p.approval_status === 'pending')
  function open(p: Profile) { setEditing(p); setEditName(p.full_name); setEditRole(p.role); setEditActive(p.active); setApprove(p.can_approve); setExportReport(p.can_export) }
  async function invite(e: React.FormEvent) {
    e.preventDefault()
    const ok = await run(() => api.createInvitation(inviteEmail, inviteName, inviteRole, profile.id), 'E-mail autorizado. Oriente a pessoa a criar a conta na tela de acesso.')
    if (ok) { setInviteName(''); setInviteEmail('') }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!editing) return
    const ok = await run(() => api.updateProfile(editing, editName, editRole, editActive, approve, exportReport), 'Permissões atualizadas.')
    if (ok) setEditing(null)
  }
  async function review(p: Profile, approveAccess: boolean) {
    await run(() => api.reviewProfile(p.id, approveAccess), approveAccess ? 'Cadastro aprovado.' : 'Cadastro recusado.')
  }
  async function remove(p: Profile) {
    if (p.id === profile.id) return
    if (!window.confirm(`Excluir o perfil de ${p.full_name}? Essa ação remove o acesso da conta.`)) return
    await run(() => api.deleteProfile(p.id), 'Perfil excluído.')
    setEditing(null)
  }
  return <><div className="page-head"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Equipe e acessos.</h1><p>Autorize e-mails, defina perfis e ajuste as permissões da equipe.</p></div></div>
    <div className="team-layout"><section className="card invite-card"><div className="section-heading"><div><span className="eyebrow">NOVO ACESSO</span><h2>Autorizar e-mail</h2></div><div className="soft-icon"><Plus size={20}/></div></div><p>Você pode liberar um e-mail antes do cadastro. Nesse caso, a conta entra aprovada automaticamente.</p><form onSubmit={invite} className="stack-form"><label>Nome completo<input required minLength={2} placeholder="Nome do colaborador" value={inviteName} onChange={e => setInviteName(e.target.value)}/></label><label>E-mail<input required type="email" placeholder="pessoa@empresa.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}/></label><label>Tipo de acesso<select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}><option value="maintainer">Manutentor</option><option value="supervisor">Gestor</option><option value="admin">Administrador</option></select></label><button className="button primary full" disabled={busy}>Autorizar acesso <ArrowRight size={17}/></button></form><div className="invite-hint"><ShieldCheck size={18}/><span>O funcionário também pode solicitar o acesso e aguardar sua aprovação.</span></div></section>
    <section className="card members-card"><div className="section-heading"><div><span className="eyebrow">CONTAS ATIVAS</span><h2>Usuários cadastrados</h2></div><span className="count-badge">{people.length}</span></div><div className="member-list">{people.map(p => <div className="member-row" key={p.id}><div className="avatar small">{initials(p.full_name)}</div><div><strong>{p.full_name}</strong><small>{p.email}</small></div><span className={`role-badge ${p.role}`}>{roleName[p.role]}</span>{p.approval_status === 'pending' ? <span className="status pending">Pendente</span> : !p.active && <span className="inactive-badge">Inativo</span>}<button className="table-action" onClick={() => open(p)}>Editar <ChevronRight size={15}/></button></div>)}</div></section></div>
    <section className="card invites-list"><div className="section-heading"><div><span className="eyebrow">NOVOS CADASTROS</span><h2>Aguardando sua aprovação</h2></div><span className="count-badge">{pendingProfiles.length}</span></div>{pendingProfiles.length ? pendingProfiles.map(p => <div className="invite-row" key={p.id}><div><strong>{p.full_name}</strong><small>{p.email} · Manutentor</small></div><span className="status pending">Pendente</span><div className="inline-actions"><button className="button tiny" disabled={busy} onClick={() => void review(p, true)}>Aprovar <Check size={14}/></button><button className="button tiny danger" disabled={busy} onClick={() => void review(p, false)}>Recusar <X size={14}/></button></div></div>) : <Empty title="Nenhum cadastro pendente" detail="Novos pedidos aparecerão aqui para você analisar."/>}</section>
    <section className="card invites-list"><div className="section-heading"><div><span className="eyebrow">AGUARDANDO CADASTRO</span><h2>E-mails autorizados</h2></div></div>{data.invitations.filter(i => i.status !== 'claimed').length ? data.invitations.filter(i => i.status !== 'claimed').map((i: Invitation) => <div className="invite-row" key={i.id}><div><strong>{i.full_name}</strong><small>{i.email} · {roleName[i.role]}</small></div><span className={`status ${i.status === 'pending' ? 'pending' : 'rejected'}`}>{i.status === 'pending' ? 'Aguardando conta' : 'Revogado'}</span><button className="text-link" disabled={busy} onClick={() => void run(() => api.changeInvitation(i.id, i.status === 'pending' ? 'revoked' : 'pending'), i.status === 'pending' ? 'Autorização revogada.' : 'Autorização reativada.')}>{i.status === 'pending' ? 'Revogar' : 'Reativar'}</button></div>) : <Empty title="Nenhum convite pendente" detail="Você também pode aprovar cadastros depois que a pessoa solicitar acesso."/>}</section>
    {editing && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null) }}><div className="modal user-modal" role="dialog" aria-modal="true" aria-label="Editar acesso"><div className="modal-head"><div><span className="eyebrow">PERMISSÕES DO USUÁRIO</span><h2>{editing.full_name}</h2></div><button className="circle-button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={20}/></button></div><form onSubmit={save}><div className="modal-body stack-form"><label>Nome<input minLength={2} required value={editName} onChange={e => setEditName(e.target.value)}/></label><label>Tipo de acesso<select value={editRole} onChange={e => setEditRole(e.target.value as Role)}><option value="maintainer">Manutentor</option><option value="supervisor">Gestor</option><option value="admin">Administrador</option></select></label><label className="check-line"><input type="checkbox" checked={editActive} disabled={editing.id === profile.id} onChange={e => setEditActive(e.target.checked)}/> Conta ativa</label>{editRole === 'supervisor' && <div className="permission-box"><strong>Permissões do gestor</strong><label className="check-line"><input type="checkbox" checked={approve} onChange={e => setApprove(e.target.checked)}/> Aprovar e devolver horas</label><label className="check-line"><input type="checkbox" checked={exportReport} onChange={e => setExportReport(e.target.checked)}/> Exportar planilha mensal</label></div>}<p className="small-muted">Administradores têm acesso total. Manutentores veem apenas os próprios lançamentos. Perfis com lançamentos não podem ser excluídos; nesse caso, desative a conta.</p></div><div className="modal-footer">{editing.id !== profile.id && <button type="button" className="button danger" disabled={busy} onClick={() => void remove(editing)}>Excluir perfil</button>}<button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary" disabled={busy}>Salvar permissões</button></div></form></div></div>}
  </>
}

function Reports({ entries, profiles, period, setPeriod }: { entries: Entry[]; profiles: Profile[]; period: string; setPeriod: (v: string) => void }) {
  const [workerId, setWorkerId] = useState('')
  const [error, setError] = useState('')
  const { workers, selectedWorkers, approved } = selectReport(entries, profiles, period, workerId)
  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  const total = approved.reduce((sum,e) => sum + e.minutes,0)
  function download() {
    setError('')
    try {
      const { filename, blob } = makeReport(entries, profiles, period, workerId)
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = href; link.download = filename; link.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 60000)
    } catch (e) { setError(errorText(e)) }
  }
  return <>
    <div className="page-head"><div><span className="eyebrow">FECHAMENTO MENSAL</span><h1>Relatórios por manutentor.</h1><p>Exporte as horas aprovadas para encaminhar ao administrativo.</p></div></div>
    <div className="report-layout">
      <section className="card report-main">
        <div className="report-illustration"><FileSpreadsheet size={34}/><div className="illustration-lines"><span/><span/><span/></div></div>
        <span className="eyebrow">PLANILHA MENSAL</span><h2>Relatório de horas extras</h2>
        <p>Escolha um manutentor para baixar somente a planilha dele. Em “Todos os manutentores”, o arquivo terá uma aba com o nome de cada pessoa, seguindo o modelo de horas que você já utiliza.</p>
        <div className="report-controls">
          <label>Escolha o mês<input type="month" value={period} onChange={e => { setPeriod(e.target.value); setError('') }}/></label>
          <label>Escolha o manutentor<select value={workerId} onChange={e => { setWorkerId(e.target.value); setError('') }}>
            <option value="">Todos os manutentores</option>
            {workerId && !workers.some(p => p.id === workerId) && <option value={workerId} disabled>Manutentor indisponível</option>}
            {workers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select></label>
          <button className="button primary" onClick={download} disabled={!validPeriod || !approved.length}><Download size={18}/> Baixar planilha .xlsx</button>
        </div>
        <small>Somente lançamentos aprovados entram no arquivo. Entrada é a batida de saída do expediente normal.</small>
        {!validPeriod ? <p role="status">Escolha um mês para consultar as horas.</p> : !approved.length && <p role="status">Nenhum lançamento aprovado para esta seleção. A planilha ficará disponível após a aprovação das horas.</p>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </section>
      <div className="report-side">
        <div className="report-metric"><span>PERÍODO SELECIONADO</span><strong>{validPeriod ? <>{monthName(Number(period.slice(5)))} <em>{period.slice(0,4)}</em></> : 'Escolha o mês'}</strong></div>
        <div className="report-metric"><span>HORAS APROVADAS</span><strong>{formatMinutes(total)}</strong></div>
        <div className="report-metric"><span>LANÇAMENTOS NO ARQUIVO</span><strong>{approved.length}</strong></div>
      </div>
    </div>
    <section className="card report-preview">
      <div className="section-heading"><div><span className="eyebrow">PRÉVIA</span><h2>Resumo do fechamento</h2></div></div>
      <div className="preview-list">
        {selectedWorkers.map(p => { const own = approved.filter(e => e.worker_id === p.id); return <div key={p.id}><span>{p.full_name}</span><span>{own.length} registro{own.length === 1 ? '' : 's'}</span><strong>{formatMinutes(own.reduce((s,e) => s+e.minutes,0))}</strong></div> })}
        <div className="preview-total"><span>{workerId ? 'Total do manutentor' : 'Total geral'}</span><span>{approved.length} aprovado{approved.length === 1 ? '' : 's'}</span><strong>{formatMinutes(total)}</strong></div>
      </div>
    </section>
  </>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
