import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { useI18n } from '../i18n/i18n';
import { IconArchive, IconDownload, IconPlus, IconReplay } from '../../components/Icons';

export type CertStage = 'hidden' | 'birth' | 'shown';

interface Props {
  stage: CertStage;
  imageUrl: string | null;
  showActions: boolean;
  onLayout: (cx: number, cy: number) => void;
  onDownload: () => void;
  onReplay: () => void;
  onRestart: () => void;
  onArchive: () => void;
}

/**
 * The certificate "is born" at the centre of the magic circle and flies towards the viewer.
 * The slot is always laid out (invisible) during the ritual so the 3D circle knows where
 * to settle behind it.
 */
export function CertificateView({ stage, imageUrl, showActions, onLayout, onDownload, onReplay, onRestart, onArchive }: Props) {
  const { t } = useI18n();
  const slotRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;

  useLayoutEffect(() => {
    const report = () => {
      const r = slotRef.current?.getBoundingClientRect();
      if (r && r.width > 0) onLayoutRef.current(r.left + r.width / 2, r.top + r.height / 2);
    };
    report();
    const ro = new ResizeObserver(report);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  useEffect(() => {
    const el = paperRef.current;
    const fl = flareRef.current;
    if (!el || !fl) return;
    gsap.killTweensOf([el, fl]);
    if (stage === 'hidden') {
      gsap.set(el, { autoAlpha: 0 });
      gsap.set(fl, { autoAlpha: 0 });
      return;
    }
    if (stage === 'shown') {
      gsap.set(el, { autoAlpha: 1, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, filter: 'none', y: 0 });
      gsap.set(fl, { autoAlpha: 0 });
      return;
    }
    // birth: from a spark at the centre, spinning out of the vortex towards the viewer
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tl = gsap.timeline();
    tl.set(el, {
      autoAlpha: 0,
      scale: 0.03,
      rotationX: 62,
      rotationY: -18,
      rotationZ: -120,
      filter: 'brightness(4) sepia(1) saturate(3) blur(6px)',
      transformPerspective: 1400,
    });
    tl.set(fl, { autoAlpha: 0, scale: 0.2 });
    tl.to(fl, { autoAlpha: 1, scale: 1.1, duration: 0.25, ease: 'power2.out' }, 0);
    tl.to(el, { autoAlpha: 1, duration: 0.2 }, 0.05);
    tl.to(
      el,
      {
        scale: 1,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        duration: reduced ? 0.6 : 1.55,
        ease: 'expo.out',
      },
      0.05,
    );
    tl.to(el, { filter: 'brightness(1) sepia(0) saturate(1) blur(0px)', duration: 1.2, ease: 'power2.out' }, 0.25);
    tl.to(fl, { autoAlpha: 0, scale: 1.8, duration: 1.1, ease: 'power2.in' }, 0.3);
    tl.set(el, { filter: 'none' });
    return () => {
      tl.kill();
    };
  }, [stage]);

  return (
    <section className={`cert ${stage !== 'hidden' ? 'cert--on' : ''}`} aria-hidden={stage === 'hidden'}>
      <div className="cert__slot" ref={slotRef}>
        <div className="cert__flare" ref={flareRef} aria-hidden="true" />
        <div className="cert__paper" ref={paperRef}>
          {imageUrl && <img src={imageUrl} alt={t.certificateTitle} className="cert__img" draggable={false} />}
        </div>
      </div>
      <div className={`cert__actions ${showActions ? 'is-on' : ''}`}>
        <button type="button" className="btn btn--primary" onClick={onDownload} disabled={!showActions}>
          <span className="btn__glow" aria-hidden="true" />
          <IconDownload />
          {t.downloadButton}
        </button>
        <button type="button" className="btn" onClick={onRestart} disabled={!showActions}>
          <IconPlus />
          {t.restartButton}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onReplay} disabled={!showActions}>
          <IconReplay />
          {t.replayButton}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onArchive} disabled={!showActions}>
          <IconArchive />
          {t.archiveButton}
        </button>
      </div>
    </section>
  );
}
