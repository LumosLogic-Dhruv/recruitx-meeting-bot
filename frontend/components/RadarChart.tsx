"use client";

interface RadarChartProps {
  data: { label: string; value: number }[];
  maxValue?: number;
  size?: number;
}

export default function RadarChart({ data, maxValue = 10, size = 280 }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 40;
  const levels = 5;
  const angleStep = (2 * Math.PI) / data.length;

  const getPoint = (index: number, value: number) => {
    const angle = angleStep * index - Math.PI / 2;
    const r = (value / maxValue) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  // Grid lines
  const gridLines = Array.from({ length: levels }, (_, i) => {
    const r = ((i + 1) / levels) * radius;
    const points = data
      .map((_, j) => {
        const angle = angleStep * j - Math.PI / 2;
        return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
      })
      .join(" ");
    return points;
  });

  // Data polygon
  const dataPoints = data.map((d, i) => getPoint(i, d.value));
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  // Axis lines
  const axes = data.map((_, i) => {
    const angle = angleStep * i - Math.PI / 2;
    return {
      x2: cx + radius * Math.cos(angle),
      y2: cy + radius * Math.sin(angle),
    };
  });

  // Label positions
  const labels = data.map((d, i) => {
    const angle = angleStep * i - Math.PI / 2;
    const lr = radius + 25;
    return {
      x: cx + lr * Math.cos(angle),
      y: cy + lr * Math.sin(angle),
      text: d.label,
      value: d.value,
    };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[320px] mx-auto">
      {/* Grid */}
      {gridLines.map((points, i) => (
        <polygon
          key={i}
          points={points}
          fill="none"
          stroke="var(--color-outline)"
          strokeOpacity="0.2"
          strokeWidth="0.5"
        />
      ))}

      {/* Axes */}
      {axes.map((axis, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={axis.x2}
          y2={axis.y2}
          stroke="var(--color-outline)"
          strokeOpacity="0.2"
          strokeWidth="0.5"
        />
      ))}

      {/* Data area */}
      <polygon
        points={dataPolygon}
        fill="rgba(173, 198, 255, 0.15)"
        stroke="var(--color-accent)"
        strokeWidth="2"
      />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--color-accent)" />
      ))}

      {/* Labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-fg-muted text-[9px]"
        >
          {l.text}
          <tspan className="fill-fg font-bold" dx="3">
            {l.value}
          </tspan>
        </text>
      ))}
    </svg>
  );
}
