/**
 * 生成 build/icon.ico —— 零第三方依赖。
 *
 * 为什么手写：打包 Windows 应用必须提供 .ico（NSIS 安装包、exe 图标、托盘图标都依赖它）。
 * 装 sharp / pngjs 之类只为生成一张图标不划算，且国内网络下这些包常带二进制下载失败。
 * 这里直接用 Node 内置 zlib 构造 PNG，再按 ICO 规范封装一层目录头即可。
 *
 * 用法：npm run gen:icon
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = 256
const OUT = resolve(__dirname, '../build/icon.ico')

/* ---------- CRC32 ---------- */
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/* ---------- PNG ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/**
 * 按覆盖率采样绘制一个像素的 alpha，实现简易抗锯齿。
 * @param {number} fx 亚像素坐标
 * @param {number} fy 亚像素坐标
 * @returns {number} 0..1 覆盖率
 */
function coverageAt(fx, fy) {
  const c = SIZE / 2
  const dx = fx - c
  const dy = fy - c
  const dist = Math.hypot(dx, dy)

  let hit = false
  // 外圈圆环
  if (Math.abs(dist - 86) <= 11) hit = true
  // 四向准心线（中间留出 gap，避免盖住中心点）
  const lineW = 9
  const gap = 26
  const reach = 74
  if (!hit) {
    if (Math.abs(dx) <= lineW && Math.abs(dy) >= gap && Math.abs(dy) <= reach) hit = true
    if (Math.abs(dy) <= lineW && Math.abs(dx) >= gap && Math.abs(dx) <= reach) hit = true
  }
  // 中心圆点
  if (!hit && dist <= 9) hit = true
  return hit ? 1 : 0
}

function buildPng() {
  // 每个像素 2x2 采样做抗锯齿
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  let p = 0
  for (let y = 0; y < SIZE; y++) {
    raw[p++] = 0 // filter type: None
    for (let x = 0; x < SIZE; x++) {
      let a = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          a += coverageAt(x + (sx + 0.5) / 2, y + (sy + 0.5) / 2)
        }
      }
      a /= 4
      // 准心颜色：#FF3B30（红），带深色描边由 alpha 渐变自然形成
      raw[p++] = 0xff // R
      raw[p++] = 0x3b // G
      raw[p++] = 0x30 // B
      raw[p++] = Math.round(a * 255) // A
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0) // width
  ihdr.writeUInt32BE(SIZE, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- ICO ---------- */
function buildIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count

  const entry = Buffer.alloc(16)
  entry[0] = 0 // width: 0 表示 256
  entry[1] = 0 // height: 0 表示 256
  entry[2] = 0 // palette size
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8) // data size
  entry.writeUInt32LE(22, 12) // data offset = 6 + 16

  return Buffer.concat([header, entry, png])
}

const png = buildPng()
const ico = buildIco(png)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, ico)
console.log(`[gen-icon] wrote ${OUT} (${ico.length} bytes, png ${png.length} bytes)`)
