import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * 素材根目录：
 *  - 开发：项目根/assets
 *  - 打包：resources/assets（由 electron-builder 的 extraResources 拷入，不进 asar）
 *
 * 目前素材只有音效（手枪为程序合成音，无需文件），特效与残留全部是 Canvas 程序化绘制。
 */
export function assetsRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'assets')
  return join(app.getAppPath(), 'assets')
}

/**
 * 读取一个音效文件的原始字节。
 * @returns ArrayBuffer，读取失败时返回 null（调用方据此回退到合成音）
 */
export function readSound(name: string): ArrayBuffer | null {
  // 路径穿越防护：只允许 sounds/ 下的单层文件名
  if (
    name.length === 0 ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    !/\.(wav|mp3|ogg|m4a)$/i.test(name)
  ) {
    return null
  }
  try {
    const buf = readFileSync(join(assetsRoot(), 'sounds', name))
    // Buffer 可能复用共享内存池，必须切出独立的 ArrayBuffer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch (err) {
    console.error(`[assets] 音效读取失败: ${name}`, err)
    return null
  }
}
