// 极简本地代理 + 静态服务器（零依赖，仅用 Node 内置模块）
// 作用：解决浏览器跨域（CORS）问题，让 jiaoben.html 以同源方式联网拉热搜、调通义千问。
// 运行：  node server.js   （然后浏览器打开 http://localhost:8787）
// API Key：优先页面填写 > config.json 的 dashscopeApiKey > 环境变量 DASHSCOPE_API_KEY

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const HTML_FILE = path.join(__dirname, 'jiaoben.html');

let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const WANX_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const I2I_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation';
const TASK_BASE = 'https://dashscope.aliyuncs.com/api/v1/tasks/';

// 热搜上游（按顺序尝试，前一个失败自动降级）
const HOT_SOURCES = {
  weibo: [
    'https://60s.viki.moe/v2/weibo',
    'https://v2.xxapi.cn/api/weibohot'
  ],
  douyin: [
    'https://60s.viki.moe/v2/douyin',
    'https://v2.xxapi.cn/api/douyinhot'
  ],
  bilibili: [
    'https://v2.xxapi.cn/api/bilibilihot',
    'https://orz.ai/api/v1/dailynews/?type=bilibili'
  ],
  xiaohongshu: [
    'https://api.vvhan.com/api/hotlist/xhsHot',
    'https://api.pearktrue.cn/api/dailyhot/?title=小红书',
    'https://orz.ai/api/v1/dailynews/?type=xiaohongshu'
  ],
  weishi: [
    'https://api.vvhan.com/api/hotlist/wxHot',
    'https://api.pearktrue.cn/api/dailyhot/?title=视频号',
    'https://orz.ai/api/v1/dailynews/?type=视频号'
  ]
};

function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(buf);
}

async function fetchHot(src) {
  const list = HOT_SOURCES[src] || HOT_SOURCES.weibo;
  let lastErr;
  for (const url of list) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      let items = [];
      if (Array.isArray(j.data)) items = j.data;
      else if (Array.isArray(j)) items = j;
      const out = items
        .map(it => {
          if (typeof it === 'string') return { title: it.trim(), hot: '' };
          return {
            title: it && (it.title || it.word || it.name || ''),
            hot: it && (it.hot || it.hot_value || it.index || '')
          };
        })
        .filter(it => it.title)
        .slice(0, 50);
      if (out.length) return out;
      throw new Error('返回数据为空');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('无可用数据');
}

async function qwen(req, res) {
  let body = '';
  await new Promise(r => { req.on('data', c => (body += c)); req.on('end', r); });
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: '请求体不是合法 JSON' }); }

  const apiKey = parsed.apiKey || config.dashscopeApiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey.includes('在此填入')) {
    return sendJSON(res, 400, { error: '缺少通义千问 API Key：请在页面填写，或在 config.json / 环境变量 DASHSCOPE_API_KEY 中配置' });
  }

  const payload = {
    model: parsed.model || 'qwen-plus',
    messages: parsed.messages || [],
    response_format: { type: 'json_object' }
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(payload)
    });
    clearTimeout(t);
    const j = await r.json();
    if (j.error) return sendJSON(res, 502, { error: j.error.message || JSON.stringify(j.error) });
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    sendJSON(res, 200, { content: content || '' });
  } catch (e) {
    sendJSON(res, 502, { error: String((e && e.message) || e) });
  }
}

