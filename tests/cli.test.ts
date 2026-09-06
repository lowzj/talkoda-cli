import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve('bin/talkoda.mjs')
const credential = `tk_${'a'.repeat(64)}`,
  newCredential = `tk_${'b'.repeat(64)}`
let server: Server, origin: string, directory: string
let requests: {
  path: string
  method: string
  authorization?: string
  origin?: string
  language?: string
  body: unknown
}[]
let failUpload = false,
  redirect = false,
  failTokenCreation = false,
  privateSource = false
const track = {
  id: 'song-1',
  title: '原始标题',
  summary: '保留这段故事',
  genre: 'Lo-fi',
  cover: 'mint',
  bpm: 108,
  engineVersion: '1.3.0',
  status: 'draft',
  sourceReady: false,
  audioReady: false,
}

async function run(args: string[], { input = '', token = credential } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const child = spawn(process.execPath, [executable, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          LC_ALL: 'zh_CN.UTF-8',
          TALKODA_API_URL: origin,
          TALKODA_API_TOKEN: token,
          TALKODA_CONFIG_FILE: join(directory, 'config.json'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => resolveResult({ code, stdout, stderr }))
      child.stdin.end(input)
    },
  )
}
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, origin)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    let body: unknown = bytes.length ? bytes.toString() : null
    if (request.headers['content-type']?.includes('application/json'))
      body = JSON.parse(bytes.toString())
    if (request.headers['content-type']?.includes('multipart/form-data')) {
      const form = await new Response(new Uint8Array(bytes).buffer, {
        headers: { 'content-type': request.headers['content-type'] },
      }).formData()
      const source = form.get('source') as File,
        audio = form.get('audio') as File
      body = {
        source: await source.text(),
        sourceName: source.name,
        audio: [...new Uint8Array(await audio.arrayBuffer())],
        audioName: audio.name,
      }
    }
    requests.push({
      path: url.pathname + url.search,
      method: request.method!,
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      language: request.headers['accept-language'],
      body,
    })
    response.setHeader('Content-Type', 'application/json')
    if (redirect) {
      response.writeHead(302, { Location: `${origin}/unexpected-redirect` })
      response.end()
      return
    }
    if (
      request.headers.authorization &&
      request.headers.authorization !== `Bearer ${credential}` &&
      request.headers.authorization !== `Bearer ${newCredential}`
    ) {
      response.writeHead(401)
      response.end(JSON.stringify({ error: 'invalid token' }))
      return
    }
    if (url.pathname.endsWith('/media/audio') || url.pathname.endsWith('/media/source')) {
      if (privateSource && url.pathname.endsWith('/media/source')) {
        response.writeHead(403)
        response.end(
          JSON.stringify({
            error: request.headers['accept-language'] === 'zh' ? '源码为私密' : 'Source is private',
          }),
        )
        return
      }
      response.setHeader('Content-Type', 'application/octet-stream')
      response.setHeader('Content-Length', '3')
      if (request.headers.range) {
        response.statusCode = 206
        response.setHeader('Content-Range', 'bytes 0-2/12')
      }
      response.end(request.method === 'HEAD' ? undefined : Buffer.from([1, 2, 3]))
      return
    }
    let result: unknown = { ok: true }
    if (url.pathname === '/api/me') result = { user: { id: 'alice', displayName: 'Alice' } }
    if (url.pathname === '/api/tracks' && request.method === 'GET')
      result = {
        tracks: [{ ...track, id: `song-${url.searchParams.get('page')}` }],
        hasMore: url.searchParams.get('page') !== '2',
      }
    if (url.pathname === '/api/tags') result = { tags: [{ tag: 'lo-fi', count: 2 }] }
    if (url.pathname.endsWith('/plays')) result = { counted: true, playCount: 3 }
    if (url.pathname === '/api/library') result = { tracks: [track], hasMore: false }
    if (url.pathname === '/api/tracks' && request.method === 'POST') {
      response.statusCode = 201
      result = { track }
    }
    if (url.pathname === '/api/tracks/song-1')
      result = { track: { ...track, ...(request.method === 'PATCH' ? (body as object) : {}) } }
    if (url.pathname.endsWith('/files')) {
      if (failUpload) {
        response.statusCode = 422
        result = { error: 'invalid audio' }
      } else result = { track: { ...track, audioReady: true, sourceReady: true } }
    }
    if (url.pathname.endsWith('/status')) result = { track: { ...track, ...(body as object) } }
    if (url.pathname === '/api/auth/tokens') {
      if (failTokenCreation && request.method === 'POST') {
        response.statusCode = 429
        response.end(JSON.stringify({ error: 'Token limit reached' }))
        return
      }
      result =
        request.method === 'POST'
          ? { token: newCredential, apiToken: { id: 'token-2', name: 'automation' } }
          : { tokens: [{ id: 'token-1', name: 'laptop' }], currentTokenId: 'token-1' }
    }
    response.end(JSON.stringify(result))
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  origin = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'talkoda-cli-test-'))
  requests = []
  failUpload = false
  redirect = false
  failTokenCreation = false
  privateSource = false
  track.status = 'draft'
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

