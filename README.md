# 提醒事项·随行

让你的 iCloud 提醒事项随身而行。

基于 **uni-app Vue3** 的开源客户端。Android 使用 App 容器，Windows 使用 Electron 承载同一套 Web 产物，鸿蒙通过 UTS 注册独立 ArkWeb 容器。项目使用 MIT 许可证，与 Apple 无隶属关系。

当前是 **0.1.0 最小验证工程**，不是完整替代苹果提醒事项的正式版。登录、双重认证及云端保存继续由 iCloud 官方网页处理。

## 当前能力

- 自己的清单界面：桌面分栏、手机抽屉导航、搜索当前清单、深浅分明的完成状态。
- 中国大陆 `icloud.com.cn` 与其他地区 `icloud.com` 入口分开管理。
- 记住上次选择的服务区域，重新打开界面后恢复；设置只保存区域代码。
- 读取网页当前列表中已经加载的清单、标题、备注、日期及重复规则文字。
- 通过真实记录 ID、页面句柄和内容指纹定位事项，发送完成或取消完成操作。
- Windows 支持编辑标题、编辑或清空多行备注；长备注只显示摘要时禁止覆盖，完整内容在官方页面编辑。
- 日期开发分支增加 Windows 日期与可选时间编辑，全天日期及指定时间已获独立苹果客户端确认；清除日期存在跨会话显示差异，尚未验收，当前遇到不一致会停止编辑并保留官方入口。
- Windows“已完成”页签会请求官方页面显示隐藏的完成项；重复进入不会反转为隐藏，仍只覆盖网页当前已加载内容。
- 顶栏“＋”和 Ctrl+N 在当前清单新增事项；Ctrl+F 搜索当前已加载内容。新事项保留官方自动保存，不在输入后强制失焦。
- 写操作只发送一次；状态不确定时停下核对，不自动重试。
- 明确标识的界面示例，不连接账号，不冒充真实 iCloud 数据。

## 验证边界

| 目标 | 当前范围 |
| --- | --- |
| Windows | 真实新增经官方重载和用户独立苹果客户端核对；独立便携包的登录、完成状态、标题和备注编辑及恢复通过，正常重启免登录；完整日常功能与长期会话待验 |
| Android | uni-app 资源构建、5+ WebView 桥接及生命周期合成回归通过；独立 APK 与真机另行验收 |
| HarmonyOS NEXT | ArkWeb 桥接已接入共用页面，9 项逻辑层回归及 HBuilderX 资源导出通过；原生 ETS/HAP 编译、官方登录与真机仍待验 |
| 普通网页 | 仅界面预览；不使用跨域 iframe 绕过 iCloud 限制 |

详细证据、实际命令与未完成项见 [最小验证记录](docs/最小验证记录.md)。

迁移到其他开发环境时，先阅读 [虚拟机接续说明](docs/虚拟机接续说明.md)。当前仓库是开发检查点，不代表所有验收已经完成。

长期工作流、功能差距与分平台证据台账见[持续目标与验收](docs/持续目标与验收.md)。

## 开发运行

需要 Node.js 22+、HBuilderX 5.34+；Windows 桌面还需要 npm 下载 Electron。HBuilderX 工程固定在 `apps/uni-app`。

```powershell
npm ci
npm test

# 配置本机 HBuilderX CLI 路径，然后导出桌面使用的 Web 产物。
$env:HBX_CLI = 'D:\HBuilderX\cli.exe'
powershell -ExecutionPolicy Bypass -File scripts/hbx.ps1 -Action publish-web
npm run desktop:start
```

打开客户端，选择服务区域，点击“登录 iCloud”。在真正的官方页面自行完成登录与双重认证，回到自己的界面后点击“刷新”。关闭官方页面窗口只会隐藏它；关闭主窗口退出应用。

```powershell
# HBuilderX 界面管理的预览和安卓资源构建。
powershell -ExecutionPolicy Bypass -File scripts/hbx.ps1 -Action web
powershell -ExecutionPolicy Bypass -File scripts/hbx.ps1 -Action android-resource
powershell -ExecutionPolicy Bypass -File scripts/hbx.ps1 -Action harmony-resource

# 需要已连接安卓设备。
powershell -ExecutionPolicy Bypass -File scripts/hbx.ps1 -Action android

# 合成验证与本机 Windows 便携包。
npm run desktop:smoke
npm run desktop:pack
# 已有旧包运行时，使用新的目录名生成，不覆盖旧目录。
npm run desktop:pack -- --name windows-portable-20261104
```

Web 预览地址默认 `http://localhost:5317/`。预览日志和停止按钮在 HBuilderX 的对应运行面板。桌面开发日志在启动终端中，关闭主窗口或在启动终端按 `Ctrl+C` 停止。便携包生成于 `outputs/windows-portable`；为避免覆盖正在运行的程序，打包目标目录必须不存在。

## 目录

```text
apps/uni-app/                  固定 HBuilderX Vue3 工程
  lib/bridge.js                平台适配入口，隔离 Android 专有能力
  lib/android-bridge.js        APP-PLUS 内的窗口、单次请求与中断恢复
  lib/harmony-bridge.js        APP-HARMONY 内的实例、请求与中断恢复
  lib/native-protocol.js       Android/鸿蒙共用的固定命令与回执协议
  uni_modules/suixing-arkweb/   标准 uni-app 使用的 UTS/ETS 原生容器
  static/icloud/adapter.js     各端使用的唯一网页适配源文件
apps/desktop/                  Electron 容器和本地界面的受限桥接
tests/                         合成页面与行为测试
scripts/                       构建、验证和打包入口
docs/                          设计与验证证据
```

## 数据与限制

- 不自建保存 Apple 密码或个人提醒事项的服务器，不导入浏览器登录 Cookie。
- Windows 开发会话放在已忽略的 `.local/desktop-profile`，安装后的应用使用独立系统数据目录；Android 会话由应用自己的 WebView 管理。
- 原电脑曾未能保持登录；虚拟机本次真实登录后，复用同一内置会话目录，正常退出再启动可直接读取，无需再次认证。此结果不代表设备重启或长期会话已通过；是否过期仍由官方决定。
- 远程页面不注入 Node 或 5+ 原生权限，不关闭网页安全检查，不忽略证书错误。
- 当前只读取**网页已加载的当前列表**。隐藏的已完成项、折叠的子任务、按需加载内容可能不在结果中；可在官方页面展开后重新读取。
- 网页状态变化不等于服务器确认。界面明确区分“网页已更新”与云端持久化，真实保存须刷新官方页面核对。
- 暂无离线修改、实时后台同步或通知承诺；重复提醒、共享权限、附件和完整智能列表仍需专项验证。
- 新开发者应在 HBuilderX 中为自己的发行应用申请 AppID，不复用项目维护者的签名与服务配置。
- 不要在 Issue、截图或提交中上传个人清单、账号、Cookie、令牌或证书。

## 技术依据

- [uni-app Windows 宽屏与 Electron 路线](https://uniapp.dcloud.net.cn/tutorial/adapt)
- [uni-app 鸿蒙开发说明：Vue3，且不支持 plus](https://uniapp.dcloud.net.cn/tutorial/run/run-app-harmony.html)
- [HTML5+ WebView 与脚本执行](https://www.html5plus.org/doc/zh_cn/webview.html)
- [Electron 网页容器与子框架](https://www.electronjs.org/docs/latest/api/web-contents)
