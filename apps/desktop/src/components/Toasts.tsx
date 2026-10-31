import { useUi } from '../store/ui';

export function Toasts() {
  const toasts = useUi(s => s.toasts); const dismiss = useUi(s => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`} role="status">
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
