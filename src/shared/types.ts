/**
 * 主进程 / preload / 渲染进程三方共享的类型契约。
 * 放在 src/ 下是为了让渲染进程（vite root = src）能直接相对引用，
 * 主进程与 preload 由 esbuild 打包，跨目录引用不受 vite fs.allow 限制。
 */

/**
 * 界面语言设置：
 *  - 'system' 跟随系统（只有中文系 locale 用中文，其余一律英文）
 *  - 'zh' / 'en' 手动锁定，优先级高于系统
 */
export type LanguageSetting = 'system' | 'zh' | 'en'

/** 实际用于渲染的语言 */
export type UiLanguage = 'zh' | 'en'

/** 武器种类，同时也是准心样式的种类 */
export type WeaponKind = 'pistol' | 'rocket' | 'energy'

export const WEAPON_KINDS: readonly WeaponKind[] = ['pistol', 'rocket', 'energy']

/** 界面统一用词 */
export const WEAPON_LABELS: Record<WeaponKind, Record<UiLanguage, string>> = {
  pistol: { zh: '手枪', en: 'Pistol' },
  rocket: { zh: '火箭筒', en: 'Rocket' },
  energy: { zh: '能量武器', en: 'Energy' }
}

/** 语言选项的显示名，跟随系统时也用当前界面语言展示 */
export const LANGUAGE_LABELS: Record<LanguageSetting, Record<UiLanguage, string>> = {
  system: { zh: '跟随系统', en: 'System' },
  zh: { zh: '中文', en: 'Chinese' },
  en: { zh: 'English', en: 'English' }
}

/**
 * 各武器对应的素材音效文件名（相对 assets/sounds/）。
 * null = 使用内置的程序化合成枪声。
 */
export const SOUND_FILES: Record<WeaponKind, string | null> = {
  pistol: null,
  rocket: 'rocket.wav',
  energy: 'laser.wav'
}

/** 应用配置（持久化到 userData/config.json） */
export interface AppConfig {
  /** 切换射击模式的全局热键，Electron accelerator 语法，例如 'Control+Alt+S' */
  toggleAccelerator: string
  /** 武器：决定开火特效与残留痕迹的样式 */
  weapon: WeaponKind
  /** 音效：与武器解耦，用手枪准心打火箭筒、配能量武器音效也可以 */
  sound: WeaponKind
  /** 准心样式：与武器解耦 */
  crosshairStyle: WeaponKind
  /** 准心颜色，#RRGGBB */
  crosshairColor: string
  /** 音量 0..1 */
  volume: number
  /** 静音 */
  muted: boolean
  /** 开火特效大小倍率 0.4..2.5 */
  effectScale: number
  /** 开火特效时长（毫秒） */
  effectDurationMs: number
  /** 残留痕迹大小倍率 0.4..2.5 */
  impactScale: number
  /** 残留痕迹时长（毫秒） */
  impactDurationMs: number
  /** 受击特效相对开火的延迟（毫秒） */
  impactDelayMs: number
  /** 界面语言，'system' = 跟随系统 */
  language: LanguageSetting
  /** 后坐力强度 0..1 */
  recoil: number
  /** 屏幕震动强度 0..1 */
  shake: number
  /** 开机自启 */
  openAtLogin: boolean
  /** 启动后最小化到托盘，不弹设置窗口 */
  startMinimized: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  toggleAccelerator: 'Control+Alt+S',
  weapon: 'pistol',
  sound: 'pistol',
  crosshairStyle: 'pistol',
  crosshairColor: '#FF3B30',
  volume: 0.6,
  muted: false,
  effectScale: 1,
  effectDurationMs: 900,
  impactScale: 1,
  impactDurationMs: 2600,
  impactDelayMs: 140,
  language: 'system',
  recoil: 0.6,
  shake: 0.25,
  openAtLogin: false,
  startMinimized: false
}

/** 一次开火事件（覆盖层 -> 主进程 -> 设置界面统计） */
export interface ShotEvent {
  /** 相对该覆盖层窗口的 CSS 像素坐标 */
  x: number
  y: number
  /** 时间戳（毫秒） */
  at: number
  /**
   * 程序启动至今的累计开火数（由主进程维护）。
   * 设置界面用这个字段而不是自己 +1，这样窗口关掉再打开计数不会归零。
   */
  total: number
}

/** IPC 通道名常量，避免字符串散落各处 */
export const IPC = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_CHANGED: 'config:changed',
  MODE_GET: 'mode:get',
  MODE_SET: 'mode:set',
  MODE_CHANGED: 'mode:changed',
  SHOT: 'shot',
  OPEN_SETTINGS: 'app:open-settings',
  QUIT: 'app:quit',
  SET_OPEN_AT_LOGIN: 'app:set-open-at-login',
  REFIT: 'app:refit',
  OVERLAY_READY: 'overlay:ready',
  /** 试探性校验一个 accelerator 是否可注册 */
  ACCEL_VALIDATE: 'accel:validate',
  /** 查询运行期统计（累计开火数） */
  STATS_GET: 'stats:get',
  /** 切换界面语言（设置界面顶部 / 托盘菜单） */
  SET_LANGUAGE: 'app:set-language',
  /**
   * 读取 assets/sounds/ 下的音频文件原始字节。
   *
   * 为什么不用自定义协议 + fetch：Electron 的 net.fetch 处理 file:// 不可靠，
   * 而且还要额外绕开 CSP。音频文件只有一两百 KB，直接经 IPC 传 ArrayBuffer
   * 是最简单也最不容易出错的路径。
   */
  SOUND_GET: 'sound:get'
} as const

/** preload 暴露给 window.shooting 的 API */
export interface ShootingAPI {
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  onConfigChanged(listener: (config: AppConfig) => void): () => void

  getMode(): Promise<boolean>
  setMode(active: boolean): Promise<boolean>
  onModeChanged(listener: (active: boolean) => void): () => void

  /** 覆盖层通知主进程：发生了一次开火 */
  notifyShot(x: number, y: number): void
  onShot(listener: (event: ShotEvent) => void): () => void

  openSettings(): void
  quitApp(): void
  setOpenAtLogin(enabled: boolean): void
  /** 重新适配显示器布局（新增/移除显示器、分辨率变化后调用） */
  refitOverlays(): void
  /** 校验热键语法/可用性，用于设置界面实时提示 */
  validateAccelerator(accelerator: string): Promise<boolean>
  /** 程序启动至今的累计开火数（不随设置窗口关闭清零） */
  getShotCount(): Promise<number>
  /** 读取音效文件字节，失败返回 null（文件缺失或路径非法） */
  loadSound(file: string): Promise<ArrayBuffer | null>
}

declare global {
  interface Window {
    shooting: ShootingAPI
  }
}
