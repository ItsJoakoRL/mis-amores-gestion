import type React from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  DollarSign,
  PackageX,
  Boxes,
  ReceiptText,
  ArrowRight,
  Smartphone,
  BellRing,
  Flame,
  ClipboardList,
} from 'lucide-react';
import type { DashboardStats, Recordatorio, ResumenDiaVentas } from '@shared/types';
import { formatearMoneda } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import AccesoCelularModal from './AccesoCelularModal';
import BotonAyuda from '../../components/BotonAyuda';
import TarjetaBienvenida from '../../components/TarjetaBienvenida';
import { useRecargarAlVolver } from '../../hooks/useRecargarAlVolver';


export default function DashboardPage() {
  const { sesion } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [ventasHoy, setVentasHoy] = useState<ResumenDiaVentas | null>(null);
  const [recordatorios, setRecordatorios] = useState<Recordatorio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrarAccesoCelular, setMostrarAccesoCelular] = useState(false);

  function cargar() {
    window.api.dashboard
      .stats()
      .then(setStats)
      .catch((err) => setError(err.message));
    window.api.ventas.resumenHoy().then(setVentasHoy).catch(() => {});
    window.api.recordatorios.list('pendientes').then(setRecordatorios).catch(() => {});
  }

  useEffect(cargar, []);
  useRecargarAlVolver(cargar);

  const horaSaludo = new Date().getHours();
  const saludo = horaSaludo < 12 ? 'Buen día' : horaSaludo < 20 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="mx-auto max-w-6xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            {saludo}, {sesion?.nombre?.split(' ')[0]} <span className="inline-block origin-[70%_70%] animate-wave">👋</span>
            <BotonAyuda seccion="Panel" />
          </h1>
          <p className="mt-1 text-slate-500">Este es el resumen del negocio hoy.</p>
        </div>
        <div className="flex items-center gap-2">
          {window.api.esElectron && (
            <button className="btn-secondary" onClick={() => setMostrarAccesoCelular(true)}>
              <Smartphone className="h-4 w-4" />
              Usar desde el celular
            </button>
          )}
        </div>
      </div>

      <TarjetaBienvenida />

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div data-tour="panel-resumen" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Boxes}
          label="Artículos activos"
          value={stats ? stats.totalArticulos.toString() : '—'}
          color="brand"
          delay={0}
        />
        <StatCard
          tourId="panel-stock-bajo"
          to="/articulos?stock=bajo"
          icon={AlertTriangle}
          label="Con stock bajo"
          value={stats ? stats.stockBajoCount.toString() : '—'}
          color="amber"
          delay={60}
        />
        <StatCard
          to="/articulos?stock=sin"
          icon={PackageX}
          label="Sin stock"
          value={stats ? stats.sinStockCount.toString() : '—'}
          color="red"
          delay={120}
        />
        <StatCard
          icon={DollarSign}
          label="Valor inventario (venta)"
          value={stats ? formatearMoneda(stats.valorInventarioVenta) : '—'}
          color="green"
          delay={180}
        />
      </div>

      {stats && stats.paraRevisarCount > 0 && (
        <Link
          to="/articulos?revisar=1"
          className="group mt-6 flex animate-slide-up items-center justify-between card border-amber-200 bg-amber-50 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm shadow-amber-500/30">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-medium text-slate-700">Para revisar</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                {stats.paraRevisarCount === 1
                  ? '1 producto se vendió sin stock registrado'
                  : `${stats.paraRevisarCount} productos se vendieron sin stock registrado`}
                : contalos para corregir el stock.
              </p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <Link
        to="/ventas"
        data-tour="panel-ventas-hoy"
        className="group relative mt-8 flex animate-slide-up items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-[#4338ca] via-[#6d28d9] to-[#be185d] p-6 text-white shadow-lg shadow-brand-600/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-600/30"
        style={{ animationDelay: '240ms' }}
      >
        <span className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur-sm">
            <ReceiptText className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/85">Ventas de hoy</h2>
            {ventasHoy ? (
              <>
                <p className="mt-0.5 text-3xl font-bold leading-tight">
                  {formatearMoneda(ventasHoy.totalCobrado + ventasHoy.totalPagos)}
                  <span className="ml-2 text-sm font-medium text-white/80">
                    cobrado{ventasHoy.cantidadVentas > 0 ? ` en ${ventasHoy.cantidadVentas} venta(s)` : ''}
                  </span>
                </p>
                {ventasHoy.totalPagos > 0 && (
                  <p className="mt-0.5 text-xs text-white/85">
                    incluye {formatearMoneda(ventasHoy.totalPagos)} de pagos de cuentas ({ventasHoy.cantidadPagos})
                  </p>
                )}
                {ventasHoy.totalFiado > 0 && (
                  <p className="mt-0.5 text-xs text-white/85">
                    + {formatearMoneda(ventasHoy.totalFiado)} fiado (todavía no cobrado)
                  </p>
                )}
              </>
            ) : (
              <p className="mt-0.5 text-sm text-white/80">Cargando...</p>
            )}
          </div>
        </div>
        <ArrowRight className="relative h-5 w-5 shrink-0 text-white/70 transition-transform group-hover:translate-x-0.5" />
      </Link>

      <Link
        to="/recordatorios"
        data-tour="panel-recordatorios"
        className="group mt-4 block animate-slide-up card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md"
        style={{ animationDelay: '300ms' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-sm shadow-orange-500/30">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-medium text-slate-700">Recordatorios</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {recordatorios === null
                  ? 'Cargando...'
                  : recordatorios.length === 0
                    ? 'No hay nada pendiente. ¡Todo al día!'
                    : `${recordatorios.length} pendiente(s) para hacer o cambiar`}
              </p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-0.5" />
        </div>
        {recordatorios && recordatorios.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
            {recordatorios.slice(0, 3).map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm text-slate-600">
                {r.urgente ? (
                  <Flame className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                ) : (
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                )}
                <span className="min-w-0 break-words">{r.texto}</span>
              </li>
            ))}
            {recordatorios.length > 3 && (
              <li className="pl-6 text-xs text-slate-400">y {recordatorios.length - 3} más...</li>
            )}
          </ul>
        )}
      </Link>

      {mostrarAccesoCelular && <AccesoCelularModal onCerrar={() => setMostrarAccesoCelular(false)} />}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  delay,
  tourId,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: 'brand' | 'amber' | 'red' | 'green';
  delay: number;
  tourId?: string;
  /** Si se indica, la tarjeta es un enlace (lleva a la lista de lo que cuenta). */
  to?: string;
}) {
  const colors: Record<string, string> = {
    brand: 'bg-gradient-to-br from-brand-400 to-brand-600 shadow-brand-500/30',
    amber: 'bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-500/30',
    red: 'bg-gradient-to-br from-red-400 to-red-600 shadow-red-500/30',
    green: 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/30',
  };
  // Un círculo tenue del mismo color en la esquina: le da identidad a cada tarjeta.
  const manchas: Record<string, string> = {
    brand: 'bg-brand-500/10',
    amber: 'bg-amber-500/10',
    red: 'bg-red-500/10',
    green: 'bg-emerald-500/10',
  };
  const tarjeta = (
    <div
      data-tour={tourId}
      className={`card relative flex animate-slide-up items-center gap-4 overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${
        to ? 'cursor-pointer' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className={`pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full ${manchas[color]}`} />
      <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md ${colors[color]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="relative min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block" title="Ver la lista">
      {tarjeta}
    </Link>
  ) : (
    tarjeta
  );
}
