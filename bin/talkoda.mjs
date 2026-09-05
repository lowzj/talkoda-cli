#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { openAsBlob } from 'node:fs'
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import {
  apiOrigin,
  client,
  configPath,
  saveToken,
  tokenFor,
  validateToken,
} from '../lib/client.mjs'

const help = `Talkoda CLI — 把对话，谱成歌。

用法: talkoda <命令> [选项]

skills install --agent codex|claude|pi|opencode [--scope user|project] [--force]
                                  安装会话作曲与发布技能
skills show                       输出通用技能说明
compose init --conversation FILE --output DIRECTORY [--title TITLE --bpm 108 --cycles 64]
                                  准备本地创作工作区，由当前 AI 完成作曲
render doctor                     检查独立音频渲染环境
render setup                      安装 Chromium（已有 Chrome 时通常不需要）
render --source FILE --output FILE.mp3 --bpm N --cycles N [--browser PATH]
                                  离线渲染 Strudel 为 MP3，使用内置合成器

auth login                         输入 Token 并安全保存（输入不回显）
  --token-stdin | --token-file PATH 自动化输入方式
auth status                        查看当前身份
auth logout                        撤销当前 Token 并清除本地登录
profile get                        查看当前资料与站点配置
profile update --name NAME         修改昵称
tokens list                        列出自己的 Token
tokens create --name NAME --output PATH [--days 90]
                                  创建 Token，仅写入指定的新文件
tokens revoke ID --yes             撤销指定 Token
tracks list [--sort latest|weekly] [--query TEXT] [--page N|--all]
charts [--page N|--all]             七日新作榜
library [--tab tracks|likes|favorites] [--page N|--all]
tracks get ID                      查看作品
tracks create --title TITLE        创建草稿
tracks update ID [资料选项]        修改作品介绍
tracks upload [--id ID | --title TITLE] --source PATH --audio PATH [--publish]
                                  创建/更新草稿文件，可直接发布
tracks publish ID                  发布作品
tracks unpublish ID                下架自己的作品
tracks hide ID                     管理员隐藏作品
tracks delete ID --yes             删除从未发布的草稿
tracks share ID                    获取分享链接
tracks download ID --kind audio|source --output PATH [--range bytes=0-99]
  --head                          只读取媒体响应头，无需 --output
likes add|remove ID                喜欢 / 取消喜欢
favorites add|remove ID            收藏 / 取消收藏

资料选项: --title --summary --summary-file --genre --cover blue|mint|peach|violet
          --bpm N|none --engine-version VERSION
通用选项: --url ORIGIN --json --help --version
环境变量: TALKODA_API_TOKEN, TALKODA_API_URL, TALKODA_CONFIG_FILE
默认地址: https://talkoda.com
上传默认保存草稿。Token 不会作为 URL 参数发送，也不会转发到重定向地址。`

const stringOptions = [
  'agent',
  'scope',
  'conversation',
  'cycles',
  'browser',
  'url',
  'token-file',
  'name',
  'output',
  'days',
  'sort',
  'query',
  'page',
  'tab',
  'title',
  'summary',
  'summary-file',
  'genre',
  'cover',
  'bpm',
  'engine-version',
  'id',
  'source',
  'audio',
  'kind',
  'range',
]
const booleanOptions = [
  'help',
  'version',
  'json',
  'token-stdin',
  'all',
  'publish',
  'yes',
  'head',
  'force',
]
const metadataOptions = [
  'title',
  'summary',
  'summary-file',
  'genre',
  'cover',
  'bpm',
  'engine-version',
]

