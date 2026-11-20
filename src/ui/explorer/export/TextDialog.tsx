import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../Modal';
import { copyText } from '../clipboard';

/** A read-only text the member copies by hand (or again) when the clipboard was out of reach. */
export function TextDialog({ name, heading = name, note, areaLabel, text, onClose, returnFocus }: { name: string; heading?: string; note: string; areaLabel: string; text: string; onClose: () => void; returnFocus: () => void }) {
  const [again, setAgain] = useState<'idle' | 'copied' | 'failed'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  return (
    <Modal label={name} onClose={onClose} width="w-[34rem]" returnFocus={returnFocus}>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
        <textarea ref={area} readOnly aria-label={areaLabel} rows={13} value={text} onFocus={(e) => e.currentTarget.select()} className="dm-input w-full resize-none rounded-md border bg-background p-2 font-mono text-xs" />
        <div className="flex items-center justify-end gap-2">
          {again === 'failed' && <span role="alert" className="mr-auto text-xs text-destructive">Could not copy. Select the text and copy it by hand.</span>}
          <button type="button" onClick={onClose} className="h-8 rounded-md border px-3 hover:bg-accent">Close</button>
          <button type="button" onClick={async () => { const ok = await copyText(text); setAgain(ok ? 'copied' : 'failed'); if (!ok) { area.current?.focus(); area.current?.select(); } }} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground">
            {again === 'copied' ? <><Check className="size-4" />Copied</> : 'Copy'}
          </button>
        </div>
    </Modal>
  );
}
