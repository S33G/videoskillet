import { APP_URL, isAppUrl, serveAsset, windowAction } from './assets.mjs'

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('bundled assets load without a server and media supports seeks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoskillet-assets-'))
  try {
    await mkdir(join(root, 'app'))
    await writeFile(join(root, 'app', 'index.html'), '<html>offline</html>')
    await writeFile(join(root, 'test.mp4'), '0123456789')
    const page = await serveAsset(new Request(APP_URL), root)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.equal(await page.text(), '<html>offline</html>')
    const range = await serveAsset(
      new Request('videoskillet://app/test.mp4', {
        headers: { range: 'bytes=3-6' },
      }),
      root,
    )
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), 'bytes 3-6/10')
    assert.equal(await range.text(), '3456')
    const head = await serveAsset(
      new Request(APP_URL, { method: 'HEAD' }),
      root,
    )
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    const invalid = await serveAsset(
      new Request('videoskillet://app/test.mp4', {
        headers: { range: 'bytes=99-' },
      }),
      root,
    )
    assert.equal(invalid.status, 416)
    for (const url of [
      'videoskillet://app/%2e%2e%2fsecret',
      'videoskillet://app/%5csecret',
      'videoskillet://app/C%3a/secret',
      'videoskillet://other/app/',
    ])
      assert.equal((await serveAsset(new Request(url), root)).status, 403)
    assert.equal(
      (await serveAsset(new Request('videoskillet://app/missing'), root))
        .status,
      404,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('only the controls popup is internal; external pages receive no application window', () => {
  assert.equal(isAppUrl(APP_URL), true)
  for (const url of [
    'https://videoskillet.com/app/',
    'videoskillet://evil/',
    'videoskillet://app.evil/',
    'videoskillet://user@app/app/',
    'file:///tmp/app',
  ])
    assert.equal(isAppUrl(url), false)
  assert.equal(windowAction('about:blank', 'videoskillet_controls'), 'controls')
  assert.equal(windowAction('about:blank', 'anything'), 'deny')
  assert.equal(windowAction('https://videoskillet.com/guide/', ''), 'external')
  assert.equal(windowAction('file:///etc/passwd', ''), 'deny')
  assert.equal(windowAction('javascript:alert(1)', ''), 'deny')
})
