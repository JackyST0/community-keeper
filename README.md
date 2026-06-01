# community-keeper

一个用于自动执行论坛日常任务的 Python 项目，当前只保留并支持这些能力：

- LinuxDo 登录校验、浏览任务、Connect 信息采集
- V2EX 每日签到
- NodeSeek 每日签到
- 奶昔论坛每日签到
- Telegram 通知
- Docker Compose 一条命令运行
- Web 管理后台，可编辑 Cookie/env、查看日志、手动触发运行

建议仅用于个人账号的自动化辅助，不建议滥用、多线程批量刷站或批量养号。

## 项目结构

当前仓库只保留与运行能力直接相关的文件：

- `main.py`：统一入口，按配置顺序执行 LinuxDo、V2EX、NodeSeek、奶昔论坛
- `core/*`：通用任务结果和运行器
- `tasks/*`：社区任务包装层与新社区接入位置
- `v2ex.py`：V2EX Cookie 签到
- `nodeseek.py`：NodeSeek Cookie 签到
- `notify.py`：Telegram / Gotify / ServerChan3 / wxpush 通知
- `web/*`：Web 管理后台
- `scripts/run.sh`：容器内任务运行入口
- `docker-compose.yml`：Docker Compose 部署入口

## 支持能力

### LinuxDo

- 支持 `Cookie` 登录
- 推荐第一版使用 `Cookie` 登录
- 可选账号密码登录和 `Cookie -> 账号密码` 自动回退
- 登录后可自动浏览主题、随机滚动、尝试点赞
- 会抓取 `https://connect.linux.do/` 的汇总信息并写入通知
- 支持把刷新后的 `LINUXDO_COOKIES` 自动回写到 env 文件

### V2EX

- 使用 `Cookie` 完成 `/mission/daily` 签到
- 成功通知中会带上：
  - 今日签到获得多少铜币
  - 当前余额多少铜币

### NodeSeek

- 支持 `Cookie` 登录
- 推荐第一版使用 `Cookie` 登录
- 支持多账号顺序执行
- 成功通知中会带上：
  - 今日签到获得多少鸡腿
  - 当前总鸡腿
  - 连续签到天数
- 支持把刷新后的 Cookie 自动回写到对应 env 变量

### 奶昔论坛

- 使用 `Cookie` 完成 `k_misign` 每日签到
- 会自动读取签到页里的 `formhash` 和真实签到链接
- 已签到时不会重复提交
- 成功通知中会带上：
  - 签到排名
  - 连续签到天数
  - 签到等级
  - 积分奖励
  - 总签到天数

## 快速开始

### 本地运行

```bash
git clone <your-repo-url>
cd community-keeper
python -m venv .venv
.venv/bin/pip install -r requirements.txt
python main.py
```

Windows 下请自行替换为对应的虚拟环境命令。

### Docker Compose 运行

```bash
docker compose up -d --build
```

默认后台地址：

```text
http://你的服务器 IP:8765
```

默认后台账号密码：

```text
admin
123456
```

### 青龙运行

`main.py` 顶部已带青龙可识别的 cron 注释，第一版建议在青龙里使用 Cookie 模式：

1. 在青龙面板添加本仓库订阅，或把项目文件放到青龙脚本目录
2. 在依赖管理里安装 `requirements.txt` 中的 Python 依赖
3. 在环境变量里配置需要的平台 Cookie，例如 `LINUXDO_COOKIES`、`NODESEEK_COOKIE`、`V2EX_A2`、`NAIXI_COOKIE`
4. 运行 `python3 main.py`

如果青龙容器内没有 Chrome / Chromium，LinuxDo 和 NodeSeek 的浏览器回退能力可能不可用；Cookie 有效时优先走 Cookie 模式。

## 环境变量