async function main() {
  const { values: flags, positionals: args } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...stringOptions.map((key) => [key, { type: 'string' }]),
      ...booleanOptions.map((key) => [key, { type: 'boolean' }]),
    ]),
  })
  if (flags.version) {
    console.log(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
    )
    return
  }
  if (flags.help || !args.length) {
    console.log(help)
    return
  }
  if (['skills', 'compose', 'render'].includes(args[0])) {
    const { creativeCommand } = await import('../lib/creative.mjs')
    await creativeCommand(args, flags)
    return
  }
  const origin = apiOrigin(flags.url || process.env.TALKODA_API_URL)
  const token = await tokenFor(origin),
    api = client(origin, token)
  const print = (value) => console.log(JSON.stringify(value, null, flags.json ? 0 : 2))
  const check = (count, allowed = []) => {
    if (args.length !== count) throw new Error('命令参数不完整或过多，请运行 talkoda --help。')
    const unknown = Object.keys(flags).filter(
      (key) => !['url', 'json', 'help', 'version', ...allowed].includes(key),
    )
    if (unknown.length)
      throw new Error(`该命令不支持：${unknown.map((key) => `--${key}`).join(', ')}`)
  }
  const requireValue = (key) => {
    if (typeof flags[key] !== 'string' || !flags[key].trim()) throw new Error(`请提供 --${key}。`)
    return flags[key]
  }
  const idPath = (id) => `/api/tracks/${encodeURIComponent(id)}`
  const numeric = (key, fallback, min, max) => {
    const value = flags[key] === undefined ? fallback : Number(flags[key])
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`--${key} 必须是 ${min}–${max} 的整数。`)
    return value
  }
  async function metadata(existing) {
    const data = existing
      ? Object.fromEntries(
          ['title', 'summary', 'genre', 'cover', 'bpm', 'engineVersion'].map((key) => [
            key,
            existing[key],
          ]),
        )
      : {}
    for (const key of ['title', 'summary', 'genre', 'cover'])
      if (flags[key] !== undefined) data[key] = flags[key]
    if (flags['summary-file'] !== undefined) {
      if (flags.summary !== undefined) throw new Error('--summary 和 --summary-file 只能选择一个。')
      data.summary = await readFile(flags['summary-file'], 'utf8')
    }
    if (flags.bpm !== undefined)
      data.bpm = flags.bpm === 'none' ? null : numeric('bpm', 108, 20, 300)
    if (flags['engine-version'] !== undefined) data.engineVersion = flags['engine-version']
    return data
  }
  async function list(path, params) {
    if (flags.all && flags.page) throw new Error('--all 和 --page 只能选择一个。')
    const tracks = []
    let page = numeric('page', 1, 1, 1000)
    for (;;) {
      const query = new URLSearchParams({ ...params, page: String(page) })
      const result = await api.request(`${path}?${query}`)
      if (!flags.all) return print(result)
      tracks.push(...result.tracks)
      if (!result.hasMore) return print({ tracks, hasMore: false })
      if (++page > 1000) throw new Error('结果超过 API 的分页上限，请缩小查询范围。')
    }
  }
  const [command, action, id] = args
  if (command === 'auth' && action === 'login') {
    check(2, ['token-stdin', 'token-file'])
    if (flags['token-stdin'] && flags['token-file']) throw new Error('Token 输入方式只能选择一个。')
    let entered = ''
    if (flags['token-file']) {
      if ((await stat(flags['token-file'])).size > 1024) throw new Error('Token 文件过大。')
      entered = await readFile(flags['token-file'], 'utf8')
    } else if (flags['token-stdin']) {
      for await (const chunk of process.stdin) {
        entered += chunk.toString()
        if (entered.length > 1024) throw new Error('Token 输入过长。')
      }
    } else {
      if (!process.stdin.isTTY) throw new Error('非交互环境请使用 --token-stdin 或 --token-file。')
      process.stderr.write('API Token（输入不回显）: ')
      const muted = new Writable({
        write(_chunk, _encoding, done) {
          done()
        },
      })
      const reader = createInterface({
        input: process.stdin,
        output: muted,
        terminal: true,
        historySize: 0,
      })
      try {
        entered = await reader.question('')
      } finally {
        reader.close()
        process.stderr.write('\n')
      }
    }
    entered = validateToken(entered.trim())
    const identity = await client(origin, entered).request('/api/me')
    if (!identity.user) throw new Error('Token 未关联有效用户。')
    await saveToken(origin, entered)
    print({ user: identity.user, origin, savedTo: configPath() })
    return
  }
  if ((command === 'auth' && action === 'status') || (command === 'profile' && action === 'get')) {
    check(2)
    api.requireToken()
    print(await api.request('/api/me'))
    return
  }
  if (command === 'auth' && action === 'logout') {
    check(2)
    api.requireToken()
    try {
      await api.request('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      if (!error.message.startsWith('HTTP 401:')) throw error
    }
    await saveToken(origin, null)
    print({
      ok: true,
      message: 'Token 已撤销，本地登录已清除。',
      ...(process.env.TALKODA_API_TOKEN
        ? { note: '请同时清除当前终端的 TALKODA_API_TOKEN 环境变量。' }
        : {}),
    })
    return
  }
  if (command === 'profile' && action === 'update') {
    check(2, ['name'])
    api.requireToken()
    print(
      await api.request('/api/me', {
        method: 'PATCH',
        body: { displayName: requireValue('name') },
      }),
    )
    return
  }
  if (command === 'tokens') {
    api.requireToken()
    if (action === 'list') {
      check(2)
      print(await api.request('/api/auth/tokens'))
      return
    }
    if (action === 'create') {
      check(2, ['name', 'days', 'output'])
      const output = resolve(requireValue('output')),
        name = requireValue('name'),
        days = numeric('days', 90, 1, 365)
      // Reserve a private new file before creating an irreversible one-time secret.
      const file = await open(output, 'wx', 0o600)
      let result
      try {
        result = await api.request('/api/auth/tokens', {
          method: 'POST',
          body: { name, expiresInDays: days },
        })
        await file.writeFile(result.token + '\n')
        await file.sync()
      } catch (error) {
        if (result)
          throw new Error(`Token 已创建但保存失败，请撤销 Token ${result.apiToken.id} 后重试。`, {
            cause: error,
          })
        await rm(output, { force: true })
        throw error
      } finally {
        await file.close()
      }
      print({ apiToken: result.apiToken, savedTo: output })
      return
    }
    if (action === 'revoke') {
      check(3, ['yes'])
      if (!flags.yes) throw new Error('请加 --yes 确认撤销此 Token。')
      print(
        await api.request(`/api/auth/tokens/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }),
      )
      return
    }
  }
  if (command === 'library') {
    check(1, ['tab', 'page', 'all'])
    api.requireToken()
    if (flags.tab && !['tracks', 'likes', 'favorites'].includes(flags.tab))
      throw new Error('--tab 必须是 tracks、likes 或 favorites。')
    await list('/api/library', { tab: flags.tab || 'tracks' })
    return
  }
  if (command === 'charts' || (command === 'tracks' && action === 'list')) {
    check(command === 'charts' ? 1 : 2, ['sort', 'query', 'page', 'all'])
    if (flags.sort && !['latest', 'weekly'].includes(flags.sort))
      throw new Error('--sort 必须是 latest 或 weekly。')
    await list('/api/tracks', {
      sort: command === 'charts' ? 'weekly' : flags.sort || 'latest',
      q: flags.query || '',
    })
    return
  }
  if (command === 'tracks') {
    if (action === 'get' || action === 'share') {
      check(3)
      const data = await api.request(idPath(id))
      print(
        action === 'get'
          ? data
          : {
              url: `${origin}/t/${encodeURIComponent(id)}`,
              status: data.track.status,
            },
      )
      return
    }
    if (action === 'create') {
      check(2, metadataOptions)
      api.requireToken()
      requireValue('title')
      print(
        await api.request('/api/tracks', {
          method: 'POST',
          body: await metadata(),
        }),
      )
      return
    }
    if (action === 'update') {
      check(3, metadataOptions)
      api.requireToken()
      if (!metadataOptions.some((key) => flags[key] !== undefined))
        throw new Error('请提供需要修改的资料字段。')
      const { track } = await api.request(idPath(id))
      print(
        await api.request(idPath(id), {
          method: 'PATCH',
          body: await metadata(track),
        }),
      )
      return
    }
    if (action === 'upload') {
      check(2, [...metadataOptions, 'id', 'source', 'audio', 'publish'])
      api.requireToken()
      const source = requireValue('source'),
        audio = requireValue('audio')
      const sourceInfo = await stat(source),
        audioInfo = await stat(audio)
      if (
        !sourceInfo.isFile() ||
        !sourceInfo.size ||
        sourceInfo.size > 128 * 1024 ||
        extname(source).toLowerCase() !== '.js'
      )
        throw new Error('源码必须是 1 B–128 KB 的 .js 文件。')
      if (
        !audioInfo.isFile() ||
        !audioInfo.size ||
        audioInfo.size > 16 * 1024 * 1024 ||
        !['.mp3', '.m4a'].includes(extname(audio).toLowerCase())
      )
        throw new Error('音频必须是 1 B–16 MB 的 MP3/M4A 文件。')
      const details = await metadata()
      if (!flags.id) requireValue('title')
      const form = new FormData()
      form.set('source', await openAsBlob(source, { type: 'text/plain' }), basename(source))
      form.set(
        'audio',
        await openAsBlob(audio, {
          type: extname(audio).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
        }),
        basename(audio),
      )
      let trackId = flags.id
      if (!trackId) {
        trackId = (await api.request('/api/tracks', { method: 'POST', body: details })).track.id
        process.stderr.write(`已创建草稿 ${trackId}\n`)
      } else if (Object.keys(details).length) {
        const { track } = await api.request(idPath(trackId))
        await api.request(idPath(trackId), {
          method: 'PATCH',
          body: await metadata(track),
        })
      }
      let result
      try {
        result = await api.request(`${idPath(trackId)}/files`, {
          method: 'PUT',
          body: form,
        })
        if (flags.publish)
          result = await api.request(`${idPath(trackId)}/status`, {
            method: 'POST',
            body: { status: 'published' },
          })
      } catch (error) {
        throw new Error(
          `${error.message}\n作品 ID: ${trackId}。先用 tracks get 检查状态；文件未就绪时用 tracks upload --id ${trackId} 重试，文件就绪后可直接 tracks publish。`,
          { cause: error },
        )
      }
      print({ ...result, url: `${origin}/t/${encodeURIComponent(trackId)}` })
      return
    }
    if (['publish', 'unpublish', 'hide'].includes(action)) {
      check(3)
      api.requireToken()
      print(
        await api.request(`${idPath(id)}/status`, {
          method: 'POST',
          body: {
            status: {
              publish: 'published',
              unpublish: 'unpublished',
              hide: 'hidden',
            }[action],
          },
        }),
      )
      return
    }
    if (action === 'delete') {
      check(3, ['yes'])
      api.requireToken()
      if (!flags.yes) throw new Error('请加 --yes 确认删除草稿。已发布作品使用 tracks unpublish。')
      print(await api.request(idPath(id), { method: 'DELETE' }))
      return
    }
    if (action === 'download') {
      check(3, ['kind', 'output', 'range', 'head'])
      const kind = requireValue('kind')
      if (!['audio', 'source'].includes(kind)) throw new Error('--kind 必须是 audio 或 source。')
      const output = flags.head ? null : resolve(requireValue('output'))
      const response = await api.request(`${idPath(id)}/media/${kind}`, {
        method: flags.head ? 'HEAD' : 'GET',
        headers: flags.range ? { Range: flags.range } : {},
        raw: true,
      })
      if (output)
        await writeFile(output, new Uint8Array(await response.arrayBuffer()), {
          flag: 'wx',
          mode: 0o600,
        })
      print({
        status: response.status,
        ...(output ? { savedTo: output } : {}),
        headers: Object.fromEntries(
          ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag'].map(
            (key) => [key, response.headers.get(key)],
          ),
        ),
      })
      return
    }
  }
  if (['likes', 'favorites'].includes(command) && ['add', 'remove'].includes(action)) {
    check(3)
    api.requireToken()
    print(
      await api.request(`${idPath(id)}/${command}`, {
        method: action === 'add' ? 'PUT' : 'DELETE',
      }),
    )
    return
  }
  throw new Error('未知命令，请运行 talkoda --help。')
}

main().catch((error) => {
  // Native filesystem/argument errors may echo input; never echo an environment token.
  const token = process.env.TALKODA_API_TOKEN
  process.stderr.write(
    `Talkoda: ${token ? error.message.replaceAll(token, '[redacted]') : error.message}\n`,
  )
  process.exitCode = 1
})
