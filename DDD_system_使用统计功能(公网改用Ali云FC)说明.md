# DDD_system_使用统计功能(公网改用Ali云FC)说明

> 适用场景：Cloudflare Workers 在中国大陆无法访问，迁移至阿里云函数计算 FC + GitHub 存储的完整指南。 费用：**¥0**（阿里云 FC 每月100万次免费调用，GitHub 私有仓库免费）

------

## 架构说明

```
用户浏览器
    ↓  HTTP 请求
阿里云函数计算 FC（新加坡节点）
    ↓  读写 data.json
GitHub 私有仓库（数据库）
```

- **阿里云 FC**：运行统计服务逻辑，提供 `/track`、`/api/stats`、`/report` 三个接口
- **GitHub 私有仓库**：存储一个 `data.json` 文件，充当数据库

------

## 第一步：创建 GitHub 私有仓库

1. 打开 [github.com](https://github.com/)，登录账号
2. 右上角 **"+"** → **New repository**
3. 填写：
   - Repository name：`DDD_UseAliCount`
   - 选择 **Public**（同时在这里发布pages）
   - 勾选 **Add a README file**
4. 点击 **Create repository**

------

## 第二步：获取 GitHub Token

1. 右上角头像 → **Settings**

2. 左侧最底部 → **Developer settings**

3. **Personal access tokens** → **Tokens (classic)**

4. Generate new token (classic)

   ，填写：

   - Note：`ddd-stats`
   - Expiration：**No expiration**
   - 权限：勾选 **`repo`**（第一个大选项，全勾）

5. 点击 **Generate token**，复制保存 `ghp_` 开头的 token（**只显示一次**）

------

## 第三步：创建阿里云函数

1. 打开 [fcnext.console.aliyun.com](https://fcnext.console.aliyun.com/)，注册登录并完成实名认证
2. 点击**创建函数**，选择 **Web 函数**
3. 填写：
   - 函数名称：`ddd-stats-worker`
   - 地域：**新加坡 ap-southeast-1**（无ICP备案必须选境外节点）
   - 运行环境：**Node.js 18**
4. 点击**创建 Web 函数**

------

## 第四步：修改触发器认证方式

函数创建后，默认认证方式为「签名认证」，需改为无需认证：

1. 函数页面 → 底部 **触发器** 标签页
2. 找到 `defaultTrigger` → 点右侧**编辑**
3. 将「认证方式」改为 **无需认证**
4. 保存

------

## 第五步：配置环境变量

函数页面 → 顶部**编辑环境变量** → 添加以下 3 个变量：

| 变量名     | 填入的值                                                     |
| ---------- | ------------------------------------------------------------ |
| `GH_OWNER` | 你的 GitHub 用户名，**注意如果仓库创建在组织下，应该写组织的名字，如我这里的dlyyyy-dop，而不是我的账号adamhtmei** |
| `GH_REPO`  | `DDD_UseAliCount`                                            |
| `GH_TOKEN` | 第二步复制的 `ghp_xxx`                                       |

保存。

------

## 第六步：部署代码

进入函数 → **代码** 标签页，点右上角**配置 WebIDE** 进入编辑器。

### index.js（全部替换）

```javascript
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

app.options('*', (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  res.sendStatus(204);
});

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

app.get('/api/stats', async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  const data = await loadData();
  const { sha, ...clean } = data;
  res.json(clean);
});

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

app.use((req, res) => res.send('请访问 /report 查看统计'));

app.listen(9000, () => console.log('DDD stats server running on port 9000'));
```

### package.json（全部替换）

```json
{
  "name": "ddd-stats-worker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node ./index.js"
  },
  "dependencies": {
    "express": "~4.16.1"
  }
}
```

### 在终端执行

打开终端（Terminal → New Terminal 或 Ctrl + `），执行：

```bash
npm install
```

完成后点右上角**「部署代码」**按钮。

### 验证部署成功

①在浏览器控制台（F12 → Console）粘贴执行：

javascript

```javascript
fetch('https://ddd-stas-worker-wwnumbcyor.ap-southeast-1.fcapp.run/track', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({event: 'page_view', ua: 'test'})
}).then(r => r.json()).then(console.log)
```

如果返回 `{ok: true, count: 1}`，再去 GitHub 仓库刷新，就能看到 `data.json` 了。

②访问以下地址，看到统计看板页面即部署成功：

```
https://你的FC地址/report
```

------

## 第七步：修改前端 HTML

打开 `DDD_system.html`，找到所有 Cloudflare Worker 的地址（`workers.dev` 结尾），替换为新的 FC 地址。

例如：

```javascript
// 改之前
const CF_WORKER_API = "https://ddd-stats-api.adamhtmei.workers.dev"; // 👈 填写你部署好的 CF 真实地址

// 改之后
const CF_WORKER_API = "https://ddd-stas-worker-wwnumbcyor.ap-southeast-1.fcapp.run"
```

------

## 常见报错速查

| 报错信息                     | 原因                         | 解决方法                                              |
| ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| `MissingRequiredHeader`      | 触发器认证方式为「签名认证」 | 改为「无需认证」（第四步）                            |
| `CAExited` / `npm run start` | 代码格式与运行时不兼容       | 使用 Express 格式的 index.js（第六步）                |
| `ExternalRedirectForbidden`  | 免费域名不允许重定向         | 末尾路由改为 `res.send(...)` 而非 `res.redirect(...)` |

------

## 接口说明

| 接口         | 方法 | 说明                            |
| ------------ | ---- | ------------------------------- |
| `/track`     | POST | 上报事件，body: `{ event, ua }` |
| `/api/stats` | GET  | 获取全量统计数据（JSON）        |
| `/report`    | GET  | 可视化统计看板（HTML页面）      |

支持的事件类型：`page_view`、`pwa_install`、`calc_click`