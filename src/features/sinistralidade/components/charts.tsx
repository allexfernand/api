"use client";

// Primitivas de gráfico compartilhadas pelas abas Análise Sinistro e Visão 360.
// As tabelas continuam sendo a alternativa acessível e a fonte completa dos dados.

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line as RechartsLine,
  LineChart as RechartsLineChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter as RechartsScatter,
  ScatterChart as RechartsScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
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
// mês (ex.: mês relativo à entrada familiar) aparecem como vieram. Exportado
// porque a mesma técnica estava duplicada, sem guarda, em cinco componentes
// da aba Análise Sinistro (ExecutiveKpis/MonthlySeries/EventMix/Concentration/
// SanusImpact) — um mês malformado rendia diferente em cada bloco da mesma
// tela. Um único ponto de verdade, com a guarda de regex já usada aqui.
export function monthTick(category: string) {
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

function ChartFrame({ height, ariaLabel, children }: { height: number; ariaLabel: string; children: ReactNode }) {
  return (
    <div className={styles.rechartsFrame} style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: TooltipContentProps & {
  formatLabel?: (label: string | number) => string;
  formatValue: (value: number, dataKey?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const tooltipLabel = formatLabel ? formatLabel(label ?? "") : String(label ?? "");

  return (
    <div className={styles.chartTooltip}>
      <p className={styles.chartTooltipLabel}>{tooltipLabel}</p>
      <ul className={styles.chartTooltipList}>
        {payload.map((item) => {
          const value = typeof item.value === "number" ? item.value : Number(item.value);
          if (!Number.isFinite(value)) return null;
          const name = String(item.name ?? item.dataKey ?? "Valor");
          return (
            <li key={`${name}-${String(item.dataKey)}`} className={styles.chartTooltipItem}>
              <i style={{ background: item.color ?? item.stroke ?? SEMANTIC_COLORS.cost }} aria-hidden="true" />
              <span>{name}</span>
              <strong>{formatValue(value, String(item.dataKey ?? ""))}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function tickIndexes(length: number, step: number) {
  return Array.from({ length }, (_, index) => index).filter((index) => index % step === 0);
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
  const visibility = useContext(ChartVisibilityContext);
  const visible = series.filter((entry) => !visibility?.hidden.includes(entry.name)).slice(0, 5);
  if (!visible.length) return <ChartEmpty message="Selecione uma série na legenda para exibir o gráfico." />;
  const categories = visible[0]?.points.map((point) => point.x) ?? [];
  if (!categories.length) return <ChartEmpty />;
  const values = visible.flatMap((entry) => entry.points.map((point) => point.y)).filter((value): value is number => value !== null);
  if (!values.length) return <ChartEmpty />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const ticks = niceTicks(min, max);
  const domainMin = Math.min(min, ticks[0]);
  const domainMax = Math.max(max, ticks[ticks.length - 1]);
  const partial = new Set(partialMonths);
  const labelStep = categories.length <= 13 ? 1 : Math.ceil(categories.length / 12);
  const data = categories.map((category, index) => ({
    xIndex: index,
    ...Object.fromEntries(visible.map((entry) => [entry.name, entry.points[index]?.y ?? null])),
  }));

  return (
    <ChartFrame height={height} ariaLabel={ariaLabel}>
      <RechartsLineChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="xIndex"
          domain={[-0.5, Math.max(categories.length - 0.5, 0.5)]}
          ticks={tickIndexes(categories.length, labelStep)}
          tickFormatter={(value) => monthTick(categories[Number(value)] ?? "")}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
        />
        <YAxis
          domain={[domainMin, domainMax]}
          ticks={ticks}
          tickFormatter={formatValue}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        {categories.map((category, index) => partial.has(category) ? (
          <ReferenceArea
            key={`partial-${category}`}
            x1={index - 0.5}
            x2={index + 0.5}
            y1={domainMin}
            y2={domainMax}
            fill="#fbbf24"
            fillOpacity={0.14}
            strokeOpacity={0}
          />
        ) : null)}
        <Tooltip
          cursor={{ stroke: SEMANTIC_COLORS.cost, strokeDasharray: "4 4", strokeOpacity: 0.35 }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatLabel={(label) => monthTick(categories[Number(label)] ?? String(label))}
              formatValue={(value) => formatValue(value)}
            />
          )}
        />
        {visible.map((entry) => (
          <RechartsLine
            key={entry.name}
            type="monotone"
            dataKey={entry.name}
            name={entry.name}
            stroke={entry.color}
            strokeWidth={entry.color === SEMANTIC_COLORS.neutral ? 1.8 : 2.5}
            strokeDasharray={entry.color === SEMANTIC_COLORS.neutral ? "5 4" : undefined}
            strokeOpacity={entry.color === SEMANTIC_COLORS.neutral ? 0.82 : 1}
            dot={{ r: 3.2, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </RechartsLineChart>
    </ChartFrame>
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
  const totals = months.map((_, index) => visibleSegments.reduce((total, segment) => total + (segment.values[index] ?? 0), 0));
  const dataMax = Math.max(...totals, 1);
  const ticks = niceTicks(0, dataMax);
  const max = Math.max(dataMax, ticks[ticks.length - 1]);
  const labelStep = months.length <= 13 ? 1 : Math.ceil(months.length / 12);
  const data = months.map((month, index) => ({
    xIndex: index,
    ...Object.fromEntries(visibleSegments.map((segment) => [segment.name, segment.values[index] ?? 0])),
  }));

  return (
    <ChartFrame height={height} ariaLabel={ariaLabel}>
      <RechartsBarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="xIndex"
          domain={[-0.5, Math.max(months.length - 0.5, 0.5)]}
          ticks={tickIndexes(months.length, labelStep)}
          tickFormatter={(value) => monthTick(months[Number(value)] ?? "")}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
        />
        <YAxis
          domain={[0, max]}
          ticks={ticks}
          tickFormatter={formatValue}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "#f1f5f9", fillOpacity: 0.6 }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatLabel={(label) => monthTick(months[Number(label)] ?? String(label))}
              formatValue={(value) => formatValue(value)}
            />
          )}
        />
        {visibleSegments.map((segment, index) => (
          <RechartsBar
            key={segment.name}
            dataKey={segment.name}
            name={segment.name}
            stackId="total"
            fill={segment.color}
            radius={index === visibleSegments.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </RechartsBarChart>
    </ChartFrame>
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
  barColor,
  showCumulative = true,
}: {
  items: { label: string; value: number; cumulativeShare: number | null }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  height?: number;
  /** Cor por barra (ex.: destacar uma categoria específica, como "Sem lotação").
   * Sem esta prop, todas as barras usam SEMANTIC_COLORS.cost — comportamento
   * inalterado para quem já chama ParetoChart sem ela. */
  barColor?: (item: { label: string; value: number; cumulativeShare: number | null }, index: number) => string;
  /** Quando o chamador não tem como calcular um acumulado honesto (ex.:
   * claims.hospitalization — o servidor só devolve os maiores grupos, sem
   * total geral nem bucket "Outros"), esconde a linha acumulada E os rótulos
   * 0/50/80/100% do eixo direito. Um eixo de % sem linha por trás dele
   * implicaria uma dimensão que os dados não sustentam. Default `true`
   * preserva o comportamento de todo chamador existente (ProcedureAnalysis,
   * Locations) sem mudança alguma. */
  showCumulative?: boolean;
}) {
  if (!items.length) return <ChartEmpty />;
  const max = Math.max(...items.map((item) => item.value), 1);
  const ticks = niceTicks(0, max);
  const data = items.map((item, index) => ({ ...item, xIndex: index }));
  const colorFor = barColor ?? (() => SEMANTIC_COLORS.cost);

  return (
    <ChartFrame height={height} ariaLabel={ariaLabel}>
      <ComposedChart data={data} margin={{ top: 12, right: showCumulative ? 8 : 12, left: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="xIndex"
          domain={[-0.5, Math.max(items.length - 0.5, 0.5)]}
          ticks={tickIndexes(items.length, 1)}
          tickFormatter={(value) => String(Number(value) + 1)}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
        />
        <YAxis
          yAxisId="value"
          domain={[0, Math.max(max, ticks[ticks.length - 1])]}
          ticks={ticks}
          tickFormatter={formatValue}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        {showCumulative ? (
          <YAxis
            yAxisId="share"
            orientation="right"
            domain={[0, 1]}
            ticks={[0, 0.5, 0.8, 1]}
            tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
            tick={{ fill: "#94a3b8", fontSize: 10.5 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
        ) : null}
        <Tooltip
          cursor={{ fill: "#f1f5f9", fillOpacity: 0.6 }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatLabel={(label) => `Item ${Number(label) + 1} · ${items[Number(label)]?.label ?? ""}`}
              formatValue={(value, dataKey) => dataKey === "cumulativeShare" ? `${(value * 100).toFixed(1)}%` : formatValue(value)}
            />
          )}
        />
        <RechartsBar
          yAxisId="value"
          dataKey="value"
          name="Valor"
          fill={SEMANTIC_COLORS.cost}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {data.map((item, index) => <Cell key={item.label + index} fill={colorFor(item, index)} />)}
        </RechartsBar>
        {showCumulative ? (
          <RechartsLine
            yAxisId="share"
            type="monotone"
            dataKey="cumulativeShare"
            name="Acumulado"
            stroke={SEMANTIC_COLORS.mentalHealth}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ) : null}
      </ComposedChart>
    </ChartFrame>
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
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const xTicks = niceTicks(0, maxX);
  const yTicks = niceTicks(0, maxY);
  return (
    <ChartFrame height={height} ariaLabel={ariaLabel}>
      <RechartsScatterChart margin={{ top: 12, right: 12, left: 8, bottom: 24 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          domain={[0, maxX]}
          ticks={xTicks}
          tickFormatter={formatX}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          label={{ value: xLabel, position: "insideBottom", offset: -16, fill: "#94a3b8", fontSize: 10.5 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          domain={[0, maxY]}
          ticks={yTicks}
          tickFormatter={formatY}
          tick={{ fill: "#94a3b8", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          width={58}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10.5 }}
        />
        <ZAxis type="number" dataKey="size" range={[60, 360]} />
        <Tooltip
          cursor={{ strokeDasharray: "4 4", stroke: SEMANTIC_COLORS.cost, strokeOpacity: 0.35 }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatLabel={(label) => String(points.find((point) => point.label === label)?.label ?? label)}
              formatValue={(value, dataKey) => dataKey === "x" ? formatX(value) : formatY(value)}
            />
          )}
        />
        <RechartsScatter name="Pontos" data={points} fill={SEMANTIC_COLORS.cost} fillOpacity={0.62} stroke={SEMANTIC_COLORS.cost} />
      </RechartsScatterChart>
    </ChartFrame>
  );
}