### LinuxDo

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `LINUXDO_COOKIES` | LinuxDo Cookie 字符串 | 推荐配置 |
| `LINUXDO_USERNAME` | LinuxDo 用户名或邮箱 | 可选，Cookie 失效后的回退登录 |
| `LINUXDO_PASSWORD` | LinuxDo 密码 | 可选，Cookie 失效后的回退登录 |
| `BROWSE_ENABLED` | 是否执行浏览任务 | 默认 `true` |
| `LINUXDO_HEADLESS` | 是否无头运行 LinuxDo 浏览器 | 默认 `false` |
| `LINUXDO_ENV_FILE` | 本地 env 文件路径 | 默认 `/etc/community-keeper.env` |
| `LINUXDO_USER_DATA_DIR` | CloakBrowser 持久化资料目录 | 可选，用于复用浏览器登录态 |
| `LINUXDO_SOLVER_TYPE` | 验证码方案 | 当前使用 `yescaptcha` |
| `CLIENT_KEY` | LinuxDo YesCaptcha key | 可选，兼容旧名 `CLIENTT_KEY` |
| `LINUXDO_YESCAPTCHA_API_BASE_URL` | YesCaptcha 接口地址 | 默认 `https://api.yescaptcha.com` |
| `LINUXDO_YESCAPTCHA_ADVANCED` | YesCaptcha 高级模式 | 可选，默认关闭 |
| `LINUXDO_YESCAPTCHA_HCAPTCHA_MAX_RETRIES` | LinuxDo hCaptcha 最大轮询次数 | 可选，默认 `45` |
| `LINUXDO_YESCAPTCHA_HCAPTCHA_RETRY_INTERVAL` | LinuxDo hCaptcha 轮询间隔（秒） | 可选，默认 `4` |
| `LINUXDO_YESCAPTCHA_HCAPTCHA_TIMEOUT` | LinuxDo hCaptcha 单次请求超时（秒） | 可选，默认 `600` |

说明：

- 第一版建议只配置 `LINUXDO_COOKIES`，先观察 Cookie 实际过期周期
- 如果同时配置了 `LINUXDO_COOKIES` 和账号密码，会优先使用 Cookie
- Cookie 失效后才会尝试账号密码登录；验证码场景需要额外配置 YesCaptcha
- 如果配置 `LINUXDO_USER_DATA_DIR`，LinuxDo 会复用同一个 CloakBrowser profile，有助于降低频繁复制 Cookie 带来的登录态不稳定
- 如果设置 `LINUXDO_HEADLESS=true`，`main.py` 会以无头模式运行 LinuxDo；遇到 Cloudflare / 验证码不稳定时可临时改回有头模式排查
- LinuxDo 的 hCaptcha 默认会按 `45` 次重试、每次间隔 `4` 秒、单次请求超时 `600` 秒执行，不配置也会生效
- LinuxDo 默认有头运行；如果 `DISPLAY` 为空且未设置 `LINUXDO_HEADLESS=true`，`scripts/run.sh` 会自动使用 `xvfb-run`

### V2EX

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `V2EX_ENABLED` | 是否启用 V2EX 任务 | 默认会根据 Cookie 自动判断 |
| `V2EX_COOKIE` | 完整 Cookie 字符串 | 优先级高于 `V2EX_A2` |
| `V2EX_A2` | 只提供 `A2` Cookie | 更简洁的写法 |

### NodeSeek

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `NODESEEK_ENABLED` | 是否启用 NodeSeek 任务 | 默认会根据账号配置自动判断 |
| `NODESEEK_RANDOM` | 签到接口是否附带随机参数 | 默认 `true` |
| `NODESEEK_HEADLESS` | NodeSeek 浏览器是否无头运行 | 默认 `true`，本地排查可设为 `false` |
| `NODESEEK_IMPERSONATE` | 请求指纹 | 默认 `chrome136` |
| `NODESEEK_ACCOUNT_DELAY_SECONDS` | 多账号之间的等待秒数 | 默认 `300`，可设为 `0` 关闭 |

单账号配置：

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `NODESEEK_NAME` | 通知中的账号名 | 可选 |
| `NODESEEK_COOKIE` | NodeSeek Cookie | 推荐配置 |

多账号配置使用编号变量，例如：

```env
NODESEEK_NAME_1=main
NODESEEK_COOKIE_1=nodepay_session=account1_cookie

NODESEEK_NAME_2=backup
NODESEEK_COOKIE_2=nodepay_session=account2_cookie
```