describe('CLI authentication and transport', () => {
  it('stores a verified token privately without printing it and reuses it for the same origin', async () => {
    const login = await run(['auth', 'login', '--token-stdin'], {
      input: credential + '\n',
      token: '',
    })
    expect(login.code, login.stderr).toBe(0)
    expect(login.stdout + login.stderr).not.toContain(credential)
    const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
    expect(config.credentials[origin].token).toBe(credential)
    expect((await stat(join(directory, 'config.json'))).mode & 0o777).toBe(0o600)
    expect((await run(['auth', 'status'], { token: '' })).code).toBe(0)
    expect(
      requests.every((item) => item.authorization === `Bearer ${credential}` && !item.origin),
    ).toBe(true)
    expect((await run(['auth', 'logout'], { token: '' })).code).toBe(0)
    expect((await run(['auth', 'status'], { token: '' })).code).toBe(1)
  })
  it('refuses non-local HTTP, insecure URL components, and credential forwarding through redirects', async () => {
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/path',
      'https://example.com/?token=bad',
    ]) {
      expect((await run(['tracks', 'list', '--url', url])).code).toBe(1)
    }
    expect(requests).toEqual([])
    redirect = true
    const result = await run(['tracks', 'list'])
    expect(result.code).toBe(1)
    expect(requests).toHaveLength(1)
    expect(result.stderr).not.toContain(credential)
  })
  it('does not use credentials stored for another origin', async () => {
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({ version: 1, credentials: { 'https://talkoda.com': { token: credential } } }),
    )
    const result = await run(['tracks', 'list'], { token: '' })
    expect(result.code, result.stderr).toBe(0)
    expect(requests[0]!.authorization).toBeUndefined()
  })
  it('writes newly issued credentials only to a new private file and requires explicit revocation', async () => {
    const result = await run([
      'tokens',
      'create',
      '--name',
      'automation',
      '--output',
      'new-token.txt',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).not.toContain(newCredential)
    expect(await readFile(join(directory, 'new-token.txt'), 'utf8')).toBe(newCredential + '\n')
    expect((await stat(join(directory, 'new-token.txt'))).mode & 0o777).toBe(0o600)
    expect(
      (await run(['tokens', 'create', '--name', 'duplicate', '--output', 'new-token.txt'])).code,
    ).toBe(1)
    expect(requests).toHaveLength(1)
    expect((await run(['tokens', 'revoke', 'token-2'])).code).toBe(1)
    expect((await run(['tokens', 'revoke', 'token-2', '--yes'])).code).toBe(0)
    expect(requests.at(-1)!.path).toBe('/api/auth/tokens/token-2')
  })
})

