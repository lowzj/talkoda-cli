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
import { formatError, getLanguage, setLanguage, t } from '../lib/i18n.mjs'
import {
  generationOptions,
  integerOption,
  metadataFromFlags,
  metadataOptions,
  normalizeTag,
  measureStory,
  storyLengthError,
  STORY_TARGET_CHARACTERS,
  STORY_MAX_CHARACTERS,
} from '../lib/metadata.mjs'

const helpZh = `Talkoda CLI — 把对话，谱成歌。

用法: talkoda <命令> [选项]

skills install --agent codex|claude|pi|opencode [--scope user|project] [--force]
                                  安装会话作曲与发布技能
skills show                       输出通用技能说明
compose init --conversation FILE [--name NAME --output DIRECTORY --title TITLE --bpm 108 --cycles 64]
                                  默认新建 ~/.talkoda/songs/NAME，由当前 AI 完成作曲
story check [FILE]                本地校验故事简介，默认读取 story.md，无需登录
render doctor                     检查独立音频渲染环境
render setup                      安装 Chromium（已有 Chrome 时通常不需要）
render --source FILE --output FILE.mp3 --bpm N --cycles N [--browser PATH]
                                  离线渲染 Strudel 为 MP3，使用内置合成器
play FILE [--player auto|afplay|ffplay|mpv]
                                  在终端播放本地 MP3/M4A/WAV，Ctrl-C 停止
play --track ID [--player auto|afplay|ffplay|mpv]
                                  通过 API 下载有权限的作品后播放
play doctor                       检查终端播放器

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
tracks list [--sort latest|weekly] [--query TEXT] [--tag TAG] [--page N|--all]
tags list [--query TEXT]            查询标签与公开作品数量
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
tracks share ID                    获取作品及社交平台分享链接（不发帖）
tracks record-play ID --event-id UUID --seconds N
                                  上报实际播放事件，至少播放 5 秒，需 Token
tracks download ID --kind audio|source --output PATH [--range bytes=0-99]
  --head                          只读取媒体响应头，无需 --output
likes add|remove ID                喜欢 / 取消喜欢
favorites add|remove ID            收藏 / 取消收藏

资料选项: --title --summary --summary-file --genre --cover blue|mint|peach|violet
          --bpm N|none --engine-version VERSION
          --agent NAME --model NAME --tokens N|none
          --prompt TEXT | --prompt-file PATH
          --source-visibility public|private --prompt-visibility public|private
          --tags "标签1,标签2" --copyright-notice TEXT
compose init 也支持以上生成来源、可见性、标签与版权资料选项。
story/summary 默认目标 ${STORY_TARGET_CHARACTERS} 字符，硬上限 ${STORY_MAX_CHARACTERS}；按 trim 后 UTF-16 长度计数，超限在请求前拒绝。
通用选项: --lang en|zh（默认系统语言） --url ORIGIN --json --help --version
环境变量: TALKODA_API_TOKEN, TALKODA_API_URL, TALKODA_HOME, TALKODA_CONFIG_FILE
默认根目录: ~/.talkoda；配置文件: ~/.talkoda/config.json
默认地址: https://talkoda.com
源码默认公开，提示词默认私密。未提供的资料字段保持原值。
上传默认保存草稿。Token 不会作为 URL 参数发送，也不会转发到重定向地址。`

