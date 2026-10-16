import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BellRing,
  Plus,
  Search,
  AlertTriangle,
  Pencil,
  Trash2,
  PackagePlus,
  ImageOff,
  Barcode,
  Loader2,
  RotateCcw,
  ArrowLeft,
  ShoppingCart,
} from 'lucide-react';
import type { Articulo, Familia } from '@shared/types';
import { formatearCantidad, formatearMoneda } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import ArticuloFormModal from './ArticuloFormModal';
import AjustarStockModal from './AjustarStockModal';
import AsignarCodigoModal from './AsignarCodigoModal';
import ArmarCuentaModal from './ArmarCuentaModal';
import CartelExito from '../../components/CartelExito';
import BotonAyuda from '../../components/BotonAyuda';
import { useRecargarAlVolver } from '../../hooks/useRecargarAlVolver';
import { urlImagen } from '../../urlImagen';
import { esTactil } from '../../utils/dispositivo';
import { useEsPantallaChica } from '../../hooks/useEsPantallaChica';


export default function ArticulosPage() {
  const { esAdmin } = useAuth();
  const pantallaChica = useEsPantallaChica();
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [familiaId, setFamiliaId] = useState<string | null>(null);
  const [soloStockBajo, setSoloStockBajo] = useState(false);
  const [mostrandoPapelera, setMostrandoPapelera] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<Articulo | null | 'nuevo'>(null);
  const [codigoParaNuevo, setCodigoParaNuevo] = useState<string | undefined>(undefined);
  const [ajustandoStock, setAjustandoStock] = useState<Articulo | null>(null);
  const [codigoSinAsignar, setCodigoSinAsignar] = useState<string | null>(null);
  const [cartelExito, setCartelExito] = useState<string | null>(null);
  const [mostrandoArmarCuenta, setMostrandoArmarCuenta] = useState(false);

  // Si se llegó desde un recordatorio ("ajustar el stock de tal producto"),
  // se abre directo la ventana que corresponde, y al terminar se pregunta si
  // el recordatorio ya está hecho.
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const recordatorioPendiente = useRef<string | null>(null);

  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());

  // Con ~3000 artículos, pintar la tabla entera de una sola vez la hace ir a
  // los tumbos (mucho DOM, muchas imágenes) — mostramos de a tandas y quien
  // quiera ver más hace click, en vez de renderizar todo siempre.
  const TANDA = 100;
  const [limiteVisible, setLimiteVisible] = useState(TANDA);

  useEffect(() => {
    const id = params.get('abrir');
    if (!id) return;
    const accion = params.get('accion');
    recordatorioPendiente.current = params.get('recordatorio');
    setParams({}, { replace: true });
    window.api.articulos
      .get(id)
      .then((a) => {
        if (!a) {
          setError('Ese producto ya no existe.');
          recordatorioPendiente.current = null;
          return;
        }
        if (accion === 'editar') setEditando(a);
        else setAjustandoStock(a);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo abrir el producto'));
  }, [params, setParams]);

  function preguntarSiYaEsta() {
    const id = recordatorioPendiente.current;
    if (!id) return;
    recordatorioPendiente.current = null;
    if (confirm('¿Ya está? ¿Marcar el recordatorio como hecho?')) {
      window.api.recordatorios
        .marcarHecho(id, true)
        .then(() => setCartelExito('Recordatorio marcado como hecho'))
        .catch(() => {});
    }
  }

  useEffect(() => {
    if (!mostrandoPapelera) setModoSeleccion(false);
    // También se limpia al cambiar de búsqueda/rubro estando en la papelera:
    // si no, quedan marcados artículos que ya no se ven en la lista filtrada
    // y "Eliminar para siempre" los borraría igual sin que se los recuerde.
    setSeleccionados(new Set());
  }, [mostrandoPapelera, busqueda, familiaId]);

  // Lector de código de barras: el aparato "tipea" el número y manda Enter,
  // como si fuera un teclado ultra rápido. Este input queda enfocado por
  // default para que escanear funcione sin tener que clickear en nada antes.
  const scanRef = useRef<HTMLInputElement>(null);
  // En el celular enfocar el campo abre el teclado de la pantalla y tapa media
  // lista: ahí sólo se enfoca cuando la persona toca el campo.
  const enfocarScan = () => {
    if (!esTactil()) scanRef.current?.focus();
  };
  const [scanValue, setScanValue] = useState('');
  const [buscandoScan, setBuscandoScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  async function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const codigo = scanValue.trim();
    if (!codigo) return;

    setBuscandoScan(true);
    setScanError(null);
    try {
      const encontrado = await window.api.articulos.buscarPorCodigo(codigo);
      if (encontrado) {
        // Si ya existe, lo más común al escanear es sumar stock (llegó
        // mercadería) — vamos directo al ajuste en vez de la ficha completa.
        setAjustandoStock(encontrado);
      } else {
        // Puede ser un producto realmente nuevo, o uno que ya está cargado
        // pero sin código (común en el catálogo importado del sistema
        // viejo) — dejamos elegir en vez de asumir que hay que crear uno.
        setCodigoSinAsignar(codigo);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'No se pudo buscar el código');
    } finally {
      setScanValue('');
      setBuscandoScan(false);
    }
  }

  const filtro = useMemo(
    () => ({
      busqueda: busqueda || undefined,
      familiaId,
      soloStockBajo: mostrandoPapelera ? false : soloStockBajo,
      soloInactivos: mostrandoPapelera,
    }),
    [busqueda, familiaId, soloStockBajo, mostrandoPapelera]
  );

  // Si se escribe rápido o se cambia de filtro, pueden volver respuestas fuera de
  // orden: la lista sólo se pisa con la respuesta del último pedido (se cuente
  // la recarga en silencio o no). Aparte, "Cargando..." y el error los maneja el
  // último pedido con cartel: una recarga en silencio en el medio no los apaga.
  const ultimoPedido = useRef(0);
  const ultimoConCartel = useRef(0);

  const cargar = useCallback(() => {
    const pedido = ++ultimoPedido.current;
    const conCartel = ++ultimoConCartel.current;
    setCargando(true);
    setLimiteVisible(TANDA);
    window.api.articulos
      .list(filtro)
      .then((lista) => {
        if (pedido === ultimoPedido.current) setArticulos(lista);
      })
      .catch((err) => {
        if (conCartel === ultimoConCartel.current) setError(err.message);
      })
      .finally(() => {
        if (conCartel === ultimoConCartel.current) setCargando(false);
      });
  }, [filtro]);

  // Al volver a esta pantalla se actualiza la lista sin el cartel de
  // "Cargando..." ni perder lo que se venía mirando (ver useRecargarAlVolver).
  const recargarEnSilencio = useCallback(() => {
    const pedido = ++ultimoPedido.current;
    window.api.articulos
      .list(filtro)
      .then((lista) => {
        if (pedido === ultimoPedido.current) setArticulos(lista);
      })
      .catch(() => {});
  }, [filtro]);
  useRecargarAlVolver(recargarEnSilencio);

  useEffect(() => {
    window.api.familias.list().then(setFamilias);
  }, []);

  useEffect(() => {
    const debounce = setTimeout(cargar, 200);
    return () => clearTimeout(debounce);
  }, [cargar]);

  const totalStockBajo = useMemo(
    () => articulos.filter((a) => a.stock <= a.stockMinimo).length,
    [articulos]
  );

  async function handleEliminar(a: Articulo) {
    if (!confirm(`¿Dar de baja "${a.descripcion}"? Después lo podés recuperar desde la Papelera.`)) return;
    try {
      await window.api.articulos.eliminar(a.id);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  }

  async function handleRestaurar(a: Articulo) {
    try {
      await window.api.articulos.restaurar(a.id);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo restaurar');
    }
  }

  async function handleEliminarDefinitivo(a: Articulo) {
    if (!confirm(`Esto borra "${a.descripcion}" para siempre, no se puede deshacer. ¿Confirmás?`)) return;
    try {
      await window.api.articulos.eliminarDefinitivo([a.id]);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  }

  function toggleModoSeleccion() {
    setModoSeleccion((v) => !v);
    setSeleccionados(new Set());
  }

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeleccionarTodos() {
    setSeleccionados((prev) =>
      prev.size === articulos.length ? new Set() : new Set(articulos.map((a) => a.id))
    );
  }

  async function handleRestaurarSeleccionados() {
    try {
      await Promise.all([...seleccionados].map((id) => window.api.articulos.restaurar(id)));
      setSeleccionados(new Set());
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudieron restaurar todos los artículos');
    }
  }

  async function handleEliminarSeleccionadosDefinitivo() {
    if (
      !confirm(
        `Esto borra para siempre ${seleccionados.size} artículo(s) de la papelera, no se puede deshacer. ¿Confirmás?`
      )
    )
      return;
    try {
      await window.api.articulos.eliminarDefinitivo([...seleccionados]);
      setSeleccionados(new Set());
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudieron eliminar todos los artículos');
    }
  }

  async function handleVaciarPapelera() {
    if (articulos.length === 0) return;
    if (
      !confirm(
        `Esto borra para siempre los ${articulos.length} artículos de la papelera, no se puede deshacer. ¿Confirmás?`
      )
    )
      return;
    try {
      // Mismo filtro que está usando la lista de la papelera en pantalla —
      // así se borra exactamente lo que dice el cartel de confirmación, ni
      // más ni menos.
      await window.api.articulos.vaciarPapelera({ busqueda: busqueda || undefined, familiaId });
      setSeleccionados(new Set());
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo vaciar la papelera');
    }
  }

  const miniatura = (a: Articulo) => (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      {a.imagenPath ? (
        <img src={urlImagen(a.imagenPath)} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-4 w-4 text-slate-300" />
      )}
    </div>
  );

  const pastillaStock = (a: Articulo) =>
    mostrandoPapelera ? (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        {formatearCantidad(a.stock)} {a.unidad === 'peso' ? 'kg' : 'un.'}
      </span>
    ) : (
      <button
        onClick={() => setAjustandoStock(a)}
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          a.stock <= 0
            ? 'bg-red-100 text-red-700'
            : a.stock <= a.stockMinimo
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-600'
        }`}
        title="Ajustar stock"
      >
        {formatearCantidad(a.stock)} {a.unidad === 'peso' ? 'kg' : 'un.'}
      </button>
    );

  const botonesAcciones = (a: Articulo, conTour = false) =>
    mostrandoPapelera ? (
      <>
        <button
          onClick={() => handleRestaurar(a)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
          title="Restaurar artículo"
        >
          <RotateCcw className="h-4 w-4" />
          Restaurar
        </button>
        <button
          onClick={() => handleEliminarDefinitivo(a)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="Eliminar para siempre"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </>
    ) : (
      <>
        <button
          onClick={() => navigate(`/recordatorios?articulo=${a.id}`)}
          className="rounded-lg p-2 text-slate-400 hover:bg-orange-50 hover:text-orange-600 md:p-1.5"
          title="Anotar un recordatorio sobre este producto"
        >
          <BellRing className="h-4 w-4" />
        </button>
        <button
          data-tour={conTour ? 'art-stock' : undefined}
          onClick={() => setAjustandoStock(a)}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:p-1.5"
          title="Ajustar stock"
        >
          <PackagePlus className="h-4 w-4" />
        </button>
        <button
          onClick={() => setEditando(a)}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:p-1.5"
          title="Editar"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {esAdmin && (
          <button
            onClick={() => handleEliminar(a)}
            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 md:p-1.5"
            title="Eliminar"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </>
    );

  return (
    <div className="mx-auto max-w-6xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            {mostrandoPapelera ? 'Papelera' : 'Artículos y stock'}
            {!mostrandoPapelera && <BotonAyuda seccion="Artículos y stock" />}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mostrandoPapelera
              ? `${articulos.length} artículos dados de baja`
              : `${articulos.length} artículos listados`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esAdmin && !mostrandoPapelera && (
            <button className="btn-secondary" onClick={() => setMostrandoPapelera(true)}>
              <Trash2 className="h-4 w-4" />
              Papelera
            </button>
          )}

          {mostrandoPapelera && (
            <>
              {modoSeleccion && seleccionados.size > 0 && (
                <>
                  <button className="btn-secondary" onClick={handleRestaurarSeleccionados}>
                    <RotateCcw className="h-4 w-4" />
                    Restaurar ({seleccionados.size})
                  </button>
                  <button className="btn-danger" onClick={handleEliminarSeleccionadosDefinitivo}>
                    <Trash2 className="h-4 w-4" />
                    Eliminar para siempre ({seleccionados.size})
                  </button>
                </>
              )}
              <button className="btn-secondary" onClick={toggleModoSeleccion}>
                {modoSeleccion ? 'Cancelar selección' : 'Seleccionar'}
              </button>
              <button className="btn-danger" onClick={handleVaciarPapelera} disabled={articulos.length === 0}>
                <Trash2 className="h-4 w-4" />
                Vaciar papelera
              </button>
            </>
          )}

          {mostrandoPapelera ? (
            <button className="btn-secondary" onClick={() => setMostrandoPapelera(false)}>
              <ArrowLeft className="h-4 w-4" />
              Volver a Artículos
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => setMostrandoArmarCuenta(true)}>
                <ShoppingCart className="h-4 w-4" />
                Armar cuenta
              </button>
              <button
                data-tour="art-nuevo"
                className="btn-primary"
                onClick={() => {
                  setCodigoParaNuevo(undefined);
                  setEditando('nuevo');
                }}
              >
                <Plus className="h-4 w-4" />
                Nuevo artículo
              </button>
            </>
          )}
        </div>
      </div>

      {!mostrandoPapelera && (
        <div data-tour="art-scan" className="mb-4 flex items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-3">
          {buscandoScan ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-500" />
          ) : (
            <Barcode className="h-5 w-5 shrink-0 text-brand-500" />
          )}
          <input
            ref={scanRef}
            className="flex-1 bg-transparent text-sm font-medium text-brand-900 outline-none placeholder:font-normal placeholder:text-brand-400"
            placeholder="Escaneá un código de barras acá..."
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={handleScan}
            autoFocus={!esTactil()}
          />
          {scanError && <span className="text-xs font-medium text-red-600">{scanError}</span>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por código o descripción..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <select
          className="input w-auto"
          value={familiaId ?? ''}
          onChange={(e) => setFamiliaId(e.target.value || null)}
        >
          <option value="">Todos los rubros</option>
          {familias.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre}
            </option>
          ))}
        </select>

        {!mostrandoPapelera && (
          <button
            data-tour="art-stock-bajo-filtro"
            className={`btn ${soloStockBajo ? 'bg-amber-100 text-amber-700' : 'btn-secondary'}`}
            onClick={() => setSoloStockBajo((v) => !v)}
          >
            <AlertTriangle className="h-4 w-4" />
            Stock bajo{totalStockBajo > 0 ? ` (${totalStockBajo})` : ''}
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden">
        {/* Celular: una tarjeta por artículo (una tabla de 5 columnas no entra). */}
        {pantallaChica && (
        <div className="divide-y divide-slate-100">
          {mostrandoPapelera && modoSeleccion && articulos.length > 0 && (
            <label className="flex items-center gap-3 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={seleccionados.size === articulos.length}
                onChange={toggleSeleccionarTodos}
              />
              Seleccionar todos
            </label>
          )}
          {cargando && <p className="px-4 py-10 text-center text-slate-400">Cargando...</p>}
          {!cargando && articulos.length === 0 && (
            <p className="px-4 py-10 text-center text-slate-400">
              {mostrandoPapelera ? 'La papelera está vacía.' : 'No se encontraron artículos.'}
            </p>
          )}
          {!cargando &&
            articulos.slice(0, limiteVisible).map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-4">
                {mostrandoPapelera && modoSeleccion && (
                  <input
                    type="checkbox"
                    className="mt-2.5 shrink-0"
                    checked={seleccionados.has(a.id)}
                    onChange={() => toggleSeleccionado(a.id)}
                  />
                )}
                {miniatura(a)}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{a.descripcion}</p>
                  <p className="break-words text-xs text-slate-400">
                    {a.codigoBarras || 'Sin código'}
                    {a.marcaNombre ? ` · ${a.marcaNombre}` : ''}
                    {a.familiaNombre ? ` · ${a.familiaNombre}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-semibold text-slate-800">{formatearMoneda(a.precioVenta)}</span>
                    {pastillaStock(a)}
                  </div>
                  <div className="-ml-2 mt-1 flex flex-wrap items-center gap-0.5">{botonesAcciones(a)}</div>
                </div>
              </div>
            ))}
        </div>
        )}

        {/* PC: la tabla de siempre. */}
        {!pantallaChica && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {mostrandoPapelera && modoSeleccion && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={articulos.length > 0 && seleccionados.size === articulos.length}
                      onChange={toggleSeleccionarTodos}
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-medium">Artículo</th>
                <th className="px-4 py-3 font-medium">Rubro</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Precio venta</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && (
                <tr>
                  <td colSpan={mostrandoPapelera && modoSeleccion ? 6 : 5} className="px-4 py-10 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!cargando && articulos.length === 0 && (
                <tr>
                  <td colSpan={mostrandoPapelera && modoSeleccion ? 6 : 5} className="px-4 py-10 text-center text-slate-400">
                    {mostrandoPapelera ? 'La papelera está vacía.' : 'No se encontraron artículos.'}
                  </td>
                </tr>
              )}
              {!cargando &&
                articulos.slice(0, limiteVisible).map((a) => (
                  <tr key={a.id} className="transition-colors hover:bg-slate-50">
                    {mostrandoPapelera && modoSeleccion && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={seleccionados.has(a.id)}
                          onChange={() => toggleSeleccionado(a.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {miniatura(a)}
                        <div>
                          <p className="font-medium text-slate-800">{a.descripcion}</p>
                          <p className="text-xs text-slate-400">
                            {a.codigoBarras || 'Sin código'} {a.marcaNombre ? `· ${a.marcaNombre}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{a.familiaNombre ?? '—'}</td>
                    <td className="px-4 py-3">{pastillaStock(a)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{formatearMoneda(a.precioVenta)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">{botonesAcciones(a, true)}</div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        )}
        {!cargando && articulos.length > limiteVisible && (
          <div className="flex justify-center border-t border-slate-100 p-3">
            <button className="btn-secondary" onClick={() => setLimiteVisible((l) => l + TANDA)}>
              Mostrar más ({articulos.length - limiteVisible} restantes)
            </button>
          </div>
        )}
      </div>

      {editando && (
        <ArticuloFormModal
          articulo={editando === 'nuevo' ? null : editando}
          codigoInicial={codigoParaNuevo}
          onCerrar={() => {
            setEditando(null);
            setCodigoParaNuevo(undefined);
            recordatorioPendiente.current = null;
            enfocarScan();
          }}
          onGuardado={() => {
            setCartelExito(editando === 'nuevo' ? 'Artículo creado correctamente' : 'Artículo actualizado correctamente');
            setEditando(null);
            setCodigoParaNuevo(undefined);
            cargar();
            enfocarScan();
            preguntarSiYaEsta();
          }}
        />
      )}

      {cartelExito && <CartelExito mensaje={cartelExito} onCerrar={() => setCartelExito(null)} />}

      {ajustandoStock && (
        <AjustarStockModal
          articulo={ajustandoStock}
          onCerrar={() => {
            setAjustandoStock(null);
            recordatorioPendiente.current = null;
            enfocarScan();
          }}
          onGuardado={() => {
            setAjustandoStock(null);
            cargar();
            enfocarScan();
            preguntarSiYaEsta();
          }}
        />
      )}

      {codigoSinAsignar && (
        <AsignarCodigoModal
          codigo={codigoSinAsignar}
          onCerrar={() => {
            setCodigoSinAsignar(null);
            enfocarScan();
          }}
          onAsignado={() => {
            setCodigoSinAsignar(null);
            cargar();
            enfocarScan();
          }}
          onCrearNuevo={() => {
            setCodigoParaNuevo(codigoSinAsignar);
            setCodigoSinAsignar(null);
            setEditando('nuevo');
          }}
        />
      )}

      {mostrandoArmarCuenta && (
        <ArmarCuentaModal
          onCerrar={() => {
            setMostrandoArmarCuenta(false);
            enfocarScan();
          }}
          onVentaRegistrada={cargar}
        />
      )}
    </div>
  );
}
