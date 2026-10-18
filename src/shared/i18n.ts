import type { LanguageSetting, UiLanguage } from './types'

/**
 * 界面文案表。
 *
 * 设计原则：
 *  1. 单一数据源——所有界面文案都在这里，新增语言只需加一列。
 *  2. 键名用「语义 + 位置」命名，避免复用导致的翻译错误。
 *  3. 'system' 只是设置项，不是渲染语言；渲染语言由 resolveLanguage() 解析成 zh/en。
 */

type Entry = Record<UiLanguage, string>

const DICT = {
  appTitle: { zh: 'CursorShooting', en: 'CursorShooting' },
  appSubtitle: {
    zh: '按热键切换射击模式，左键开火，Esc 退出',
    en: 'Press hotkey to toggle, left-click to fire, Esc to exit'
  },

  statusIdle: { zh: '待机', en: 'Idle' },
  statusFiring: { zh: '射击中', en: 'Firing' },
  presetCustom: { zh: '自定义', en: 'Custom' },
  /** 顶部两行快速设置的行首标签（自带冒号） */
  rowLanguage: { zh: '语言：', en: 'Language: ' },
  rowWeapon: { zh: '武器：', en: 'Weapon: ' },

  sectionLanguage: { zh: '语言', en: 'Language' },
  languageHint: {
    zh: '手动选择后将不再跟随系统语言',
    en: 'Once set manually, the system language is ignored'
  },
  actionSettings: { zh: '设置…', en: 'Settings…' },
  sectionTrigger: { zh: '触发', en: 'Trigger' },
  sectionCrosshair: { zh: '准心', en: 'Crosshair' },
  sectionWeapon: { zh: '武器', en: 'Weapon' },
  sectionSound: { zh: '音效', en: 'Sound' },
  sectionSystem: { zh: '系统', en: 'System' },

  labelHotkey: { zh: '切换热键', en: 'Toggle hotkey' },
  hotkeyHint: {
    zh: '语法示例：Control+Alt+S、Alt+Q、CommandOrControl+Shift+F1（需含 Ctrl / Alt / Win 之一）',
    en: 'Syntax: Control+Alt+S, Alt+Q, CommandOrControl+Shift+F1 (must include Ctrl / Alt / Win)'
  },
  hotkeyInvalid: {
    zh: '该热键无法注册，可能已被系统或其他程序占用，请换一个',
    en: 'This hotkey cannot be registered — it may be taken by the system or another app.'
  },

  labelStyle: { zh: '样式', en: 'Style' },
  labelColor: { zh: '颜色', en: 'Color' },

  labelWeapon: { zh: '武器', en: 'Weapon' },
  labelEffectScale: { zh: '特效大小', en: 'Effect size' },
  labelEffectDuration: { zh: '特效时间', en: 'Effect time' },
  labelImpactScale: { zh: '残留痕迹大小', en: 'Mark size' },
  labelImpactDuration: { zh: '残留痕迹时间', en: 'Mark time' },
  labelImpactDelay: { zh: '受击延迟', en: 'Impact delay' },
  labelRecoil: { zh: '后坐力', en: 'Recoil' },
  labelShake: { zh: '屏幕震动', en: 'Screen shake' },

  labelShot: { zh: '枪声', en: 'Shot' },
  labelVolume: { zh: '音量', en: 'Volume' },
  actionTest: { zh: '试听枪声', en: 'Test shot' },
  quickPickHint: {
    zh: '选择武器后，下面的准心、武器、音效会一次性统一',
    en: 'Picking a weapon below syncs crosshair, weapon FX and sound at once'
  },

  actionEnter: { zh: '进入射击模式', en: 'Enter firing mode' },
  actionExit: { zh: '退出射击模式', en: 'Exit firing mode' },
  actionRefit: { zh: '重新适配屏幕', en: 'Refit to screen' },
  actionQuit: { zh: '退出程序', en: 'Quit' },
  counterShots: { zh: '已开火', en: 'Shots fired' },

  unitSeconds: { zh: 's', en: 's' },
  unitMs: { zh: 'ms', en: 'ms' },
  unitShots: { zh: '发', en: '' }
} as const satisfies Record<string, Entry>

export type UiKey = keyof typeof DICT

type Translator = (key: UiKey) => string

/** 生成一个取文案的函数，绑定固定语言 */
export function createTranslator(language: UiLanguage): Translator {
  return (key: UiKey): string => DICT[key][language]
}

/** 判断一个 BCP 47 locale 是否属于中文系（zh / zh-CN / zh-TW / zh-HK / zh-Hans …） */
export function isChineseLocale(locale: string): boolean {
  return /^zh\b/i.test(locale.trim())
}

/**
 * 把语言设置解析成实际渲染语言。
 * 'system' 时跟随系统 locale：中文系用中文，其余全部兜底英文。
 */
export function resolveLanguage(setting: LanguageSetting, systemLocale: string): UiLanguage {
  if (setting === 'zh' || setting === 'en') return setting
  return isChineseLocale(systemLocale) ? 'zh' : 'en'
}
