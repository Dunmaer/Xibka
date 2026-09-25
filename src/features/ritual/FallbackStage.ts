// Used when WebGL is unavailable: the altar videos are shown as plain <video> elements,
// the note falls with a CSS animation and the certificate appears when the video ends.
import type { EngineEvents } from './engine/RitualEngine';
import type { PaperArt } from './art/paperArt';
import type { VideoDeck } from './VideoDeck';
import type { RitualAudio } from './audio';
import { F as K } from './timeline';

export class FallbackStage {
  private paperImg: HTMLImageElement;
  private raf = 0;
  private phase: 'idle' | 'paper' | 'ritual' = 'idle';
  private lastF = -1;
  private landTimer = 0;

  constructor(host: HTMLElement, private deck: VideoDeck, private events: EngineEvents = {}, private audio?: RitualAudio) {
    for (const v of [deck.stable, deck.pribliji]) {
      v.className = 'fallback-video';
      host.appendChild(v);
    }
    this.paperImg = document.createElement('img');
    this.paperImg.className = 'fallback-paper';
    this.paperImg.alt = '';
    host.appendChild(this.paperImg);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  prepare(_params: unknown, paper: PaperArt) {
    this.paperImg.src = paper.paper.toDataURL('image/jpeg', 0.85);
  }

  dropPaper() {
    this.phase = 'paper';
    this.paperImg.classList.remove('falling');
    void this.paperImg.offsetWidth;
    this.paperImg.classList.add('falling');
    window.clearTimeout(this.landTimer);
    this.landTimer = window.setTimeout(() => this.events.onLanded?.(), 4200);
  }

  beginRitual() {
    this.phase = 'ritual';
    this.lastF = -1;
  }

  jumpTo(frame: number) {
    this.phase = 'ritual';
    this.lastF = frame - 0.001;
    this.deck.seekRitual(frame);
    this.audio?.jump(frame);
    if (frame >= K.certBirth) this.events.onCertBirth?.();
  }

  toIdle() {
    this.phase = 'idle';
    this.paperImg.classList.remove('falling');
    window.clearTimeout(this.landTimer);
    this.audio?.reset();
  }

  setFinalCenter() {}
  setCertificate() {}
  resize() {}
  start() {}

  private tick() {
    const d = this.deck;
    d.tick(1 / 60);
    d.stable.style.opacity = String(1 - d.mix);
    d.pribliji.style.opacity = String(d.mix);
    if (this.phase !== 'ritual') return;
    const f = d.ritualFrame();
    this.events.onFrame?.(f);
    if (f >= 0) this.audio?.frame(f, this.lastF);
    if (this.lastF < K.paperPullStart && f >= K.paperPullStart) this.paperImg.classList.remove('falling');
    if (this.lastF < K.certBirth && f >= K.certBirth) this.events.onCertBirth?.();
    if (this.lastF < K.uiOn && f >= K.uiOn) this.events.onUiReady?.();
    this.lastF = f;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.landTimer);
    this.paperImg.remove();
  }
}
