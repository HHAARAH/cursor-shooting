import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppConfig, type ShotEvent, type ShootingAPI } from '../../src/shared/types'

/**
 * preload：在隔离上下文中通过 contextBridge 暴露最小可用 API。
 * 渲染进程拿不到 ipcRenderer 本体，只能拿到这里定义的方法 —— 这是安全边界。
 */
const api: ShootingAPI = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_GET),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_SET, patch),

  onConfigChanged: (listener: (config: AppConfig) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, config: AppConfig): void => listener(config)
    ipcRenderer.on(IPC.CONFIG_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.CONFIG_CHANGED, handler)
    }
  },

  getMode: (): Promise<boolean> => ipcRenderer.invoke(IPC.MODE_GET),
  setMode: (active: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.MODE_SET, active),

  onModeChanged: (listener: (active: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, active: boolean): void => listener(active)
    ipcRenderer.on(IPC.MODE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.MODE_CHANGED, handler)
    }
  },

  notifyShot: (x: number, y: number): void => {
    ipcRenderer.send(IPC.SHOT, x, y)
  },

  onShot: (listener: (event: ShotEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: ShotEvent): void => listener(payload)
    ipcRenderer.on(IPC.SHOT, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SHOT, handler)
    }
  },

  openSettings: (): void => {
    ipcRenderer.send(IPC.OPEN_SETTINGS)
  },

  quitApp: (): void => {
    ipcRenderer.send(IPC.QUIT)
  },

  setOpenAtLogin: (enabled: boolean): void => {
    ipcRenderer.send(IPC.SET_OPEN_AT_LOGIN, enabled)
  },

  refitOverlays: (): void => {
    ipcRenderer.send(IPC.REFIT)
  },

  validateAccelerator: (accelerator: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.ACCEL_VALIDATE, accelerator),

  getShotCount: (): Promise<number> => ipcRenderer.invoke(IPC.STATS_GET),

  loadSound: (file: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke(IPC.SOUND_GET, file)
}

contextBridge.exposeInMainWorld('shooting', api)
