import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, DollarSign, Loader2, Trash2, X } from 'lucide-react';
import type { ResumenDiaVentas, Venta } from '@shared/types';
import { formatearCantidad, formatearMoneda } from '@shared/formato';
import BotonAyuda from '../../components/BotonAyuda';
import { useRecargarAlVolver } from '../../hooks/useRecargarAlVolver';


export default function VentasPage() {
  const [mesActual, setMesActual] = useState(() => startOfMonth(new Date()));
  const [resumenPorDia, setResumenPorDia] = useState<Map<string, ResumenDiaVentas>>(new Map());
  const [ventasHoy, setVentasHoy] = useState<ResumenDiaVentas | null>(null);
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [cargandoCalendario, setCargandoCalendario] = useState(true);

  const cargarResumen = useCallback(() => {
    setCargandoCalendario(true);
    // Si se cambia de mes rápido (flecha varias veces seguidas), la
    // respuesta de un mes anterior puede llegar después que la del mes
    // actual — esta bandera hace que sólo la última consulta en curso
    // pueda actualizar el estado (mismo patrón que usa Reportes).
    let vigente = true;
    window.api.ventas
      .resumenMes(mesActual.getFullYear(), mesActual.getMonth())
      .then((filas) => {
        if (vigente) setResumenPorDia(new Map(filas.map((f) => [f.fecha, f])));
      })
      .finally(() => {
        if (vigente) setCargandoCalendario(false);
      });
    window.api.ventas.resumenHoy().then(setVentasHoy);
    return () => {
      vigente = false;
    };
  }, [mesActual]);

  useEffect(cargarResumen, [cargarResumen]);
  useRecargarAlVolver(cargarResumen);

  const diasDelGrid = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesActual), { weekStartsOn: 1 });
    const fin = endOfWeek(endOfMonth(mesActual), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: inicio, end: fin });
  }, [mesActual]);

  return (
    <div className="mx-auto max-w-6xl animate-slide-up p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            Calendario
            <BotonAyuda seccion="Calendario" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Mirá lo vendido día por día.</p>
        </div>
        <div data-tour="cal-resumen-hoy" className="card flex items-center gap-3 px-4 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Hoy</p>
            <p className="font-semibold text-slate-800">
              {ventasHoy ? formatearMoneda(ventasHoy.totalCobrado) : '—'}
              {ventasHoy && ventasHoy.cantidadVentas > 0 && (
                <span className="ml-1 font-normal text-slate-400">({ventasHoy.cantidadVentas})</span>
              )}
            </p>
            {ventasHoy && ventasHoy.totalFiado > 0 && (
              <p className="text-xs text-amber-600">+ {formatearMoneda(ventasHoy.totalFiado)} fiado</p>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setMesActual((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-sm font-semibold capitalize text-slate-700">
            {format(mesActual, 'MMMM yyyy', { locale: es })}
          </h2>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setMesActual((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>

        <div data-tour="cal-grid" className="relative grid grid-cols-7">
          {cargandoCalendario && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {diasDelGrid.map((dia) => {
            const ymd = format(dia, 'yyyy-MM-dd');
            const resumen = resumenPorDia.get(ymd);
            const enMes = isSameMonth(dia, mesActual);
            const esHoy = isToday(dia);
            return (
              <button
                key={ymd}
                data-tour={esHoy ? 'cal-hoy' : undefined}
                onClick={() => resumen && setDiaSeleccionado(ymd)}
                disabled={!resumen}
                className={`flex min-h-[76px] flex-col items-start gap-1 border-b border-r border-slate-100 p-2 text-left transition-colors last:border-r-0 ${
                  enMes ? 'bg-white' : 'bg-slate-50/50'
                } ${resumen ? 'cursor-pointer hover:bg-brand-50' : 'cursor-default'}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    esHoy ? 'bg-brand-600 text-white' : enMes ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  {format(dia, 'd')}
                </span>
                {resumen && resumen.totalCobrado > 0 && (
                  <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                    {formatearMoneda(resumen.totalCobrado)}
                  </span>
                )}
                {resumen && resumen.totalFiado > 0 && (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    +{formatearMoneda(resumen.totalFiado)} fiado
                  </span>
                )}
                {resumen && <span className="text-[10px] text-slate-400">{resumen.cantidadVentas} venta(s)</span>}
              </button>
            );
          })}
        </div>
      </div>

      {diaSeleccionado && (
        <DiaDetalleModal
          fecha={diaSeleccionado}
          onCerrar={() => setDiaSeleccionado(null)}
          onCambio={cargarResumen}
        />
      )}
    </div>
  );
}

function DiaDetalleModal({
  fecha,
  onCerrar,
  onCambio,
}: {
  fecha: string;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    window.api.ventas
      .listPorDia(fecha)
      .then(setVentas)
      .finally(() => setCargando(false));
  }, [fecha]);

  useEffect(cargar, [cargar]);

  const totalCobrado = ventas.reduce((acc, v) => acc + (v.metodoPago !== 'fiado' ? v.total : 0), 0);
  const totalFiado = ventas.reduce((acc, v) => acc + (v.metodoPago === 'fiado' ? v.total : 0), 0);

  async function handleEliminar(v: Venta) {
    if (!confirm(`¿Anular la venta de "${v.articuloDescripcion}"? Se repone el stock.`)) return;
    try {
      await window.api.ventas.eliminar(v.id);
      cargar();
      onCambio();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo anular la venta');
    }
  }

  const fechaLegible = useMemo(() => {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    // No usamos la clase CSS "capitalize" acá: le pone mayúscula a CADA
    // palabra y "de" quedaría como "De" — sólo la primera letra va así.
    const texto = format(new Date(anio, mes - 1, dia), "EEEE d 'de' MMMM", { locale: es });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }, [fecha]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{fechaLegible}</h2>
            <p className="text-sm text-slate-500">
              {ventas.length} venta(s) · Cobrado {formatearMoneda(totalCobrado)}
              {totalFiado > 0 && <span className="text-amber-600"> · Fiado {formatearMoneda(totalFiado)}</span>}
            </p>
          </div>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <p className="px-6 py-8 text-center text-slate-400">Cargando...</p>
          ) : ventas.length === 0 ? (
            <p className="px-6 py-8 text-center text-slate-400">No hay ventas registradas este día.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Hora</th>
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-4 py-2 font-medium">Cant.</th>
                  <th className="px-4 py-2 font-medium">Pago</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Vendió</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ventas.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-2 text-slate-500">{format(new Date(v.fecha), 'HH:mm')}</td>
                    <td className="px-4 py-2 text-slate-800">{v.articuloDescripcion}</td>
                    <td className="px-4 py-2 text-slate-600">{formatearCantidad(v.cantidad)}</td>
                    <td className="px-4 py-2 capitalize text-slate-600">
                      {v.metodoPago}
                      {v.metodoPago === 'fiado' && v.clienteNombre && (
                        <span className="ml-1 text-xs normal-case text-amber-600">({v.clienteNombre})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-800">{formatearMoneda(v.total)}</td>
                    <td className="px-4 py-2 text-slate-500">{v.usuarioNombre ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleEliminar(v)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Anular venta"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
