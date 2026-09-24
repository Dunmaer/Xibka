import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../features/i18n/i18n';
import { STRINGS, type Lang } from '../features/i18n/strings';
import { TopBar } from '../components/TopBar';
import { IconSkip } from '../components/Icons';
import { RitualForm } from '../features/form/RitualForm';
import { RitualStage, type RitualDriver } from '../features/ritual/RitualStage';
import { VideoDeck } from '../features/ritual/VideoDeck';
import { makeRitualParams, type RitualParams } from '../features/ritual/params';
import { renderPaper } from '../features/ritual/art/paperArt';
import { F as K } from '../features/ritual/timeline';
import { CertificateView, type CertStage } from '../features/certificate/CertificateView';
import { canvasToBlob, makeThumbnail, renderCertificate } from '../features/certificate/renderCertificate';
import { ArchivePanel, ArchiveViewer } from '../features/archive/ArchivePanel';
import { deleteCurse, listCurses, newId, saveCurse, type CurseRecord } from '../features/archive/archiveDb';
import { downloadBlob, safeFileName } from '../utils/export/download';
import { ensureFonts } from '../utils/fonts';
import { storage } from '../utils/storage';
import type { CurseInput } from '../utils/seed/seed';

type Screen = 'intro' | 'ritual' | 'result';

interface Current {
  params: RitualParams;
  input: CurseInput;
  lang: Lang;
  createdAt: number;
}

const SOUND_KEY = 'proklinatel.sound';
const query = new URLSearchParams(location.search);
const DEBUG_FRAME = query.has('frame') ? Number(query.get('frame')) : null;
const DEBUG_HUD = query.has('debug') || DEBUG_FRAME !== null;
const SAMPLE: CurseInput = { name: 'Viktor', reason: 'ate my yoghurt from the office fridge', punishment: 'eternal hiccups' };

