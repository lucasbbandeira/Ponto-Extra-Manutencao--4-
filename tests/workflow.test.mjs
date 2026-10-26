import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowValidationError,attachmentError,detailedDescription,activityValidationError} from '../src/lib/workflow.ts'
import {comparison,uniqueServices} from '../src/lib/analytics.ts'
import {makeReport,makeComparisonReport} from '../src/lib/report.ts'
const row=(start,end,description='Manutenção',start_next_day=false,end_next_day=false)=>({start,end,description,start_next_day,end_next_day})
const base={work_date:'2026-10-26',is_holiday:false,normal_entry:'08:00',point_exit:'17:00',overtime_start:'18:00',final_exit:'20:00',final_exit_next_day:false,note:'Reparo na cozinha',location:'Cozinha',glpi:'100',activities:[row('18:00','18:15','Materiais'),row('18:15','20:00')],helper_ids:[]}
test('novo cadastro exige local, GLPI, resumo e atividades; histórico mantém compatibilidade',()=>{
 assert.equal(workflowValidationError(base),null)
 for(const key of ['location','glpi','note'])assert.ok(workflowValidationError({...base,[key]:''}),key)
 assert.ok(workflowValidationError({...base,activities:[]}))
 assert.equal(workflowValidationError({...base,location:'',glpi:'',activities:[]},true),null)
})
test('atividades recusam lacunas, sobreposição, descrição vazia e período incompleto',()=>{
 for(const activities of [[row('18:01','20:00')],[row('18:00','18:15'),row('18:10','20:00')],[row('18:00','19:00')],[row('18:00','20:01')],[row('18:00','20:00',' ')],[row('18:00','20:00','x'.repeat(301))],[row('18:00','18:00')]])assert.ok(activityValidationError({...base,activities}))
})
test('atividades à meia-noite e depois da meia-noite usam os dias explícitos',()=>{
 const midnight={...base,overtime_start:'22:00',point_exit:'21:00',final_exit:'02:00',final_exit_next_day:true,activities:[row('22:00','00:00','Reparo',false,true),row('00:00','02:00','Testes',true,true)]}
 assert.equal(workflowValidationError(midnight),null)
 assert.ok(workflowValidationError({...midnight,activities:[row('22:00','00:00'),row('00:00','02:00','Testes',true,true)]}))
 assert.equal(workflowValidationError({...base,is_holiday:true,normal_entry:'',point_exit:''}),null)
})
test('anexos aceitam mídias limitadas e recusam HTML, SVG, vazios e excesso',()=>{
 assert.equal(attachmentError([{name:'teste.mp4',type:'video/mp4',size:2048}]),null)
 for(const file of [{name:'x.svg',type:'image/svg+xml',size:2},{name:'x.html',type:'text/html',size:10},{name:'x.mp4',type:'video/mp4',size:20971521},{name:'x.png',type:'image/png',size:0}])assert.ok(attachmentError([file]))
 assert.ok(attachmentError(Array.from({length:6},()=>({name:'x.jpg',type:'image/jpeg',size:10}))))
 assert.ok(attachmentError([{name:'x.jpg',type:'image/jpeg',size:10}],5))
})
const entry={...base,id:'1',worker_id:'a',minutes:120,status:'approved',attachments:[{path:'private/path.jpg',name:'foto',mime:'image/jpeg',size:2}]}
const people=[{id:'a',full_name:'Maycon',role:'maintainer'},{id:'b',full_name:'Paulo',role:'maintainer'}]
test('comparativos somam horas individuais, deduplicam GLPI/data e separam pendentes',()=>{
 const list=[entry,{...entry,id:'2',worker_id:'b'}, {...entry,id:'3',status:'pending',minutes:60}, {...entry,id:'4',work_date:'2026-09-01',minutes:60}, {...entry,id:'5',status:'rejected'}]
 const result=comparison(list,'2026-09','2026-10')
 assert.equal(result.approved,300);assert.equal(result.pending,60);assert.equal(result.services,2);assert.equal(result.change,300)
 assert.equal(result.monthly[1].services,1);assert.equal(result.locations[0].services,2)
 assert.equal(comparison(list,'2026-10','2026-10','a').approved,120)
 assert.equal(uniqueServices([{...entry,glpi:''},{...entry,id:'2',glpi:''}]),2)
})
test('localizações livres permanecem distintas; filtros impossíveis falham',()=>{
 const data=comparison([entry,{...entry,id:'2',location:'cozinha'}],'2026-10','2026-10')
 assert.equal(data.locations.length,2);assert.equal(data.change,null)
 for(const [a,b] of [['2026-11','2026-10'],['2026-13','2026-13'],['2000-01','2026-10']])assert.throws(()=>comparison([],a,b))
})
async function unzip(blob){const bytes=Buffer.from(await blob.arrayBuffer()),files=new Map();let i=0;while(bytes.readUInt32LE(i)===0x04034b50){const n=bytes.readUInt16LE(i+26),size=bytes.readUInt32LE(i+18),start=i+30+n;files.set(bytes.subarray(i+30,start).toString(),bytes.subarray(start,start+size).toString());i=start+size}return files}
test('Excel individual contém todas as etapas, não inclui anexos e não duplica os horários',async()=>{
 const report=makeReport([entry],people,'2026-10','a'),files=await unzip(report.blob),sheet=files.get('xl/worksheets/sheet1.xml')
 assert.match(sheet,/18:00–18:15 — Materiais/);assert.match(sheet,/18:15–20:00 — Manutenção/);assert.match(sheet,/2h00/)
 assert.doesNotMatch(sheet,/private\/path|foto|image\/jpeg/)
 assert.equal((sheet.match(/r="C\d+"[^>]*>.*?<t[^>]*>18:00<\/t>/g)||[]).length,1)
 assert.equal(detailedDescription(entry),'Reparo na cozinha\n18:00–18:15 — Materiais\n18:15–20:00 — Manutenção')
})
test('Excel extenso usa continuação legível e exportação analítica traz dados e critérios',async()=>{
 const long={...entry,activities:Array.from({length:20},(_,i)=>row('18:00','20:00',`Etapa ${i+1}: `+'x'.repeat(280)))}
 const files=await unzip(makeReport([long],people,'2026-10','a').blob),sheet=files.get('xl/worksheets/sheet1.xml')
 assert.match(sheet,/Continuação/);assert.match(sheet,/Etapa 20/);assert.equal((sheet.match(/>2h00</g)||[]).length,1)
 const result=await unzip(makeComparisonReport(comparison([entry],'2026-10','2026-10'),people,'2026-10','2026-10').blob)
 assert.match(result.get('xl/workbook.xml'),/COMPARATIVO MENSAL/);assert.match(result.get('xl/worksheets/sheet3.xml'),/Materiais/);assert.doesNotMatch(result.get('xl/worksheets/sheet3.xml'),/private\/path/)
})
