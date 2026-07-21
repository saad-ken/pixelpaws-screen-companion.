import { useEffect, useRef, useState } from 'react';
const API = 'http://127.0.0.1:4387';

export default function AutomationChat({ automationId, task, notice, screenImage }) {
  const [messages, setMessages] = useState([{ role:'assistant', text:'Ask me to improve this automation or explain a failed step.' }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!notice) return;
    setMessages((items) => [...items, { role:'assistant', text:notice }]);
  }, [notice]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send(promptText) {
    const text=(typeof promptText === 'string' ? promptText : input).trim(); if(!text||busy)return;
    setInput(''); setBusy(true);
    setMessages((items)=>[...items,{role:'user',text},{role:'assistant',text:'Thinking...'}]);
    try {
      const prompt='Automation task: '+task+'\nUser asks: '+text+'\nExplain the next safe plan change or why a browser step failed. Do not claim that you changed or ran the automation unless the user explicitly asks for that.';
      const response=await fetch(API+'/api/automation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:prompt,screenshotBase64:screenImage || undefined})});
      if(!response.ok) throw Error('Chat request failed.');
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer=''; let answer='';
      while(true){const part=await reader.read(); if(part.done)break; buffer+=decoder.decode(part.value,{stream:true}); const events=buffer.split('\n\n'); buffer=events.pop()||''; for(const event of events){const line=event.split('\n').find((item)=>item.startsWith('data: ')); if(!line)continue; const data=JSON.parse(line.slice(6)); if(data.text)answer+=data.text; if(data.error)throw Error(data.error);}}
      setMessages((items)=>[...items.slice(0,-1),{role:'assistant',text:answer||'No answer was returned.'}]);
    } catch(error) { setMessages((items)=>[...items.slice(0,-1),{role:'assistant',text:error.message||'Automation chat failed.'}]); }
    finally { setBusy(false); }
  }

  return <div className="automation-card automation-chat">
    <div className="automation-chat-heading"><div><h3>Automation chat</h3><p>Ask about the plan or explain a failed step.</p></div><span>{busy?'Thinking...':'Ready'}</span><button className="observe-question" onClick={()=>send("Look at the current screen frame and tell me what is visible and what I should click next. Do not click anything.")} disabled={!screenImage||busy}>Ask AI about frame</button></div>
    <div className="automation-chat-messages" ref={scrollRef}>{messages.map((message,index)=><div className={message.role==='user'?'automation-chat-message user':'automation-chat-message'} key={index}><b>{message.role==='user'?'You':'AI'}</b><span>{message.text}</span><button className="observe-question" onClick={()=>send("Look at the current screen frame and tell me what is visible and what I should click next. Do not click anything.")} disabled={!screenImage||busy}>Ask AI about frame</button></div>)}</div>
    <div className="automation-chat-input"><textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}}} placeholder="Ask about this automation..." disabled={busy}/><button className="send" onClick={() => send()} disabled={!input.trim()||busy}>Send</button></div>
  </div>;
}