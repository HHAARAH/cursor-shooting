import { join } from 'node:path'
import { Menu, Tray, app } from 'electron'
import { createTranslator, resolveLanguage } from '../../src/shared/i18n'
import { LANGUAGE_LABELS, type LanguageSetting } from '../../src/shared/types'

export interface TrayHandlers {
  onToggle: () => void
  onSettings: () => void
  onQuit: () => void
  onLanguage: (language: LanguageSetting) => void
}

/**
 * 图标路径：
 *  - 开发环境：项目根 build/icon.ico
 *  - 打包后：resources/build/icon.ico（由 electron-builder 的 extraResources 拷入）
 */
export function resolveTrayIcon(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'build', 'icon.ico')
  return join(__dirname, '../../build/icon.ico')
}

/** 创建托盘，菜单文案使用当前界面语言 */
export function createTray(
  iconPath: string,
  handlers: TrayHandlers,
  setting: LanguageSetting,
  active: boolean
): Tray {
  const tray = new Tray(iconPath)
  tray.setToolTip('CursorShooting')
  applyTrayMenu(tray, handlers, setting, active)
  // 左键单击直接打开设置，符合多数托盘应用的习惯
  tray.on('click', handlers.onSettings)
  return tray
}

/**
 * 重建托盘菜单（语言切换、射击模式变化后调用）。
 *
 * @param setting 语言设置。'system' 时由 resolveLanguage() 结合系统 locale 解析：
 *                 中文系 locale（zh / zh-CN / zh-TW / zh-HK 等）→ 中文，其余一律兜底英文。
 */
export function applyTrayMenu(
  tray: Tray,
  handlers: TrayHandlers,
  setting: LanguageSetting,
  active: boolean
): void {
  const lang = resolveLanguage(setting, app.getLocale())
  const t = createTranslator(lang)

  const menu = Menu.buildFromTemplate([
    {
      label: active ? t('actionExit') : t('actionEnter'),
      click: handlers.onToggle
    },
    { label: t('actionSettings'), click: handlers.onSettings },
    { type: 'separator' },
    {
      label: t('sectionLanguage'),
      submenu: (['system', 'zh', 'en'] as const).map((option) => ({
        label: LANGUAGE_LABELS[option][lang],
        type: 'radio' as const,
        checked: setting === option,
        click: () => handlers.onLanguage(option)
      }))
    },
    { type: 'separator' },
    { label: t('actionQuit'), click: handlers.onQuit }
  ])
  tray.setContextMenu(menu)
}
