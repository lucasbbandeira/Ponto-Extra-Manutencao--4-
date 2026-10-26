import { useMemo, useState } from 'react'
import { Download, Clock3, ClipboardList, CalendarDays } from 'lucide-react'
import type { Entry, Profile } from '../lib/types'
import { comparison } from '../lib/analytics'
import { formatMinutes, localToday } from '../lib/time'
import { makeComparisonReport } from '../lib/report'
export function Comparisons({entries,profiles,canExport}:{entries:Entry[];profiles:Profile[];canExport:boolean}) {
  const today=localToday().slice(0,7)
  const [from,setFrom]=useState(()=>{const date=new Date(`${today}-15T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()-2);return date.toISOString().slice(0,7)}),[to,setTo]=useState(today),[worker,setWorker]=useState(''),[error,setError]=useState('')
  const result=useMemo(()=>{try{return {data:comparison(entries,from,to,worker),error:''}}catch(e){return {data:null,error:e instanceof Error?e.message:'Confira o período.'}}},[entries,from,to,worker])
  const data=result.data
  const workers=profiles.filter(p=>p.role==='maintainer'||entries.some(e=>e.worker_id===p.id))
  function download() {
    if(!data)return
    try {
      const report=makeComparisonReport(data,profiles,from,to,worker)
      const href=URL.createObjectURL(report.blob),link=document.createElement('a');link.href=href;link.download=report.filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(href),60000)
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível exportar.')}
  }
  const max=Math.max(60,...(data?.monthly.flatMap(r=>[r.approved,r.pending])??[]))
  const localMax=Math.max(60,...(data?.locations.map(r=>r.approved)??[]))
  return <><div className="page-head"><div><span className="eyebrow">ANÁLISE DA MANUTENÇÃO</span><h1>Comparativos de horas.</h1><p>Acompanhe a evolução mensal e os locais atendidos.</p></div>{canExport&&<button className="button primary" onClick={download} disabled={!data?.selected.length}><Download size={17}/> Exportar comparativo .xlsx</button>}</div>
    <section className="card comparison-filters"><label>De<input type="month" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="month" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Manutentor<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="">Toda a equipe</option>{workers.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label></section>
    {(error||result.error)&&<p role="alert" className="form-error">{error||result.error}</p>}
    {data&&<><div className="stats-grid comparison-stats"><div className="stat-card"><Clock3 size={20}/><span>Horas aprovadas</span><strong>{formatMinutes(data.approved)}</strong><small>Total principal do período</small></div><div className="stat-card"><Clock3 size={20}/><span>Horas pendentes</span><strong>{formatMinutes(data.pending)}</strong><small>Ainda não validadas</small></div><div className="stat-card"><ClipboardList size={20}/><span>Atendimentos aprovados</span><strong>{data.services}</strong><small>GLPI + data do trabalho</small></div><div className="stat-card"><CalendarDays size={20}/><span>Variação entre os últimos meses</span><strong>{data.change===null?'—':`${data.change>0?'+':''}${data.change.toFixed(1)}%`}</strong><small>{data.change===null?'Sem base aprovada no mês anterior':'Horas aprovadas; meses finais do filtro'}</small></div></div>
    <div className="charts-grid"><section className="card"><div className="section-heading"><h2>Evolução mensal</h2></div><div className="comparison-legend"><span><i className="approved-dot"/> Aprovadas</span><span><i className="pending-dot"/> Pendentes</span></div><div className="comparison-bars">{data.monthly.map(r=><div key={r.label}><strong>{r.label.split('-').reverse().join('/')}</strong><div className="comparison-bar"><span>Aprovadas: {formatMinutes(r.approved)}</span><div className="status-bar-track"><div style={{width:`${r.approved/max*100}%`,background:'#5ca27e'}}/></div></div><div className="comparison-bar"><span>Pendentes: {formatMinutes(r.pending)}</span><div className="status-bar-track"><div style={{width:`${r.pending/max*100}%`,background:'#d8954e'}}/></div></div></div>)}</div></section>
    <section className="card"><div className="section-heading"><h2>Horas aprovadas por localização</h2></div><div className="comparison-bars">{data.locations.map(r=><div key={r.label}><strong>{r.label}</strong><div className="comparison-bar"><span>{formatMinutes(r.approved)} aprovadas · {r.services} atendimento(s)</span><div className="status-bar-track"><div style={{width:`${r.approved/localMax*100}%`,background:'#5b9db1'}}/></div></div></div>)}{!data.locations.length&&<p>Nenhum lançamento no período.</p>}</div></section></div>
    <section className="card comparison-table"><h2>Locais atendidos</h2><div className="table-wrap"><table><thead><tr><th>Localização informada</th><th>Atendimentos aprovados</th><th>Horas aprovadas</th><th>Horas pendentes</th></tr></thead><tbody>{data.locations.map(r=><tr key={r.label}><td>{r.label}</td><td>{r.services}</td><td>{formatMinutes(r.approved)}</td><td>{formatMinutes(r.pending)}</td></tr>)}</tbody></table></div><p className="field-hint">Localizações são agrupadas exatamente como preenchidas. Registros antigos sem local aparecem como “Não informado”. Cada GLPI na mesma data conta uma vez; sem GLPI, cada lançamento conta um atendimento. Somente registros aprovados entram na contagem de atendimentos. O detalhamento exportado permite conferir os agrupamentos. Pessoas diferentes somam suas próprias horas.</p></section>
    {!data.selected.length&&<p role="status">Nenhum lançamento encontrado para esta seleção.</p>}</>}
  </>
}
