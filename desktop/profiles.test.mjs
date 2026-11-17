import { createProfileStore } from './profiles.mjs'

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'videoskillet-profiles-'))
  directories.push(dir)
  const file = join(dir, 'data', 'profiles.json')
  return { file, store: createProfileStore(file) }
}

test('concurrent edits survive a restart, overwrite in place, and delete thumbnails', async () => {
  const { store, file } = await fixture()
  assert.deepEqual(await store.list(), [])
  await Promise.all([
    store.save({ name: 'first', query: 'preset=vhs', thumbnail: 'YWJj' }),
    store.save({ name: 'second', query: 'preset=clean' }),
  ])
  const before = await store.list()
  await store.save({
    name: ' first ',
    query: 'preset=noisy',
    thumbnail: 'ZGVm',
  })
  const restarted = createProfileStore(file)
  const profiles = await restarted.list()
  assert.deepEqual(
    profiles.map(p => p.name),
    ['first', 'second'],
  )
  assert.equal(profiles[0].query, 'preset=noisy')
  assert.equal(profiles[0].id, before[0].id)
  assert.equal(
    JSON.parse(await readFile(file, 'utf8')).thumbnails[profiles[0].id],
    'ZGVm',
  )
  await restarted.delete('first')
  assert.deepEqual(
    (await store.list()).map(p => p.name),
    ['second'],
  )
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).thumbnails, {})
})

test('invalid IPC payloads cannot overwrite the library', async () => {
  const { store, file } = await fixture()
  await store.save({ name: 'keep', query: 'preset=vhs' })
  const before = await readFile(file, 'utf8')
  for (const payload of [
    null,
    {},
    { name: '' },
    { name: 'x', query: 5 },
    { name: 'x', query: 'a'.repeat(8001) },
    { name: 'x', query: 'p=', thumbnail: '<script>' },
    { name: 'x', query: 'p=', thumbnail: 'a'.repeat(60001) },
  ])
    assert.throws(() => store.save(payload))
  assert.equal(await readFile(file, 'utf8'), before)
})

test('failed disk writes retain the last save and do not poison subsequent edits', async () => {
  const { store, file } = await fixture()
  await store.save({ name: 'keep', query: 'preset=vhs' })
  await mkdir(`${file}.tmp`)
  await assert.rejects(store.save({ name: 'lost', query: 'preset=clean' }))
  assert.deepEqual(
    (await store.list()).map(p => p.name),
    ['keep'],
  )
  await rm(`${file}.tmp`, { recursive: true })
  await store.save({ name: 'next', query: 'preset=clean' })
  assert.deepEqual(
    (await store.list()).map(p => p.name),
    ['keep', 'next'],
  )
})

test('corrupt and newer-format libraries are preserved for recovery', async () => {
  const { store, file } = await fixture()
  await mkdir(join(file, '..'), { recursive: true })
  for (const text of ['{broken', '{"version":2,"profiles":[]}']) {
    await writeFile(file, text)
    await assert.rejects(store.list())
    await assert.rejects(
      store.save({ name: 'replacement', query: 'preset=vhs' }),
    )
    assert.equal(await readFile(file, 'utf8'), text)
  }
})
