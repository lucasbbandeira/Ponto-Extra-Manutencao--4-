import assert from 'node:assert/strict'
import test from 'node:test'
import { makeReport, reportRows } from './report.ts'

const profile = { id: '1', full_name: 'Maycon', role: 'maintainer' }
const base = { worker_id: '1', work_date: '2026-09-29', normal_entry: '08:00:00',
  point_exit: '17:00:00', final_exit: '19:30:00', final_exit_next_day: false,
  minutes: 150, note: '=SUM(A1:A2)', submitted_at: '2026-09-29T22:00:00Z',
  reviewed_at: '2026-09-29T22:10:00Z', reviewed_by: '1' }

test('planilha inclui somente aprovados e soma minutos', async () => {
  const entries = [{ ...base, status: 'approved' }, { ...base, status: 'pending' }]
  const rows = reportRows(entries, [profile], '2026-09')
  assert.equal(rows.summary[1][2], 150)
  assert.equal(rows.summary[2][1], 1)
  assert.equal(rows.details.length, 2)
  const { filename, blob } = makeReport(entries, [profile], '2026-09')
  assert.match(filename, /\.xlsx$/)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4])
  assert.ok(bytes.length > 2000)
  const xml = new TextDecoder().decode(bytes)
  assert.match(xml, /Lançamentos/)
  assert.match(xml, /Cadastro/)
  assert.match(xml, /MAYCON/)
})