// 通义万相文生图：创建异步任务 → 轮询 → 下载图片转 base64（同源返回，避免 Canvas 跨域污染）
async function wanx(req, res) {
  let body = '';
  await new Promise(r => { req.on('data', c => (body += c)); req.on('end', r); });
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: '请求体不是合法 JSON' }); }

  const apiKey = parsed.apiKey || config.dashscopeApiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey.includes('在此填入')) {
    return sendJSON(res, 400, { error: '缺少 API Key：请在页面填写，或在 config.json / 环境变量 DASHSCOPE_API_KEY 中配置' });
  }

  try {
    const create = await fetch(WANX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: parsed.model || 'wanx2.1-t2i-turbo',
        input: { prompt: parsed.prompt, negative_prompt: parsed.negative_prompt || '' },
        parameters: { size: parsed.size || '720*1280', n: 1 }
      })
    });
    const cj = await create.json();
    if (cj.error) return sendJSON(res, 502, { error: cj.error.message || JSON.stringify(cj.error) });
    const taskId = cj.output && cj.output.task_id;
    if (!taskId) return sendJSON(res, 502, { error: '未获取到任务ID：' + JSON.stringify(cj).slice(0, 300) });

    let url = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const tr = await fetch(TASK_BASE + taskId, { headers: { 'Authorization': 'Bearer ' + apiKey } });
      const tj = await tr.json();
      const st = tj.output && tj.output.task_status;
      if (st === 'SUCCEEDED') {
        url = tj.output.results && tj.output.results[0] && tj.output.results[0].url;
        break;
      }
      if (st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN') {
        return sendJSON(res, 502, { error: '图像生成失败：' + JSON.stringify(tj.output || tj).slice(0, 300) });
      }
    }
    if (!url) return sendJSON(res, 504, { error: '图像生成超时（超过120秒）' });

    const imgRes = await fetch(url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    sendJSON(res, 200, { image: 'data:image/png;base64,' + buf.toString('base64') });
  } catch (e) {
    sendJSON(res, 502, { error: String((e && e.message) || e) });
  }
}

// 通义万相图生图（i2i）：以用户上传的参考图为基础，保持人物、改写背景/构图
async function wanxI2i(req, res) {
  let body = '';
  await new Promise(r => { req.on('data', c => (body += c)); req.on('end', r); });
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: '请求体不是合法 JSON' }); }

  const apiKey = parsed.apiKey || config.dashscopeApiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey.includes('在此填入')) {
    return sendJSON(res, 400, { error: '缺少 API Key：请在页面填写，或在 config.json / 环境变量 DASHSCOPE_API_KEY 中配置' });
  }
  if (!parsed.image) return sendJSON(res, 400, { error: '缺少参考图（image）' });

  try {
    const create = await fetch(I2I_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: parsed.model || 'wanx2.1-i2i-turbo',
        input: { prompt: parsed.prompt, image: parsed.image },
        parameters: { size: parsed.size || '720*1280', n: 1, strength: parsed.strength || 0.6 }
      })
    });
    const cj = await create.json();
    if (cj.error) return sendJSON(res, 502, { error: cj.error.message || JSON.stringify(cj.error) });
    const taskId = cj.output && cj.output.task_id;
    if (!taskId) return sendJSON(res, 502, { error: '未获取到任务ID：' + JSON.stringify(cj).slice(0, 300) });

    let url = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const tr = await fetch(TASK_BASE + taskId, { headers: { 'Authorization': 'Bearer ' + apiKey } });
      const tj = await tr.json();
      const st = tj.output && tj.output.task_status;
      if (st === 'SUCCEEDED') {
        url = tj.output.results && tj.output.results[0] && tj.output.results[0].url;
        break;
      }
      if (st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN') {
        return sendJSON(res, 502, { error: '图像生成失败：' + JSON.stringify(tj.output || tj).slice(0, 300) });
      }
    }
    if (!url) return sendJSON(res, 504, { error: '图像生成超时（超过120秒）' });

    const imgRes = await fetch(url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    sendJSON(res, 200, { image: 'data:image/png;base64,' + buf.toString('base64') });
  } catch (e) {
    sendJSON(res, 502, { error: String((e && e.message) || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/hot' && req.method === 'GET') {
      const src = u.searchParams.get('src') || 'weibo';
      try {
        const items = await fetchHot(src);
        return sendJSON(res, 200, { source: src, items });
      } catch (e) {
        return sendJSON(res, 502, { error: '热搜拉取失败：' + String((e && e.message) || e) });
      }
    }
    if (u.pathname === '/api/qwen' && req.method === 'POST') {
      return await qwen(req, res);
    }
    if (u.pathname === '/api/wanx' && req.method === 'POST') {
      return await wanx(req, res);
    }
    if (u.pathname === '/api/wanx-i2i' && req.method === 'POST') {
      return await wanxI2i(req, res);
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const html = fs.readFileSync(HTML_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    sendJSON(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => console.log('✅ 服务已启动，浏览器打开： http://localhost:' + PORT));
