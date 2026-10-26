import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import type { Attachment, Entry } from '../lib/types'
import { activityLabel, attachmentIsImage } from '../lib/workflow'
import { mediaUrl } from '../lib/supabase'
export function EntryExtras({entry,demo}:{entry:Entry;demo:boolean}) {
  const [preview,setPreview]=useState<{media:Attachment;url:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function open(media:Attachment) {
    setBusy(true);setError('');setPreview(null)
    try {const url=demo ? media.path : await mediaUrl(media.path);setPreview({media,url})}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir o arquivo.')}
    finally{setBusy(false)}
  }
  return <>
    {Boolean(entry.activities?.length)&&<section className="detail-activities"><span className="eyebrow">ATIVIDADES REALIZADAS</span><ol>{entry.activities?.map((a,i)=><li key={i}>{activityLabel(a)}</li>)}</ol></section>}
    {Boolean(entry.participants?.length)&&<section className="detail-note"><span>PARTICIPANTES DO SERVIÇO</span><p>{entry.participants?.map(p=>p.name).join(', ')}</p><small>Participação informativa. As horas de cada pessoa são registradas separadamente.</small></section>}
    {Boolean(entry.attachments?.length)&&<section className="detail-media"><span className="eyebrow">FOTOS E VÍDEOS DO SERVIÇO</span><div className="attachment-links">{entry.attachments?.map(a=><button className="button secondary" key={a.path} disabled={busy} onClick={()=>void open(a)}><Paperclip size={15}/>{a.name}</button>)}</div><small>Arquivos disponíveis somente no sistema.</small>{busy&&<p role="status">Abrindo anexo…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{preview&&<div className="media-viewer">{attachmentIsImage(preview.media)?<img src={preview.url} alt={preview.media.name}/>:<video src={preview.url} controls autoPlay={false} preload="metadata" aria-label={preview.media.name}/>}<button className="text-link" onClick={()=>setPreview(null)}>Fechar visualização</button></div>}</section>}
  </>
}
