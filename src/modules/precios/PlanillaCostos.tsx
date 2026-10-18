import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react';
import type { Articulo, Familia, ResultadoCostos } from '@shared/types';
import { formatearMonedaConCentavos, parsearMonto } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import CartelExito from '../../components/CartelExito';

const TANDA = 100;
const POR_ENVIO = 300;

function claveGuardado(usuarioId: string): string {
  return `mis-amores:costos:${usuarioId}`;
}

// Lo que se va escribiendo se guarda en este aparato: si se cierra la página o se
// reinicia la PC no se pierde. Mientras no se aprieta "Guardar costos" no se toca nada.
function leerBorrador(usuarioId: string | undefined): Record<string, string> {
  if (!usuarioId) return {};
  try {
    const crudo = localStorage.getItem(claveGuardado(usuarioId));
    const datos = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(datos).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
}

function escribirBorrador(usuarioId: string, borrador: Record<string, string>): void {
  try {
    if (Object.keys(borrador).length > 0) localStorage.setItem(claveGuardado(usuarioId), JSON.stringify(borrador));
    else localStorage.removeItem(claveGuardado(usuarioId));
  } catch {
    /* sin lugar donde guardarlo: la planilla anda igual, sólo que no se recupera */
  }
}

// El costo como se escribe acá ("1500,5"), para mostrarlo en el cuadro.
const comoTexto = (n: number) => (n > 0 ? String(n).replace('.', ',') : '');

// La planilla de costos: una fila por producto con su costo para completar, y al lado
// cuánto se gana (en $ y en %). Con los costos cargados aparece la ganancia real.
export default function PlanillaCostos() {
  const { sesion } = useAuth();
  const usuarioId = sesion?.id;
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [familiaId, setFamiliaId] = useState('');
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>(() => leerBorrador(usuarioId));
  // "Sin costo" es una foto de los que faltaban al activarlo: así la fila donde se está
  // escribiendo no desaparece apenas se tipea el primer número.
  const [sinCostoVisibles, setSinCostoVisibles] = useState<Set<string> | null>(null);
  const [limite, setLimite] = useState(TANDA);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCostos | null>(null);
  const [cartel, setCartel] = useState<string | null>(null);

  useEffect(() => {
    window.api.familias.list().then(setFamilias).catch(() => {});
  }, []);

  const cargarLista = useCallback(
    () => window.api.articulos.list({ familiaId: familiaId || null, busqueda: texto.trim() || undefined }),
    [familiaId, texto]
  );

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    const t = setTimeout(() => {
      cargarLista()
        .then((l) => {
          if (!vigente) return;
          setLista(l);
          setLimite(TANDA);
          setSinCostoVisibles(null);
        })
        .catch((err) => vigente && setError(err instanceof Error ? err.message : 'No se pudo cargar la lista'))
        .finally(() => vigente && setCargando(false));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [cargarLista]);

  useEffect(() => {
    if (usuarioId) escribirBorrador(usuarioId, borrador);
  }, [usuarioId, borrador]);

  // El costo que hay en la fila (lo escrito, o el que ya estaba).
  const textoDe = (a: Articulo) => borrador[a.id] ?? comoTexto(a.precioCosto);
  const costoDe = (a: Articulo): number => {
    const t = textoDe(a).trim();
    return t === '' ? 0 : parsearMonto(t);
  };

  function cambiarCosto(a: Articulo, valor: string) {
    const limpio = valor.replace(/[^0-9.,]/g, '');
    setBorrador((previo) => {
      const siguiente = { ...previo };
      // Si queda igual al que ya estaba, no es un cambio.
      if (limpio === comoTexto(a.precioCosto)) delete siguiente[a.id];
      else siguiente[a.id] = limpio;
      return siguiente;
    });
  }

  const visibles = useMemo(
    () => (sinCostoVisibles ? lista.filter((a) => sinCostoVisibles.has(a.id)) : lista),
    [lista, sinCostoVisibles]
  );

  // Los cambios a guardar: lo escrito en un producto de esta lista que de verdad es otro costo.
  const cambios = useMemo(() => {
    const salida: { a: Articulo; costo: number }[] = [];
    for (const a of lista) {
      if (borrador[a.id] === undefined) continue;
      const c = costoDe(a);
      if (Number.isFinite(c) && c >= 0 && c !== a.precioCosto) salida.push({ a, costo: c });
    }
    return salida;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, borrador]);
  const invalidos = lista.filter((a) => borrador[a.id] !== undefined && !Number.isFinite(costoDe(a))).length;
  const conCosto = lista.filter((a) => a.precioCosto > 0).length;
  const bajoElCosto = cambios.filter((c) => c.a.precioVenta > 0 && c.costo > c.a.precioVenta).length;

  function alternarSinCosto() {
    if (sinCostoVisibles) setSinCostoVisibles(null);
    else setSinCostoVisibles(new Set(lista.filter((a) => costoDe(a) === 0).map((a) => a.id)));
  }

  async function guardar() {
    if (cambios.length === 0) return;
    if (
      !confirm(
        `Se van a guardar ${cambios.length} costo(s).` +
          (bajoElCosto > 0 ? `\n\nOjo: en ${bajoElCosto} el costo queda más alto que el precio de venta (se vendería con pérdida).` : '') +
          '\n\nQueda anotado en el historial de cada producto. ¿Confirmás?'
      )
    ) {
      return;
    }
    setGuardando(true);
    setError(null);
    setResultado(null);
    const total: ResultadoCostos = { cambiados: 0, sinCambios: 0, omitidos: [] };
    try {
      for (let i = 0; i < cambios.length; i += POR_ENVIO) {
        const tanda = cambios.slice(i, i + POR_ENVIO).map((c) => ({
          articuloId: c.a.id,
          precioCosto: c.costo,
          costoVisto: c.a.precioCosto,
        }));
        const r = await window.api.precios.aplicarCostos(tanda);
        total.cambiados += r.cambiados;
        total.sinCambios += r.sinCambios;
        total.omitidos.push(...r.omitidos);
      }
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'No se pudieron guardar los costos') +
          ' — lo que ya se guardó quedó guardado. Tocá "Guardar costos" de nuevo para seguir.'
      );
    }
    try {
      const nueva = await cargarLista();
      setLista(nueva);
      // Se limpia lo que ya quedó guardado; queda lo que no se pudo (para verlo y corregirlo).
      const fallaron = new Set(total.omitidos.map((o) => o.articuloId));
      setBorrador((previo) => {
        const siguiente: Record<string, string> = {};
        for (const [id, t] of Object.entries(previo)) {
          const a = nueva.find((x) => x.id === id);
          if (a && (fallaron.has(id) || (t.trim() === '' ? 0 : parsearMonto(t)) !== a.precioCosto)) siguiente[id] = t;
        }
        return siguiente;
      });
    } catch {
      /* se actualiza al volver a entrar */
    }
    setSinCostoVisibles(null);
    setResultado(total);
    if (total.cambiados > 0) setCartel(`Costos guardados en ${total.cambiados} producto(s)`);
    setGuardando(false);
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="card space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select className="input w-auto" value={familiaId} onChange={(e) => setFamiliaId(e.target.value)}>
            <option value="">Todos los rubros</option>
            {familias.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Buscar por nombre o código..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <button
            className={`btn ${sinCostoVisibles ? 'bg-amber-100 text-amber-700' : 'btn-secondary'}`}
            onClick={alternarSinCosto}
            title="Mostrar sólo los que todavía no tienen costo"
          >
            Sin costo{!cargando ? ` (${lista.length - conCosto})` : ''}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {cargando ? 'Cargando...' : `${lista.length} producto(s) · ${conCosto} con costo cargado.`} Escribí el costo de cada
          uno: al lado ves cuánto ganás. Tab o Enter para pasar al siguiente.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {resultado && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            Listo: se guardó el costo de {resultado.cambiados} producto(s).
          </p>
          {resultado.omitidos.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              <p className="font-medium">No se pudo guardar {resultado.omitidos.length} costo(s):</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {resultado.omitidos.slice(0, 8).map((o, i) => (
                  <li key={`${o.articuloId}-${i}`}>
                    {o.descripcion ?? 'Un producto'}: {o.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        {cargando ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando...
          </p>
        ) : visibles.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">No hay productos para mostrar.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibles.slice(0, limite).map((a) => {
              const costo = costoDe(a);
              const invalido = borrador[a.id] !== undefined && !Number.isFinite(costo);
              const hayCosto = Number.isFinite(costo) && costo > 0;
              const ganancia = hayCosto ? a.precioVenta - costo : null;
              const margen = hayCosto ? Math.round(((a.precioVenta - costo) / costo) * 1000) / 10 : null;
              const perdida = ganancia !== null && ganancia < 0;
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-sm font-medium text-slate-800">{a.descripcion}</p>
                    <p className="break-words text-xs text-slate-400">
                      {a.familiaNombre ?? 'Sin rubro'}
                      {a.codigoBarras ? ` · ${a.codigoBarras}` : ''}
                    </p>
                  </div>
                  <div className="text-xs text-slate-500">
                    Precio: <span className="font-semibold text-slate-700">{formatearMonedaConCentavos(a.precioVenta)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`costo-${a.id}`}>
                      Costo
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                      <input
                        id={`costo-${a.id}`}
                        className={`input w-28 pl-6 text-right ${invalido ? 'border-red-400' : borrador[a.id] !== undefined ? 'border-brand-400 bg-brand-50/40' : ''}`}
                        inputMode="decimal"
                        placeholder="Costo"
                        value={textoDe(a)}
                        onChange={(e) => cambiarCosto(a, e.target.value)}
                      />
                    </div>
                    <span
                      className={`w-28 text-xs font-semibold ${perdida ? 'text-red-600' : ganancia !== null ? 'text-emerald-600' : 'text-slate-300'}`}
                      title={perdida ? 'El costo es más alto que el precio: se vende con pérdida' : 'Cuánto se gana'}
                    >
                      {ganancia === null || margen === null ? (
                        invalido ? (
                          <span className="text-red-500">no es un número</span>
                        ) : (
                          '—'
                        )
                      ) : (
                        <>
                          {perdida ? <AlertTriangle className="mr-1 inline h-3 w-3" /> : null}
                          {ganancia >= 0 ? '+' : '−'}
                          {formatearMonedaConCentavos(Math.abs(ganancia))} ({margen.toString().replace('.', ',')}%)
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!cargando && visibles.length > limite && (
          <div className="flex justify-center border-t border-slate-100 p-3">
            <button className="btn-secondary" onClick={() => setLimite((l) => l + TANDA)}>
              Mostrar más ({visibles.length - limite} restantes)
            </button>
          </div>
        )}
      </div>

      {createPortal(
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 py-3 pl-4 pr-24 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {cambios.length > 0 ? (
                <>
                  <strong>{cambios.length}</strong> costo(s) para guardar
                  {bajoElCosto > 0 && <span className="text-red-600"> · {bajoElCosto} quedan más caros que el precio</span>}
                  {invalidos > 0 && <span className="text-red-600"> · {invalidos} no son un número</span>}
                </>
              ) : (
                'Lo que escribas queda guardado en este aparato, pero no cuenta hasta que lo guardes.'
              )}
            </p>
            <button className="btn-primary" onClick={guardar} disabled={cambios.length === 0 || guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {guardando ? 'Guardando...' : `Guardar costos (${cambios.length})`}
            </button>
          </div>
        </div>,
        document.body
      )}
      {cartel && <CartelExito mensaje={cartel} onCerrar={() => setCartel(null)} />}
    </div>
  );
}
