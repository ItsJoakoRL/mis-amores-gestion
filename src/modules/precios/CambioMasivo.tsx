import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, ArrowDown, ArrowUp, Check, History, Loader2, Percent, DollarSign, Search, Undo2 } from 'lucide-react';
import type { Articulo, Familia, LotePrecios, ResultadoCambioPrecios } from '@shared/types';
import { formatearMonedaConCentavos, limpiarDecimal, numeroDeDecimal } from '@shared/formato';
import {
  calcularPrecioNuevo,
  nuevoIdLote,
  porcentajeDeCambio,
  REDONDEOS,
  type OperacionPrecio,
  type RedondeoPrecio,
} from '@shared/precios';
import CartelExito from '../../components/CartelExito';

const TANDA = 100;
// El servidor cambia hasta 1000 por vez; de a tandas más chicas el pedido viaja bien por una WiFi lenta.
const POR_ENVIO = 300;

const TEXTO_REDONDEO: Record<RedondeoPrecio, string> = {
  0: 'Sin redondear',
  1: 'A $1',
  5: 'A $5',
  10: 'A $10',
  50: 'A $50',
  100: 'A $100',
};

// Subir o bajar los precios de muchos productos juntos: se elige a cuáles (rubro y/o
// texto), cuánto (por ciento o pesos) y a cuánto redondear, se mira cómo quedaría
// cada uno y recién ahí se aplica. Cada cambio se puede deshacer (abajo, "Cambios
// anteriores"), salvo lo que ya se haya vuelto a cambiar a mano.
export default function CambioMasivo() {
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [familiaId, setFamiliaId] = useState('');
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sentido, setSentido] = useState<'subir' | 'bajar'>('subir');
  const [tipo, setTipo] = useState<'porcentaje' | 'monto'>('porcentaje');
  const [cantidad, setCantidad] = useState('');
  const [redondeo, setRedondeo] = useState<RedondeoPrecio>(10);

  // Los que se destildaron en la vista previa (no se les cambia el precio).
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [limite, setLimite] = useState(TANDA);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState<{ res: ResultadoCambioPrecios; descripcion: string } | null>(null);
  const [cartel, setCartel] = useState<string | null>(null);
  const [lotes, setLotes] = useState<LotePrecios[]>([]);
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null);
  const [avisoDeshacer, setAvisoDeshacer] = useState<string | null>(null);

  useEffect(() => {
    window.api.familias.list().then(setFamilias).catch(() => {});
  }, []);

  const cargarLotes = useCallback(() => {
    window.api.precios.lotes().then(setLotes).catch(() => {});
  }, []);
  useEffect(cargarLotes, [cargarLotes]);

  // La lista de productos a los que podría aplicarse (según rubro y texto).
  const cargarLista = useCallback(async (): Promise<Articulo[]> => {
    return window.api.articulos.list({ familiaId: familiaId || null, busqueda: texto.trim() || undefined });
  }, [familiaId, texto]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    const t = setTimeout(() => {
      cargarLista()
        .then((l) => {
          if (!vigente) return;
          setLista(l);
          setExcluidos(new Set());
          setLimite(TANDA);
        })
        .catch((err) => vigente && setError(err instanceof Error ? err.message : 'No se pudo cargar la lista'))
        .finally(() => vigente && setCargando(false));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [cargarLista]);

  const numero = numeroDeDecimal(cantidad);
  const hayCantidad = cantidad.trim() !== '' && numero > 0;
  const errorDeCantidad =
    cantidad.trim() === ''
      ? null
      : !(numero > 0)
        ? 'Escribí un número mayor a cero.'
        : tipo === 'porcentaje' && sentido === 'bajar' && numero >= 100
          ? 'No se puede bajar un 100% o más.'
          : tipo === 'porcentaje' && sentido === 'subir' && numero > 1000
            ? 'Ese porcentaje es demasiado grande.'
            : tipo === 'monto' && numero > 1_000_000
              ? 'Ese monto es demasiado grande.'
              : null;
  const operacion: OperacionPrecio | null =
    hayCantidad && !errorDeCantidad
      ? { tipo, valor: sentido === 'subir' ? numero : -numero, redondeo }
      : null;

  // Cómo quedaría cada producto con precio (los que no tienen precio no se tocan).
  const filas = useMemo(() => {
    if (!operacion) return [];
    return lista
      .filter((a) => a.precioVenta > 0)
      .map((a) => ({ a, nuevo: calcularPrecioNuevo(a.precioVenta, operacion) }))
      .filter((f) => f.nuevo !== f.a.precioVenta);
  }, [lista, operacion]);
  const aCambiar = filas.filter((f) => !excluidos.has(f.a.id));
  const sinPrecio = lista.filter((a) => !(a.precioVenta > 0)).length;
  const quedaEnCero = aCambiar.filter((f) => f.nuevo === 0).length;

  const nombreRubro = familias.find((f) => f.id === familiaId)?.nombre ?? 'Todos los rubros';
  const descripcion = operacion
    ? `${nombreRubro}${texto.trim() ? ` ("${texto.trim()}")` : ''}: ${sentido} ${numero.toString().replace('.', ',')}${
        tipo === 'porcentaje' ? '%' : ' pesos'
      }${redondeo > 0 ? `, redondeado a $${redondeo}` : ''}`
    : '';

  function alternar(id: string) {
    setExcluidos((previos) => {
      const siguientes = new Set(previos);
      if (siguientes.has(id)) siguientes.delete(id);
      else siguientes.add(id);
      return siguientes;
    });
  }

  async function aplicar() {
    if (!operacion || aCambiar.length === 0) return;
    if (
      !confirm(
        `Vas a cambiar el precio de venta de ${aCambiar.length} producto(s):\n${descripcion}.\n\n` +
          'Queda anotado en el historial de cada uno y lo podés deshacer desde "Cambios anteriores". ¿Confirmás?'
      )
    ) {
      return;
    }
    setAplicando(true);
    setError(null);
    setResultado(null);
    const loteId = nuevoIdLote();
    const total: ResultadoCambioPrecios = { loteId, cambiados: 0, sinCambios: 0, omitidos: [] };
    try {
      for (let i = 0; i < aCambiar.length; i += POR_ENVIO) {
        const tanda = aCambiar.slice(i, i + POR_ENVIO).map((f) => ({
          articuloId: f.a.id,
          precioNuevo: f.nuevo,
          precioVisto: f.a.precioVenta,
        }));
        const r = await window.api.precios.aplicar(tanda, descripcion, loteId);
        total.cambiados += r.cambiados;
        total.sinCambios += r.sinCambios;
        total.omitidos.push(...r.omitidos);
      }
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'No se pudo cambiar los precios') +
          ' — lo que ya se cambió quedó cambiado (se puede deshacer desde "Cambios anteriores"). Revisá la lista y volvé a intentar.'
      );
    }
    // Se vuelve a leer la lista con los precios de ahora (así la vista previa parte de lo nuevo).
    try {
      setLista(await cargarLista());
      setExcluidos(new Set());
    } catch {
      /* se actualiza al volver a entrar */
    }
    cargarLotes();
    setResultado({ res: total, descripcion });
    if (total.cambiados > 0) setCartel(`Precios cambiados en ${total.cambiados} producto(s)`);
    setCantidad('');
    setAplicando(false);
  }

  async function deshacer(l: LotePrecios) {
    if (!confirm(`¿Deshacer este cambio?\n${l.descripcion} (${l.cantidad} producto(s)).\n\nLos precios vuelven a como estaban, salvo los que ya se cambiaron de nuevo después.`)) return;
    setDeshaciendo(l.loteId);
    setAvisoDeshacer(null);
    try {
      const r = await window.api.precios.deshacer(l.loteId);
      setAvisoDeshacer(
        `Listo: volvió el precio de ${r.revertidos} producto(s)` +
          (r.omitidos > 0 ? `; ${r.omitidos} no se tocaron porque ya se habían cambiado de nuevo.` : '.')
      );
      cargarLotes();
      setLista(await cargarLista());
      setExcluidos(new Set());
    } catch (err) {
      setAvisoDeshacer(err instanceof Error ? err.message : 'No se pudo deshacer');
    } finally {
      setDeshaciendo(null);
    }
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="card space-y-4 p-4 sm:p-5">
        <div data-tour="precios-productos">
          <h2 className="text-sm font-semibold text-slate-700">1. ¿A qué productos?</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
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
                placeholder='Que contengan... (ej: "coca" o "alfajor")'
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {cargando
              ? 'Cargando...'
              : `${lista.length} producto(s) en la lista${sinPrecio > 0 ? ` · ${sinPrecio} sin precio (no se tocan)` : ''}.`}
          </p>
        </div>

        <div data-tour="precios-cuanto">
          <h2 className="text-sm font-semibold text-slate-700">2. ¿Cuánto?</h2>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              <button
                onClick={() => setSentido('subir')}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                  sentido === 'subir' ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <ArrowUp className="h-4 w-4" />
                Subir
              </button>
              <button
                onClick={() => setSentido('bajar')}
                className={`flex items-center gap-1.5 border-l border-slate-300 px-3 py-2 text-sm font-medium ${
                  sentido === 'bajar' ? 'bg-red-50 text-red-700' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <ArrowDown className="h-4 w-4" />
                Bajar
              </button>
            </div>
            <div className="w-28">
              <label className="label">{tipo === 'porcentaje' ? 'Porcentaje' : 'Pesos'}</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder={tipo === 'porcentaje' ? '10' : '100'}
                value={cantidad}
                onChange={(e) => setCantidad(limpiarDecimal(e.target.value))}
              />
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              <button
                onClick={() => setTipo('porcentaje')}
                title="Un tanto por ciento"
                className={`flex items-center gap-1 px-3 py-2 text-sm font-medium ${
                  tipo === 'porcentaje' ? 'bg-brand-50 text-brand-700' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Percent className="h-4 w-4" />
              </button>
              <button
                onClick={() => setTipo('monto')}
                title="Una cantidad de pesos"
                className={`flex items-center gap-1 border-l border-slate-300 px-3 py-2 text-sm font-medium ${
                  tipo === 'monto' ? 'bg-brand-50 text-brand-700' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <DollarSign className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="label">Redondear</label>
              <select
                className="input w-auto"
                value={redondeo}
                onChange={(e) => setRedondeo(Number(e.target.value) as RedondeoPrecio)}
              >
                {REDONDEOS.map((r) => (
                  <option key={r} value={r}>
                    {TEXTO_REDONDEO[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {errorDeCantidad && <p className="mt-2 text-xs text-red-600">{errorDeCantidad}</p>}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {resultado && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            Listo: se cambió el precio de {resultado.res.cambiados} producto(s)
            {resultado.res.sinCambios > 0 ? ` y ${resultado.res.sinCambios} ya tenían ese precio` : ''}. Si te
            equivocaste, lo deshacés abajo, en "Cambios anteriores".
          </p>
          {resultado.res.omitidos.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              <p className="font-medium">No se pudo cambiar {resultado.res.omitidos.length} producto(s):</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {resultado.res.omitidos.slice(0, 8).map((o, i) => (
                  <li key={`${o.articuloId}-${i}`}>
                    {o.descripcion ?? 'Un producto'}: {o.motivo}
                  </li>
                ))}
                {resultado.res.omitidos.length > 8 && <li>y {resultado.res.omitidos.length - 8} más...</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div data-tour="precios-vista" className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">3. Así quedarían los precios</h2>
          {operacion && !cargando && (
            <p className="text-xs text-slate-400">
              {filas.length} producto(s) cambian · {descripcion}
            </p>
          )}
        </div>
        {!operacion ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Elegí si subir o bajar y escribí cuánto: acá ves cómo quedaría cada precio antes de cambiar nada.
          </p>
        ) : cargando ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando...
          </p>
        ) : filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Con eso ningún precio cambia.</p>
        ) : (
          <>
            {quedaEnCero > 0 && (
              <p className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {quedaEnCero} producto(s) quedarían en $0. Destildalos si no querés que se regalen.
              </p>
            )}
            <div className="divide-y divide-slate-100">
              {filas.slice(0, limite).map(({ a, nuevo }) => {
                const incluido = !excluidos.has(a.id);
                const cambio = porcentajeDeCambio(a.precioVenta, nuevo);
                return (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 ${incluido ? '' : 'opacity-50'}`}
                  >
                    <input type="checkbox" checked={incluido} onChange={() => alternar(a.id)} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{a.descripcion}</p>
                      <p className="truncate text-xs text-slate-400">
                        {a.familiaNombre ?? 'Sin rubro'}
                        {a.codigoBarras ? ` · ${a.codigoBarras}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="text-xs text-slate-400 line-through">{formatearMonedaConCentavos(a.precioVenta)}</p>
                      <p className="font-semibold text-slate-800">{formatearMonedaConCentavos(nuevo)}</p>
                    </div>
                    <span
                      className={`w-14 shrink-0 text-right text-xs font-semibold ${cambio >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                    >
                      {cambio >= 0 ? '+' : '−'}
                      {Math.abs(cambio).toString().replace('.', ',')}%
                    </span>
                  </label>
                );
              })}
            </div>
            {filas.length > limite && (
              <div className="flex justify-center border-t border-slate-100 p-3">
                <button className="btn-secondary" onClick={() => setLimite((l) => l + TANDA)}>
                  Mostrar más ({filas.length - limite} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <History className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Cambios anteriores</h2>
        </div>
        {avisoDeshacer && <p className="bg-slate-50 px-4 py-2 text-xs text-slate-600">{avisoDeshacer}</p>}
        {lotes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Todavía no hiciste ningún cambio de precios en conjunto.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lotes.map((l) => (
              <li key={l.loteId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-slate-800">{l.descripcion}</p>
                  <p className="text-xs text-slate-400">
                    {format(new Date(l.fecha), "d 'de' MMMM, HH:mm", { locale: es })} · {l.cantidad} producto(s)
                    {l.usuarioNombre ? ` · ${l.usuarioNombre}` : ''}
                  </p>
                </div>
                {l.deshecho ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Deshecho</span>
                ) : (
                  <button className="btn-secondary" onClick={() => deshacer(l)} disabled={deshaciendo !== null}>
                    {deshaciendo === l.loteId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                    Deshacer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* La barra de abajo: lo que se va a cambiar y el botón que lo aplica. Va en un portal
          (afuera de la página) porque la animación de entrada de la página hace que lo
          "fijo" de adentro se acomode a la página y no a la pantalla. */}
      {createPortal(
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 py-3 pl-4 pr-24 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {operacion && aCambiar.length > 0 ? (
                <>
                  Cambian <strong>{aCambiar.length}</strong> precio(s)
                  {excluidos.size > 0 ? ` (destildaste ${excluidos.size})` : ''}.
                </>
              ) : (
                'No se cambia ningún precio hasta que lo confirmes.'
              )}
            </p>
            <button
              data-tour="precios-aplicar"
              className="btn-primary"
              onClick={aplicar}
              disabled={!operacion || aCambiar.length === 0 || aplicando}
            >
              {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {aplicando ? 'Cambiando...' : `Cambiar los precios (${aCambiar.length})`}
            </button>
          </div>
        </div>,
        document.body
      )}
      {cartel && <CartelExito mensaje={cartel} onCerrar={() => setCartel(null)} />}
    </div>
  );
}
