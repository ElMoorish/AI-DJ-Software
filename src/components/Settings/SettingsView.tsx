import React, { useState, useEffect, useCallback } from 'react';
import { AudioDevice } from '../../types';

const ipc = (window as any).electron;

interface AppSettings {
  output_device?: string;
  sample_rate?: number;
  buffer_size?: number;
  watched_folders?: string[];
}

const SAMPLE_RATES = [44100, 48000, 96000];
const BUFFER_SIZES = [64, 128, 256, 512, 1024];

/* ── Styled select ── */
const StyledSelect: React.FC<{ id?: string; value: string | number; onChange: (val: string) => void; children: React.ReactNode }> = ({ id, value, onChange, children }) => (
  <select
    id={id}
    value={value}
    onChange={e => onChange(e.target.value)}
    style={{
      width: '100%',
      background: 'var(--bg-surface-3)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 13,
      color: 'var(--text-primary)',
      outline: 'none',
      cursor: 'pointer',
      appearance: 'none',
      WebkitAppearance: 'none',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 10px center',
      paddingRight: 32,
    }}
  >
    {children}
  </select>
);

/* ── Section Card ── */
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '20px 24px',
    maxWidth: 600,
    ...style,
  }}>
    {children}
  </div>
);

/* ── Field group ── */
const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
    {children}
    {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
  </div>
);

const MODEL_NAMES: Record<string, { label: string; description: string }> = {
  genre_classifier: { label: 'Genre Classifier', description: 'CNN on Mel-spectrogram' },
  mood_classifier: { label: 'Mood Classifier', description: 'HuBERT transformer' },
  clap_embedding: { label: 'Audio Embeddings', description: 'CLAP similarity model' },
  beat_detector: { label: 'Beat / BPM Detector', description: 'Onset detection' },
};

