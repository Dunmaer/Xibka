import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/cormorant-sc/500.css';
import '@fontsource/cormorant-sc/600.css';
import '@fontsource/cormorant-sc/700.css';
import '@fontsource/noto-serif-armenian/400.css';
import '@fontsource/noto-serif-armenian/600.css';
import '@fontsource/noto-serif-armenian/700.css';
import '@fontsource/caveat/600.css';
import '@fontsource/caveat/700.css';
import './styles/global.css';

import { I18nProvider } from './features/i18n/i18n';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
