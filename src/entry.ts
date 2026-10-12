import { IS_SHOWCASE } from './lib/showcase/policy'

// Keep app/store imports behind the isolation boundary; static imports run too early.
async function start() {
  if (IS_SHOWCASE) {
    const { installShowcaseBoundary } = await import('./lib/showcase/bootstrap')
    installShowcaseBoundary()
  }
  await import('./main')
}
void start().catch(() => {
  const root = document.getElementById('root')
  if (root) root.textContent = IS_SHOWCASE
    ? '无法打开体验空间。请允许本站使用浏览器存储后刷新，或返回官网获取本地版。'
    : 'StoryForge 加载失败，请刷新页面。作品数据没有被清理。'
})
