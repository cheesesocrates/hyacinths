import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { animate, scrambleText } from 'animejs';
import GameCanvas from './game/GameCanvas';

// Rotating splash-screen placeholder: "create" stays fixed and never
// scrambles — only this suffix (one per supported terrain) animates.
const PLACEHOLDER_SUFFIXES = [
  'grass',
  'a desert',
  'a forest',
  'mountains',
  'a river',
  'a lake',
  'an ocean',
  'a savannah',
  'tundra'
];

// Numeric (unitless = px) target styles the bar/input/button settle into
// once the splash screen hands off to normal play — also what the
// first-submit GSAP transition animates toward.
const NORMAL_STYLE = {
  bar: { top: 40, padding: 6, borderRadius: 18 },
  wrap: { width: 440 },
  input: { paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, fontSize: 15, borderRadius: 12 },
  button: { paddingTop: 8, paddingBottom: 8, paddingLeft: 14, paddingRight: 14, fontSize: 14, borderRadius: 12 }
};

// Would an ocean centered at (ed.centerX, ed.centerY) with ed.maxRadius bury
// any land the player already built? Scans the near-map snapshot for a cell
// within Euclidean reach that is neither empty void ('.') nor the player
// ('P'). Fully defensive: a null/malformed snapshot returns false so the
// caller falls through to applying directly rather than throwing.
function oceanCoversBuiltLand(mapSnap, ed) {
  if (!mapSnap || !Array.isArray(mapSnap.rows)) return false;
  const { originX, originY, rows } = mapSnap;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (typeof row !== 'string') continue;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.' || ch === 'P') continue;
      const x = originX + c;
      const y = originY + r;
      if (Math.hypot(x - ed.centerX, y - ed.centerY) <= ed.maxRadius) return true;
    }
  }
  return false;
}

