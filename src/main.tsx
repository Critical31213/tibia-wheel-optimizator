import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n'
import { loadMonsterData } from './lib/api'

// Start fetching the code-split monster dataset in parallel with the first render.
loadMonsterData().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
