import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Engine } from './engine';
import idleUrl from '../../assets/everything.png';
import walkUrl from '../../assets/everything_walks.png';
import waterUrl from '../../assets/everything_water.png';

// Every PNG anywhere under nature_pack loads automatically (per-biome
// subfolders like nature_pack/desert/ are fine — only the filename matters)
// and groups by base name with trailing digits stripped, so "acacia.png",
// "acacia1.png", "acacia2.png" all become variants of "acacia". Drop in a
// new numbered file and it's picked up on the next build/reload — no code
// changes needed.
const natureModules = import.meta.glob('../../assets/nature_pack/**/*.png', { eager: true, import: 'default' });

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function groupVariantUrls(modules) {
  const groups = {};
  for (const path in modules) {
    const file = path.split('/').pop();
    const base = file.replace(/\d*\.png$/i, '');
    (groups[base] ??= []).push(modules[path]);
  }
  for (const key in groups) groups[key].sort();
  return groups;
}

async function loadVariantGroups(modules) {
  const groups = groupVariantUrls(modules);
  const loaded = {};
  await Promise.all(
    Object.entries(groups).map(async ([base, urls]) => {
      loaded[base] = await Promise.all(urls.map(loadImage));
    })
  );
  return loaded;
}

const GameCanvas = forwardRef(function GameCanvas(_props, ref) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getCharTile() {
      return engineRef.current ? engineRef.current.charTile() : { x: 0, y: 0 };
    },
    applyEngineData(data) {
      return engineRef.current ? engineRef.current.applyEngineData(data) : false;
    },
    mapSnapshot() {
      return engineRef.current ? engineRef.current.mapSnapshot() : null;
    },
    isBusy() {
      return engineRef.current ? engineRef.current.isBusy() : false;
    },
    undo() {
      return engineRef.current ? engineRef.current.undo() : false;
    },
    zoomBy(factor) {
      engineRef.current?.zoomBy(factor);
    },
    hasRiverNear(points) {
      return engineRef.current ? engineRef.current.hasRiverNear(points) : false;
    },
    setClouds(on) {
      engineRef.current?.setClouds(on);
    },
    setAnimals(on) {
      engineRef.current?.setAnimals(on);
    },
    renderFullMap() {
      return engineRef.current ? engineRef.current.renderFullMap() : null;
    },
    shareCode() {
      return engineRef.current ? engineRef.current.shareCode() : Promise.resolve(null);
    },
    loadCode(code) {
      return engineRef.current ? engineRef.current.loadCode(code) : Promise.resolve(null);
    }
  }));

  useEffect(() => {
    let raf = 0;
    let disposed = false;

    const boot = async () => {
      const [idle, walk, water, decor] = await Promise.all([
        loadImage(idleUrl),
        loadImage(walkUrl),
        loadImage(waterUrl),
        loadVariantGroups(natureModules)
      ]);
      if (disposed) return;
      const engine = new Engine(canvasRef.current, { idle, walk, water, decor });
      engineRef.current = engine;

      let last = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        engine.update(dt);
        engine.draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    boot();

    const isTyping = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    const onKeyDown = (e) => {
      if (isTyping(e)) return;
      // +/- (and =) zoom the world from the keyboard too.
      if (e.key === '+' || e.key === '=') {
        engineRef.current?.zoomBy(1.15);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        engineRef.current?.zoomBy(1 / 1.15);
        return;
      }
      engineRef.current?.setKey(e.code, true);
    };
    const onKeyUp = (e) => engineRef.current?.setKey(e.code, false);
    const onResize = () => engineRef.current?.resize(window.innerWidth, window.innerHeight);
    const onWheel = (e) => {
      e.preventDefault();
      engineRef.current?.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" />;
});

export default GameCanvas;
