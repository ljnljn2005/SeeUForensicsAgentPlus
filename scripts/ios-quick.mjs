#!/usr/bin/env node
// iOS 取证速查 CLI：把常问题目事实一键取出（只读，不改动检材）。
//
// 用法示例：
//   node scripts/ios-quick.mjs device <iDevice_info.txt>
//   node scripts/ios-quick.mjs accounts <Accounts3.sqlite>
//   node scripts/ios-quick.mjs photos <Photos.sqlite> --name IMG_0027
//   node scripts/ios-quick.mjs order <Photos.sqlite> IMG_0014.MOV IMG_0016.MOV
//   node scripts/ios-quick.mjs safari <History.db>
//   node scripts/ios-quick.mjs wa-sessions <ChatStorage.sqlite> [--archived]
//   node scripts/ios-quick.mjs wa-members <ChatStorage.sqlite> <jid> [--admins]
//   node scripts/ios-quick.mjs wa-calls <CallHistory.storedata>
//   node scripts/ios-quick.mjs wa-locations <ChatStorage.sqlite>
//   node scripts/ios-quick.mjs wechat <Documents/<hash> 目录>
//   node scripts/ios-quick.mjs summary <Photos.sqlite> <Accounts3.sqlite> <ChatStorage.sqlite> <Documents/<hash>>
import { readFileSync } from 'node:fs'
import {
  analyzeDeviceInfo,
  countPhotoImports,
  listAccounts,
  photoAssets,
  photoOrder,
  safariHistory,
  summarizeIos,
  waCallStats,
  waLocations,
  waMembers,
  waSessions,
  wechatFinder,
  wechatWxids
} from '../tools/ios-quick.mjs'

const [command, ...rest] = process.argv.slice(2)
const args = rest.filter((item) => !item.startsWith('--'))
const flags = new Set(rest.filter((item) => item.startsWith('--')))
const has = (flag) => flags.has(flag)
const need = (count) => {
  if (args.length < count) {
    console.error(`缺少参数：需要 ${count} 个，实际 ${args.length}`)
    process.exit(2)
  }
}

const print = (value) => console.log(JSON.stringify(value, null, 2))

try {
  switch (command) {
    case 'device': {
      need(1)
      print(analyzeDeviceInfo(readFileSync(args[0], 'utf8')))
      break
    }
    case 'accounts': {
      need(1)
      print(listAccounts(args[0]))
      break
    }
    case 'photos': {
      need(1)
      const nameIndex = rest.indexOf('--name')
      const name = nameIndex >= 0 ? rest[nameIndex + 1] : undefined
      const rows = photoAssets(args[0], { name })
      print({ count: rows.length, rows })
      break
    }
    case 'imports': {
      need(2)
      print({ bundle: args[1], count: countPhotoImports(args[0], args[1]) })
      break
    }
    case 'order': {
      need(2)
      print(photoOrder(args[0], args.slice(1)))
      break
    }
    case 'safari': {
      need(1)
      print(safariHistory(args[0]))
      break
    }
    case 'wa-sessions': {
      need(1)
      print(waSessions(args[0], { archivedOnly: has('--archived') }))
      break
    }
    case 'wa-members': {
      need(2)
      print(waMembers(args[0], args[1], { adminsOnly: has('--admins') }))
      break
    }
    case 'wa-calls': {
      need(1)
      print(waCallStats(args[0]))
      break
    }
    case 'wa-locations': {
      need(1)
      print(waLocations(args[0]))
      break
    }
    case 'wechat': {
      need(1)
      print({ finder: wechatFinder(args[0]), wxids: wechatWxids(args[0]) })
      break
    }
    case 'summary': {
      need(1)
      const [photos, accounts, chat] = [args[0], args[1], args[2]]
      const out = { photos: photos ? photoAssets(photos, { limit: 5 }) : undefined }
      if (accounts) out.accounts = listAccounts(accounts)
      if (chat) out.whatsapp = { sessions: waSessions(chat).length, calls: waCallStats(chat) }
      if (args[3]) Object.assign(out, { wechat: wechatFinder(args[3]), wxids: wechatWxids(args[3]) })
      console.log(summarizeIos(out))
      break
    }
    default: {
      console.log(`用法：
  node scripts/ios-quick.mjs device <iDevice_info.txt>
  node scripts/ios-quick.mjs accounts <Accounts3.sqlite>
  node scripts/ios-quick.mjs photos <Photos.sqlite> [--name IMG_0027]
  node scripts/ios-quick.mjs imports <Photos.sqlite> <bundleId>
  node scripts/ios-quick.mjs order <Photos.sqlite> <文件名...>
  node scripts/ios-quick.mjs safari <History.db>
  node scripts/ios-quick.mjs wa-sessions <ChatStorage.sqlite> [--archived]
  node scripts/ios-quick.mjs wa-members <ChatStorage.sqlite> <jid> [--admins]
  node scripts/ios-quick.mjs wa-calls <CallHistory.storedata>
  node scripts/ios-quick.mjs wa-locations <ChatStorage.sqlite>
  node scripts/ios-quick.mjs wechat <Documents/<hash>>
  node scripts/ios-quick.mjs summary <Photos.sqlite> [Accounts3.sqlite] [ChatStorage.sqlite] [Documents/<hash>]`)
      process.exit(command ? 2 : 0)
    }
  }
} catch (error) {
  console.error('失败：' + (error && error.message ? error.message : error))
  process.exit(1)
}
