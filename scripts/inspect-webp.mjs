/**
 * 解析 Animated WebP 的容器信息（尺寸 / 帧数 / 时长 / 循环次数 / 是否含 alpha）。
 *
 * 为什么手写：ffmpeg 的 webp_pipe 解复用器读不出动图 WebP 的尺寸和帧数
 * （表现为 width=0、0 frames），而项目需要这些信息来决定缩放比例与播放时长。
 *
 * 用法：node scripts/inspect-webp.mjs assets/*.webp
 */
import { readFileSync } from 'node:fs'

const RIFF = 0
const CHUNK_HEADER = 8

function parseWebP(path) {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return { error: '不是 WebP 文件' }
  }

  const chunks = []
  let p = 12
  while (p + 4 <= buf.length) {
    const fourcc = buf.toString('ascii', p, p + 4)
    if (p + 8 > buf.length) break
    const size = buf.readUInt32LE(p + 4)
    chunks.push({ fourcc, size, data: p + CHUNK_HEADER })
    // RIFF chunk 按 2 字节对齐，奇长补 1
    p += CHUNK_HEADER + size + (size % 2 === 1 ? 1 : 0)
  }

  const info = { chunks: chunks.map((c) => c.fourcc).join(',') }

  const vp8x = chunks.find((c) => c.fourcc === 'VP8X')
  if (vp8x) {
    const flags = buf[vp8x.data]
    info.hasAlpha = ((flags >> 4) & 1) === 1
    info.isAnimated = ((flags >> 1) & 1) === 1
    info.width = buf.readUIntLE(vp8x.data + 4, 3) + 1
    info.height = buf.readUIntLE(vp8x.data + 7, 3) + 1
  }

  // 静态有损：VP8 chunk 头部 6..8 是 14bit 宽，8..10 是 14bit 高
  const vp8 = chunks.find((c) => c.fourcc === 'VP8 ')
  if (vp8 && !vp8x) {
    info.width = buf.readUInt16LE(vp8.data + 6) & 0x3fff
    info.height = buf.readUInt16LE(vp8.data + 8) & 0x3fff
  }

  // 静态无损：VP8L 头 1 字节后紧接 14bit 宽 / 14bit 高
  const vp8l = chunks.find((c) => c.fourcc === 'VP8L')
  if (vp8l && !vp8x) {
    const bits = buf.readUInt32LE(vp8l.data + 1)
    info.width = (bits & 0x3fff) + 1
    info.height = ((bits >> 14) & 0x3fff) + 1
    info.hasAlpha = ((buf[vp8l.data] >> 4) & 1) === 1
  }

  const anim = chunks.find((c) => c.fourcc === 'ANIM')
  if (anim) {
    // ANIM: 4 字节背景色(BGRA) + 2 字节循环次数（0 = 无限）
    info.loopCount = buf.readUInt16LE(anim.data + 4)
  }

  const frames = chunks.filter((c) => c.fourcc === 'ANMF')
  info.frameCount = frames.length > 0 ? frames.length : 1
  if (frames.length > 0) {
    const durations = frames.map((f) => buf.readUIntLE(f.data + 12, 3))
    info.totalMs = durations.reduce((a, b) => a + b, 0)
    info.avgFrameMs = Math.round(info.totalMs / durations.length)
    info.minFrameMs = Math.min(...durations)
    info.maxFrameMs = Math.max(...durations)
  }

  return info
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node scripts/inspect-webp.mjs <file.webp> [...]')
  process.exit(1)
}

for (const file of files) {
  const info = parseWebP(file)
  if (info.error) {
    console.log(`${file}: ${info.error}`)
    continue
  }
  const size = `${info.width}x${info.height}`
  const anim = info.isAnimated ? `动图 ${info.frameCount}帧` : '静态'
  const total = info.totalMs !== undefined ? `${info.totalMs}ms` : '-'
  const loop = info.loopCount === undefined ? '-' : info.loopCount === 0 ? '无限循环' : `${info.loopCount}次`
  console.log(
    `${file}\n  尺寸=${size}  类型=${anim}  总时长=${total}  循环=${loop}  alpha=${info.hasAlpha ? '有' : '无'}` +
      (info.avgFrameMs ? `  帧间隔≈${info.avgFrameMs}ms` : '') +
      `\n  chunks=${info.chunks.slice(0, 60)}`
  )
}
