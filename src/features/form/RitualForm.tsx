import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useI18n } from '../i18n/i18n';
import type { CurseInput } from '../../utils/seed/seed';
import { preparePhoto } from '../../utils/photo';
import { IconImage } from '../../components/Icons';

interface Props {
  /** `photo`: the optional picture, already shrunk to a JPEG. */
  onSubmit: (input: CurseInput, photo: Blob | null) => void;
  loading: number; // 0..1, 1 = altar ready
  busy: boolean;
  initial?: CurseInput;
}

const LIMITS = { name: 80, reason: 240, punishment: 140 };

export function RitualForm({ onSubmit, loading, busy, initial }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [punishment, setPunishment] = useState(initial?.punishment ?? '');
  const [birthday, setBirthday] = useState(initial?.birthday ?? '');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);
  const today = new Date().toISOString().slice(0, 10);

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await preparePhoto(file);
      setPhoto(blob);
      setPhotoUrl(URL.createObjectURL(blob));
    } catch {
      // not an image the browser can read: keep what was there
    }
  };
  const dropPhoto = () => {
    setPhoto(null);
    setPhotoUrl(null);
  };
  const [touched, setTouched] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    reason: useRef<HTMLTextAreaElement>(null),
    punishment: useRef<HTMLInputElement>(null),
  };

  const errors = {
    name: !name.trim() ? t.validationName : '',
    reason: !reason.trim() ? t.validationReason : '',
    punishment: !punishment.trim() ? t.validationPunishment : '',
  };
  const ready = loading >= 1;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const first = (['name', 'reason', 'punishment'] as const).find((k) => errors[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    if (busy) return;
    onSubmit(
      { name: name.trim(), reason: reason.trim(), punishment: punishment.trim(), ...(birthday ? { birthday } : {}) },
      photo,
    );
  };

  const err = (k: keyof typeof errors) =>
    touched && errors[k] ? (
      <p className="field__error" id={`${id}-${k}-err`} role="alert">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form className="ritual-form" onSubmit={submit} noValidate>
      <div className="ritual-form__head">
        <h1 className="ritual-form__title">{t.siteTitle}</h1>
        <p className="ritual-form__tagline">{t.siteTagline}</p>
      </div>

      <div className={`field ${touched && errors.name ? 'has-error' : ''}`}>
        <label htmlFor={`${id}-name`}>{t.nameLabel}</label>
        <input
          ref={refs.name}
          id={`${id}-name`}
          value={name}
          maxLength={LIMITS.name}
          autoComplete="off"
          placeholder={t.namePlaceholder}
          aria-invalid={touched && !!errors.name}
          aria-describedby={touched && errors.name ? `${id}-name-err` : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {err('name')}
      </div>

      <div className={`field ${touched && errors.reason ? 'has-error' : ''}`}>
        <label htmlFor={`${id}-reason`}>{t.reasonLabel}</label>
        <textarea
          ref={refs.reason}
          id={`${id}-reason`}
          value={reason}
          rows={2}
          maxLength={LIMITS.reason}
          placeholder={t.reasonPlaceholder}
          aria-invalid={touched && !!errors.reason}
          aria-describedby={touched && errors.reason ? `${id}-reason-err` : undefined}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
        />
        {err('reason')}
      </div>

      <div className={`field ${touched && errors.punishment ? 'has-error' : ''}`}>
        <label htmlFor={`${id}-pun`}>{t.punishmentLabel}</label>
        <input
          ref={refs.punishment}
          id={`${id}-pun`}
          value={punishment}
          maxLength={LIMITS.punishment}
          autoComplete="off"
          placeholder={t.punishmentPlaceholder}
          aria-invalid={touched && !!errors.punishment}
          aria-describedby={touched && errors.punishment ? `${id}-punishment-err` : undefined}
          onChange={(e) => setPunishment(e.target.value)}
        />
        {err('punishment')}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-birth`}>
            {t.birthdayLabel}
          </label>
          <input
            id={`${id}-birth`}
            type="date"
            value={birthday}
            min="1900-01-01"
            max={today}
            onChange={(e) => setBirthday(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="field__label" id={`${id}-pic`}>
            {t.pictureLabel}
          </span>
          <div className="photo-pick">
            <label className="photo-pick__btn" title={t.pictureHint} aria-describedby={`${id}-pic`}>
              {photoUrl ? <img src={photoUrl} alt="" className="photo-pick__thumb" /> : <IconImage />}
              <span className="photo-pick__text">{photoUrl ? t.pictureChange : t.pictureAdd}</span>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
            </label>
            {photoUrl && (
              <button type="button" className="photo-pick__remove" aria-label={t.pictureRemove} title={t.pictureRemove} onClick={dropPhoto}>
                ×
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="field-row__hint">{t.optionalHint}</p>

      <button className="btn btn--primary ritual-form__submit" type="submit" disabled={busy} aria-busy={!ready || busy}>
        <span className="btn__glow" aria-hidden="true" />
        {ready ? t.startButton : t.loadingAltar}
        {!ready && (
          <span className="btn__progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.03, loading)})` }} />
          </span>
        )}
      </button>
    </form>
  );
}
