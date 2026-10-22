import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { animate, scrambleText } from 'animejs';
import GameCanvas from './game/GameCanvas';
import { looksLikeCode } from './game/sharecode';
import { requestTerrain } from './ai/terrain';
import { loadKeys, saveKeys, clearKeys } from './ai/keys';
import { PROVIDERS, PROVIDER_BY_ID, isUsable, usableProviders } from './ai/providers';

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

// The bar/input/button geometry the splash transition animates between,
// read straight off the live elements. Both ends are MEASURED rather than
// hardcoded so the stylesheet stays the single source of truth — the bar is
// sized fluidly and its padding, font sizes and position all change across
// breakpoints, and a table of pixel targets here would land on desktop
// values mid-animation on a phone before snapping to the real ones.
function measureBarGeometry(bar, wrap, input, btn) {
  const num = (v) => parseFloat(v) || 0;
  const box = (el, keys) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(keys.map((k) => [k, num(cs[k])]));
  };
  const padFont = ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'fontSize', 'borderRadius'];
  const barCs = getComputedStyle(bar);
  return {
    // The bar's padding is uniform, so its top edge stands in for the
    // shorthand — computed `padding` resolves to "" when the sides differ,
    // which would silently animate it to 0.
    bar: {
      top: bar.getBoundingClientRect().top,
      padding: num(barCs.paddingTop),
      borderRadius: num(barCs.borderRadius)
    },
    wrap: { width: wrap.getBoundingClientRect().width },
    input: box(input, padFont),
    button: box(btn, padFont)
  };
}

