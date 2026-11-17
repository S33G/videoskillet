import puppeteer from 'puppeteer-core'

// Exercise the packaged app with a fresh profile and the network disconnected.
// Pass the unpacked executable to test packaging; otherwise use dev Electron.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packaged = process.argv[2]
const executable = packaged
  ? resolve(packaged)
  : createRequire(import.meta.url)('electron')
const data = await mkdtemp(join(tmpdir(), 'videoskillet-desktop-smoke-'))

async function launch() {
  const child = spawn(
    executable,
    [
      `--user-data-dir=${data}`,
      '--remote-debugging-port=0',
      // These switches are only for testing in Linux containers. Production
      // windows retain Chromium's sandbox and use the user's GPU.
      ...(process.platform === 'linux'
        ? [
            '--no-sandbox',
            '--ozone-platform=headless',
            '--disable-dev-shm-usage',
          ]
        : []),
      ...(packaged ? [] : ['desktop']),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let log = ''
  let browser
  try {
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Electron startup timed out\n${log}`)),
        30_000,
      )
      const fail = error => {
        clearTimeout(timer)
        reject(error)
      }
      child.once('error', fail)
      child.once('exit', code =>
        fail(new Error(`Electron exited ${code}\n${log}`)),
      )
      child.stderr.on('data', chunk => {
        log += chunk.toString()
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log)
        if (match) {
          clearTimeout(timer)
          resolveEndpoint(match[1])
        }
      })
    })
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint })
    const target = await browser.waitForTarget(t =>
      t.url().startsWith('videoskillet://app/app/'),
    )
    const page = await target.page()
    const external = []
    page.on('request', request => {
      if (/^https?:/.test(request.url())) external.push(request.url())
    })
    await page.setOfflineMode(true)
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.innerText.length > 20)
    const capabilities = await page.evaluate(() => ({
      secure: isSecureContext,
      node: typeof window.require,
      bridge: typeof window.videoskilletDesktop?.saveProfile,
      gpuUnavailable: document.body.innerText.includes('WebGPU is unavailable'),
    }))
    assert.equal(capabilities.secure, true)
    assert.equal(capabilities.node, 'undefined')
    assert.equal(capabilities.bridge, 'function')
    const local = await page.evaluate(async () => {
      const media = await fetch('videoskillet://app/test.mp4', {
        headers: { range: 'bytes=0-31' },
      })
      const popup = window.open(
        '',
        'videoskillet_controls',
        'width=340,height=900',
      )
      const popout = popup !== null && popup.document.body !== null
      if (popup) {
        popup.document.body.textContent = 'controls'
        popup.close()
      }
      await navigator.storage.getDirectory()
      return {
        status: media.status,
        bytes: (await media.arrayBuffer()).byteLength,
        popout,
        filePicker: typeof window.showOpenFilePicker,
        folderPicker: typeof window.showDirectoryPicker,
      }
    })
    assert.equal(local.status, 206)
    assert.equal(local.bytes, 32)
    assert.equal(local.popout, true)
    assert.equal(local.filePicker, 'function')
    assert.equal(local.folderPicker, 'function')
    return { child, browser, page, external, capabilities }
  } catch (error) {
    await browser?.disconnect()
    child.kill()
    throw error
  }
}

async function close(instance) {
  const exited = new Promise(resolveExit =>
    instance.child.once('exit', resolveExit),
  )
  const timer = setTimeout(() => instance.child.kill(), 5000)
  try {
    await instance.browser.close()
  } finally {
    await exited
    clearTimeout(timer)
  }
}

let instance
try {
  instance = await launch()
  await instance.page.evaluate(async () => {
    const api = window.videoskilletDesktop
    if ((await api.listProfiles()).length !== 0)
      throw new Error('Expected fresh library')
    await api.saveProfile('offline smoke', 'preset=vhs', null)
    localStorage.setItem('desktop-smoke', 'kept')
  })
  assert.deepEqual(instance.external, [])
  await close(instance)
  instance = undefined

  instance = await launch()
  const saved = await instance.page.evaluate(async () => ({
    profiles: await window.videoskilletDesktop.listProfiles(),
    setting: localStorage.getItem('desktop-smoke'),
  }))
  assert.equal(saved.profiles.length, 1)
  assert.equal(saved.profiles[0].query, 'preset=vhs')
  assert.equal(saved.setting, 'kept')
  await instance.page.evaluate(() =>
    window.videoskilletDesktop.deleteProfile('offline smoke'),
  )
  assert.deepEqual(instance.external, [])
  console.log(
    'Passed: offline launch, isolated preload, profile save/delete, and restart persistence.',
  )
  if (instance.capabilities.gpuUnavailable)
    console.log(
      'GPU rendering was unavailable; validate effects and encoding on Windows hardware.',
    )
} finally {
  if (instance) await close(instance)
  await rm(data, { recursive: true, force: true })
}
