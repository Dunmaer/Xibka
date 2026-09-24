import { useEffect, useRef } from 'react';
import { RitualEngine, type EngineEvents } from './engine/RitualEngine';
import { FallbackStage } from './FallbackStage';
import type { VideoDeck } from './VideoDeck';
import type { PaperArt } from './art/paperArt';
import type { RitualParams } from './params';

/** What the app needs from either the WebGL engine or the plain-video fallback. */
export interface RitualDriver {
  prepare(params: RitualParams, paper: PaperArt): void;
  dropPaper(): void;
  beginRitual(): void;
  jumpTo(frame: number, freeze?: boolean): void;
  toIdle(): void;
  setFinalCenter(x: number, y: number): void;
  resize(): void;
  start(): void;
  dispose(): void;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  deck: VideoDeck;
  events: EngineEvents;
  onDriver: (d: RitualDriver | null, webgl: boolean) => void;
  visible: boolean;
}

export function RitualStage({ deck, events, onDriver, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    // Forward events through a ref so the driver never holds stale callbacks.
    const ev: EngineEvents = {
      onLanded: () => eventsRef.current.onLanded?.(),
      onCertBirth: () => eventsRef.current.onCertBirth?.(),
      onUiReady: () => eventsRef.current.onUiReady?.(),
      onFrame: (f) => eventsRef.current.onFrame?.(f),
    };
    let driver: RitualDriver | null = null;
    let gl = false;
    if (webglAvailable() && canvasRef.current) {
      try {
        driver = new RitualEngine(canvasRef.current, deck, ev);
        gl = true;
      } catch (e) {
        console.warn('WebGL ritual unavailable, using fallback', e);
      }
    }
    if (!driver && hostRef.current) driver = new FallbackStage(hostRef.current, deck, ev);
    driver?.start();
    onDriver(driver, gl);
    const onResize = () => driver?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      driver?.dispose();
      onDriver(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  return (
    <div className={`stage ${visible ? 'stage--on' : ''}`} ref={hostRef} aria-hidden="true">
      <canvas ref={canvasRef} className="stage__canvas" />
    </div>
  );
}
