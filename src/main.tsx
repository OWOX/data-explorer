import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { bootContext } from './sdk/connect';
import { AppServices, StoreProvider } from './state/store';
import { App } from './ui/App';

const root = createRoot(document.getElementById('root')!);

bootContext().then((ctx) => {
  if (ctx === 'outside-host') {
    root.render(<p className="p-6 text-sm">Open this plugin from OWOX Data Marts.</p>);
    return;
  }
  document.documentElement.classList.toggle('dark', ctx.theme === 'dark');
  root.render(
    <StrictMode>
      <AppServices ctx={ctx}>
        <StoreProvider><App /></StoreProvider>
      </AppServices>
    </StrictMode>,
  );
});
