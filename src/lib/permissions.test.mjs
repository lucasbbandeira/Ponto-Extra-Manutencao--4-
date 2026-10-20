import assert from 'node:assert/strict'
import test from 'node:test'
import { permissions } from './permissions.ts'
import { demoApi, demoProfiles, setDemoRole } from './demo.ts'

const base = { active: true, approval_status: 'approved', can_approve: true, can_export: true }
test('analista consulta e exporta, mas não ganha escrita mesmo com flags de gestor', () => {
  assert.deepEqual(permissions({ ...base, role: 'analyst' }), {
    manager: true, canApprove: false, canExport: true, canManageUsers: false, canSubmit: false, canDelete: false,
  })
  assert.equal(permissions({ ...base, role: 'analyst', can_export: false }).canExport, true)
  assert.equal(permissions({ ...base, role: 'analyst', active: false }).canExport, false)
  assert.equal(permissions({ ...base, role: 'analyst', approval_status: 'pending' }).canExport, false)
})
test('perfis anteriores mantêm permissões específicas', () => {
  assert.equal(permissions({ ...base, role: 'admin' }).canManageUsers, true)
  assert.equal(permissions({ ...base, role: 'supervisor', can_export: false }).canExport, false)
  assert.equal(permissions({ ...base, role: 'supervisor', can_approve: false }).canApprove, false)
  assert.equal(permissions({ ...base, role: 'maintainer' }).canSubmit, true)
  assert.equal(permissions({ ...base, role: 'maintainer' }).canApprove, false)
  assert.equal(permissions({ ...base, role: 'maintainer' }).canExport, false)
})
test('demonstração do analista consulta a equipe e rejeita todas as ações de escrita', async () => {
  setDemoRole('analista')
  try {
    const before = await demoApi.loadData()
    assert.ok(before.entries.some(e => e.worker_id === 'maycon'))
    assert.ok(before.entries.some(e => e.worker_id === 'paulo'))
    assert.equal(before.invitations.length, 0)
    const calls = [
      () => demoApi.submitEntry({}), () => demoApi.reviseEntry('07', {}),
      () => demoApi.reviewEntry('01', 'approved'), () => demoApi.deleteEntry('01'),
      () => demoApi.createInvitation('a@example.com', 'Analista', 'analyst', 'analista'),
      () => demoApi.changeInvitation('x', 'revoked'),
      () => demoApi.updateProfile(demoProfiles[0], 'Maycon', 'admin', true, true, true),
      () => demoApi.reviewProfile('maycon', false), () => demoApi.deleteProfile('paulo'),
    ]
    for (const call of calls) await assert.rejects(call)
    assert.deepEqual(await demoApi.loadData(), before)
  } finally { setDemoRole('admin') }
})
test('somente administrador atribui Analista e não concede aprovação ao perfil', async () => {
  setDemoRole('admin')
  const target = demoProfiles.find(p => p.id === 'analista')
  await demoApi.updateProfile(target, target.full_name, 'analyst', true, true, false)
  assert.equal(target.role, 'analyst'); assert.equal(target.can_approve, false); assert.equal(target.can_export, true)
})
