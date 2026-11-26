import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { bootContext } from './sdk/connect';
import { applyTheme } from './sdk/theme';
import { AppServices, StoreProvider } from './state/store';
import { App } from './ui/App';

const root = createRoot(document.getElementById('root')!);

// Until the handshake brings the host's theme, the OS preference is the guess: a dark host whose frame declares the light scheme gets a white backdrop meanwhile.
applyTheme();

bootContext().then((ctx) => {
  if (ctx === 'outside-host') {
    root.render(<p className="p-6 text-sm">Open this plugin from OWOX Data Marts.</p>);
    return;
  }
  applyTheme(ctx.theme);
  root.render(
    <StrictMode>
      <AppServices ctx={ctx}>
        <StoreProvider><App /></StoreProvider>
      </AppServices>
    </StrictMode>,
  );
});
