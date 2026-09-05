import { getLanguage, t } from './i18n.mjs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

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

export function configPath() {
  return (
    process.env.TALKODA_CONFIG_FILE ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'talkoda', 'config.json')
  )
}

export async function readConfig() {
  try {
    const data = JSON.parse(await readFile(configPath(), 'utf8'))
    if (
      data?.version !== 1 ||
      !data.credentials ||
      typeof data.credentials !== 'object' ||
      Array.isArray(data.credentials)
    )
      throw new Error('invalid')
    return data
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, credentials: {} }
    throw new Error(
      t(
        'CLI 配置文件不可读取或格式无效，请检查 TALKODA_CONFIG_FILE。',
        'The CLI configuration is unreadable or invalid. Check TALKODA_CONFIG_FILE.',
      ),
      {
        cause: error,
      },
    )
  }
}

export async function saveToken(origin, token) {
  const config = await readConfig()
  if (token) config.credentials[origin] = { token: validateToken(token) }
  else delete config.credentials[origin]
  const path = configPath(),
    temporary = `${path}.${randomUUID()}.tmp`
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

export async function tokenFor(origin) {
  const token = process.env.TALKODA_API_TOKEN || (await readConfig()).credentials[origin]?.token
  return token ? validateToken(token) : null
}

export function client(origin, token) {
  async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
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
        signal: AbortSignal.timeout(multipart ? 120000 : 30000),
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