// Slash "functions" typed into the create bar. /overwrite is a modifier on a
// terrain command; /cloud and /animal are standalone toggles. Typing "/" pops
// the menu below the bar (see the slash-menu render) listing these.
const SLASH_FUNCTIONS = [
  { name: '/overwrite', desc: 'Force new terrain to replace whatever is already there' },
  { name: '/cloud', desc: 'Toggle the drifting clouds on or off' },
  { name: '/animal', desc: 'Toggle the wildlife (savanna + forest) on or off' },
  { name: '/share', desc: 'Copy a code that rebuilds this world somewhere else' },
  { name: '/load', desc: 'Paste a world code after it to build that world here' }
];

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
  // Wildlife + clouds are engine toggles mirrored into React so the
  // /animal and /cloud functions and the AI command all agree. Animals
  // start on; clouds start off.
  const [animalsOn, setAnimalsOn] = useState(true);
  const [cloudsOn, setCloudsOn] = useState(false);
  // A one-shot tip that pops up and fades the first time a biome is shaped.
  const [tip, setTip] = useState(null);
  const tipTimer = useRef(null);
  const tipShown = useRef(false);
  const keyTipShown = useRef(false);
  // The player's own provider choice and API keys (bring-your-own-key — see
  // ai/keys.js), and the key panel's working copy while it's open (null when
  // closed). Edits only land in `keys` on save, so cancelling leaves the live
  // keys untouched.
  const [keys, setKeys] = useState(loadKeys);
  const [keyDraft, setKeyDraft] = useState(null);
  const activeProvider = usableProviders(keys)[0] ?? null;
  const hasKey = !!activeProvider;
  const draftProvider = keyDraft ? PROVIDER_BY_ID[keyDraft.provider] : null;
  const draftBackups = keyDraft ? usableProviders(keyDraft).filter((p) => p !== draftProvider) : [];

  const toggleAnimals = (on) => {
    setAnimalsOn(on);
    gameRef.current?.setAnimals(on);
  };
  const toggleClouds = (on) => {
    setCloudsOn(on);
    gameRef.current?.setClouds(on);
  };

  // Pops the transient tip; it slides in and clears itself after a beat.
  const showTip = (text) => {
    clearTimeout(tipTimer.current);
    setTip(text);
    tipTimer.current = setTimeout(() => setTip(null), 7000);
  };

  // `selectable` opts a toast out of the usual click-through behaviour, for
  // details the player needs to be able to highlight and copy (world codes).
  const showToast = (text, detail, selectable) => {
    clearTimeout(toastTimer.current);
    setToast({ text, detail, selectable });
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
    clearTimeout(tipTimer.current);
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
  //
  // The DESTINATION is measured the same way, by briefly dropping the splash
  // class to let the stylesheet lay the bar out at whatever the current
  // viewport calls for, then putting it back. That keeps the transition
  // correct at every breakpoint without this file having to restate any of
  // the responsive geometry.
  const collapseToNormal = () => {
    const bar = barRef.current;
    const wrap = wrapRef.current;
    const input = inputRef.current;
    const btn = submitBtnRef.current;
    if (!bar || !wrap || !input || !btn) return;
    const from = measureBarGeometry(bar, wrap, input, btn);
    bar.classList.remove('splash');
    const to = measureBarGeometry(bar, wrap, input, btn);
    bar.classList.add('splash');

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
      .to(bar, to.bar, 0)
      .to(wrap, to.wrap, 0)
      .to(input, to.input, 0)
      .to(btn, to.button, 0);
  };

  const locked = busy || shaping || !!pending;

  // The confirm-questions an action needs before applying: rivers may ask to
  // connect to nearby water; oceans/overwrites ask before burying existing
  // land (unless /overwrite already forced it).
  const buildSteps = (ed, mapSnap, forceOverwrite) => {
    const steps = [];
    if (ed.terrain === 'river' && ed.connect === 'ask') {
      if (gameRef.current.hasRiverNear(ed.points)) steps.push('connect');
      else ed.connect = true; // nothing nearby — moot either way
    }
    if (ed.terrain === 'ocean' && !forceOverwrite && oceanCoversBuiltLand(mapSnap, ed)) {
      steps.push('oceanfill');
    } else if (ed.overwrite && !forceOverwrite) {
      steps.push('overwrite');
    }
    return steps;
  };

  // Applies a queue of terrain actions in order (one command can produce
  // several — "a desert and an ocean"). An action needing a confirm parks the
  // rest of the queue in `pending` to resume once answered; otherwise it
  // applies straight away. When the queue drains, lock the UI until the
  // animations settle.
  const advance = (queue, mapSnap, forceOverwrite) => {
    while (queue.length) {
      const ed = queue.shift();
      const steps = buildSteps(ed, mapSnap, forceOverwrite);
      if (steps.length) {
        setPending({ data: ed, steps, queue, mapSnap, forceOverwrite });
        return;
      }
      gameRef.current.applyEngineData(ed);
    }
    watchUntilIdle();
  };

  // Answer the current question, then resume the rest of the queue. "connect"
  // no means a separate river; "overwrite" no skips just this one feature.
  const answer = (yes) => {
    if (!pending) return;
    const { mapSnap, forceOverwrite } = pending;
    const queue = pending.queue || [];
    const [step, ...rest] = pending.steps;
    const data = { ...pending.data };
    if (step === 'connect') {
      data.connect = yes;
      if (rest.length) {
        setPending({ ...pending, data, steps: rest });
        return;
      }
      setPending(null);
      gameRef.current.applyEngineData(data);
      advance(queue, mapSnap, forceOverwrite);
      return;
    }
    if (step === 'oceanfill') {
      // Ocean is created either way: yes floods the land in its path; no leaves
      // every existing pixel untouched, filling only the empty void around it.
      setPending(null);
      data.overwrite = yes;
      gameRef.current.applyEngineData(data);
      advance(queue, mapSnap, forceOverwrite);
      return;
    }
    // overwrite question
    setPending(null);
    if (yes) gameRef.current.applyEngineData(data);
    else showToast(queue.length ? 'Skipped that one — nothing overwritten.' : 'Cancelled — nothing was overwritten.');
    advance(queue, mapSnap, forceOverwrite);
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

    // World codes, handled before anything else: they're long opaque blobs,
    // not language, so they must never reach the AI. `/share` copies one for
    // this world; `/load <code>` rebuilds another. A bare pasted code is
    // treated as a /load, since that's the only thing anyone would mean by it.
    if (/^\/share$/i.test(raw)) {
      setCommand('');
      await copyWorldCode();
      return;
    }
    if (/^\/load$/i.test(raw)) {
      showToast('Paste a world code after /load.');
      return;
    }
    // Everything after /load is the code — greedy, because a pasted code can
    // arrive with stray whitespace in it (the decoder strips that out).
    const loadArg = raw.match(/^\/load\s+([\s\S]+)$/i);
    if (loadArg || looksLikeCode(raw)) {
      setCommand('');
      await loadWorldCode(loadArg ? loadArg[1] : raw);
      return;
    }

    // Slash "functions": /overwrite modifies a terrain command; /cloud and
    // /animal are standalone toggles handled right here (no AI round-trip).
    // All slash tokens are stripped before the prompt reaches the AI.
    const forceOverwrite = /(^|\s)\/overwrite(?=\s|$)/i.test(raw);
    const toggleCloudCmd = /(^|\s)\/clouds?(?=\s|$)/i.test(raw);
    const toggleAnimalCmd = /(^|\s)\/animals?(?=\s|$)/i.test(raw);
    const text = raw
      .replace(/(^|\s)\/(overwrite|clouds?|animals?|share|load)(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Fire the toggles now, computing each next state up front for the toast.
    const toggleNotes = [];
    if (toggleCloudCmd) {
      const next = !cloudsOn;
      toggleClouds(next);
      toggleNotes.push(next ? 'clouds on' : 'clouds off');
    }
    if (toggleAnimalCmd) {
      const next = !animalsOn;
      toggleAnimals(next);
      toggleNotes.push(next ? 'animals on' : 'animals off');
    }

    if (!text) {
      // Pure slash command(s) — nothing for the AI to build.
      if (toggleNotes.length) showToast(toggleNotes.join(' · '));
      else showToast('Add what to create, e.g. "forest" or "/animal".');
      setCommand('');
      return;
    }

    const { x, y } = gameRef.current.getCharTile();
    const mapSnap = gameRef.current.mapSnapshot();
    setBusy(true);
    try {
      const data = await requestTerrain({ command: text, charX: x, charY: y, map: mapSnap }, keys);
      if (data.debug) console.error('[terrain ai]', data.debug);
      const note = data.notification || 'The land shifts quietly.';
      // engine_data may be a single action or an array of them ("desert and
      // ocean"). Pull out standalone toggles and apply them inline; keep the
      // terrain actions for the apply queue.
      const actions = (Array.isArray(data.engine_data) ? data.engine_data : [data.engine_data]).filter(Boolean);
      const terrainActions = [];
      for (const a of actions) {
        if (forceOverwrite && a.terrain) a.overwrite = true;
        if (typeof a.clouds === 'boolean') toggleClouds(a.clouds);
        if (typeof a.animals === 'boolean') toggleAnimals(a.animals);
        if (a.terrain) terrainActions.push(a);
      }

      if (!terrainActions.length) {
        showToast(note, data.debug);
        setCommand('');
        return;
      }

      showToast(forceOverwrite ? note + ' (overwriting)' : note, data.debug);
      // Keyless players are on the offline parser — point them at the key
      // panel once. Otherwise the first biome gets the one-shot wildlife tip.
      if (!hasKey && !keyTipShown.current) {
        keyTipShown.current = true;
        showTip('Tip: this is offline mode — bring your own AI key (Gemini, OpenAI, Claude, Groq…) with 🔑 for the full AI.');
      } else if (!tipShown.current) {
        tipShown.current = true;
        showTip('Tip: animals roam the savanna and forest — toggle them with /animal, or type / to see every function.');
      }
      advance(terrainActions, mapSnap, forceOverwrite);
      setCommand('');
    } catch {
      showToast('Something went wrong shaping that — try again.');
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

  // Copies a code that rebuilds this exact world. The code carries the
  // world's build recipe (the seeded actions that made it) rather than its
  // pixels, so it stays short enough to paste into a chat message and needs
  // no server to hand out or store — see game/sharecode.js.
  const copyWorldCode = async () => {
    if (locked) return;
    const code = await gameRef.current?.shareCode();
    if (!code) {
      showToast('Create some land first — no world to share yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast('World code copied — send it to a friend to /load.', code, true);
    } catch {
      // Clipboard refused (insecure origin, denied permission): the toast
      // detail shows the code so it can still be selected and copied.
      showToast('Copy this world code:', code, true);
    }
  };

  // Rebuilds the world from a code, replacing what's here. Decoding fully
  // succeeds or fails before anything is torn down, so a bad code is a
  // no-op rather than a wiped world.
  const loadWorldCode = async (code) => {
    setBusy(true);
    try {
      const count = await gameRef.current?.loadCode(code);
      if (!count) {
        showToast("That doesn't look like a world code.");
        return;
      }
      showToast(`World loaded — ${count} ${count === 1 ? 'feature' : 'features'} rebuilt.`);
    } finally {
      setBusy(false);
      inputRef.current?.blur();
    }
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

  // Key panel: opens on a copy of the live settings; save commits them (and
  // persists where storage allows), forget wipes every key from this browser.
  const openKeys = () => setKeyDraft({ ...keys, keys: { ...keys.keys }, models: { ...keys.models } });
  const closeKeys = () => setKeyDraft(null);
  // 'keys' and 'models' are per-provider maps, so those edits land on the
  // provider currently shown; 'provider' and 'customUrl' are plain fields.
  const editDraft = (field) => (e) => {
    const { value } = e.target;
    setKeyDraft((d) =>
      field === 'keys' || field === 'models'
        ? { ...d, [field]: { ...d[field], [d.provider]: value } }
        : { ...d, [field]: value }
    );
  };
  const submitKeys = (e) => {
    e.preventDefault();
    const { settings, persisted } = saveKeys(keyDraft);
    setKeys(settings);
    setKeyDraft(null);
    // Name whoever will actually answer — the chosen provider, or the first
    // backup when the chosen one has no key yet.
    const [first] = usableProviders(settings);
    if (!first) showToast('No key set — playing in offline mode.');
    else if (persisted) showToast(`Using ${first.name} — keys stay in this browser only.`);
    else showToast(`Using ${first.name} for this visit — this browser can't store keys.`);
  };
  const forgetKeys = () => {
    setKeys(clearKeys());
    setKeyDraft(null);
    showToast('Keys forgotten — nothing is stored in this browser now.');
  };

  // The "/" menu shows while the current token is a slash query — typing "/"
  // lists every function; "/cl" filters to /cloud, and so on.
  const slashQuery = (() => {
    const m = command.match(/(?:^|\s)(\/[a-z]*)$/i);
    return m ? m[1].toLowerCase() : null;
  })();
  const slashMatches = slashQuery ? SLASH_FUNCTIONS.filter((f) => f.name.startsWith(slashQuery)) : [];
  const pickSlash = (name) => {
    setCommand((cur) => cur.replace(/(^|\s)(\/[a-z]*)$/i, (m, pre) => pre + name + ' '));
    inputRef.current?.focus();
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
        {started && (
          <button
            type="button"
            className="code"
            onClick={copyWorldCode}
            disabled={locked}
            title="Copy a code that rebuilds your world (/share) — paste one with /load"
          >
            ⧉
          </button>
        )}
        {slashMatches.length > 0 && (
          <div className="slash-menu">
            {slashMatches.map((f) => (
              // onMouseDown (not onClick) so the pick lands before the input blurs.
              <button
                type="button"
                key={f.name}
                className="slash-item"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  pickSlash(f.name);
                }}
              >
                <span className="slash-name">{f.name}</span>
                <span className="slash-desc">{f.desc}</span>
              </button>
            ))}
          </div>
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
      <div className="zoom-bar">
        {/* Shown from the splash on, so keyless players can find it before
            their first command. Locked while a request or question is open:
            the confirm popup's Enter/Backspace keys would hijack typing. */}
        <button
          type="button"
          className={hasKey ? 'key' : 'key needs-key'}
          onClick={openKeys}
          disabled={busy || !!pending}
          title={
            hasKey
              ? `AI: ${activeProvider.name} — your key is stored in this browser only`
              : 'Add your own AI key — offline mode until you do'
          }
        >
          {hasKey ? '🔑' : '🔑 add AI key'}
        </button>
        {started && (
          <>
            <button type="button" onClick={() => zoom(1.2)} title="Zoom in (scroll up / +)">+</button>
            <button type="button" onClick={() => zoom(1 / 1.2)} title="Zoom out (scroll down / -)">−</button>
          </>
        )}
      </div>
      {keyDraft && (
        // Wheel events stop here so scrolling the panel doesn't zoom the world
        // underneath (GameCanvas listens for the wheel on window).
        <div
          className="key-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && closeKeys()}
          onWheel={(e) => e.stopPropagation()}
        >
          <form className="key-panel" onSubmit={submitKeys} onKeyDown={(e) => e.key === 'Escape' && closeKeys()}>
            <h2>Bring your own key</h2>
            <p>
              Hyacinths shapes terrain from what you type using an AI model from whichever provider you pick, with
              your own API key. Keys are kept only in this browser and sent straight to that provider. There is no
              Hyacinths server, so nobody else ever sees them.
            </p>
            <label>
              <span className="key-label">AI provider</span>
              <select value={keyDraft.provider} onChange={editDraft('provider')}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {isUsable(keyDraft, p) ? `${p.name} ✓` : p.name}
                  </option>
                ))}
              </select>
            </label>
            {draftProvider.custom && (
              <label>
                <span className="key-label">Base URL</span>
                <input
                  type="url"
                  value={keyDraft.customUrl}
                  onChange={editDraft('customUrl')}
                  placeholder="https://api.example.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <label>
              <span className="key-label">
                <span>API key {draftProvider.custom && <em>if it needs one</em>}</span>
                {draftProvider.keyUrl && (
                  <a href={draftProvider.keyUrl} target="_blank" rel="noreferrer">
                    get a key ↗
                  </a>
                )}
              </span>
              <input
                type="password"
                value={keyDraft.keys[keyDraft.provider] ?? ''}
                onChange={editDraft('keys')}
                placeholder="paste your key"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            <label>
              <span className="key-label">
                <span>Model {!draftProvider.custom && <em>optional</em>}</span>
              </span>
              <input
                value={keyDraft.models[keyDraft.provider] ?? ''}
                onChange={editDraft('models')}
                placeholder={draftProvider.defaultModel || 'model name'}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {draftBackups.length > 0 && (
              <p className="key-note">
                If {draftProvider.name} fails, your other saved {draftBackups.length === 1 ? 'key is' : 'keys are'}{' '}
                tried next: {draftBackups.map((p) => p.name).join(', ')}.
              </p>
            )}
            <p className="key-note">No key? The game still plays, using a simple offline keyword parser.</p>
            <div className="key-actions">
              {hasKey && (
                <button type="button" className="forget" onClick={forgetKeys}>
                  forget keys
                </button>
              )}
              <button type="button" className="cancel" onClick={closeKeys}>
                cancel
              </button>
              <button type="submit" className="save">
                save
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && (
        <div className={toast.selectable ? 'toast selectable' : 'toast'}>
          {toast.text}
          {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        </div>
      )}
      {tip && <div className="game-tip">{tip}</div>}
    </>
  );
}
