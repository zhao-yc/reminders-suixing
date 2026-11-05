# 提醒事项·随行

让你的 iCloud 提醒事项随身而行。

基于 **uni-app Vue3** 的开源客户端。Android 使用 App 容器，Windows 使用 Electron 承载同一套 Web 产物，鸿蒙通过 UTS 注册独立 ArkWeb 容器。项目使用 MIT 许可证，与 Apple 无隶属关系。

当前是 **0.1.0 最小验证工程**，不是完整替代苹果提醒事项的正式版。登录、双重认证及云端保存继续由 iCloud 官方网页处理。

## 当前能力

- 自己的清单界面：桌面分栏、手机抽屉导航、搜索当前清单、深浅分明的完成状态。
- 中国大陆 `icloud.com.cn` 与其他地区 `icloud.com` 入口分开管理。
- 记住上次选择的服务区域，重新打开界面后恢复；设置只保存区域代码。
- Windows“重新连接”在原官方容器返回 iCloud 入口再进入提醒事项，复用现有会话；先读取清单导航，只在名称唯一、页面与选区匹配时读取原清单。名称不唯一时要求重新选择，官方页面阻止离开时保留原窗口并提示核对。
- Windows 连接不可用时保留已读取内容和当前窗口内的草稿，停止写入及重连导航；连接恢复后先手动刷新再编辑，不自动重发。写入前核对连接，状态未知也不提交；公开资源可达不代表提醒事项云端保存已确认。
- Windows 可在侧栏新建清单、在标题旁重命名当前清单；名称只填写并提交一次。颜色与图标在独立编辑器选择，读取官方当前选项，保存前重新核对；当前账号的 12 色与 72 图标已通过读取，专用清单修改与恢复经两个 Windows 会话核对。其他网页版本、未知结构或自定义表情图标保留官方入口。
- Windows 支持明确确认后删除非共享清单，影响其中全部事项（包括未加载内容）；默认取消，官方确认仅提交一次。删除后先选择另一份清单再读取；没有清单时可新建第一份，空账户流程目前为合成验证。
- 读取网页当前列表中已经加载的清单、标题、备注、日期及重复规则文字。
- 通过真实记录 ID、页面句柄和内容指纹定位事项，发送完成或取消完成操作。
- Windows 支持编辑标题、编辑或清空多行备注；长备注只显示摘要时禁止覆盖，完整内容在官方页面编辑。
- Windows 支持普通事项添加/移除旗标，并筛选当前清单已加载的旗标事项；未知状态不猜测，重复事项保留官方编辑入口。
- Windows 支持确认后删除单个普通事项：仅在当前清单完整加载且不超过 80 条、目标无子项及重复规则时开放；默认聚焦取消，结果不确定不自动重试。
- Windows 支持两级事项缩进与提升：先核对官方排他单选和受影响分组，明确确认后仅发送一次快捷键；提升涉及后续同级子项时完整列明影响。当前限最多 80 行的可核对结构，重复规则、未知层级及复杂场景保留苹果端操作。
- 当前账号详情中的清单字段为只读，未开放跨清单移动；[Apple 文档](https://support.apple.com/en-in/guide/icloud/mmc0cd72ef/icloud)说明升级版网页不支持此操作。
- 显示已加载事项的高、中、低优先级；新版 iCloud 网页仅支持查看，请在苹果设备上修改。未知结构明确显示不可读，不当作无优先级。
- Windows 支持日期与可选时间编辑，全天日期及指定时间已获独立苹果客户端确认。行日期字段缺失而仍显示时间时，可只读该事项官方详情并取消；保存前重新核对，保存后再次打开详情验证并取消，冲突不重放。新专用事项的时间设置、清除，以及另一次全天→指定时间→清除流程均获两 Windows 会话确认；原日期中断事项的清除仍待独立核对。
- Windows“已完成”页签会请求官方页面显示隐藏的完成项；重复进入不会反转为隐藏，仍只覆盖网页当前已加载内容。
- 当前清单可按日期、标题或优先级升降序显示，也可恢复清单顺序；子事项跟随主事项，设置仅保存排序模式，不改变云端顺序。Windows 排序菜单支持 Tab 聚焦、回车确认、方向键移动焦点和 Esc 取消。
- 顶栏“＋”和 Ctrl+N 在当前清单新增事项；Ctrl+F 搜索当前已加载内容。新事项保留官方自动保存，不在输入后强制失焦。
- 写操作只发送一次；状态不确定时停下核对，不自动重试。
- 明确标识的界面示例，不连接账号，不冒充真实 iCloud 数据。

## 验证边界

| 目标 | 当前范围 |
| --- | --- |
| Windows | 真实新增经官方重载和用户独立苹果客户端核对；独立包登录、完成状态、标题、备注与单个普通测试事项删除通过，删除经另一 Windows 会话冷启动读回；Mac/iPhone 删除、完整日常功能与长期会话待验 |
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

“刷新”读取当前网页；若其他设备的更改未出现，可手动点击“重新连接”。连接期间停止编辑，失败保留原显示供核对，不自动重新提交事项修改。真实测试曾在重新连接后读到另一 Windows 会话的旗标变化，也已复现官方页面阻止离开的情况；遇到该提示请打开官方页面核对编辑或同步状态。这不代表实时后台同步，日期清除的差异仍未解决。删除清单或重连后需要选择清单时，“刷新”仅更新导航，明确选择后才读取事项。

出现连接不可用提示时，旧内容供查看，未保存草稿只保留在当前窗口。恢复连接后点击“刷新”核对；编辑被中断时先核对结果，再结束本次编辑。客户端不会自动重新提交中断操作，也不把恢复网络当作云端保存成功。

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
