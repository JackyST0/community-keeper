<p align="center">
  <img src="icons/icon-128.png" width="96" height="96" alt="Community Keeper 图标">
</p>

<h1 align="center">Community Keeper</h1>

<p align="center">
  一个轻量、本地、透明的个人社区任务辅助扩展。
</p>

<p align="center">
  <a href="https://github.com/JackyST0/community-keeper/releases">
    <img alt="Release" src="https://img.shields.io/github/v/release/JackyST0/community-keeper?color=2f7df6">
  </a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-1746b8">
  <img alt="Local First" src="https://img.shields.io/badge/Local-First-059669">
</p>

Community Keeper 是一个偏个人自用的浏览器扩展，用当前浏览器登录态辅助完成常用社区的日常任务。

它不需要部署服务，不需要手动填写 Cookie，也不会把账号信息上传到第三方。你只需要在浏览器里正常登录对应社区，然后通过扩展弹窗手动触发。

## 为什么做它

很多社区的日常任务本身并不复杂，但如果每个平台都要每天打开、查找入口、点击签到，时间久了就很琐碎。

Community Keeper 的目标很简单：把这些重复操作收进一个轻量、透明、可本地运行的浏览器扩展里。它不会尝试接管你的账号，也不会在后台静默批量运行；每一次执行都由你在当前浏览器里主动触发。

这个项目更适合作为个人本地辅助工具或学习研究用途，不鼓励批量化、商业化或违反社区规则的使用方式。

## 亮点

- 使用当前浏览器登录态，无需复制或填写 Cookie。
- 本地执行，不依赖远程服务器。
- 支持当前站点识别和平台高亮，减少误操作。
- 支持快速打开对应社区，登录后即可执行。
- 支持顺序打开并执行全部平台，方便个人本地使用。
- 支持查看、复制、清空最近执行结果。
- 提供可下载的 Release 压缩包，方便个人安装和备份。

## 支持平台

<p>
  <img src="icons/platforms/v2ex.png" width="22" height="22" alt="V2EX"> <strong>V2EX</strong>：每日登录奖励
</p>

<p>
  <img src="icons/platforms/nodeseek.png" width="22" height="22" alt="NodeSeek"> <strong>NodeSeek</strong>：每日签到
</p>

<p>
  <img src="icons/platforms/linuxdo.png" width="22" height="22" alt="LinuxDo"> <strong>LinuxDo</strong>：登录校验、浏览任务和基础互动
</p>

<p>
  <img src="icons/platforms/naixi.png" width="22" height="22" alt="奶昔论坛"> <strong>奶昔论坛</strong>：每日签到
</p>

## 快速安装

推荐从 [Releases](https://github.com/JackyST0/community-keeper/releases) 下载最新的 `community-keeper-v*.zip`。

1. 下载并解压 `community-keeper-v*.zip`。
2. 打开 Chrome / Edge 的扩展程序管理页。
3. 开启「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择刚刚解压后的目录。

加载成功后，浏览器扩展列表中会出现 Community Keeper 图标。

如果你是开发者，也可以直接克隆仓库后选择项目根目录加载。

## 使用方式

1. 在浏览器中打开目标社区网站。
2. 确认当前账号已经登录。
3. 点击浏览器工具栏中的 Community Keeper。
4. 在弹窗中点击对应平台按钮。
5. 在「最近结果」区域查看执行状态和结果，必要时可点击「复制」保存日志。

为了减少误操作，扩展会识别当前激活标签页并高亮对应平台。如果页面不匹配，会提示先切换到对应网站。

也可以点击平台卡片右侧的「打开」按钮快速打开对应社区，登录后再回到扩展弹窗执行任务。

顶部的「执行全部」会按顺序打开并执行所有已支持平台。它不会并发执行，也不会绕过验证码、安全检查或登录校验；如果某个平台需要手动处理，请先在对应页面完成后再执行。

## 获取方式

这个项目目前主要面向个人本地使用，不依赖 Chrome Web Store。

你可以通过 GitHub Release 下载压缩包；也可以运行下面的脚本生成本地安装包：

```bash
./scripts/package.sh
```

脚本会读取 `manifest.json` 中的版本号，并在 `dist/` 下生成类似 `community-keeper-v0.1.1.zip` 的文件。

## 权限说明

扩展当前使用这些权限：

- `activeTab`：读取当前激活标签页，用来确认你正在操作的平台。
- `scripting`：在目标社区页面中执行任务脚本。
- `storage`：保存最近一次执行状态和日志。
- `tabs`：打开和激活对应平台页面，用于「执行全部」。
- `host_permissions`：允许扩展访问已支持社区的页面和接口。

这些权限只用于执行你在弹窗中手动触发的平台任务。

## 隐私与数据

- 扩展不会把账号信息、Cookie 或执行结果上传到第三方服务。
- 扩展不要求你手动填写 Cookie，只使用当前浏览器里已经存在的登录态。
- 最近执行结果只保存在浏览器本地的扩展存储中，可在弹窗中点击「清空」删除。
- 任务请求只会发往 `manifest.json` 中声明的已支持社区域名。

完整说明见 [隐私政策](PRIVACY.md)。

## 注意事项

- 请仅用于个人账号的日常辅助。
- 执行前需要先在对应网站完成登录。
- 如果网站出现验证码、安全检查或页面结构变化，可能需要先手动处理或等待后续适配。
- 浏览器扩展运行依赖当前页面环境，不等同于后台定时任务。

## 开发

```text
.
├── background.js
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── icons/
├── scripts/
└── platforms/
    ├── linuxdo.js
    ├── naixi.js
    ├── nodeseek.js
    ├── utils.js
    └── v2ex.js
```

修改代码后，在扩展程序管理页点击「重新加载」即可生效。

如果修改了 `manifest.json`、图标或后台脚本，建议同时关闭并重新打开扩展弹窗。

版本变更记录见 [更新日志](CHANGELOG.md)。

## 免责声明

Community Keeper 只用于简化个人日常操作和学习研究。请遵守各社区规则，避免滥用、批量化、商业化或影响社区正常服务。

## 支持项目

如果这个扩展节省了你的时间，欢迎给项目点个 Star。  
也可以自愿请作者喝杯咖啡，你的支持会用于后续维护和兼容性适配。

<details>
<summary>赞赏码</summary>

<p>
  <img src="assets/sponsor-wechat.png" width="220" alt="微信赞赏码">
  <img src="assets/sponsor-alipay.png" width="220" alt="支付宝赞赏码">
</p>

</details>
