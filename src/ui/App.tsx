import { ArrowCounterClockwise, CalendarBlank, DotsThreeOutline, Flag, GraduationCap, House, SunHorizon, X } from '@phosphor-icons/react';
import { useEffect, type ComponentType } from 'react';
import { shortDate, timeOf, toT } from '../engine/time';
import { clearToast, getApp, meta, setMeta, today, undo, useApp } from '../store/store';
import { closeSheet, openSheet, useBus } from './bus';
import { useKeyboardOffset, useRoute } from './common';
import { ConfirmSheet } from './ConfirmSheet';
import { InputBar } from './InputBar';
import { Today } from './Today';
import { Calendar } from './Calendar';
import { screens } from './screens';
import { AddSheet } from './AddSheet';
import { ItemSheet } from './ItemSheet';
import { BriefSheet, WrapupSheet } from './Brief';

const TABS: { path: string; label: string; Icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill'; 'aria-hidden'?: boolean }> }[] = [
  { path: '/today', label: 'Today', Icon: House },
  { path: '/calendar', label: 'Calendar', Icon: CalendarBlank },
  { path: '/deadlines', label: 'Deadlines', Icon: Flag },
  { path: '/exams', label: 'Exams', Icon: GraduationCap },
  { path: '/more', label: 'More', Icon: DotsThreeOutline },
];

export function App() {
  const app = useApp();
  const { sheet } = useBus();
  const route = useRoute();
  const kb = useKeyboardOffset();

  useEffect(() => {
    if (!app.toast) return;
    const t = window.setTimeout(clearToast, 5000);
    return () => window.clearTimeout(t);
  }, [app.toast]);

  // morning brief on first open of the day; wrap-up prompt once after the set time
  const ready = !!app.st;
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const s = getApp().st!;
      const d = today();
      const t = timeOf(toT(getApp().now));
      if (t >= s.settings.wrapupTime) {
        if ((await meta<string>('lastWrap')) !== d) { await setMeta('lastWrap', d); openSheet({ kind: 'wrapup' }); }
      } else if (t >= s.settings.briefTime && (await meta<string>('lastBrief')) !== d) {
        await setMeta('lastBrief', d);
        openSheet({ kind: 'brief' });
      }
    })();
  }, [ready, app.now.slice(0, 10), app.now >= `${app.now.slice(0, 11)}${app.st?.settings.wrapupTime ?? '99'}`]); // eslint-disable-line

  useEffect(() => {
    const theme = app.st?.settings ? (localStorage.getItem('jarvis-theme') ?? 'dark') : 'dark';
    document.documentElement.dataset.theme = theme;
  }, [app.st]);

  if (app.error) return <main><p className="banner bad">{app.error}</p></main>;
  if (!app.st) return <main aria-busy="true"><p className="muted">Loading…</p></main>;

  const path = route.path;
  const tab = TABS.find(t => path.startsWith(t.path))?.path ?? (path === '/' ? '/today' : '/more');
  let body;
  if (path.startsWith('/today') || path === '/') body = <Today />;
  else if (path.startsWith('/calendar')) body = <Calendar params={route.params} />;
  else {
    const S = screens[path] ?? screens['/more'];
    body = <S params={route.params} />;
  }

  return (
    <div className="app">
      <header className="top">
        <span className="brand" translate="no">Jarvis</span>
        <span className="sub num">{shortDate(today())}</span>
        <button className="icon-btn" aria-label="Morning brief" onClick={() => openSheet({ kind: 'brief' })}><SunHorizon size={24} aria-hidden="true" /></button>
        <button className="icon-btn" aria-label={`Undo (${app.undoCount} available)`} onClick={undo} disabled={!app.undoCount}>
          <ArrowCounterClockwise size={22} aria-hidden="true" />
        </button>
      </header>
      <main id="main">{body}</main>
      <div className={`bottom${kb ? ' kb-open' : ''}`}>
        <InputBar />
        <nav className="tabs" aria-label="Screens">
          {TABS.map(({ path: p, label, Icon }) => (
            <a key={p} href={`#${p}`} aria-current={tab === p ? 'page' : undefined}>
              <Icon size={24} weight={tab === p ? 'fill' : 'regular'} aria-hidden={true} />
              {label}
            </a>
          ))}
        </nav>
      </div>
      {app.toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="grow">{app.toast.text}</span>
          {app.toast.undo && <button className="btn ghost" onClick={() => { clearToast(); undo(); }}>Undo</button>}
          <button className="icon-btn" aria-label="Dismiss" onClick={clearToast}><X size={18} aria-hidden="true" /></button>
        </div>
      )}
      {sheet?.kind === 'add' && <AddSheet preset={sheet.preset} onClose={closeSheet} />}
      {sheet?.kind === 'item' && <ItemSheet refKey={sheet.ref} onClose={closeSheet} />}
      {sheet?.kind === 'brief' && <BriefSheet onClose={closeSheet} />}
      {sheet?.kind === 'wrapup' && <WrapupSheet onClose={closeSheet} />}
      <ConfirmSheet />
    </div>
  );
}
