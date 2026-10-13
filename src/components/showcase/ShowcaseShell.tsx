import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import './showcase.css'

export default function ShowcaseShell({ children }: { children: ReactNode }) {
  const [details, setDetails] = useState(false)
  return <div className="showcase-shell">
    <header className="showcase-bar" aria-label="官网体验导航">
      <a href="/">← 官网</a><strong>项目体验版</strong>
      <span className="showcase-hint">真实项目界面 · AI 生成已关闭</span>
      <nav><Link to="/home/examples">示例作品</Link><a href="/workshop">创意工坊</a><button onClick={() => setDetails(!details)} aria-expanded={details}>体验说明</button><a className="showcase-download" href="https://github.com/yuanbw2025/storyforge" target="_blank" rel="noreferrer">下载项目 ↗</a></nav>
    </header>
    {details && <section className="showcase-explanation"><h2>先看看你的创作空间</h2><p>这是与开源项目共用代码的官网体验版。顶部产品导航可以切换各模块；从“示例作品”阅读小说、剧本、漫画与漫剧制作包，也可以创建体验副本，进入编辑界面。</p><p>API 配置、AI 生成、外部工具和云端上传均关闭。预写游戏仍可体验，实时 AI 对话不开放。手动操作只保存到此浏览器的独立体验空间，不会上传；请勿在这里存放唯一手稿。完整创作请下载项目。</p><button onClick={() => setDetails(false)}>开始探索</button></section>}
    <div className="showcase-app">{children}</div>
    <footer className="showcase-footer"><span>北京悬象科技有限公司</span><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">京ICP备2026061833号-1</a><a href="https://beian.mps.gov.cn/#/query/webSearch?code=11011502040776" target="_blank" rel="noreferrer">京公网安备11011502040776号</a><a href="/privacy">隐私与数据</a></footer>
  </div>
}
