import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * electron-vite 三段式配置：
 *  - main    : Electron 主进程（Node 环境）
 *  - preload : 预加载脚本（隔离上下文，桥接 IPC）
 *  - renderer: 渲染进程（浏览器环境），本项目有两个入口
 *      - overlay  : 全屏透明覆盖层，负责准心与击穿动效
 *      - settings : React 设置界面
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/overlay/index.html'),
          settings: resolve(__dirname, 'src/settings/index.html')
        }
      }
    }
  }
})
