import { newId } from '../lib/id'
import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ArrowRight, Clock3, Plus, X, Paperclip } from 'lucide-react'
import type { Coworker, Entry, EntryInput, ServiceActivity } from '../lib/types'
import { formatMinutes, localToday, overtimeMinutes, overtimeStart, validOvertime } from '../lib/time'
import { attachmentError, MAX_ACTIVITIES, MEDIA_TYPES, workflowValidationError } from '../lib/workflow'

const emptyActivity = (start = '', next = false): ServiceActivity => ({ start, end:'', start_next_day:next, end_next_day:next, description:'' })
function FilePreview({file}: {file: File}) {
  const [url,setUrl]=useState('')
  useEffect(()=>{const value=URL.createObjectURL(file);setUrl(value);return ()=>URL.revokeObjectURL(value)},[file])
  return file.type.startsWith('image/') ? <img src={url} alt={`Prévia de ${file.name}`}/> : <video src={url} controls preload="metadata" aria-label={`Prévia de ${file.name}`}/>
}
export function EntryForm({ entry, busy, coworkers, workerId, onClose, onSave }: {
  entry:Entry|null; busy:boolean; coworkers:Coworker[]; workerId:string;
  onClose:()=>void; onSave:(input:EntryInput,files:File[])=>Promise<void>;
}) {
  const legacy=Boolean(entry && entry.workflow_version !== 2)
  const [requestId]=useState(()=>entry?.id ?? newId())
  const [input,setInput]=useState<EntryInput>(()=>({ request_id:requestId,work_date:entry?.work_date ?? localToday(),normal_entry:entry?.normal_entry?.slice(0,5) ?? '',point_exit:entry?.point_exit?.slice(0,5) ?? '',overtime_start:entry ? overtimeStart(entry):'',final_exit:entry?.final_exit.slice(0,5) ?? '',final_exit_next_day:entry?.final_exit_next_day ?? false,is_holiday:entry?.is_holiday ?? false,location:entry?.location ?? '',glpi:entry?.glpi ?? '',note:entry?.note ?? '',activities:entry?.activities?.length ? entry.activities.map(a=>({...a})):[emptyActivity()],helper_ids:entry?.participants?.map(p=>p.id) ?? [],attachments:entry?.attachments ?? [] }))
  const [helped,setHelped]=useState(Boolean(entry?.participants?.length))
  const [files,setFiles]=useState<File[]>([]),[fileError,setFileError]=useState('')
  const rows=input.activities ?? []
  const participants=[...coworkers]
  for(const p of entry?.participants ?? []) if(!participants.some(c=>c.id===p.id)) participants.push({id:p.id,full_name:`${p.name} (registro anterior)`})
  const change=<K extends keyof EntryInput>(key:K,value:EntryInput[K])=>setInput(old=>{
    const next={...old,[key]:value}
    if ((key==='overtime_start' || key==='final_exit') && next.activities?.length===1) {
      next.activities=next.activities.map(a=>({...a,...(key==='overtime_start' && !a.start ? {start:String(value)} : {}),...(key==='final_exit' && !a.end ? {end:String(value),end_next_day:next.final_exit_next_day} : {})}))
    }
    return next
  })
  const editActivity=(index:number,values:Partial<ServiceActivity>)=>change('activities',rows.map((a,i)=>i===index ? {...a,...values}:a))
  const validation=workflowValidationError(input,legacy)
  const validDuration=validOvertime(input.overtime_start,input.final_exit,input.final_exit_next_day)
  const close=()=>{if(!busy)onClose()}
  function chooseFiles(event:ChangeEvent<HTMLInputElement>) {
    const next=[...files,...Array.from(event.target.files ?? [])]
    const invalid=attachmentError(next,input.attachments?.length ?? 0)
    setFileError(invalid ?? '')
    if(!invalid)setFiles(next)
    event.target.value=''
  }
  function send(event:FormEvent) {event.preventDefault();if(!validation && !busy)void onSave({...input,note:input.note.trim(),helper_ids:helped ? input.helper_ids:[],activities:legacy ? entry?.activities ?? []:rows},files)}
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal form-modal detailed-form" role="dialog" aria-modal="true" aria-label={entry ? 'Corrigir lançamento':'Nova hora extra'}>
    <div className="modal-head"><div><span className="eyebrow">{entry?'CORREÇÃO SOLICITADA':'NOVO LANÇAMENTO'}</span><h2>{entry?'Corrigir hora extra':'Registrar hora extra'}</h2></div><button className="circle-button" disabled={busy} onClick={close} aria-label="Fechar"><X size={20}/></button></div>
    <form onSubmit={send}><div className="modal-body"><fieldset disabled={busy} className="form-fieldset">
      {entry?.rejection_reason && <div className="form-error">Motivo da devolução: {entry.rejection_reason}</div>}
      <div className="help-box"><Clock3 size={20}/><p>Informe os horários e explique as atividades realizadas durante a hora extra. Preparação, deslocamento, testes e esperas também podem ser registrados.</p></div>
      {legacy && <div className="legacy-notice">Registro anterior à atualização: localização, GLPI e atividades não serão exigidos retroativamente.</div>}
      <label className="holiday-option"><input type="checkbox" checked={input.is_holiday} onChange={e=>change('is_holiday',e.target.checked)}/><span><strong>Trabalho em feriado</strong><small>Sem ponto normal. Informe somente os horários da hora extra.</small></span></label>
      <div className="form-grid"><label>Data do trabalho <span>*</span><input required type="date" value={input.work_date} onChange={e=>change('work_date',e.target.value)}/></label>
      <label>Entrada normal {!input.is_holiday&&<span>*</span>}<input required={!input.is_holiday} disabled={input.is_holiday || busy} type="time" value={input.is_holiday?'':input.normal_entry} onChange={e=>change('normal_entry',e.target.value)}/>{input.is_holiday&&<small>Não se aplica em feriado</small>}</label>
      <label>Saída normal (batida do ponto) {!input.is_holiday&&<span>*</span>}<input required={!input.is_holiday} disabled={input.is_holiday || busy} type="time" value={input.is_holiday?'':input.point_exit} onChange={e=>change('point_exit',e.target.value)}/></label>
      <label>Início da hora extra <span>*</span><input required type="time" value={input.overtime_start} onChange={e=>change('overtime_start',e.target.value)}/></label>
      <label>Término da hora extra <span>*</span><input required type="time" value={input.final_exit} onChange={e=>change('final_exit',e.target.value)}/></label></div>
      <label className="check-line"><input type="checkbox" checked={input.final_exit_next_day} onChange={e=>change('final_exit_next_day',e.target.checked)}/> O término da hora extra foi no dia seguinte</label>
      <div className="form-grid optional-context"><label>Localização {!legacy&&<span>*</span>}<input required={!legacy} maxLength={200} placeholder="Ex.: cozinha principal" value={input.location??''} onChange={e=>change('location',e.target.value)}/></label><label>GLPI {!legacy&&<span>*</span>}<input required={!legacy} maxLength={100} placeholder="Número do chamado" value={input.glpi??''} onChange={e=>change('glpi',e.target.value)}/></label></div>
      <label className="full-label">Resumo do serviço <span>*</span><textarea required maxLength={1000} rows={2} placeholder="Qual problema foi atendido e qual serviço foi realizado?" value={input.note} onChange={e=>change('note',e.target.value)}/></label>
      {!legacy&&<section className="activity-editor"><div className="section-heading"><div><span className="eyebrow">DETALHAMENTO OBRIGATÓRIO</span><h3>Atividades realizadas <span>*</span></h3></div></div><p className="field-hint">Preencha em ordem, sem deixar intervalos sem explicação. Em cada horário, marque “+1 dia” se ocorreu depois da meia-noite.</p>
        {rows.map((a,i)=><div className="activity-edit-row" key={i}><strong className="activity-number">{i+1}</strong><div className="activity-times"><label>Início<input required type="time" aria-label={`Início da atividade ${i+1}`} value={a.start} onChange={e=>editActivity(i,{start:e.target.value})}/></label><label>Fim<input required type="time" aria-label={`Fim da atividade ${i+1}`} value={a.end} onChange={e=>editActivity(i,{end:e.target.value})}/></label><label className="check-line"><input type="checkbox" aria-label={`Início no dia seguinte da atividade ${i+1}`} checked={a.start_next_day} onChange={e=>editActivity(i,{start_next_day:e.target.checked})}/> Início +1 dia</label><label className="check-line"><input type="checkbox" aria-label={`Fim no dia seguinte da atividade ${i+1}`} checked={a.end_next_day} onChange={e=>editActivity(i,{end_next_day:e.target.checked})}/> Fim +1 dia</label></div><label className="activity-description">O que foi realizado?<textarea required maxLength={300} rows={2} aria-label={`Descrição da atividade ${i+1}`} placeholder="Ex.: retirada de materiais no almoxarifado" value={a.description} onChange={e=>editActivity(i,{description:e.target.value})}/></label><button type="button" className="circle-button" aria-label={`Remover atividade ${i+1}`} disabled={rows.length===1} onClick={()=>change('activities',rows.filter((_,index)=>index!==i))}><X size={17}/></button></div>)}
        <button type="button" className="button secondary" disabled={rows.length>=MAX_ACTIVITIES} onClick={()=>change('activities',[...rows,emptyActivity(rows.at(-1)?.end || input.overtime_start,rows.at(-1)?.end_next_day ?? false)])}><Plus size={16}/> Adicionar atividade</button>
      </section>}
      <section className="optional-section"><label className="check-line"><input type="checkbox" checked={helped} onChange={e=>{setHelped(e.target.checked);if(!e.target.checked)change('helper_ids',[])}}/> Teve ajuda de outro manutentor? <small>(opcional)</small></label>{helped&&<><p className="field-hint">Selecione quem participou. Cada pessoa continua lançando suas próprias horas.</p><div className="coworkers-list">{participants.filter(p=>p.id!==workerId).map(p=><label className="check-line" key={p.id}><input type="checkbox" checked={input.helper_ids?.includes(p.id)??false} onChange={e=>change('helper_ids',e.target.checked?[...(input.helper_ids??[]),p.id]:(input.helper_ids??[]).filter(id=>id!==p.id))}/>{p.full_name}</label>)}{!participants.some(p=>p.id!==workerId)&&<p>Nenhum outro manutentor disponível.</p>}</div>{!input.helper_ids?.length&&<small>Selecione pelo menos uma pessoa ou desmarque a opção.</small>}</>}</section>
      <section className="optional-section"><h3><Paperclip size={17}/> Fotos e vídeos do serviço <small>(opcional)</small></h3><p className="field-hint">Até 5 arquivos, com até 20 MB cada. JPG, PNG, WEBP, GIF, MP4, WEBM ou MOV. Os anexos ficam somente no sistema.</p><label className="media-picker">Selecionar fotos ou vídeos<input type="file" multiple accept={MEDIA_TYPES.join(',')} onChange={chooseFiles} aria-label="Selecionar fotos ou vídeos"/></label>
        {fileError&&<div role="alert" className="form-error">{fileError}</div>}
        <div className="media-previews">{input.attachments?.map(a=><div className="media-file" key={a.path}><Paperclip size={22}/><span>{a.name}</span><button type="button" className="text-link" onClick={()=>{change('attachments',input.attachments?.filter(x=>x.path!==a.path));setFileError('')}}>Remover anexo</button></div>)}{files.map((f,i)=><div className="media-file" key={`${f.name}-${i}`}><FilePreview file={f}/><span>{f.name} · {(f.size/1048576).toFixed(1)} MB</span><button type="button" className="text-link" aria-label={`Remover arquivo ${f.name}`} onClick={()=>{setFiles(old=>old.filter((_,index)=>index!==i));setFileError('')}}>Remover</button></div>)}</div></section>
      <div className="calculation"><div><span>TOTAL CALCULADO</span><strong>{validDuration?formatMinutes(overtimeMinutes(input.overtime_start,input.final_exit,input.final_exit_next_day)):'—'}</strong></div><p>O total usa o início e o término gerais. As atividades explicam esse período.</p></div>
      {validation&&<p className="form-validation" role="status">{validation}</p>}
    </fieldset></div><div className="modal-footer"><button type="button" disabled={busy} className="button ghost" onClick={close}>Cancelar</button><button type="submit" disabled={busy || Boolean(validation) || (helped&&!input.helper_ids?.length)} className="button primary">{busy?'Enviando…':entry?'Reenviar para análise':'Enviar para aprovação'}<ArrowRight size={17}/></button></div></form>
  </div></div>
}
