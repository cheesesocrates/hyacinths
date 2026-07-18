import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Engine } from './engine';
import idleUrl from '../../assets/everything.png';
import walkUrl from '../../assets/everything_walks.png';
import waterUrl from '../../assets/everything_water.png';
import treeUrl from '../../assets/nature_pack/tree.png';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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
    }
  }));

  useEffect(() => {
    let raf = 0;
    let disposed = false;

    const boot = async () => {
      const [idle, walk, water, tree] = await Promise.all([
        loadImage(idleUrl),
        loadImage(walkUrl),
        loadImage(waterUrl),
        loadImage(treeUrl)
      ]);
      if (disposed) return;
      const engine = new Engine(canvasRef.current, { idle, walk, water, tree });
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
      engineRef.current?.setKey(e.code, true);
    };
    const onKeyUp = (e) => engineRef.current?.setKey(e.code, false);
    const onResize = () => engineRef.current?.resize(window.innerWidth, window.innerHeight);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" />;
});

export default GameCanvas;
