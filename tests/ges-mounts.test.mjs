import test from 'node:test'
import assert from 'node:assert/strict'

import { attachMounts, evidenceMountRoute, parseEvidenceMounts } from '../tools/ges-index/mounts.mjs'

// 用正斜杠表示目录：映射模块只做透传，不关心分隔符（真实 GES 给的是反斜杠）。
const MOUNT_1 = 'C:/hlnet/1-1794226157'
const MOUNT_4 = 'C:/hlnet/4-1794227733'

const CONTEXT = {
  cid: 1,
  routes: ['/case/', '/evidence_mounts/'],
  evidence_mounts: [
    {
      eid: 1,
      name: 'CHAN_MH_mobile.zip',
      route: '/evidence_mounts/eid-1/',
      access_mode: 'local',
      mount_point: MOUNT_1,
      root_env: 'EVIDENCE_MOUNT_EID_1_ROOT',
      real_root_env: 'EVIDENCE_MOUNT_EID_1_REAL_ROOT',
    },
    { eid: 4, name: 'AP3_LEUNG_YL_USB.E01', mount_point: MOUNT_4 },
  ],
  skipped_evidence_mounts: [{ eid: 2, name: 'IQ_Coin_Type_Transactions.zip', reason: 'unsupported' }, 7],
}

test('parseEvidenceMounts：归一挂载字段、补虚拟路径、收 skipped', () => {
  const { mounts, skipped } = parseEvidenceMounts(CONTEXT)
  assert.equal(mounts.length, 2)
  assert.deepEqual(mounts[0], {
    eid: 1,
    name: 'CHAN_MH_mobile.zip',
    route: '/evidence_mounts/eid-1/',
    mountPoint: MOUNT_1,
    rootEnv: 'EVIDENCE_MOUNT_EID_1_ROOT',
    realRootEnv: 'EVIDENCE_MOUNT_EID_1_REAL_ROOT',
    accessMode: 'local',
  })
  assert.equal(mounts[1].route, '/evidence_mounts/eid-4/')
  assert.equal(mounts[1].accessMode, '')
  assert.equal(skipped.length, 2)
  assert.equal(skipped[0].eid, 2)
  assert.equal(skipped[1].eid, 7)
})

test('parseEvidenceMounts：坏输入返回空表不抛', () => {
  for (const input of [null, undefined, 42, 'x', {}, { evidence_mounts: 'nope' }, { evidence_mounts: [null, { eid: 'abc' }] }]) {
    const { mounts, skipped } = parseEvidenceMounts(input)
    assert.deepEqual(mounts, [])
    assert.deepEqual(skipped, [])
  }
})

test('attachMounts：优先按名称匹配（索引 eid 与火眼 eid 可不同），再退回 eid', () => {
  const { mounts } = parseEvidenceMounts(CONTEXT)
  const list = [
    { eid: 1, name: 'chan_mh_mobile.zip' },
    { eid: 4, name: '另一个名字.E01' },
    { eid: 2, name: 'IQ_Coin_Type_Transactions.zip' },
  ]
  const merged = attachMounts(list, mounts)
  assert.equal(merged[0].mountEid, 1)
  assert.equal(merged[0].mountRoute, '/evidence_mounts/eid-1/')
  assert.equal(merged[1].mountEid, 4)
  assert.equal(merged[1].mountPoint, MOUNT_4)
  assert.equal(merged[2].mountRoute, null)
  assert.equal(merged[2].mountPoint, null)
  assert.equal(merged[2].mountEid, null)
})

test('evidenceMountRoute：拼虚拟路径', () => {
  assert.equal(evidenceMountRoute(3), '/evidence_mounts/eid-3/')
})
