import { useEffect, useState } from 'react';

export default function ScheduledAutomationPanel({ onBack }) {
  const [items, setItems] = useState([]); const [instruction, setInstruction] = useState(''); const [aiBusy, setAiBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('21:00');
  const [kind, setKind] = useState('vscode');
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState(''); const [command, setCommand] = useState('');
  const [status, setStatus] = useState('Create a daily scheduled task.');
  async function refresh() { const list=await window.companion.schedulerList(); setItems(list); }
  useEffect(() => { refresh().catch(()=>setStatus('Scheduler is unavailable.')); }, []);
  async function interpret() { if(!instruction.trim()||aiBusy)return; setAiBusy(true);setStatus('AI is understanding the schedule and generating code...');try{const r=await fetch('http://127.0.0.1:4387/api/scheduled/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction})});const d=await r.json();if(!r.ok)throw Error(d.error);setTitle(d.title||instruction.slice(0,80));setTime(d.time||'09:00');setKind(d.kind||'vscode');setFilePath(d.filePath||'');setContent(d.content||'');setCommand(d.command||'');setStatus('Review the generated task, then save it.');}catch(error){setStatus(error.message);}finally{setAiBusy(false);}} async function add() { if(!title.trim()||!time)return; try { await window.companion.schedulerSave({title,time,kind,filePath,content,command}); setTitle('');setFilePath('');setContent('');setCommand('');setStatus('Scheduled task saved.');await refresh(); } catch(error){setStatus(error.message);} }
  async function toggle(item) { await window.companion.schedulerToggle(item.id,!item.enabled); await refresh(); }
  async function runNow(item) { setStatus('Running '+item.title+'...'); try { await window.companion.schedulerRunNow(item.id); setStatus('Schedule finished.'); await refresh(); } catch(error) { setStatus(error.message || 'Schedule failed.'); } }
  async function remove(item) { await window.companion.schedulerDelete(item.id); await refresh(); }
  return <div className="scheduled-panel">
    <header><div><label>PHASE THREE</label><h1>Scheduled automation</h1><p>Electron runs these daily tasks locally.</p></div><button onClick={onBack}>Back to chat</button></header>
    <div className="scheduled-layout">
      <div className="automation-card scheduled-form"><h3>+ Add scheduled task</h3><small className="schedule-help">Describe the code and the project command. AI will fill the file content and safe run command.</small><textarea value={instruction} onChange={(e)=>setInstruction(e.target.value)} placeholder="Example: Every day at 9 PM open VS Code and write a React boilerplate note" /><button onClick={interpret} disabled={!instruction.trim()||aiBusy}>{aiBusy?'Generating...':'Generate code with AI'}</button><input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Example: Write my React boilerplate" /><div className="scheduled-row"><label>Time <input type="time" value={time} onChange={(e)=>setTime(e.target.value)} /></label><label>Action <select value={kind} onChange={(e)=>setKind(e.target.value)}><option value="vscode">Open VS Code and write file</option><option value="gmail">Send Gmail summary (OAuth later)</option></select></label></div>{kind==='vscode'&&<><input value={filePath} onChange={(e)=>setFilePath(e.target.value)} placeholder="File path or folder, e.g. C:\\projects\\daily-note.txt" /><textarea value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Content to write into the file" /><input value={command} onChange={(e)=>setCommand(e.target.value)} placeholder="Optional safe command, e.g. npm run dev" /></>}{kind==='gmail'&&<p className="demo-note">Gmail OAuth is not connected yet. This task will remain queued safely.</p>}<div className="automation-actions"><small>{status}</small><button className="send" onClick={add} disabled={!title.trim()}>Save schedule</button></div></div>
      <div className="automation-card scheduled-list"><h3>Saved schedules</h3>{!items.length&&<p className="empty-schedule">No scheduled tasks yet.</p>}{items.map((item)=><div className="scheduled-item" key={item.id}><div><strong>{item.title}</strong><small>{item.time} daily ï¿½ {item.kind} ï¿½ {item.enabled?'Enabled':'Disabled'}</small>{item.last_result&&<small>{item.last_result}</small>}</div><button onClick={()=>runNow(item)}>Run now</button><button onClick={()=>toggle(item)}>{item.enabled?'Disable':'Enable'}</button><button className="delete-session" onClick={()=>remove(item)}>x</button></div>)}</div>
    </div>
  </div>;
}