export function App() {
  const { t, lang } = useI18n();
  const deck = useMemo(() => new VideoDeck(), []);
  const driverRef = useRef<RitualDriver | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [stableReady, setStableReady] = useState(false);
  const [loadP, setLoadP] = useState(0);
  const loadedRef = useRef<Promise<void> | null>(null);

  const [screen, setScreen] = useState<Screen>('intro');
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(() => storage.get(SOUND_KEY) !== '0');
  const [certStage, setCertStage] = useState<CertStage>('hidden');
  const [certUrl, setCertUrl] = useState<string | null>(null);
  const [uiReady, setUiReady] = useState(false);
  const [frame, setFrame] = useState(-1);
  const [fallbackNote, setFallbackNote] = useState(false);

  const [archive, setArchive] = useState<CurseRecord[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [viewer, setViewer] = useState<CurseRecord | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const currentRef = useRef<Current | null>(null);
  const certRef = useRef<Promise<HTMLCanvasElement> | null>(null);
  const certBlobRef = useRef<Blob | null>(null);
  const birthPendingRef = useRef(false);

  // ------------------------------------------------------------------ boot
  useEffect(() => {
    loadedRef.current ??= deck.load(setLoadP).then(() => setLoadP(1));
    deck.whenStableReady().then((ok) => {
      // If the video cannot play, the poster image stays as the altar backdrop.
      setStableReady(ok);
      deck.playStable();
    });
    void listCurses().then(setArchive).catch(() => {});
    void ensureFonts(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  const refreshArchive = useCallback(() => {
    void listCurses().then(setArchive).catch(() => {});
  }, []);

  // ------------------------------------------------------------------ certificate
  const revealCert = useCallback(() => {
    const p = certRef.current;
    if (!p) return;
    p.then(() => setCertStage((s) => (s === 'hidden' ? 'birth' : s)));
  }, []);

  const events = useMemo(
    () => ({
      onLanded: () => {
        deck.startRitual();
        driverRef.current?.beginRitual();
      },
      onCertBirth: () => {
        birthPendingRef.current = true;
        revealCert();
      },
      onUiReady: () => {
        setUiReady(true);
        setScreen('result');
      },
      onFrame: DEBUG_HUD ? (f: number) => setFrame(Math.round(f)) : undefined,
    }),
    [deck, revealCert],
  );

  const prepareCertificate = useCallback((cur: Current, save: boolean) => {
    certBlobRef.current = null;
    setCertUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    const job = renderCertificate({ params: cur.params, lang: cur.lang, createdAt: cur.createdAt }).then(async (canvas) => {
      const blob = await canvasToBlob(canvas, 'image/png');
      certBlobRef.current = blob;
      setCertUrl(URL.createObjectURL(blob));
      if (save) {
        const thumb = await makeThumbnail(canvas).catch(() => undefined);
        await saveCurse({
          id: newId(),
          archiveId: cur.params.archiveId,
          input: cur.input,
          lang: cur.lang,
          createdAt: cur.createdAt,
          thumb,
        }).catch(() => {});
        refreshArchive();
      }
      return canvas;
    });
    certRef.current = job;
    return job;
  }, [refreshArchive]);

  // ------------------------------------------------------------------ ritual
  const runRitual = useCallback(
    async (cur: Current, opts: { save: boolean; paperLang?: Lang }) => {
      if (!driverRef.current) return;
      setBusy(true);
      setUiReady(false);
      setCertStage('hidden');
      birthPendingRef.current = false;
      currentRef.current = cur;
      prepareCertificate(cur, opts.save);
      await ensureFonts(cur.lang, `${cur.input.name} ${cur.input.reason} ${cur.input.punishment}`);
      const paper = await renderPaper(cur.input, STRINGS[opts.paperLang ?? cur.lang]);
      await loadedRef.current;
      const driver = driverRef.current;
      if (!driver) return;
      driver.prepare(cur.params, paper);
      deck.playStable();
      setScreen('ritual');
      setBusy(false);
      if (!webgl) setFallbackNote(true);
      if (DEBUG_FRAME !== null) {
        driver.jumpTo(DEBUG_FRAME, true);
        if (DEBUG_FRAME >= K.certBirth) revealCert();
        return;
      }
      driver.dropPaper();
    },
    [deck, prepareCertificate, revealCert, webgl],
  );

  const onSubmit = useCallback(
    (input: CurseInput) => {
      // Inside the click: allow sound for the ritual video later on.
      deck.setSound(sound);
      deck.unlock();
      const cur: Current = { params: makeRitualParams(input), input, lang, createdAt: Date.now() };
      void runRitual(cur, { save: true });
    },
    [deck, sound, lang, runRitual],
  );

  const onReplay = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    deck.unlock();
    void runRitual(cur, { save: false });
  }, [deck, runRitual]);

  const onRestart = useCallback(() => {
    driverRef.current?.toIdle();
    deck.stopRitual();
    deck.playStable();
    setCertStage('hidden');
    setUiReady(false);
    setScreen('intro');
  }, [deck]);

  const onSkip = useCallback(() => {
    driverRef.current?.jumpTo(K.certBirth - 2);
  }, []);

  const onDownload = useCallback(async () => {
    const cur = currentRef.current;
    if (!cur) return;
    let blob = certBlobRef.current;
    if (!blob && certRef.current) blob = await canvasToBlob(await certRef.current);
    if (blob) downloadBlob(blob, `curse-${safeFileName(cur.input.name)}-${cur.params.archiveId}.png`);
  }, []);

  const toggleSound = useCallback(() => {
    setSound((s) => {
      const next = !s;
      storage.set(SOUND_KEY, next ? '1' : '0');
      deck.setSound(next);
      deck.unlock();
      return next;
    });
  }, [deck]);

  // ------------------------------------------------------------------ archive viewer
  const openRecord = useCallback(async (r: CurseRecord) => {
    setViewer(r);
    setViewerUrl(null);
    const canvas = await renderCertificate({ params: makeRitualParams(r.input), lang: r.lang, createdAt: r.createdAt });
    const blob = await canvasToBlob(canvas);
    setViewerUrl(URL.createObjectURL(blob));
  }, []);

  const closeViewer = useCallback(() => {
    setViewer(null);
    setViewerUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
  }, []);

  const downloadViewer = useCallback(async () => {
    if (!viewer || !viewerUrl) return;
    const blob = await fetch(viewerUrl).then((r) => r.blob());
    downloadBlob(blob, `curse-${safeFileName(viewer.input.name)}-${viewer.archiveId}.png`);
  }, [viewer, viewerUrl]);

  const replayViewer = useCallback(() => {
    if (!viewer) return;
    const r = viewer;
    closeViewer();
    setArchiveOpen(false);
    deck.setSound(sound);
    deck.unlock();
    void runRitual({ params: makeRitualParams(r.input), input: r.input, lang: r.lang, createdAt: r.createdAt }, { save: false });
  }, [viewer, closeViewer, deck, sound, runRitual]);

  const removeRecord = useCallback(
    async (r: CurseRecord) => {
      await deleteCurse(r.id).catch(() => {});
      refreshArchive();
    },
    [refreshArchive],
  );

  // ------------------------------------------------------------------ debug autostart
  const debugStarted = useRef(false);
  const onDriver = useCallback(
    (d: RitualDriver | null, gl: boolean) => {
      driverRef.current = d;
      if (!d) return;
      setWebgl(gl);
      if ((DEBUG_FRAME !== null || query.has('autoplay')) && !debugStarted.current) {
        debugStarted.current = true;
        const cur: Current = { params: makeRitualParams(SAMPLE), input: SAMPLE, lang, createdAt: Date.now() };
        void runRitual(cur, { save: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runRitual],
  );

  const showCert = certStage !== 'hidden';
  useEffect(() => {
    if (certUrl && birthPendingRef.current && certStage === 'hidden') setCertStage('birth');
  }, [certUrl, certStage]);

  return (
    <div className={`app app--${screen}`} data-ready={stableReady ? '1' : undefined}>
      <div className="poster" aria-hidden="true" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}media/poster.jpg)` }} />
      <RitualStage deck={deck} events={events} onDriver={onDriver} visible={stableReady} />

      <TopBar
        sound={sound}
        onToggleSound={toggleSound}
        archiveCount={archive.length}
        onOpenArchive={() => setArchiveOpen(true)}
        compact={screen !== 'intro'}
      />

      <main className="app__main">
        {screen === 'intro' && (
          <div className="intro">
            <RitualForm onSubmit={onSubmit} loading={loadP} busy={busy} />
          </div>
        )}

        {screen === 'ritual' && !showCert && DEBUG_FRAME === null && (
          <button type="button" className="skip" onClick={onSkip}>
            {t.skipButton}
            <IconSkip />
          </button>
        )}

        {screen !== 'intro' && (
          <CertificateView
            stage={certStage}
            imageUrl={certUrl}
            showActions={uiReady}
            onLayout={(x, y) => driverRef.current?.setFinalCenter(x, y)}
            onDownload={onDownload}
            onReplay={onReplay}
            onRestart={onRestart}
            onArchive={() => setArchiveOpen(true)}
          />
        )}

        {fallbackNote && screen === 'ritual' && <p className="fallback-note">{t.noWebgl}</p>}
      </main>

      <ArchivePanel
        open={archiveOpen}
        records={archive}
        onClose={() => setArchiveOpen(false)}
        onOpenRecord={openRecord}
        onDelete={removeRecord}
      />
      <ArchiveViewer record={viewer} imageUrl={viewerUrl} onClose={closeViewer} onDownload={downloadViewer} onReplay={replayViewer} />

      {DEBUG_HUD && (
        <div className="hud">
          F {frame} · {screen} · cert {certStage}
        </div>
      )}
    </div>
  );
}
