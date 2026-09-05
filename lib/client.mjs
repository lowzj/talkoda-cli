import { getLanguage, t } from './i18n.mjs'
import { chmod, link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  canMigrateLegacyConfig,
  configPath,
  ensureTalkodaHome,
  legacyConfigPath,
} from './paths.mjs'

export { configPath } from './paths.mjs'

export function apiOrigin(value = 'https://talkoda.com') {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      t('API 地址必须是完整的 HTTPS 域名。', 'The API URL must be a complete HTTPS origin.'),
    )
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      t(
        'API 地址只填写域名，不包含账号、路径、参数或片段。',
        'The API URL must contain only an origin, without credentials, paths, query parameters or fragments.',
      ),
    )
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(
      t(
        'API Token 只通过 HTTPS 发送；HTTP 仅允许本地回环地址。',
        'API Tokens require HTTPS; HTTP is allowed only for local loopback addresses.',
      ),
    )
  }
  return url.origin
}

export function validateToken(token) {
  if (!/^tk_[a-f0-9]{64}$/.test(token))
    throw new Error(
      t(
        'Token 格式不正确，请在网站的 API Token 页面创建。',
        'Invalid Token format. Create one on the website API Token page.',
      ),
    )
  return token
}

function parseConfig(value) {
  const data = JSON.parse(value)
  if (
    data?.version !== 1 ||
    !data.credentials ||
    typeof data.credentials !== 'object' ||
    Array.isArray(data.credentials)
  )
    throw new Error('invalid')
  return data
}

async function migrateLegacyConfig(options) {
  if (!canMigrateLegacyConfig(options)) return
  const legacy = legacyConfigPath(options)
  const info = await lstat(legacy).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!info) return
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid')
  const data = parseConfig(await readFile(legacy, 'utf8'))
  await ensureTalkodaHome(options)
  const destination = configPath(options)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    // An exclusive link publishes the complete file atomically. A new config written by
    // another process wins, including an empty credentials map left behind by logout.
    await link(temporary, destination).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function readConfig(options) {
  try {
    let info
    try {
      info = await lstat(configPath(options))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await migrateLegacyConfig(options)
      info = await lstat(configPath(options))
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid')
    return parseConfig(await readFile(configPath(options), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, credentials: {} }
    throw new Error(
      t(
        'CLI 配置文件不可读取或格式无效，请检查 ~/.talkoda/config.json、TALKODA_HOME 或 TALKODA_CONFIG_FILE。',
        'The CLI configuration is unreadable or invalid. Check ~/.talkoda/config.json, TALKODA_HOME or TALKODA_CONFIG_FILE.',
      ),
      {
        cause: error,
      },
    )
  }
}

export async function saveToken(origin, token, options) {
  const config = await readConfig(options)
  if (token) config.credentials[origin] = { token: validateToken(token) }
  else delete config.credentials[origin]
  const path = configPath(options),
    temporary = `${path}.${randomUUID()}.tmp`
  if (!(options?.environment || process.env).TALKODA_CONFIG_FILE) await ensureTalkodaHome(options)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function tokenFor(origin, options) {
  const environment = options?.environment || process.env
  const token =
    environment.TALKODA_API_TOKEN || (await readConfig(options)).credentials[origin]?.token
  return token ? validateToken(token) : null
}

export function client(origin, token) {
  async function request(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
    const multipart = body instanceof FormData
    let response
    try {
      response = await fetch(origin + path, {
        method,
        headers: {
          Accept: 'application/json',
          'Accept-Language': getLanguage(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(multipart ? 120000 : 30000)])
          : AbortSignal.timeout(multipart ? 120000 : 30000),
      })
    } catch {
      throw new Error(
        t(
          '无法连接 Talkoda，或服务返回了重定向。请检查网络与 --url。请求不会自动重试。',
          'Cannot connect to Talkoda, or the server returned a redirect. Check your network and --url. Requests are not retried automatically.',
        ),
      )
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const message =
        typeof data?.error === 'string' ? data.error : t('API 请求失败', 'API request failed')
      throw new Error(
        `HTTP ${response.status}: ${token ? message.replaceAll(token, '[redacted]') : message}`,
      )
    }
    if (raw) return response
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object')
      throw new Error(t('API 返回了无法识别的响应。', 'The API returned an unrecognized response.'))
    return data
  }
  return {
    request,
    requireToken() {
      if (!token)
        throw new Error(
          t(
            '请先运行 talkoda auth login，或设置 TALKODA_API_TOKEN。',
            'Run talkoda auth login or set TALKODA_API_TOKEN first.',
          ),
        )
    },
  }
}
