import { useCallback, useEffect, useRef, useState } from 'react'
import { GunAudio } from '../overlay/audio'
import { drawCrosshair } from '../shared/crosshair'
import { createTranslator, resolveLanguage } from '../shared/i18n'
import {
  DEFAULT_CONFIG,
  LANGUAGE_LABELS,
  SOUND_FILES,
  WEAPON_KINDS,
  WEAPON_LABELS,
  type AppConfig,
  type LanguageSetting,
  type UiLanguage,
  type WeaponKind
} from '../shared/types'

const PRESET_COLORS = ['#FF3B30', '#34C759', '#0A84FF', '#FFD60A', '#FFFFFF', '#FF2D95']

const LANGUAGE_OPTIONS = ['system', 'zh', 'en'] as const satisfies readonly LanguageSetting[]

/** 武器下拉选项，四处复用：顶部快速切换 / 准心 / 武器 / 音效 */
function WeaponOptions({ lang }: { lang: UiLanguage }): React.JSX.Element[] {
  return WEAPON_KINDS.map((kind) => (
    <option key={kind} value={kind}>
      {WEAPON_LABELS[kind][lang]}
    </option>
  ))
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [mode, setMode] = useState<boolean>(false)
  const [accelDraft, setAccelDraft] = useState<string>(DEFAULT_CONFIG.toggleAccelerator)
  const [accelValid, setAccelValid] = useState<boolean>(true)
  const [shotCount, setShotCount] = useState<number>(0)

  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<GunAudio | null>(null)
  const pending = useRef<Partial<AppConfig>>({})
  const timer = useRef<number | null>(null)

  // 界面语言：'system' 时按系统 locale 解析
  const lang: UiLanguage = resolveLanguage(config.language, navigator.language)
  const t = createTranslator(lang)

  /* ---------- 初始化：拉取配置、订阅事件 ---------- */
  useEffect(() => {
    let disposed = false
    void (async (): Promise<void> => {
      const [cfg, m, count] = await Promise.all([
      window.shooting.getConfig(),
      window.shooting.getMode(),
      window.shooting.getShotCount()
    ])
      if (disposed) return
      setConfig(cfg)
      setAccelDraft(cfg.toggleAccelerator)
      setMode(m)
      setShotCount(count)
    })()

    const offConfig = window.shooting.onConfigChanged((next) => {
      setConfig(next)
      setAccelDraft(next.toggleAccelerator)
    })
    const offMode = window.shooting.onModeChanged(setMode)
    // 用主进程下发的累计值，而不是本地 +1，这样窗口重开计数能接上
    const offShot = window.shooting.onShot((event) => setShotCount(event.total))

    return () => {
      disposed = true
      offConfig()
      offMode()
      offShot()
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  /* ---------- 配置写入 ---------- */

  /** 立即提交（下拉框、颜色等离散操作） */
  const commit = useCallback((patch: Partial<AppConfig>): void => {
    void window.shooting.setConfig(patch).then(setConfig)
  }, [])

  /** 防抖提交（滑块拖动时避免每帧写一次磁盘） */
  const commitDebounced = useCallback((patch: Partial<AppConfig>): void => {
    setConfig((prev) => ({ ...prev, ...patch }))
    pending.current = { ...pending.current, ...patch }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const payload = pending.current
      pending.current = {}
      timer.current = null
      void window.shooting.setConfig(payload).then(setConfig)
  }, 250)
  }, [])

  /* ---------- 准心预览 ---------- */
  const drawPreview = useCallback((): void => {
    const canvas = previewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    drawCrosshair(ctx, w / 2, h / 2, config, 0)
  }, [config])

  useEffect(() => {
    drawPreview()
  }, [drawPreview])

  // 窗口缩放会改变 canvas 的 CSS 尺寸，不重绘的话画面会被拉伸变形
  useEffect(() => {
    const canvas = previewRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => drawPreview())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [drawPreview])

  const toggleMode = useCallback((): void => {
    void window.shooting.setMode(!mode).then(setMode)
  }, [mode])

  const onAccelChange = useCallback(
    (value: string): void => {
      setAccelDraft(value)
      void (async (): Promise<void> => {
        const ok = value.trim().length > 0 && (await window.shooting.validateAccelerator(value))
        setAccelValid(ok)
        if (ok) commit({ toggleAccelerator: value })
      })()
    },
    [commit]
  )

  const playTestShot = useCallback((): void => {
    if (!audioRef.current) audioRef.current = new GunAudio()
    const audio = audioRef.current
    audio.setMuted(false)
    audio.setVolume(config.volume)
    void (async (): Promise<void> => {
      const file = SOUND_FILES[config.sound]
      // 手枪是合成音，无需加载素材
      if (file === null) {
        audio.fire()
        return
      }
      if (audio.hasSample(config.sound)) {
        audio.playSample(config.sound)
        return
      }
      // 素材读取或解码失败时回退合成音，保证点击必有声
      const data = await window.shooting.loadSound(file)
      if (data === null || !(await audio.loadSample(config.sound, data))) {
        audio.fire()
        return
      }
      audio.playSample(config.sound)
    })()
  }, [config.volume, config.sound])

  /** 顶部快速切换：一次性统一准心、武器、音效三个维度 */
  const onQuickPick = useCallback(
    (value: string): void => {
      if (value === '') return
      const kind = value as WeaponKind
      commit({ weapon: kind, sound: kind, crosshairStyle: kind })
    },
    [commit]
  )

  const onLanguageChange = useCallback(
    (value: string): void => {
      commit({ language: value as LanguageSetting })
    },
    [commit]
  )

  // 三个维度取值一致时显示该武器，否则显示「自定义」
  const unified =
    config.weapon === config.sound && config.sound === config.crosshairStyle ? config.weapon : null

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>{t('appTitle')}</h1>
          <p className="sub">{t('appSubtitle')}</p>
        </div>
        <div className="hero-actions">
          <label className="pick-row">
            <span>{t('rowLanguage')}</span>
            <select
              value={config.language}
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {LANGUAGE_LABELS[option][lang]}
                </option>
              ))}
            </select>
          </label>
          <label className="pick-row">
            <span>{t('rowWeapon')}</span>
            <select
              value={unified ?? ''}
              onChange={(e) => onQuickPick(e.target.value)}
              title={t('quickPickHint')}
            >
              <option value="">{t('presetCustom')}</option>
              <WeaponOptions lang={lang} />
            </select>
          </label>
        </div>
      </header>

      <section className="card">
        <h2>{t('sectionTrigger')}</h2>
        <label className="row">
          <span>{t('labelHotkey')}</span>
          <input
            className={accelValid ? 'text' : 'text invalid'}
            value={accelDraft}
            spellCheck={false}
            onChange={(e) => onAccelChange(e.target.value)}
            placeholder="Control+Alt+S"
          />
        </label>
        <p className={accelValid ? 'hint' : 'hint error'}>
          {accelValid ? t('hotkeyHint') : t('hotkeyInvalid')}
        </p>
        <div className="row-actions">
          <button onClick={toggleMode}>{mode ? t('actionExit') : t('actionEnter')}</button>
          <button className="ghost" onClick={() => window.shooting.refitOverlays()}>
            {t('actionRefit')}
          </button>
          <span className="counter">
            {t('counterShots')} {shotCount}
            {t('unitShots')}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>{t('sectionCrosshair')}</h2>
        <canvas ref={previewRef} className="preview" />
        <label className="row">
          <span>{t('labelStyle')}</span>
          <select
            value={config.crosshairStyle}
            onChange={(e) => commit({ crosshairStyle: e.target.value as WeaponKind })}
          >
            <WeaponOptions lang={lang} />
          </select>
        </label>
        <label className="row">
          <span>{t('labelColor')}</span>
          <input
            type="color"
            value={config.crosshairColor}
            onChange={(e) => commitDebounced({ crosshairColor: e.target.value })}
          />
        </label>
        <div className="swatches">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              className="swatch"
            style={{ background: color }}
            title={color}
            onClick={() => commit({ crosshairColor: color })}
          />
        ))}
        </div>
      </section>

      <section className="card">
        <h2>{t('sectionWeapon')}</h2>
        <label className="row">
          <span>{t('labelWeapon')}</span>
          <select
            value={config.weapon}
            onChange={(e) => commit({ weapon: e.target.value as WeaponKind })}
          >
            <WeaponOptions lang={lang} />
          </select>
        </label>
        <label className="row">
          <span>
            {t('labelEffectScale')} ×{config.effectScale.toFixed(2)}
          </span>
          <input
            type="range"
            min={0.4}
            max={2.5}
            step={0.05}
            value={config.effectScale}
            onChange={(e) => commitDebounced({ effectScale: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelEffectDuration')} {(config.effectDurationMs / 1000).toFixed(2)}
            {t('unitSeconds')}
          </span>
          <input
            type="range"
            min={120}
            max={2500}
            step={20}
            value={config.effectDurationMs}
            onChange={(e) => commitDebounced({ effectDurationMs: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelImpactScale')} ×{config.impactScale.toFixed(2)}
          </span>
          <input
            type="range"
            min={0.4}
            max={2.5}
            step={0.05}
            value={config.impactScale}
            onChange={(e) => commitDebounced({ impactScale: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelImpactDuration')} {(config.impactDurationMs / 1000).toFixed(1)}
            {t('unitSeconds')}
          </span>
          <input
            type="range"
            min={0}
            max={10000}
            step={200}
            value={config.impactDurationMs}
            onChange={(e) => commitDebounced({ impactDurationMs: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelImpactDelay')} {config.impactDelayMs}
            {t('unitMs')}
          </span>
          <input
            type="range"
            min={0}
            max={600}
            step={10}
            value={config.impactDelayMs}
            onChange={(e) => commitDebounced({ impactDelayMs: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelRecoil')} {Math.round(config.recoil * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.recoil}
            onChange={(e) => commitDebounced({ recoil: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>
            {t('labelShake')} {Math.round(config.shake * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.shake}
            onChange={(e) => commitDebounced({ shake: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="card">
        <h2>{t('sectionSound')}</h2>
        <label className="row">
          <span>{t('labelShot')}</span>
          <select
            value={config.sound}
            onChange={(e) => commit({ sound: e.target.value as WeaponKind })}
          >
            <WeaponOptions lang={lang} />
          </select>
        </label>
        <label className="row">
          <span>
            {t('labelVolume')} {Math.round(config.volume * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.volume}
            onChange={(e) => commitDebounced({ volume: Number(e.target.value) })}
          />
        </label>
        <div className="row-actions">
          <button onClick={playTestShot}>{t('actionTest')}</button>
        </div>
      </section>

      <section className="card">
        <h2>{t('sectionSystem')}</h2>
        <div className="row-actions">
          <button className="danger" onClick={() => window.shooting.quitApp()}>
            {t('actionQuit')}
          </button>
        </div>
      </section>
    </div>
  )
}
