import test from 'node:test'
import assert from 'node:assert/strict'

import { TYPED_TABLES, TYPED_DDL, projectCsvRow } from '../tools/ges-index/typed.mjs'

const row = (fields) => projectCsvRow(fields, { app: 'x', category: 'y', kind: 'csv' })
const tableOf = (fields) => row(fields)?.table ?? null

test('TYPED_DDL 覆盖 TYPED_TABLES 的每张表，且都有 record_id 主键', () => {
  for (const name of Object.keys(TYPED_TABLES)) {
    const re = new RegExp(`create table if not exists ${name}\\s*\\(`, 'i')
    assert.ok(re.test(TYPED_DDL), `DDL 缺少表 ${name}`)
  }
  assert.match(TYPED_DDL, /record_id integer primary key|record_id integer not null/i)
  for (const extra of ['citation', 'column_map']) {
    assert.ok(new RegExp(`create table if not exists ${extra}\\s*\\(`, 'i').test(TYPED_DDL))
  }
})

test('表头签名：群列表 / 消息 CSV / 短信 / 通话（WhatsApp、iOS）', () => {
  assert.equal(tableOf({ 群组ID: '1', 群组名称: 'g' }), 'chat_group')
  assert.equal(tableOf({ 发送者ID: '1', 消息内容: 'hi' }), 'msg_csv')
  assert.equal(tableOf({ 号码: '123', 内容: 'hi', 类型: '接收' }), 'sms')
  assert.equal(tableOf({ 发起者: 'a', 会话方向: '呼出' }), 'call_log')
  assert.equal(tableOf({ 通话时长: '10', 号码: '123' }), 'call_log')
})

test('表头签名：联系人 / 账号 / Safari / Exif / 网络 / 应用 / 权限 / 使用', () => {
  assert.equal(tableOf({ 用户ID: 'u', 内部ID: 'i' }), 'contact')
  assert.equal(row({ 用户ID: 'u', 内部ID: 'i' })?.row.internal_id, 'i')
  assert.equal(tableOf({ 账户名: 'a', 用户ID: 'u' }), 'account_info')
  assert.equal(tableOf({ 搜索内容: 'q' }), 'web_visit')
  assert.equal(tableOf({ 标题: 't', URL: 'http://x' }), 'web_visit')
  assert.equal(tableOf({ 拍摄时间: '2025-01-01', '纬度(度分秒表示法)': '1,2,3' }), 'exif')
  assert.equal(tableOf({ 应用包名: 'p', WiFi下载流量: '1' }), 'net_usage')
  assert.equal(tableOf({ 包名: 'p', 名称: 'n' }), 'app_install')
  assert.equal(tableOf({ 请求服务: 's', 应用名称: 'a' }), 'app_permission')
  assert.equal(tableOf({ 日志描述: 'd', App名称: 'a' }), 'app_usage')
})

test('表头签名：SIM / Wi-Fi / 蓝牙 / 容量 / 日历 / 小程序 / 朋友圈 / 收藏', () => {
  assert.equal(tableOf({ IMSI: '1', ICCID: '2' }), 'sim_card')
  assert.equal(tableOf({ 加密类型: 'wpa', Mac地址: 'aa' }), 'wifi_record')
  assert.equal(tableOf({ Mac地址: 'aa', 状态: 'on' }), 'bt_device')
  assert.equal(tableOf({ 可用容量: '1', 总容量: '2' }), 'device_storage')
  assert.equal(tableOf({ 开始时间: 't', 是否全天: '是' }), 'calendar_event')
  assert.equal(tableOf({ 'Brand Id': 'b' }), 'mini_program')
  assert.equal(tableOf({ 评论详情: 'c' }), 'moment')
  assert.equal(tableOf({ 来源账号: 'a', 发送者: 's' }), 'favorite')
})

test('表头签名：设备信息（恰好 名称+内容）/ 文件元数据 / 健康指标 / 检材信息', () => {
  assert.equal(tableOf({ 名称: 'n', 内容: 'c' }), 'device_info')
  assert.equal(tableOf({ 名称: 'IMG_1.PNG', 大小: '1.24 MB', 相簿名称: '相机胶卷' }), 'file_meta')
  assert.equal(
    tableOf({ 开始时间: 't', 结束时间: 't', 静息能量: '9', 来源名称: 'iPhone', 设备信息: 'x' }),
    'health_metric'
  )
  const health = row({ 开始时间: 't', 结束时间: 't', 静息能量: '9', 来源名称: 'iPhone', 设备信息: 'x' })
  assert.equal(health.row.metric, '静息能量')
  assert.equal(health.row.value_text, '9')
  // 检材信息 26 列由 build 写 evidence，不做 typed 投影
  assert.equal(tableOf({ 检材ID: '1', 名称: 'CHAN.zip', 张数: '0' }), null)
})

test('无法识别的表头返回 null（不能静默串到别的表）', () => {
  assert.equal(row({ 随便一列: '1', 另一列: '2' }), null)
  assert.equal(row({}), null)
})

test('mapping 元组顺序是 [targetField, sourceColumn]，且来源列确实存在', () => {
  const proj = row({ 群组ID: 'g1', 群组名称: 'name', 群主ID: 'o1' })
  assert.equal(proj.table, 'chat_group')
  const fields = { 群组ID: 'g1', 群组名称: 'name', 群主ID: 'o1' }
  for (const [targetField, column] of proj.mapping) {
    assert.equal(typeof targetField, 'string')
    assert.equal(typeof column, 'string')
    assert.ok(TYPED_TABLES.chat_group.includes(targetField), `${targetField} 不在 chat_group 列清单`)
    if (fields[column] !== undefined) assert.equal(proj.row[targetField], fields[column])
  }
})

test('所有 typed 表的主键列都在 TYPED_TABLES 声明中（列名一致性）', () => {
  for (const [name, cols] of Object.entries(TYPED_TABLES)) {
    const listed = cols
    if (!listed.length) continue
    for (const col of listed) {
      assert.ok(new RegExp(`\\b${col}\\b`).test(TYPED_DDL), `${name}.${col} 不在 DDL 中`)
    }
  }
})
