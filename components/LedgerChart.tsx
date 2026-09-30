"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { LedgerPoint } from "@/lib/types";
import { fmtDay, monthTicks } from "./ui";

interface Props {
  points: LedgerPoint[];
  currentDay: number;
  maxDay: number;
}

// Two small multiples sharing one time axis (never a dual y-axis).
const W = 520;
const H = 232;
const M = { left: 34, right: 40, top: 14, bottom: 22 };
const GAP = 22;
const PH = (H - M.top - M.bottom - GAP) / 2;
const TOP1 = M.top;
const TOP2 = M.top + PH + GAP;
const PW = W - M.left - M.right;
const ATTN_MAX = 4;

const TRUST_COLOR = "var(--chart-trust)";
const ATTN_COLOR = "var(--chart-attn)";

export default function LedgerChart({ points, currentDay, maxDay }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const sorted = useMemo(() => [...points].sort((a, b) => a.day - b.day), [points]);
  const span = Math.max(1, maxDay, sorted.length ? sorted[sorted.length - 1].day : 0);
  const x = (d: number) => M.left + (Math.max(0, Math.min(span, d)) / span) * PW;
  const yT = (v: number) => TOP1 + (1 - Math.max(0, Math.min(1, v))) * PH;
  const yA = (v: number) => TOP2 + (1 - Math.max(0, Math.min(ATTN_MAX, v)) / ATTN_MAX) * PH;

  const path = (get: (p: LedgerPoint) => number, y: (v: number) => number) =>
    sorted.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  const ticks = monthTicks(span);
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const hp = hover !== null ? sorted[hover] : null;

  function onMove(e: MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg || sorted.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const day = ((px - M.left) / PW) * span;
    let best = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].day - day) < Math.abs(sorted[best].day - day)) best = i;
    }
    setHover(best);
  }

  if (sorted.length === 0) {
    return <div className="chart-empty">No ledger history yet — move the timeline forward.</div>;
  }

  const cx = x(Math.min(currentDay, span));
  const tipW = 176;
  const tipX = hp ? Math.min(W - M.right - tipW, Math.max(M.left, x(hp.day) + 8)) : 0;
  const tipFlip = hp ? x(hp.day) + 8 + tipW > W - M.right : false;

  return (
    <div className="ledger-chart">
      <div className="chart-legend">
        <span>
          <i style={{ background: TRUST_COLOR }} /> Trust (0–1)
        </span>
        <span>
          <i style={{ background: ATTN_COLOR }} /> Attention budget, interruptions / week (0–4)
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Trust and attention budget over time">
        {/* panel frames + grid */}
        {[0, 0.5, 1].map((v) => (
          <g key={`t${v}`}>
            <line x1={M.left} x2={W - M.right} y1={yT(v)} y2={yT(v)} className="chart-grid" />
            <text x={M.left - 6} y={yT(v) + 3} className="chart-ytick" textAnchor="end">
              {v === 0.5 ? ".5" : v}
            </text>
          </g>
        ))}
        {[0, 2, 4].map((v) => (
          <g key={`a${v}`}>
            <line x1={M.left} x2={W - M.right} y1={yA(v)} y2={yA(v)} className="chart-grid" />
            <text x={M.left - 6} y={yA(v) + 3} className="chart-ytick" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={M.left + 4} y={TOP1 - 4} className="chart-panel-title">
          Trust
        </text>
        <text x={M.left + 4} y={TOP2 - 4} className="chart-panel-title">
          Attention budget / week
        </text>

        {/* month ticks */}
        {ticks.map((t) => (
          <g key={t.day}>
            <line x1={x(t.day)} x2={x(t.day)} y1={H - M.bottom} y2={H - M.bottom + 4} className="chart-axis" />
            <text x={x(t.day) + 2} y={H - 6} className="chart-xtick">
              {t.label}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="chart-axis" />

        {/* series */}
        <path d={path((p) => p.trust, yT)} fill="none" stroke={TRUST_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path((p) => p.attentionBudget, yA)} fill="none" stroke={ATTN_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* current day marker */}
        <line x1={cx} x2={cx} y1={TOP1 - 2} y2={H - M.bottom} className="chart-now" />
        {cx > M.left + 60 && (
          <text x={cx} y={TOP1 - 4} className="chart-now-label" textAnchor={cx > W - M.right - 30 ? "end" : "middle"}>
            {fmtDay(currentDay)}
          </text>
        )}

        {/* direct labels on the latest value */}
        {last && (
          <>
            <circle cx={x(last.day)} cy={yT(last.trust)} r={4} fill={TRUST_COLOR} className="chart-dot" />
            <text x={x(last.day) + 7} y={yT(last.trust) + 4} className="chart-end-label">
              {last.trust.toFixed(2)}
            </text>
            <circle cx={x(last.day)} cy={yA(last.attentionBudget)} r={4} fill={ATTN_COLOR} className="chart-dot" />
            <text x={x(last.day) + 7} y={yA(last.attentionBudget) + 4} className="chart-end-label">
              {last.attentionBudget.toFixed(1)}
            </text>
          </>
        )}

        {/* hover layer */}
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.day)} x2={x(hp.day)} y1={TOP1} y2={H - M.bottom} className="chart-cross" />
            <circle cx={x(hp.day)} cy={yT(hp.trust)} r={4.5} fill={TRUST_COLOR} className="chart-dot" />
            <circle cx={x(hp.day)} cy={yA(hp.attentionBudget)} r={4.5} fill={ATTN_COLOR} className="chart-dot" />
            <g transform={`translate(${tipFlip ? Math.max(M.left, x(hp.day) - 8 - tipW) : tipX}, ${TOP1 + 4})`}>
              <rect width={tipW} height={52} rx={6} className="chart-tip" />
              <text x={10} y={17} className="chart-tip-title">
                {fmtDay(hp.day, true)}
              </text>
              <circle cx={14} cy={30} r={3.5} fill={TRUST_COLOR} />
              <text x={24} y={33} className="chart-tip-text">
                Trust {hp.trust.toFixed(2)}
              </text>
              <circle cx={14} cy={43} r={3.5} fill={ATTN_COLOR} />
              <text x={24} y={46} className="chart-tip-text">
                Attention {hp.attentionBudget.toFixed(1)} / week
              </text>
            </g>
          </g>
        )}
        <rect
          x={M.left}
          y={TOP1}
          width={PW}
          height={H - M.bottom - TOP1}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
    </div>
  );
}
