import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, DollarSign, HandCoins, Loader2, Receipt, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetodoPago, ReporteVentas } from '@shared/types';
import { formatearMoneda } from '@shared/formato';
import BotonAyuda from '../../components/BotonAyuda';
import { useTema } from '../../tema';


type RangoPreset = 'hoy' | '7dias' | '30dias' | 'mes';
const PRESETS: { valor: RangoPreset; etiqueta: string }[] = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: '7dias', etiqueta: 'Últimos 7 días' },
  { valor: '30dias', etiqueta: 'Últimos 30 días' },
  { valor: 'mes', etiqueta: 'Este mes' },
];

const ETIQUETAS_METODO_PAGO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  fiado: 'Fiado',
};

// Los "días" se cortan en horario local (Argentina), no en UTC — misma
// convención que usa electron/repositories/ventas.ts (resumenMes), para que
// las ventas de la noche no queden atribuidas al día siguiente.
function calcularRango(preset: RangoPreset): { desde: string; hasta: string } {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();
  const dia = ahora.getDate();
  const hasta = new Date(anio, mes, dia + 1);

  let desde: Date;
  switch (preset) {
    case 'hoy':
      desde = new Date(anio, mes, dia);
      break;
    case '7dias':
      desde = new Date(anio, mes, dia - 6);
      break;
    case '30dias':
      desde = new Date(anio, mes, dia - 29);
      break;
    case 'mes':
      desde = new Date(anio, mes, 1);
      break;
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

// Los tooltips de recharts tipan el valor como ValueType (number | string |
// array), aunque acá siempre sea un número — Number() lo deja seguro.
function formatearValor(valor: unknown): string {
  return formatearMoneda(Number(valor));
}

// Los gráficos pintan con colores de verdad (no con clases), así que tienen su juego de colores
// para el modo claro y otro para el oscuro: más suaves, para que se lean sobre el fondo oscuro.
function usarColoresDeGrafico() {
  const { tema } = useTema();
  const oscuro = tema === 'oscuro';
  const grilla = oscuro ? '#2e3a52' : '#e2e8f0';
  return {
    barra: oscuro ? '#818cf8' : '#4f46e5',
    pagos: oscuro ? '#2dd4bf' : '#14b8a6',
    fiado: oscuro ? '#fbbf24' : '#f59e0b',
    grilla,
    ejeTexto: oscuro ? '#9aa7bf' : '#64748b',
    ejeTextoFuerte: oscuro ? '#cdd5e3' : '#475569',
    tooltip: {
      borderRadius: 8,
      borderColor: grilla,
      fontSize: 13,
      backgroundColor: oscuro ? '#141b2b' : '#ffffff',
      color: oscuro ? '#e3e8f1' : '#1e293b',
    },
    metodo: {
      efectivo: oscuro ? '#818cf8' : '#4f46e5',
      tarjeta: oscuro ? '#a78bfa' : '#8b5cf6',
      transferencia: oscuro ? '#22d3ee' : '#06b6d4',
      fiado: oscuro ? '#fbbf24' : '#f59e0b',
    } as Record<MetodoPago, string>,
  };
}

export default function ReportesPage() {
  const c = usarColoresDeGrafico();
  const [preset, setPreset] = useState<RangoPreset>('7dias');
  const [reporte, setReporte] = useState<ReporteVentas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Si se cambia el rango rápido (ej. "7 días" y enseguida "Este mes"), la
    // respuesta del pedido viejo puede llegar después que la del nuevo — esta
    // bandera hace que sólo el último pedido en curso pueda actualizar el estado.
    let vigente = true;
    const { desde, hasta } = calcularRango(preset);
    setCargando(true);
    setError(null);
    window.api.reportes
      .ventas(desde, hasta)
      .then((data) => {
        if (vigente) setReporte(data);
      })
      .catch((err) => {
        if (vigente) setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte');
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [preset]);

  const datosPorDia = useMemo(
    () =>
      (reporte?.porDia ?? []).map((d) => ({
        ...d,
        etiqueta: format(parseISO(d.fecha), 'dd/MM', { locale: es }),
      })),
    [reporte]
  );

  const datosPorMetodoPago = useMemo(
    () => (reporte?.porMetodoPago ?? []).map((m) => ({ ...m, etiqueta: ETIQUETAS_METODO_PAGO[m.metodoPago] })),
    [reporte]
  );

  return (
    <div className="mx-auto max-w-6xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            Reportes
            <BotonAyuda seccion="Reportes" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Cómo vino vendiendo el negocio en el período elegido.</p>
        </div>
        <div data-tour="rep-presets" className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-surface p-1">
          {PRESETS.map((p) => (
            <button
              key={p.valor}
              onClick={() => setPreset(p.valor)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                preset === p.valor ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !reporte || (reporte.cantidadVentas === 0 && reporte.totalPagos === 0) ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center text-slate-400">
          <BarChart3 className="h-8 w-8" />
          <p className="text-sm">No hay ventas registradas en este período.</p>
        </div>
      ) : (
        <>
          <div data-tour="rep-stats" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icono={DollarSign}
              etiqueta="Cobrado"
              valor={formatearMoneda(reporte.totalCobrado + reporte.totalPagos)}
              detalle={
                reporte.totalPagos > 0
                  ? `incluye ${formatearMoneda(reporte.totalPagos)} de pagos de cuentas (${reporte.cantidadPagos})`
                  : undefined
              }
            />
            <StatCard
              icono={HandCoins}
              etiqueta="Fiado (no cobrado)"
              valor={formatearMoneda(reporte.totalFiado)}
              color="amber"
            />
            <StatCard icono={Receipt} etiqueta="Ventas" valor={String(reporte.cantidadVentas)} />
            <StatCard icono={TrendingUp} etiqueta="Ticket promedio" valor={formatearMoneda(reporte.ticketPromedio)} />
          </div>

          <div data-tour="rep-grafico-dia" className="mb-6 card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Ventas por día</h2>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.barra }} />
                  Cobrado
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.pagos }} />
                  Pagos de cuentas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.fiado }} />
                  Fiado
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={datosPorDia} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grilla} />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 12, fill: c.ejeTexto }} axisLine={{ stroke: c.grilla }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: c.ejeTexto }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatearMoneda(v)}
                  width={80}
                />
                <Tooltip
                  formatter={formatearValor}
                  labelFormatter={(etiqueta) => `Día ${etiqueta}`}
                  contentStyle={c.tooltip}
                />
                <Bar dataKey="totalCobrado" name="Cobrado" stackId="dia" fill={c.barra} radius={[0, 0, 0, 0]} />
                <Bar dataKey="totalPagos" name="Pagos de cuentas" stackId="dia" fill={c.pagos} radius={[0, 0, 0, 0]} />
                <Bar dataKey="totalFiado" name="Fiado" stackId="dia" fill={c.fiado} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">
                Productos más vendidos <span className="font-normal text-slate-400">(ordenados por plata; las unidades, al pasar el mouse o tocar la barra)</span>
              </h2>
              {reporte.topProductos.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, reporte.topProductos.length * 34)}>
                  <BarChart
                    data={reporte.topProductos}
                    layout="vertical"
                    margin={{ left: 0, right: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={c.grilla} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: c.ejeTexto }} tickFormatter={(v: number) => formatearMoneda(v)} axisLine={{ stroke: c.grilla }} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="descripcion"
                      width={160}
                      tick={{ fontSize: 11, fill: c.ejeTextoFuerte }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 22) + '…' : v)}
                    />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(valor: unknown, _n: unknown, item: any) => [
                        formatearValor(valor),
                        `${item.payload.cantidad} unidad(es)`,
                      ]}
                      contentStyle={c.tooltip}
                    />
                    <Bar dataKey="total" name="Vendido" fill={c.barra} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Ventas por rubro</h2>
              {reporte.porRubro.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, reporte.porRubro.length * 34)}>
                  <BarChart data={reporte.porRubro} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={c.grilla} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: c.ejeTexto }} tickFormatter={(v: number) => formatearMoneda(v)} axisLine={{ stroke: c.grilla }} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="familiaNombre"
                      width={110}
                      tick={{ fontSize: 12, fill: c.ejeTextoFuerte }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip formatter={formatearValor} contentStyle={c.tooltip} />
                    <Bar dataKey="total" name="Vendido" fill={c.barra} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Ventas por forma de pago</h2>
            <ResponsiveContainer width="100%" height={Math.max(160, datosPorMetodoPago.length * 40)}>
              <BarChart data={datosPorMetodoPago} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={c.grilla} />
                <XAxis type="number" tick={{ fontSize: 12, fill: c.ejeTexto }} tickFormatter={(v: number) => formatearMoneda(v)} axisLine={{ stroke: c.grilla }} tickLine={false} />
                <YAxis type="category" dataKey="etiqueta" width={110} tick={{ fontSize: 12, fill: c.ejeTextoFuerte }} axisLine={false} tickLine={false} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(valor: unknown, _n: unknown, item: any) => [
                    formatearValor(valor),
                    `${item.payload.cantidad} venta(s)`,
                  ]}
                  contentStyle={c.tooltip}
                />
                <Bar dataKey="total" name="Vendido" radius={[0, 4, 4, 0]}>
                  {datosPorMetodoPago.map((d) => (
                    <Cell key={d.metodoPago} fill={c.metodo[d.metodoPago]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  color = 'brand',
}: {
  icono: React.ComponentType<{ className?: string }>;
  etiqueta: string;
  valor: string;
  /** Una línea chica abajo del número (ej. "incluye $X de ..."). */
  detalle?: string;
  color?: 'brand' | 'amber';
}) {
  const colores = color === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700';
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colores}`}>
        <Icono className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400">{etiqueta}</p>
        <p className="text-lg font-semibold text-slate-800">{valor}</p>
        {detalle && <p className="text-xs text-sky-700">{detalle}</p>}
      </div>
    </div>
  );
}
