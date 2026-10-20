import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { makePdfReport } from './report-pdf.ts'

const font = readFileSync(new URL('../../public/fonts/PontoExtra.ttf', import.meta.url)).toString('base64')
const worker = { id: 'worker', full_name: 'João da Conceição', role: 'maintainer' }
const entry = { id: '1', worker_id: 'worker', work_date: '2026-10-12', normal_entry: null,
  point_exit: null, overtime_start: '22:00', final_exit: '01:30', final_exit_next_day: true,
  is_holiday: true, minutes: 210, note: 'Manutenção elétrica na câmara fria. Ação concluída.', status: 'approved' }
test('PDF real com fonte incorporada, filtro individual e sem modificar registros', async () => {
  const entries = Object.freeze([Object.freeze(entry), Object.freeze({ ...entry, id: '2', status: 'pending' })])
  const result = await makePdfReport(entries, [worker], '2026-10', 'worker', font)
  assert.equal(result.blob.type, 'application/pdf')
  assert.match(result.filename, /João_da_Conceição_2026-10_justificativas\.pdf$/)
  assert.equal(Buffer.from(await result.blob.arrayBuffer()).subarray(0, 5).toString(), '%PDF-')
  assert.equal(entries[0].minutes, 210); assert.equal(entries[0].note, entry.note)
})
test('PDF rejeita mês inválido, seleção vazia e ausência de aprovação', async () => {
  await assert.rejects(() => makePdfReport([entry], [worker], '2026-13', '', font), /mês válido/)
  await assert.rejects(() => makePdfReport([entry], [worker], '2026-10', 'outro', font), /Não há/)
  await assert.rejects(() => makePdfReport([{ ...entry, status: 'pending' }], [worker], '2026-10', '', font), /Não há/)
})
