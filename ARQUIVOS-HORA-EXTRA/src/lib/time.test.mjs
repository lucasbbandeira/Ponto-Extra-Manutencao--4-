import assert from 'node:assert/strict'
import test from 'node:test'
import { overtimeMinutes, validOvertime, formatMinutes, overtimeStart, entryValidationError } from './time.ts'

test('conta somente do início informado até o término da hora extra', () => {
  const entry = { normal_entry: '08:00', point_exit: '17:00', overtime_start: '18:00', final_exit: '20:30' }
  assert.equal(overtimeMinutes(overtimeStart(entry), entry.final_exit, false), 150)
  assert.equal(formatMinutes(150), '2h30')
})

const input = { work_date: '2026-10-06', normal_entry: '08:00', point_exit: '17:00', overtime_start: '18:00', final_exit: '20:30', final_exit_next_day: false, note: 'Manutenção da câmara fria' }

test('todos os campos são obrigatórios, incluindo descrição sem espaços vazios', () => {
  assert.equal(entryValidationError(input), null)
  for (const field of ['work_date', 'normal_entry', 'point_exit', 'overtime_start', 'final_exit', 'note']) {
    assert.ok(entryValidationError({ ...input, [field]: '' }), field)
  }
  assert.match(entryValidationError({ ...input, note: ' \t\n ' }), /descrição/)
  assert.match(entryValidationError({ ...input, note: 'a'.repeat(1001) }), /1.000/)
})

test('horários inválidos, datas impossíveis e início anterior à saída normal são recusados', () => {
  for (const time of ['24:00', '18:60', '-1:00', '18:00:30', 'xx:yy']) {
    assert.equal(validOvertime(time, '20:30', false), false)
  }
  assert.match(entryValidationError({ ...input, overtime_start: '16:59' }), /saída normal/)
  assert.match(entryValidationError({ ...input, work_date: '2026-02-30' }), /data/)
  assert.equal(entryValidationError({ ...input, overtime_start: '17:00' }), null)
})

test('registros anteriores preservam o início e total sem inventar um novo horário', () => {
  const old = Object.freeze({ point_exit: '17:10:00', final_exit: '19:45:00', minutes: 155 })
  assert.equal(overtimeStart(old), '17:10')
  assert.equal(overtimeStart({ ...old, overtime_start: null }), '17:10')
  assert.equal(old.minutes, 155)
})

test('limites de 1 minuto e 16 horas e virada do dia usam o início da extra', () => {
  assert.equal(validOvertime('18:00', '18:01', false), true)
  assert.equal(validOvertime('08:00', '00:00', true), true)
  assert.equal(validOvertime('08:00', '00:01', true), false)
  assert.equal(entryValidationError({ ...input, point_exit: '22:00', overtime_start: '23:30', final_exit: '01:00', final_exit_next_day: true }), null)
  assert.equal(overtimeMinutes('23:30', '01:00', true), 90)
})

test('travessia da meia-noite exige a marcacao do dia seguinte', () => {
  assert.equal(overtimeMinutes('23:40', '01:15', true), 95)
  assert.equal(validOvertime('23:40', '01:15', true), true)
  assert.equal(validOvertime('23:40', '01:15', false), false)
  assert.equal(validOvertime('18:00', '18:00', false), false)
  assert.equal(validOvertime('08:00', '20:00', true), false)
})
