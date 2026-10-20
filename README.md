# 短视频爆款脚本生成器

联网热搜 + 通义千问 AI 生成脚本 + 通义万相封面（支持上传真人参考图）。
前端 `jiaoben.html` 经同源 `/api/*` 调用后端代理，后端负责转发 DashScope（通义千问 / 通义万相）与多个免费热搜接口，解决浏览器跨域（CORS）问题。

> ⚠️ 按需求，**通义千问 API Key 已明文写入 `config.json` 并随仓库提交**（仅本机/受控使用）。若仓库设为 Public，Key 会公开暴露，任何人可消耗你的 DashScope 额度。想改用环境变量 `DASHSCOPE_API_KEY`，需先把 `config.json` 里的 key 清空——当前优先级为「页面填写 > config.json > 环境变量」，config 有值时 env 不生效。

## 本地运行

```bash
cd short-video-script-generator
node server.js
# 浏览器打开 http://localhost:8787
```

- 端口：`process.env.PORT` 或默认 `8787`。
- API Key 优先级：页面填写 > `config.json` 的 `dashscopeApiKey` > 环境变量 `DASHSCOPE_API_KEY`。

## 部署到外网（GitHub + 托管平台）

本仓库是标准 Node 服务，`node server.js` 监听 `process.env.PORT` 即可。任选其一：

### 方式 A：Railway / Render（推荐，零改造）
1. 把本仓库推到 GitHub（Public 或 Private 均可）。
2. 在 Railway / Render 新建项目 → Import from GitHub → 选本仓库。
3. Start Command 填 `node server.js`，端口用平台提供的 `PORT` 环境变量。
4. 部署完成后获得 `https://xxx.railway.app` / `https://xxx.onrender.com` 外网地址，直接访问即用。

### 方式 B：Vercel
Vercel 默认不跑长驻 Node 服务，需把 `server.js` 的 4 个路由改成 `api/` 下的 Serverless 函数（可后续追加）。如选 Vercel，告诉我，我再补 `api/*.js` 与 `vercel.json`。

### 方式 C：Fly.io / 任意云主机
`node server.js` + 反向代理到 443 即可，配置 `PORT` 环境变量。

## 功能
- 双模式：本地素材库（离线）/ 联网热搜 + AI 展开。
- 热搜来源：微博、抖音、B站、小红书、视频号（后两者免费接口不稳定，失败可用「手动粘贴热点」兜底）。
- 生成数量默认 1，热搜默认不勾选。
- 通义千问按「12秒4拍」公式生成脚本（分镜由 AI 自由生成，非固定模板），口播结尾随机不重样。
- 封面：上传真人参考图直接做背景（人物不造假），或勾选万相 AI 按参考图精修；千问产出 5 套文案，Canvas 合成 1080×1440 可下载封面。

## 文件
- `jiaoben.html`：主页面。
- `server.js`：本地代理 + 静态服务器（零依赖，仅 Node 内置模块）。
- `config.json`：通义千问 API Key 配置（明文，可改用环境变量）。
- `package.json`：部署描述。
