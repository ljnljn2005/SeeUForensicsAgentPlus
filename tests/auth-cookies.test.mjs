import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAuthCookieAuthority, pickStaleAuthCookies } from '../tools/auth-cookies.mjs'

const enc = (obj, prefix = 'v1.') => prefix + Buffer.from(JSON.stringify(obj)).toString('base64url')

test('decodeAuthCookieAuthority 解出 authority，坏值返回空串', () => {
  assert.equal(decodeAuthCookieAuthority(enc({ version: 1, authority: '127.0.0.1:54053' })), '127.0.0.1:54053')
  assert.equal(decodeAuthCookieAuthority(enc({ authority: '127.0.0.1:1' }, '')), '127.0.0.1:1')
  assert.equal(decodeAuthCookieAuthority('v1.not-base64!!'), '')
  assert.equal(decodeAuthCookieAuthority(''), '')
  assert.equal(decodeAuthCookieAuthority(undefined), '')
})

test('pickStaleAuthCookies 只挑非当前端口/解不开的 dsh-auth cookie', () => {
  const cookies = [
    { name: 'dsh-auth-a', value: enc({ authority: '127.0.0.1:1' }) },
    { name: 'dsh-auth-b', value: enc({ authority: '127.0.0.1:2' }) },
    { name: 'dsh-auth-current', value: enc({ authority: '127.0.0.1:9000' }) },
    { name: 'other', value: enc({ authority: '127.0.0.1:1' }) },
    { name: 'dsh-auth-broken', value: 'garbage' },
  ]
  assert.deepEqual(pickStaleAuthCookies(cookies, '127.0.0.1:9000'), ['dsh-auth-a', 'dsh-auth-b', 'dsh-auth-broken'])
})

test('pickStaleAuthCookies 全匹配时返回空数组', () => {
  const cookies = [{ name: 'dsh-auth-x', value: enc({ authority: '127.0.0.1:9000' }) }]
  assert.deepEqual(pickStaleAuthCookies(cookies, '127.0.0.1:9000'), [])
})

test('pickStaleAuthCookies 容错非数组/空值', () => {
  assert.deepEqual(pickStaleAuthCookies(undefined, '127.0.0.1:9000'), [])
  assert.deepEqual(pickStaleAuthCookies([null, {}, { name: 'dsh-auth-y', value: null }], '127.0.0.1:9000'), ['dsh-auth-y'])
})
