import { useEffect, useState, type ReactNode } from 'react';
import { Download, Loader2, RefreshCw, Rocket, Sparkles, X } from 'lucide-react';
import type { EstadoActualizacion, InfoActualizacion } from '@shared/types';

// En qué anda la actualización de la app de esta PC — lo lleva el proceso
// principal (electron/main.ts) y avisa cada vez que cambia. Desde el celular
// no hay nada instalado que actualizar, así que ahí queda siempre en null.
export function useActualizacion(): InfoActualizacion | null {
  const [info, setInfo] = useState<InfoActualizacion | null>(null);

  useEffect(() => {
    const actualizaciones = window.escritorio?.actualizaciones;
    if (!actualizaciones) return;
    let vigente = true;
    const dejarDeEscuchar = actualizaciones.onCambio((nueva) => setInfo(nueva));
    actualizaciones
      .estado()
      .then((inicial) => {
        // Si mientras tanto ya llegó un aviso de cambio, ése es más nuevo.
        if (vigente) setInfo((actual) => actual ?? inicial);
      })
      .catch(() => {});
    return () => {
      vigente = false;
      dejarDeEscuchar();
    };
  }, []);

  return info;
}

function descargar() {
  window.escritorio?.actualizaciones.descargar().catch(() => {});
}

function instalar() {
  window.escritorio?.actualizaciones.instalar().catch(() => {});
}

// El puntito rojo que late — para que se note desde cualquier pantalla que
// hay algo pendiente, aunque se haya cerrado el cartel de arriba.
function PuntoAviso() {
  return (
    <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
    </span>
  );
}

function BarraProgreso({ porcentaje, clara = false }: { porcentaje: number; clara?: boolean }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${clara ? 'bg-surface/30' : 'bg-brand-100'}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${clara ? 'bg-surface' : 'bg-brand-500'}`}
        style={{ width: `${Math.max(3, porcentaje)}%` }}
      />
    </div>
  );
}

// El botón del menú lateral: si no hay nada nuevo sirve para buscar a mano
// (y muestra qué versión está instalada); si hay una versión nueva cambia de
// color, con el puntito rojo, y tocarlo la baja o la instala directamente.
export function BotonActualizacion({ info }: { info: InfoActualizacion | null }) {
  const [buscando, setBuscando] = useState(false);
  const estado: EstadoActualizacion = info?.estado ?? { tipo: 'al-dia' };
  const versionActual = info?.versionActual;

  async function buscar() {
    setBuscando(true);
    try {
      await window.escritorio?.actualizaciones.buscar();
    } finally {
      setBuscando(false);
    }
  }

  const base = 'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors';

  if (estado.tipo === 'disponible') {
    return (
      <button
        data-tour="buscar-actualizaciones"
        onClick={descargar}
        className={`${base} bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100`}
      >
        <span className="relative">
          <Download className="h-4 w-4 text-emerald-700" />
          <PuntoAviso />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">Actualización disponible</span>
          <span className={`block text-[11px] font-normal ${estado.error ? 'text-red-700' : 'text-emerald-700'}`}>
            {estado.error ? 'Falló la descarga · tocá para reintentar' : `Versión ${estado.version} · tocá para bajarla`}
          </span>
        </span>
      </button>
    );
  }

  if (estado.tipo === 'descargando') {
    return (
      <div
        data-tour="buscar-actualizaciones"
        className="flex w-full flex-col gap-1.5 rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700"
      >
        <span className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          <span className="flex-1">Descargando... {estado.porcentaje}%</span>
        </span>
        <BarraProgreso porcentaje={estado.porcentaje} />
      </div>
    );
  }

  if (estado.tipo === 'lista') {
    return (
      <button
        data-tour="buscar-actualizaciones"
        onClick={instalar}
        className={`${base} bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-sm hover:brightness-110`}
      >
        <span className="relative">
          <Rocket className="h-4 w-4" />
          <PuntoAviso />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">Reiniciar y actualizar</span>
          <span className="block text-[11px] font-normal text-white/80">Versión {estado.version} lista</span>
        </span>
      </button>
    );
  }

  const enCurso = buscando || estado.tipo === 'buscando';
  return (
    <button
      data-tour="buscar-actualizaciones"
      onClick={buscar}
      disabled={enCurso}
      className={`${base} text-slate-600 hover:bg-slate-100 disabled:opacity-60`}
    >
      <RefreshCw className={`h-4 w-4 text-slate-400 ${enCurso ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1">
        <span className="block">{enCurso ? 'Buscando...' : 'Buscar actualizaciones'}</span>
        {versionActual && <span className="block text-[11px] font-normal text-slate-400">Versión {versionActual}</span>}
      </span>
    </button>
  );
}

