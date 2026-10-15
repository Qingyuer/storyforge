# Windows 与 Android 客户端分发

> L4 工程操作说明 · 2026-10-15 · 当前为客户端候选实现，尚未发布新的正式 Release。

## 边界与关联闭包

- 产品：共享运行与分发底座；属于 StoryForge 产品能力研发，不改变作品生产的 S1/S2/S3。
- 交接物：Windows NSIS 安装器、更新元数据、Android APK、构建与校验结果。
- 数据 owner：Work、World 和各产品媒资 owner 沿用现有契约；不新增数据库表、AI 上下文源或 AI 写字段。
- 入口：`scripts/desktop/main.mjs`、Android `MainActivity` → 已有 React 入口 → 原三注册表与 schema。Windows 复用 `createPortableServer()` 与本机 Codex bridge；Android 只适配 HTTPS 流与系统文件保存，不复制模型生成、候选采纳或导入导出链。
- 更新入口：启动后检查、设置中的客户端更新 → 固定 GitHub 仓库 → 用户确认下载 → 完整性校验 → 用户确认安装。更新不读写作品表、不上传作品或 API Key。
- 备份：`downloadJSON()` 继续调用原有备份序列化；Android 保存文件必须收到系统写入结果后，调用方才可继续替换等操作。取消保存应阻断依赖这次备份的操作。

## 构建

使用 Node.js 24 和锁文件安装依赖：

```sh
npm ci
npm run test:clients
npm run build:windows
```

Windows 推荐在 Windows 机器或 `Build Windows and Android Clients` Actions 上构建，输出 `release/windows/StoryForge-<version>-windows-x64-setup.exe`、`latest.yml` 与 `.blockmap`。macOS 交叉构建还依赖 electron-builder 的 Windows 工具运行环境。`npm run desktop:dev` 可启动本机开发窗口。

Android 需要 JDK 21、Android SDK Platform 36，构建工具由当前 Android Gradle Plugin 解析（本地验证使用 Build Tools 35.0.0），设置 `JAVA_HOME`、`ANDROID_HOME`：

```sh
npm run build:android
```

默认得到 `release/android/StoryForge-<version>-android-debug.apk`。测试包的应用 ID 为 `com.storyforge.client.dev`，不参与正式更新。正式包使用固定 `com.storyforge.client`，先提供下列环境变量，再运行：

```sh
npm run build:android:web
node scripts/distribution/build-android.mjs --release
```

| 环境变量 | 含义 |
|---|---|
| `ANDROID_KEYSTORE_PATH` | 本机永久签名文件的绝对路径 |
| `ANDROID_KEYSTORE_PASSWORD` | 签名库密码 |
| `ANDROID_KEY_ALIAS` | 固定密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |

签名文件和密码不得提交 Git。它们需要由维护者另作安全备份；丢失签名通常无法更新已安装 APK。CI 使用 `ANDROID_KEYSTORE_BASE64` 保存签名文件，另外三个同名密码/别名 Secrets；工作流只在临时目录还原并在结束时删除。未配置签名会阻断正式构建，不能改成 debug 签名绕过。

## 更新与发布

1. 版本唯一来源为 `package.json`。Android `versionCode = major × 1,000,000 + minor × 1,000 + patch`；每段 0–999，正式渠道只接受稳定 `x.y.z`。版本必须递增，不要改公式、应用 ID 或签名。
2. 先通过项目既有 CI、E2E、客户端定向检查，并完成两版本覆盖安装与备份恢复验证；正式发版还需维护者确认。
3. 现有 `release.yml` 在便携包和两种客户端都成功后，向同一个 GitHub Release 上传 `.exe`、`.blockmap`、`latest.yml`、`.apk`、便携 ZIP 与 `SHA256SUMS.txt`，最后公开 Release。客户端构建工作流手动执行只生成 Actions artifacts，不公开 Release。
4. 公开后的版本不可覆盖。不要单独提前发布更新元数据，也不要在缺少 Android 包时把 Windows 更新先置为 latest。新版本应使用新 tag 和 release notes。
5. 安装操作先等待现有待保存编辑协调器完成写入，失败则阻断安装。Windows 由 `electron-updater` 检查与下载；禁用自动下载、退出时自动安装、预发布和降级。下载与退出安装各有原生确认窗口。GitHub 下载失败仍可使用当前安装。可通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 接入 Windows 代码签名；未配置时为未签名安装器，系统可能提示未知发布者。
6. Android 只检查固定仓库最新稳定 Release，精确匹配 APK 名称与 URL，验证 GitHub asset SHA-256、APK 包名、递增版本号和当前签名，再调用系统安装器。首次需要用户允许“安装未知应用”。下载或校验失败不得启动安装；用户取消系统安装时旧版保留。

## 数据保持

Windows 固定用户目录 `%APPDATA%/StoryForge`，固定本地地址 `http://localhost:17831/storyforge/`；端口冲突时停止，不改端口。Android 固定 `https://localhost/storyforge/` 和应用 ID。升级不执行清库或卸载；数据库仍由现有 Dexie 发布迁移管理。不要用卸载、清除应用数据、改 origin 或降级来解决升级错误。

浏览器便携版、Windows 客户端、Android 是独立存储容器。首次迁移应在旧版导出完整 JSON，在客户端显式导入。原浏览器数据不会自动移动。应用更新不等于跨设备同步。

Android 禁用系统自动云备份，避免把用户选择保存的密钥交给系统备份；完整备份由用户自行导出。APK 在后台可能被系统终止，长时间生成应保持应用前台；结果不确定时不要自动重发。Android 无法使用电脑上的本机 Codex CLI，也不支持浏览器目录句柄备份；普通模型服务使用 HTTPS。

## 验收与当前限制

- `npm run test:clients`：更新状态、原生确认门、非法 IPC、网络异常、SSE 分块/取消、网页不出现客户端更新入口。
- `node scripts/desktop/smoke.mjs`：独立临时 profile 中启动、renderer 无 Node 权限、重启后 IndexedDB/localStorage 保留。Windows Actions 对真正的解包程序执行此检查。
- Android `testDebugUnitTest`：稳定版本顺序、下载来源白名单与反例。
- Android `:app:connectedDebugAndroidTest`：在隔离模拟器中启动打包 WebView，检查固定 origin、原生插件、HTTPS 限制及 Activity 重建后的 IndexedDB/localStorage；不等于两版本覆盖升级验收。只执行本应用测试，不运行依赖库自带的测试应用。
- 发版前人工/设备验证：旧版保存实际作品与媒资 → 导出备份 → 安装更高版本 → 核对内容与存档 → 重启 → 导入备份；取消安装、网络中断、磁盘不足、签名不匹配均应保留旧版。
- 单元测试和重启探针不等于两版本安装器升级验收。当前还需 Windows 真机与 Android 真机的覆盖升级验收、移动端所有产品的触屏/键盘布局验收，以及首次公开 Release 后的真实 GitHub 更新验证。
- Android 完整 JSON 和数据管理页文本导出已接系统保存；其他专用媒资/独立网页游戏导出入口仍需逐项设备验收，不能因此宣称所有网页能力已完成移动适配。

参考：[Electron 更新](https://www.electron.build/v26/docs/features/auto-update/)、[Capacitor 原生代码](https://capacitorjs.com/docs/android/custom-code)、[Android 签名](https://developer.android.com/studio/publish/app-signing)。
