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
3. 在环境变量里配置需要的平台 Cookie，例如 `LINUXDO_COOKIES`、`NODESEEK_COOKIE`、`V2EX_COOKIE`、`NAIXI_COOKIE`
4. 运行 `python3 main.py`

如果青龙容器内没有 Chrome / Chromium，LinuxDo 和 NodeSeek 的浏览器回退能力可能不可用；Cookie 有效时优先走 Cookie 模式。

## 环境变量

### LinuxDo

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `LINUXDO_COOKIES` | LinuxDo Cookie 字符串 | 必填，LinuxDo 仅使用 Cookie 执行 |

说明：

- LinuxDo 只使用 `LINUXDO_COOKIES` 执行，不再支持账号密码回退登录
- LinuxDo 默认有头运行；如果 `DISPLAY` 为空且未设置 `LINUXDO_HEADLESS=true`，`scripts/run.sh` 会自动使用 `xvfb-run`

### V2EX

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `V2EX_COOKIE` | V2EX Cookie 字符串 | 配置后自动执行 |

### NodeSeek

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `NODESEEK_COOKIE` | NodeSeek Cookie | 配置后自动执行 |

多账号配置使用编号变量，例如：

```env
NODESEEK_COOKIE_1=nodepay_session=account1_cookie
NODESEEK_COOKIE_2=nodepay_session=account2_cookie
```

### 奶昔论坛

| 变量名 | 用途 | 说明 |
| --- | --- | --- |
| `NAIXI_COOKIE` | 奶昔论坛 Cookie 字符串 | 配置后自动执行 |

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

V2EX_COOKIE=A2=xxx

NODESEEK_COOKIE=nodepay_session=xxx

NAIXI_COOKIE=naixi_6720_saltkey=xxx; naixi_6720_auth=yyy; cf_clearance=zzz

TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_CHAT_ID=123456789
NOTIFY_TIMEZONE=Asia/Shanghai
```

## 实际行为

### LinuxDo

1. 使用 `LINUXDO_COOKIES` 登录
2. 登录成功后校验账号页登录状态
3. 默认执行浏览任务
4. 读取 Connect 信息
5. 发送通知

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

1. 使用 Chromium 打开奶昔论坛并通过站点安全检查
2. 注入 `NAIXI_COOKIE`，跳过 `cf_clearance`、`naixi_6720_lip` 这类 IP 绑定 Cookie
3. 打开 `k_misign-sign.html` 判断今天是否已经签到
4. 如果还未签到，则提取 `JD_sign` 里的签到链接并在浏览器会话里请求
5. 回读签到页确认结果
6. 发送通知，包含排名、连续签到、签到等级、积分奖励和总天数

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
