import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { createAutomation, createSkill, deleteAutomation, deleteSkill, listAutomations, listSkills, runAutomation, startTraining, stopTraining, stopAutomation, updateAutomation } from './automation.js';

const file = path.join(process.cwd(), 'screen-companion-history.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { sessions: [], messages: [] }; } };
const write = (data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
const schema = z.object({ sessionId: z.string().optional(), message: z.string().trim().min(1).max(4000), screenshotBase64: z.string().max(7000000).optional() });
function fallbackSchedule(input, language = 'auto') {
  const match = input.match(/(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hour = match ? Number(match[1]) : 9;
  const minute = match?.[2] || '00';
  const suffix = (match?.[3] || '').toLowerCase();
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  return { title: input.slice(0, 80), time: String(hour).padStart(2, '0') + ':' + minute, kind: /gmail|email|mail/i.test(input) ? 'gmail' : 'vscode', filePath: 'scheduled-note.txt', language, content: input, command: (input.match(/npm\s+(run\s+)?(dev|start|test|build)/i)?.[0] || '') };
}
export async function createServer() {
  const api = express();
  api.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
  api.use(express.json({ limit: '8mb' }));
  api.get('/api/sessions', (_, res) => res.json(read().sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30)));
  api.get('/api/sessions/:id/messages', (req, res) => res.json(read().messages.filter((item) => item.session_id === req.params.id)));
  api.delete('/api/sessions/:id', (req, res) => { const data = read(); const exists = data.sessions.some((item) => item.id === req.params.id); data.sessions = data.sessions.filter((item) => item.id !== req.params.id); data.messages = data.messages.filter((item) => item.session_id !== req.params.id); write(data); return exists ? res.json({ ok: true }) : res.status(404).json({ error: 'Session not found.' }); });
  const automationTaskSchema = z.object({ task: z.string().trim().min(3).max(1000), title: z.string().trim().max(80).optional() });
  api.post('/api/scheduled/interpret', async (req, res) => { const input=String(req.body?.instruction||'').trim(); const language=String(req.body?.language||'auto').trim().slice(0,60) || 'auto'; if(input.length<3)return res.status(400).json({error:'Describe the scheduled task first.'}); try { if(!process.env.OPENAI_API_KEY){ const match=input.match(/(?:at|@)[ ]*(\d{1,2})(?::(\d{2}))?[ ]*(am|pm)?/i); let hour=match?Number(match[1]):9; const minute=match?.[2]||'00'; const suffix=(match?.[3]||'').toLowerCase(); if(suffix==='pm'&&hour<12)hour+=12; if(suffix==='am'&&hour===12)hour=0; return res.json({title:input.slice(0,80),time:String(hour).padStart(2,'0')+':'+minute,kind:/gmail|email|mail/i.test(input)?'gmail':'vscode',filePath:'scheduled-note.txt',language,content:input, command:(input.match(/npm\s+(run\s+)?(dev|start|test|build)/i)?.[0] || '')}); } const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY}); const result=await client.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-5-mini',messages:[{role:'user',content:'Convert this scheduled desktop task into JSON. If the instruction asks for code, generate complete runnable boilerplate in content for the requested language. Target language: '+language+'. Instruction: '+input+' Return only title, time HH:MM, kind vscode or gmail, filePath, content, and optional command. command may only be npm run dev, npm start, npm test, npm build, node file.js, or python file.py. Use daily scheduling. Never include passwords or claim an email was sent.'}],response_format:{type:'json_object'},max_completion_tokens:400}); const raw=result.choices[0]?.message?.content||'{}'; const parsed = JSON.parse(raw); return res.json(parsed.time && parsed.kind ? { ...parsed, language: parsed.language || language } : fallbackSchedule(input, language)); } catch(error){ console.error('[scheduled interpret]',error.message); return res.status(400).json({error:'AI could not understand this schedule.'}); } });
  api.get('/api/skills', (_, res) => res.json(listSkills()));
  api.post('/api/skills', (req, res) => { const parsed=z.object({title:z.string().trim().min(2).max(100),instructions:z.string().trim().min(3).max(2000)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Add a skill title and instructions.'}); return res.json(createSkill(parsed.data.title,parsed.data.instructions)); });
  api.delete('/api/skills/:id', (req, res) => deleteSkill(req.params.id)?res.json({ok:true}):res.status(404).json({error:'Skill not found.'}));
  api.get('/api/automations/config', (_, res) => res.json({ hasApiKey: Boolean(process.env.OPENAI_API_KEY) }));
  api.post('/api/automation-training/start', async (req, res) => { try { return res.json(await startTraining(String(req.body?.url || 'https://www.google.com'))); } catch (error) { return res.status(400).json({ error: error.message }); } });
  api.post('/api/automation-training/stop', async (req, res) => { try { return res.json(await stopTraining(String(req.body?.title || 'Browser training skill'))); } catch (error) { return res.status(400).json({ error: error.message }); } });
  api.get('/api/automations', (_, res) => res.json(listAutomations()));
  api.post('/api/automations', async (req, res) => {
    const parsed = automationTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Describe the automation task first.' });
    try { return res.json(await createAutomation(parsed.data.task, parsed.data.title)); }
    catch (error) { console.error('[automation create]', error.message); return res.status(400).json({ error: error.message || 'Could not create automation.' }); }
  });
  api.put('/api/automations/:id', async (req, res) => {
    const parsed = automationTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Describe the automation task first.' });
    try { return res.json(await updateAutomation(req.params.id, parsed.data.task, parsed.data.title)); }
    catch (error) { console.error('[automation update]', error.message); return res.status(400).json({ error: error.message || 'Could not update automation.' }); }
  });
  api.post('/api/automations/:id/run', async (req, res) => {
    try { return res.json(await runAutomation(req.params.id, req.body?.picker, { resume: Boolean(req.body?.resume) })); }
    catch (error) { console.error('[automation run]', error.message); return res.status(400).json({ error: error.message || 'Automation could not run.' }); }
  });
  api.delete('/api/automations/:id', (req, res) => deleteAutomation(req.params.id) ? res.json({ ok:true }) : res.status(404).json({ error:'Automation not found.' }));
  api.post('/api/automations/stop', async (_, res) => { await stopAutomation(); return res.json({ ok:true }); });  api.post('/api/automation-chat', async (req, res) => { const parsed=z.object({message:z.string().trim().min(1).max(5000), screenshotBase64:z.string().max(7000000).optional()}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Enter a message first.'}); res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'}); try { const answer=await answerQuestion(parsed.data.message,parsed.data.screenshotBase64,[]); for(const text of (answer.match(/.{1,60}(?:\s|$)/g)||[answer])) res.write('event: token\ndata: '+JSON.stringify({text})+'\n\n'); res.write('event: done\ndata: {}\n\n'); } catch(error) { console.error('[automation chat]',error.message); res.write('event: error\ndata: '+JSON.stringify({error:'Automation chat could not produce a response.'})+'\n\n'); } res.end(); });
  api.post('/api/chat', async (req, res) => {
    const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Enter a message and use a valid screenshot.' });
    const { message, screenshotBase64 } = parsed.data; const data = read(); const id = parsed.data.sessionId || randomUUID(); const now = new Date().toISOString();
    if (!data.sessions.some((item) => item.id === id)) data.sessions.push({ id, title: message.slice(0, 60), created_at: now, updated_at: now });
    const history = data.messages.filter((item) => item.session_id === id).slice(-20).map((item) => ({ role: item.role, content: item.content }));
    data.messages.push({ id: randomUUID(), session_id: id, role: 'user', content: message, has_screenshot: screenshotBase64 ? 1 : 0, created_at: now }); write(data);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    try {
      const answer = await answerQuestion(message, screenshotBase64, history);
      for (const text of (answer.match(/.{1,60}(?:\s|$)/g) || [answer])) res.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`);
      const latest = read(); latest.messages.push({ id: randomUUID(), session_id: id, role: 'assistant', content: answer, has_screenshot: 0, created_at: new Date().toISOString() }); const session = latest.sessions.find((item) => item.id === id); if (session) session.updated_at = new Date().toISOString(); write(latest);
      res.write(`event: done\ndata: ${JSON.stringify({ sessionId: id })}\n\n`);
    } catch (error) { console.error('[chat]', error.message); res.write(`event: error\ndata: ${JSON.stringify({ error: 'The assistant failed. Check your API key and try again.' })}\n\n`); }
    res.end();
  });
  const server = http.createServer(api); await new Promise((resolve) => server.listen(Number(process.env.PORT || 4387), '127.0.0.1', resolve)); return { close: async () => { await stopAutomation(); return new Promise((resolve) => server.close(resolve)); } };
}
async function answerQuestion(message, image, history) {
  if (!process.env.OPENAI_API_KEY) return image ? `Demo mode: I received your screen and asked ${message}. Add OPENAI_API_KEY to .env for a real vision answer.` : `Demo mode: I received ${message}. Add OPENAI_API_KEY to .env for a real GPT answer.`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); const content = [{ type: 'text', text: message }]; if (image) content.push({ type: 'image_url', image_url: { url: image } });
  const messages = [...history, { role: 'user', content }]; const result = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', messages, reasoning_effort: 'low', max_completion_tokens: image ? 1400 : 700 }); const choiceMessage=result.choices[0]?.message; const raw=choiceMessage?.content; const answer=(typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((part) => typeof part === 'string' ? part : part?.text || '').join('') : '').trim(); if (!answer) return choiceMessage?.refusal || 'I could not produce a text response. Try asking the question again in a shorter way.'; return answer;
}
