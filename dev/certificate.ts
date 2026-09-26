// Dev preview: renders the certificate in all three languages.
// http://localhost:5173/dev/certificate.html   (?long=1 for stress-test texts)
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/cormorant-sc/600.css';
import '@fontsource/cormorant-sc/700.css';
import '@fontsource/noto-serif-armenian/400.css';
import '@fontsource/noto-serif-armenian/600.css';
import '@fontsource/noto-serif-armenian/700.css';
import { renderCertificate } from '../src/features/certificate/renderCertificate';
import { makeRitualParams } from '../src/features/ritual/params';
import type { Lang } from '../src/features/i18n/strings';

const long = new URLSearchParams(location.search).has('long');
const samples: Record<Lang, { name: string; reason: string; punishment: string }> = long
  ? {
      en: {
        name: 'Maximilian Alexander von Hohenzollern-Sigmaringen the Third',
        reason: 'for scheduling a two-hour meeting at 5 pm on a Friday, then being late to it and asking everyone to stay longer',
        punishment: 'every sock he owns will be slightly damp for the rest of his natural life and beyond',
      },
      ru: {
        name: 'Константин Константинопольский',
        reason: 'за то, что съел последний кусок торта, который я берегла на день рождения, и сказал, что это был кот',
        punishment: 'пусть все его наушники запутываются навсегда',
      },
      hy: {
        name: 'Գևորգ Հովհաննիսյան',
        reason: 'որովհետև ամեն առավոտ շատ բարձր է երգում լոգարանում',
        punishment: 'հավերժ սառը թեյ',
      },
    }
  : {
      en: { name: 'Viktor', reason: 'ate my yoghurt from the office fridge', punishment: 'eternal hiccups' },
      ru: { name: 'Марина Петровна', reason: 'поставила двойку за опоздание на пять минут', punishment: 'вечная икота' },
      hy: { name: 'Արամ', reason: 'ուշացավ հանդիպումից', punishment: 'անվերջ զկռտոց' },
    };

/** ?photo: a drawn stand-in picture (a face-like shape on a warm ground). */
async function samplePhoto(): Promise<Blob | null> {
  if (!new URLSearchParams(location.search).has('photo')) return null;
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 600;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 600);
  bg.addColorStop(0, '#6d7f99');
  bg.addColorStop(1, '#2b2f3a');
  g.fillStyle = bg;
  g.fillRect(0, 0, 480, 600);
  g.fillStyle = '#d9a383';
  g.beginPath();
  g.ellipse(240, 250, 105, 135, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3a2a22';
  g.fillRect(90, 430, 300, 170);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
}

const row = document.getElementById('row')!;
for (const lang of ['en', 'ru', 'hy'] as Lang[]) {
  const canvas = await renderCertificate({ params: makeRitualParams(samples[lang]), lang, createdAt: Date.now(), photo: await samplePhoto() });
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  row.appendChild(img);
}
document.body.dataset.ready = '1';