// El cartel de arriba de todo — aparece solo cuando hay una versión nueva,
// sin tapar lo que se está haciendo (antes era un cartel de Windows que
// cortaba todo en medio de una venta). Se puede cerrar, y vuelve a aparecer
// recién cuando cambia algo (ej. terminó de bajarse); el botón del menú
// sigue avisando igual con el puntito rojo.
export function CartelActualizacion({ info }: { info: InfoActualizacion | null }) {
  const [cerradoPara, setCerradoPara] = useState<string | null>(null);
  const estado = info?.estado;
  if (!estado || (estado.tipo !== 'disponible' && estado.tipo !== 'descargando' && estado.tipo !== 'lista')) {
    return null;
  }

  const clave = `${estado.tipo}:${estado.version}:${estado.tipo === 'disponible' ? estado.error ?? '' : ''}`;
  if (cerradoPara === clave) return null;
  const cerrar = () => setCerradoPara(clave);

  const botonCerrar = (
    <button
      onClick={cerrar}
      className="shrink-0 rounded-lg p-1.5 opacity-70 transition hover:bg-black/5 hover:opacity-100"
      title="Ocultar este aviso (el botón del menú sigue avisando)"
      aria-label="Ocultar aviso de actualización"
    >
      <X className="h-4 w-4" />
    </button>
  );

  let contenido: ReactNode;
  if (estado.tipo === 'disponible' && estado.error) {
    contenido = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 shadow-sm">
        <Download className="h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">No se pudo bajar la actualización (versión {estado.version})</p>
          <p className="text-xs text-red-700">{estado.error}</p>
        </div>
        <button className="btn-primary" onClick={descargar}>
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
        {botonCerrar}
      </div>
    );
  } else if (estado.tipo === 'disponible') {
    contenido = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-surface px-4 py-3 text-emerald-900 shadow-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm shadow-emerald-500/30">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">¡Hay una versión nueva de la app! (versión {estado.version})</p>
          <p className="text-xs text-emerald-700">
            Se baja en segundo plano y se puede seguir usando todo normal mientras tanto.
          </p>
        </div>
        <button className="btn-primary" onClick={descargar}>
          <Download className="h-4 w-4" />
          Descargar actualización
        </button>
        {botonCerrar}
      </div>
    );
  } else if (estado.tipo === 'descargando') {
    contenido = (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-surface px-4 py-3 text-brand-900 shadow-sm">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-500" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">
            Descargando la actualización (versión {estado.version})... {estado.porcentaje}%
          </p>
          <BarraProgreso porcentaje={estado.porcentaje} />
        </div>
        {botonCerrar}
      </div>
    );
  } else {
    contenido = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-3 text-white shadow-md">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface/15">
          <Rocket className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">La actualización (versión {estado.version}) ya está lista para instalar</p>
          <p className="text-xs text-white/80">
            La app se cierra, se instala en menos de un minuto y se vuelve a abrir sola. Si estás cobrando, terminá
            primero.
          </p>
        </div>
        <button
          className="btn bg-surface text-brand-700 shadow-sm hover:bg-brand-50"
          onClick={instalar}
        >
          <Rocket className="h-4 w-4" />
          Reiniciar y actualizar
        </button>
        <button onClick={cerrar} className="btn text-white/90 hover:bg-surface/10">
          Más tarde
        </button>
      </div>
    );
  }

  return <div className="sticky top-0 z-20 animate-slide-up px-4 pt-4 lg:px-8">{contenido}</div>;
}
