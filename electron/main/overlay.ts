import { join } from 'node:path'
import { BrowserWindow, screen, type Display, type Rectangle } from 'electron'
import { IPC } from '../../src/shared/types'

/**
 * 覆盖层窗口管理器：为每个显示器创建一个全屏透明窗口。
 *
 * 为什么按显示器逐个创建而不是开一个横跨虚拟桌面的大窗口：
 *  Windows 允许不同显示器有不同的 DPI 缩放（scaleFactor），单个大窗口只能按一个
 *  scaleFactor 换算坐标，副屏上必然出现偏移或尺寸错误。按显示器建窗口可以把换算
 *  局限在各自屏幕内，也方便 OBS 单独捕获某一块屏幕。
 *
 * 关于 DPI 换算（需要你在目标机器上实测确认）：
 *  Electron 在 Windows 上 screen.getAllDisplays() 返回的 bounds 是物理像素，
 *  而 BrowserWindow.setBounds() 接收的是 DIP。因此这里统一除以 scaleFactor。
 *  如果发现窗口比屏幕大/小，改 dipRect() 里的换算即可，或在设置界面点「重新适配屏幕」。
 */
export class OverlayManager {
  private readonly windows = new Map<number, BrowserWindow>()
  private readonly preloadPath: string
  private active = false

  constructor(preloadPath: string) {
    this.preloadPath = preloadPath
  }

  /** 加载覆盖层页面：开发走 vite dev server，生产走打包后的本地文件 */
  private async loadPage(win: BrowserWindow): Promise<void> {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      await win.loadURL(`${devUrl}/overlay/index.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/overlay/index.html'))
    }
  }

  /**
   * 显示器 -> 窗口 bounds。
   *
   * 【实测修正 2026-10-14】曾经在这里除以 scaleFactor（假设 display.bounds 是物理像素），
   * 结果窗口只有屏幕的一部分、被压在左上角，鼠标移出那块区域就收不到事件、准心消失。
   * 实际上 Electron 在 Windows 上返回的 display.bounds 已经是 DIP（逻辑像素），
   * 与 BrowserWindow.setBounds 的单位一致，**不能再除以 scaleFactor**。
   *
   * 若你在某台机器上发现窗口尺寸仍不对，改这里即可，或用设置界面的「重新适配屏幕」兜底。
   */
  private boundsFor(display: Display): Rectangle {
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
  }

  private createForDisplay(display: Display): BrowserWindow {
    const rect = this.boundsFor(display)
    const win = new BrowserWindow({
      ...rect,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      // 必须是完全透明的黑色，否则 Windows 下透明窗口会渲染成不透明黑块
      backgroundColor: '#00000000',
      show: false,
      // 射击模式要靠这个窗口吃掉鼠标点击，所以必须可聚焦
      focusable: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        // 覆盖层靠 rAF 驱动动画，不能被后台节流打断
        backgroundThrottling: false
      }
    })

    // 'screen-saver' 是 Windows 上最高的置顶层级，能盖住绝大多数全屏程序
    win.setAlwaysOnTop(true, 'screen-saver')
    // 让覆盖层出现在所有虚拟桌面上，且在全屏程序之上仍可见
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // 注意：这里不调用 setContentProtection(true)，
    // 否则窗口会被排除在 OBS / 录屏捕获之外 —— 本项目要求动效可被捕获。
    win.setIgnoreMouseEvents(true)

    // 双保险：覆盖层页面 init() 会主动拉取一次模式，这里再补发一次，
    // 防止 MODE_CHANGED 在页面加载完成前发出而被丢弃
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.MODE_CHANGED, this.active)
    })

    void this.loadPage(win)
    // 常驻显示：曾经在退出射击模式时调用 hide()，结果窗口隐藏期间 renderer 被 Chromium
    // 冻结/节流，再次进入模式时准心和动效全部丢失。改为始终显示，只切换鼠标穿透。
    win.show()
    return win
  }

  /** 创建/更新覆盖层窗口，使其与当前显示器布局一致 */
  refit(): void {
    const displays = screen.getAllDisplays()
    const alive = new Set<number>()

    for (const display of displays) {
      alive.add(display.id)
      const existing = this.windows.get(display.id)
      if (existing && !existing.isDestroyed()) {
        existing.setBounds(this.boundsFor(display))
      } else {
        this.windows.set(display.id, this.createForDisplay(display))
      }
    }

    for (const [id, win] of this.windows) {
      if (!alive.has(id)) {
        if (!win.isDestroyed()) win.destroy()
        this.windows.delete(id)
      }
    }
  }

  /**
   * 切换射击模式。
   *  - 开启：停止鼠标穿透，事件全部由覆盖层吃掉（左键即射击，不会点到下层窗口），
   *         并 focus 窗口以便接收 Esc 退出键
   *  - 关闭：恢复鼠标穿透，系统光标自动回到下层窗口的光标
   *
   * 窗口始终保持显示（不 hide），只切换穿透状态——隐藏会让 renderer 被冻结导致状态丢失。
   */
  setActive(active: boolean): void {
    this.active = active
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue
      win.setIgnoreMouseEvents(!active)
      if (active) win.focus()
    }
    this.broadcast(IPC.MODE_CHANGED, active)
  }

  isActive(): boolean {
    return this.active
  }

  /** 向所有覆盖层广播消息 */
  broadcast(channel: string, payload: unknown): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  destroyAll(): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy()
    }
    this.windows.clear()
  }
}
