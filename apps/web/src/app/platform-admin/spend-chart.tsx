"use client";

import { useEffect, useRef, useState } from "react";
import type { DailySpend } from "./data";

/**
 * Daily spend columns. One series, so no legend: the card title names
 * it. Columns are capped thin with a 2px gap, rounded at the top and
 * square at the baseline; hovering (or focusing) a column shows its
 * day, spend and number of generations. A visually hidden table carries
 * the same numbers for screen readers.
 */
export function SpendChart({ data, height = 160 }: { data: DailySpend[]; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  // Draw at the container's real pixel width so axis text stays 11px instead of scaling with a viewBox.
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(...data.map((d) => d.usd), 0);
  const niceMax = max <= 0 ? 1 : niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];

  const padLeft = 44;
  const padBottom = 22;
  const plotW = width - padLeft;
  const plotH = height - padBottom;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(2, slot - 2));

  const hovered = active !== null ? data[active] : null;

  return (
    <div ref={boxRef} className="relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full overflow-visible"
        role="img"
        aria-label={`Daily spend over the last ${data.length} days, up to ${formatMoney(max)} per day`}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => {
          const y = plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={padLeft} x2={width} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" className="fill-foreground-muted text-[11px] tabular-nums">
                {formatMoney(t, true)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const h = d.usd > 0 ? Math.max(2, (d.usd / niceMax) * plotH) : 0;
          const x = padLeft + i * slot + (slot - barW) / 2;
          const y = plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.day}>
              {/* Hit target is the whole column slot, taller and wider than the mark. */}
              <rect
                x={padLeft + i * slot}
                y={0}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatDay(d.day)}: ${formatMoney(d.usd)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              />
              {h > 0 && (
                <path
                  d={`M${x},${plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${plotH} Z`}
                  className="pointer-events-none"
                  fill="var(--chart-bar)"
                  opacity={active === null || active === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}

        {[0, Math.floor((data.length - 1) / 2), data.length - 1]
          .filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx)
          .map((i) => (
            <text
              key={i}
              x={padLeft + i * slot + slot / 2}
              y={height - 4}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              className="fill-foreground-muted text-[11px]"
            >
              {formatDay(data[i].day)}
            </text>
          ))}
      </svg>

      {hovered && active !== null && (
        <div
          className="card pointer-events-none absolute top-0 z-10 px-3 py-2 text-xs"
          style={{
            left: `${((padLeft + active * slot + slot / 2) / width) * 100}%`,
            transform: `translateX(${active > data.length * 0.7 ? "-100%" : active < data.length * 0.3 ? "0" : "-50%"})`,
          }}
        >
          <p className="font-medium">{formatDay(hovered.day)}</p>
          <p className="tabular-nums">{formatMoney(hovered.usd)}</p>
          <p className="text-foreground-muted">{hovered.events} generation{hovered.events === 1 ? "" : "s"}</p>
        </div>
      )}

      <table className="sr-only">
        <caption>Daily spend</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Spend</th>
            <th>Generations</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day)}</td>
              <td>{formatMoney(d.usd)}</td>
              <td>{d.events}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceCeil(value: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

function formatMoney(value: number, compact = false): string {
  if (compact && value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value.toFixed(value >= 100 || (compact && value % 1 === 0) ? 0 : 2)}`;
}

function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
