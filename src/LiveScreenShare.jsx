import { useCallback, useEffect, useRef, useState } from 'react';

// Optional live-only component. Frames stay local until the user sends a message.
export default function LiveScreenShare({ onFrame, onClose }) {
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState('Starting smooth live preview...');
  const captureInProgress = useRef(false);

  const refreshFrame = useCallback(async () => {
    if (captureInProgress.current) return;
    captureInProgress.current = true;
    try {
      const image = await window.companion.captureLiveFrame();
      onFrame(image);
      setStatus('Live screen updates locally every 3 seconds.');
    } catch (error) {
      setStatus(`Live preview failed: ${error.message}`);
    } finally {
      captureInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refreshFrame();
    const interval = window.setInterval(refreshFrame, 3000);
    return () => window.clearInterval(interval);
  }, [active, refreshFrame]);

  return <div className="live-share-card">
    <div className="live-share-heading"><div><strong>Live screen share</strong><small>{status}</small></div><span className={active ? 'live-indicator active' : 'live-indicator'}>{active ? 'LIVE' : 'PAUSED'}</span></div>
    <div className="live-share-actions">
      {active ? <button onClick={() => setActive(false)}>Pause</button> : <button onClick={() => setActive(true)}>Resume</button>}
      <button onClick={refreshFrame}>Refresh now</button>
      <button className="close-share" onClick={onClose}>Stop live share</button>
    </div>
    <p className="live-share-note">The small chat stays visible to you but is excluded from live screenshots.</p>
  </div>;
}