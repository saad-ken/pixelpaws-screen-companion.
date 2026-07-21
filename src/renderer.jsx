import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import catGif from '../tuxedo-tuxedocat.gif';
import AutomationPanel from './AutomationPanel';
import ScheduledAutomationPanel from './ScheduledAutomationPanel';
import OpenAISettingsModal from './OpenAISettingsModal';
import './styles.css';

const API = 'http://127.0.0.1:4387';
const isFloating = window.location.pathname.endsWith('floating.html');
if (isFloating) document.body.classList.add('floating-page');

function Button() {
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0 });
  const purr = useRef(null);
  const startPurr = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext || purr.current) return;
      const audio = new AudioContext();
      const output = audio.createGain(); output.gain.value = 0.035; output.connect(audio.destination);
      const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 260; filter.Q.value = 1.2; filter.connect(output);
      const tone = audio.createOscillator(); tone.type = 'sawtooth'; tone.frequency.value = 72; tone.connect(filter);
      const hum = audio.createOscillator(); hum.type = 'sine'; hum.frequency.value = 144; hum.connect(filter);
      const pulse = audio.createOscillator(); const pulseGain = audio.createGain(); pulse.type = 'sine'; pulse.frequency.value = 7; pulseGain.gain.value = 0.012; pulse.connect(pulseGain); pulseGain.connect(output);
      tone.start(); hum.start(); pulse.start(); purr.current = { audio, tone, hum, pulse };
    } catch { /* Audio is optional; dragging still works. */ }
  };
  const stopPurr = () => { const sound = purr.current; if (!sound) return; purr.current = null; sound.tone.stop(); sound.hum.stop(); sound.pulse.stop(); sound.audio.close(); };
  const down = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId); startPurr();
    drag.current = { active: true, moved: false, startX: event.screenX, startY: event.screenY };
    window.companion.beginDrag(event.screenX, event.screenY);
  };
  const move = (event) => {
    if (!drag.current.active) return;
    if (Math.hypot(event.screenX - drag.current.startX, event.screenY - drag.current.startY) > 4) drag.current.moved = true;
    window.companion.moveDrag(event.screenX, event.screenY);
  };
  const up = () => {
    if (!drag.current.active) return;
    const wasClick = !drag.current.moved; drag.current.active = false; stopPurr();
    window.companion.endDrag(); if (wasClick) window.companion.openChat();
  };
  return <button className="orb" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Pet Tuxi or open PixelPaws"><img src={catGif} alt="Tuxi pixel cat companion" /></button>;
}

