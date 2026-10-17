import type React from 'react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Calendar,
  BarChart3,
  Contact,
  Users,
  LogOut,
  Heart,
  Menu,
  X,
  ShoppingBag,
  Candy,
  Cookie,
  Coffee,
  IceCreamCone,
  Milk,
  Settings,
  BellRing,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../modules/auth/AuthContext';
import AsistenteChat from './AsistenteChat';
import { BotonActualizacion, CartelActualizacion, useActualizacion } from './AvisoActualizacion';
import IndicadorRed from './IndicadorRed';
import { useResumenRecordatorios } from '../hooks/useResumenRecordatorios';
import { etiquetaRol } from '@shared/types';

type AcentoNav = 'brand' | 'sky' | 'teal' | 'emerald' | 'violet' | 'amber' | 'orange' | 'rose' | 'slate';

// Mismos productos de almacén que en el login, pero bien tenues sobre fondo
// claro — para que las pantallas con poco contenido (ej. el Panel) no se
// sientan vacías, sin distraer del contenido real que va encima.
const PRODUCTOS_FONDO_APP = [
  { icon: ShoppingBag, top: '12%', left: '85%', size: 'h-24 w-24', rotate: '-10deg' },
  { icon: Coffee, top: '55%', left: '6%', size: 'h-16 w-16', rotate: '8deg' },
  { icon: Cookie, top: '78%', left: '70%', size: 'h-20 w-20', rotate: '-6deg' },
  { icon: Candy, top: '30%', left: '20%', size: 'h-14 w-14', rotate: '12deg' },
  { icon: IceCreamCone, top: '85%', left: '30%', size: 'h-16 w-16', rotate: '-14deg' },
  { icon: Milk, top: '20%', left: '55%', size: 'h-14 w-14', rotate: '10deg' },
];

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: AcentoNav;
  soloAdmin?: boolean;
  /** Sólo en las PCs (en el celular no aparece). */
  soloEscritorio?: boolean;
  proximamente?: boolean;
}

// Cada sección tiene su propio color — así el menú se distingue de un
// vistazo en vez de ser todo el mismo azul, y "llama más la atención".
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, color: 'brand' },
  { to: '/articulos', label: 'Artículos y stock', icon: Package, color: 'sky' },
  { to: '/inventario', label: 'Contar inventario', icon: ClipboardList, color: 'teal' },
  { to: '/ventas', label: 'Calendario', icon: Calendar, color: 'emerald' },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, color: 'violet' },
  { to: '/clientes', label: 'Clientes (fiado)', icon: Contact, color: 'amber' },
  { to: '/recordatorios', label: 'Recordatorios', icon: BellRing, color: 'orange' },
  { to: '/usuarios', label: 'Usuarios', icon: Users, color: 'rose', soloAdmin: true },
  { to: '/configuracion', label: 'Configuración', icon: Settings, color: 'slate', soloAdmin: true, soloEscritorio: true },
];

// Clases completas (no armadas con template strings) para que Tailwind las
// detecte al escanear el código y no las purgue del CSS final.
const NAV_ACTIVO: Record<AcentoNav, string> = {
  brand: 'bg-brand-50 text-brand-700',
  sky: 'bg-sky-50 text-sky-700',
  teal: 'bg-teal-50 text-teal-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  violet: 'bg-violet-50 text-violet-700',
  amber: 'bg-amber-50 text-amber-700',
  orange: 'bg-orange-50 text-orange-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-700',
};
const NAV_ICONO: Record<AcentoNav, string> = {
  brand: 'text-brand-500',
  sky: 'text-sky-500',
  teal: 'text-teal-500',
  emerald: 'text-emerald-500',
  violet: 'text-violet-500',
  amber: 'text-amber-500',
  orange: 'text-orange-500',
  rose: 'text-rose-500',
  slate: 'text-slate-500',
};