const helpEn = `Talkoda CLI — Turn conversations into music.

Usage: talkoda <command> [options]

skills install --agent codex|claude|pi|opencode [--scope user|project] [--force]
                                  Install the conversation composition/publishing skill
skills show                       Print the portable skill instructions
compose init --conversation FILE [--name NAME --output DIRECTORY --title TITLE --bpm 108 --cycles 64]
                                  Create a fresh workspace in ~/.talkoda/songs/NAME by default
story check [FILE]                Check the public story locally; defaults to story.md, no login
render doctor                     Check the isolated audio renderer
render setup                      Install Chromium if Chrome is unavailable
render --source FILE --output FILE.mp3 --bpm N --cycles N [--browser PATH]
                                  Render Strudel offline with built-in synthesizers
play FILE [--player auto|afplay|ffplay|mpv]
                                  Play a local MP3/M4A/WAV in the terminal; Ctrl-C stops
play --track ID [--player auto|afplay|ffplay|mpv]
                                  Download an accessible track via the API and play it
play doctor                       Check available terminal audio players

auth login                        Save a Token securely with hidden input
  --token-stdin | --token-file PATH Automation input options
auth status                       Show the current identity
auth logout                       Revoke the active Token and clear local login
profile get                       Show your profile and site configuration
profile update --name NAME        Change your display name
tokens list                       List your Tokens
tokens create --name NAME --output PATH [--days 90]
                                  Create a Token in a new private file only
tokens revoke ID --yes             Revoke a Token
tracks list [--sort latest|weekly] [--query TEXT] [--tag TAG] [--page N|--all]
tags list [--query TEXT]           Search tags and public track counts
charts [--page N|--all]            Seven-day new releases chart
library [--tab tracks|likes|favorites] [--page N|--all]
tracks get ID                     Show a track
tracks create --title TITLE       Create a draft
tracks update ID [metadata]       Update supplied metadata fields
tracks upload [--id ID | --title TITLE] --source PATH --audio PATH [--publish]
                                  Create/update draft files and optionally publish
tracks publish ID                 Publish a track
tracks unpublish ID               Withdraw your track
tracks hide ID                    Hide a track as an administrator
tracks delete ID --yes            Delete a never-published draft
tracks share ID                   Return track and social sharing URLs (no posting)
tracks record-play ID --event-id UUID --seconds N
                                  Report real playback of at least 5 seconds; needs a Token
tracks download ID --kind audio|source --output PATH [--range bytes=0-99]
  --head                          Read media headers only; no --output needed
likes add|remove ID                Like / unlike
favorites add|remove ID            Favorite / unfavorite

Metadata: --title --summary --summary-file --genre --cover blue|mint|peach|violet
          --bpm N|none --engine-version VERSION
          --agent NAME --model NAME --tokens N|none
          --prompt TEXT | --prompt-file PATH
          --source-visibility public|private --prompt-visibility public|private
          --tags "tag1,tag2" --copyright-notice TEXT
compose init also accepts the generation, visibility, tags and copyright metadata above.
Story/summary target: ${STORY_TARGET_CHARACTERS} characters; hard maximum: ${STORY_MAX_CHARACTERS}, counted as trimmed UTF-16 length; oversized input is rejected before requests.
Global options: --lang en|zh (system locale by default) --url ORIGIN --json --help --version
Environment: TALKODA_API_TOKEN, TALKODA_API_URL, TALKODA_HOME, TALKODA_CONFIG_FILE
Default home: ~/.talkoda; configuration: ~/.talkoda/config.json
Default server: https://talkoda.com
Source is public and prompts private by default. Unspecified metadata is preserved.
Uploads default to drafts. Tokens never appear in URLs or follow redirects.`