describe('CLI operations', () => {
  it('removes the reserved output file if token issuance fails so the command can be retried', async () => {
    failTokenCreation = true
    const result = await run(['tokens', 'create', '--name', 'automation', '--output', 'token.txt'])
    expect(result.code).toBe(1)
    await expect(stat(join(directory, 'token.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    failTokenCreation = false
    expect(
      (await run(['tokens', 'create', '--name', 'automation', '--output', 'token.txt'])).code,
    ).toBe(0)
  })
  it('paginates the chart and applies personal library filters', async () => {
    const result = await run(['charts', '--all', '--json'])
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).tracks).toHaveLength(2)
    expect(requests.map((item) => item.path)).toEqual([
      '/api/tracks?sort=weekly&q=&page=1',
      '/api/tracks?sort=weekly&q=&page=2',
    ])
    expect((await run(['library', '--tab', 'favorites'])).code).toBe(0)
    expect(requests.at(-1)!.path).toBe('/api/library?tab=favorites&page=1')
  })
  it('uploads actual multipart files, then publishes the returned draft ID', async () => {
    await writeFile(join(directory, 'song.js'), 'note("c4").s("sine")')
    await writeFile(join(directory, 'song.m4a'), new Uint8Array([9, 8, 7]))
    await writeFile(join(directory, 'story.txt'), '包含换行的\n作品故事')
    const result = await run([
      'tracks',
      'upload',
      '--title',
      '新作品',
      '--summary-file',
      'story.txt',
      '--source',
      'song.js',
      '--audio',
      'song.m4a',
      '--publish',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(requests.map((item) => [item.method, item.path])).toEqual([
      ['POST', '/api/tracks'],
      ['PUT', '/api/tracks/song-1/files'],
      ['POST', '/api/tracks/song-1/status'],
    ])
    expect(requests[0]!.body).toEqual({ title: '新作品', summary: '包含换行的\n作品故事' })
    expect(requests[1]!.body).toEqual({
      source: 'note("c4").s("sine")',
      sourceName: 'song.js',
      audio: [9, 8, 7],
      audioName: 'song.m4a',
    })
    expect(JSON.parse(result.stdout).track.status).toBe('published')
  })
  it('preserves existing metadata on partial edits and can resume an upload without creating another draft', async () => {
    expect((await run(['tracks', 'update', 'song-1', '--title', '新标题'])).code).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { title: '新标题' } })
    await writeFile(join(directory, 'song.js'), 'note("c4")')
    await writeFile(join(directory, 'song.m4a'), new Uint8Array([1, 2, 3]))
    failUpload = true
    const failed = await run([
      'tracks',
      'upload',
      '--id',
      'song-1',
      '--source',
      'song.js',
      '--audio',
      'song.m4a',
      '--publish',
    ])
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('song-1')
    expect(requests.filter((item) => item.path.endsWith('/status'))).toEqual([])
    expect(
      requests.filter((item) => item.method === 'POST' && item.path === '/api/tracks'),
    ).toEqual([])
    failUpload = false
    expect(
      (
        await run([
          'tracks',
          'upload',
          '--id',
          'song-1',
          '--source',
          'song.js',
          '--audio',
          'song.m4a',
        ])
      ).code,
    ).toBe(0)
  })
  it('supports binary downloads, byte ranges and HEAD without overwriting local files', async () => {
    const downloaded = await run([
      'tracks',
      'download',
      'song-1',
      '--kind',
      'audio',
      '--output',
      'song.m4a',
      '--range',
      'bytes=0-2',
    ])
    expect(downloaded.code, downloaded.stderr).toBe(0)
    expect([...(await readFile(join(directory, 'song.m4a')))]).toEqual([1, 2, 3])
    expect(JSON.parse(downloaded.stdout).status).toBe(206)
    expect(
      (await run(['tracks', 'download', 'song-1', '--kind', 'audio', '--output', 'song.m4a'])).code,
    ).toBe(1)
    expect((await run(['tracks', 'download', 'song-1', '--kind', 'source', '--head'])).code).toBe(0)
    expect(requests.at(-1)!.method).toBe('HEAD')
  })
  it('maps social, moderation, profile and draft deletion commands to their APIs', async () => {
    for (const relation of ['likes', 'favorites']) {
      for (const action of ['add', 'remove'])
        expect((await run([relation, action, 'song-1'])).code).toBe(0)
    }
    for (const action of ['publish', 'unpublish', 'hide'])
      expect((await run(['tracks', action, 'song-1'])).code).toBe(0)
    expect((await run(['profile', 'update', '--name', '新昵称'])).code).toBe(0)
    expect(requests.at(-1)!.body).toEqual({ displayName: '新昵称' })
    const before = requests.length
    expect((await run(['tracks', 'delete', 'song-1'])).code).toBe(1)
    expect(requests).toHaveLength(before)
    expect((await run(['tracks', 'delete', 'song-1', '--yes'])).code).toBe(0)
    expect(requests.at(-1)!.method).toBe('DELETE')
    expect(requests.slice(4, 7).map((item) => item.body)).toEqual([
      { status: 'published' },
      { status: 'unpublished' },
      { status: 'hidden' },
    ])
  })
})

describe('story length preflight', () => {
  const mutations = [
    {
      label: 'create',
      args: ['tracks', 'create', '--title', 'Story limit test'],
      method: 'POST',
      path: '/api/tracks',
    },
    {
      label: 'update',
      args: ['tracks', 'update', 'song-1'],
      method: 'PATCH',
      path: '/api/tracks/song-1',
    },
    {
      label: 'new upload',
      args: [
        'tracks',
        'upload',
        '--title',
        'Story limit test',
        '--source',
        'song.js',
        '--audio',
        'song.m4a',
        '--publish',
      ],
      method: 'POST',
      path: '/api/tracks',
    },
    {
      label: 'resumed upload',
      args: [
        'tracks',
        'upload',
        '--id',
        'song-1',
        '--source',
        'song.js',
        '--audio',
        'song.m4a',
        '--publish',
      ],
      method: 'PATCH',
      path: '/api/tracks/song-1',
    },
  ]
  const inputs = mutations.flatMap((mutation) =>
    ['--summary', '--summary-file'].map((option) => ({ ...mutation, option })),
  )
  // Internal CRLF remains two code units and each emoji is a surrogate pair.
  // Surrounding whitespace is excluded, matching the server's .trim().length.
  const boundary = '🎵'.repeat(998) + '\r\n' + 'ab'

  beforeEach(async () => {
    await writeFile(join(directory, 'song.js'), 'note("c4").s("sine")')
    await writeFile(join(directory, 'song.m4a'), new Uint8Array([9, 8, 7]))
  })

  it.each(inputs)(
    'rejects an oversized $option for $label before any HTTP request, in both languages',
    async ({ args, option }) => {
      const summary = ` \r\n${boundary}x\r\n `
      expect(summary.trim().length).toBe(2001)
      expect(Array.from(summary.trim()).length).toBeLessThan(2000)
      await writeFile(join(directory, 'story.txt'), summary)
      const value = option === '--summary-file' ? 'story.txt' : summary
      for (const language of ['zh', 'en']) {
        const result = await run([...args, option, value, '--lang', language])
        expect(result.code, result.stderr).toBe(1)
        expect(requests).toEqual([])
        for (const count of ['2001', '2000', '1200']) expect(result.stderr).toContain(count)
        if (language === 'zh') expect(result.stderr).toMatch(/(未|没有|不会).*(请求|发送)/u)
        else {
          expect(result.stderr).toMatch(/no (?:\w+\s+)*requests?/iu)
          expect(result.stderr).not.toMatch(/[\u3400-\u9fff]/u)
        }
      }
    },
  )

  it.each(inputs)(
    'accepts exactly 2000 trimmed UTF-16 units through $option for $label',
    async ({ args, option, method, path }) => {
      const summary = ` \r\n${boundary}\r\n `
      expect(summary.length).toBeGreaterThan(2000)
      expect(summary.trim().length).toBe(2000)
      await writeFile(join(directory, 'story.txt'), summary)
      const result = await run([
        ...args,
        option,
        option === '--summary-file' ? 'story.txt' : summary,
      ])
      expect(result.code, result.stderr).toBe(0)
      expect(
        requests.filter((request) => request.method === method && request.path === path),
      ).toHaveLength(1)
      expect(requests[0]).toMatchObject({ method, path, body: { summary: boundary } })
      if (args[1] === 'upload')
        expect(requests.map((request) => request.method)).toEqual([method, 'PUT', 'POST'])
      else expect(requests).toHaveLength(1)
    },
  )

  it('leaves summary absent on partial edits and upload resumes when it was not supplied', async () => {
    const updated = await run(['tracks', 'update', 'song-1', '--title', 'Only rename'])
    expect(updated.code, updated.stderr).toBe(0)
    expect(requests[0]!.body).toEqual({ title: 'Only rename' })
    expect(JSON.parse(updated.stdout).track.summary).toBe(track.summary)
    requests = []
    const resumed = await run([
      'tracks',
      'upload',
      '--id',
      'song-1',
      '--source',
      'song.js',
      '--audio',
      'song.m4a',
    ])
    expect(resumed.code, resumed.stderr).toBe(0)
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['PUT', '/api/tracks/song-1/files'],
    ])
    expect(JSON.parse(resumed.stdout).track.summary).toBe(track.summary)
  })

  it.each(['--summary', '--summary-file'])(
    'clears an existing summary when %s is explicitly empty',
    async (option) => {
      await writeFile(join(directory, 'empty-story.txt'), ' \r\n\t ')
      const result = await run([
        'tracks',
        'update',
        'song-1',
        option,
        option === '--summary-file' ? 'empty-story.txt' : '',
      ])
      expect(result.code, result.stderr).toBe(0)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ method: 'PATCH', body: { summary: '' } })
      expect(JSON.parse(result.stdout).track.summary).toBe('')
    },
  )
})

