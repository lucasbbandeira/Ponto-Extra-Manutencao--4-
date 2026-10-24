import assert from 'node:assert/strict'
import test from 'node:test'
import {createReminderHandler,reminderMessage} from '../supabase/functions/he-reminders/index.ts'
const secret='a'.repeat(64)
const settings={HE_REMINDER_SECRET:secret,SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',BREVO_API_KEY:'mail-only',HE_MAIL_FROM:'sender@example.invalid'}
const request=(body={})=>new Request('https://function.example.invalid',{method:'POST',headers:{'x-he-reminder-secret':secret,'Content-Type':'application/json'},body:JSON.stringify(body)})
const batch={id:'batch1',email:'gestor@example.invalid',entries:[{id:'entry1',worker:'Maycon <script>',work_date:'2026-10-24',minutes:150,location:'Cozinha & teste',glpi:'#99'}]}
function mock(outcome='sent',empty=false){const calls=[];const fetcher=async(url,options)=>{
 const body=options?.body ? JSON.parse(options.body):null;calls.push({url,options,body})
 if(url.endsWith('he_claim_batches'))return Response.json([{id:batch.id}])
 if(url.endsWith('he_prepare_batch'))return Response.json(empty?null:batch)
 if(url.endsWith('he_complete_batch'))return Response.json(null)
 if(url.endsWith('he_reminder_health'))return Response.json({recipients:2,overdue:0})
 if(url.endsWith('/v3/account'))return Response.json({plan:[]})
 if(url.endsWith('/smtp/email')){if(outcome==='timeout')throw new Error('timeout');if(outcome==='denied')return Response.json({}, {status:401});if(outcome==='unavailable')return Response.json({}, {status:503});return Response.json({messageId:'provider1'},{status:201})}
 throw new Error('unexpected url')
 };return {calls,handler:createReminderHandler(name=>settings[name],fetcher)}}
test('requisição sem segredo é recusada antes de consultar dados',async()=>{const {handler,calls}=mock();assert.equal((await handler(new Request('https://function.example.invalid',{method:'POST'}))).status,401);assert.equal(calls.length,0)})
test('GET recusado; credenciais ausentes não iniciam fila',async()=>{const {handler}=mock();assert.equal((await handler(new Request('https://function.example.invalid'))).status,405);const h=createReminderHandler(name=>name==='HE_REMINDER_SECRET'?secret:undefined,()=>{throw Error('não consultar')});assert.equal((await h(request())).status,503)})
test('e-mail agrupa pendências, saúda gestores e escapa conteúdo livre',()=>{const m=reminderMessage(batch,'https://horaextramanutencao.vercel.app/');assert.match(m.text,/Prezados gestores/);assert.match(m.text,/2h30/);assert.match(m.html,/Maycon &lt;script&gt;/);assert.match(m.html,/Cozinha &amp; teste/);assert.doesNotMatch(m.html,/<script>/)})
test('envio tem destinatário do banco, chave só no servidor e confirmação de sucesso',async()=>{const {handler,calls}=mock();assert.equal((await handler(request())).status,200);const mail=calls.find(c=>c.url.endsWith('/smtp/email'));assert.deepEqual(mail.body.to,[{email:batch.email}]);assert.equal(mail.body.headers.idempotencyKey,batch.id);assert.equal(mail.options.headers['api-key'],'mail-only');assert.equal(calls.at(-1).body.p_result,'sent')})
test('lote cancelado na reconferência não envia mensagem',async()=>{const {handler,calls}=mock('sent',true);assert.equal((await handler(request())).status,200);assert.ok(!calls.some(c=>c.url.endsWith('/smtp/email')))})
for(const [outcome,result] of [['timeout','unknown'],['denied','failed'],['unavailable','unknown']])test(`resultado ${outcome} é registrado como ${result}`,async()=>{const {handler,calls}=mock(outcome);assert.equal((await handler(request())).status,502);assert.equal(calls.at(-1).body.p_result,result)})
test('diagnóstico verifica banco/provedor sem enviar nem consumir lembretes',async()=>{const {handler,calls}=mock();const response=await handler(request({mode:'check'}));assert.equal(response.status,200);assert.equal((await response.json()).recipients,2);assert.ok(!calls.some(c=>c.url.endsWith('/smtp/email')||c.url.endsWith('he_claim_batches')))})