const stringOptions = [
  ...generationOptions,
  'lang',
  'tag',
  'event-id',
  'seconds',
  'scope',
  'conversation',
  'cycles',
  'browser',
  'player',
  'track',
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

function shareUrls(url, title = 'Talkoda') {
  const intent = (base, values) => `${base}?${new URLSearchParams(values)}`
  return {
    x: intent('https://x.com/intent/tweet', { url, text: title }),
    facebook: intent('https://www.facebook.com/sharer/sharer.php', { u: url }),
    linkedin: intent('https://www.linkedin.com/sharing/share-offsite/', { url }),
    whatsapp: intent('https://wa.me/', { text: `${title} ${url}` }),
    telegram: intent('https://t.me/share/url', { url, text: title }),
    weibo: intent('https://service.weibo.com/share/share.php', { url, title }),
  }
}

async function main() {
  const languageFlag = process.argv
    .slice(2)
    .findIndex((arg) => arg === '--lang' || arg.startsWith('--lang='))
  if (languageFlag >= 0) {
    const args = process.argv.slice(2)
    setLanguage(
      args[languageFlag].includes('=') ? args[languageFlag].slice(7) : args[languageFlag + 1],
    )
  }
  const { values: flags, positionals: args } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...stringOptions.map((key) => [key, { type: 'string' }]),
      ...booleanOptions.map((key) => [key, { type: 'boolean' }]),
    ]),
  })
  setLanguage(flags.lang)
  if (flags.version) {
    console.log(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
    )
    return
  }
  if (flags.help || !args.length) {
    console.log(getLanguage() === 'zh' ? helpZh : helpEn)
    return
  }
  if (args[0] === 'story') {
    if (
      args[1] !== 'check' ||
      args.length > 3 ||
      Object.keys(flags).some((key) => !['lang', 'json'].includes(key))
    )
      throw new Error(
        t(
          '使用 story check [FILE]，默认文件为 story.md。',
          'Use story check [FILE]; the default file is story.md.',
        ),
      )
    const file = resolve(args[2] ?? 'story.md')
    const result = { file, ...measureStory(await readFile(file, 'utf8')) }
    console.log(JSON.stringify(result, null, flags.json ? 0 : 2))
    if (!result.valid) throw storyLengthError(result.characters)
    return
  }
  if (args[0] === 'play') {
    const { playbackCommand } = await import('../lib/playback.mjs')
    await playbackCommand(args, flags)
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
    if (args.length !== count)
      throw new Error(
        t(
          '命令参数不完整或过多，请运行 talkoda --help。',
          'Missing or extra command arguments. Run talkoda --help.',
        ),
      )
    const unknown = Object.keys(flags).filter(
      (key) => !['lang', 'url', 'json', 'help', 'version', ...allowed].includes(key),
    )
    if (unknown.length)
      throw new Error(
        t(
          `该命令不支持：${unknown.map((key) => `--${key}`).join(', ')}`,
          `Unsupported options for this command: ${unknown.map((key) => `--${key}`).join(', ')}`,
        ),
      )
  }
  const requireValue = (key) => {
    if (typeof flags[key] !== 'string' || !flags[key].trim())
      throw new Error(t(`请提供 --${key}。`, `Please provide --${key}.`))
    return flags[key]
  }
  const idPath = (id) => `/api/tracks/${encodeURIComponent(id)}`
  const numeric = (key, fallback, min, max) => integerOption(flags, key, fallback, min, max)
  const metadata = () => metadataFromFlags(flags)
  async function list(path, params) {
    if (flags.all && flags.page)
      throw new Error(t('--all 和 --page 只能选择一个。', 'Choose either --all or --page.'))
    const tracks = []
    let page = numeric('page', 1, 1, 1000)
    for (;;) {
      const query = new URLSearchParams({ ...params, page: String(page) })
      const result = await api.request(`${path}?${query}`)
      if (!flags.all) return print(result)
      tracks.push(...result.tracks)
      if (!result.hasMore) return print({ tracks, hasMore: false })
      if (++page > 1000)
        throw new Error(
          t(
            '结果超过 API 的分页上限，请缩小查询范围。',
            'Results exceed the API pagination limit. Narrow your query.',
          ),
        )
    }
  }
  const [command, action, id] = args
  if (command === 'auth' && action === 'login') {
    check(2, ['token-stdin', 'token-file'])
    if (flags['token-stdin'] && flags['token-file'])
      throw new Error(t('Token 输入方式只能选择一个。', 'Choose only one Token input method.'))
    let entered = ''
    if (flags['token-file']) {
      if ((await stat(flags['token-file'])).size > 1024)
        throw new Error(t('Token 文件过大。', 'The Token file is too large.'))
      entered = await readFile(flags['token-file'], 'utf8')
    } else if (flags['token-stdin']) {
      for await (const chunk of process.stdin) {
        entered += chunk.toString()
        if (entered.length > 1024)
          throw new Error(t('Token 输入过长。', 'The Token input is too long.'))
      }
    } else {
      if (!process.stdin.isTTY)
        throw new Error(
          t(
            '非交互环境请使用 --token-stdin 或 --token-file。',
            'Use --token-stdin or --token-file in a non-interactive environment.',
          ),
        )
      process.stderr.write(t('API Token（输入不回显）: ', 'API Token (input hidden): '))
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
    if (!identity.user)
      throw new Error(t('Token 未关联有效用户。', 'The Token is not linked to a valid user.'))
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
      message: t(
        'Token 已撤销，本地登录已清除。',
        'The Token was revoked and local login cleared.',
      ),
      ...(process.env.TALKODA_API_TOKEN
        ? {
            note: t(
              '请同时清除当前终端的 TALKODA_API_TOKEN 环境变量。',
              'Also clear TALKODA_API_TOKEN from your current terminal.',
            ),
          }
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
          throw new Error(
            t(
              `Token 已创建但保存失败，请撤销 Token ${result.apiToken.id} 后重试。`,
              `The Token was created but could not be saved. Revoke Token ${result.apiToken.id} before retrying.`,
            ),
            {
              cause: error,
            },
          )
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
      if (!flags.yes)
        throw new Error(
          t('请加 --yes 确认撤销此 Token。', 'Add --yes to confirm revoking this Token.'),
        )
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
      throw new Error(
        t('--tab 必须是 tracks、likes 或 favorites。', '--tab must be tracks, likes or favorites.'),
      )
    await list('/api/library', { tab: flags.tab || 'tracks' })
    return
  }
  if (command === 'charts' || (command === 'tracks' && action === 'list')) {
    check(command === 'charts' ? 1 : 2, ['sort', 'query', 'tag', 'page', 'all'])
    if (flags.sort && !['latest', 'weekly'].includes(flags.sort))
      throw new Error(t('--sort 必须是 latest 或 weekly。', '--sort must be latest or weekly.'))
    await list('/api/tracks', {
      sort: command === 'charts' ? 'weekly' : flags.sort || 'latest',
      q: flags.query || '',
      ...(flags.tag !== undefined ? { tag: normalizeTag(requireValue('tag')) } : {}),
    })
    return
  }
  if (command === 'tags' && action === 'list') {
    check(2, ['query'])
    print(await api.request(`/api/tags?${new URLSearchParams({ q: flags.query || '' })}`))
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
              shareUrls:
                data.track.status === 'published'
                  ? shareUrls(`${origin}/t/${encodeURIComponent(id)}`, data.track.title)
                  : {},
            },
      )
      return
    }
    if (action === 'record-play') {
      check(3, ['event-id', 'seconds'])
      api.requireToken()
      const eventId = requireValue('event-id')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId))
        throw new Error(t('--event-id 必须是 UUID。', '--event-id must be a UUID.'))
      const secondsPlayed = Number(requireValue('seconds'))
      if (!Number.isFinite(secondsPlayed) || secondsPlayed < 5)
        throw new Error(
          t(
            '--seconds 必须是至少 5 秒的实际播放时长。',
            '--seconds must be the actual playback duration of at least 5 seconds.',
          ),
        )
      print(
        await api.request(`${idPath(id)}/plays`, {
          method: 'POST',
          body: { eventId, secondsPlayed },
        }),
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
        throw new Error(t('请提供需要修改的资料字段。', 'Provide the metadata fields to update.'))
      print(
        await api.request(idPath(id), {
          method: 'PATCH',
          body: await metadata(),
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
        throw new Error(
          t('源码必须是 1 B–128 KB 的 .js 文件。', 'Source must be a .js file of 1 B–128 KB.'),
        )
      if (
        !audioInfo.isFile() ||
        !audioInfo.size ||
        audioInfo.size > 16 * 1024 * 1024 ||
        !['.mp3', '.m4a'].includes(extname(audio).toLowerCase())
      )
        throw new Error(
          t(
            '音频必须是 1 B–16 MB 的 MP3/M4A 文件。',
            'Audio must be an MP3/M4A file of 1 B–16 MB.',
          ),
        )
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
        process.stderr.write(t(`已创建草稿 ${trackId}\n`, `Created draft ${trackId}\n`))
      } else if (Object.keys(details).length) {
        await api.request(idPath(trackId), {
          method: 'PATCH',
          body: details,
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
          t(
            `${error.message}\n作品 ID: ${trackId}。先用 tracks get 检查状态；文件未就绪时用 tracks upload --id ${trackId} 重试，文件就绪后可直接 tracks publish。`,
            `${error.message}\nTrack ID: ${trackId}. Check tracks get first; retry missing files with tracks upload --id ${trackId}, or use tracks publish if files are ready.`,
          ),
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
      if (!flags.yes)
        throw new Error(
          t(
            '请加 --yes 确认删除草稿。已发布作品使用 tracks unpublish。',
            'Add --yes to confirm deleting the draft. Use tracks unpublish for published tracks.',
          ),
        )
      print(await api.request(idPath(id), { method: 'DELETE' }))
      return
    }
    if (action === 'download') {
      check(3, ['kind', 'output', 'range', 'head'])
      const kind = requireValue('kind')
      if (!['audio', 'source'].includes(kind))
        throw new Error(t('--kind 必须是 audio 或 source。', '--kind must be audio or source.'))
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
  throw new Error(t('未知命令，请运行 talkoda --help。', 'Unknown command. Run talkoda --help.'))
}

main().catch((error) => {
  // Native filesystem/argument errors may echo input; never echo an environment token.
  const token = process.env.TALKODA_API_TOKEN
  const message = formatError(error)
  process.stderr.write(`Talkoda: ${token ? message.replaceAll(token, '[redacted]') : message}\n`)
  process.exitCode = 1
})
