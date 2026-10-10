import { Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { listVoices, speak, ttsSupported } from '../voice/speak';
import { geocode, round2 } from '../voice/weather';
import { llmInterpret, PROVIDERS } from '../interpret/llm';
import { defaultSettings, seedState } from '../engine/seed';
import { putOp, uid } from '../engine/state';
import { WEEKDAYS } from '../engine/time';
import { TASK_TYPES, TYPE_LABEL, type Range, type Settings as S, type SlotRole, type TemplateSlot } from '../engine/types';
import { exportJSON, parseBackup } from '../store/db';
import { commit, nowStr, replaceAll, toast, useApp } from '../store/store';

const ROLES: SlotRole[] = ['college', 'commute', 'meal', 'club', 'study', 'assignment', 'other'];
const ROLE_LABEL: Record<SlotRole, string> = { college: 'College', commute: 'Commute', meal: 'Meal', club: 'Club (flexible)', study: 'Study slot (hint)', assignment: 'Assignment slot (hint)', other: 'Other busy' };

export async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return; } catch { /* cancelled, fall through */ }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Ranges({ label, value, onChange }: { label: string; value: Range[]; onChange: (v: Range[]) => void }) {
  return (
    <fieldset className="stack" style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className="small muted" style={{ marginBottom: 6 }}>{label}</legend>
      {value.map((r, i) => (
        <div key={i} className="row">
          <label className="field grow"><span className="sr-only">From</span><input type="time" value={r.start} onChange={e => onChange(value.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} /></label>
          <label className="field grow"><span className="sr-only">To</span><input type="time" value={r.end} onChange={e => onChange(value.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} /></label>
          <button className="icon-btn" aria-label="Remove range" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash size={20} aria-hidden="true" /></button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => onChange([...value, { start: '19:00', end: '21:00' }])}><Plus size={18} aria-hidden="true" />Add range</button>
    </fieldset>
  );
}

export function Settings() {
  const { st } = useApp();
  const s = st!.settings;
  const save = (patch: Partial<S>) => commit([putOp('settings', { ...s, ...patch })], 'Update settings', false);
  const [key, setKey] = useState(s.llm.key);
  const [testing, setTesting] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('jarvis-theme') ?? 'dark'; } catch { return 'dark'; } });
  const fileRef = useRef<HTMLInputElement>(null);
  const prov = s.llm.provider === 'none' ? null : PROVIDERS[s.llm.provider];

  const setSlot = (id: string, patch: Partial<TemplateSlot>) => save({ template: s.template.map(t => t.id === id ? { ...t, ...patch } : t) });
  const test = async () => {
    setTesting(true);
    try {
      const cmd = await llmInterpret("what's next?", { ...st!, settings: { ...s, llm: { ...s.llm, key } } }, nowStr(), false, 15000);
      toast(`AI key works (understood: ${cmd.kind}).`);
    } catch (e) { toast(`AI test failed: ${String((e as Error).message).slice(0, 120)}`); }
    setTesting(false);
  };
  const doImport = async (f: File) => {
    try {
      const data = parseBackup(await f.text());
      if (!confirm('Replace everything on this device with the backup? This clears undo history.')) return;
      await replaceAll(data);
      toast('Backup restored.');
    } catch (e) { toast(String((e as Error).message)); }
  };

  return (
    <>
      <h1>Settings</h1>

      <section className="card stack" aria-labelledby="s-ai">
        <h2 id="s-ai">AI interpreter</h2>
        <p className="small muted">Optional. Without a key, the offline parser handles common commands. The key is stored only on this device. Free-tier prompts may be used by the provider to improve its models, so avoid personal details in commands.</p>
        <label className="field">Provider
          <select value={s.llm.provider} onChange={e => save({ llm: { ...s.llm, provider: e.target.value as S['llm']['provider'], model: '' } })}>
            <option value="none">None (offline only)</option>
            <option value="gemini">{PROVIDERS.gemini.label}</option>
            <option value="groq">{PROVIDERS.groq.label}</option>
          </select>
        </label>
        {prov && (
          <>
            <label className="field">API key
              <input type="password" name="api-key" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} onBlur={() => key !== s.llm.key && save({ llm: { ...s.llm, key: key.trim() } })} placeholder="Paste key…" />
              <span className="hint">Get a free key at <a href={prov.keyUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>{prov.keyUrl.replace('https://', '')}</a></span>
            </label>
            <label className="field">Model
              <input name="model" autoComplete="off" spellCheck={false} defaultValue={s.llm.model} placeholder={prov.defaultModel} onBlur={e => e.target.value !== s.llm.model && save({ llm: { ...s.llm, key, model: e.target.value.trim() } })} />
            </label>
            <button className="btn" onClick={test} disabled={!key || testing}>{testing ? 'Testing…' : 'Test Key'}</button>
          </>
        )}
      </section>

      <VoiceSettings />

      <section className="card stack" aria-labelledby="s-sleep">
        <h2 id="s-sleep">Sleep</h2>
        <div className="row">
          <label className="field grow">Wake up<input type="time" value={s.wake} onChange={e => save({ wake: e.target.value })} /></label>
          <label className="field grow">Bedtime<input type="time" value={s.bedtime} onChange={e => save({ bedtime: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field grow">Latest bedtime<input type="time" value={s.latestBedtime} onChange={e => save({ latestBedtime: e.target.value })} /></label>
          <label className="field grow">Minimum sleep (h)<input type="number" inputMode="decimal" step={0.25} min={4} max={10} value={s.minSleepH} onChange={e => save({ minSleepH: Number(e.target.value) || 6.5 })} /></label>
        </div>
      </section>

      <section className="card stack" aria-labelledby="s-focus">
        <h2 id="s-focus">Focus</h2>
        <Ranges label="Best-focus hours (hard work goes here)" value={s.focusHours} onChange={v => save({ focusHours: v })} />
        <Ranges label="Low-energy hours (light work goes here)" value={s.lowEnergy} onChange={v => save({ lowEnergy: v })} />
      </section>

      <section className="card stack" aria-labelledby="s-plan">
        <h2 id="s-plan">Planning</h2>
        <div className="row">
          <label className="field grow">Buffer (min)<input type="number" inputMode="numeric" min={0} max={60} value={s.bufferMin} onChange={e => save({ bufferMin: Number(e.target.value) })} /></label>
          <label className="field grow">Max block (min)<input type="number" inputMode="numeric" min={30} max={240} step={15} value={s.chunkMaxMin} onChange={e => save({ chunkMaxMin: Number(e.target.value) || 90 })} /></label>
        </div>
        <div className="row">
          <label className="field grow">Daily work limit (h)<input type="number" inputMode="decimal" min={1} max={16} step={0.5} value={s.dailyWorkCapH} onChange={e => save({ dailyWorkCapH: Number(e.target.value) || 6 })} /></label>
        </div>
        <div className="row">
          <label className="field grow">Morning brief<input type="time" value={s.briefTime} onChange={e => save({ briefTime: e.target.value })} /></label>
          <label className="field grow">Night wrap-up<input type="time" value={s.wrapupTime} onChange={e => save({ wrapupTime: e.target.value })} /></label>
        </div>
        <h3>Default durations (minutes)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TASK_TYPES.map(t => (
            <label key={t} className="field">{TYPE_LABEL[t]}<input type="number" inputMode="numeric" min={5} step={5} value={s.durationDefaults[t]} onChange={e => save({ durationDefaults: { ...s.durationDefaults, [t]: Number(e.target.value) || 60 } })} /></label>
          ))}
        </div>
        <p className="tiny muted">Jarvis also learns from how long finished tasks of each type really took.</p>
      </section>

      <section className="card stack" aria-labelledby="s-tpl">
        <h2 id="s-tpl">Weekly template</h2>
        <p className="small muted">Your routine. Hint slots are preferred places for study and assignments, not busy time.</p>
        {[...s.template].sort((a, b) => a.start < b.start ? -1 : 1).map(t => (
          <div key={t.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="row">
              <label className="field grow"><span className="sr-only">Label</span><input defaultValue={t.label} onBlur={e => e.target.value !== t.label && setSlot(t.id, { label: e.target.value })} /></label>
              <button className="icon-btn" aria-label={`Delete ${t.label}`} onClick={() => save({ template: s.template.filter(x => x.id !== t.id) })}><Trash size={20} aria-hidden="true" /></button>
            </div>
            <div className="row">
              <label className="field grow"><span className="sr-only">Kind</span>
                <select value={t.role} onChange={e => setSlot(t.id, { role: e.target.value as SlotRole })}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              </label>
              <label className="field"><span className="sr-only">From</span><input type="time" value={t.start} onChange={e => setSlot(t.id, { start: e.target.value })} /></label>
              <label className="field"><span className="sr-only">To</span><input type="time" value={t.end} onChange={e => setSlot(t.id, { end: e.target.value })} /></label>
            </div>
            <div className="row wrap" role="group" aria-label="Days">
              {WEEKDAYS.map((w, i) => (
                <button key={w} className="habit" style={{ minHeight: 32, padding: '0 9px' }} aria-pressed={t.days.includes(i)} onClick={() => setSlot(t.id, { days: t.days.includes(i) ? t.days.filter(x => x !== i) : [...t.days, i].sort() })}>{w}</button>
              ))}
            </div>
          </div>
        ))}
        <button className="btn ghost" onClick={() => save({ template: [...s.template, { id: uid('tp'), label: 'New slot', days: [1, 2, 3, 4, 5], start: '18:00', end: '19:00', role: 'other' }] })}><Plus size={18} aria-hidden="true" />Add slot</button>
      </section>

      <section className="card stack" aria-labelledby="s-subj">
        <h2 id="s-subj">Subjects</h2>
        {s.subjects.map((sub, i) => (
          <div key={sub.name + i} className="row">
            <label className="field grow"><span className="sr-only">Name</span><input defaultValue={sub.name} onBlur={e => e.target.value && e.target.value !== sub.name && save({ subjects: s.subjects.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></label>
            <label className="field grow"><span className="sr-only">Short names</span><input defaultValue={sub.aliases.join(', ')} placeholder="Short names…" onBlur={e => save({ subjects: s.subjects.map((x, j) => j === i ? { ...x, aliases: e.target.value.split(',').map(a => a.trim().toLowerCase()).filter(Boolean) } : x) })} /></label>
            <label className="field"><span className="sr-only">Effort</span>
              <select value={sub.effort} onChange={e => save({ subjects: s.subjects.map((x, j) => j === i ? { ...x, effort: e.target.value as typeof sub.effort } : x) })}>
                <option value="hard">Hard</option><option value="normal">Normal</option><option value="light">Light</option>
              </select>
            </label>
          </div>
        ))}
        <button className="btn ghost" onClick={() => save({ subjects: [...s.subjects, { name: 'New subject', aliases: [], effort: 'normal' }] })}><Plus size={18} aria-hidden="true" />Add subject</button>
      </section>

      <section className="card stack" aria-labelledby="s-look">
        <h2 id="s-look">Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          {['dark', 'light'].map(t => (
            <button key={t} aria-pressed={theme === t} onClick={() => { try { localStorage.setItem('jarvis-theme', t); } catch { /* ignore */ } setTheme(t); document.documentElement.dataset.theme = t; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0f1113' : '#f4f5f6'); }}>{t === 'dark' ? 'Dark' : 'Light'}</button>
          ))}
        </div>
      </section>

      <section className="card stack" aria-labelledby="s-data">
        <h2 id="s-data">Backup</h2>
        <p className="small muted">Everything lives on this device. Export a backup now and then (the API key is left out).</p>
        <button className="btn" onClick={() => saveFile(`jarvis-backup-${nowStr().slice(0, 10)}.json`, exportJSON(st!, nowStr()), 'application/json')}>Export Backup</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import Backup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
        <button className="btn danger" onClick={async () => { if (confirm('Erase all data and start over with the seed data? Export a backup first if unsure.')) { await replaceAll(seedState()); toast('Reset to defaults.'); } }}>Reset Everything</button>
        <button className="btn ghost" onClick={() => save({ ...defaultSettings(), llm: s.llm })}>Restore Default Settings</button>
      </section>
      <p className="tiny faint" style={{ textAlign: 'center' }}>Version {__BUILD__}</p>
    </>
  );
}

function VoiceSettings() {
  const { st } = useApp();
  const s = st!.settings;
  const v = s.voice;
  const w = s.weather;
  const save = (patch: Partial<S>) => commit([putOp('settings', { ...s, ...patch })], 'Update settings', false);
  const setV = (patch: Partial<S['voice']>) => save({ voice: { ...v, ...patch } });
  const [voices, setVoices] = useState(() => listVoices());
  const [city, setCity] = useState(w.place);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ttsSupported()) return;
    const f = () => setVoices(listVoices());
    window.speechSynthesis.addEventListener?.('voiceschanged', f);
    f();
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', f);
  }, []);
  const findCity = async () => {
    if (!city.trim()) return;
    setBusy(true);
    try { const g = await geocode(city); save({ weather: g }); setCity(g.place); toast(`Weather set to ${g.place}.`); }
    catch (e) { toast(String((e as Error).message)); }
    setBusy(false);
  };
  const useLocation = () => {
    if (!navigator.geolocation) { toast('Location is not available here. Type a city instead.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => { save({ weather: { place: city.trim() || 'your area', lat: round2(pos.coords.latitude), lon: round2(pos.coords.longitude) } }); setBusy(false); toast('Weather location saved.'); },
      () => { setBusy(false); toast('Location permission denied. Type a city instead.'); },
      { maximumAge: 3600000, timeout: 10000 },
    );
  };
  const aiReady = s.llm.provider !== 'none' && !!s.llm.key;
  return (
    <>
      <section className="card stack" aria-labelledby="s-voice">
        <h2 id="s-voice">Voice</h2>
        <label className="check"><input type="checkbox" checked={v.enabled} onChange={e => setV({ enabled: e.target.checked })} />Jarvis talks back</label>
        {!ttsSupported() && <p className="small muted">This browser has no speech voices.</p>}
        <label className="field">Call me
          <input defaultValue={v.address} placeholder="boss…" autoComplete="off" onBlur={e => setV({ address: e.target.value.trim() || 'boss' })} />
        </label>
        <label className="field">Voice
          <select value={v.voiceURI} onChange={e => setV({ voiceURI: e.target.value })}>
            <option value="">Automatic (British if available)</option>
            {voices.map(x => <option key={x.voiceURI} value={x.voiceURI}>{x.name} ({x.lang})</option>)}
          </select>
          <span className="hint">More natural voices: iPhone Settings, Accessibility, Spoken Content, Voices, English, then download one (e.g. a British “Enhanced” voice).</span>
        </label>
        <label className="field">Speed {v.rate.toFixed(2)}x
          <input type="range" min={0.8} max={1.3} step={0.05} value={v.rate} onChange={e => setV({ rate: Number(e.target.value) })} />
        </label>
        <button className="btn" onClick={() => speak(`At your service, ${v.address || 'boss'}. Shall we get to work?`, { ...v, enabled: true })}>Test Voice</button>
        <button className="btn ghost" onClick={() => { try { localStorage.removeItem('jarvis-mic-blocked'); } catch { /* ignore */ } location.reload(); }}>Show Mic Button Again</button>
        <p className="tiny muted">If the round mic button doesn't work on your phone, use the microphone on the iPhone keyboard: tap “Speak or type”, then the keyboard mic.</p>
        <label className="check"><input type="checkbox" checked={v.aiBriefs} onChange={e => setV({ aiBriefs: e.target.checked })} />Witty AI briefings (uses Gemini)</label>
        <p className="tiny muted">{aiReady ? 'Morning brief and night wrap-up are written by the AI from your real schedule, once a day each.' : 'Add an AI key above to turn these on. Without it, Jarvis reads a standard briefing.'} Quick replies to commands always use built-in phrases so they are instant and offline.</p>
      </section>

      <section className="card stack" aria-labelledby="s-weather">
        <h2 id="s-weather">Weather</h2>
        <p className="small muted">For the morning brief. Uses the free Open-Meteo service; only your city or rounded location is sent.</p>
        <form className="row" onSubmit={e => { e.preventDefault(); void findCity(); }}>
          <label className="field grow"><span className="sr-only">City</span><input value={city} onChange={e => setCity(e.target.value)} placeholder="City, e.g. London…" autoComplete="off" /></label>
          <button className="btn" disabled={busy || !city.trim()}>Set</button>
        </form>
        <button className="btn ghost" onClick={useLocation} disabled={busy}>Use My Location</button>
        {w.lat !== undefined && <p className="tiny muted">Current: {w.place} ({w.lat}, {w.lon}). <button className="btn ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={() => save({ weather: { place: '' } })}>Clear</button></p>}
      </section>
    </>
  );
}
