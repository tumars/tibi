import { useEffect, useRef } from 'react';
import { trackUsage } from '../lib/analytics';

export function useReaderUsage(id: string | undefined, ready: boolean) {
  const visit = useRef<{ id: string | undefined; recorded: boolean }>({ id, recorded: false });
  useEffect(() => {
    if (visit.current.id !== id) visit.current = { id, recorded: false };
    if (!id || !ready || visit.current.recorded) return;
    visit.current.recorded = true;
    trackUsage('reader_opened');
  }, [id, ready]);
}
