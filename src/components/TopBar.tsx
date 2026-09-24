import { useI18n } from '../features/i18n/i18n';
import { LANGS, LANG_NAMES, type Lang } from '../features/i18n/strings';
import { IconArchive, IconSoundOff, IconSoundOn } from './Icons';

interface Props {
  sound: boolean;
  onToggleSound: () => void;
  archiveCount: number;
  onOpenArchive: () => void;
  compact: boolean;
}

const SHORT: Record<Lang, string> = { en: 'EN', ru: 'RU', hy: 'ՀԱՅ' };

export function TopBar({ sound, onToggleSound, archiveCount, onOpenArchive, compact }: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className={`topbar ${compact ? 'topbar--compact' : ''}`}>
      <div className="topbar__brand" aria-hidden={compact}>
        <span className="topbar__sigil" />
        <span className="topbar__name">{t.siteTitle}</span>
      </div>
      <nav className="topbar__actions">
        <div className="langs" role="radiogroup" aria-label={t.languageLabel}>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === lang}
              className={`langs__btn ${l === lang ? 'is-on' : ''}`}
              title={LANG_NAMES[l]}
              lang={l}
              onClick={() => setLang(l)}
            >
              {SHORT[l]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="iconbtn"
          onClick={onToggleSound}
          aria-pressed={sound}
          aria-label={sound ? t.soundOn : t.soundOff}
          title={sound ? t.soundOn : t.soundOff}
        >
          {sound ? <IconSoundOn /> : <IconSoundOff />}
        </button>
        <button type="button" className="iconbtn iconbtn--label" onClick={onOpenArchive} title={t.archiveTitle}>
          <IconArchive />
          <span className="iconbtn__text">{t.archiveButton}</span>
          {archiveCount > 0 && <span className="badge">{archiveCount}</span>}
        </button>
      </nav>
    </header>
  );
}
