import React, { useRef, useState, useEffect, useCallback } from 'react';

const ipc = (window as any).electron;

interface ControlPoint {
    /** 0–1 normalized position along the track duration */
    t: number;
    /** 0–1 normalized value */
    v: number;
}

interface Lane {
    id: string;
    label: string;
    color: string;
    points: ControlPoint[];
}

const DEFAULT_LANES: Lane[] = [
    { id: 'volume', label: 'Vol', color: '#6C63FF', points: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
    { id: 'eq_low', label: 'Low', color: '#f97316', points: [{ t: 0, v: 0.67 }, { t: 1, v: 0.67 }] },
    { id: 'eq_mid', label: 'Mid', color: '#22d3ee', points: [{ t: 0, v: 0.67 }, { t: 1, v: 0.67 }] },
    { id: 'eq_high', label: 'Hi', color: '#a78bfa', points: [{ t: 0, v: 0.67 }, { t: 1, v: 0.67 }] },
];

interface Props {
    playlistId: string;
    trackId: string;
    durationMs: number;
}

const LANE_H = 48;
const LABEL_W = 40;
const DOT_R = 5;

export const AutomationLane: React.FC<Props> = ({ playlistId, trackId, durationMs }) => {
    const [lanes, setLanes] = useState<Lane[]>(DEFAULT_LANES.map(l => ({ ...l, points: l.points.map(p => ({ ...p })) })));
    const [dragging, setDragging] = useState<{ laneId: string; ptIdx: number } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [svgWidth, setSvgWidth] = useState(600);
    const dirty = useRef(false);

    useEffect(() => {
        const ro = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width;
            if (w) setSvgWidth(Math.max(200, w - LABEL_W - 16));
        });
        if (svgRef.current?.parentElement) ro.observe(svgRef.current.parentElement);
        return () => ro.disconnect();
    }, []);

    const totalH = lanes.length * LANE_H;
    const ptX = (t: number) => t * svgWidth;
    const ptY = (v: number, laneIdx: number) => laneIdx * LANE_H + (1 - v) * (LANE_H - 10) + 5;
    const laneForY = (y: number) => Math.max(0, Math.min(lanes.length - 1, Math.floor(y / LANE_H)));

    const persist = useCallback(() => {
        if (!dirty.current) return;
        dirty.current = false;
        const automationJson = Object.fromEntries(lanes.map(l => [l.id, l.points]));
        ipc.invoke('playlist:update-track-automation', { playlistId, trackId, automationJson }).catch(() => { });
    }, [lanes, playlistId, trackId]);

    const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const laneIdx = laneForY(y);
        const lane = lanes[laneIdx];
        if (!lane) return;

        for (let pi = 0; pi < lane.points.length; pi++) {
            const px = ptX(lane.points[pi].t);
            const py = ptY(lane.points[pi].v, laneIdx);
            if (Math.hypot(x - px, y - py) <= DOT_R + 4) {
                setDragging({ laneId: lane.id, ptIdx: pi });
                return;
            }
        }

        const t = Math.max(0, Math.min(1, x / svgWidth));
        const v = Math.max(0, Math.min(1, 1 - (y - laneIdx * LANE_H) / (LANE_H - 10)));
        setLanes(prev => prev.map(l => l.id !== lane.id ? l : {
            ...l, points: [...l.points, { t, v }].sort((a, b) => a.t - b.t),
        }));
        dirty.current = true;
    }, [lanes, svgWidth]);

    const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!dragging || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const laneIdx = lanes.findIndex(l => l.id === dragging.laneId);
        const t = Math.max(0, Math.min(1, x / svgWidth));
        const v = Math.max(0, Math.min(1, 1 - (y - laneIdx * LANE_H) / (LANE_H - 10)));
        setLanes(prev => prev.map(l => l.id !== dragging.laneId ? l : {
            ...l, points: l.points.map((p, pi) => pi === dragging.ptIdx ? { t, v } : p),
        }));
        dirty.current = true;
    }, [dragging, lanes, svgWidth]);

    const onMouseUp = useCallback(() => { setDragging(null); persist(); }, [persist]);

    const onDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const laneIdx = laneForY(y);
        const lane = lanes[laneIdx];
        if (!lane) return;
        for (let pi = 0; pi < lane.points.length; pi++) {
            const px = ptX(lane.points[pi].t);
            const py = ptY(lane.points[pi].v, laneIdx);
            if (Math.hypot(x - px, y - py) <= DOT_R + 4 && lane.points.length > 2) {
                setLanes(prev => prev.map(l => l.id !== lane.id ? l : {
                    ...l, points: l.points.filter((_, i) => i !== pi),
                }));
                dirty.current = true;
                setTimeout(persist, 0);
                return;
            }
        }
    }, [lanes, persist]);

    const polyline = (points: ControlPoint[], laneIdx: number) =>
        points.map(p => `${ptX(p.t)},${ptY(p.v, laneIdx)}`).join(' ');

    const resetLane = (laneId: string) => {
        const defLane = DEFAULT_LANES.find(l => l.id === laneId);
        if (!defLane) return;
        setLanes(prev => prev.map(l => l.id !== laneId ? l : { ...l, points: defLane.points.map(p => ({ ...p })) }));
        dirty.current = true;
        setTimeout(persist, 0);
    };

    return (
        <div style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                    Automation
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Click to add · Double-click to remove</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                {/* Lane labels */}
                <div style={{ width: LABEL_W, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    {lanes.map((lane, i) => (
                        <div
                            key={lane.id}
                            style={{ height: LANE_H, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6, gap: 2 }}
                        >
                            <span style={{ fontSize: 9, fontWeight: 700, color: lane.color }}>{lane.label}</span>
                            <button
                                onClick={() => resetLane(lane.id)}
                                title="Reset lane"
                                style={{ fontSize: 8, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                            >↺</button>
                        </div>
                    ))}
                </div>

                {/* SVG canvas */}
                <svg
                    ref={svgRef}
                    width="100%"
                    height={totalH}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                    onDoubleClick={onDoubleClick}
                    style={{ cursor: dragging ? 'grabbing' : 'crosshair', userSelect: 'none', display: 'block', flex: 1 }}
                >
                    {lanes.map((lane, laneIdx) => (
                        <g key={lane.id}>
                            {/* Lane background */}
                            <rect
                                x={0} y={laneIdx * LANE_H}
                                width={svgWidth} height={LANE_H}
                                fill={laneIdx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}
                            />
                            {/* Lane separator */}
                            <line x1={0} y1={laneIdx * LANE_H} x2={svgWidth} y2={laneIdx * LANE_H} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                            {/* Unity/default dashed guide */}
                            <line
                                x1={0} y1={ptY(0.67, laneIdx)}
                                x2={svgWidth} y2={ptY(0.67, laneIdx)}
                                stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="4 4"
                            />
                            {/* Fill under curve */}
                            {lane.points.length >= 2 && (
                                <polygon
                                    points={`${ptX(0)},${ptY(0, laneIdx) + 10} ${polyline(lane.points, laneIdx)} ${ptX(1)},${ptY(0, laneIdx) + 10}`}
                                    fill={lane.color}
                                    opacity={0.07}
                                />
                            )}
                            {/* Automation curve */}
                            <polyline
                                points={polyline(lane.points, laneIdx)}
                                fill="none"
                                stroke={lane.color}
                                strokeWidth={1.5}
                                opacity={0.85}
                            />
                            {/* Control points */}
                            {lane.points.map((p, pi) => (
                                <g key={pi}>
                                    <circle
                                        cx={ptX(p.t)} cy={ptY(p.v, laneIdx)}
                                        r={DOT_R + 3}
                                        fill="transparent"
                                        style={{ cursor: 'grab' }}
                                    />
                                    <circle
                                        cx={ptX(p.t)} cy={ptY(p.v, laneIdx)}
                                        r={DOT_R}
                                        fill={lane.color}
                                        stroke="rgba(0,0,0,0.5)"
                                        strokeWidth={1.5}
                                        style={{ cursor: 'grab' }}
                                        filter={dragging?.laneId === lane.id && dragging?.ptIdx === pi ? `drop-shadow(0 0 4px ${lane.color})` : undefined}
                                    />
                                </g>
                            ))}
                        </g>
                    ))}
                </svg>
            </div>
        </div>
    );
};

export default AutomationLane;
