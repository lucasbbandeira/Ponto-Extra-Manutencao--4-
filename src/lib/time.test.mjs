import assert from 'node:assert/strict'
import test from 'node:test'
import { overtimeMinutes, validOvertime, formatMinutes } from './time.ts'

test('conta a partir da batida de ponto, nao da entrada normal', () => {
  assert.equal(overtimeMinutes('17:10', '19:45', false), 155)
  assert.equal(formatMinutes(155), '2h35')
})

test('travessia da meia-noite exige a marcacao do dia seguinte', () => {
  assert.equal(overtimeMinutes('23:40', '01:15', true), 95)
  assert.equal(validOvertime('23:40', '01:15', true), true)
  assert.equal(validOvertime('23:40', '01:15', false), false)
  assert.equal(validOvertime('18:00', '18:00', false), false)
  assert.equal(validOvertime('08:00', '20:00', true), false)
})
