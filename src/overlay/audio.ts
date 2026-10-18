/**
 * 枪声合成器 —— 纯 Web Audio 程序化生成，不依赖任何音频素材文件。
 *
 * 为什么不用 wav/mp3 素材：
 *  1. 音效素材有版权风险，分发时容易踩雷；
 *  2. 外部资源需要在打包配置里逐个声明、还要处理运行期路径；
 *  3. 合成方案的延迟更低（噪声 buffer 预生成，开火时只做节点连线）。
 *
 * 声音结构（四层叠加）：
 *  1. body  —— 低通白噪声，频率快速下滑，模拟火药爆燃的主体
 *  2. crack —— 高通白噪声，极短，模拟超音速爆裂的"脆"感
 *  3. thump —— 下滑正弦，模拟低频冲击（胸腔感）
 *  4. tail  —— 延迟反馈网络，模拟环境反射，避免声音太"干"
 */
const NOISE_SECONDS = 1

export class GunAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  /** 已解码的素材音效，key = 武器套装 id */
  private readonly samples = new Map<string, AudioBuffer>()
  private volume = 0.6
  private muted = false

  /**
   * 懒初始化：浏览器的自动播放策略要求 AudioContext 必须在用户手势后创建/恢复，
   * 所以这里放在第一次开火时调用，而不是页面加载时。
   */
  private ensure(): boolean {
    if (this.ctx && this.master && this.noiseBuffer) return true

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false

    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : this.volume
    master.connect(ctx.destination)

    // 预生成一段白噪声，开火时复用，避免每次射击都跑几十万次循环
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1

    this.ctx = ctx
    this.master = master
    this.noiseBuffer = buffer
    return true
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    if (this.master && this.ctx) {
      const target = this.muted ? 0 : this.volume
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02)
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      const target = this.muted ? 0 : this.volume
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02)
    }
  }

  /** 开火：所有节点都是一次性的，播放完自动被 GC */
  fire(): void {
    if (!this.ensure()) return
    const ctx = this.ctx
    const master = this.master
    const noise = this.noiseBuffer
    if (!ctx || !master || !noise) return

    if (ctx.state === 'suspended') void ctx.resume()

    const t = ctx.currentTime

    // 1) 主体爆燃
    const bodySrc = ctx.createBufferSource()
    bodySrc.buffer = noise
    const bodyFilter = ctx.createBiquadFilter()
    bodyFilter.type = 'lowpass'
    bodyFilter.frequency.setValueAtTime(1800, t)
    bodyFilter.frequency.exponentialRampToValueAtTime(320, t + 0.12)
    const bodyGain = ctx.createGain()
    bodyGain.gain.setValueAtTime(0.0001, t)
    bodyGain.gain.exponentialRampToValueAtTime(1, t + 0.004)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    bodySrc.connect(bodyFilter).connect(bodyGain).connect(master)
    bodySrc.start(t)
    bodySrc.stop(t + 0.2)

    // 2) 高频爆裂
    const crackSrc = ctx.createBufferSource()
    crackSrc.buffer = noise
    const crackFilter = ctx.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.value = 2600
    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(0.0001, t)
    crackGain.gain.exponentialRampToValueAtTime(0.7, t + 0.002)
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    crackSrc.connect(crackFilter).connect(crackGain).connect(master)
    crackSrc.start(t)
    crackSrc.stop(t + 0.06)

    // 3) 低频冲击
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(150, t)
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.09)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(0.0001, t)
    thumpGain.gain.exponentialRampToValueAtTime(0.9, t + 0.006)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    thump.connect(thumpGain).connect(master)
    thump.start(t)
    thump.stop(t + 0.14)

    // 4) 环境反射（短延迟 + 反馈）
    const delay = ctx.createDelay(0.5)
    delay.delayTime.value = 0.085
    const feedback = ctx.createGain()
    feedback.gain.value = 0.32
    const wet = ctx.createGain()
    wet.gain.value = 0.26
    delay.connect(feedback).connect(delay)
    bodyGain.connect(delay)
    delay.connect(wet).connect(master)
  }

  /* ---------------- 采样式音效（用户素材） ---------------- */

  /**
   * 解码一个音频素材。
   * 用 decodeAudioData 而不是 <audio> 元素，是为了和合成音共用同一套
   * AudioContext 与音量控制，同时播放延迟更低、连发时可并发。
   * @returns 是否解码成功，失败时调用方应回退到合成音
   */
  async loadSample(name: string, data: ArrayBuffer): Promise<boolean> {
    if (this.samples.has(name)) return true
    if (!this.ensure()) return false
    const ctx = this.ctx
    if (!ctx) return false
    try {
      // decodeAudioData 会接管（detach）传入的 buffer，传副本避免影响调用方
      const decoded = await ctx.decodeAudioData(data.slice(0))
      this.samples.set(name, decoded)
      return true
    } catch (err) {
      console.error(`[audio] 音效解码失败: ${name}`, err)
      return false
    }
  }

  hasSample(name: string): boolean {
    return this.samples.has(name)
  }

  /** 播放素材音效；连发时每次创建独立的 BufferSource，互不干扰 */
  playSample(name: string): void {
    const ctx = this.ctx
    const master = this.master
    const buffer = this.samples.get(name)
    if (!ctx || !master || !buffer) return
    if (ctx.state === 'suspended') void ctx.resume()

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(master)
    src.start()
  }

  dispose(): void {
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.noiseBuffer = null
    this.samples.clear()
  }
}
