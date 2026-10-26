"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartData, ChartMarker, MarkerKind } from "@/lib/dashboard/chart.ts";
import { CLAIM_SHORT, pct } from "@/lib/evidence/labels.ts";

const HEIGHT = 240;
const PAD = { top: 16, right: 48, bottom: 28, left: 44 };

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;

/** Y domain: the data's range padded and snapped to 5-point steps, at least 20 points tall. */
function yDomain(values: number[]): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  lo = Math.floor((lo - 0.02) * 20) / 20;
  hi = Math.ceil((hi + 0.02) * 20) / 20;
  while (hi - lo < 0.2) {
    lo -= 0.05;
    hi += 0.05;
  }
  return [Math.max(0, lo), Math.min(1, hi)];
}

function yTicks([lo, hi]: [number, number]): number[] {
  const step = hi - lo > 0.5 ? 0.2 : hi - lo > 0.25 ? 0.1 : 0.05;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function xTicks(start: string, end: string, width: number): string[] {
  const span = dayNum(end) - dayNum(start);
  const max = Math.max(2, Math.floor(width / 110));
  if (span <= 0) return [start];
  // Month starts when the range is long enough, else evenly spaced days.
  if (span > 75) {
    const out: string[] = [];
    let [y, m] = [+start.slice(0, 4), +start.slice(5, 7)];
    for (;;) {
      m += 1;
      if (m > 12) [y, m] = [y + 1, 1];
      const d = `${y}-${String(m).padStart(2, "0")}-01`;
      if (d > end) break;
      out.push(d);
    }
    const every = Math.ceil(out.length / max);
    return out.filter((_, i) => i % every === 0);
  }
  const n = Math.min(max, span);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = new Date((dayNum(start) + Math.round((span * i) / n)) * 86_400_000);
    return t.toISOString().slice(0, 10);
  });
}

export function MarkerShape({ kind, hollow, x, y, r = 5 }: { kind: MarkerKind; hollow: boolean; x: number; y: number; r?: number }) {
  const cls = `mk mk-${kind}${hollow ? " mk-hollow" : ""}`;
  switch (kind) {
    case "yes":
      return <path className={cls} d={`M${x},${y - r * 1.2} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8} Z`} />;
    case "no":
      return <path className={cls} d={`M${x},${y + r * 1.2} L${x + r * 1.1},${y - r * 0.8} L${x - r * 1.1},${y - r * 0.8} Z`} />;
    case "decay":
      return <path className={cls} d={`M${x},${y - r * 0.8} L${x + r * 0.8},${y} L${x},${y + r * 0.8} L${x - r * 0.8},${y} Z`} />;
    case "satisfied":
      return <rect className={cls} x={x - r} y={y - r} width={r * 2} height={r * 2} />;
  }
}

function Tooltip({ m }: { m: ChartMarker }) {
  return (
    <>
      <div className="tt-value">
        {pct(m.before)} → {pct(m.after)}
      </div>
      <div className="tt-date">{shortDate(m.date)}</div>
      <ul>
        {m.steps.map((s) => (
          <li key={`${s.id}-${s.claim}`}>
            <span className="tt-step">{s.label}</span>{" "}
            <span className="tt-muted">
              {CLAIM_SHORT[s.claim]} {pct(s.before)} → {pct(s.after)}
            </span>
            {s.backdated && s.approvedDate && (
              <div className="tt-muted">
                Added late: happened {shortDate(s.date)}, approved {shortDate(s.approvedDate)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Headline history: step line, one marker per date that moved it, crosshair + tooltip. */
export function HistoryChart({ data, label }: { data: ChartData; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { points, markers, start, end } = data;
  const x0 = dayNum(start);
  const span = Math.max(1, dayNum(end) - x0);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const domain = yDomain(points.map((p) => p.value));
  const x = (d: string) => PAD.left + ((dayNum(d) - x0) / span) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - domain[0]) / (domain[1] - domain[0])) * innerH;

  let path = "";
  points.forEach((p, i) => {
    path += i === 0 ? `M${x(p.date)},${y(p.value)}` : `H${x(p.date)}V${y(p.value)}`;
  });
  const last = points[points.length - 1];

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (markers.length === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    markers.forEach((m, i) => {
      if (Math.abs(x(m.date) - px) < Math.abs(x(markers[best].date) - px)) best = i;
    });
    setActive(Math.abs(x(markers[best].date) - px) <= 40 ? best : null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (markers.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(markers.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : markers.length)) + step)));
    } else if (e.key === "Escape") setActive(null);
  }

  const m = active !== null ? markers[active] : null;
  // Beside the crosshair, on whichever side has room, so it never covers the point.
  const TIP_W = 220;
  const tipLeft = m
    ? x(m.date) < width / 2
      ? Math.min(x(m.date) + 14, width - TIP_W)
      : Math.max(x(m.date) - 14 - TIP_W, 0)
    : 0;

  return (
    <div className="chart" ref={wrap}>
      <svg
        // Scales to the container before the real width is measured, so a phone never sees a 640px-wide first paint.
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        style={{ height: "auto" }}
        role="img"
        aria-label={`${label} since the start of the bet. Use the arrow keys to step through the changes.`}
        tabIndex={markers.length > 0 ? 0 : undefined}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {yTicks(domain).map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xTicks(start, end, innerW).map((d) => (
          <text key={d} className="axis" x={x(d)} y={HEIGHT - 8} textAnchor="middle">
            {span > 75 ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`}
          </text>
        ))}
        {m && <line className="crosshair" x1={x(m.date)} x2={x(m.date)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />}
        <path className="line" d={path} />
        {markers.map((mk, i) => (
          <g key={mk.date} className={i === active ? "active" : undefined}>
            <MarkerShape kind={mk.kind} hollow={mk.backdated} x={x(mk.date)} y={y(mk.after)} />
          </g>
        ))}
        <circle className="end-dot" cx={x(last.date)} cy={y(last.value)} r={4} />
        <text className="end-label" x={x(last.date) + 8} y={y(last.value)} dy="0.32em">
          {pct(last.value)}
        </text>
      </svg>
      {m && (
        <div className="tooltip" style={{ left: tipLeft }} role="status">
          <Tooltip m={m} />
        </div>
      )}
    </div>
  );
}