export default function App() {
  const gameRef = useRef(null);
  const inputRef = useRef(null);
  const barRef = useRef(null);
  const wrapRef = useRef(null);
  const submitBtnRef = useRef(null);
  const placeholderRef = useRef(null);
  const toastTimer = useRef(null);
  const settleTimer = useRef(null);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [shaping, setShaping] = useState(false);
  const [toast, setToast] = useState(null);
  // Splash screen (big lower bar, cycling placeholder, no other UI) shows
  // until the player submits their first command.
  const [started, setStarted] = useState(false);
  // Questions the player must answer before terrain applies:
  // { data, steps: ['connect'?, 'overwrite'?] } — answered front to back.
  const [pending, setPending] = useState(null);
  // Savanna wildlife: off at first. A sidebar slides in from the right to
  // point players at the toggle; the create bar can flip it too (ed.animals).
  const [animalsOn, setAnimalsOn] = useState(false);
  const [wildlifeOpen, setWildlifeOpen] = useState(false);

  // Single path for flipping the wildlife on/off, shared by the sidebar
  // switch and the create-bar command so the UI and engine never disagree.
  const toggleAnimals = (on) => {
    setAnimalsOn(on);
    gameRef.current?.setAnimals(on);
  };

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

  // The wildlife sidebar announces itself shortly after load, sliding in from
  // the right so players discover the animals toggle (they start off).
  useEffect(() => {
    const t = setTimeout(() => setWildlifeOpen(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Splash-screen placeholder: only the suffix after "create" scrambles
  // from one example straight into the next, on a loop, until the first
  // command is submitted. anime.js's scrambleText drives the reveal itself
  // (left-to-right lock-in) — no fade, the scramble transition IS the
  // transition.
  useEffect(() => {
    if (started) return undefined;
    const el = placeholderRef.current;
    if (!el) return undefined;
    let idx = 0;
    let cancelled = false;
    let anim = null;
    let timeoutId = null;
    el.textContent = '';
    const next = () => {
      if (cancelled) return;
      anim = animate(el, {
        textContent: scrambleText({
          text: PLACEHOLDER_SUFFIXES[idx],
          chars: 'lowercase',
          from: 'left',
          duration: 1700,
          revealDelay: 300
        }),
        onComplete: () => {
          timeoutId = setTimeout(() => {
            idx = (idx + 1) % PLACEHOLDER_SUFFIXES.length;
            next();
          }, 1600);
        }
      });
    };
    next();
    return () => {
      cancelled = true;
      anim?.cancel();
      clearTimeout(timeoutId);
    };
  }, [started]);

  // Animates the splash bar shrinking back up to its normal compact size
  // and position. Fires once, right as the first command is submitted.
  //
  // React 18 batches the setStarted(true) that flips the splash CSS class
  // off, so the class actually switches on the DOM slightly later than this
  // call — possibly before GSAP's own (lazy, tick-time) "from" capture would
  // otherwise run, which would make it animate from the already-collapsed
  // values instead of the splash ones. Reading the real starting values
  // with getBoundingClientRect/getComputedStyle right now, synchronously,
  // and pinning them as explicit inline styles before building the
  // timeline sidesteps that race entirely.
  const collapseToNormal = () => {
    const bar = barRef.current;
    const wrap = wrapRef.current;
    const input = inputRef.current;
    const btn = submitBtnRef.current;
    if (!bar || !wrap || !input || !btn) return;
    const cs = (el) => getComputedStyle(el);
    const num = (v) => parseFloat(v) || 0;
    const from = {
      bar: { top: bar.getBoundingClientRect().top, padding: num(cs(bar).padding), borderRadius: num(cs(bar).borderRadius) },
      wrap: { width: wrap.getBoundingClientRect().width },
      input: {
        paddingTop: num(cs(input).paddingTop),
        paddingBottom: num(cs(input).paddingBottom),
        paddingLeft: num(cs(input).paddingLeft),
        paddingRight: num(cs(input).paddingRight),
        fontSize: num(cs(input).fontSize),
        borderRadius: num(cs(input).borderRadius)
      },
      button: {
        paddingTop: num(cs(btn).paddingTop),
        paddingBottom: num(cs(btn).paddingBottom),
        paddingLeft: num(cs(btn).paddingLeft),
        paddingRight: num(cs(btn).paddingRight),
        fontSize: num(cs(btn).fontSize),
        borderRadius: num(cs(btn).borderRadius)
      }
    };
    const targets = [bar, wrap, input, btn];
    gsap.set(bar, from.bar);
    gsap.set(wrap, from.wrap);
    gsap.set(input, from.input);
    gsap.set(btn, from.button);
    gsap
      .timeline({
        defaults: { duration: 1.1, ease: 'power2.inOut' },
        onComplete: () => gsap.set(targets, { clearProps: 'all' })
      })
      .to(bar, NORMAL_STYLE.bar, 0)
      .to(wrap, NORMAL_STYLE.wrap, 0)
      .to(input, NORMAL_STYLE.input, 0)
      .to(btn, NORMAL_STYLE.button, 0);
  };

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
    if (step === 'oceanfill') {
      // Ocean is always created either way: yes overwrites (floods) the land
      // in its path; no leaves every existing pixel untouched and fills only
      // the empty void around it.
      setPending(null);
      data.overwrite = yes;
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

  // 'r' jumps into the command box to type; Escape hands control back to
  // WASD movement. GameCanvas's own keydown listener already ignores WASD
  // while an input is focused, so this is the other half of that toggle.
  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (typing && e.key === 'Escape') {
        e.preventDefault();
        active.blur();
      } else if (!typing && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const raw = command.trim();
    if (!raw || locked) return;
    const isFirst = !started;
    if (isFirst) {
      setStarted(true);
      collapseToNormal();
    }
    // "/overwrite" anywhere in the message forces the new terrain to replace
    // whatever already exists. It's stripped before the prompt reaches the AI.
    const forceOverwrite = /(^|\s)\/overwrite(\s|$)/i.test(raw);
    const text = raw.replace(/(^|\s)\/overwrite(\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      showToast('Add what to create, e.g. "/overwrite forest".');
      return;
    }
    const { x, y } = gameRef.current.getCharTile();
    const mapSnap = gameRef.current.mapSnapshot();
    setBusy(true);
    try {
      const res = await fetch('/api/terrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text, charX: x, charY: y, map: mapSnap })
      });
      const data = await res.json();
      if (data.debug) console.error('[terrain api]', data.debug);
      const ed = data.engine_data;
      if (forceOverwrite && ed) ed.overwrite = true;
      const note = data.notification || 'The land shifts quietly.';
      // Clouds are a standalone toggle with no terrain involved — handle it
      // before the "nothing to do" early-return below would otherwise
      // swallow it.
      if (ed && typeof ed.clouds === 'boolean') {
        gameRef.current?.setClouds(ed.clouds);
      }
      // Wildlife is a standalone toggle too — flip it (and reflect the state
      // in the sidebar switch) before the "nothing to do" return below.
      if (ed && typeof ed.animals === 'boolean') {
        toggleAnimals(ed.animals);
      }
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
      // An ocean would otherwise silently flood existing land (the engine
      // treats grass as a free base layer). When one would bury land the
      // player built, ask "overwrite?": yes floods everything in its path,
      // but no still places the ocean — only in empty (white) space, leaving
      // every existing pixel untouched (see the 'oceanfill' case in answer).
      if (ed.terrain === 'ocean' && !forceOverwrite && oceanCoversBuiltLand(mapSnap, ed)) {
        steps.push('oceanfill');
      } else if (ed.overwrite && !forceOverwrite) {
        steps.push('overwrite');
      }
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

  // Renders the whole world (not just the viewport) to an image, opens it
  // in a new tab so the player can immediately see/save/share it, and
  // best-effort hands it to the native share sheet where that's supported.
  const share = async () => {
    if (locked) return;
    const canvas = gameRef.current?.renderFullMap?.();
    if (!canvas) {
      showToast('Create some land first — nothing to share yet.');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open();
    if (win) {
      win.document.title = 'Your world';
      win.document.body.style.margin = '0';
      win.document.body.style.background = '#111';
      const img = win.document.createElement('img');
      img.src = dataUrl;
      img.style.width = '100%';
      img.style.imageRendering = 'pixelated';
      win.document.body.appendChild(img);
      showToast("Here's your world — save or share the image from that tab.");
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'world.png';
      a.click();
      showToast('Downloaded a picture of your world.');
    }
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'world.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My world' });
      }
    } catch {
      // Best-effort only — the new tab/download above already covers it.
    }
  };

  return (
    <>
      <GameCanvas ref={gameRef} />
      <form ref={barRef} className={started ? 'command-bar' : 'command-bar splash'} onSubmit={submit}>
        <div ref={wrapRef} className="input-wrap">
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={started ? 'Make the world a better place' : ''}
            disabled={locked}
            spellCheck={false}
          />
          {!started && (
            <span className="placeholder-overlay" style={{ opacity: command ? 0 : 1 }}>
              <span className="placeholder-fixed">create</span>
              <span ref={placeholderRef} />
            </span>
          )}
        </div>
        <button ref={submitBtnRef} type="submit" disabled={locked}>
          {busy ? '…' : shaping ? 'shaping' : 'shape'}
        </button>
        {started && (
          <button type="button" className="undo" onClick={undo} disabled={locked} title="Undo last change">
            ↶
          </button>
        )}
        {started && (
          <button type="button" className="share" onClick={share} disabled={locked} title="Share a picture of your world">
            ↗
          </button>
        )}
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
      {started && (
        <div className="zoom-bar">
          <button type="button" onClick={() => zoom(1.2)} title="Zoom in (scroll up / +)">+</button>
          <button type="button" onClick={() => zoom(1 / 1.2)} title="Zoom out (scroll down / -)">−</button>
        </div>
      )}
      {toast && (
        <div className="toast">
          {toast.text}
          {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        </div>
      )}
      {!wildlifeOpen && (
        <button
          type="button"
          className="wildlife-handle"
          onClick={() => setWildlifeOpen(true)}
          title="Wildlife"
          aria-label="Show wildlife panel"
        >
          🦓
        </button>
      )}
      <div className={wildlifeOpen ? 'wildlife-panel open' : 'wildlife-panel'}>
        <div className="wildlife-body">
          <div className="wildlife-head">
            <span className="wildlife-title">Savanna wildlife</span>
            <button type="button" className="wildlife-close" onClick={() => setWildlifeOpen(false)} title="Hide">
              ×
            </button>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={animalsOn}
            className={animalsOn ? 'wildlife-switch on' : 'wildlife-switch'}
            onClick={() => toggleAnimals(!animalsOn)}
          >
            <span className="wildlife-switch-label">Animals</span>
            <span className="wildlife-track">
              <span className="wildlife-knob" />
            </span>
          </button>
          <p className="wildlife-hint">
            Lions hunt and zebras bolt across the <b>savannah</b>. You can toggle animals through the create bar too.
          </p>
        </div>
      </div>
    </>
  );
}
