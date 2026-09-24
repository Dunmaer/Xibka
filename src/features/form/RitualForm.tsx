import { useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/i18n';
import type { CurseInput } from '../../utils/seed/seed';

interface Props {
  onSubmit: (input: CurseInput) => void;
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
    onSubmit({ name: name.trim(), reason: reason.trim(), punishment: punishment.trim() });
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
