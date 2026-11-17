import { build } from 'vite'

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'

// Bundle the shared profile rules into the main process. The shipped app has
// no npm dependencies and does not need a toolchain on the user's machine.
await build({
  configFile: false,
  ssr: { noExternal: ['skillet-shared'] },
  build: {
    ssr: 'desktop/main.mjs',
    outDir: 'desktop/build',
    rollupOptions: {
      external: ['electron'],
      output: { entryFileNames: 'main.mjs' },
    },
  },
})
await mkdir('desktop/build', { recursive: true })
await copyFile('desktop/preload.cjs', 'desktop/build/preload.cjs')
const root = JSON.parse(await readFile('package.json', 'utf8'))
const pkg = JSON.parse(await readFile('desktop/package.json', 'utf8'))
pkg.version = root.version
await writeFile('desktop/package.json', `${JSON.stringify(pkg, null, 2)}\n`)
