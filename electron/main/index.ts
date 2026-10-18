import { join } from 'node:path'
import { app, globalShortcut, ipcMain, screen, type Tray } from 'electron'
import { readSound } from './assets'
import { loadConfig, updateConfig } from './config'
import { OverlayManager } from './overlay'
import { SettingsWindow } from './settings'
import { applyTrayMenu, createTray, resolveTrayIcon, type TrayHandlers } from './tray'
import {
  IPC,
  type AppConfig,
  type LanguageSetting,
  type ShotEvent
} from '../../src/shared/types'

let overlay: OverlayManager
let settings: SettingsWindow
let tray: Tray | null = null
/** 运行期统计：累计开火数。放在主进程，设置窗口关掉再打开也不会清零 */
let shotCount = 0

/** 刷新托盘菜单（语言或射击模式变化后调用） */
function refreshTray(): void {
  if (tray && !tray.isDestroyed()) {
    applyTrayMenu(tray, trayHandlers, loadConfig().language, overlay?.isActive() ?? false)
  }
}

/** 切换射击模式：开启时覆盖层吃掉鼠标点击，关闭时完全穿透 */
function toggleShooting(force?: boolean): void {
  const next = force === undefined ? !overlay.isActive() : force
  overlay.setActive(next)
  // overlay 的广播只发给覆盖层窗口，设置界面必须单独通知一次，
  // 否则用热键切换时界面上的「待机 / 射击中」状态不会刷新
  settings.send(IPC.MODE_CHANGED, next)
  refreshTray()
}

function registerToggleAccelerator(accelerator: string): void {
  globalShortcut.unregisterAll()
  if (!accelerator) return
  const ok = globalShortcut.register(accelerator, () => toggleShooting())
  if (!ok) {
    // 常见原因：被系统保留（如 Ctrl+Alt+Del 组合）、被其他程序抢占、语法不合法。
    // 这里只记录日志，设置界面有「热键可用性」实时校验。
    console.error(`[shortcut] 注册失败: ${accelerator}（可能已被系统或其他程序占用）`)
  }
}

function applyLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled ? ['--start-minimized'] : []
  })
}

function broadcastConfig(config: AppConfig): void {
  overlay.broadcast(IPC.CONFIG_CHANGED, config)
  settings.send(IPC.CONFIG_CHANGED, config)
}

/**
 * 试探性校验一个 accelerator：注册成功后立刻注销，避免长期占用。
 * 若它正好等于当前生效热键，注销后需要重新注册回来。
 */
function validateAccelerator(accelerator: string): boolean {
  if (!accelerator) return false
  const current = loadConfig().toggleAccelerator
  const ok = globalShortcut.register(accelerator, () => {
    /* 仅用于试探，不做任何事 */
  })
  if (ok) {
    globalShortcut.unregister(accelerator)
    if (accelerator === current) registerToggleAccelerator(current)
  }
  return ok
}

/** 托盘菜单回调集合。语言设置项在这里统一处理，菜单会随之重建。 */
const trayHandlers: TrayHandlers = {
  onToggle: () => toggleShooting(),
  onSettings: () => {
    void settings.open()
  },
  onQuit: () => app.quit(),
  onLanguage: (language: LanguageSetting): void => {
    const next = updateConfig({ language })
    broadcastConfig(next)
    refreshTray()
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.CONFIG_GET, (): AppConfig => loadConfig())

  ipcMain.handle(IPC.CONFIG_SET, (_event, patch: Partial<AppConfig>): AppConfig => {
    const prev = loadConfig()
    const next = updateConfig(patch)
    broadcastConfig(next)
    if (next.toggleAccelerator !== prev.toggleAccelerator) {
      registerToggleAccelerator(next.toggleAccelerator)
    }
    if (next.openAtLogin !== prev.openAtLogin) {
      applyLoginItem(next.openAtLogin)
    }
    if (next.language !== prev.language) {
      refreshTray()
    }
    return next
  })

  ipcMain.handle(IPC.MODE_GET, (): boolean => overlay.isActive())

  ipcMain.handle(IPC.MODE_SET, (_event, active: boolean): boolean => {
    toggleShooting(active)
    return overlay.isActive()
  })

  // 覆盖层开火 -> 累计计数并转发给设置界面
  ipcMain.on(IPC.SHOT, (_event, x: number, y: number): void => {
    shotCount += 1
    const payload: ShotEvent = { x, y, at: Date.now(), total: shotCount }
    settings.send(IPC.SHOT, payload)
  })

  ipcMain.handle(IPC.STATS_GET, (): number => shotCount)

  ipcMain.handle(IPC.SOUND_GET, (_event, name: string): ArrayBuffer | null => readSound(name))

  ipcMain.on(IPC.OPEN_SETTINGS, (): void => {
    void settings.open()
  })

  ipcMain.on(IPC.QUIT, (): void => {
    app.quit()
  })

  ipcMain.on(IPC.SET_LANGUAGE, (_event, language: LanguageSetting): void => {
    const next = updateConfig({ language })
    broadcastConfig(next)
    refreshTray()
  })

  ipcMain.on(IPC.SET_OPEN_AT_LOGIN, (_event, enabled: boolean): void => {
    const next = updateConfig({ openAtLogin: enabled })
    applyLoginItem(enabled)
    broadcastConfig(next)
  })

  ipcMain.on(IPC.REFIT, (): void => {
    overlay.refit()
  })

  ipcMain.handle(IPC.ACCEL_VALIDATE, (_event, accelerator: string): boolean =>
    validateAccelerator(accelerator)
  )
}

async function bootstrap(): Promise<void> {
  const config = loadConfig()
  applyLoginItem(config.openAtLogin)

  // 构建产物为 CommonJS（electron-vite 输出 out/preload/index.js），注意不是 .mjs
  const preloadPath = join(__dirname, '../preload/index.js')
  overlay = new OverlayManager(preloadPath)
  settings = new SettingsWindow(preloadPath)

  overlay.refit()
  registerToggleAccelerator(config.toggleAccelerator)
  registerIpc()

  const iconPath = resolveTrayIcon()
  tray = createTray(iconPath, trayHandlers, config.language, overlay.isActive())

  // 显示器增删、分辨率或缩放变化后重新贴合屏幕
  screen.on('display-added', () => overlay.refit())
  screen.on('display-removed', () => overlay.refit())
  screen.on('display-metrics-changed', () => overlay.refit())

  // 开机自启或设置了启动时最小化则不弹窗，只留托盘
  const silent = config.startMinimized || process.argv.includes('--start-minimized')
  if (!silent) await settings.open()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void settings.open()
  })

  app.whenReady().then(bootstrap).catch((err: unknown) => {
    console.error('[main] 启动失败:', err)
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    overlay?.destroyAll()
  })

  // 本应用常驻托盘：只要注册了 window-all-closed 监听，Electron 就不会在窗口全关时自动退出
  app.on('window-all-closed', (): void => {
    /* 故意留空：关闭设置窗口不代表退出程序 */
  })
}
