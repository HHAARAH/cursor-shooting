# CursorShooting

A tiny Windows desktop toy that turns your mouse into a shooting crosshair. Press a global hotkey to enter firing mode, click to shoot, and leave marks on your screen.

## Features

- **Global hotkey toggle** — `Ctrl+Alt+S` by default, `Esc` to exit
- **Three weapons**, each with its own muzzle FX and lingering mark
  - **Pistol** — muzzle flash + shockwave + sparks, leaves a bullet hole with cracks
  - **Rocket** — fireball + smoke + sparks, leaves a scorched surface with flickering embers
  - **Energy** — energy rings + electric arcs + glow particles, leaves a spinning void portal
- The overlay can be captured by screen recorders

## Download

Grab either build from [Releases](../../releases):

| File | Notes |
|---|---|
| `…-portable.exe` | Portable — just double-click, no installation |
| `…-x64.exe` | Installer with setup wizard, desktop shortcut and uninstaller |

> The exe files are unsigned, so Windows Defender may flag them. Choose **Run anyway** or add an exclusion.

## Build from source

Electron + React + TypeScript + electron-vite.

```bash
npm install
npm run dev        # dev mode
npm run build      # build into out/
npm run typecheck  # type check
npm run dist       # package portable + installer
```

On Windows, set a mirror to speed up packaging:

```bash
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## Notes

- **Sound** — the pistol shot is synthesized in real time; rocket and energy weapon use the audio files in `assets/sounds/`
- **Limits** — due to Windows UIPI, the overlay cannot cover apps running as administrator

## License

[MIT](LICENSE)
