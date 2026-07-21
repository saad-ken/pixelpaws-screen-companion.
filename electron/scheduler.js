import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function write(file, items) { fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8'); }
function isSafeRunCommand(command) { return /^(npm\s+(run\s+)?(dev|start|test|build)|node\s+[^&|]+|python\s+[^&|]+)$/i.test(String(command || '').trim()); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
function parseNews(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
    const item = match[1];
    const value = (tag) => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    return { title: value('title'), link: value('link'), date: value('pubDate'), description: value('description').slice(0, 500) };
  }).filter((item) => item.title);
}
async function getNews(topic) {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(topic) + '&hl=en-IN&gl=IN&ceid=IN:en';
  const response = await fetch(url, { headers: { 'User-Agent': 'PixelPaws/1.0 news reader' } });
  if (!response.ok) throw Error('News source could not be reached.');
  const articles = parseNews(await response.text());
  if (!articles.length) throw Error('No recent news was found for this topic.');
  return articles;
}
async function summarizeNews(topic, articles) {
  const source = articles.map((item, index) => `${index + 1}. ${item.title}\n${item.description}\n${item.link}`).join('\n\n');
  if (!process.env.OPENAI_API_KEY) return `Daily news summary: ${topic}\n\n${articles.map((item, index) => `${index + 1}. ${item.title}\n${item.link}`).join('\n\n')}\n\nDemo mode: add an OpenAI API key for an AI-written summary.`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', messages: [{ role: 'user', content: `Create a concise daily news digest about ${topic}. Use only these article details. Include 3-5 bullet points, explain why each matters, and include source links. Do not invent facts.\n\n${source}` }], max_completion_tokens: 700 });
  return String(result.choices[0]?.message?.content || source).trim();
}
async function sendNewsEmail(task) {
  const to = String(task.emailTo || '').trim();
  if (!validEmail(to)) throw Error('Enter a valid recipient email address.');
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!user || !pass) throw Error('Add GMAIL_USER and GMAIL_APP_PASSWORD to the local environment before running email schedules.');
  const topic = String(task.newsTopic || task.content || 'technology and AI news').trim().slice(0, 200);
  const articles = await getNews(topic);
  const text = await summarizeNews(topic, articles);
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({ from: user, to, subject: `PixelPaws daily news: ${topic}`, text });
  return `Sent a ${articles.length}-article news summary to ${to}.`;
}
async function runTask(task) {
  if (task.kind === 'vscode') {
    let target = path.resolve(task.filePath || 'scheduled-note.txt');
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'scheduled-note.txt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, task.content || '', 'utf8');
    const commands = process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'bin', 'code.cmd')]
      : ['code'];
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
    saveTask: (input) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || ''))) throw Error('Choose a valid time in HH:MM format.'); if (input.kind === 'gmail' && !validEmail(input.emailTo)) throw Error('Enter a valid recipient email address.'); const now = new Date().toISOString(); const task = { id: randomUUID(), title: input.title || 'Scheduled task', time: input.time, kind: input.kind || 'vscode', filePath: input.filePath || '', content: input.content || '', command: input.command || '', emailTo: input.emailTo || '', newsTopic: input.newsTopic || '', enabled: true, last_run_date: '', last_status: 'ready', last_result: '', created_at: now, updated_at: now }; items.unshift(task); save(); return task; },
    runNow: async (id) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); try { task.last_result=await runTask(task); task.last_status='completed'; } catch(error) { task.last_result=error.message; task.last_status='failed'; } task.updated_at=new Date().toISOString(); save(); return task; },
    toggle: (id, enabled) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); task.enabled=Boolean(enabled); if(task.enabled) task.last_run_date=''; task.updated_at=new Date().toISOString(); save(); return task; },
    remove: (id) => { const before=items.length; items=items.filter((item)=>item.id!==id); save(); return items.length<before; },
    stop: () => clearInterval(timer),
  };
}
