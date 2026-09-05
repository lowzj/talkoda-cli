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
  body: unknown
}[]
let failUpload = false,
  redirect = false,
  failTokenCreation = false
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
    expect(requests[1]!.body).toMatchObject({
      title: '新标题',
      summary: track.summary,
      cover: track.cover,
      bpm: 108,
      engineVersion: '1.3.0',
    })
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
