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
  // Questions the player must answer before terrain applies:
  // { data, steps: ['connect'?, 'overwrite'?] } — answered front to back.
  const [pending, setPending] = useState(null);

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

  const locked = busy || shaping || !!pending;

  const applyNow = (data) => {
    if (gameRef.current.applyEngineData(data)) watchUntilIdle();
  };

  // Answer the current question. "connect" no just means a separate river
  // and moves on; "overwrite" no cancels the whole generation.
  const answer = (yes) => {
    if (!pending) return;
    const [step, ...rest] = pending.steps;
    const data = { ...pending.data };
    if (step === 'connect') {
      data.connect = yes;
      if (rest.length) {
        setPending({ data, steps: rest });
        return;
      }
      setPending(null);
      applyNow(data);
      return;
    }
    // overwrite question
    setPending(null);
    if (yes) {
      applyNow(data);
    } else {
      showToast('Cancelled — nothing was overwritten.');
    }
  };

  // While a question popup is open: Enter agrees, Backspace/Delete (or the
  // no button) declines.
  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        answer(true);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        answer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending]);

  const submit = async (e) => {
    e.preventDefault();
    const raw = command.trim();
    if (!raw || locked) return;
    // "/overwrite" anywhere in the message forces the new terrain to replace
    // whatever already exists. It's stripped before the prompt reaches the AI.
    const forceOverwrite = /(^|\s)\/overwrite(\s|$)/i.test(raw);
    const text = raw.replace(/(^|\s)\/overwrite(\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      showToast('Add what to create, e.g. "/overwrite forest".');
      return;
    }
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
      const ed = data.engine_data;
      if (forceOverwrite && ed) ed.overwrite = true;
      const note = data.notification || 'The land shifts quietly.';
      if (!ed || !ed.terrain) {
        showToast(note, data.debug);
        setCommand('');
        return;
      }
      // Build the question chain: rivers with an unspecified "connect" ask
      // about joining nearby water first; any overwrite the player didn't
      // force with /overwrite asks before anything is destroyed.
      const steps = [];
      if (ed.terrain === 'river' && ed.connect === 'ask') {
        if (gameRef.current.hasRiverNear(ed.points)) steps.push('connect');
        else ed.connect = true; // nothing nearby — moot either way
      }
      if (ed.overwrite && !forceOverwrite) steps.push('overwrite');
      showToast(forceOverwrite ? note + ' (overwriting)' : note, data.debug);
      if (steps.length) {
        setPending({ data: ed, steps });
      } else {
        if (gameRef.current.applyEngineData(ed)) watchUntilIdle();
      }
      setCommand('');
    } catch {
      showToast('Could not reach the terrain server.');
    } finally {
      setBusy(false);
      inputRef.current?.blur();
    }
  };

  const zoom = (factor) => gameRef.current?.zoomBy(factor);

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
      {pending && (
        <div className="confirm-pop">
          <span>{pending.steps[0] === 'connect' ? 'connect to nearby river?' : 'overwrite?'}</span>
          <button type="button" className="yes" onClick={() => answer(true)} title="Yes (Enter)">
            yes
          </button>
          <button type="button" className="no" onClick={() => answer(false)} title="No (Backspace)">
            no
          </button>
        </div>
      )}
      <div className="zoom-bar">
        <button type="button" onClick={() => zoom(1.2)} title="Zoom in (scroll up / +)">+</button>
        <button type="button" onClick={() => zoom(1 / 1.2)} title="Zoom out (scroll down / -)">−</button>
      </div>
      {toast && (
        <div className="toast">
          {toast.text}
          {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        </div>
      )}
    </>
  );
}
