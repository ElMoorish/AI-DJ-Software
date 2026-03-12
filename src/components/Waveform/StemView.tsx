import React, { useEffect, useState } from 'react';

const ipc = (window as any).electron;

interface StemData {
    vocals: string | null;
    drums: string | null;
    bass: string | null;
    melody: string | null;
}

const STEMS = [
    { key: 'vocals' as const, label: 'Vocals', color: '#f472b6', icon: '🎤' },
    { key: 'drums' as const, label: 'Drums', color: '#ef4444', icon: '🥁' },
    { key: 'bass' as const, label: 'Bass', color: '#60a5fa', icon: '🎸' },
    { key: 'melody' as const, label: 'Melody', color: '#4ade80', icon: '🎹' },
];

interface Props {
    trackId: string;
}

/** Deterministic "waveform" bars from seed string */
function fakeBars(seed: string, count = 64): number[] {
    return Array.from({ length: count }, (_, i) => {
        const v = Math.abs(Math.sin(i * 0.7 + seed.charCodeAt(0) * 0.3));
        return 15 + v * 70;
    });
}

export const StemView: React.FC<Props> = ({ trackId }) => {
    const [stems, setStems] = useState<StemData>({ vocals: null, drums: null, bass: null, melody: null });
    const [separating, setSeparating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [muted, setMuted] = useState<Set<string>>(new Set());

    useEffect(() => {
        const handler = (_: unknown, data: { percent: number; done?: boolean; stems?: StemData; error?: string }) => {
            if (data.error) { setError(data.error); setSeparating(false); return; }
            setProgress(data.percent ?? 0);
            if (data.done && data.stems) {
                setStems(data.stems);
                setSeparating(false);
                setProgress(100);
            }
        };
        ipc.on?.('stems:progress', handler);
        return () => ipc.off?.('stems:progress', handler);
    }, []);

    const separate = async () => {
        setSeparating(true);
        setError('');
        setProgress(0);
        try {
            await ipc.invoke('stems:separate', trackId);
        } catch (e: any) {
            setError(e.message ?? 'Stem separation failed');
            setSeparating(false);
        }
    };

    const toggleMute = (key: string) => {
        setMuted(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const hasStem = Object.values(stems).some(Boolean);

    return (
        <div style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Stem Separation</span>
                    {hasStem && (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', fontWeight: 700 }}>DONE</span>
                    )}
                </div>
                {!hasStem && (
                    <button
                        id={`stems-separate-btn-${trackId}`}
                        onClick={separate}
                        disabled={separating}
                        className="btn btn-primary"
                        style={{ height: 24, fontSize: 10, padding: '0 10px', gap: 4, opacity: separating ? 0.7 : 1 }}
                    >
                        {separating ? (
                            <>
                                <div style={{ width: 10, height: 10, border: '1.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                {progress}%
                            </>
                        ) : (
                            <>⚡ Separate</>
                        )}
                    </button>
                )}
            </div>

            {/* Progress bar */}
            {separating && (
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{
                        height: '100%',
                        borderRadius: 100,
                        width: `${progress}%`,
                        background: 'linear-gradient(to right, var(--accent), #22d3ee)',
                        transition: 'width 0.4s ease',
                    }} />
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{ fontSize: 11, color: 'var(--danger)', padding: '8px 12px', background: 'rgba(255,79,106,0.1)', borderRadius: 7, border: '1px solid rgba(255,79,106,0.2)', marginBottom: 8 }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Stem lanes */}
            {hasStem ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {STEMS.map(stem => {
                        const hasFile = !!stems[stem.key];
                        const isMuted = muted.has(stem.key);
                        const bars = fakeBars(stem.key);
                        return (
                            <div key={stem.key} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28 }}>
                                {/* Mute toggle */}
                                <button
                                    id={`stem-mute-${stem.key}-${trackId}`}
                                    onClick={() => toggleMute(stem.key)}
                                    title={isMuted ? `Unmute ${stem.label}` : `Mute ${stem.label}`}
                                    style={{
                                        width: 52,
                                        height: 22,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 4,
                                        fontSize: 9,
                                        fontWeight: 700,
                                        borderRadius: 5,
                                        border: `1px solid ${isMuted ? 'rgba(255,255,255,0.08)' : stem.color + '55'}`,
                                        background: isMuted ? 'rgba(255,255,255,0.04)' : stem.color + '22',
                                        color: isMuted ? 'var(--text-muted)' : stem.color,
                                        cursor: 'pointer',
                                        transition: 'all 0.12s ease',
                                        flexShrink: 0,
                                        letterSpacing: '0.05em',
                                    }}
                                >
                                    <span style={{ fontSize: 10 }}>{stem.icon}</span>
                                    {stem.label.substring(0, 4).toUpperCase()}
                                </button>

                                {/* Waveform bars */}
                                <div style={{
                                    flex: 1,
                                    height: 24,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                    borderRadius: 5,
                                    overflow: 'hidden',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 2px',
                                    transition: 'opacity 0.2s',
                                    opacity: isMuted ? 0.2 : 1,
                                }}>
                                    {hasFile ? (
                                        bars.map((h, i) => (
                                            <div
                                                key={i}
                                                style={{
                                                    flex: 1,
                                                    height: `${h}%`,
                                                    background: stem.color,
                                                    borderRadius: 1,
                                                    marginRight: i < bars.length - 1 ? 1 : 0,
                                                    opacity: 0.75,
                                                }}
                                            />
                                        ))
                                    ) : (
                                        <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '0 6px' }}>—</span>
                                    )}
                                </div>

                                {/* Format badge */}
                                {hasFile && (
                                    <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>WAV</span>
                                )}
                            </div>
                        );
                    })}
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                        Mute is visual only — stem isolation requires playback routing
                    </div>
                </div>
            ) : !separating && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                    Separate this track into 4 stems: Vocals, Drums, Bass, Melody
                </div>
            )}
        </div>
    );
};

export default StemView;
