import assert from 'node:assert/strict'
import test from 'node:test'
import { makeReport, selectReport } from './report.ts'

const profile = { id: '1', full_name: 'Maycon', role: 'maintainer' }
const paulo = { id: '2', full_name: 'Paulo', role: 'maintainer' }
const base = { worker_id: '1', work_date: '2026-09-29', normal_entry: '08:00:00',
  point_exit: '17:00:00', final_exit: '19:30:00', final_exit_next_day: false,
  minutes: 150, note: '=SUM(A1:A2)', status: 'approved',
  submitted_at: '2026-09-29T22:00:00Z', reviewed_at: '2026-09-29T22:10:00Z', reviewed_by: '1' }

async function unzip(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer())
  const files = new Map()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'ZIP sem compressão')
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    files.set(name, bytes.subarray(start, start + size).toString())
    offset = start + size
  }
  return files
}

const sheetNames = files => [...files.get('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1])
const worksheets = files => [...files].filter(([name]) => name.startsWith('xl/worksheets/')).map(([, value]) => value)
const cell = (sheet, address) => sheet.match(new RegExp(`<c r="${address}"[^>]*>.*?<t>(.*?)</t>.*?</c>`))?.[1]

test('exportação individual usa pessoa, mês e aprovação sem alterar os registros', async () => {
  const entries = Object.freeze([
    Object.freeze({ ...base, id: 'approved' }),
    Object.freeze({ ...base, id: 'pending', status: 'pending', point_exit: '14:00:00', minutes: 999 }),
    Object.freeze({ ...base, id: 'rejected', status: 'rejected', minutes: 999 }),
    Object.freeze({ ...base, id: 'other-month', work_date: '2026-10-01', minutes: 999 }),
    Object.freeze({ ...base, id: 'other-worker', worker_id: '2', minutes: 999 }),
  ])
  const profiles = Object.freeze([Object.freeze(profile), Object.freeze(paulo)])
  const selection = selectReport(entries, profiles, '2026-09', '1')
  assert.deepEqual(selection.approved.map(e => e.id), ['approved'])
  const { filename, blob } = makeReport(entries, profiles, '2026-09', '1')
  assert.equal(filename, 'Horas_extras_Maycon_setembro_2026.xlsx')
  const files = await unzip(blob)
  assert.deepEqual(sheetNames(files), ['MAYCON'])
  const [sheet] = worksheets(files)
  assert.equal(cell(sheet, 'B6'), 'MAYCON')
  assert.equal(cell(sheet, 'B8'), '29/09/2026')
  assert.equal(cell(sheet, 'C8'), '17:00', 'entrada é batida de saída, não entrada normal')
  assert.equal(cell(sheet, 'D8'), '19:30')
  assert.equal(cell(sheet, 'D25'), '2h30')
  assert.doesNotMatch(sheet, /PAULO|14:00|01\/10\/2026/)
  assert.equal(entries.length, 5)
})

test('todos gera apenas abas com nomes, mantendo a aba de quem não tem horas no mês', async () => {
  const elciney = { id: '3', full_name: 'Elciney', role: 'maintainer' }
  const admin = { id: 'admin', full_name: 'Lucas', role: 'admin' }
  const { blob } = makeReport([base, { ...base, worker_id: '2', minutes: 90 }], [profile, paulo, elciney, admin], '2026-09')
  const files = await unzip(blob)
  assert.deepEqual(sheetNames(files), ['ELCINEY', 'MAYCON', 'PAULO'])
  assert.equal(worksheets(files).length, 3)
  assert.deepEqual(worksheets(files).map(s => cell(s, 'D25')), ['0h00', '2h30', '1h30'])
  assert.doesNotMatch(files.get('xl/workbook.xml'), /Lançamentos|Cadastro|Resumo|LUCAS/)
})

test('conta desativada ou com função alterada mantém acesso ao seu relatório histórico', async () => {
  const formerMaintainer = { ...profile, role: 'supervisor', active: false }
  const profiles = [formerMaintainer, paulo]
  assert.ok(selectReport([base], profiles, '2026-10').workers.some(p => p.id === '1'))
  assert.deepEqual(sheetNames(await unzip(makeReport([base], profiles, '2026-09', '1').blob)), ['MAYCON'])
})

test('pessoas com nomes iguais são filtradas por ID e abas longas têm nomes válidos e únicos', async () => {
  const sameName = { ...paulo, full_name: 'Maycon' }
  const records = [base, { ...base, worker_id: '2', minutes: 90 }]
  const single = await unzip(makeReport(records, [profile, sameName], '2026-09', '2').blob)
  assert.equal(cell(worksheets(single)[0], 'D25'), '1h30')
  const names = ["'Nome / muito longo para uma aba de manutentor 1'", "'Nome / muito longo para uma aba de manutentor 2'", "'''", 'Maycon & <Equipe>\u0000']
  const profiles = names.map((full_name, i) => ({ ...profile, id: String(i), full_name }))
  const entries = profiles.map(p => ({ ...base, worker_id: p.id }))
  const files = await unzip(makeReport(entries, profiles, '2026-09').blob)
  const actual = sheetNames(files)
  assert.equal(new Set(actual).size, 4)
  for (const name of actual) {
    assert.ok(name.length > 0 && name.length <= 31)
    assert.doesNotMatch(name, /[\\/*?:\[\]\u0000-\u001f]/)
    assert.ok(!name.startsWith('&apos;') && !name.endsWith('&apos;'))
  }
  assert.match(files.get('xl/workbook.xml'), /MAYCON &amp; &lt;EQUIPE&gt;/)
})

test('planilha preserva virada do dia, ordem dos horários e totais acima de 24 horas', async () => {
  const entries = Array.from({ length: 24 }, (_, i) => ({ ...base, work_date: '2026-09-28', point_exit: `${String(17 + i % 3).padStart(2, '0')}:00:00` }))
  entries.unshift({ ...base, point_exit: '23:00:00', final_exit: '01:00:00', final_exit_next_day: true, minutes: 120 })
  const files = await unzip(makeReport(entries, [profile], '2026-09', '1').blob)
  const [sheet] = worksheets(files)
  assert.equal(cell(sheet, 'B8'), '28/09/2026')
  assert.equal(cell(sheet, 'C8'), '17:00')
  assert.equal(cell(sheet, 'B32'), '29/09/2026')
  assert.equal(cell(sheet, 'D32'), '01:00 (+1 dia)')
  assert.equal(cell(sheet, 'D33'), '62h00')
  assert.match(sheet, /<autoFilter ref="B7:D32"/)
})

test('não produz arquivo inválido quando não há aprovação, pessoa ou mês válido', () => {
  assert.throws(() => makeReport([base], [profile], '2026-09', 'unknown'), /não está disponível/)
  assert.throws(() => makeReport([{ ...base, status: 'pending' }], [profile], '2026-09'), /Não há lançamentos aprovados/)
  assert.throws(() => makeReport([base], [profile, paulo], '2026-09', '2'), /Não há lançamentos aprovados/)
  for (const month of ['', '2026', '2026-13']) assert.throws(() => makeReport([base], [profile], month), /mês válido/)
})

test('abas respeitam a sequência SpreadsheetML e textos não viram fórmulas', async () => {
  const person = { ...profile, full_name: '=Maycon & <Equipe>\u0000' }
  const files = await unzip(makeReport([base], [person], '2026-09', '1').blob)
  const [sheet] = worksheets(files)
  assert.ok(sheet.indexOf('</sheetData>') < sheet.indexOf('<autoFilter '))
  assert.ok(sheet.indexOf('<autoFilter ') < sheet.indexOf('<mergeCells '))
  assert.equal(cell(sheet, 'B6'), '=MAYCON &amp; &lt;EQUIPE&gt;')
  assert.doesNotMatch(sheet, /<f[ >]|\u0000/)
})