export default function Layout() {
  const { sesion, logout, esAdmin } = useAuth();
  // En el celular la barra lateral no entra fija en la pantalla — arranca
  // escondida y se abre como un panel encima de todo con el botón de arriba.
  // En la PC (pantallas grandes) sigue fija como siempre.
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Vive acá (no en una pantalla en particular) para que el aviso de versión
  // nueva se vea desde cualquier parte de la app, no sólo desde el Panel.
  const infoActualizacion = useActualizacion();
  // Cuántos recordatorios pendientes hay: se muestra en el menú, así se nota
  // desde cualquier pantalla que hay algo para hacer.
  const recordatorios = useResumenRecordatorios();

  return (
    <div className="relative flex h-screen h-dvh overflow-hidden bg-[#f5f8fd]">
      {/* Un par de manchas de color bien tenues y quietas de fondo — le dan
          vida a la pantalla sin competir con el contenido, que va encima con
          z-10. pointer-events-none para que nunca interfieran con los clicks. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-float-slow absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-200/25 blur-3xl" />
        <div
          className="animate-float-slow absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-violet-200/25 blur-3xl"
          style={{ animationDelay: '-4s' }}
        />
        <div
          className="animate-float-slow absolute right-1/3 top-1/2 h-72 w-72 rounded-full bg-rose-200/15 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />
        {/* Productos del almacén bien tenues de fondo — para que se note que
            esta es LA app de este negocio y no una plantilla genérica. */}
        {PRODUCTOS_FONDO_APP.map(({ icon: Icon, top, left, size, rotate }, i) => (
          <Icon
            key={i}
            className={`absolute text-brand-900/[0.035] ${size}`}
            style={{ top, left, transform: `rotate(${rotate})` }}
            strokeWidth={1.2}
          />
        ))}
      </div>

      {/* Barra superior — sólo se ve en pantallas chicas */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          onClick={() => setMenuAbierto(true)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white">
          <Heart className="h-4 w-4" fill="currentColor" />
        </div>
        <p className="text-sm font-semibold text-slate-800">Mis Amores</p>
      </div>

      {/* Fondo oscuro detrás del menú cuando está abierto en el celular */}
      {menuAbierto && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMenuAbierto(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          menuAbierto ? 'translate-x-0' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm">
              <Heart className="h-5 w-5 animate-pulse" fill="currentColor" style={{ animationDuration: '2.5s' }} />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-800">Mis Amores</p>
              <p className="text-xs leading-tight text-slate-400">Gestión comercial</p>
            </div>
          </div>
          <button
            onClick={() => setMenuAbierto(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.filter((item) => (!item.soloAdmin || esAdmin) && (!item.soloEscritorio || window.escritorio)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  item.proximamente
                    ? 'cursor-default text-slate-300'
                    : isActive
                      ? NAV_ACTIVO[item.color]
                      : 'text-slate-600 hover:bg-slate-100'
                }`
              }
              onClick={(e) => {
                if (item.proximamente) e.preventDefault();
                else setMenuAbierto(false);
              }}
            >
              <item.icon className={`h-4 w-4 ${item.proximamente ? '' : NAV_ICONO[item.color]}`} />
              <span className="flex-1">{item.label}</span>
              {item.to === '/recordatorios' && recordatorios && recordatorios.pendientes > 0 && (
                <span
                  className={`min-w-[1.4rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold text-white ${
                    recordatorios.urgentes > 0 || recordatorios.vencidos > 0 ? 'bg-red-500' : 'bg-orange-500'
                  }`}
                  title={
                    recordatorios.urgentes > 0 || recordatorios.vencidos > 0
                      ? `${recordatorios.pendientes} pendientes (hay urgentes o vencidos)`
                      : `${recordatorios.pendientes} pendientes`
                  }
                >
                  {recordatorios.pendientes}
                </span>
              )}
              {item.proximamente && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">Pronto</span>
              )}
            </NavLink>
          ))}

          {/* No navega a ningún lado — por eso va como button y no NavLink,
              pero con el mismo look que el resto del menú. Cambia solo
              cuando hay una versión nueva (ver AvisoActualizacion). */}
          {window.escritorio && <BotonActualizacion info={infoActualizacion} />}
        </nav>

        <div className="border-t border-slate-200 p-3">
          {window.escritorio && <IndicadorRed />}
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {sesion?.nombre?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{sesion?.nombre}</p>
              <p className="text-xs text-slate-400">{sesion && etiquetaRol(sesion.rol, sesion.genero)}</p>
            </div>
          </div>
          <button onClick={() => logout()} className="btn-secondary w-full">
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto pt-14 lg:pt-0">
        <CartelActualizacion info={infoActualizacion} />
        <Outlet />
      </main>

      <AsistenteChat />
    </div>
  );
}