const ModelStatusSection: React.FC = () => {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState<{ model?: string; percent?: number; error?: string }>({});
  const [dlError, setDlError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatus = () =>
    ipc.invoke('models:check-status')
      .then((s: Record<string, string>) => { setStatuses(s ?? {}); setLoaded(true); })
      .catch(() => setLoaded(true));

  useEffect(() => {
    refreshStatus();

    const handler = (_: unknown, data: any) => {
      if (data.done) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setDownloading(false);
        setDlProgress({});
        refreshStatus();
      } else {
        if (data.error) {
          setDlError(data.error);
          setDlProgress({ model: data.model, percent: 0, error: data.error });
        } else {
          setDlError('');
          setDlProgress({ model: data.model, percent: data.percent ?? 0 });
        }
      }
    };
    ipc.on?.('models:download-progress', handler);
    return () => {
      ipc.off?.('models:download-progress', handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startDownload = () => {
    setDownloading(true);
    setDlError('');
    setDlProgress({ model: 'Starting…', percent: 0 });
    // 90s UI failsafe
    timeoutRef.current = setTimeout(() => {
      setDownloading(false);
      setDlError('Timed out after 90s. Check Python is installed and URLs in manifest.json are reachable.');
      setDlProgress({});
    }, 90_000);
    ipc.invoke('models:bootstrap').catch((e: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setDownloading(false);
      setDlError(e?.message ?? 'IPC error — see main process logs.');
    });
  };

  const missing = loaded ? Object.values(statuses).filter(s => s !== 'ok').length : 0;
  const currentModel = dlProgress.model;
  const currentPct = dlProgress.percent ?? 0;

  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
        AI Models
      </div>
      <Card>
        {!loaded ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }} className="animate-pulse-glow">Checking model status…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(MODEL_NAMES).map(([key, info]) => {
              const ok = statuses[key] === 'ok';
              const isCurrentlyDl = downloading && currentModel === key;
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 8, transition: 'all 0.2s ease',
                  background: ok ? 'rgba(0,230,118,0.05)' : isCurrentlyDl ? 'rgba(108,99,255,0.08)' : 'rgba(255,79,106,0.05)',
                  border: `1px solid ${ok ? 'rgba(0,230,118,0.12)' : isCurrentlyDl ? 'rgba(108,99,255,0.25)' : 'rgba(255,79,106,0.12)'}`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: ok ? 'rgba(0,230,118,0.12)' : isCurrentlyDl ? 'rgba(108,99,255,0.15)' : 'rgba(255,79,106,0.1)',
                  }}>
                    {ok
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      : isCurrentlyDl
                        ? <div style={{ width: 14, height: 14, border: '2px solid rgba(108,99,255,0.3)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{info.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {isCurrentlyDl ? `Downloading… ${currentPct}%` : info.description}
                    </div>
                    {isCurrentlyDl && currentPct > 0 && (
                      <div style={{ marginTop: 4, height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 100, width: `${currentPct}%`, background: 'linear-gradient(to right, var(--accent), #22d3ee)', transition: 'width 0.3s ease' }} />
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase',
                    background: ok ? 'rgba(0,230,118,0.12)' : isCurrentlyDl ? 'rgba(108,99,255,0.2)' : 'rgba(255,79,106,0.1)',
                    color: ok ? 'var(--success)' : isCurrentlyDl ? 'var(--accent)' : 'var(--danger)',
                  }}>
                    {ok ? 'Ready' : isCurrentlyDl ? `${currentPct}%` : 'Missing'}
                  </span>
                </div>
              );
            })}

            {/* Error banner */}
            {dlError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,79,106,0.08)', border: '1px solid rgba(255,79,106,0.2)', fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <span style={{ flex: 1 }}>{dlError}</span>
                <button onClick={() => setDlError('')} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>×</button>
              </div>
            )}

            {/* Overall progress during download */}
            {downloading && (
              <div style={{ padding: '0 2px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{currentModel ?? 'Starting Python…'}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{currentPct}%</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 100,
                    width: currentPct > 0 ? `${currentPct}%` : '40%',
                    background: 'linear-gradient(to right, var(--accent), #22d3ee)',
                    transition: currentPct > 0 ? 'width 0.3s ease' : 'none',
                    animation: currentPct === 0 ? 'shimmer 1.5s ease-in-out infinite' : 'none',
                  }} />
                </div>
              </div>
            )}

            {/* Download button */}
            {missing > 0 && !downloading && (
              <>
                <button
                  id="models-download-btn"
                  onClick={startDownload}
                  className="btn btn-primary"
                  style={{ marginTop: 4, justifyContent: 'center' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
                  </svg>
                  {dlError ? 'Retry Download' : `Download ${missing} Missing Model${missing > 1 ? 's' : ''}`}
                </button>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Requires Python 3.8+ with <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9 }}>pip install requests</code> installed. Model weights ~250 MB from Hugging Face.
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </section>
  );
};

const SettingsView: React.FC = () => {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ sample_rate: 44100, buffer_size: 256, watched_folders: [] });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    ipc.invoke('system:list-devices').then((d: AudioDevice[]) => setDevices(d ?? []));
    ipc.invoke('settings:get-all').then((s: Record<string, unknown>) => {
      if (s) setSettings({
        output_device: s.output_device as string | undefined,
        sample_rate: (s.sample_rate as number) ?? 44100,
        buffer_size: (s.buffer_size as number) ?? 256,
        watched_folders: (s.watched_folders as string[]) ?? [],
      });
    });
  }, []);

  const saveSetting = useCallback(async (key: string, value: unknown) => {
    await ipc.invoke('settings:set', key, value);
  }, []);

  const addFolder = async () => {
    const folderPath: string | null = await ipc.invoke('dialog:open-directory');
    if (!folderPath) return;
    const updated = [...(settings.watched_folders ?? []), folderPath];
    setSettings(s => ({ ...s, watched_folders: updated }));
    await saveSetting('watched_folders', updated);
    setSaving(true); setSaveMsg('Scanning…');
    try {
      await ipc.invoke('library:scan', folderPath);
      setSaveMsg('Scan started ✓');
    } catch (e: any) {
      setSaveMsg(`Scan error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 4000);
    }
  };

  const removeFolder = async (folder: string) => {
    const updated = (settings.watched_folders ?? []).filter(f => f !== folder);
    setSettings(s => ({ ...s, watched_folders: updated }));
    await saveSetting('watched_folders', updated);
  };

  const exportAudit = async () => {
    setExporting(true);
    try {
      const json = await ipc.invoke('audit:export');
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `aidj-audit-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const latencyMs = settings.buffer_size && settings.sample_rate
    ? ((settings.buffer_size / settings.sample_rate) * 1000 * 2).toFixed(1)
    : null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 40px', background: 'var(--bg-base)' }}>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Settings</h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>All settings are saved automatically and stored locally.</p>
      </div>

      {/* ── Audio Hardware ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Audio Hardware
        </div>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="Output Device">
              <StyledSelect
                id="output-device-select"
                value={settings.output_device ?? ''}
                onChange={v => { setSettings(s => ({ ...s, output_device: v })); saveSetting('output_device', v); }}
              >
                <option value="">— Select device —</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.driver_type}) • {d.latency_ms.toFixed(1)} ms</option>
                ))}
                {devices.length === 0 && <option disabled>No audio devices found</option>}
              </StyledSelect>
            </Field>

            <div style={{ display: 'flex', gap: 16 }}>
              <Field label="Sample Rate" hint={`${settings.sample_rate?.toLocaleString()} Hz`}>
                <StyledSelect
                  id="sample-rate-select"
                  value={settings.sample_rate ?? 44100}
                  onChange={v => { const r = Number(v); setSettings(s => ({ ...s, sample_rate: r })); saveSetting('sample_rate', r); }}
                >
                  {SAMPLE_RATES.map(r => <option key={r} value={r}>{r.toLocaleString()} Hz</option>)}
                </StyledSelect>
              </Field>
              <Field label="Buffer Size" hint={latencyMs ? `~${latencyMs} ms round-trip` : undefined}>
                <StyledSelect
                  id="buffer-size-select"
                  value={settings.buffer_size ?? 256}
                  onChange={v => { const b = Number(v); setSettings(s => ({ ...s, buffer_size: b })); saveSetting('buffer_size', b); }}
                >
                  {BUFFER_SIZES.map(b => <option key={b} value={b}>{b} samples</option>)}
                </StyledSelect>
              </Field>
            </div>
          </div>
        </Card>
      </section>

      {/* ── Music Library ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Music Library
        </div>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Watched Folders</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI DJ will continuously monitor these folders for new tracks.</div>
              </div>
              <button
                id="add-folder-btn"
                onClick={addFolder}
                disabled={saving}
                className="btn btn-primary"
                style={{ flexShrink: 0, opacity: saving ? 0.5 : 1 }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {saving ? saveMsg : 'Add Folder'}
              </button>
            </div>

            {(settings.watched_folders ?? []).length === 0 ? (
              <div style={{
                padding: '20px 16px',
                borderRadius: 8,
                border: '1px dashed rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.02)',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}>
                No folders added yet. Click <strong style={{ color: 'var(--text-secondary)' }}>Add Folder</strong> to scan your music library.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {settings.watched_folders!.map(folder => (
                  <div key={folder} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'var(--bg-surface-3)',
                    border: '1px solid var(--border)',
                    gap: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" style={{ flexShrink: 0 }}>
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder}
                      </span>
                    </div>
                    <button
                      onClick={() => removeFolder(folder)}
                      style={{ fontSize: 11, color: 'var(--danger)', cursor: 'pointer', background: 'none', border: 'none', flexShrink: 0, padding: '2px 8px' }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {saveMsg && !saving && (
              <p style={{ fontSize: 12, color: 'var(--success)' }}>✓ {saveMsg}</p>
            )}
          </div>
        </Card>
      </section>

      {/* ── AI Models ── */}
      <ModelStatusSection />

      {/* ── Security & SOC2 ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Security & Compliance
        </div>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Audit Logs</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 360 }}>
                  Every library scan, playlist generation, and settings change is logged locally. Logs are immutable and cannot be edited or deleted (SOC2 Rule 3).
                </div>
              </div>
              <button
                id="export-audit-btn"
                onClick={exportAudit}
                disabled={exporting}
                className="btn btn-ghost"
                style={{ flexShrink: 0, opacity: exporting ? 0.5 : 1 }}
              >
                {exporting ? 'Exporting…' : 'Export Report'}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'Local-only audio processing — no data uploaded',
                'Database encrypted at rest (AES-256 via SQLCipher)',
                'ML sidecar HMAC-authenticated — localhost only',
              ].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px rgba(0,230,118,0.5)', flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
};

export default SettingsView;