### 通知

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `NOTIFY_TIMEZONE` | 通知时间时区 | 默认 `Asia/Shanghai` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | Telegram 通知 |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID | Telegram 通知 |
| `GOTIFY_URL` | Gotify 服务地址 | Gotify 通知 |
| `GOTIFY_TOKEN` | Gotify Token | Gotify 通知 |
| `SC3_PUSH_KEY` | ServerChan3 SendKey | ServerChan3 通知 |
| `WXPUSH_URL` | wxpush 服务地址 | wxpush 通知 |
| `WXPUSH_TOKEN` | wxpush Token | wxpush 通知 |

### Web 管理后台

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | 后台用户名 | 默认 `admin` |
| `ADMIN_PASSWORD` | 后台明文密码 | Docker Compose 快速启动默认 `123456` |
| `ADMIN_PASSWORD_HASH` | 后台密码哈希 | 使用 `python -m web.security 'your-password'` 生成 |
| `ADMIN_SESSION_SECRET` | 登录 session 签名密钥 | 建议设置长随机字符串 |
| `ADMIN_COOKIE_SECURE` | 是否只通过 HTTPS 发送登录 Cookie | 公网 HTTPS 下保持 `true` |
| `COMMUNITY_KEEPER_RUNTIME` | 后台运行控制模式 | Docker Compose 使用 `process` |
| `COMMUNITY_KEEPER_ENV_FILE` | 后台读写的 env 文件路径 | 默认 `/data/community-keeper.env` |
| `COMMUNITY_KEEPER_LOG_FILE` | process 模式任务日志 | Docker Compose 示例使用 `/var/log/community-keeper/run.log` |
| `COMMUNITY_KEEPER_RUN_TIME` | Docker Compose 定时运行时间 | 默认 `00:10` |

## 配置示例

### 常用组合

```env
LINUXDO_COOKIES=_t=xxx; _forum_session=yyy; cf_clearance=zzz
# 可选：Cookie 失效后的账号密码回退
# LINUXDO_USERNAME=your_username_or_email
# LINUXDO_PASSWORD=your_password

V2EX_ENABLED=true
V2EX_A2=your_v2ex_a2

NODESEEK_ENABLED=true
NODESEEK_HEADLESS=true
NODESEEK_NAME=main
NODESEEK_COOKIE=nodepay_session=xxx

NAIXI_COOKIE=naixi_6720_saltkey=xxx; naixi_6720_auth=yyy; cf_clearance=zzz

TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_CHAT_ID=123456789
NOTIFY_TIMEZONE=Asia/Shanghai
```

## 实际行为

### LinuxDo

1. 优先使用 `LINUXDO_COOKIES`
2. 如果 Cookie 失效，且配置了账号密码，则尝试账号密码登录
3. 登录成功后校验账号页登录状态
4. 默认执行浏览任务；如果显式设置 `BROWSE_ENABLED=false`，则跳过浏览任务
5. 读取 Connect 信息
6. 发送通知

### V2EX

1. 打开 `/mission/daily`
2. 判断今天是否已经签到
3. 如未签到则执行领取
4. 读取 `/balance`
5. 发送通知

### NodeSeek

1. 对每个账号按顺序执行
2. 使用 Cookie 进入浏览器会话
3. 执行签到
4. 优先用已登录的浏览器会话读取 credit 历史，统计今日鸡腿和当前总鸡腿；如果摘要接口仍失败，签到结果仍按成功处理
5. 读取账号概览信息，包括等级、星辰、主题帖、评论数、粉丝、通知和收藏
6. 发送通知

### 奶昔论坛

1. 打开 `k_misign-sign.html`
2. 判断今天是否已经签到
3. 如果还未签到，则提取 `JD_sign` 里的签到链接并请求
4. 回读签到页确认结果
5. 发送通知，包含排名、连续签到、签到等级、积分奖励和总天数

## FAQ

### 为什么 Telegram 发不出去

通常是下面几种原因：

- `TELEGRAM_BOT_TOKEN` 写错
- `TELEGRAM_CHAT_ID` 写成了 Bot Token
- 你还没有先给 Bot 发过消息
- 群组没有把 Bot 拉进去

## 依赖

当前 Python 依赖：

```text
DrissionPage==4.1.0.18
tabulate==0.9.0
loguru==0.7.2
curl-cffi
bs4
cloakbrowser
fastapi
uvicorn
jinja2
python-multipart
itsdangerous
```

## 部署

```bash
git clone https://github.com/JackyST0/community-keeper.git
cd community-keeper
docker compose up -d --build
```
