import React, { useState } from 'react';

const el = (window as any).electron;

interface Rule {
    field: 'genre' | 'bpm' | 'energy' | 'key' | 'mood' | 'artist';
    operator: 'is' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';
    value: string;
}

const FIELD_OPTIONS: { value: Rule['field']; label: string }[] = [
    { value: 'genre', label: 'Genre' },
    { value: 'bpm', label: 'BPM' },
    { value: 'energy', label: 'Energy' },
    { value: 'key', label: 'Key (Camelot)' },
    { value: 'mood', label: 'Mood' },
    { value: 'artist', label: 'Artist' },
];

const OPERATOR_MAP: Record<Rule['field'], { value: Rule['operator']; label: string }[]> = {
    genre: [{ value: 'is', label: '=' }, { value: 'contains', label: 'contains' }],
    bpm: [{ value: 'gte', label: '≥' }, { value: 'lte', label: '≤' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }],
    energy: [{ value: 'gte', label: '≥' }, { value: 'lte', label: '≤' }],
    key: [{ value: 'is', label: '=' }],
    mood: [{ value: 'is', label: '=' }, { value: 'contains', label: 'contains' }],
    artist: [{ value: 'is', label: '=' }, { value: 'contains', label: 'contains' }],
};

interface SmartFolderModalProps {
    onClose: () => void;
    onCreated: () => void;
}

const SmartFolderModal: React.FC<SmartFolderModalProps> = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [rules, setRules] = useState<Rule[]>([{ field: 'genre', operator: 'is', value: '' }]);
    const [matchAll, setMatchAll] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const addRule = () => setRules(r => [...r, { field: 'genre', operator: 'is', value: '' }]);

    const updateRule = (index: number, patch: Partial<Rule>) => {
        setRules(r => r.map((rule, i) => {
            if (i !== index) return rule;
            const updated = { ...rule, ...patch };
            // Reset operator when field changes
            if (patch.field) updated.operator = OPERATOR_MAP[patch.field][0].value;
            return updated;
        }));
    };

    const removeRule = (index: number) => setRules(r => r.filter((_, i) => i !== index));

    const handleSave = async () => {
        if (!name.trim()) { setError('Please give this Smart Folder a name.'); return; }
        if (rules.some(r => !r.value.trim())) { setError('All rules must have a value.'); return; }
        setSaving(true); setError('');
        try {
            await el.invoke('smartfolder:create', { name: name.trim(), rules, matchAll });
            onCreated();
            onClose();
        } catch (e: any) {
            setError(e.message ?? 'Failed to save Smart Folder.');
        } finally { setSaving(false); }
    };

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
            onClick={onClose}
        >
            <div
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px', width: 500, maxWidth: '90vw', boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                        </svg>
                    </div>
                    <div>
                        <h2 style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>New Smart Folder</h2>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Auto-curates tracks matching your rules</p>
                    </div>
                </div>

                {/* Name */}
                <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Folder Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder='e.g. "Late Night Techno"'
                        autoFocus
                        className="search-input"
                        style={{ width: '100%', padding: '9px 12px' }}
                    />
                </div>

                {/* Match mode */}
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Match</span>
                    {[{ val: true, label: 'All rules' }, { val: false, label: 'Any rule' }].map(({ val, label }) => (
                        <button
                            key={label}
                            onClick={() => setMatchAll(val)}
                            style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '4px 10px',
                                borderRadius: 6,
                                border: `1px solid ${matchAll === val ? 'var(--border-accent)' : 'var(--border)'}`,
                                background: matchAll === val ? 'var(--accent-dim)' : 'transparent',
                                color: matchAll === val ? 'var(--accent)' : 'var(--text-muted)',
                                cursor: 'pointer',
                                transition: 'all 0.1s',
                            }}
                        >{label}</button>
                    ))}
                </div>

                {/* Rules */}
                <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Rules</label>
                    {rules.map((rule, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {/* Field */}
                            <select
                                value={rule.field}
                                onChange={e => updateRule(i, { field: e.target.value as Rule['field'] })}
                                className="search-input"
                                style={{ flex: 1.5, padding: '7px 10px', fontSize: 12 }}
                            >
                                {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>

                            {/* Operator */}
                            <select
                                value={rule.operator}
                                onChange={e => updateRule(i, { operator: e.target.value as Rule['operator'] })}
                                className="search-input"
                                style={{ flex: 0.8, padding: '7px 8px', fontSize: 12 }}
                            >
                                {OPERATOR_MAP[rule.field].map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>

                            {/* Value */}
                            <input
                                type={['bpm', 'energy'].includes(rule.field) ? 'number' : 'text'}
                                value={rule.value}
                                onChange={e => updateRule(i, { value: e.target.value })}
                                placeholder={rule.field === 'bpm' ? '128' : rule.field === 'energy' ? '7' : 'value'}
                                className="search-input"
                                style={{ flex: 1.5, padding: '7px 10px', fontSize: 12 }}
                            />

                            {/* Remove */}
                            {rules.length > 1 && (
                                <button onClick={() => removeRule(i)} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,79,106,0.1)', border: '1px solid rgba(255,79,106,0.2)', borderRadius: 6, color: 'var(--danger)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>×</button>
                            )}
                        </div>
                    ))}

                    <button
                        onClick={addRule}
                        style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: '1px dashed var(--border-accent)', borderRadius: 7, padding: '7px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 2 }}
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                        Add Rule
                    </button>
                </div>

                {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12, padding: '8px 12px', background: 'rgba(255,79,106,0.08)', borderRadius: 7, border: '1px solid rgba(255,79,106,0.2)' }}>{error}</div>}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn btn-primary"
                        style={{ flex: 2, justifyContent: 'center', opacity: saving ? 0.7 : 1 }}
                    >
                        {saving ? 'Saving…' : 'Create Smart Folder'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SmartFolderModal;
