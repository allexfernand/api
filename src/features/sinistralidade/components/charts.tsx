"use client";

// Primitivas de gráfico em SVG puro (decisão técnica do plano §10.3):
// sem dependência externa, SSR seguro, tokens visuais do site e alternativa
// tabular acessível em todos os gráficos. Máximo de cinco séries simultâneas.

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { LineageAnchor } from "./LineageAnchor";

// Cores semânticas consistentes: custo, uso, internação, saúde mental,
// famílias. Laranja reservado a destaque/saúde mental, não à cor dominante.
export const SEMANTIC_COLORS = {
  cost: "#00A69C",
  usage: "#2563eb",
  hospitalization: "#7c3aed",
  mentalHealth: "#ea580c",
  families: "#0891b2",
  neutral: "#9ca3af",
  partial: "#f59e0b",
} as const;

export const SERIES_PALETTE = ["#00A69C", "#2563eb", "#7c3aed", "#ea580c", "#0891b2"];

export type SeriesPoint = { x: string; y: number | null };
export type Series = { name: string; color: string; points: SeriesPoint[]; unit?: string };

type ChartVisibility = {
  hidden: string[];
  toggle: (name: string) => void;
  reset: () => void;
};

const ChartVisibilityContext = createContext<ChartVisibility | null>(null);

function scale(value: number, min: number, max: number, from: number, to: number) {
  if (max === min) return (from + to) / 2;
  return from + ((value - min) / (max - min)) * (to - from);
}

// Ticks "redondos" (1/2/2,5/5 × 10^n) para eixos legíveis; muda apenas a
// apresentação do eixo, nunca os valores plotados.
function niceTicks(min: number, max: number, count = 4) {
  if (max === min) max = min + 1;
  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
  const residual = rawStep / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2.5 ? 5 : residual >= 2 ? 2.5 : residual >= 1 ? 2 : 1) * magnitude;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= max + step / 2; tick += step) ticks.push(tick);
  return ticks;
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

// Rótulo curto do eixo X: meses YYYY-MM viram MM/AA; categorias que não são
// mês (ex.: mês relativo à entrada familiar) aparecem como vieram.
function monthTick(category: string) {
  return /^\d{4}-\d{2}$/.test(category) ? `${category.slice(5)}/${category.slice(2, 4)}` : category;
}

export function ChartEmpty({ message = "Sem dados para o período selecionado." }: { message?: string }) {
  return <div className={styles.chartEmpty} role="status">{message}</div>;
}

export function ChartCard({
  title,
  subtitle,
  unit,
  coverageNote,
  chart,
  table,
  legend,
  lineageId,
}: {
  title: string;
  subtitle?: string;
  unit: string;
  /** Mantido por compatibilidade com os chamadores; não é mais exibido na legenda. */
  periodLabel?: string;
  coverageNote?: string | null;
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  lineageId?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const visibility: ChartVisibility = {
    hidden: hiddenSeries,
    toggle: (name) => setHiddenSeries((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]),
    reset: () => setHiddenSeries([]),
  };
  return (
    <LineageAnchor lineageId={lineageId} label={title}>
      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartCaption}>
          <div>
            <h4>{title}</h4>
            <p>
              {subtitle ? `${subtitle} · ` : ""}
              Unidade: {unit}
              {coverageNote ? ` · ${coverageNote}` : ""}
            </p>
          </div>
          <button
            type="button"
            className={styles.tableToggle}
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? "Ver gráfico" : "Ver tabela"}
          </button>
        </figcaption>
        <ChartVisibilityContext.Provider value={visibility}>
          {legend ? (
            <div className={styles.chartLegendRow}>
              {legend}
              {hiddenSeries.length ? (
                <button type="button" className={styles.legendReset} onClick={visibility.reset}>Mostrar todas</button>
              ) : <span className={styles.legendHint}>Clique para mostrar ou ocultar</span>}
            </div>
          ) : null}
          {showTable ? <div className={styles.tableWrap}>{table}</div> : <div className={styles.chartArea}>{chart}</div>}
        </ChartVisibilityContext.Provider>
      </figure>
    </LineageAnchor>
  );
}

