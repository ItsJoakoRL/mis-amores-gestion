import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, format, formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Contact,
  Flame,
  HandCoins,
  ListChecks,
  Loader2,
  Package,
  PackagePlus,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { Recordatorio, RecordatorioInput, TipoRecordatorio } from '@shared/types';
import { formatearMoneda } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';
import CartelExito from '../../components/CartelExito';
import { useRecargarAlVolver } from '../../hooks/useRecargarAlVolver';

type Estado = 'pendientes' | 'hechos';

// Clases completas (no armadas con template strings) para que Tailwind las
// detecte al escanear el código y no las purgue del CSS final.
const TIPOS: Array<{
  valor: TipoRecordatorio;
  etiqueta: string;
  icono: React.ComponentType<{ className?: string }>;
  chip: string;
  activo: string;
}> = [
  { valor: 'hacer', etiqueta: 'Hacer', icono: ListChecks, chip: 'bg-brand-50 text-brand-700', activo: 'border-brand-500 bg-brand-50 text-brand-700' },
  { valor: 'cambiar', etiqueta: 'Cambiar', icono: Replace, chip: 'bg-violet-50 text-violet-700', activo: 'border-violet-500 bg-violet-50 text-violet-700' },
  { valor: 'reponer', etiqueta: 'Reponer', icono: PackagePlus, chip: 'bg-sky-50 text-sky-700', activo: 'border-sky-500 bg-sky-50 text-sky-700' },
  { valor: 'cobrar', etiqueta: 'Cobrar', icono: HandCoins, chip: 'bg-amber-50 text-amber-700', activo: 'border-amber-500 bg-amber-50 text-amber-700' },
  { valor: 'otro', etiqueta: 'Otro', icono: Pin, chip: 'bg-slate-100 text-slate-600', activo: 'border-slate-500 bg-slate-100 text-slate-700' },
];

function datosDeTipo(tipo: TipoRecordatorio) {
  return TIPOS.find((t) => t.valor === tipo) ?? TIPOS[0];
}

function hoyYMD(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// "Venció ayer", "Para hoy", "Para el viernes 17"... y de qué color.
function etiquetaFecha(paraFecha: string, hecho: boolean): { texto: string; clase: string } {
  const fecha = parseISO(paraFecha);
  const dias = differenceInCalendarDays(fecha, new Date());
  if (hecho) return { texto: `Era para el ${format(fecha, "d 'de' MMMM", { locale: es })}`, clase: 'text-slate-400' };
  if (dias < -1) return { texto: `Venció hace ${-dias} días`, clase: 'text-red-600 font-medium' };
  if (dias === -1) return { texto: 'Venció ayer', clase: 'text-red-600 font-medium' };
  if (dias === 0) return { texto: 'Para hoy', clase: 'text-amber-600 font-medium' };
  if (dias === 1) return { texto: 'Para mañana', clase: 'text-amber-600' };
  if (dias < 7) return { texto: `Para el ${format(fecha, 'EEEE d', { locale: es })}`, clase: 'text-slate-500' };
  return { texto: `Para el ${format(fecha, "d 'de' MMMM", { locale: es })}`, clase: 'text-slate-500' };
}

function haceTiempo(iso: string | null): string {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return '';
  }
}

const FORMULARIO_VACIO: RecordatorioInput = { texto: '', tipo: 'hacer', urgente: false, paraFecha: null, articuloId: null, clienteId: null };

// A qué producto o cliente se refiere un recordatorio, para elegirlo en el
// formulario (el nombre es sólo para mostrarlo).
interface Vinculo {
  articuloId: string | null;
  clienteId: string | null;
  nombre: string | null;
}

