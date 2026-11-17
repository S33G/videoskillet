# Windows desktop app

The desktop app bundles videoskillet and Electron in a portable Windows x64
executable. Double-click the executable to open the app. It needs no installer,
Node, pnpm, Deno, account, or first-run download. A compatible GPU and graphics
driver are required for WebGPU effects.

Local images, videos, generated sources, effects, recording and profile saves
work without internet. Wikimedia, Archive.org and direct media URLs remain
available when connected. Cloud accounts and synchronization are absent from
this version. YouTube downloading and the command-line ProRes renderer remain
features of the separate CLI.

Profiles and their thumbnails are stored in
`%APPDATA%\videoskillet-desktop\profiles.json`. Settings and the media library
use Electron's persistent storage in the same directory. This location stays the
same when the executable is moved or replaced with a newer version. Local media
references still need the original files, and reopening a file or folder can
require permission. Saved profiles do not embed source videos.

Close the app before backing up the data directory. Replace the executable to
update manually. The initial build is unsigned; Windows can display a publisher
warning.

## Development and packaging

Use Node 24 and the repository's pnpm version, then run:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

This builds the existing production web app and desktop main process, downloads
the development Electron runtime if needed, and opens the desktop app. After an
edit, rerun the command. Building the website requires internet because existing
blog pages fetch image metadata during prerendering; running the built desktop
app does not.

Build the portable executable on Windows:

```sh
pnpm desktop:package
```

The result is `dist-desktop/videoskillet-<version>-windows-x64.exe`. The Desktop
Windows GitHub workflow uploads this executable and `SHA256SUMS` as the
`videoskillet-windows-x64` artifact. It does not publish a release or sign the
executable.

Run the local storage and protocol tests with `pnpm desktop:test`. Run
`pnpm desktop:smoke` after `pnpm desktop:dev` has installed Electron, or test
the packaged app directly:

```sh
pnpm desktop:smoke dist-desktop/win-unpacked/videoskillet.exe
```

The smoke test uses temporary data, disconnects the page from the network, and
checks launch, preload isolation, profile save/delete and persistence across
process restarts. It reports when no GPU is available. Native file dialogs,
camera, microphone, screen capture, MIDI and encoder behavior need a Windows
hardware check. Verify importing a local image and video, applying effects,
saving and replaying an exported recording, and opening and closing the control
popout. Cancel import, capture and save dialogs and verify the app stays usable.
Also test online media followed by disconnection and local playback.

The renderer uses a secure `videoskillet://app` origin with sandboxing and
context isolation enabled. The preload exposes three profile operations;
filesystem paths and general IPC are not exposed. Website links open in the
default browser. Desktop startup skips service workers, analytics, account
subscriptions and remote recording-error reports.
