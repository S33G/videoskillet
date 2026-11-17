import { assetPath, byteRange, mimeFor } from '../scripts/serve/static.ts'

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

export const APP_URL = 'videoskillet://app/app/'

export function isAppUrl(raw) {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'videoskillet:' &&
      url.host === 'app' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

export function windowAction(url, frameName) {
  if (url === 'about:blank' && frameName === 'videoskillet_controls')
    return 'controls'
  if (/^https?:\/\//i.test(url)) return 'external'
  return 'deny'
}

// Serve only packaged assets. Stream video ranges instead of loading a clip
// into the main process heap for every seek.
export async function serveAsset(request, root) {
  if (!isAppUrl(request.url)) return new Response(null, { status: 403 })
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405 })
  if (new URL(request.url).pathname === '/') return Response.redirect(APP_URL)
  const path = assetPath(new URL(request.url).pathname)
  if (path === null) return new Response(null, { status: 403 })
  const file = join(root, path)
  let info
  try {
    info = await stat(file)
  } catch {
    return new Response(null, { status: 404 })
  }
  if (!info.isFile()) return new Response(null, { status: 404 })
  const rangeHeader = request.headers.get('range')
  const range = byteRange(rangeHeader, info.size)
  if (rangeHeader !== null && range === null)
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${info.size}` },
    })
  const headers = {
    'content-type': mimeFor(path),
    'content-length': String(
      range === null ? info.size : range.end - range.start + 1,
    ),
    'accept-ranges': 'bytes',
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: https: http:; connect-src 'self' blob: https: http:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'",
  }
  if (range !== null)
    headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`
  const stream =
    request.method === 'HEAD'
      ? null
      : Readable.toWeb(createReadStream(file, range ?? {}))
  return new Response(stream, { status: range === null ? 200 : 206, headers })
}
