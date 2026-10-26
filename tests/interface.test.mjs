import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {Window} from 'happy-dom'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
test('Interface: cadastro detalhado, participantes, comparativos e permissões',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'he-ui-')),bundle=join(dir,'app.mjs')
 await build({entryPoints:[fileURLToPath(new URL('../src/main.tsx',import.meta.url))],outfile:bundle,bundle:true,platform:'browser',format:'esm',loader:{'.css':'empty'},define:{'import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'""'},logLevel:'silent'})
 const w=new Window({url:'https://example.invalid/?demo=1'}),errors=[]
 for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Event','MouseEvent','CustomEvent','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{value:key==='window'?w:key==='document'?w.document:w[key],configurable:true,writable:true})
 globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w)
 w.addEventListener('error',e=>errors.push(String(e.error)))
 w.document.body.innerHTML='<div id="root"></div>'
 const pause=()=>new Promise(r=>setTimeout(r,70)),button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label)),txt=()=>document.body.textContent
 const switchUser=async id=>{const s=document.querySelector('[aria-label="Trocar usuário na demonstração"]');s.value=id;s.dispatchEvent(new w.Event('change',{bubbles:true}));await pause();await pause()}
 const edit=async(el,value)=>{const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));await pause()}
 try {
 await import(pathToFileURL(bundle).href);await pause();await pause()
 assert.ok(button('Comparativos'));button('Comparativos').click();await pause();assert.match(txt(),/Horas aprovadas/);assert.match(txt(),/Horas pendentes/);assert.ok(button('Exportar comparativo'))
 await switchUser('analista');assert.equal(Boolean(button('Comparativos')),false);assert.equal(Boolean(button('Nova hora extra')),false);assert.ok(button('Relatórios'))
 await switchUser('maycon');assert.equal(Boolean(button('Comparativos')),false);button('Nova hora extra').click();await pause()
 const dialog=()=>document.querySelector('[role="dialog"]'),byLabel=label=>[...dialog().querySelectorAll('label')].find(l=>l.textContent.trimStart().startsWith(label))?.querySelector('input,textarea')
 assert.equal(byLabel('Localização').required,true);assert.equal(byLabel('GLPI').required,true);assert.equal(byLabel('Resumo do serviço').required,true)
 assert.ok(document.querySelector('[aria-label="Início da atividade 1"]'));assert.equal(document.querySelector('[aria-label="Início da atividade 1"]').type,'time')
 assert.equal(document.querySelector('.coworkers-list'),null);byLabel('Teve ajuda').click();await pause();assert.ok(document.querySelector('.coworkers-list'));assert.match(document.querySelector('.coworkers-list').textContent,/Paulo/);assert.doesNotMatch(document.querySelector('.coworkers-list').textContent,/Maycon/)
 byLabel('Teve ajuda').click();await pause();assert.equal(document.querySelector('.coworkers-list'),null)
 byLabel('Trabalho em feriado').click();await pause();assert.equal(byLabel('Entrada normal').required,false);assert.equal(byLabel('Entrada normal').disabled,true);assert.equal(byLabel('Localização').required,true)
 await edit(byLabel('Início da hora extra'),'18:00');await edit(byLabel('Término da hora extra'),'20:00');await edit(byLabel('Localização'),'Cozinha teste');await edit(byLabel('GLPI'),'UI-100');await edit(byLabel('Resumo do serviço'),'Serviço de teste')
 await edit(document.querySelector('[aria-label="Descrição da atividade 1"]'),'Atendimento de teste')
 assert.equal(button('Enviar para aprovação').disabled,false)
 button('Adicionar atividade').click();await pause();assert.equal(button('Enviar para aprovação').disabled,true);document.querySelector('[aria-label="Remover atividade 2"]').click();await pause();assert.equal(button('Enviar para aprovação').disabled,false)
 assert.equal(document.querySelector('[aria-label="Selecionar fotos ou vídeos"]').required,false)
 button('Enviar para aprovação').click();await pause();await pause();assert.equal(dialog(),null);assert.match(txt(),/Hora extra enviada para aprovação/)
 button('Lançamentos').click();await pause();assert.match(txt(),/Cozinha teste/);assert.match(txt(),/Atendimento de teste/)
 const tr=[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('UI-100'));tr.querySelector('button').click();await pause();assert.match(dialog().textContent,/ATIVIDADES REALIZADAS/);button('Fechar').click();await pause()
 await switchUser('admin');button('Equipe e acessos').click();await pause();const bogo=[...document.querySelectorAll('.member-row')].find(row=>row.textContent.includes('Marcelo Bogo'));bogo.querySelector('button').click();await pause();assert.equal(document.querySelector('[aria-label="Prazo do lembrete"]').value,'24');button('Cancelar').click();await pause()
 assert.equal(errors.length,0,errors.join('\n'));t.diagnostic('Fluxos DOM verificados com cadastro real na demonstração e zero erros JavaScript.')
 }finally{await w.happyDOM.abort();w.close();await rm(dir,{recursive:true,force:true})}
})
