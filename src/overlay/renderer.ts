import { GunAudio } from './audio'
import { drawCrosshair, strokePolyline } from '../shared/crosshair'
import { DEFAULT_CONFIG, SOUND_FILES, type AppConfig, type WeaponKind } from '../shared/types'

/**
 * 覆盖层渲染：所有视觉元素都是 Canvas 程序化绘制，不使用任何图片素材。
 *
 * 为什么不用素材图片：
 *  1. 素材多为纯黑背景，而 Electron 透明窗口内 mix-blend-mode 不生效（没有下层内容可混合），
 *     黑底无法消除；
 *  2. 程序化绘制可以按参数实时调节大小/时长，且风格与手枪特效天然统一；
 *  3. 零素材 = 零体积、零版权风险。
 *
 * 三套视觉（由 config.weapon 决定）：
 *  - pistol：闪光 + 冲击波 + 火花；残留 = 弹孔 + 裂纹
 *  - rocket：火球 + 冲击波 + 烟雾；残留 = 焦黑表面 + 跳动的火星余烬
 *  - energy：能量环 + 电流 + 炫光粒子；残留 = 虚空裂隙 + 渗出的能量
 */

/** 残留在屏幕上同时存在的最大数量，防止连发时堆积拖垮帧率 */
const MAX_IMPACTS = 25
const MIN_SHOT_INTERVAL_MS = 45
/** 残留生命末期的淡出时长 */
const IMPACT_FADE_MS = 600
const SHAKE_MS = 170

type Point = [number, number]

/** 余烬火星：相对残留中心的偏移 + 跳动相位 */
interface Ember {
  ox: number
  oy: number
  phase: number
  size: number
}

/** 螺旋传送门的一条旋臂 */
interface Rift {
  /** 起始相位（弧度） */
  phase: number
  /** 旋向：1 顺时针、-1 逆时针 */
  dir: number
  /** 螺旋张开的角度跨度（弧度），越大卷得越厉害 */
  span: number
  /** 旋转速度系数 */
  speed: number
}

interface Burst {
  kind: WeaponKind
  x: number
  y: number
  born: number
  seed: number
}

interface Impact {
  kind: WeaponKind
  x: number
  y: number
  born: number
  seed: number
  radius: number
  /** 手枪：放射状裂纹 */
  cracks: Point[][]
  /** 火箭筒：跳动的火星 */
  embers: Ember[]
  /** 能量武器：裂隙分支 */
  rifts: Rift[]
}

/** 确定性伪随机：同一 seed 每次生成相同形状 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 把 [0,1] 上的进度 t 按给定区间 [a,b] 归一，并处理区间外的裁剪 */
function phase(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a))
}

/* ---------------- 几何预生成 ---------------- */

function makeCracks(seed: number, count: number, maxLen: number): Point[][] {
  const rnd = mulberry32(seed ^ 0x9e3779b9)
  const lines: Point[][] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.6
    const pts: Point[] = [[0, 0]]
    let a = angle
    let px = Math.cos(a) * (4 + rnd() * 6)
    let py = Math.sin(a) * (4 + rnd() * 6)
    pts.push([px, py])
    const segs = 3 + Math.floor(rnd() * 4)
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 0.9
      const step = (maxLen * (0.22 + rnd() * 0.38)) / segs
      px += Math.cos(a) * step
      py += Math.sin(a) * step
      pts.push([px, py])
    }
    lines.push(pts)
  }
  return lines
}

function makeEmbers(seed: number, radius: number, count: number): Ember[] {
  const rnd = mulberry32(seed ^ 0x5bf03635)
  const out: Ember[] = []
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2
    const dist = radius * (0.5 + rnd() * 1.5)
    out.push({
      ox: Math.cos(angle) * dist,
      oy: Math.sin(angle) * dist,
      phase: rnd() * Math.PI * 2,
      size: 1.1 + rnd() * 1.6
    })
  }
  return out
}

/** 生成螺旋旋臂：相邻臂反向旋转，卷曲程度与转速各不相同 */
function makeRifts(seed: number, count: number): Rift[] {
  const rnd = mulberry32(seed ^ 0x2545f491)
  const out: Rift[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      phase: (i / count) * Math.PI * 2,
      dir: i % 2 === 0 ? 1 : -1,
      span: 2.6 + rnd() * 1.8,
      speed: 0.5 + rnd() * 0.6
    })
  }
  return out
}

