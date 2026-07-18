import { useEffect, useRef, useState } from 'react';
import GameCanvas from './game/GameCanvas';

export default function App() {
  const gameRef = useRef(null);
  const inputRef = useRef(null);
  const toastTimer = useRef(null);
  const settleTimer = useRef(null);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [shaping, setShaping] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (text, detail) => {
    clearTimeout(toastTimer.current);
    setToast({ text, detail });
    toastTimer.current = setTimeout(() => setToast(null), detail ? 10000 : 4000);
  };

  // Prompting stays locked until the terrain animation settles.
  const watchUntilIdle = () => {
    setShaping(true);
    clearInterval(settleTimer.current);
    settleTimer.current = setInterval(() => {
      if (!gameRef.current?.isBusy()) {
        clearInterval(settleTimer.current);
        setShaping(false);
      }
    }, 150);
  };

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearInterval(settleTimer.current);
  }, []);

  const locked = busy || shaping;

  const submit = async (e) => {
    e.preventDefault();
    const text = command.trim();
    if (!text || locked) return;
    const { x, y } = gameRef.current.getCharTile();
    setBusy(true);
    try {
      const res = await fetch('/api/terrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text, charX: x, charY: y, map: gameRef.current.mapSnapshot() })
      });
      const data = await res.json();
      if (data.debug) console.error('[terrain api]', data.debug);
      if (data.engine_data && gameRef.current.applyEngineData(data.engine_data)) watchUntilIdle();
      showToast(data.notification || 'The land shifts quietly.', data.debug);
      setCommand('');
    } catch {
      showToast('Could not reach the terrain server.');
    } finally {
      setBusy(false);
      inputRef.current?.blur();
    }
  };

  const undo = () => {
    if (locked) return;
    showToast(gameRef.current?.undo() ? 'Reverted the last change.' : 'Nothing to undo.');
  };

  return (
    <>
      <GameCanvas ref={gameRef} />
      <form className="command-bar" onSubmit={submit}>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="create grass"
          disabled={locked}
          spellCheck={false}
        />
        <button type="submit" disabled={locked}>{busy ? '…' : shaping ? 'shaping' : 'shape'}</button>
        <button type="button" className="undo" onClick={undo} disabled={locked} title="Undo last change">
          ↶
        </button>
      </form>
      {toast && (
        <div className="toast">
          {toast.text}
          {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        </div>
      )}
    </>
  );
}
