import type { AppConfig } from './types'

/** 准心绘制只需要这几个字段，收窄类型便于在设置界面预览里复用 */
export type CrosshairConfig = Pick<AppConfig, 'crosshairStyle' | 'crosshairColor'>

type Point = [number, number]

export function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  offsetX = 0,
  offsetY = 0
): void {
  ctx.beginPath()
  for (let i = 0; i < points.length; i++) {
    const x = offsetX + points[i][0]
    const y = offsetY + points[i][1]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/** #RRGGBB -> rgba(r,g,b,a)，用于半透明的辉光与描边 */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 画一条线段，先描深色底边再描彩色，保证准心在纯白/纯黑背景上都能看见 */
function strokeSegment(
  ctx: CanvasRenderingContext2D,
  seg: readonly Point[],
  color: string,
  width: number
): void {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.lineWidth = width + 2
  strokePolyline(ctx, seg)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  strokePolyline(ctx, seg)
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number
): void {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.lineWidth = width + 2
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
}

function fillDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.beginPath()
  ctx.arc(x, y, r + 1.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/* ---------------- 三种准心 ---------------- */

/** 手枪：战术样式 —— 细十字 + 圆环 + 中心点，敏捷精准 */
function drawPistol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  spread: number
): void {
  const gap = 6 + spread
  const len = 26
  const th = 2
  const ringR = 20 + spread * 0.6

  ctx.lineCap = 'butt'
  const arms: Point[][] = [
    [
      [x, y - gap],
      [x, y - gap - len]
    ],
    [
      [x, y + gap],
      [x, y + gap + len]
    ],
    [
      [x - gap, y],
      [x - gap - len, y]
    ],
    [
      [x + gap, y],
      [x + gap + len, y]
    ]
  ]
  for (const arm of arms) strokeSegment(ctx, arm, color, th)
  strokeRing(ctx, x, y, ringR, color, 1.5)
  fillDot(ctx, x, y, 1.5, color)
}

/** 火箭筒：粗刻度 + 厚圆环 + 大中心点，强调范围杀伤的厚重感 */
function drawRocket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  spread: number
): void {
  const ringR = 26 + spread
  const tickDist = 13 + spread
  const tickLen = 12
  const th = 3.5

  ctx.lineCap = 'butt'
  const ticks: Point[][] = [
    [
      [x, y - tickDist],
      [x, y - tickDist - tickLen]
    ],
    [
      [x, y + tickDist],
      [x, y + tickDist + tickLen]
    ],
    [
      [x - tickDist, y],
      [x - tickDist - tickLen, y]
    ],
    [
      [x + tickDist, y],
      [x + tickDist + tickLen, y]
    ]
  ]
  for (const tick of ticks) strokeSegment(ctx, tick, color, th)
  strokeRing(ctx, x, y, ringR, color, 3)
  fillDot(ctx, x, y, 2.5, color)
}

/** 能量武器：六边形轮廓 + 四向细线 + 中心辉光，科幻锐利 */
function drawEnergy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  spread: number
): void {
  const r = 16 + spread * 0.8
  const tickIn = r - 9
  const tickOut = r - 2
  const th = 1.6

  ctx.lineCap = 'butt'

  // 六边形轮廓
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = th + 2
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = th
  ctx.stroke()

  // 四向细线
  const ticks: Point[][] = [
    [
      [x, y - tickIn],
      [x, y - tickOut]
    ],
    [
      [x, y + tickIn],
      [x, y + tickOut]
    ],
    [
      [x - tickIn, y],
      [x - tickOut, y]
    ],
    [
      [x + tickIn, y],
      [x + tickOut, y]
    ]
  ]
  for (const tick of ticks) strokeSegment(ctx, tick, color, 1.2)

  // 中心辉光 + 亮点
  const glowR = 9
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR)
  glow.addColorStop(0, withAlpha(color, 0.85))
  glow.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, glowR, 0, Math.PI * 2)
  ctx.fill()
  fillDot(ctx, x, y, 1.8, color)
}

/**
 * 绘制准心。三种样式尺寸固定，用户只能选样式和颜色。
 * @param spread 开火扩散量，由后坐力驱动
 */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cfg: CrosshairConfig,
  spread = 0
): void {
  switch (cfg.crosshairStyle) {
    case 'rocket':
      drawRocket(ctx, x, y, cfg.crosshairColor, spread)
      break
    case 'energy':
      drawEnergy(ctx, x, y, cfg.crosshairColor, spread)
      break
    case 'pistol':
      drawPistol(ctx, x, y, cfg.crosshairColor, spread)
      break
  }
}
