const https   = require('https');
const express = require('express');
const app     = express();
app.use(express.json());

const EVENT_LABELS = {
  page_view  : '网页打开',
  pwa_install: 'PWA安装',
  calc_click : '计算DDDs及使用强度',
};

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GH_OWNER = process.env.GH_OWNER;
const GH_REPO  = process.env.GH_REPO;
const GH_TOKEN = process.env.GH_TOKEN;
const GH_FILE  = 'data.json';

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'User-Agent'   : 'ddd-stats-fc',
        'Content-Type' : 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loadData() {
  const res = await ghRequest('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`);
  if (res.status === 404) {
    return { counts: { page_view: 0, pwa_install: 0, calc_click: 0 }, logs: [], sha: null };
  }
  const content = Buffer.from(res.body.content, 'base64').toString('utf-8');
  return { ...JSON.parse(content), sha: res.body.sha };
}

async function saveData(data) {
  const { sha, ...payload } = data;
  const content = Buffer.from(JSON.stringify(payload)).toString('base64');
  await ghRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`, {
    message: 'update stats',
    content,
    ...(sha ? { sha } : {}),
  });
}

// CORS 预检
app.options('*', (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  res.sendStatus(204);
});

// POST /track
app.post('/track', async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  const event = (req.body && req.body.event) || '';
  if (!EVENT_LABELS[event]) {
    return res.status(400).json({ error: 'unknown event', received: event });
  }
  const data = await loadData();
  data.counts[event] = (data.counts[event] || 0) + 1;
  data.logs.push({
    event,
    label: EVENT_LABELS[event],
    time : new Date().toISOString().replace('T', ' ').substring(0, 19),
    ua   : ((req.body && req.body.ua) || '').substring(0, 120),
  });
  if (data.logs.length > 2000) data.logs = data.logs.slice(-2000);
  await saveData(data);
  res.json({ ok: true, count: data.counts[event] });
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  const data = await loadData();
  const { sha, ...clean } = data;
  res.json(clean);
});

// GET /report
app.get('/report', async (req, res) => {
  const data   = await loadData();
  const counts = data.counts;
  const recent = (data.logs || []).slice(-20).reverse();

  const rows = recent.length > 0
    ? recent.map(l => `
      <tr>
        <td>${l.time || ''}</td>
        <td>${l.label || EVENT_LABELS[l.event] || l.event}</td>
        <td class="ua">${(l.ua || '').substring(0, 80)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:20px;">暂无数据</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DDD数智通 · 使用统计</title>
<style>
  body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f0f5fa;color:#1a2533;margin:0;padding:20px;}
  h1{font-size:18px;color:#0d2137;margin-bottom:20px;}
  .cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px;}
  .card{background:#fff;border-radius:12px;padding:20px 28px;box-shadow:0 2px 12px rgba(13,33,55,.1);min-width:160px;text-align:center;}
  .card .num{font-size:42px;font-weight:900;color:#f39c12;line-height:1;}
  .card .lbl{font-size:13px;color:#7f8c9a;margin-top:6px;}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(13,33,55,.1);}
  th{background:#0d2137;color:#fff;padding:10px 14px;font-size:13px;text-align:left;}
  td{padding:9px 14px;font-size:12px;border-bottom:1px solid #eef2f7;word-break:break-all;}
  tr:last-child td{border:none;}
  .ua{color:#7f8c9a;font-size:11px;}
  a{color:#2e86c1;text-decoration:none;}
  .hint{font-size:12px;color:#7f8c9a;margin-bottom:12px;}
</style>
</head>
<body>
<h1>🏥 DDD数智通 · 使用统计看板</h1>
<div class="cards">
  <div class="card"><div class="num">${counts.page_view||0}</div><div class="lbl">网页打开次数</div></div>
  <div class="card"><div class="num">${counts.pwa_install||0}</div><div class="lbl">PWA安装次数</div></div>
  <div class="card"><div class="num">${counts.calc_click||0}</div><div class="lbl">计算DDDs次数</div></div>
</div>
<p class="hint">最近20条记录 · <a href="/report">刷新</a></p>
<table>
  <thead><tr><th>时间</th><th>事件</th><th>客户端</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 其他路径重定向
//app.use((req, res) => res.redirect('/report'));
// 其它路径返回
app.use((req, res) => res.send('请访问 /report 查看统计'));

// 启动服务器，端口固定 9000
app.listen(9000, () => console.log('DDD stats server running on port 9000'));