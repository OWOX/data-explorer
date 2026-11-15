import type { Model } from '../../model/types';
import { useStore } from '../../state/store';
import { MartTab } from './MartTab';
import { RecordTab } from './RecordTab';
import { TabBar } from './TabBar';

export function Explorer({ model }: { model: Model }) {
  const [state] = useStore();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabBar model={model} />
      {state.tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== state.activeTabId} className="min-h-0 flex-1">
          {t.kind === 'mart' ? <MartTab tab={t} model={model} /> : <RecordTab tab={t} model={model} />}
        </div>
      ))}
    </div>
  );
}
