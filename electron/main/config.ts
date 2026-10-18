import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type LanguageSetting,
  type WeaponKind
} from '../../src/shared/types'

/**
 * 配置持久化：读写 %APPDATA%/cursor-shooting/config.json
 *
 * 为什么不用 electron-store：本项目配置项少且结构固定，自己写读写可以顺带做
 * 「脏配置自愈」——用户手改配置文件写错类型时，程序不会崩，而是回退默认值。
 */

let cached: AppConfig | null = null

const WEAPON_KINDS: readonly WeaponKind[] = ['pistol', 'rocket', 'energy']

function pickWeapon(value: unknown, fallback: WeaponKind): WeaponKind {
  return WEAPON_KINDS.includes(value as WeaponKind) ? (value as WeaponKind) : fallback
}

const LANGUAGE_VALUES: readonly LanguageSetting[] = ['system', 'zh', 'en']

function pickLanguage(value: unknown): LanguageSetting {
  return LANGUAGE_VALUES.includes(value as LanguageSetting)
    ? (value as LanguageSetting)
    : DEFAULT_CONFIG.language
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** 把任意来源（磁盘/渲染进程）的对象收敛成合法的 AppConfig */
function sanitize(raw: unknown): AppConfig {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof AppConfig, unknown>>
  const color = /^#[0-9a-fA-F]{6}$/.test(String(src.crosshairColor ?? ''))
    ? String(src.crosshairColor)
    : DEFAULT_CONFIG.crosshairColor

  return {
    toggleAccelerator: pickString(src.toggleAccelerator, DEFAULT_CONFIG.toggleAccelerator),
    weapon: pickWeapon(src.weapon, DEFAULT_CONFIG.weapon),
    sound: pickWeapon(src.sound, DEFAULT_CONFIG.sound),
    crosshairStyle: pickWeapon(src.crosshairStyle, DEFAULT_CONFIG.crosshairStyle),
    crosshairColor: color,
    volume: clampNumber(src.volume, 0, 1, DEFAULT_CONFIG.volume),
    muted: typeof src.muted === 'boolean' ? src.muted : DEFAULT_CONFIG.muted,
    effectScale: clampNumber(src.effectScale, 0.4, 2.5, DEFAULT_CONFIG.effectScale),
    effectDurationMs: Math.round(
      clampNumber(src.effectDurationMs, 120, 4000, DEFAULT_CONFIG.effectDurationMs)
    ),
    impactScale: clampNumber(src.impactScale, 0.4, 2.5, DEFAULT_CONFIG.impactScale),
    impactDurationMs: Math.round(
      clampNumber(src.impactDurationMs, 0, 15000, DEFAULT_CONFIG.impactDurationMs)
    ),
    impactDelayMs: Math.round(clampNumber(src.impactDelayMs, 0, 600, DEFAULT_CONFIG.impactDelayMs)),
    language: pickLanguage(src.language),
    recoil: clampNumber(src.recoil, 0, 1, DEFAULT_CONFIG.recoil),
    shake: clampNumber(src.shake, 0, 1, DEFAULT_CONFIG.shake),
    openAtLogin: typeof src.openAtLogin === 'boolean' ? src.openAtLogin : DEFAULT_CONFIG.openAtLogin,
    startMinimized:
      typeof src.startMinimized === 'boolean' ? src.startMinimized : DEFAULT_CONFIG.startMinimized
  }
}

/** 读取配置（首次调用后缓存，磁盘只在启动/写入时访问） */
export function loadConfig(): AppConfig {
  if (cached) return cached
  try {
    const file = configPath()
    if (existsSync(file)) {
      cached = sanitize(JSON.parse(readFileSync(file, 'utf-8')))
      return cached
    }
  } catch (err) {
    console.error('[config] 读取失败，回退默认配置:', err)
  }
  cached = { ...DEFAULT_CONFIG }
  return cached
}

/** 写入磁盘 */
export function saveConfig(config: AppConfig): void {
  const next = sanitize(config)
  cached = next
  try {
    const file = configPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.error('[config] 写入失败:', err)
  }
}

/** 局部更新并持久化，返回合并后的完整配置 */
export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const merged = sanitize({ ...loadConfig(), ...patch })
  saveConfig(merged)
  return merged
}