export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  const visibility = useContext(ChartVisibilityContext);
  return (
    <div className={styles.chartLegend} role="group" aria-label="Legenda interativa">
      {items.map((item) => {
        const isHidden = visibility?.hidden.includes(item.name) ?? false;
        return (
          <button
            key={item.name}
            type="button"
            className={`${styles.legendButton} ${isHidden ? styles.legendButtonHidden : ""}`}
            aria-pressed={!isHidden}
            title={`${isHidden ? "Mostrar" : "Ocultar"} ${item.name}`}
            onClick={() => visibility?.toggle(item.name)}
          >
            <i style={{ background: item.color }} aria-hidden="true" />
            <span>{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LineChart({
  series,
  height = 220,
  formatValue = (value: number) => compact.format(value),
  partialMonths = [],
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  formatValue?: (value: number) => string;
  partialMonths?: string[];
  ariaLabel: string;
}) {
  const id = useId();
  const visibility = useContext(ChartVisibilityContext);
  const visible = series.filter((entry) => !visibility?.hidden.includes(entry.name)).slice(0, 5);
  if (!visible.length) return <ChartEmpty message="Selecione uma série na legenda para exibir o gráfico." />;
  const categories = visible[0]?.points.map((point) => point.x) ?? [];
  if (!categories.length) return <ChartEmpty />;
  const width = 720;
  const pad = { top: 14, right: 14, bottom: 28, left: 52 };
  const values = visible.flatMap((entry) => entry.points.map((point) => point.y)).filter((value): value is number => value !== null);
  if (!values.length) return <ChartEmpty />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const ticks = niceTicks(min, max);
  const domainMin = Math.min(min, ticks[0]);
  const domainMax = Math.max(max, ticks[ticks.length - 1]);
  const xFor = (index: number) => scale(index, 0, Math.max(categories.length - 1, 1), pad.left, width - pad.right);
  const yFor = (value: number) => scale(value, domainMin, domainMax, height - pad.bottom, pad.top);
  const partial = new Set(partialMonths);
  const labelStep = categories.length <= 13 ? 1 : Math.ceil(categories.length / 12);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label={ariaLabel}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={yFor(tick)} y2={yFor(tick)} className={styles.gridLine} />
          <text x={pad.left - 8} y={yFor(tick) + 3} textAnchor="end" className={styles.axisText}>
            {formatValue(tick)}
          </text>
        </g>
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className={styles.axisLine} />
      {categories.map((category, index) => (
        <g key={category}>
          {partial.has(category) ? (
            <rect
              x={xFor(index) - 6}
              y={pad.top}
              width={12}
              height={height - pad.top - pad.bottom}
              className={styles.partialBand}
            />
          ) : null}
          {index % labelStep === 0 ? (
            <text x={xFor(index)} y={height - 8} textAnchor="middle" className={styles.axisText}>
              {monthTick(category)}
            </text>
          ) : null}
        </g>
      ))}
      {visible.map((entry) => {
        const path = entry.points
          .map((point, index) => (point.y === null ? null : `${index === 0 || entry.points[index - 1]?.y === null ? "M" : "L"}${xFor(index)},${yFor(point.y)}`))
          .filter(Boolean)
          .join(" ");
        return (
          <g key={`${id}-${entry.name}`}>
            <path
              d={path}
              fill="none"
              stroke={entry.color}
              strokeWidth={entry.color === SEMANTIC_COLORS.neutral ? 1.8 : 2.5}
              strokeDasharray={entry.color === SEMANTIC_COLORS.neutral ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={entry.color === SEMANTIC_COLORS.neutral ? 0.82 : 1}
            />
            {entry.points.map((point, index) =>
              point.y === null ? null : (
                <g key={point.x}>
                  <circle cx={xFor(index)} cy={yFor(point.y)} r={3.2} fill={entry.color} className={styles.chartDot} />
                  <circle cx={xFor(index)} cy={yFor(point.y)} r={9} className={styles.hitArea}>
                    <title>{`${entry.name} · ${monthTick(point.x)}: ${formatValue(point.y)}${entry.unit ? ` ${entry.unit}` : ""}`}</title>
                  </circle>
                </g>
              ),
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function StackedBarChart({
  months,
  segments,
  formatValue = (value: number) => compact.format(value),
  ariaLabel,
  height = 240,
}: {
  months: string[];
  segments: { name: string; color: string; values: (number | null)[] }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const visibility = useContext(ChartVisibilityContext);
  const visibleSegments = segments.filter((segment) => !visibility?.hidden.includes(segment.name));
  if (!months.length) return <ChartEmpty />;
  if (!visibleSegments.length) return <ChartEmpty message="Selecione uma série na legenda para exibir o gráfico." />;
  const width = 720;
  const pad = { top: 14, right: 14, bottom: 28, left: 52 };
  const totals = months.map((_, index) => visibleSegments.reduce((total, segment) => total + (segment.values[index] ?? 0), 0));
  const dataMax = Math.max(...totals, 1);
  const ticks = niceTicks(0, dataMax);
  const max = Math.max(dataMax, ticks[ticks.length - 1]);
  const barWidth = Math.min(38, ((width - pad.left - pad.right) / months.length) * 0.7);
  const xFor = (index: number) => scale(index, 0, Math.max(months.length - 1, 1), pad.left + barWidth / 2, width - pad.right - barWidth / 2);
  const innerHeight = height - pad.top - pad.bottom;
  const labelStep = months.length <= 13 ? 1 : Math.ceil(months.length / 12);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label={ariaLabel}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerHeight * (1 - tick / max)} y2={pad.top + innerHeight * (1 - tick / max)} className={styles.gridLine} />
          <text x={pad.left - 8} y={pad.top + innerHeight * (1 - tick / max) + 3} textAnchor="end" className={styles.axisText}>
            {formatValue(tick)}
          </text>
        </g>
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className={styles.axisLine} />
      {months.map((month, index) => {
        let cursor = height - pad.bottom;
        return (
          <g key={month}>
            {visibleSegments.map((segment, segmentIndex) => {
              const value = segment.values[index] ?? 0;
              const barHeight = (value / max) * innerHeight;
              cursor -= barHeight;
              // 1px de respiro entre segmentos empilhados para leitura do stack.
              const gap = segmentIndex > 0 ? 1 : 0;
              return value > 0 ? (
                <rect key={segment.name} x={xFor(index) - barWidth / 2} y={cursor + gap} width={barWidth} height={Math.max(barHeight - gap, 0.5)} fill={segment.color} rx={3} stroke="#ffffff" strokeWidth={0.75}>
                  <title>{`${segment.name} · ${monthTick(month)}: ${formatValue(value)}`}</title>
                </rect>
              ) : null;
            })}
            {index % labelStep === 0 ? (
              <text x={xFor(index)} y={height - 8} textAnchor="middle" className={styles.axisText}>
                {monthTick(month)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, color = SEMANTIC_COLORS.cost, ariaLabel }: { values: (number | null)[]; color?: string; ariaLabel: string }) {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return null;
  const width = 120;
  const height = 28;
  const max = Math.max(...present, 1);
  const min = Math.min(...present, 0);
  const xAt = (index: number) => scale(index, 0, Math.max(values.length - 1, 1), 2, width - 2);
  const yAt = (value: number) => scale(value, min, max, height - 3, 3);
  // Mês sem cobertura (null) interrompe o traço — nunca vira zero visual.
  const path = values
    .map((value, index) => (value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${xAt(index)},${yAt(value)}`))
    .filter(Boolean)
    .join(" ");
  const lastIndex = values.length - 1 - [...values].reverse().findIndex((value) => value !== null);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.sparkline} role="img" aria-label={ariaLabel}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xAt(lastIndex)} cy={yAt(values[lastIndex] as number)} r={2.25} fill={color} />
    </svg>
  );
}

export function ParetoChart({
  items,
  formatValue = (value: number) => compact.format(value),
  ariaLabel,
  height = 240,
}: {
  items: { label: string; value: number; cumulativeShare: number | null }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  if (!items.length) return <ChartEmpty />;
  const width = 720;
  const pad = { top: 14, right: 46, bottom: 30, left: 52 };
  const max = Math.max(...items.map((item) => item.value), 1);
  const innerHeight = height - pad.top - pad.bottom;
  const barWidth = Math.min(34, ((width - pad.left - pad.right) / items.length) * 0.7);
  const xFor = (index: number) => scale(index, 0, Math.max(items.length - 1, 1), pad.left + barWidth / 2, width - pad.right - barWidth / 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label={ariaLabel}>
      {niceTicks(0, max).filter((tick) => tick <= max).map((tick) => (
        <g key={`grid-${tick}`}>
          <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom - (tick / max) * innerHeight} y2={height - pad.bottom - (tick / max) * innerHeight} className={styles.gridLine} />
          <text x={pad.left - 8} y={height - pad.bottom - (tick / max) * innerHeight + 3} textAnchor="end" className={styles.axisText}>
            {formatValue(tick)}
          </text>
        </g>
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className={styles.axisLine} />
      {items.map((item, index) => {
        const barHeight = (item.value / max) * innerHeight;
        return (
          <g key={item.label + index}>
            <rect x={xFor(index) - barWidth / 2} y={height - pad.bottom - barHeight} width={barWidth} height={barHeight} fill={SEMANTIC_COLORS.cost} rx={3}>
              <title>{`${item.label}: ${formatValue(item.value)}${item.cumulativeShare !== null ? ` · acumulado ${(item.cumulativeShare * 100).toFixed(1)}%` : ""}`}</title>
            </rect>
            <text x={xFor(index)} y={height - 8} textAnchor="middle" className={styles.axisText}>
              {index + 1}
            </text>
          </g>
        );
      })}
      <path
        d={items
          .map((item, index) =>
            item.cumulativeShare === null ? null : `${index === 0 ? "M" : "L"}${xFor(index)},${pad.top + innerHeight * (1 - item.cumulativeShare)}`,
          )
          .filter(Boolean)
          .join(" ")}
        fill="none"
        stroke={SEMANTIC_COLORS.mentalHealth}
        strokeWidth={2}
      />
      {[0, 0.5, 0.8, 1].map((tick) => (
        <text key={tick} x={width - pad.right + 6} y={pad.top + innerHeight * (1 - tick) + 3} className={styles.axisText}>
          {Math.round(tick * 100)}%
        </text>
      ))}
    </svg>
  );
}

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  formatX = (value: number) => compact.format(value),
  formatY = (value: number) => compact.format(value),
  ariaLabel,
  height = 260,
}: {
  points: { label: string; x: number; y: number; size: number }[];
  xLabel: string;
  yLabel: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  if (!points.length) return <ChartEmpty />;
  const width = 720;
  const pad = { top: 14, right: 18, bottom: 36, left: 58 };
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const maxSize = Math.max(...points.map((point) => point.size), 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label={ariaLabel}>
      {niceTicks(0, maxY).map((tick) => (
        <g key={`y${tick}`}>
          <line x1={pad.left} x2={width - pad.right} y1={scale(tick, 0, maxY, height - pad.bottom, pad.top)} y2={scale(tick, 0, maxY, height - pad.bottom, pad.top)} className={styles.gridLine} />
          <text x={pad.left - 6} y={scale(tick, 0, maxY, height - pad.bottom, pad.top) + 3} textAnchor="end" className={styles.axisText}>
            {formatY(tick)}
          </text>
        </g>
      ))}
      {niceTicks(0, maxX).map((tick) => (
        <text key={`x${tick}`} x={scale(tick, 0, maxX, pad.left, width - pad.right)} y={height - 16} textAnchor="middle" className={styles.axisText}>
          {formatX(tick)}
        </text>
      ))}
      <text x={width / 2} y={height - 2} textAnchor="middle" className={styles.axisText}>
        {xLabel}
      </text>
      <text x={12} y={height / 2} textAnchor="middle" className={styles.axisText} transform={`rotate(-90 12 ${height / 2})`}>
        {yLabel}
      </text>
      {points.map((point) => (
        <circle
          key={point.label}
          cx={scale(point.x, 0, maxX, pad.left, width - pad.right)}
          cy={scale(point.y, 0, maxY, height - pad.bottom, pad.top)}
          r={4 + (point.size / maxSize) * 12}
          fill={SEMANTIC_COLORS.cost}
          fillOpacity={0.52}
          stroke={SEMANTIC_COLORS.cost}
          strokeWidth={1.25}
        >
          <title>{`${point.label} · ${xLabel}: ${formatX(point.x)} · ${yLabel}: ${formatY(point.y)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
