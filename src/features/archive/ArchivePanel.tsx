import { useEffect, useMemo } from 'react';
import { useI18n } from '../i18n/i18n';
import { DATE_LOCALE } from '../i18n/strings';
import type { CurseRecord } from './archiveDb';
import { IconClose, IconDownload, IconReplay, IconTrash } from '../../components/Icons';

interface Props {
  open: boolean;
  records: CurseRecord[];
  onClose: () => void;
  onOpenRecord: (r: CurseRecord) => void;
  onDelete: (r: CurseRecord) => void;
}

function Thumb({ blob, alt }: { blob?: Blob; alt: string }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url ? <img src={url} alt={alt} loading="lazy" /> : <div className="archive__thumb-empty" aria-hidden="true" />;
}

export function ArchivePanel({ open, records, onClose, onOpenRecord, onDelete }: Props) {
  const { t, lang } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const fmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
  }, [lang]);

  return (
    <div className={`archive ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="archive__backdrop" onClick={onClose} />
      <aside className="archive__panel" role="dialog" aria-modal="true" aria-label={t.archiveTitle}>
        <header className="archive__head">
          <div>
            <h2>{t.archiveTitle}</h2>
            <p>{t.archiveSubtitle}</p>
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label={t.close} tabIndex={open ? 0 : -1}>
            <IconClose />
          </button>
        </header>
        {records.length === 0 ? (
          <p className="archive__empty">{t.archiveEmpty}</p>
        ) : (
          <ul className="archive__list">
            {records.map((r) => (
              <li key={r.id} className="archive__item">
                <button
                  type="button"
                  className="archive__open"
                  onClick={() => onOpenRecord(r)}
                  tabIndex={open ? 0 : -1}
                  aria-label={`${t.archiveOpen}: ${r.input.name}`}
                >
                  <Thumb blob={r.thumb} alt="" />
                  <span className="archive__meta">
                    <span className="archive__name">{r.input.name}</span>
                    <span className="archive__pun">{r.input.punishment}</span>
                    <span className="archive__date">
                      {fmt.format(new Date(r.createdAt))} · {r.archiveId}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--danger"
                  tabIndex={open ? 0 : -1}
                  aria-label={t.archiveDelete}
                  title={t.archiveDelete}
                  onClick={() => {
                    if (window.confirm(t.archiveDeleteConfirm)) onDelete(r);
                  }}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

interface ViewerProps {
  record: CurseRecord | null;
  imageUrl: string | null;
  onClose: () => void;
  onDownload: () => void;
  onReplay: () => void;
}

/** Full-size view of a certificate from the archive. */
export function ArchiveViewer({ record, imageUrl, onClose, onDownload, onReplay }: ViewerProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!record) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, onClose]);
  if (!record) return null;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={t.certificateTitle}>
      <div className="viewer__backdrop" onClick={onClose} />
      <div className="viewer__body">
        <div className="viewer__paper">
          {imageUrl ? <img src={imageUrl} alt={t.certificateTitle} /> : <div className="viewer__loading" />}
        </div>
        <div className="viewer__actions">
          <button type="button" className="btn btn--primary" onClick={onDownload} disabled={!imageUrl}>
            <span className="btn__glow" aria-hidden="true" />
            <IconDownload />
            {t.downloadButton}
          </button>
          <button type="button" className="btn" onClick={onReplay}>
            <IconReplay />
            {t.replayButton}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t.back}
          </button>
        </div>
      </div>
    </div>
  );
}
