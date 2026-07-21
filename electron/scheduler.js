import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import OpenAI from 'openai';
import { sendGmailMessage } from './gmail.js';

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function write(file, items) { fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8'); }
function isSafeRunCommand(command) { return /^(npm\s+(run\s+)?(dev|start|test|build)|node\s+[^&|]+|python\s+[^&|]+)$/i.test(String(command || '').trim()); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
function decodeHtml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'"); }
function cleanFeedText(value) { return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseNews(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 10).map((match) => {
    const item = match[1];
    const value = (tag) => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    return { title: cleanFeedText(value('title')), link: decodeHtml(value('link')).trim(), date: cleanFeedText(value('pubDate')), description: cleanFeedText(value('description')).slice(0, 500) };
  }).filter((item) => item.title && item.link);
}
async function fetchRss(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'PixelPaws/1.0 news reader' } });
  if (!response.ok) throw Error('News source could not be reached.');
  return parseNews(await response.text());
}
async function getNews(topic, count = 3) {
  const query = encodeURIComponent(topic);
  const urls = [
    'https://news.google.com/rss/search?q=' + query + '&hl=en-IN&gl=IN&ceid=IN:en',
    'https://www.bing.com/news/search?q=' + query + '&format=rss',
  ];
  const results = await Promise.allSettled(urls.map(fetchRss));
  const articles = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const unique = [];
  const seen = new Set();
  for (const article of articles) {
    const key = article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!seen.has(key)) { seen.add(key); unique.push(article); }
  }
  const selected = unique.slice(0, Math.max(3, Math.min(10, Number(count) || 3)));
  if (!selected.length) throw Error('No recent news was found for this topic.');
  return selected;
}
async function summarizeNews(topic, articles) {
  const source = articles.map((item, index) => `${index + 1}. ${item.title}\n${item.description}\nSource URL: ${item.link}`).join('\n\n');
  if (!process.env.OPENAI_API_KEY) return `Daily news summary: ${topic}\n\n${articles.map((item, index) => `${index + 1}. ${item.title}\n${item.description || 'Open the source for the full article.'}\nSource: ${item.link}`).join('\n\n')}\n\nDemo mode: add an OpenAI API key for an AI-written summary.`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', messages: [{ role: 'user', content: `Create a concise daily news digest about ${topic}. Start with a 2-3 sentence overall summary. Then cover exactly these ${articles.length} articles in numbered sections. For every article include its title, a short explanation of why it matters, and exactly one Source URL. Use only the supplied details and do not invent facts.\n\n${source}` }], max_completion_tokens: 1000 });
  return String(result.choices[0]?.message?.content || source).trim();
}
function escapeHtml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function buildNewsHtml(topic, summary, articles) {
  const cards = articles.map((item, index) => `<li style="margin:0 0 22px"><h3 style="margin:0 0 6px;color:#183b56">${index + 1}. ${escapeHtml(item.title)}</h3><p style="margin:0 0 7px;line-height:1.5;color:#334155">${escapeHtml(item.description || 'Read the source for the full article.')}</p><a href="${escapeHtml(item.link)}" style="color:#1769aa">Read source article</a></li>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:720px;margin:24px auto;background:#fff;border:1px solid #dce4ee;border-radius:12px;overflow:hidden"><div style="padding:24px;background:#102338;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9df0d7">PixelPaws</div><h1 style="margin:8px 0 0;font-size:26px">Daily news summary</h1><p style="margin:8px 0 0;color:#d7e5f2">${escapeHtml(topic)}</p></div><div style="padding:24px"><h2 style="margin:0 0 8px;color:#183b56">Summary</h2><p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(summary)}</p><h2 style="margin:28px 0 12px;color:#183b56">${articles.length} selected articles</h2><ol style="padding-left:22px">${cards}</ol><p style="margin-top:28px;color:#718096;font-size:12px">Sources were collected from Google News RSS and Bing News RSS.</p></div></div></body></html>`;
}
async function sendNewsEmail(task) {
  const to = String(task.emailTo || '').trim();
  if (!validEmail(to)) throw Error('Enter a valid recipient email address.');
  const topic = String(task.newsTopic || task.content || 'technology and AI news').trim().slice(0, 200);
  const articles = await getNews(topic, task.newsCount || 3);
  const summary = await summarizeNews(topic, articles);
  const text = `PixelPaws daily news summary: ${topic}\n\n${summary}\n\nSources:\n${articles.map((item, index) => `${index + 1}. ${item.title}\n${item.link}`).join('\n\n')}`;
  const html = buildNewsHtml(topic, summary, articles);
  await sendGmailMessage({ to, subject: `PixelPaws daily news: ${topic}`, text, html });
  return `Sent a structured ${articles.length}-article news summary to ${to}.`;
}
async function runTask(task) {
  if (task.kind === 'vscode') {
    let target = path.resolve(task.filePath || 'scheduled-note.txt');
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'scheduled-note.txt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, task.content || '', 'utf8');
    const commands = process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'bin', 'code.cmd')] : ['code'];
    const command = commands.find((candidate) => fs.existsSync(candidate));
    if (!command) throw Error('VS Code was not found. Install VS Code or add its command to PATH.');
    await new Promise((resolve, reject) => { const child = spawn(command, ['--new-window', target], { detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', (error) => reject(error.code === 'ENOENT' ? Error('VS Code was not found. Install VS Code or add its command to PATH.') : error)); child.once('spawn', () => { child.unref(); resolve(); }); });
    if (task.command) {
      if (!isSafeRunCommand(task.command)) throw Error('Only safe npm, node, or python project commands can be scheduled.');
      const runner = process.platform === 'win32' ? 'cmd.exe' : 'sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', task.command] : ['-lc', task.command];
      await new Promise((resolve, reject) => { const child = spawn(runner, args, { cwd: path.dirname(target), detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
      return 'Opened VS Code, wrote ' + target + ', and started: ' + task.command;
    }
    return 'Opened VS Code and wrote ' + target;
  }
  if (task.kind === 'gmail') return sendNewsEmail(task);
  return 'Unknown scheduled task.';
}
export function startScheduler(file, onRun = () => {}) {
  let items = read(file);
  let timer;
  const save = () => write(file, items);
  const tick = async () => {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const today = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    for (const task of items) {
      if (!task.enabled || task.time !== time || task.last_run_date === today) continue;
      task.last_run_date = today;
      task.updated_at = new Date().toISOString();
      try { task.last_result = await runTask(task); task.last_status = 'completed'; }
      catch (error) { task.last_result = error.message; task.last_status = 'failed'; task.last_run_date = ''; }
      save();
      onRun({ ...task });
    }
  };
  timer = setInterval(tick, 30000);
  tick().catch(() => {});
  return {
    list: () => items,
    saveTask: (input) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || ''))) throw Error('Choose a valid time in HH:MM format.'); if (input.kind === 'gmail' && !validEmail(input.emailTo)) throw Error('Enter a valid recipient email address.'); const now = new Date().toISOString(); const task = { id: randomUUID(), title: input.title || 'Scheduled task', time: input.time, kind: input.kind || 'vscode', filePath: input.filePath || '', content: input.content || '', command: input.command || '', emailTo: input.emailTo || '', newsTopic: input.newsTopic || '', newsCount: Math.max(3, Math.min(10, Number(input.newsCount) || 3)), enabled: true, last_run_date: '', last_status: 'ready', last_result: '', created_at: now, updated_at: now }; items.unshift(task); save(); return task; },
    runNow: async (id) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); try { task.last_result=await runTask(task); task.last_status='completed'; } catch(error) { task.last_result=error.message; task.last_status='failed'; } task.updated_at=new Date().toISOString(); save(); return task; },
    toggle: (id, enabled) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); task.enabled=Boolean(enabled); if(task.enabled) task.last_run_date=''; task.updated_at=new Date().toISOString(); save(); return task; },
    remove: (id) => { const before=items.length; items=items.filter((item)=>item.id!==id); save(); return items.length<before; },
    stop: () => clearInterval(timer),
  };
}

