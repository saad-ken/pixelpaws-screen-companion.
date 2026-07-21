import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function write(file, items) { fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8'); }
function isSafeRunCommand(command) { return /^(npm\s+(run\s+)?(dev|start|test|build)|node\s+[^&|]+|python\s+[^&|]+)$/i.test(String(command || '').trim()); }

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
    if (!command) throw Error('VS Code was not found. Install VS Code or add its command to PATH.');    await new Promise((resolve, reject) => {
      const child = spawn(command, ['--new-window', target], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', (error) => reject(error.code === 'ENOENT' ? Error('VS Code was not found. Install VS Code or add its command to PATH.') : error));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    if (task.command) {
      if (!isSafeRunCommand(task.command)) throw Error('Only safe npm, node, or python project commands can be scheduled.');
      const runner = process.platform === 'win32' ? 'cmd.exe' : 'sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', task.command] : ['-lc', task.command];
      await new Promise((resolve, reject) => { const child = spawn(runner, args, { cwd: path.dirname(target), detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
      return 'Opened VS Code, wrote ' + target + ', and started: ' + task.command;
    }
    return 'Opened VS Code and wrote ' + target;
  }
  if (task.kind === 'gmail') return 'Gmail is queued until Gmail OAuth is connected.';
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
    saveTask: (input) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || ''))) throw Error('Choose a valid time in HH:MM format.'); const now = new Date().toISOString(); const task = { id: randomUUID(), title: input.title || 'Scheduled task', time: input.time, kind: input.kind || 'vscode', filePath: input.filePath || '', content: input.content || '', command: input.command || '', enabled: true, last_run_date: '', last_status: 'ready', last_result: '', created_at: now, updated_at: now }; items.unshift(task); save(); return task; },
    runNow: async (id) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); try { task.last_result=await runTask(task); task.last_status='completed'; } catch(error) { task.last_result=error.message; task.last_status='failed'; } task.updated_at=new Date().toISOString(); save(); return task; },
    toggle: (id, enabled) => { const task=items.find((item)=>item.id===id); if(!task) throw Error('Scheduled task not found.'); task.enabled=Boolean(enabled); if(task.enabled) task.last_run_date=''; task.updated_at=new Date().toISOString(); save(); return task; },
    remove: (id) => { const before=items.length; items=items.filter((item)=>item.id!==id); save(); return items.length<before; },
    stop: () => clearInterval(timer),
  };
}
