import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { z } from 'zod';

const libraryFile = path.join(process.cwd(), 'screen-companion-automations.json');
const skillsFile = path.join(process.cwd(), 'screen-companion-skills.json');
const allowedHosts = new Set(['www.bing.com','bing.com','www.google.com','google.com','www.wikipedia.org','wikipedia.org','openai.com','www.openai.com','github.com','www.github.com']);
const locatorSchema = z.object({ kind: z.enum(['role','label','placeholder','text','testId','id','name','css']), value: z.string().max(300), name: z.string().max(180).optional(), exact: z.boolean().optional() });
const actionSchema = z.object({ action: z.enum(['navigate','search','click','type','scroll','done']), url: z.string().optional(), query: z.string().max(300).optional(), candidateIndex: z.number().int().positive().optional(), locator: locatorSchema.optional(), text: z.string().max(500).optional(), amount: z.number().min(-3000).max(3000).optional(), reason: z.string().max(500).optional() });
let browser; let context; let page;
const readSkills = () => { try { return JSON.parse(fs.readFileSync(skillsFile, 'utf8')); } catch { return []; } };
const writeSkills = (items) => fs.writeFileSync(skillsFile, JSON.stringify(items, null, 2), 'utf8');
export const listSkills = () => readSkills();
export function createSkill(title, instructions) { const item={id:randomUUID(),title:title.trim().slice(0,100),instructions:instructions.trim().slice(0,2000),created_at:new Date().toISOString()};const items=readSkills();items.unshift(item);writeSkills(items);return item; }
export function deleteSkill(id) { const items=readSkills();const exists=items.some((item)=>item.id===id);writeSkills(items.filter((item)=>item.id!==id));return exists; }
const readLibrary = () => { try { return JSON.parse(fs.readFileSync(libraryFile, 'utf8')); } catch { return []; } };
const writeLibrary = (items) => fs.writeFileSync(libraryFile, JSON.stringify(items, null, 2), 'utf8');
function safeUrl(value) { const url = new URL(value); if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw Error(`Only approved HTTPS websites are available: ${url.hostname}`); return url.toString(); }
function check(action) {
  if (action.action === 'navigate') { if (!action.url) throw Error('Navigate needs a URL.'); safeUrl(action.url); }
  if (action.action === 'search' && !action.query) throw Error('Search needs a query.'); if (action.action === 'scroll' && action.amount === 0) throw Error('Scroll needs a non-zero amount.');
  if ((action.action === 'click' || action.action === 'type') && !action.candidateIndex && !action.locator) throw Error(action.action + ' needs a candidateIndex or semantic locator.');
  if (action.action === 'type' && !action.text) throw Error('Type needs text.');
  if (action.action === 'type' && /password|passcode|credit.?card|cvv/i.test(`${action.selector} ${action.text}`)) throw Error('Passwords and payment details are blocked.');
}
function json(text) { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); }
function normalizeAction(raw) {
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item || typeof item !== 'object') return { action: 'done', reason: 'The AI returned an invalid action. Stop safely.' };
  const action = String(item.action || '').toLowerCase().trim();
  const aliases = { goto: 'navigate', visit: 'navigate', open: 'click', input: 'type', enter: 'type', write: 'type', wheel: 'scroll', finish: 'done', complete: 'done' };
  if (aliases[action]) item.action = aliases[action];
  if (action === 'open' && item.url) item.action = 'navigate';
  return item;
}async function ask(messages) { const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); const result = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', messages, response_format: { type: 'json_object' }, max_completion_tokens: 700 }); return json(result.choices[0]?.message?.content || '{}'); }
export async function createAutomation(task, title) {
  const clean = task.trim(); if (clean.length < 3) throw Error('Describe the browser task first.');
  let draft;
  if (process.env.OPENAI_API_KEY) {
    draft = await ask([{ role: 'user', content: `You design safe reusable browser automations. Task: ${clean}\nReturn JSON: {"summary":"short", "steps":["human readable step"]}. Give 3-8 likely steps. This is only a review plan. Allowed sites: Bing, Google, Wikipedia, OpenAI, GitHub. Never include logins, passwords, purchases, deletes, messages, posts, or form submission.` }]);
  } else draft = { summary: 'Demo plan', steps: ['Search the approved web sources', 'Open relevant safe result', 'Collect the requested information'] };
  const now = new Date().toISOString(); const item = { id: randomUUID(), title: (title || clean).slice(0,80), task: clean, summary: String(draft.summary || 'Browser task'), draftSteps: Array.isArray(draft.steps) ? draft.steps.slice(0,8) : [], created_at: now, updated_at: now, status: 'ready', runs: [] };
  const items=readLibrary(); items.unshift(item); writeLibrary(items); return item;
}
export async function updateAutomation(id, task, title) {
  const clean = task.trim(); if (clean.length < 3) throw Error('Describe the browser task first.');
  const existing = readLibrary().find((entry) => entry.id === id); if (!existing) throw Error('Saved automation not found.');
  const replacement = await createAutomation(clean, title || clean);
  const generated = readLibrary().find((entry) => entry.id === replacement.id);
  const updated = { ...generated, id, title: (title || clean).slice(0,80), created_at: existing.created_at, runs: existing.runs || [], status: 'ready', updated_at: new Date().toISOString() };
  writeLibrary(readLibrary().filter((entry) => entry.id !== replacement.id && entry.id !== id).concat(updated));
  return updated;
}
export const listAutomations = () => readLibrary().sort((a,b) => b.updated_at.localeCompare(a.updated_at));
export function deleteAutomation(id) { const items=readLibrary(); const exists=items.some((item)=>item.id===id); writeLibrary(items.filter((item)=>item.id!==id)); return exists; }
async function ensurePage() { if (!browser || !browser.isConnected()) { browser = await chromium.launch({ headless:false }); context = await browser.newContext({ viewport:{width:1280,height:800} }); page = undefined; } if(!context) context = await browser.newContext({ viewport:{width:1280,height:800} }); const pages=context.pages(); if(!page || page.isClosed()) page=pages[0] || await context.newPage(); for(const extra of context.pages()){if(extra!==page)await extra.close().catch(()=>{});} return page; }
async function observe(includeImage) {
  const state = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g,' ').slice(0,5000);
    const items = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"]')].filter((el) => { const r=el.getBoundingClientRect(); return r.width>4 && r.height>4; }).slice(0,35).map((el, index) => {
      const tag=el.tagName.toLowerCase();
      const label=(el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').trim().replace(/\\s+/g,' ').slice(0,120);
      const role=el.getAttribute('role') || (tag==='button'?'button':tag==='a'?'link':tag==='textarea'?'textbox':tag==='select'?'combobox':tag==='input'?'textbox':null);
      const associatedLabel=el.labels?.[0]?.innerText?.trim().replace(/\\s+/g,' ').slice(0,120) || '';
      const testId=el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '';
      const id=el.id || ''; const name=el.getAttribute('name') || ''; const placeholder=el.getAttribute('placeholder') || '';
      const locator=role && label ? { kind:'role', value:role, name:label, exact:true } : associatedLabel ? { kind:'label', value:associatedLabel, exact:true } : placeholder ? { kind:'placeholder', value:placeholder, exact:true } : testId ? { kind:'testId', value:testId, exact:true } : id ? { kind:'id', value:id, exact:true } : name ? { kind:'name', value:name, exact:true } : label ? { kind:'text', value:label, exact:true } : { kind:'css', value:tag, exact:false };
      return { index:index+1, tag, label, role, locator };
    });
    const challenge=/(captcha|recaptcha|hcaptcha|verify you are human|one last step|unusual traffic|cloudflare|security check)/i.test(text); return { url:location.href, title:document.title, text, items, blockReason:challenge?'A CAPTCHA or human-verification challenge was detected. The automation will not click it.':null };
  });
  if (includeImage) state.screenshot = `data:image/jpeg;base64,${(await page.screenshot({ type:'jpeg', quality:55 })).toString('base64')}`;
  return state;
}
async function nextAction(task, state, step) {
  if (!process.env.OPENAI_API_KEY) return { action:'done', reason:'Add an API key to use the AI browser agent.' };
  const pageInfo = { url:state.url, title:state.title, text:state.text, interactiveElements:state.items, recovery:state.recovery || null, reusableSkills:listSkills().slice(0,12) };
  const content=[{ type:'text', text:`You are a safe browser agent. User task: ${task}\nStep ${step}/12. Page state: ${JSON.stringify(pageInfo)}\nReturn JSON only: {"action":"navigate|search|click|type|scroll|done","url?":"","query?":"","candidateIndex?":1,"locator?":{"kind":"role|label|placeholder|text|testId|id|name|css","value":"...","name?":"...","exact?":true},"text?":"","reason":""}. Use only Bing, Google, Wikipedia, OpenAI, or GitHub. Never submit forms, log in, use passwords, purchase, delete, message, post, download, or leave these domains. For click/type, prefer candidateIndex from interactiveElements. If using locator, use a semantic locator and never invent XPath or nth-of-type selectors. If task is complete, action=done.` }];
  if (state.screenshot) content.push({ type:'image_url', image_url:{ url:state.screenshot } });
  const action=actionSchema.parse(normalizeAction(await ask([{ role:'user', content }]))); check(action); return action;
}
function resolveLocator(locator) {
  if (!locator) throw Error('No locator was provided.');
  const options = locator.exact === undefined ? {} : { exact: locator.exact };
  if (locator.kind === 'role') return page.getByRole(locator.value, { name: locator.name || locator.value, ...options }).first();
  if (locator.kind === 'label') return page.getByLabel(locator.value, options).first();
  if (locator.kind === 'placeholder') return page.getByPlaceholder(locator.value, options).first();
  if (locator.kind === 'text') return page.getByText(locator.value, options).first();
  if (locator.kind === 'testId') return page.getByTestId(locator.value).first();
  if (locator.kind === 'id') return page.locator('[id="' + locator.value.replace(/"/g, '\\"') + '"]').first();
  if (locator.kind === 'name') return page.locator('[name="' + locator.value.replace(/"/g, '\\"') + '"]').first();
  return page.locator(locator.value).first();
}
function targetFor(action, state) {
  if (action.candidateIndex) { const candidate=state.items.find((item)=>item.index===action.candidateIndex); if(!candidate) throw Error('Candidate is no longer visible.'); return resolveLocator(candidate.locator); }
  return resolveLocator(action.locator);
}
async function execute(action, state) {
  if (action.action==='navigate') { await page.goto(safeUrl(action.url), { waitUntil:'domcontentloaded', timeout:20000 }); await ensurePage(); }
  if (action.action==='search') await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(action.query)}`, { waitUntil:'domcontentloaded', timeout:20000 });
  if (action.action==='click') { const popupPromise=page.waitForEvent('popup',{timeout:700}).catch(()=>null); await targetFor(action,state).click({timeout:10000}); const popup=await popupPromise; if(popup){await popup.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});const popupUrl=popup.url();await popup.close().catch(()=>{});if(popupUrl)await page.goto(safeUrl(popupUrl),{waitUntil:'domcontentloaded',timeout:20000});} await ensurePage(); await page.waitForTimeout(700); }
  if (action.action==='type') await targetFor(action,state).fill(action.text, { timeout:10000 }); if (action.action==='scroll') { await page.mouse.wheel(0, action.amount || 650); await page.waitForTimeout(500); }
}
async function summarizeResult(task) { const state=await observe(false); const needsImage=state.text.length<180 || /screen|visual|image|layout/i.test(task); if(needsImage) state.screenshot='data:image/jpeg;base64,'+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'); if(!process.env.OPENAI_API_KEY) return 'Demo mode: the automation reached the requested page. Add an OpenAI API key to receive a page summary.'; const content=[{type:'text',text:'Summarize the result of this safe browser task. Task: '+task+'\nCurrent page URL: '+state.url+'\nPage title: '+state.title+'\nPage text: '+state.text+'\nReturn JSON only: {"answer":"one concise paragraph describing what was found","found":true}.'}]; if(state.screenshot) content.push({type:'image_url',image_url:{url:state.screenshot}}); const result=await ask([{role:'user',content}]); return String(result.answer||'The page was reached, but no summary was returned.').trim(); }
async function recoverAction(task, failedAction, step) { for(let attempt=1;attempt<=2;attempt+=1) { const state=await observe(true); if(state.blockReason) return { blocked:state.blockReason }; state.recovery='The previous action failed. Choose a different matching semantic candidate from the current page. Failed action: '+JSON.stringify(failedAction); const action=await nextAction(task,state,step); if(action.action==='done') return { done:true, state }; check(action); try { await execute(action,state); return { action }; } catch {} } throw Error('The agent could not recover this browser step automatically.'); }
let trainingActive = false;
let trainingEvents = [];
let trainingPage;
async function attachTrainingListener() {
  if (!page || trainingPage === page) return;
  trainingPage = page;
  try { await page.exposeFunction('__pixelRecordClick', (event) => { if (trainingActive) trainingEvents.push(event); }); } catch {}
  await page.evaluate(() => {
    window.__pixelTrainingCleanup?.();
    const handler = (event) => { const target = event.target; if (!(target instanceof Element)) return; const rect = target.getBoundingClientRect(); if (rect.width < 4 || rect.height < 4) return; window.__pixelRecordClick({ action: 'click', tag: target.tagName.toLowerCase(), text: (target.innerText || target.getAttribute('aria-label') || target.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 120), role: target.getAttribute('role') || (target.tagName.toLowerCase() === 'button' ? 'button' : target.tagName.toLowerCase() === 'a' ? 'link' : ''), placeholder: target.getAttribute('placeholder') || '', label: target.getAttribute('aria-label') || '' }); };
    document.addEventListener('click', handler, true); window.__pixelTrainingCleanup = () => document.removeEventListener('click', handler, true);
  });
}
export async function startTraining(url = 'https://www.google.com') { await ensurePage(); if (page.url() === 'about:blank' && url) await page.goto(safeUrl(url), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); trainingActive = true; trainingEvents = []; await attachTrainingListener(); return { url: page.url() }; }
export async function stopTraining(title = 'Browser training skill') { trainingActive = false; await page?.evaluate(() => window.__pixelTrainingCleanup?.()).catch(() => {}); trainingPage = undefined; if (!trainingEvents.length) throw Error('No clicks were recorded. Start training and click a visible browser element.'); const steps = trainingEvents.map((event, index) => `${index + 1}. Click the ${event.role || event.tag} labeled "${event.text || event.placeholder || 'visible target'}"`).join('\n'); const skill = createSkill(title, `Use these learned semantic browser steps:\n${steps}\nPrefer role, label, placeholder, or visible text locators. Never use XPath. Never bypass CAPTCHA or human verification.`); const events = trainingEvents; trainingEvents = []; return { skill, events }; }export async function runAutomation(id, pickerChoice, options = {}) { const items=readLibrary(); const item=items.find((entry)=>entry.id===id); if(!item) throw Error('Saved automation not found.'); await ensurePage(); const logs=[]; let picker=null; let lastActionKey=''; const startStep=options.resume && item.status==='needs_human' ? (item.resume_step || 1) : 1; item.status='running'; item.resume_step=null; item.updated_at=new Date().toISOString(); writeLibrary(items);
  for(let step=startStep;step<=12;step+=1) { const state=await observe(step===1); if(state.blockReason){ item.status='needs_human'; item.resume_step=step; logs.push({ step, ok:false, label:state.blockReason }); break; } let action;
    try { action=await nextAction(item.task,state,step); if(action.action==='done'){item.result=await summarizeResult(item.task);logs.push({step,ok:true,label:'Task completed. Result: '+item.result});item.status='completed';break;} const actionKey=JSON.stringify({action:action.action,candidateIndex:action.candidateIndex,locator:action.locator,query:action.query,url:action.url}); if(actionKey===lastActionKey && ['click','navigate','search'].includes(action.action)){ item.result=await summarizeResult(item.task); logs.push({step,ok:true,label:'Stopped a repeated browser action and summarized the current page.'}); item.status='completed'; break; } lastActionKey=actionKey; check(action); await execute(action,state); logs.push({step,ok:true,label:action.action+': '+(action.reason||action.query||action.url||(action.candidateIndex?'candidate '+action.candidateIndex:action.locator?.value))}); if(step===12)item.status='stopped'; }
    catch(error) { try { const recovered=await recoverAction(item.task,action,step); if(recovered.blocked){item.status='needs_human';item.resume_step=step;logs.push({step,ok:false,label:recovered.blocked});break;} if(recovered.done){item.status='completed';logs.push({step,ok:true,label:'Task completed after recovery.'});break;} logs.push({step,ok:true,label:'Recovered automatically after a failed browser step.'}); continue; } catch(recoveryError) { item.status='failed'; logs.push({step,ok:false,label:recoveryError.message}); break; } }
  }
  item.runs.unshift({id:randomUUID(),started_at:new Date().toISOString(),status:item.status,logs,picker:null}); item.runs=item.runs.slice(0,10); item.updated_at=new Date().toISOString(); writeLibrary(items); return {automation:item,logs,picker:null,ok:item.status==='completed'};
}
export async function stopAutomation() { if(browser?.isConnected()) await browser.close(); browser=undefined; context=undefined; page=undefined; }