function Chat() {
  const [messages, setMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [configured, setConfigured] = useState(false);
  const [showOpenAISettings, setShowOpenAISettings] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState('chat');
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const inputRef = useRef(null);
  const requestController = useRef(null);

  useEffect(() => {
    window.companion.config().then((state) => setConfigured(state.hasApiKey));
    refreshSessions();
  }, []);

  async function refreshSessions() {
    try {
      const response = await fetch(`${API}/api/sessions`);
      if (response.ok) setSessions(await response.json());
    } catch {
      // The chat remains usable even if history is temporarily unavailable.
    }
  }

  async function refreshConfig() { const state = await window.companion.config(); setConfigured(state.hasApiKey); }

  function startSharing() {
    window.companion.setChatShareMode(true);
    setSharing(true);
    setStatus('Screen sharing ready. Click Capture screen when you are ready.');
  }

  function closeSharing() {
    window.companion.setCaptureProtection(false);
    window.companion.setChatShareMode(false);
    setSharing(false);

    setPreview(null);
    setStatus('Screen sharing closed.');
  }


  async function captureScreen() {
    if (busy) return;
    setStatus('Capturing screen...');
    try {
      const image = await window.companion.captureScreen();
      setPreview(image);
      setStatus('Preview ready. Add a question and send it.');
    } catch (error) {
      setStatus(`Screen capture failed: ${error.message}`);
    }
  }

  async function sendMessage() {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    const screenshotBase64 = preview || undefined;
    const sentScreenSnapshot = Boolean(screenshotBase64);
    if (sentScreenSnapshot && sharing) { closeSharing(); setStatus('Looking at your screen...'); }
    const controller = new AbortController();
    requestController.current = controller;
    setStatus(sentScreenSnapshot ? 'Looking at your screen...' : 'Thinking...');
    try {
      setMessages((current) => [...current, { role: 'user', content: message, screenshot: screenshotBase64 }, { role: 'assistant', content: '' }]);
      setText('');
      const response = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId || undefined, message, screenshotBase64 }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('Chat server unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const line = event.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(data.error);
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          if (data.text) setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + data.text } : item));
        }
      }
      setPreview(null);
      setStatus('Ready');
      await refreshSessions();
    } catch (error) {
      if (error.name === 'AbortError') return;
      setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: `Sorry: ${error.message}` } : item));
      if (sentScreenSnapshot && sharing) closeSharing();
      setStatus('Request failed');
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setBusy(false);
      }
    }
  }

  async function loadSession(id) {
    try {
      const response = await fetch(`${API}/api/sessions/${id}/messages`);
      if (response.ok) { setView('chat'); setCurrentSessionId(id); setMessages(await response.json()); }
    } catch {
      setStatus('Could not load this session.');
    }
  }

  function startNewChat() {
    setView('chat');
    requestController.current?.abort();
    requestController.current = null;
    setCurrentSessionId(null);
    setBusy(false);
    setMessages([]);
    setText('');
    setPreview(null);
    window.companion.setCaptureProtection(false);
    window.companion.setChatShareMode(false);
    setSharing(false);

    setStatus('New chat ready.');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openScheduled() { closeSharing(); setView('scheduled'); }

  function openAutomation() {
    closeSharing();
    setView('automation');
  }

  async function deleteSession() {
    const id = deleteCandidate?.id;
    if (!id) return;
    try {
      const response = await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed.');
      if (id === currentSessionId) startNewChat();
      await refreshSessions();
      setDeleteCandidate(null);
    } catch (error) {
      setStatus(error.message);
    }
  }
  return <main className={sharing ? 'share-mode' : ''}>
    <aside>
      <div className="brand"><strong>PixelPaws</strong><small>Tuxi · screen buddy</small></div>
      <button className="new-chat" onClick={startNewChat}>+ New chat</button>
      <button className={view === 'chat' ? 'tab active' : 'tab'} onClick={() => setView('chat')}>Recent</button>
      <button className={view === 'automation' ? 'tab active' : 'tab'} onClick={openAutomation}>Automate</button>
      <button className={view === 'scheduled' ? 'tab active' : 'tab'} onClick={openScheduled}>Schedule</button>
      {sessions.map((session) => <div className="session-row" key={session.id}><button className="session" onClick={() => loadSession(session.id)}>{session.title}</button><button className="delete-session" onClick={() => setDeleteCandidate(session)} aria-label={`Delete ${session.title}`}>x</button></div>)}
    </aside>
    <section>
      {view === 'automation' ? <AutomationPanel onBack={() => setView('chat')} /> : view === 'scheduled' ? <ScheduledAutomationPanel onBack={() => setView('chat')} /> : <>
      <header><div><label>PHASE ONE</label><h1>How can I help?</h1></div><button className={`openai-settings-trigger ${configured ? 'good' : ''}`} onClick={() => setShowOpenAISettings(true)}>{configured ? 'OpenAI ready' : 'Demo mode · add key'}</button></header>
      <div className="messages">
        {!messages.length && <div className="empty"><h2>Ask about anything on your screen</h2><p>Type a question or share a screen snapshot for visual help.</p></div>}
        {messages.map((message, index) => <article className={message.role} key={index}><i>{message.role === 'user' ? 'You' : 'AI'}</i><div>{message.screenshot && <img className="message-screenshot" src={message.screenshot} alt="Sent screen snapshot" />}{message.content || (busy && message.role === 'assistant' ? 'Thinking...' : '...')}</div></article>)}
      </div>
      <div className="composer">

        {sharing && <div className="share-toolbar"><span className="share-status">Screen sharing ready</span><button onClick={captureScreen} disabled={busy}>Capture screen</button><button className="close-share" onClick={closeSharing} disabled={busy}>Close screen share</button></div>}
        {preview && <div className="screen-preview"><div className="preview-label">Screen snapshot attached</div><img src={preview} alt="Screen snapshot attached to your message" /><button onClick={() => setPreview(null)} disabled={busy}>Remove</button></div>}
        <textarea ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Ask a question" disabled={busy} />
        <footer><small>{status}</small><span>{!sharing && <button onClick={startSharing} disabled={busy}>Share screen</button>}{sharing && !preview && <button onClick={captureScreen} disabled={busy}>Capture screen</button>}<button className="send" onClick={sendMessage} disabled={busy || !text.trim()}>Send</button></span></footer>
      </div>
      </>}
    </section>
    {showOpenAISettings && <OpenAISettingsModal configured={configured} onClose={() => setShowOpenAISettings(false)} onSaved={refreshConfig} />}
    {deleteCandidate && <div className="modal-backdrop" role="presentation"><div className="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="modal-icon">!</div><div><h2 id="delete-title">Delete chat?</h2><p>This will permanently remove "{deleteCandidate.title}" and its messages.</p></div><div className="modal-actions"><button onClick={() => setDeleteCandidate(null)}>Cancel</button><button className="danger" onClick={deleteSession}>Delete chat</button></div></div></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(isFloating ? <Button /> : <Chat />);