class OverlayStage {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly audio = new GunAudio()

  private config: AppConfig = { ...DEFAULT_CONFIG }
  private active = false

  private pointerX = -999
  private pointerY = -999
  private hasPointer = false

  private bursts: Burst[] = []
  private impacts: Impact[] = []

  /** 开火后准心扩散量，随时间回落 */
  private bloom = 0
  /** 屏幕震动强度，随时间衰减 */
  private shake = 0
  private shakeSeed = 0

  private lastTime = 0
  private lastShotAt = 0
  private dirty = true
  private cssWidth = 0
  private cssHeight = 0

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D 绘图上下文')
    this.canvas = canvas
    this.ctx = ctx
  }

  async init(): Promise<void> {
    const config = await window.shooting.getConfig()
    this.applyConfig(config)
    window.shooting.onConfigChanged((next) => this.applyConfig(next))

    // 预加载素材音效（手枪用合成音，无需加载）
    void this.preloadSounds()

    const mode = await window.shooting.getMode()
    this.setActive(mode)
    window.shooting.onModeChanged((next) => this.setActive(next))

    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)

    this.ensureSize()
    this.lastTime = performance.now()
    requestAnimationFrame(this.frame)
  }

  private async preloadSounds(): Promise<void> {
    for (const kind of ['rocket', 'energy'] as WeaponKind[]) {
      const file = SOUND_FILES[kind]
      if (!file) continue
      const data = await window.shooting.loadSound(file)
      if (data) {
        const ok = await this.audio.loadSample(kind, data)
        if (!ok) console.warn(`[overlay] ${kind} 音效不可用，将回退合成音`)
      } else {
        console.warn(`[overlay] ${kind} 音效文件读取失败，将回退合成音`)
      }
    }
  }

  private applyConfig(config: AppConfig): void {
    this.config = config
    this.audio.setVolume(config.volume)
    this.audio.setMuted(config.muted)
    this.dirty = true
  }

  private setActive(active: boolean): void {
    this.active = active
    if (!active) {
      // 退出射击模式：抹掉全部痕迹，避免再次进入时残留旧弹孔
      this.impacts = []
      this.bursts = []
      this.bloom = 0
      this.shake = 0
    }
    this.dirty = true
  }

  /* ---------------- 事件 ---------------- */

  private onMouseMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX
    this.pointerY = event.clientY
    this.hasPointer = true
    this.dirty = true
  }

  private onMouseDown = (event: MouseEvent): void => {
    // 只响应左键；事件在覆盖层被吃掉，不会穿透到下层窗口
    if (event.button !== 0) return
    event.preventDefault()
    const now = performance.now()
    // 连点限速：避免极端连点瞬间堆出上百个音频节点
    if (now - this.lastShotAt < MIN_SHOT_INTERVAL_MS) return
    this.lastShotAt = now
    this.shoot(event.clientX, event.clientY)
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') void window.shooting.setMode(false)
  }

  /* ---------------- 开火 ---------------- */

  private shoot(x: number, y: number): void {
    const cfg = this.config
    const now = performance.now()

    this.pointerX = x
    this.pointerY = y
    this.hasPointer = true

    // 后坐力：准心瞬时扩散，随后回落
    this.bloom = Math.min(1.6, this.bloom + 0.55 + cfg.recoil * 0.6)
    this.shake = Math.min(1, this.shake + cfg.shake)
    this.shakeSeed = (Math.random() * 0xffffffff) >>> 0

    // 音效由独立的 sound 选单决定，与武器、准心互不干扰
    if (!cfg.muted) {
      if (cfg.sound === 'pistol') this.audio.fire()
      else if (this.audio.hasSample(cfg.sound)) this.audio.playSample(cfg.sound)
      else this.audio.fire()
    }

    this.bursts.push({
      kind: cfg.weapon,
      x,
      y,
      born: now,
      seed: (Math.random() * 0xffffffff) >>> 0
    })

    if (cfg.impactDurationMs > 0) {
      window.setTimeout(() => {
        if (!this.active) return
        this.pushImpact(cfg.weapon, x, y)
      }, cfg.impactDelayMs)
    }

    window.shooting.notifyShot(x, y)
    this.dirty = true
  }

  private pushImpact(kind: WeaponKind, x: number, y: number): void {
    const seed = (Math.random() * 0xffffffff) >>> 0
    const rnd = mulberry32(seed)
    const scale = this.config.impactScale

    // 注意：radius / embers 偏移 / cracks 长度都在生成时就乘好 impactScale，
    // 绘制阶段不要再乘一次，否则调大缩放时会变成平方级放大
    const impact: Impact = {
      kind,
      x,
      y,
      born: performance.now(),
      seed,
      radius: (kind === 'pistol' ? 8 : kind === 'rocket' ? 26 : 24) * scale,
      cracks:
        kind === 'pistol'
          ? makeCracks(seed, 5 + Math.floor(rnd() * 4), 58)
          : kind === 'energy'
            ? // 能量武器：更长更张狂的碎裂纹路
              makeCracks(seed ^ 0x77d3e2a1, 4 + Math.floor(rnd() * 3), 78)
            : [],
      embers: kind === 'rocket' ? makeEmbers(seed, 26 * scale, 9 + Math.floor(rnd() * 4)) : [],
      rifts: kind === 'energy' ? makeRifts(seed, 3 + Math.floor(rnd() * 2)) : []
    }

    this.impacts.push(impact)
    // 超过上限就顶掉最旧的，防止连发后堆满屏幕
    if (this.impacts.length > MAX_IMPACTS) this.impacts.splice(0, this.impacts.length - MAX_IMPACTS)
    this.dirty = true
  }

  /* ---------------- 主循环 ---------------- */

  private frame = (now: number): void => {
    // dt 限幅：窗口从隐藏恢复或系统卡顿后，避免一帧跨度过长导致动画跳变
    const dt = Math.min(50, Math.max(0, now - this.lastTime))
    this.lastTime = now

    this.ensureSize()
    this.step(now, dt)
    this.render(now)
    requestAnimationFrame(this.frame)
  }

  private step(now: number, dt: number): void {
    this.bloom = Math.max(0, this.bloom - dt / 420)
    this.shake = Math.max(0, this.shake - dt / SHAKE_MS)

    const burstLife = Math.max(120, this.config.effectDurationMs)
    if (this.bursts.length > 0) {
      this.bursts = this.bursts.filter((b) => now - b.born < burstLife)
    }

    const impactLife = this.config.impactDurationMs
    if (impactLife <= 0) {
      if (this.impacts.length > 0) this.impacts = []
    } else if (this.impacts.length > 0) {
      this.impacts = this.impacts.filter((im) => now - im.born < impactLife)
    }
  }

  private render(now: number): void {
    const busy =
      this.bursts.length > 0 || this.impacts.length > 0 || this.bloom > 0.002 || this.shake > 0.002

    // 无活动特效且指针没动 -> 整帧跳过，省电省 GPU
    if (!busy && !this.dirty) return

    const ctx = this.ctx
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight)

    if (this.shake > 0.002) {
      const rnd = mulberry32(this.shakeSeed + Math.floor(now / 16))
      const amp = this.shake * 9
      ctx.translate((rnd() - 0.5) * amp, (rnd() - 0.5) * amp)
    }

    for (const impact of this.impacts) this.drawImpact(impact, now)
    for (const burst of this.bursts) this.drawBurst(burst, now)

    if (this.active && this.hasPointer) {
      drawCrosshair(ctx, this.pointerX, this.pointerY, this.config, this.bloom)
    }

    this.dirty = false
  }

  /* ---------------- 开火特效 ---------------- */

  private drawBurst(burst: Burst, now: number): void {
    const life = Math.max(120, this.config.effectDurationMs)
    const t = clamp01((now - burst.born) / life)
    const age = now - burst.born
    const scale = this.config.effectScale
    switch (burst.kind) {
      case 'rocket':
        this.drawRocketBurst(burst, t, age, scale)
        break
      case 'energy':
        this.drawEnergyBurst(burst, t, age, scale)
        break
      case 'pistol':
        this.drawPistolBurst(burst, t, age, scale)
        break
    }
  }

  /** 手枪：枪口闪光 + 冲击波 + 火花 */
  private drawPistolBurst(burst: Burst, t: number, age: number, scale: number): void {
    const ctx = this.ctx

    // 枪口闪光：白心 → 黄边，极快衰减
    const flashT = phase(t, 0, 0.22)
    if (flashT < 1) {
      const r = (30 + flashT * 60) * scale
      const a = 1 - flashT
      const g = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, r)
      g.addColorStop(0, `rgba(255, 255, 240, ${0.95 * a})`)
      g.addColorStop(0.32, `rgba(255, 226, 140, ${0.55 * a})`)
      g.addColorStop(1, 'rgba(255, 190, 80, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // 冲击波
    const waveT = phase(t, 0, 0.45)
    if (waveT < 1) {
      const r = (8 + waveT * 95) * scale
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - waveT)})`
      ctx.lineWidth = 3 * (1 - waveT) + 0.5
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 火花
    const sparkT = phase(t, 0, 0.6)
    if (sparkT < 1) {
      const rnd = mulberry32(burst.seed)
      for (let i = 0; i < 12; i++) {
        const angle = rnd() * Math.PI * 2
        const speed = 0.18 + rnd() * 0.55
        const px = burst.x + Math.cos(angle) * speed * age
        const py = burst.y + Math.sin(angle) * speed * age + 0.0009 * age * age
        const size = (1 + rnd() * 2) * scale
        ctx.fillStyle = `rgba(255, ${190 + Math.round(40 * (1 - sparkT))}, 120, ${1 - sparkT})`
        ctx.beginPath()
        ctx.arc(px, py, size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  /** 火箭筒：火球 + 冲击波 + 翻滚烟雾 + 大量火星 */
  private drawRocketBurst(burst: Burst, t: number, age: number, scale: number): void {
    const ctx = this.ctx

    // 火球：白心 → 橙 → 红，边膨胀边淡出
    const fireT = phase(t, 0, 0.4)
    if (fireT < 1) {
      const r = (22 + fireT * 110) * scale
      const a = 1 - fireT * 0.85
      const g = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, r)
      g.addColorStop(0, `rgba(255, 255, 245, ${0.95 * a})`)
      g.addColorStop(0.18, `rgba(255, 190, 90, ${0.85 * a})`)
      g.addColorStop(0.5, `rgba(226, 100, 30, ${0.6 * a})`)
      g.addColorStop(1, 'rgba(120, 30, 10, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // 冲击波：比手枪更粗、扩散更远
    const waveT = phase(t, 0, 0.55)
    if (waveT < 1) {
      const r = (12 + waveT * 170) * scale
      ctx.strokeStyle = `rgba(255, 205, 150, ${0.55 * (1 - waveT)})`
      ctx.lineWidth = 5 * (1 - waveT) + 0.8
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 烟雾：晚于火球出现，缓慢膨胀并上飘
    const smokeT = phase(t, 0.15, 1)
    if (t > 0.15) {
      const rnd = mulberry32(burst.seed ^ 0x7f4a7c15)
      for (let i = 0; i < 7; i++) {
        const angle = rnd() * Math.PI * 2
        const dist = (10 + rnd() * 30) * scale
        const ox = Math.cos(angle) * dist
        const oy = Math.sin(angle) * dist - smokeT * 26 * scale
        const r = (16 + smokeT * 46) * scale * (0.7 + rnd() * 0.6)
        const a = 0.3 * (1 - smokeT) * (fireT < 1 ? 1 : 1)
        const g = ctx.createRadialGradient(
          burst.x + ox,
          burst.y + oy,
          0,
          burst.x + ox,
          burst.y + oy,
          r
        )
        g.addColorStop(0, `rgba(96, 90, 84, ${a})`)
        g.addColorStop(1, 'rgba(70, 66, 62, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(burst.x + ox, burst.y + oy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 火星：数量比手枪多，颜色偏红
    const sparkT = phase(t, 0, 0.75)
    if (sparkT < 1) {
      const rnd = mulberry32(burst.seed ^ 0x2c1b3c6d)
      for (let i = 0; i < 22; i++) {
        const angle = rnd() * Math.PI * 2
        const speed = 0.22 + rnd() * 0.75
        const px = burst.x + Math.cos(angle) * speed * age
        const py = burst.y + Math.sin(angle) * speed * age + 0.0011 * age * age
        const size = (1.2 + rnd() * 2.2) * scale
        ctx.fillStyle = `rgba(255, ${150 + Math.round(70 * (1 - sparkT))}, 60, ${1 - sparkT})`
        ctx.beginPath()
        ctx.arc(px, py, size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  /** 能量武器：双色能量环 + 抖动的电流 + 带拖尾的炫光粒子 */
  private drawEnergyBurst(burst: Burst, t: number, age: number, scale: number): void {
    const ctx = this.ctx

    // 能量环：外青内紫
    const ringT = phase(t, 0, 0.45)
    if (ringT < 1) {
      const a = 1 - ringT
      ctx.strokeStyle = `rgba(79, 227, 255, ${0.7 * a})`
      ctx.lineWidth = 3 * a + 0.6
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, (15 + ringT * 125) * scale, 0, Math.PI * 2)
      ctx.stroke()

      ctx.strokeStyle = `rgba(179, 107, 255, ${0.6 * a})`
      ctx.lineWidth = 2.5 * a + 0.5
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, (8 + ringT * 72) * scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 电流：每 60ms 重掷一次形状，产生放电抖动感
    const arcT = phase(t, 0, 0.32)
    if (arcT < 1) {
      const rnd = mulberry32(burst.seed + Math.floor(age / 60) * 7919)
      const a = 1 - arcT
      ctx.lineCap = 'round'
      for (let i = 0; i < 5; i++) {
        const baseAngle = rnd() * Math.PI * 2
        const reach = (30 + rnd() * 60) * scale
        let ang = baseAngle
        let px = burst.x
        let py = burst.y
        ctx.beginPath()
        ctx.moveTo(px, py)
        const segs = 3
        for (let s = 0; s < segs; s++) {
          ang += (rnd() - 0.5) * 1.1
          const step = reach / segs
          px += Math.cos(ang) * step
          py += Math.sin(ang) * step
          ctx.lineTo(px, py)
        }
        ctx.strokeStyle = `rgba(159, 246, 255, ${0.85 * a})`
        ctx.lineWidth = 2.2
        ctx.stroke()
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * a})`
        ctx.lineWidth = 0.9
        ctx.stroke()
      }
      ctx.lineCap = 'butt'
    }

    // 炫光粒子：画一小段线段当作拖尾
    const sparkT = phase(t, 0, 0.6)
    if (sparkT < 1) {
      const rnd = mulberry32(burst.seed ^ 0x1d2c3f4a)
      for (let i = 0; i < 18; i++) {
        const angle = rnd() * Math.PI * 2
        const speed = 0.2 + rnd() * 0.6
        const px = burst.x + Math.cos(angle) * speed * age
        const py = burst.y + Math.sin(angle) * speed * age
        const tail = Math.min(24, speed * 40) * scale
        const g = ctx.createLinearGradient(
          px - Math.cos(angle) * tail,
          py - Math.sin(angle) * tail,
          px,
          py
        )
        const a = 1 - sparkT
        g.addColorStop(0, `rgba(127, 216, 255, 0)`)
        g.addColorStop(1, `rgba(200, 160, 255, ${a})`)
        ctx.strokeStyle = g
        ctx.lineWidth = (1.4 + rnd() * 1.6) * scale
        ctx.beginPath()
        ctx.moveTo(px - Math.cos(angle) * tail, py - Math.sin(angle) * tail)
        ctx.lineTo(px, py)
        ctx.stroke()
      }
    }
  }

  /* ---------------- 残留痕迹 ---------------- */

  private drawImpact(impact: Impact, now: number): void {
    const life = this.config.impactDurationMs
    if (life <= 0) return
    const remain = life - (now - impact.born)
    if (remain <= 0) return
    // 生命最后阶段线性淡出
    const fade = clamp01(remain / Math.min(IMPACT_FADE_MS, life))
    const scale = this.config.impactScale

    switch (impact.kind) {
      case 'rocket':
        this.drawRocketImpact(impact, fade, now, scale)
        break
      case 'energy':
        this.drawEnergyImpact(impact, fade, now, scale)
        break
      case 'pistol':
        this.drawPistolImpact(impact, fade)
        break
    }
  }

  /** 手枪残留：弹孔 + 放射裂纹（半径已含 impactScale，无需再乘） */
  private drawPistolImpact(impact: Impact, fade: number): void {
    const ctx = this.ctx
    const rnd = mulberry32(impact.seed)
    const r = impact.radius

    // 外围焦痕
    const scorch = ctx.createRadialGradient(impact.x, impact.y, r * 0.15, impact.x, impact.y, r * 2.3)
    scorch.addColorStop(0, `rgba(8, 6, 4, ${0.95 * fade})`)
    scorch.addColorStop(0.32, `rgba(46, 28, 12, ${0.5 * fade})`)
    scorch.addColorStop(1, 'rgba(70, 45, 20, 0)')
    ctx.fillStyle = scorch
    ctx.beginPath()
    ctx.arc(impact.x, impact.y, r * 2.3, 0, Math.PI * 2)
    ctx.fill()

    // 弹孔本体：不规则多边形
    ctx.beginPath()
    const steps = 14
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const rr = r * (0.72 + rnd() * 0.5)
      const x = impact.x + Math.cos(a) * rr
      const y = impact.y + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = `rgba(5, 4, 3, ${0.96 * fade})`
    ctx.fill()
    ctx.strokeStyle = `rgba(255, 240, 215, ${0.22 * fade})`
    ctx.lineWidth = 1
    ctx.stroke()

    // 裂纹：先深色底衬再浅色主线，保证深浅背景上都可见
    ctx.lineCap = 'round'
    for (const line of impact.cracks) {
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.45 * fade})`
      ctx.lineWidth = 2.2
      strokePolyline(ctx, line, impact.x + 1, impact.y + 1)
      ctx.strokeStyle = `rgba(236, 240, 250, ${0.62 * fade})`
      ctx.lineWidth = 1.1
      strokePolyline(ctx, line, impact.x, impact.y)
    }
    ctx.lineCap = 'butt'
  }

  /** 火箭筒残留：一大片焦黑表面 + 微微跳动的火星余烬 */
  private drawRocketImpact(impact: Impact, fade: number, now: number, scale: number): void {
    const ctx = this.ctx
    const rnd = mulberry32(impact.seed)
    const r = impact.radius

    // 余烬整体辉光：缓慢脉动，营造"还在烧"的感觉
    const pulse = 0.55 + 0.45 * Math.sin(now / 320 + impact.seed % 6.28)
    const glow = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, r * 2.6)
    glow.addColorStop(0, `rgba(120, 46, 12, ${0.42 * fade * pulse})`)
    glow.addColorStop(0.5, `rgba(70, 28, 8, ${0.24 * fade})`)
    glow.addColorStop(1, 'rgba(40, 16, 6, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(impact.x, impact.y, r * 2.6, 0, Math.PI * 2)
    ctx.fill()

    // 焦黑表面：几块重叠的不规则暗斑
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + rnd() * 0.7
      const dist = r * 0.35 * rnd()
      const cx = impact.x + Math.cos(angle) * dist
      const cy = impact.y + Math.sin(angle) * dist
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.ellipse(0, 0, r * (0.85 + rnd() * 0.5), r * (0.62 + rnd() * 0.4), 0, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(16, 11, 8, ${(0.72 + rnd() * 0.2) * fade})`
      ctx.fill()
      ctx.restore()
    }

    // 中心最黑的烧穿点
    const core = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, r * 0.9)
    core.addColorStop(0, `rgba(6, 4, 3, ${0.95 * fade})`)
    core.addColorStop(1, 'rgba(20, 12, 8, 0)')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(impact.x, impact.y, r * 0.9, 0, Math.PI * 2)
    ctx.fill()

    // 跳动的火星
    for (const ember of impact.embers) {
      const flicker = 0.35 + 0.65 * Math.sin(now / 200 + ember.phase)
      const a = flicker * fade
      if (a <= 0.02) continue
      // ember.ox / oy 在生成时已乘过 impactScale，这里不要再乘
      const ex = impact.x + ember.ox
      const ey = impact.y + ember.oy
      // 火星半径不随 radius 缩放（radius 已含 scale），这里单独乘一次
      const size = ember.size * scale * (0.7 + 0.5 * flicker)
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, size * 3)
      g.addColorStop(0, `rgba(255, 180, 90, ${0.9 * a})`)
      g.addColorStop(1, 'rgba(255, 110, 30, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(ex, ey, size * 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(255, 226, 170, ${a})`
      ctx.beginPath()
      ctx.arc(ex, ey, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /**
   * 能量武器残留：旋转的螺旋虚空传送门 + 四分五裂的不规则裂纹 + 紫色波动 + 能量粒子。
   *
   * 关键：整段用 globalCompositeOperation = 'lighter'（加色混合）绘制。
   * 这样紫色只会「发光叠加」在桌面上，永远压不出黑块——
   * 之前用普通混合 + 深紫填充，叠在浅色桌面上就是一坨突兀的黑斑。
   */
  private drawEnergyImpact(impact: Impact, fade: number, now: number, scale: number): void {
    const ctx = this.ctx
    const r = impact.radius
    const x = impact.x
    const y = impact.y

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // 1) 紫色辉光：中心亮、边缘淡出，整体缓慢脉动
    const pulse = 0.75 + 0.25 * Math.sin(now / 420 + (impact.seed % 6.28))
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.1)
    glow.addColorStop(0, `rgba(168, 112, 255, ${0.55 * fade * pulse})`)
    glow.addColorStop(0.35, `rgba(126, 72, 236, ${0.3 * fade * pulse})`)
    glow.addColorStop(0.7, `rgba(92, 48, 200, ${0.14 * fade})`)
    glow.addColorStop(1, 'rgba(70, 34, 170, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, r * 2.1, 0, Math.PI * 2)
    ctx.fill()

    // 2) 螺旋旋臂：绕中心旋转，整条臂的亮度随时间起伏
    ctx.lineCap = 'round'
    for (const arm of impact.rifts) {
      const base = arm.phase + arm.dir * (now / 1000) * arm.speed
      const wave = 0.55 + 0.45 * Math.sin(now / 300 + arm.phase)
      const steps = 46
      ctx.beginPath()
      for (let s = 0; s <= steps; s++) {
        const p = s / steps
        const theta = base + arm.dir * p * arm.span
        const rad = r * (0.12 + p * 1.08)
        const px = x + Math.cos(theta) * rad
        const py = y + Math.sin(theta) * rad
        if (s === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      // 径向渐变描边：内端最亮、外端消失
      const grad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.25)
      grad.addColorStop(0, `rgba(226, 196, 255, ${0.95 * fade * wave})`)
      grad.addColorStop(0.5, `rgba(176, 116, 255, ${0.8 * fade * wave})`)
      grad.addColorStop(1, 'rgba(120, 66, 236, 0)')
      ctx.strokeStyle = grad
      ctx.lineWidth = 2.6 * scale
      ctx.stroke()
    }

    // 3) 传送门环：呼吸式缩放
    const breathe = 0.6 + 0.4 * Math.sin(now / 500 + (impact.seed % 6.28))
    ctx.strokeStyle = `rgba(186, 128, 255, ${0.5 * fade * breathe})`
    ctx.lineWidth = 2 * scale
    ctx.beginPath()
    ctx.arc(x, y, r * (0.92 + 0.08 * breathe), 0, Math.PI * 2)
    ctx.stroke()

    // 4) 四分五裂的不规则裂纹：紫色发光的碎裂纹路
    for (let i = 0; i < impact.cracks.length; i++) {
      const shimmer = 0.45 + 0.55 * Math.sin(now / 280 + i * 1.9)
      ctx.strokeStyle = `rgba(198, 150, 255, ${0.55 * fade * shimmer})`
      ctx.lineWidth = 1.7 * scale
      strokePolyline(ctx, impact.cracks[i], x, y)
    }

    // 5) 虚空能量粒子：一边绕中心旋转一边向外飘散
    const rnd = mulberry32(impact.seed ^ 0x3a5c7d9f)
    for (let i = 0; i < 14; i++) {
      const orbit = rnd() * Math.PI * 2
      const speed = 0.6 + rnd() * 0.9
      const cycle = ((now / 1700) * speed + rnd()) % 1
      const rad = r * (0.18 + cycle * 1.35)
      const theta = orbit + cycle * 3.2 * (rnd() > 0.5 ? 1 : -1)
      const px = x + Math.cos(theta) * rad
      const py = y + Math.sin(theta) * rad
      const a = Math.sin(cycle * Math.PI) * fade
      if (a <= 0.02) continue
      const size = (1.2 + rnd() * 2) * scale
      const g = ctx.createRadialGradient(px, py, 0, px, py, size * 3.6)
      g.addColorStop(0, `rgba(224, 186, 255, ${0.95 * a})`)
      g.addColorStop(0.5, `rgba(160, 96, 255, ${0.5 * a})`)
      g.addColorStop(1, 'rgba(120, 70, 230, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(px, py, size * 3.6, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  /* ---------------- 尺寸 ---------------- */

  private ensureSize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    if (w === this.cssWidth && h === this.cssHeight && this.canvas.width > 0) return
    const dpr = window.devicePixelRatio || 1
    this.cssWidth = w
    this.cssHeight = h
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.dirty = true
  }
}

const canvas = document.getElementById('stage')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('缺少 #stage 画布元素')
}
const stage = new OverlayStage(canvas)
void stage.init()
