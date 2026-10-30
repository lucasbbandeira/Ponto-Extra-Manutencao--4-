import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
const file=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8')
test('Postgres: migração, preservação, autorização, anexos e escalonamento dos lembretes',async t=>{
 const db=new PGlite();let serial=100
 const ids=Array.from({length:7},(_,i)=>`${i+1}`.repeat(8)+'-'+`${i+1}`.repeat(4)+'-4'+`${i+1}`.repeat(3)+'-8'+`${i+1}`.repeat(3)+'-'+`${i+1}`.repeat(12))
 const uuid=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(serial++).padStart(12,'0')}`
 const checks=[];const ok=name=>checks.push(name)
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth,storage to authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`)
 for(const name of ['001_initial.sql','002_approval_workflow.sql','003_profile_deletion.sql','20261006034144_overtime_start_required_fields.sql'])await db.exec(file(`supabase/migrations/${name}`))
 await db.exec(`alter table overtime_entries add column is_holiday boolean not null default false;alter table overtime_entries alter column point_exit drop not null;alter table overtime_entries drop constraint overtime_required_information;`)
 await db.exec(file('tests/fixtures/holiday-required-information.sql'));
 await db.exec(file('tests/fixtures/holiday-validator.sql'));await db.exec(file('tests/fixtures/analyst-baseline.sql'))
 for(let i=0;i<ids.length;i++)await db.query('insert into auth.users(id,email) values($1,$2)',[ids[i],`fixture${i}@example.invalid`])
 await db.exec(`update profiles set active=true,approval_status='approved';update profiles set role='admin',can_approve=true,can_export=true where id='${ids[0]}';update profiles set role='supervisor',can_approve=true,can_export=true where id in ('${ids[1]}','${ids[2]}');update profiles set role='analyst',can_export=true where id='${ids[5]}';update profiles set active=false where id='${ids[6]}';`)
 await db.exec(file('ATUALIZAR-LOCAL-GLPI-LEMBRETES.sql'))
 const old=uuid();await db.query(`insert into overtime_entries(id,worker_id,work_date,normal_entry,point_exit,final_exit,note) values($1,$2,'2026-10-01','08:00','17:00','18:00','Antigo')`,[old,ids[3]])
 const before=(await db.query('select to_jsonb(e) data from overtime_entries e')).rows
 const profilesBefore=(await db.query('select to_jsonb(p) data from profiles p order by id')).rows
 const migration=file('ATUALIZAR-SISTEMA-COMPLETO.sql');await db.exec(migration);await db.exec(migration)
 const after=(await db.query("select to_jsonb(e)-array['workflow_version','activities','participants','attachments'] data from overtime_entries e")).rows
 assert.deepEqual(after,before);assert.deepEqual((await db.query("select to_jsonb(p)-'he_reminder_delay_hours' data from profiles p order by id")).rows,profilesBefore);ok('migração repetível preserva registros e contas, incluindo timestamps')
 async function actor(i){await db.exec('reset role');await db.query(`select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.sub',$2,false)`,[JSON.stringify({role:i==='service'?'service_role':'authenticated'}),i==='service'?'':ids[i]]);await db.exec(`set role ${i==='service'?'service_role':'authenticated'}`)}
 const activity=[{start:'18:00',end:'20:00',start_next_day:false,end_next_day:false,description:'Manutenção'}]
 async function submit(overrides={}){const x={id:uuid(),date:'2026-10-26',normal:'08:00',point:'17:00',start:'18:00',end:'20:00',next:false,note:'Teste',holiday:false,location:'Cozinha',glpi:'6438',activities:activity,helpers:[],media:[],...overrides};await db.query(`select submit_entry_v5($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[x.id,x.date,x.normal,x.point,x.start,x.end,x.next,x.note,x.holiday,x.location,x.glpi,JSON.stringify(x.activities),x.helpers,JSON.stringify(x.media)]);return x.id}
 async function revise(id,overrides={}){const x={date:'2026-10-26',normal:'08:00',point:'17:00',start:'18:00',end:'20:00',next:false,note:'Correção',holiday:false,location:'Cozinha',glpi:'6438',activities:activity,helpers:[],media:[],...overrides};await db.query(`select revise_entry_v5($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,x.date,x.normal,x.point,x.start,x.end,x.next,x.note,x.holiday,x.location,x.glpi,JSON.stringify(x.activities),x.helpers,JSON.stringify(x.media)])}
 await actor(3)
 const coworkers=(await db.query('select * from he_coworkers()')).rows;assert.ok(coworkers.some(p=>p.id===ids[4]));assert.ok(coworkers.every(p=>!('email'in p)&&p.id!==ids[6]));ok('lista de participantes expõe somente ID/nome dos manutentores ativos')
 const fresh=await submit({helpers:[ids[4]]});const stored=(await db.query('select * from overtime_entries where id=$1',[fresh])).rows[0];assert.equal(stored.workflow_version,2);assert.equal(stored.minutes,120);assert.equal(stored.participants[0].id,ids[4]);ok('novo fluxo e participante não adicionam horas nem criam lançamento alheio')
 await submit({id:fresh});assert.equal((await db.query('select count(*)::int n from overtime_entries where id=$1',[fresh])).rows[0].n,1);ok('reenvio com o mesmo identificador não duplica horas')
 for(const x of [{location:''},{glpi:' '},{activities:[]},{activities:[{...activity[0],start:'18:01'}]},{activities:[{...activity[0],end:'19:59'}]},{activities:[{...activity[0],description:''}]},{helpers:[ids[3]]},{helpers:[ids[6]]},{helpers:[ids[4],ids[4]]}])await assert.rejects(()=>submit(x));ok('banco recusa campos vazios, lacunas, atividades inválidas e participantes não autorizados')
 await assert.rejects(()=>db.query(`select submit_entry_v4('2026-10-26','08:00','17:00','18:00','20:00',false,'Antigo cliente',false,'Cozinha','123')`));ok('API antiga não permite contornar as novas exigências')
 const midnight=await submit({point:'21:00',start:'22:00',end:'02:00',next:true,activities:[{...activity[0],start:'22:00',end:'00:00',end_next_day:true},{...activity[0],start:'00:00',end:'02:00',start_next_day:true,end_next_day:true}]});assert.equal((await db.query('select minutes from overtime_entries where id=$1',[midnight])).rows[0].minutes,240);ok('virada de dia validada no banco')
 assert.ok(await submit({normal:null,point:null,holiday:true}));ok('feriado mantém dispensa do ponto normal')
 await actor(4);assert.equal((await db.query('select * from overtime_entries where id=$1',[fresh])).rows.length,0);ok('participação não libera acesso às horas do colega')
 await actor(5);await assert.rejects(()=>submit());await actor(6);await assert.rejects(()=>db.query('select * from he_coworkers()'));ok('analista não cadastra; inativo não consulta participantes')
 await actor(1);await db.query(`select review_entry($1,'rejected','Corrigir')`,[old]);await actor(3);await revise(old,{location:null,glpi:null,activities:[]});assert.equal((await db.query('select workflow_version from overtime_entries where id=$1',[old])).rows[0].workflow_version,1);ok('correção de registro antigo não exige campos e atividades retroativos')
 const mediaPath=`${ids[3]}/${uuid()}/${uuid()}.jpg`,attachment={path:mediaPath,name:'Foto.jpg',mime:'image/jpeg',size:1024}
 await db.query(`insert into storage.objects(bucket_id,name,metadata) values('he-service-media',$1,$2)`,[mediaPath,JSON.stringify({size:1024,mimetype:'image/jpeg'})]);ok('manutentor autorizado pode enviar arquivo na própria pasta')
 await actor(4);await assert.rejects(()=>db.query(`insert into storage.objects(bucket_id,name,metadata) values('he-service-media',$1,'{}')`,[mediaPath.replace('.jpg','x.jpg')]));assert.equal((await db.query('select * from storage.objects where name=$1',[mediaPath])).rows.length,0);ok('outro manutentor não lê nem envia arquivo na pasta alheia')
 await actor(1);assert.equal((await db.query('select * from storage.objects where name=$1',[mediaPath])).rows.length,0);ok('gestor não acessa anexo ainda não vinculado a lançamento')
 await actor(3);const withMedia=await submit({media:[attachment]});await assert.rejects(()=>submit({media:[{...attachment,size:2048}]}));ok('vínculo confere tamanho e tipo no Storage')
 assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[mediaPath])).rows.length,0);ok('anexo já vinculado não pode ser apagado pela API do manutentor')
 await actor(1);assert.equal((await db.query('select * from storage.objects where name=$1',[mediaPath])).rows.length,1);await actor(5);assert.equal((await db.query('select * from storage.objects where name=$1',[mediaPath])).rows.length,1);ok('gestor e analista autorizados consultam anexos vinculados')
 await actor(3);await assert.rejects(()=>db.query('select he_claim_batches()'));await assert.rejects(()=>db.query('select * from private.he_reminder_batches'));ok('fila permanece inacessível ao navegador')
 await actor(0);await db.query(`select admin_set_profile_v3($1,'supervisor',true,true,true,'Bogo',true,24)`,[ids[1]]);await db.query(`select admin_set_profile_v3($1,'supervisor',true,true,true,'Leonardo',true,48)`,[ids[2]]);ok('administrador configura prazos por conta, sem depender do nome')
 await actor(3);await assert.rejects(()=>db.query(`select admin_set_profile_v3($1,'supervisor',true,true,true,'Bogo',true,24)`,[ids[1]]));ok('manutentor não altera prazos')
 async function age(id,h){await db.exec('reset role');await db.exec('alter table overtime_entries disable trigger overtime_reminder_start');await db.query(`update overtime_entries set reminder_started_at=now()-($2*interval '1 hour') where id=$1`,[id,h]);await db.exec('alter table overtime_entries enable trigger overtime_reminder_start');await db.query('update private.he_reminder_receipts r set started_at=e.reminder_started_at from overtime_entries e where e.id=$1 and r.entry_id=e.id',[id])}
 await age(fresh,25);await age(old,25);await actor('service')
 const claim=async()=>(await db.query('select he_claim_batches() data')).rows[0].data
 const prepare=async(id)=>(await db.query('select he_prepare_batch($1) data',[id])).rows[0].data
 const finish=async(id,result)=>db.query('select he_complete_batch($1,$2,null)',[id,result])
 let batches=await claim();assert.equal(batches.length,1);let batch=await prepare(batches[0].id);assert.equal(batch.email,'fixture1@example.invalid');assert.deepEqual(batch.entries.map(e=>e.id),[fresh]);await finish(batch.id,'sent');ok('24h: só o primeiro gestor recebe; registro antigo mantém prazo original')
 assert.equal((await claim()).length,0);ok('lembrete enviado não repete antes de 24h')
 await age(fresh,49);await actor('service');batches=await claim();assert.equal(batches.length,1);batch=await prepare(batches[0].id);assert.equal(batch.email,'fixture2@example.invalid');await finish(batch.id,'sent');ok('48h: segundo gestor recebe o mesmo lançamento ainda pendente')
 await db.exec('reset role');await db.exec("update private.he_reminder_receipts set last_sent_at=now()-interval '24 hours 1 minute'");await actor('service');batches=await claim();assert.equal(batches.length,2);ok('ambos recebem novamente após intervalo diário')
 await actor(1);await db.query(`select review_entry($1,'approved',null)`,[fresh]);await actor('service');for(const b of batches)assert.equal(await prepare(b.id),null);ok('aprovação antes do envio cancela lembretes montados')
 await age(withMedia,49);await actor('service');batches=await claim();for(const b of batches){await prepare(b.id);await finish(b.id,'unknown')}assert.equal((await claim()).length,0);ok('falha incerta de provedor não duplica e-mails')
 await db.exec('reset role');await db.exec(migration);assert.equal((await db.query('select he_reminder_delay_hours from profiles where id=$1',[ids[1]])).rows[0].he_reminder_delay_hours,24);ok('reexecutar atualização preserva prazos configurados')

 await db.exec('reset role');
 const simplified=file('ATUALIZAR-CADASTRO-SIMPLIFICADO.sql');
 const preserved=(await db.query("select id,to_jsonb(e)-'overtime_only' data from overtime_entries e order by id")).rows;
 await db.exec(simplified);await db.exec(simplified);
 assert.deepEqual((await db.query("select id,to_jsonb(e)-'overtime_only' data from overtime_entries e order by id")).rows,preserved);
 ok('atualização simplificada repetível preserva todas as horas, atividades e timestamps');
 async function simple(overrides={}) {
  const x={id:uuid(),date:'2026-10-30',normal:null,point:null,start:'06:00',end:'08:00',next:false,note:'Serviço antes do expediente',holiday:false,location:'Cozinha',glpi:'7000',only:true,...overrides};
  await db.query(`select submit_entry_v6($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb,'{}'::uuid[],'[]'::jsonb,$12)`,[x.id,x.date,x.normal,x.point,x.start,x.end,x.next,x.note,x.holiday,x.location,x.glpi,x.only]);return x.id;
 }
 await actor(3);const simpleId=await simple();
 let simpleRow=(await db.query('select * from overtime_entries where id=$1',[simpleId])).rows[0];
 assert.equal(simpleRow.minutes,120);assert.equal(simpleRow.is_holiday,false);assert.equal(simpleRow.overtime_only,true);assert.equal(simpleRow.normal_entry,null);assert.equal(simpleRow.point_exit,null);assert.deepEqual(simpleRow.activities,[]);assert.equal(simpleRow.workflow_version,3);
 await simple({id:simpleId});assert.equal((await db.query('select count(*)::int n from overtime_entries where id=$1',[simpleId])).rows[0].n,1);
 ok('nova opção aceita HE antes do expediente sem ponto, sem atividades e sem marcar feriado; envio idempotente');
 for(const invalid of [{only:false},{only:null},{note:' '},{location:''},{glpi:''},{start:null},{end:null},{start:'08:00',end:'08:00'},{next:null}])await assert.rejects(()=>simple(invalid));
 const normalId=await simple({only:false,normal:'08:00',point:'17:00',start:'18:00',end:'19:00'});
 assert.equal((await db.query('select minutes from overtime_entries where id=$1',[normalId])).rows[0].minutes,60);
 await assert.rejects(()=>simple({only:false,normal:'08:00',point:'17:00',start:'06:00'}));
 const hol=await simple({only:false,holiday:true});assert.equal((await db.query('select is_holiday from overtime_entries where id=$1',[hol])).rows[0].is_holiday,true);
 const late=await simple({start:'23:00',end:'02:00',next:true});assert.equal((await db.query('select minutes from overtime_entries where id=$1',[late])).rows[0].minutes,180);
 ok('campos obrigatórios e limite de HE preservados nos modos normal, feriado e somente HE, incluindo virada de dia');
 await actor(5);await assert.rejects(()=>simple());await actor(6);await assert.rejects(()=>simple());
 await actor(1);await db.query(`select review_entry($1,'rejected','Corrigir resumo')`,[withMedia]);
 const historicalActivities=(await db.query('select activities from overtime_entries where id=$1',[withMedia])).rows[0].activities;
 await actor(4);await assert.rejects(()=>db.query(`select revise_entry_v6($1,'2026-10-30',null,null,'06:00','08:00',false,'Correção',false,'Cozinha','7000','[]','{}','[]',true)`,[withMedia]));
 await actor(3);await db.query(`select revise_entry_v6($1,'2026-10-30',null,null,'06:00','08:00',false,'Correção',false,'Cozinha','7000','[]','{}',$2,true)`,[withMedia,JSON.stringify([attachment])]);
 const revised=(await db.query('select * from overtime_entries where id=$1',[withMedia])).rows[0];assert.deepEqual(revised.activities,historicalActivities);assert.equal(revised.overtime_only,true);assert.equal(revised.is_holiday,false);assert.equal(revised.status,'pending');assert.equal(revised.minutes,120);assert.equal(revised.attachments.length,1);
 ok('correção autorizada preserva atividades e anexos antigos; analista, inativo e colega não cadastram/corrigem');
 await actor('service');assert.ok(Array.isArray(await claim()));ok('rotina de lembretes permanece funcional após atualização');
 t.diagnostic(`${checks.length} verificações: ${checks.join('; ')}`)
 } finally {await db.close()}
})
