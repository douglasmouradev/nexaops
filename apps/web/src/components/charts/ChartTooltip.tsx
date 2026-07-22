import type { CSSProperties } from 'react';
import type { TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

/** Estilos Recharts compatíveis com tema claro/escuro */
export const chartTooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    color: 'hsl(var(--popover-foreground))',
  } as CSSProperties,
  labelStyle: {
    color: 'hsl(var(--popover-foreground))',
    fontWeight: 600,
    marginBottom: 4,
  } as CSSProperties,
  itemStyle: {
    color: 'hsl(var(--popover-foreground))',
    fontSize: 13,
  } as CSSProperties,
  cursor: { fill: 'hsl(var(--muted))', opacity: 0.35 },
};

type ChartTooltipProps = TooltipProps<ValueType, NameType> & {
  valueLabel?: string;
};

/** Tooltip customizado: label + quantidade legível no dark mode */
export function ChartTooltip({
  active,
  payload,
  label,
  valueLabel = 'Quantidade',
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;

  return (
    <div
      className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      style={{ minWidth: 120 }}
    >
      <p className="mb-1 font-semibold">{label ?? payload[0]?.name}</p>
      <p className="text-muted-foreground">
        {valueLabel}:{' '}
        <span className="font-medium text-foreground">{value ?? 0}</span>
      </p>
    </div>
  );
}
