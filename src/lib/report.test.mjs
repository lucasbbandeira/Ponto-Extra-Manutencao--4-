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

test('todas as abas respeitam a sequência SpreadsheetML e escapam textos', async () => {
  const { blob } = makeReport([{ ...base, status: 'approved', note: 'Teste & revisão <ok>' }], [profile], '2026-09')
  const bytes = Buffer.from(await blob.arrayBuffer())
  const sheets = []
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    if (name.startsWith('xl/worksheets/')) sheets.push(bytes.subarray(start, start + size).toString())
    offset = start + size
  }
  assert.equal(sheets.length, 3)
  for (const sheet of sheets) {
    assert.ok(sheet.indexOf('</sheetData>') < sheet.indexOf('<autoFilter '))
    assert.ok(sheet.indexOf('<autoFilter ') < sheet.indexOf('<mergeCells '))
  }
  assert.match(sheets[0], /Teste &amp; revisão &lt;ok&gt;/)
})
