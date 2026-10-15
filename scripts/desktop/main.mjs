import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortableServer } from '../distribution/server.mjs'
import { installUpdater } from './updater.mjs'
import updater from 'electron-updater'

const root = dirname(fileURLToPath(import.meta.url))
// This identity, profile and origin are part of the data contract. Never randomize them.
const origin = 'http://localhost:17831'
app.setName('StoryForge')
app.setPath('userData', process.env.STORYFORGE_TEST_USER_DATA || join(app.getPath('appData'), 'StoryForge'))
app.setAppUserModelId('com.storyforge.client')
let window
let server
let exitApproved = false
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { window?.restore(); window?.focus() })
  app.whenReady().then(async () => {
    server = createPortableServer({ webRoot: join(root, '../../dist') })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(17831, '127.0.0.1', resolve) })
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'persistent-storage'))
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 800, minHeight: 600, show: false,
      autoHideMenuBar: true, title: 'StoryForge',
      webPreferences: { preload: join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    })
    function openExternal(url) {
      try {
        const target = new URL(url)
        if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href)
      } catch { /* Invalid links have no OS effect. */ }
    }
    window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' } })
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin + '/storyforge/')) { event.preventDefault(); openExternal(url) }
    })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.on('close', event => {
      if (exitApproved) return
      event.preventDefault()
      void dialog.showMessageBox(window, {
        type: 'question', buttons: ['继续使用', '退出'], defaultId: 0, cancelId: 0,
        message: '退出 StoryForge？', detail: '请先确认编辑已保存、生成任务已结束。退出会中断仍在运行的任务。',
      }).then(({ response }) => { if (response === 1) { exitApproved = true; app.quit() } })
    })
    installUpdater({ app, window, ipcMain, dialog, origin, autoUpdater: updater.autoUpdater, approveExit: () => { exitApproved = true } })
    window.once('ready-to-show', () => window.show())
    await window.loadURL(origin + '/storyforge/')
  }).catch(() => {
    dialog.showErrorBox('StoryForge 无法启动', '无法启动客户端本地服务。请检查端口 17831 是否被占用；为保留作品数据，客户端不会更换地址。')
    exitApproved = true
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => { server?.close(); server?.closeAllConnections() })
}