describe('community metadata and language', () => {
  it('sends only supplied metadata, normalizes tags and keeps prompt input explicit', async () => {
    await writeFile(join(directory, 'prompt.txt'), 'Compose a warm reprise.\nKeep the ending open.')
    const result = await run([
      'tracks',
      'update',
      'song-1',
      '--agent',
      'Codex',
      '--model',
      'known-model',
      '--tokens',
      '1234',
      '--source-visibility',
      'private',
      '--prompt-visibility',
      'private',
      '--prompt-file',
      'prompt.txt',
      '--tags',
      ' #ＬＯ－ＦＩ, lo-fi , #Warm   Night',
      '--copyright-notice',
      'Original composition by Alice',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/tracks/song-1',
      body: {
        agent: 'Codex',
        model: 'known-model',
        tokenCount: 1234,
        sourceVisibility: 'private',
        promptVisibility: 'private',
        prompt: 'Compose a warm reprise.\nKeep the ending open.',
        tags: ['lo-fi', 'warm night'],
        copyrightNotice: 'Original composition by Alice',
      },
    })
    expect(requests[0]!.body).not.toHaveProperty('title')
    expect(requests[0]!.body).not.toHaveProperty('uploadSource')
    requests = []
    expect(
      (
        await run([
          'tracks',
          'update',
          'song-1',
          '--tokens',
          'none',
          '--tags',
          '',
          '--prompt',
          '',
          '--copyright-notice',
          '',
        ])
      ).code,
    ).toBe(0)
    expect(requests[0]!.body).toEqual({
      tokenCount: null,
      tags: [],
      prompt: null,
      copyrightNotice: null,
    })
  })
  it('validates metadata and rejects client-supplied upload attribution before making a request', async () => {
    for (const flags of [
      ['--tokens', '-1'],
      ['--tokens', '1.2'],
      ['--tokens', '9007199254740992'],
      ['--tokens', ''],
      ['--source-visibility', 'everyone'],
      ['--prompt-visibility', 'everyone'],
      ['--agent', 'a'.repeat(101)],
      ['--model', 'm'.repeat(121)],
      ['--prompt', 'p'.repeat(16001)],
      ['--copyright-notice', 'c'.repeat(1001)],
      ['--prompt', 'text', '--prompt-file', 'missing.txt'],
      ['--tags', Array.from({ length: 11 }, (_, i) => `tag-${i}`).join(',')],
      ['--tags', 'a'.repeat(33)],
      ['--upload-source', 'forged'],
    ]) {
      const result = await run(['tracks', 'create', '--title', 'Example', ...flags])
      expect(result.code, flags.join(' ')).toBe(1)
    }
    expect(requests).toEqual([])
  })
  it('filters tracks by normalized tag and queries the tag directory', async () => {
    expect((await run(['tracks', 'list', '--tag', '#ＬＯ－ＦＩ', '--query', 'warm'])).code).toBe(0)
    const url = new URL(requests[0]!.path, origin)
    expect(url.searchParams.get('tag')).toBe('lo-fi')
    expect(url.searchParams.get('q')).toBe('warm')
    const result = await run(['tags', 'list', '--query', 'lo'])
    expect(result.code, result.stderr).toBe(0)
    expect(requests.at(-1)!.path).toBe('/api/tags?q=lo')
    expect(JSON.parse(result.stdout)).toEqual({ tags: [{ tag: 'lo-fi', count: 2 }] })
  })
  it('reports actual playback only with a token and an explicit stable event ID', async () => {
    const eventId = '12345678-1234-4234-8234-123456789abc'
    const result = await run([
      'tracks',
      'record-play',
      'song-1',
      '--event-id',
      eventId,
      '--seconds',
      '5.25',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/tracks/song-1/plays',
      body: { eventId, secondsPlayed: 5.25 },
    })
    expect(JSON.parse(result.stdout)).toEqual({ counted: true, playCount: 3 })
    requests = []
    for (const seconds of ['4.9', 'NaN', 'Infinity'])
      expect(
        (
          await run([
            'tracks',
            'record-play',
            'song-1',
            '--event-id',
            eventId,
            '--seconds',
            seconds,
          ])
        ).code,
      ).toBe(1)
    expect(
      (await run(['tracks', 'record-play', 'song-1', '--event-id', 'invalid', '--seconds', '5']))
        .code,
    ).toBe(1)
    expect(
      (
        await run(['tracks', 'record-play', 'song-1', '--event-id', eventId, '--seconds', '5'], {
          token: '',
        })
      ).code,
    ).toBe(1)
    expect(requests).toEqual([])
    expect((await run(['tracks', 'download', 'song-1', '--kind', 'audio', '--head'])).code).toBe(0)
    expect(requests.map((request) => request.path)).toEqual(['/api/tracks/song-1/media/audio'])
  })
  it('returns encoded sharing links without contacting social services', async () => {
    track.status = 'published'
    const result = await run(['tracks', 'share', 'song-1'])
    expect(result.code, result.stderr).toBe(0)
    const shared = JSON.parse(result.stdout)
    expect(shared.url).toBe(`${origin}/t/song-1`)
    const x = new URL(shared.shareUrls.x)
    expect(x.searchParams.get('url')).toBe(shared.url)
    expect(x.searchParams.get('text')).toBe(track.title)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('GET')
  })
  it('keeps non-public titles out of social sharing URLs', async () => {
    for (const status of ['draft', 'unpublished', 'hidden']) {
      track.status = status
      const result = await run(['tracks', 'share', 'song-1'])
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        url: `${origin}/t/song-1`,
        status,
        shareUrls: {},
      })
    }
  })
  it('localizes help, local errors and transport headers while preserving JSON and API errors', async () => {
    const english = await run(['--help', '--lang', 'en'])
    expect(english.code).toBe(0)
    expect(english.stdout).toContain('Usage: talkoda')
    expect(english.stdout).toContain('--source-visibility')
    expect(english.stdout).not.toMatch(/[\u3400-\u9fff]/u)
    expect((await run(['--help', '--lang', 'zh'])).stdout).toContain('用法: talkoda')
    expect((await run(['tracks', 'create', '--lang', 'en'])).stderr).toContain(
      'Please provide --title',
    )
    expect(
      (await run(['tracks', 'create', '--tokens=-1', '--title', 'example', '--lang', 'en'])).stderr,
    ).toContain('--tokens must be an integer')
    expect((await run(['--unknown', '--lang', 'zh'])).stderr).toContain('未知选项')
    expect((await run(['--help', '--lang', 'fr'])).code).toBe(1)
    expect((await run(['tracks', 'list', '--lang', 'en'])).code).toBe(0)
    expect(requests.at(-1)!.language).toBe('en')
    expect((await run(['tracks', 'list', '--lang', 'zh'])).code).toBe(0)
    expect(requests.at(-1)!.language).toBe('zh')
    privateSource = true
    const denied = await run([
      'tracks',
      'download',
      'song-1',
      '--kind',
      'source',
      '--output',
      'private.js',
      '--lang',
      'en',
    ])
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('HTTP 403: Source is private')
    await expect(stat(join(directory, 'private.js'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