export default function RecordatoriosPage() {
  const { sesion } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [estado, setEstado] = useState<Estado>('pendientes');
  const [items, setItems] = useState<Recordatorio[] | null>(null);
  const [cuantosPendientes, setCuantosPendientes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [cartel, setCartel] = useState<string | null>(null);
  // Si se llegó desde un producto o un cliente ("anotar un recordatorio sobre
  // esto"), el formulario arranca ya con eso elegido.
  const [precargado, setPrecargado] = useState<{ clave: number; inicial: RecordatorioInput; nombre: string | null } | null>(null);

  // Si se cambia de pestaña rápido, pueden volver respuestas fuera de orden: sólo
  // vale la del último pedido (si no, "Hechos" podía mostrar la lista de "Pendientes").
  const ultimoPedido = useRef(0);

  const cargar = useCallback(() => {
    const pedido = ++ultimoPedido.current;
    window.api.recordatorios
      .list(estado)
      .then((lista) => {
        if (pedido !== ultimoPedido.current) return;
        setItems(lista);
        setError(null);
      })
      .catch((err) => {
        if (pedido !== ultimoPedido.current) return;
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los recordatorios');
      });
    window.api.recordatorios
      .resumen()
      .then((r) => setCuantosPendientes(r.pendientes))
      .catch(() => {});
  }, [estado]);

  useEffect(() => {
    setItems(null);
    cargar();
  }, [cargar]);
  // También se vuelve a cargar solo cuando alguien (en otra PC o celular)
  // anota o marca algo.
  useRecargarAlVolver(cargar);

  // "Anotar un recordatorio" desde la ficha de un producto o de un cliente.
  useEffect(() => {
    const articulo = params.get('articulo');
    const cliente = params.get('cliente');
    if (!articulo && !cliente) return;
    setParams({}, { replace: true });
    (async () => {
      try {
        if (articulo) {
          const a = await window.api.articulos.get(articulo);
          if (!a) return;
          setPrecargado({
            clave: Date.now(),
            nombre: a.descripcion,
            inicial: {
              ...FORMULARIO_VACIO,
              tipo: a.stock <= a.stockMinimo ? 'reponer' : 'cambiar',
              texto: a.stock <= a.stockMinimo ? `Reponer ${a.descripcion}` : '',
              articuloId: a.id,
            },
          });
        } else if (cliente) {
          const c = (await window.api.clientes.list()).find((x) => x.id === cliente);
          if (!c) return;
          setPrecargado({
            clave: Date.now(),
            nombre: c.nombre,
            inicial: {
              ...FORMULARIO_VACIO,
              tipo: 'cobrar',
              texto: c.saldo > 0 ? `Cobrarle a ${c.nombre} (debe ${formatearMoneda(c.saldo)})` : '',
              clienteId: c.id,
            },
          });
        }
      } catch {
        // Sin eso elegido, se puede anotar igual desde cero.
      }
    })();
  }, [params, setParams]);

  async function agregar(input: RecordatorioInput) {
    await window.api.recordatorios.crear(input);
    setCartel('Recordatorio anotado: ya lo ven todas');
    setPrecargado(null);
    if (estado !== 'pendientes') setEstado('pendientes');
    else cargar();
  }

  async function guardarEdicion(id: string, input: RecordatorioInput) {
    await window.api.recordatorios.actualizar(id, input);
    setEditandoId(null);
    cargar();
  }

  async function marcar(r: Recordatorio, hecho: boolean) {
    // Se muestra el cambio ya, sin esperar la respuesta.
    setItems((lista) => (lista ? lista.filter((x) => x.id !== r.id) : lista));
    try {
      await window.api.recordatorios.marcarHecho(r.id, hecho);
      if (hecho) setCartel('¡Hecho!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar');
    }
    cargar();
  }

  async function borrar(r: Recordatorio) {
    if (!confirm(`¿Borrar este recordatorio?\n\n"${r.texto}"`)) return;
    try {
      await window.api.recordatorios.eliminar(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar');
    }
    cargar();
  }

  // Lleva directo a donde se hace lo que dice el recordatorio.
  function ir(r: Recordatorio, destino: 'stock' | 'editar' | 'cuenta' | 'pago') {
    const comun = `recordatorio=${r.id}`;
    if (r.articuloId) navigate(`/articulos?abrir=${r.articuloId}&accion=${destino}&${comun}`);
    else if (r.clienteId) navigate(`/clientes?abrir=${r.clienteId}&accion=${destino}&${comun}`);
  }

  const miId = sesion?.id ?? null;
  const esAdmin = sesion?.rol === 'admin';

  return (
    <div className="mx-auto max-w-3xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
          Recordatorios
          <BotonAyuda seccion="Recordatorios" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Lo que hay que hacer o cambiar, anotado acá para que todas estemos al tanto.
        </p>
      </div>

      <div data-tour="rec-nuevo" className="card p-5">
        <FormularioRecordatorio
          key={precargado?.clave ?? 0}
          inicial={precargado?.inicial ?? FORMULARIO_VACIO}
          nombreInicial={precargado?.nombre ?? null}
          textoBoton="Anotar"
          placeholder="Ej.: Cambiar el precio de las gaseosas · Hay que reponer los alfajores · Llamar al proveedor"
          onGuardar={agregar}
          limpiarAlGuardar
        />
      </div>

      <div className="mt-6 flex items-center gap-2" data-tour="rec-lista">
        <button
          className={`btn ${estado === 'pendientes' ? 'bg-brand-600 text-white' : 'btn-secondary'}`}
          onClick={() => setEstado('pendientes')}
        >
          Pendientes{cuantosPendientes !== null ? ` (${cuantosPendientes})` : ''}
        </button>
        <button
          className={`btn ${estado === 'hechos' ? 'bg-brand-600 text-white' : 'btn-secondary'}`}
          onClick={() => setEstado('hechos')}
        >
          Hechos
        </button>
        <button className="btn-secondary ml-auto" onClick={cargar} title="Actualizar">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-2.5">
        {items === null ? (
          <div className="card flex items-center justify-center p-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="font-medium text-slate-700">
              {estado === 'pendientes' ? '¡Todo al día! No hay nada pendiente.' : 'Todavía no se marcó nada como hecho.'}
            </p>
            {estado === 'pendientes' && (
              <p className="text-sm text-slate-400">Cuando haya algo para hacer o cambiar, anotalo arriba.</p>
            )}
          </div>
        ) : (
          items.map((r) =>
            editandoId === r.id ? (
              <div key={r.id} className="card p-5">
                <FormularioRecordatorio
                  inicial={{
                    texto: r.texto,
                    tipo: r.tipo,
                    urgente: r.urgente,
                    paraFecha: r.paraFecha,
                    articuloId: r.articuloId,
                    clienteId: r.clienteId,
                  }}
                  nombreInicial={r.vinculoNombre}
                  textoBoton="Guardar cambios"
                  onGuardar={(input) => guardarEdicion(r.id, input)}
                  onCancelar={() => setEditandoId(null)}
                />
              </div>
            ) : (
              <FilaRecordatorio
                key={r.id}
                r={r}
                puedeBorrar={esAdmin || r.creadoPorId === miId}
                onMarcar={(hecho) => marcar(r, hecho)}
                onEditar={() => setEditandoId(r.id)}
                onBorrar={() => borrar(r)}
                onIr={(destino) => ir(r, destino)}
              />
            )
          )
        )}
      </div>

      {cartel && <CartelExito mensaje={cartel} onCerrar={() => setCartel(null)} />}
    </div>
  );
}

function FilaRecordatorio({
  r,
  puedeBorrar,
  onMarcar,
  onEditar,
  onBorrar,
  onIr,
}: {
  r: Recordatorio;
  puedeBorrar: boolean;
  onMarcar: (hecho: boolean) => void;
  onEditar: () => void;
  onBorrar: () => void;
  onIr: (destino: 'stock' | 'editar' | 'cuenta' | 'pago') => void;
}) {
  const tipo = datosDeTipo(r.tipo);
  const Icono = tipo.icono;
  const fecha = r.paraFecha ? etiquetaFecha(r.paraFecha, r.hecho) : null;
  const esProducto = !!r.articuloId;
  const tieneVinculo = esProducto || !!r.clienteId;
  return (
    <div
      className={`card flex items-start gap-3 p-4 ${
        !r.hecho && r.urgente ? 'border-red-200 bg-red-50/40' : ''
      }`}
    >
      <button
        onClick={() => onMarcar(!r.hecho)}
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          r.hecho
            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
            : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500'
        }`}
        title={r.hecho ? 'Volver a ponerlo como pendiente' : 'Marcar como hecho'}
        aria-label={r.hecho ? 'Volver a pendiente' : 'Marcar como hecho'}
      >
        {r.hecho ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`break-words text-[15px] ${r.hecho ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {r.texto}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tipo.chip}`}>
            <Icono className="h-3 w-3" />
            {tipo.etiqueta}
          </span>
          {!r.hecho && r.urgente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
              <Flame className="h-3 w-3" />
              Urgente
            </span>
          )}
          {fecha && <span className={fecha.clase}>{fecha.texto}</span>}
          <span className="text-slate-400">
            {r.hecho
              ? `Lo hizo ${r.hechoPorNombre ?? 'alguien'} ${haceTiempo(r.hechoEn)}`
              : `Lo anotó ${r.creadoPorNombre ?? 'alguien'} ${haceTiempo(r.creadoEn)}`}
          </span>
        </div>

        {tieneVinculo && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {esProducto ? <Package className="h-3.5 w-3.5 shrink-0" /> : <Contact className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{r.vinculoNombre ?? (esProducto ? 'Producto' : 'Cliente')}</span>
              {!r.vinculoExiste && <span className="text-red-500">(ya no está)</span>}
            </span>
            {!r.hecho && r.vinculoExiste && (
              <>
                {esProducto ? (
                  <>
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onIr('stock')}>
                      <PackagePlus className="h-3.5 w-3.5" />
                      Ajustar stock
                    </button>
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onIr('editar')}>
                      <Pencil className="h-3.5 w-3.5" />
                      Editar producto
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onIr('pago')}>
                      <HandCoins className="h-3.5 w-3.5" />
                      Registrar pago
                    </button>
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onIr('cuenta')}>
                      <Contact className="h-3.5 w-3.5" />
                      Ver cuenta
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!r.hecho && (
          <button
            onClick={onEditar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {puedeBorrar && (
          <button
            onClick={onBorrar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            title="Borrar"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function FormularioRecordatorio({
  inicial,
  nombreInicial,
  textoBoton,
  placeholder,
  onGuardar,
  onCancelar,
  limpiarAlGuardar,
}: {
  inicial: RecordatorioInput;
  nombreInicial: string | null;
  textoBoton: string;
  placeholder?: string;
  onGuardar: (input: RecordatorioInput) => Promise<void>;
  onCancelar?: () => void;
  limpiarAlGuardar?: boolean;
}) {
  const [texto, setTexto] = useState(inicial.texto);
  const [tipo, setTipo] = useState<TipoRecordatorio>(inicial.tipo);
  const [urgente, setUrgente] = useState(inicial.urgente);
  const [paraFecha, setParaFecha] = useState(inicial.paraFecha ?? '');
  const [vinculo, setVinculo] = useState<Vinculo>({
    articuloId: inicial.articuloId ?? null,
    clienteId: inicial.clienteId ?? null,
    nombre: nombreInicial,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) {
      setError('Escribí qué hay que hacer o cambiar.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onGuardar({
        texto,
        tipo,
        urgente,
        paraFecha: paraFecha || null,
        articuloId: vinculo.articuloId,
        clienteId: vinculo.clienteId,
      });
      if (limpiarAlGuardar) {
        setTexto('');
        setTipo('hacer');
        setUrgente(false);
        setParaFecha('');
        setVinculo({ articuloId: null, clienteId: null, nombre: null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  const hoy = hoyYMD();
  const manana = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label className="label" htmlFor="rec-texto">
          ¿Qué hay que hacer o cambiar?
        </label>
        <input
          id="rec-texto"
          className="input"
          value={texto}
          maxLength={300}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
        />
      </div>

      <SelectorDeVinculo
        vinculo={vinculo}
        onCambiar={(v) => {
          setVinculo(v);
          // Elegir un producto o un cliente sugiere para qué es (se puede cambiar).
          if (v.articuloId && tipo === 'hacer') setTipo('cambiar');
          if (v.clienteId && tipo === 'hacer') setTipo('cobrar');
        }}
      />

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <p className="label">Es para</p>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS.map((t) => {
              const Icono = t.icono;
              const activo = tipo === t.valor;
              return (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => setTipo(t.valor)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activo ? t.activo : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Icono className="h-3.5 w-3.5" />
                  {t.etiqueta}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label">Para el día (si corre apuro)</p>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className="input !w-auto"
              value={paraFecha}
              min={hoy}
              onChange={(e) => setParaFecha(e.target.value)}
            />
            <button
              type="button"
              className={`btn-secondary !px-2.5 !py-1.5 text-xs ${paraFecha === hoy ? '!border-brand-500 !bg-brand-50' : ''}`}
              onClick={() => setParaFecha(hoy)}
            >
              Hoy
            </button>
            <button
              type="button"
              className={`btn-secondary !px-2.5 !py-1.5 text-xs ${paraFecha === manana ? '!border-brand-500 !bg-brand-50' : ''}`}
              onClick={() => setParaFecha(manana)}
            >
              Mañana
            </button>
            {paraFecha && (
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                title="Sin fecha"
                onClick={() => setParaFecha('')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
          <span className="inline-flex items-center gap-1">
            <Flame className="h-4 w-4 text-red-500" />
            Urgente
          </span>
        </label>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancelar && (
          <button type="button" className="btn-secondary" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : limpiarAlGuardar ? <Plus className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
          {textoBoton}
        </button>
      </div>
    </form>
  );
}

// "Relacionado con": un producto o un cliente (opcional). Con eso elegido, el
// recordatorio tiene botones que llevan directo a ajustar el stock, editar el
// producto, ver la cuenta o registrar un pago.
function SelectorDeVinculo({ vinculo, onCambiar }: { vinculo: Vinculo; onCambiar: (v: Vinculo) => void }) {
  const [modo, setModo] = useState<'producto' | 'cliente' | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Array<{ id: string; titulo: string; detalle: string }>>([]);
  const [buscando, setBuscando] = useState(false);
  const clientesRef = useRef<Array<{ id: string; nombre: string; saldo: number }> | null>(null);

  useEffect(() => {
    if (!modo) return;
    let vigente = true;
    const texto = busqueda.trim();
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        if (modo === 'producto') {
          if (texto.length < 2) {
            if (vigente) setResultados([]);
          } else {
            const lista = await window.api.articulos.list({ busqueda: texto });
            if (vigente) {
              setResultados(
                lista.slice(0, 8).map((a) => ({
                  id: a.id,
                  titulo: a.descripcion,
                  detalle: `Stock: ${a.stock}`,
                }))
              );
            }
          }
        } else {
          if (!clientesRef.current) clientesRef.current = await window.api.clientes.list();
          const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          const buscado = norm(texto);
          const filtrados = clientesRef.current.filter((c) => !buscado || norm(c.nombre).includes(buscado));
          if (vigente) {
            setResultados(
              filtrados.slice(0, 8).map((c) => ({
                id: c.id,
                titulo: c.nombre,
                detalle: c.saldo > 0 ? `Debe ${formatearMoneda(c.saldo)}` : 'Sin deuda',
              }))
            );
          }
        }
      } catch {
        if (vigente) setResultados([]);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [modo, busqueda]);

  const elegido = vinculo.articuloId || vinculo.clienteId;

  if (elegido) {
    const esProducto = !!vinculo.articuloId;
    return (
      <div>
        <p className="label">Relacionado con</p>
        <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
          {esProducto ? <Package className="h-4 w-4 shrink-0 text-sky-500" /> : <Contact className="h-4 w-4 shrink-0 text-amber-500" />}
          <span className="truncate">{vinculo.nombre ?? (esProducto ? 'Producto' : 'Cliente')}</span>
          <button
            type="button"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200"
            title="Quitar"
            onClick={() => onCambiar({ articuloId: null, clienteId: null, nombre: null })}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
        <p className="mt-1 text-xs text-slate-400">
          {esProducto
            ? 'En la lista va a tener botones para ajustar su stock o editarlo directo.'
            : 'En la lista va a tener botones para ver su cuenta o registrarle un pago directo.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="label">Relacionado con (si es sobre un producto o un cliente)</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setModo(modo === 'producto' ? null : 'producto');
            setBusqueda('');
            setResultados([]);
          }}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            modo === 'producto' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Un producto
        </button>
        <button
          type="button"
          onClick={() => {
            setModo(modo === 'cliente' ? null : 'cliente');
            setBusqueda('');
            setResultados([]);
          }}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            modo === 'cliente' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Contact className="h-3.5 w-3.5" />
          Un cliente
        </button>
      </div>

      {modo && (
        <div className="mt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input !pl-9"
              autoFocus
              placeholder={modo === 'producto' ? 'Buscá el producto por nombre o código...' : 'Buscá el cliente por nombre...'}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                // Enter acá no tiene que anotar el recordatorio.
                if (e.key === 'Enter') e.preventDefault();
              }}
            />
          </div>
          {buscando ? (
            <p className="mt-1.5 flex items-center gap-2 px-1 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Buscando...
            </p>
          ) : resultados.length > 0 ? (
            <ul className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      onCambiar(
                        modo === 'producto'
                          ? { articuloId: r.id, clienteId: null, nombre: r.titulo }
                          : { articuloId: null, clienteId: r.id, nombre: r.titulo }
                      );
                      setModo(null);
                      setBusqueda('');
                    }}
                  >
                    <span className="truncate text-slate-700">{r.titulo}</span>
                    <span className="shrink-0 text-xs text-slate-400">{r.detalle}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            (modo === 'cliente' || busqueda.trim().length >= 2) && (
              <p className="mt-1.5 px-1 text-xs text-slate-400">No encontré nada con eso.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
