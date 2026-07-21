import { useState } from 'react';

export default function OpenAISettingsModal({ configured, onClose, onSaved }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function clearKey() { setSaving(true); setError(''); try { await window.companion.clearOpenAISettings(); onSaved(); onClose(); } catch (err) { setError(err.message || 'Could not delete saved key.'); } finally { setSaving(false); } }
  async function save() {
    if (!apiKey.trim()) return setError('Enter an OpenAI API key.');
    setSaving(true); setError('');
    try { await window.companion.saveOpenAISettings({ apiKey, model }); onSaved(); onClose(); }
    catch (err) { setError(err.message || 'Could not save settings.'); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop"><div className="openai-settings" role="dialog" aria-modal="true" aria-labelledby="openai-settings-title"><h2 id="openai-settings-title">OpenAI settings</h2><p>{configured ? 'Replace the saved API key if needed.' : 'No API key is saved. The app is currently in Demo mode.'}</p><label>OpenAI API key<input type="password" value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="sk-..." autoFocus /></label><label>Model<input value={model} onChange={(e)=>setModel(e.target.value)} /></label><small>Recommended: gpt-5-mini for lower cost.</small>{error&&<div className="settings-error">{error}</div>}<div className="modal-actions">{configured && <button className="clear-key" onClick={clearKey} disabled={saving}>Delete saved key</button>}<button onClick={onClose} disabled={saving}>Cancel</button><button className="danger" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save OpenAI key'}</button></div></div></div>;
}