// Arquivo único: pode ser publicado pelo Dashboard do Supabase ou pela CLI.
// Nenhum segredo deste arquivo deve ser copiado para variáveis VITE_*.
type Env = (name: string) => string | undefined
type Item = { id: string; worker: string; work_date: string; minutes: number; location?: string; glpi?: string }
type Batch = { id: string; email: string; entries: Item[] }
type Fetcher = typeof fetch
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const hours = (minutes: number) => `${Math.floor(minutes/60)}h${String(minutes%60).padStart(2,'0')}`
const date = (value: string) => value.split('-').reverse().join('/')

export function reminderMessage(batch: Batch, appUrl: string) {
  const lines = batch.entries.map(e => `${e.worker} | ${date(e.work_date)} | ${hours(e.minutes)} | Localização: ${e.location || 'Não informado'} | GLPI: ${e.glpi || 'Não informado'}`)
  const text = `Prezados gestores,\n\nOs lançamentos abaixo aguardam análise há mais de 48 horas desde o envio:\n\n${lines.join('\n')}\n\nPor gentileza, acessem o sistema para conferir e aprovar ou devolver para correção.\n\nAcessar o sistema: ${appUrl}\n\nEste lembrete é automático. Se o lançamento foi analisado recentemente, confira a situação atual no sistema.\nPonto Extra · Manutenção`
  const rows = batch.entries.map(e => `<tr><td>${escapeHtml(e.worker)}</td><td>${escapeHtml(date(e.work_date))}</td><td>${escapeHtml(hours(e.minutes))}</td><td>${escapeHtml(e.location || 'Não informado')}</td><td>${escapeHtml(e.glpi || 'Não informado')}</td></tr>`).join('')
  const html = `<html><body style="font-family:Arial,sans-serif;color:#233b48;line-height:1.6"><h2>Horas extras aguardando análise</h2><p>Prezados gestores,</p><p>Os lançamentos abaixo aguardam análise há <strong>mais de 48 horas desde o envio</strong>:</p><table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#dbe3e8"><thead><tr><th>Manutentor</th><th>Data do trabalho</th><th>Horas extras</th><th>Localização</th><th>GLPI</th></tr></thead><tbody>${rows}</tbody></table><p>Por gentileza, acessem o sistema para conferir e aprovar ou devolver para correção.</p><p><a href="${escapeHtml(appUrl)}">Acessar o sistema</a></p><small>Este lembrete é automático. Se o lançamento foi analisado recentemente, confira a situação atual no sistema.<br>Ponto Extra · Manutenção</small></body></html>`
  return { subject: 'Horas extras pendentes de análise há mais de 48 horas', text, html }
}

async function sameSecret(a: string, b: string) {
  const encoder = new TextEncoder()
  const [x,y] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))])
  const first = new Uint8Array(x), second = new Uint8Array(y)
  let diff = 0; for (let i=0;i<first.length;i++) diff |= first[i]^second[i]
  return diff===0
}

export function createReminderHandler(env: Env, fetcher: Fetcher = fetch) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
    if (request.method!=='POST') return reply({error:'method_not_allowed'},405)
    const secret = env('HE_REMINDER_SECRET') || ''
    if (secret.length<32) return reply({error:'configuration_missing'},503)
    if (!await sameSecret(request.headers.get('x-he-reminder-secret') || '',secret)) return reply({error:'unauthorized'},401)
    const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY')
    const apiKey = env('BREVO_API_KEY'), from = env('HE_MAIL_FROM')
    const appUrl = env('HE_APP_URL') || 'https://horaextramanutencao.vercel.app/'
    if (!url?.startsWith('https://') || !service || !apiKey || !from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || !appUrl.startsWith('https://')) return reply({error:'configuration_missing'},503)
    let mode = 'send'
    try { const input=await request.json(); mode=input?.mode || 'send' } catch { /* Cron pode enviar um objeto vazio. */ }
    if (!['send','check'].includes(mode)) return reply({error:'invalid_mode'},400)
    async function rpc(name: string,args: object = {}) {
      const response = await fetcher(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':service!,'Authorization':`Bearer ${service}`},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)})
      if (!response.ok) throw new Error(`database_${response.status}`)
      return await response.json()
    }
    try {
      if (mode==='check') {
        const status = await rpc('he_reminder_health')
        const provider = await fetcher('https://api.brevo.com/v3/account',{headers:{'api-key':apiKey},signal:AbortSignal.timeout(15000)})
        return reply({ok:provider.ok,mode:'check',provider_authorized:provider.ok,...status},provider.ok ? 200 : 502)
      }
      const batches: {id:string}[] = await rpc('he_claim_batches')
      let sent=0,failed=0,unknown=0,skipped=0
      for (const candidate of batches) {
        const batch: Batch | null = await rpc('he_prepare_batch',{p_batch_id:candidate.id})
        if (!batch?.entries?.length) { skipped++; continue }
        const message = reminderMessage(batch,appUrl)
        let result: 'sent'|'failed'|'unknown' = 'unknown', providerId: string | null = null
        try {
          const response = await fetcher('https://api.brevo.com/v3/smtp/email',{
            method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','api-key':apiKey},
            body:JSON.stringify({sender:{name:env('HE_MAIL_FROM_NAME') || 'Ponto Extra · Manutenção',email:from},to:[{email:batch.email}],subject:message.subject,textContent:message.text,htmlContent:message.html,headers:{idempotencyKey:batch.id},tags:['he-48h']}),
            signal:AbortSignal.timeout(20000)
          })
          if (response.ok) {
            result='sent'
            try { providerId=(await response.json()).messageId || null } catch { /* HTTP de sucesso já confirma a aceitação. */ }
          } else { result=response.status>=500 ? 'unknown' : 'failed'; providerId=`http_${response.status}` }
        } catch { result='unknown' }
        // Se a confirmação no banco falhar após enviar, o lote expira como unknown, evitando duplicidade.
        await rpc('he_complete_batch',{p_batch_id:batch.id,p_result:result,p_provider_id:providerId})
        if (result==='sent') sent++; else if(result==='failed') failed++; else unknown++
        console.log(JSON.stringify({batch:batch.id,result,provider:providerId}))
      }
      return reply({ok:failed===0 && unknown===0,sent,failed,unknown,skipped},failed || unknown ? 502 : 200)
    } catch { console.error('he-reminders: database_or_runtime_error'); return reply({error:'database_or_runtime_error'},500) }
  }
}

declare const Deno: {env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
if (typeof Deno!=='undefined') Deno.serve(createReminderHandler(name=>Deno.env.get(name)))
