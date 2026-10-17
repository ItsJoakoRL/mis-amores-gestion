import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Check,
  ClipboardList,
  Loader2,
  PackageSearch,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Articulo, ArticulosFiltro, Familia, ItemConteo, ResultadoConteo } from '@shared/types';
import { formatearCantidad, limpiarDecimal, numeroDeDecimal, redondearCantidad } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import CartelExito from '../../components/CartelExito';
import { esTactil } from '../../utils/dispositivo';

const TANDA = 60;
// El servidor corrige hasta 1000 por vez; de a tandas más chicas el pedido
// también viaja bien por una WiFi lenta.
const POR_ENVIO = 300;

// Qué se está contando: todo, lo que se vendió sin stock registrado, o un rubro.
const TODOS = 'todos';
const REVISAR = 'revisar';

function filtroDe(seleccion: string): ArticulosFiltro {
  if (seleccion === TODOS) return {};
  if (seleccion === REVISAR) return { soloParaRevisar: true };
  return { familiaId: seleccion };
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Lo que se va contando se guarda en este aparato: si se cierra la página, se
// apaga el celular o se reinicia la PC, se sigue donde se dejó (cada persona
// tiene el suyo). Mientras no se aprieta "Corregir el stock" no se toca nada.
interface ConteoGuardado {
  seleccion: string;
  contados: Record<string, string>;
}

function claveGuardado(usuarioId: string): string {
  return `mis-amores:conteo:${usuarioId}`;
}

function leerGuardado(usuarioId: string | undefined): ConteoGuardado | null {
  if (!usuarioId) return null;
  try {
    const crudo = localStorage.getItem(claveGuardado(usuarioId));
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as ConteoGuardado;
    if (typeof datos.seleccion !== 'string' || !datos.contados || typeof datos.contados !== 'object') return null;
    return Object.keys(datos.contados).length > 0 ? datos : null;
  } catch {
    return null;
  }
}

function escribirGuardado(usuarioId: string, datos: ConteoGuardado | null): void {
  try {
    if (datos) localStorage.setItem(claveGuardado(usuarioId), JSON.stringify(datos));
    else localStorage.removeItem(claveGuardado(usuarioId));
  } catch {
    // Sin lugar donde guardarlo (modo privado): el conteo anda igual, sólo que
    // no se recupera si se cierra la página.
  }
}

export default function InventarioPage() {
  const { sesion } = useAuth();
  const usuarioId = sesion?.id;

  const [familias, setFamilias] = useState<Familia[]>([]);
  const [paraRevisar, setParaRevisar] = useState(0);
  const [guardado, setGuardado] = useState<ConteoGuardado | null>(() => leerGuardado(usuarioId));

  // null = pantalla de inicio (elegir qué contar).
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [lista, setLista] = useState<Articulo[]>([]);
  const [contados, setContados] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  // Recién cuando la lista y lo guardado están puestos se empieza a guardar:
  // antes, el estado vacío pisaba un conteo sin terminar.
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [texto, setTexto] = useState('');
  const [soloConDiferencia, setSoloConDiferencia] = useState(false);
  // "Sin contar" es una foto de los que faltaban al activarlo: así la fila donde
  // se está escribiendo no desaparece apenas se tipea el primer número.
  const [pendientesVisibles, setPendientesVisibles] = useState<Set<string> | null>(null);
  const [limiteVisible, setLimiteVisible] = useState(TANDA);

  const scanRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanAviso, setScanAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [resaltado, setResaltado] = useState<{ id: string; n: number } | null>(null);

  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoConteo | null>(null);
  const [cartel, setCartel] = useState<string | null>(null);

  useEffect(() => {
    window.api.familias.list().then(setFamilias).catch(() => {});
  }, []);

  useEffect(() => {
    if (seleccion !== null) return;
    window.api.dashboard
      .stats()
      .then((s) => setParaRevisar(s.paraRevisarCount))
      .catch(() => {});
  }, [seleccion]);

  const nombreDe = useCallback(
    (sel: string) =>
      sel === TODOS
        ? 'Todos los rubros'
        : sel === REVISAR
          ? 'Para revisar (vendidos sin stock)'
          : (familias.find((f) => f.id === sel)?.nombre ?? 'Rubro'),
    [familias]
  );

  // La lista a contar, más los productos de otros rubros que se hayan sumado
  // escaneándolos (vienen de `extras`).
  async function traerLista(sel: string, extras: string[]): Promise<Articulo[]> {
    const base = await window.api.articulos.list(filtroDe(sel));
    const ya = new Set(base.map((a) => a.id));
    const faltan = extras.filter((id) => !ya.has(id));
    const traidos = await Promise.all(faltan.map((id) => window.api.articulos.get(id).catch(() => null)));
    return [...traidos.filter((a): a is Articulo => !!a && a.activo), ...base];
  }

  async function empezar(sel: string, previos: Record<string, string> = {}) {
    setError(null);
    setResultado(null);
    setCargado(false);
    setCargando(true);
    setSeleccion(sel);
    setTexto('');
    setSoloConDiferencia(false);
    setPendientesVisibles(null);
    setScanAviso(null);
    setLimiteVisible(TANDA);
    try {
      const l = await traerLista(sel, Object.keys(previos));
      const ids = new Set(l.map((a) => a.id));
      setLista(l);
      setContados(Object.fromEntries(Object.entries(previos).filter(([id]) => ids.has(id))));
      setCargado(true);
      if (!esTactil()) setTimeout(() => scanRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la lista');
      setSeleccion(null);
    } finally {
      setCargando(false);
    }
  }

  // Se guarda cada cambio (ver ConteoGuardado).
  useEffect(() => {
    if (!usuarioId || seleccion === null || !cargado) return;
    const hay = Object.values(contados).some((t) => t.trim() !== '');
    escribirGuardado(usuarioId, hay ? { seleccion, contados } : null);
  }, [usuarioId, seleccion, cargado, contados]);

  function volverAlInicio() {
    setSeleccion(null);
    setLista([]);
    setContados({});
    setCargado(false);
    setResultado(null);
    setGuardado(leerGuardado(usuarioId));
  }

  function descartarConteo() {
    if (!confirm('¿Descartar lo que contaste hasta ahora? El stock del sistema no se toca, pero tenés que volver a contar.')) return;
    if (usuarioId) escribirGuardado(usuarioId, null);
    setGuardado(null);
    if (seleccion !== null) volverAlInicio();
  }

  const valorContado = useCallback(
    (a: Articulo): number | null => {
      const t = (contados[a.id] ?? '').trim();
      return t === '' ? null : redondearCantidad(numeroDeDecimal(t));
    },
    [contados]
  );

  const resumen = useMemo(() => {
    let contadosN = 0;
    let suben = 0;
    let bajan = 0;
    const aCorregir: ItemConteo[] = [];
    for (const a of lista) {
      const v = valorContado(a);
      if (v === null) continue;
      contadosN += 1;
      const dif = redondearCantidad(v - a.stock);
      if (dif === 0) continue;
      aCorregir.push({ articuloId: a.id, contado: v });
      if (dif > 0) suben += 1;
      else bajan += 1;
    }
    return { contadosN, suben, bajan, aCorregir };
  }, [lista, valorContado]);

  const filtrados = useMemo(() => {
    const q = sinTildes(texto.trim());
    return lista.filter((a) => {
      if (q && !sinTildes(a.descripcion).includes(q) && !(a.codigoBarras ?? '').includes(q)) return false;
      if (pendientesVisibles && !pendientesVisibles.has(a.id)) return false;
      if (soloConDiferencia) {
        const v = valorContado(a);
        if (v === null || redondearCantidad(v - a.stock) === 0) return false;
      }
      return true;
    });
  }, [lista, texto, pendientesVisibles, soloConDiferencia, valorContado]);

  // Con la lista ya filtrada a mano en un ref, el escaneo (un manejador que se
  // arma una sola vez por tecla) siempre ve la lista de ahora.
  const listaRef = useRef(lista);
  listaRef.current = lista;

  function alternarSinContar() {
    if (pendientesVisibles) {
      setPendientesVisibles(null);
      return;
    }
    setPendientesVisibles(new Set(lista.filter((a) => valorContado(a) === null).map((a) => a.id)));
  }

  function enfocarEscaneo() {
    if (esTactil()) (document.activeElement as HTMLElement | null)?.blur();
    else scanRef.current?.focus();
  }

  function cambiarContado(a: Articulo, valor: string) {
    const limpio = a.unidad === 'peso' ? limpiarDecimal(valor) : valor.replace(/[^0-9]/g, '');
    setContados((previos) => {
      const siguientes = { ...previos };
      if (limpio === '') delete siguientes[a.id];
      else siguientes[a.id] = limpio;
      return siguientes;
    });
  }

  useEffect(() => {
    if (!resaltado) return;
    const ir = setTimeout(
      () => document.getElementById(`fila-${resaltado.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      60
    );
    const apagar = setTimeout(() => setResaltado((r) => (r && r.n === resaltado.n ? null : r)), 2500);
    return () => {
      clearTimeout(ir);
      clearTimeout(apagar);
    };
  }, [resaltado]);

  // Escanear un producto lo suma al conteo (+1). Si se vende por peso no hay
  // forma de saber cuántos kilos son con el código: se lleva a su casillero.
  async function manejarEscaneo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const codigo = scanValue.trim();
    if (!codigo) return;
    setScanValue('');
    let a: Articulo | undefined | null = listaRef.current.find((x) => x.codigoBarras === codigo);
    if (!a) {
      try {
        a = await window.api.articulos.buscarPorCodigo(codigo);
      } catch (err) {
        setScanAviso({ tipo: 'error', texto: err instanceof Error ? err.message : 'No se pudo buscar el código' });
        return;
      }
      if (a && !a.activo) {
        setScanAviso({ tipo: 'error', texto: `"${a.descripcion}" está en la papelera.` });
        return;
      }
      if (!a) {
        setScanAviso({
          tipo: 'error',
          texto: `El código ${codigo} no está cargado. Asignáselo a un producto desde Artículos y stock.`,
        });
        return;
      }
      const nuevo = a;
      // De otro rubro: se suma arriba de la lista.
      setLista((l) => (l.some((x) => x.id === nuevo.id) ? l : [nuevo, ...l]));
    }
    const producto = a;
    // Al escanear se muestra todo: si el producto estaba filtrado, no se vería.
    setTexto('');
    setSoloConDiferencia(false);
    setPendientesVisibles(null);
    setLimiteVisible((l) => Math.max(l, listaRef.current.findIndex((x) => x.id === producto.id) + 2, TANDA));
    setResaltado((r) => ({ id: producto.id, n: (r?.n ?? 0) + 1 }));
    if (producto.unidad === 'peso') {
      setScanAviso({ tipo: 'ok', texto: `${producto.descripcion}: escribí cuántos kg hay.` });
      setTimeout(() => (document.getElementById(`contado-${producto.id}`) as HTMLInputElement | null)?.focus(), 120);
      return;
    }
    setContados((previos) => ({ ...previos, [producto.id]: String((parseInt(previos[producto.id] ?? '0', 10) || 0) + 1) }));
    setScanAviso({ tipo: 'ok', texto: `+1 · ${producto.descripcion}` });
  }

  async function corregirStock() {
    const items = resumen.aCorregir;
    if (items.length === 0 || !seleccion) return;
    const partes = [];
    if (resumen.suben > 0) partes.push(`${resumen.suben} suben`);
    if (resumen.bajan > 0) partes.push(`${resumen.bajan} bajan`);
    if (
      !confirm(
        `Se va a corregir el stock de ${items.length} producto(s) (${partes.join(' y ')}) a lo que contaste.\n\n` +
          'Queda anotado en el historial de cada producto. ¿Confirmás?'
      )
    ) {
      return;
    }
    setAplicando(true);
    setError(null);
    const total: ResultadoConteo = { corregidos: 0, sinCambios: 0, errores: [] };
    try {
      for (let i = 0; i < items.length; i += POR_ENVIO) {
        const r = await window.api.articulos.aplicarConteo(items.slice(i, i + POR_ENVIO));
        total.corregidos += r.corregidos;
        total.sinCambios += r.sinCambios;
        total.errores.push(...r.errores);
      }
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'No se pudo corregir el stock') +
          ' — lo que ya se corrigió quedó corregido. Tocá "Corregir el stock" de nuevo para seguir con el resto.'
      );
    }
    // Se vuelve a leer el stock de ahora: lo que ya se corrigió deja de figurar
    // con diferencia (así repetir es seguro).
    try {
      const fallaron = new Set(total.errores.map((e) => e.articuloId));
      const l = await traerLista(seleccion, Object.keys(contados));
      setLista(l);
      // Se limpian los contados que ya quedaron bien; quedan los que fallaron.
      setContados((previos) => {
        const siguientes: Record<string, string> = {};
        for (const [id, t] of Object.entries(previos)) {
          const a = l.find((x) => x.id === id);
          const v = a ? redondearCantidad(numeroDeDecimal(t)) : null;
          if (a && (fallaron.has(id) || (v !== null && v !== a.stock))) siguientes[id] = t;
        }
        return siguientes;
      });
    } catch {
      // Se ve igual el resultado; la lista se actualiza al volver a entrar.
    }
    setPendientesVisibles(null);
    setResultado(total);
    if (total.corregidos > 0) setCartel(`Stock corregido en ${total.corregidos} producto(s)`);
    setAplicando(false);
  }

  const hayAlgoContado = resumen.contadosN > 0;

  // ===================== Pantalla de inicio =====================
  if (seleccion === null) {
    return (
      <div className="mx-auto max-w-3xl animate-slide-up p-4 pb-24 sm:p-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-800">
          <ClipboardList className="h-6 w-6 text-teal-500" />
          Contar inventario
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Contás lo que hay de verdad en la góndola o el depósito y el sistema corrige el stock a ese número. Se cuenta
          de a un rubro, y lo que vas contando queda guardado: lo podés dejar y seguir después.
        </p>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

        {guardado && (
          <div className="card mt-6 border-teal-200 bg-teal-50/60 p-4">
            <p className="flex items-start gap-2 text-sm text-teal-800">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
              Tenés un conteo sin terminar: <strong>{nombreDe(guardado.seleccion)}</strong> (
              {Object.keys(guardado.contados).length} producto(s) contados).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => empezar(guardado.seleccion, guardado.contados)}>
                Seguir contando
              </button>
              <button className="btn-secondary" onClick={descartarConteo}>
                <Trash2 className="h-4 w-4" />
                Descartar
              </button>
            </div>
          </div>
        )}

        <h2 className="mt-8 text-sm font-medium text-slate-600">¿Qué querés contar?</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {paraRevisar > 0 && (
            <button
              onClick={() => empezar(REVISAR)}
              className="flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100 sm:col-span-2"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              <span>
                <span className="block font-medium text-amber-800">Para revisar ({paraRevisar})</span>
                <span className="block text-xs text-amber-700">Se vendieron sin stock registrado: empezá por éstos.</span>
              </span>
            </button>
          )}
          {familias.map((f) => (
            <button
              key={f.id}
              onClick={() => empezar(f.id)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left font-medium text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
            >
              <PackageSearch className="h-5 w-5 shrink-0 text-teal-500" />
              {f.nombre}
            </button>
          ))}
          <button
            onClick={() => empezar(TODOS)}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left font-medium text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
          >
            <PackageSearch className="h-5 w-5 shrink-0 text-slate-400" />
            Todos los rubros
          </button>
        </div>
      </div>
    );
  }

  // ===================== Pantalla de conteo =====================
  return (
    <div className="mx-auto max-w-4xl animate-slide-up p-4 pb-40 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-800">
            <ClipboardList className="h-6 w-6 shrink-0 text-teal-500" />
            <span className="break-words">{nombreDe(seleccion)}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {cargando
              ? 'Cargando...'
              : `${lista.length} producto(s) · contados ${resumen.contadosN} de ${lista.length}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hayAlgoContado && (
            <button className="btn-secondary" onClick={descartarConteo}>
              <Trash2 className="h-4 w-4" />
              Descartar
            </button>
          )}
          <button className="btn-secondary" onClick={volverAlInicio}>
            <ArrowLeft className="h-4 w-4" />
            Elegir otro rubro
          </button>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {resultado && (
        <div className="mt-4 space-y-2">
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            Listo: se corrigió el stock de {resultado.corregidos} producto(s)
            {resultado.sinCambios > 0 ? ` y ${resultado.sinCambios} ya estaban bien` : ''}.
          </p>
          {resultado.errores.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              <p className="font-medium">No se pudieron corregir {resultado.errores.length} producto(s):</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {resultado.errores.slice(0, 10).map((e, i) => (
                  <li key={`${e.articuloId}-${i}`}>
                    {e.descripcion ?? 'Un producto'}: {e.mensaje}
                  </li>
                ))}
                {resultado.errores.length > 10 && <li>y {resultado.errores.length - 10} más...</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Escaneo: cada código suma 1 al producto. */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border-2 border-teal-200 bg-teal-50 px-4 py-3">
        <Barcode className="h-5 w-5 shrink-0 text-teal-500" />
        <input
          ref={scanRef}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-teal-900 outline-none placeholder:font-normal placeholder:text-teal-500"
          placeholder="Escaneá un producto (suma 1)..."
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={manejarEscaneo}
        />
      </div>
      {scanAviso && (
        <p
          className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-medium ${
            scanAviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {scanAviso.texto}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar en esta lista..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <button
          className={`btn ${pendientesVisibles ? 'bg-teal-100 text-teal-700' : 'btn-secondary'}`}
          onClick={alternarSinContar}
          title="Mostrar sólo lo que todavía no contaste"
        >
          Sin contar
        </button>
        <button
          className={`btn ${soloConDiferencia ? 'bg-amber-100 text-amber-700' : 'btn-secondary'}`}
          onClick={() => setSoloConDiferencia((v) => !v)}
          title="Mostrar sólo lo que contaste distinto al sistema"
        >
          Con diferencia{resumen.aCorregir.length > 0 ? ` (${resumen.aCorregir.length})` : ''}
        </button>
      </div>

      <div className="card mt-4 overflow-hidden">
        {cargando && (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando...
          </p>
        )}
        {!cargando && lista.length === 0 && (
          <p className="px-4 py-10 text-center text-slate-400">No hay productos para contar acá.</p>
        )}
        {!cargando && lista.length > 0 && filtrados.length === 0 && (
          <p className="px-4 py-10 text-center text-slate-400">Ningún producto coincide con ese filtro.</p>
        )}
        {!cargando && (
          <div className="divide-y divide-slate-100">
            {filtrados.slice(0, limiteVisible).map((a) => {
              const v = valorContado(a);
              const dif = v === null ? null : redondearCantidad(v - a.stock);
              const porPeso = a.unidad === 'peso';
              return (
                <div
                  key={a.id}
                  id={`fila-${a.id}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors ${
                    resaltado?.id === a.id ? 'bg-teal-50' : ''
                  }`}
                >
                  <div className="min-w-[180px] flex-1">
                    <p className="font-medium text-slate-800">{a.descripcion}</p>
                    <p className="break-words text-xs text-slate-400">
                      {a.codigoBarras || 'Sin código'}
                      {(seleccion === TODOS || seleccion === REVISAR) && a.familiaNombre ? ` · ${a.familiaNombre}` : ''}
                    </p>
                  </div>
                  <div className="text-xs text-slate-500">
                    En el sistema:{' '}
                    <span className={`font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                      {formatearCantidad(a.stock)} {porPeso ? 'kg' : 'un.'}
                    </span>
                    {a.stock < 0 && <span className="text-red-500"> (se vendió de más)</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`contado-${a.id}`}>
                      Contado
                    </label>
                    <input
                      id={`contado-${a.id}`}
                      className="input w-24 text-right"
                      inputMode={porPeso ? 'decimal' : 'numeric'}
                      placeholder={porPeso ? 'kg' : 'Contado'}
                      value={contados[a.id] ?? ''}
                      onChange={(e) => cambiarContado(a, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') enfocarEscaneo();
                      }}
                    />
                    <span className="w-16 text-xs font-semibold">
                      {dif === null ? null : dif === 0 ? (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Check className="h-3.5 w-3.5" />
                          Igual
                        </span>
                      ) : (
                        <span className={dif > 0 ? 'text-emerald-600' : 'text-red-600'}>
                          {dif > 0 ? '+' : '−'}
                          {formatearCantidad(Math.abs(dif))}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!cargando && filtrados.length > limiteVisible && (
          <div className="flex justify-center border-t border-slate-100 p-3">
            <button className="btn-secondary" onClick={() => setLimiteVisible((l) => l + TANDA)}>
              Mostrar más ({filtrados.length - limiteVisible} restantes)
            </button>
          </div>
        )}
      </div>

      {/* La barra de abajo: qué cambia y el botón que corrige de verdad. Va en un
          portal (afuera de la página): la animación de entrada de la página hace que
          lo "fijo" de adentro se acomode a la página y no a la pantalla.
          (A la derecha queda lugar para el botón redondo del asistente, que flota ahí.) */}
      {createPortal(
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 py-3 pl-4 pr-24 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {resumen.aCorregir.length === 0 ? (
              hayAlgoContado ? (
                'Todo lo que contaste coincide con el sistema.'
              ) : (
                'Escaneá o escribí lo que contás: el stock no se toca hasta que lo confirmes.'
              )
            ) : (
              <>
                <strong>{resumen.aCorregir.length}</strong> con diferencia
                {resumen.suben > 0 && <span className="text-emerald-600"> · {resumen.suben} suben</span>}
                {resumen.bajan > 0 && <span className="text-red-600"> · {resumen.bajan} bajan</span>}
              </>
            )}
          </p>
          <button className="btn-primary" onClick={corregirStock} disabled={resumen.aCorregir.length === 0 || aplicando}>
            {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {aplicando ? 'Corrigiendo...' : `Corregir el stock (${resumen.aCorregir.length})`}
          </button>
        </div>
      </div>,
      document.body
      )}

      {cartel && <CartelExito mensaje={cartel} onCerrar={() => setCartel(null)} />}
    </div>
  );
}
