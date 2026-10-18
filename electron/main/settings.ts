import { join } from 'node:path'
import { BrowserWindow } from 'electron'

/** 设置窗口：单实例，关闭即销毁，再次打开时重建 */
export class SettingsWindow {
  private win: BrowserWindow | null = null

  constructor(private readonly preloadPath: string) {}

  private async loadPage(win: BrowserWindow): Promise<void> {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      await win.loadURL(`${devUrl}/settings/index.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/settings/index.html'))
    }
  }

  async open(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore()
      this.win.focus()
      return this.win
    }

    const win = new BrowserWindow({
      width: 600,
      height: 760,
      minWidth: 480,
      minHeight: 560,
      title: 'CursorShooting 设置',
      autoHideMenuBar: true,
      backgroundColor: '#12141a',
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.on('closed', () => {
      this.win = null
    })

    await this.loadPage(win)
    win.show()
    this.win = win
    return win
  }

  get(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  send(channel: string, payload: unknown): void {
    const win = this.get()
    if (win) win.webContents.send(channel, payload)
  }
}
