import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import QRCode from 'qrcode';
import {
  UserPlus,
  X,
  Wallet,
  Clock,
  Trash2,
  Search,
  StickyNote,
  CheckCircle2,
  Circle,
  BellRing,
  QrCode,
  Download,
  Loader2,
  Phone,
  Pencil,
  NotebookPen,
} from 'lucide-react';
import type { Cliente, EstadoCuenta, MetodoPago, MovimientoCuenta, Venta } from '@shared/types';
import {
  formatearCantidad,
  formatearMoneda,
  formatearMonedaConCentavos,
  nombreArchivoEstadoCuenta,
  parsearMonto,
} from '@shared/formato';
import { aclaracionesDeLinea, compararAntiguedad } from '@shared/cuentaCorriente';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';
import EditorDeProductos, { filaNueva, resumenDeFilas, type FilaProducto } from './EditorDeProductos';
import { useRecargarAlVolver } from '../../hooks/useRecargarAlVolver';

// Pone en mayúscula sólo la primera letra — a diferencia de la clase CSS
// "capitalize" de Tailwind, que le pone mayúscula a CADA palabra y deja
// textos como "Viernes 10 De Septiembre" (mal, la "de" no va en mayúscula).
function capitalizarPrimera(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Fecha y hora legibles con el día de la semana incluido (ej. "Viernes 26 de
// septiembre, 14:30") — se usa en todos lados donde se muestra cuándo se
// hizo un fiado, pago o ajuste.
function formatearFechaHora(fechaISO: string): string {
  return capitalizarPrimera(format(new Date(fechaISO), "EEEE d 'de' MMMM, HH:mm", { locale: es }));
}

// Misma idea pero compacta, para tablas angostas (día abreviado en vez de
// completo) — igual muestra qué día de la semana fue, no sólo el número.
function formatearFechaHoraCorta(fechaISO: string): string {
  return capitalizarPrimera(format(new Date(fechaISO), 'EEE d/MM, HH:mm', { locale: es }));
}

// Valor por defecto de un <input type="datetime-local"> para "ahora", en
// hora local (no UTC) y sin segundos, que es el formato que ese input espera.
function ahoraParaInputLocal(): string {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  return ahora.toISOString().slice(0, 16);
}


// Con qué puede pagar un fiado — "fiado" queda afuera, no tendría sentido
// pagar una deuda anotándola como otra deuda.
const METODOS_PAGO_CUENTA: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
];

const ETIQUETA_METODO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  fiado: 'Fiado',
};

const MS_DIA = 86_400_000;

// Hace cuántos días debe (desde lo más viejo que sigue sin cubrirse): null si no debe.
function diasDeDeuda(c: Cliente): number | null {
  if (!c.deudaDesde || c.saldo <= 0) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(c.deudaDesde).getTime()) / MS_DIA));
}

function textoDeDeuda(dias: number): string {
  if (dias === 0) return 'debe desde hoy';
  if (dias === 1) return 'debe desde ayer';
  return `debe hace ${dias} días`;
}

// Cuanto más vieja la deuda, más llamativo el color.
function claseDeDeuda(dias: number): string {
  if (dias >= 90) return 'font-medium text-red-600';
  if (dias >= 60) return 'font-medium text-orange-600';
  if (dias >= 30) return 'text-amber-600';
  return 'text-slate-400';
}

const soloDigitos = (t: string) => t.replace(/\D/g, '');

// Lo que le debe o tiene a favor un cliente, dicho como corresponde (un saldo negativo es
// plata a favor: pagó de más).
function textoDeSaldo(saldo: number): string {
  return saldo < 0 ? `Tiene ${formatearMoneda(-saldo)} a favor` : `Debe ${formatearMoneda(saldo)}`;
}

// Cómo está un fiado de la lista de últimos fiados: cubierto del todo (por un pago o
// marcado como pagado a mano), cubierto en parte, o sin pagar.
function estadoDeFiado(v: Venta): { cubierto: boolean; parcial: boolean; resta: number } {
  const resta = v.resta ?? v.total;
  const cubierto = v.pagado || resta <= 0.005;
  return { cubierto, parcial: !cubierto && resta < v.total - 0.005, resta };
}

// Una deuda (un fiado o algo anotado a mano) que ya está cubierta: por los pagos del cliente
// o porque se marcó como pagada.
function estaCubierto(m: MovimientoCuenta): boolean {
  return m.tipo !== 'pago' && (m.pagado === true || (m.resta !== null && m.resta <= 0.005));
}

// Qué productos son: debajo del detalle de cada deuda (cuando se sabe).
function DetalleDeMovimiento({ m }: { m: MovimientoCuenta }) {
  if (m.tipo === 'pago') return null;
  const lineas = aclaracionesDeLinea({ descripcion: m.descripcion, items: m.items ?? undefined });
  if (lineas.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 text-xs font-normal text-slate-400">
      {lineas.map((t, n) => (
        <li key={n}>{t}</li>
      ))}
    </ul>
  );
}

// El estado de una deuda en la cuenta: pagada, en parte, o pendiente. Lo que se pagó se
// descuenta de lo más viejo primero, así que esto sale solo de los pagos. Tocar una pendiente
// abre el pago; una marcada como pagada a mano (como se hacía antes) se puede volver a dejar
// pendiente.
function EstadoDeLinea({
  m,
  onCobrar,
  onDesmarcar,
}: {
  m: MovimientoCuenta;
  onCobrar: (m: MovimientoCuenta) => void;
  onDesmarcar: (m: MovimientoCuenta) => void;
}) {
  const base = 'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors';
  if (m.tipo === 'venta' && m.pagado) {
    return (
      <button
        onClick={() => onDesmarcar(m)}
        title="Estaba marcado como pagado a mano: tocá para volver a dejarlo pendiente"
        className={`${base} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Pagado
      </button>
    );
  }
  if (m.tipo === 'pago' || m.resta === null) return <span />;
  if (m.resta <= 0.005) {
    return (
      <span title="Los pagos de este cliente ya cubren esto" className={`${base} bg-emerald-50 text-emerald-700`}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Pagado
      </span>
    );
  }
  const enParte = m.resta < m.monto - 0.005;
  return (
    <button
      onClick={() => onCobrar(m)}
      title="Registrar un pago"
      className={`${base} bg-amber-50 text-amber-700 hover:bg-amber-100`}
    >
      <Circle className="h-3.5 w-3.5" />
      {enParte ? `Resta ${formatearMoneda(m.resta)}` : 'Pendiente'}
    </button>
  );
}

/** Lo que el cuadro de pago trae ya escrito cuando se llega desde una deuda puntual. */
interface SugerenciaDePago {
  monto: number;
  nota: string | null;
  aviso: string | null;
}

// Para que buscar "jose" encuentre a "José" sin importar tildes. Se evita
// escribir el rango Unicode de diacríticos como literal en el código (da
// problemas de encoding en algunos editores) armándolo a partir de sus
// códigos numéricos.
const RANGO_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(RANGO_DIACRITICOS, '');
}

export default function ClientesPage() {
  const { esAdmin } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [clienteAbierto, setClienteAbierto] = useState<Cliente | null>(null);
  // De quién se muestra el estado de cuenta (el código QR para descargarlo y mandarlo).
  const [estadoDe, setEstadoDe] = useState<Pick<Cliente, 'id' | 'nombre'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Si se llegó desde un recordatorio ("cobrarle a tal cliente"), se abre
  // directo su cuenta (o el pago), y al terminar se pregunta si ya está hecho.
  const [params, setParams] = useSearchParams();
  const [abrirPago, setAbrirPago] = useState(false);
  const pendienteAbrir = useRef<{ id: string; accion: string | null; recordatorio: string | null } | null>(null);
  const recordatorioPendiente = useRef<string | null>(null);
  const [ultimosFiados, setUltimosFiados] = useState<Venta[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  // Sólo los que deben hace tanto o más (0 = todos) y en qué orden se muestran.
  const [antiguedadMin, setAntiguedadMin] = useState(0);
  const [orden, setOrden] = useState<'saldo' | 'antigua' | 'nombre'>('saldo');

  // Con "silencioso" no muestra "Cargando..." (para refrescar al volver a la pantalla).
  function cargar(silencioso = false) {
    if (!silencioso) setCargando(true);
    window.api.clientes
      .list()
      .then(setClientes)
      .catch((err) => {
        if (!silencioso) setError(err.message);
      })
      .finally(() => setCargando(false));
    window.api.ventas.ultimosFiados(10).then(setUltimosFiados).catch(() => {});
  }

  useEffect(() => cargar(), []);
  useRecargarAlVolver(() => cargar(true));

  useEffect(() => {
    const id = params.get('abrir');
    if (!id) return;
    pendienteAbrir.current = { id, accion: params.get('accion'), recordatorio: params.get('recordatorio') };
    setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    const p = pendienteAbrir.current;
    if (!p || cargando) return;
    pendienteAbrir.current = null;
    const c = clientes.find((x) => x.id === p.id);
    if (!c) {
      setError('Ese cliente ya no está en la lista.');
      return;
    }
    recordatorioPendiente.current = p.recordatorio;
    setAbrirPago(p.accion === 'pago');
    setClienteAbierto(c);
  }, [clientes, cargando]);

  useEffect(() => {
    setClienteAbierto((abierto) => {
      if (!abierto) return abierto;
      const nuevo = clientes.find((c) => c.id === abierto.id);
      return nuevo && nuevo !== abierto ? nuevo : abierto;
    });
  }, [clientes]);

  function preguntarSiYaEsta() {
    const id = recordatorioPendiente.current;
    if (!id) return;
    recordatorioPendiente.current = null;
    if (confirm('¿Ya está? ¿Marcar el recordatorio como hecho?')) {
      window.api.recordatorios.marcarHecho(id, true).catch(() => {});
    }
  }

  const totalDeuda = clientes.reduce((acc, c) => acc + Math.max(c.saldo, 0), 0);
  const cantidadConDeuda = clientes.filter((c) => c.saldo > 0).length;

  const clientesFiltrados = useMemo(() => {
    const texto = normalizar(busqueda.trim());
    const digitos = soloDigitos(busqueda);
    const filtrados = clientes.filter((c) => {
      if (soloConDeuda && c.saldo <= 0) return false;
      if (antiguedadMin > 0) {
        const dias = diasDeDeuda(c);
        if (dias === null || dias < antiguedadMin) return false;
      }
      if (texto) {
        const porNombre = normalizar(c.nombre).includes(texto);
        // También por teléfono (con 3 números o más, sin importar espacios ni guiones).
        const porTelefono = digitos.length >= 3 && soloDigitos(c.telefono ?? '').includes(digitos);
        if (!porNombre && !porTelefono) return false;
      }
      return true;
    });
    if (orden === 'nombre') return [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (orden === 'antigua') {
      // Los que deben desde hace más tiempo primero; los que no deben, al final.
      return [...filtrados].sort((a, b) => (diasDeDeuda(b) ?? -1) - (diasDeDeuda(a) ?? -1) || b.saldo - a.saldo);
    }
    return filtrados; // "Más deben primero": así viene de la base
  }, [clientes, busqueda, soloConDeuda, antiguedadMin, orden]);

  async function handleEliminar(c: Cliente) {
    const aviso =
      c.saldo > 0
        ? `\n\nOJO: todavía debe ${formatearMoneda(c.saldo)}. Si lo sacás de la lista, esa deuda deja de aparecer en el total y en los reportes.`
        : '';
    if (!confirm(`¿Sacar a "${c.nombre}" de la lista de clientes? Su historial de fiados y pagos queda guardado.${aviso}`))
      return;
    try {
      await window.api.clientes.setActivo(c.id, false);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar el cliente');
    }
  }

  function abrirCuentaDe(v: Venta) {
    const cliente = v.clienteId ? clientes.find((c) => c.id === v.clienteId) : undefined;
    if (cliente) setClienteAbierto(cliente);
  }

  return (
    <div className="mx-auto max-w-4xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            Clientes
            <BotonAyuda seccion="Clientes (fiado)" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Cuenta corriente de los que compran fiado.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="card flex items-center gap-3 px-4 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Deuda total{cantidadConDeuda > 0 && ` · ${cantidadConDeuda} cliente${cantidadConDeuda > 1 ? 's' : ''}`}</p>
              <p className="font-semibold text-slate-800">{formatearMoneda(totalDeuda)}</p>
            </div>
          </div>
          <button data-tour="cli-nuevo" className="btn-primary" onClick={() => setMostrarNuevo(true)}>
            <UserPlus className="h-4 w-4" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div data-tour="cli-buscar" className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar cliente por nombre..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={soloConDeuda}
            onChange={(e) => setSoloConDeuda(e.target.checked)}
          />
          Solo con deuda
        </label>
        <select
          className="input w-auto"
          value={orden}
          onChange={(e) => setOrden(e.target.value as 'saldo' | 'antigua' | 'nombre')}
          title="Cómo se ordena la lista"
        >
          <option value="saldo">Más deben primero</option>
          <option value="antigua">Deuda más vieja primero</option>
          <option value="nombre">Por nombre</option>
        </select>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Debe hace:</span>
          {[0, 30, 60, 90].map((n) => (
            <button
              key={n}
              onClick={() => setAntiguedadMin(n)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                antiguedadMin === n ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {n === 0 ? 'Todos' : `+${n} días`}
            </button>
          ))}
        </div>
      </div>

      {ultimosFiados.length > 0 && (
        <div data-tour="cli-ultimos-fiados" className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-slate-200 px-4 py-3 sm:px-5">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Últimos fiados</h2>
            <p className="basis-full text-xs text-slate-400 sm:basis-auto">
              Para que se vea quién anotó qué, sin entrar cliente por cliente.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {ultimosFiados.map((v) => (
              <div
                key={v.id}
                className={`flex w-full items-center justify-between px-4 py-2.5 transition-colors sm:px-5 ${estadoDeFiado(v).cubierto ? 'opacity-60' : ''}`}
              >
                <button onClick={() => abrirCuentaDe(v)} className="min-w-0 flex-1 text-left hover:opacity-80">
                  <p className="truncate text-sm text-slate-800">
                    <span className="font-medium">{v.clienteNombre ?? 'Cliente eliminado'}</span>
                    <span className="text-slate-400"> · {formatearCantidad(v.cantidad)} x {v.articuloDescripcion}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatearFechaHora(v.fecha)} · anotó{' '}
                    <span className="font-medium text-slate-500">{v.usuarioNombre ?? '—'}</span>
                  </p>
                </button>
                {(() => {
                  const e = estadoDeFiado(v);
                  return (
                    <button
                      onClick={() => abrirCuentaDe(v)}
                      title={e.cubierto ? 'Ya está pago' : 'Ver la cuenta y registrar el pago'}
                      className={`ml-3 flex shrink-0 flex-col items-end rounded-lg px-2 py-0.5 text-sm font-semibold transition-colors ${
                        e.cubierto ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {e.cubierto ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                        <span className={e.cubierto ? 'line-through' : ''}>
                          {formatearMoneda(e.parcial ? e.resta : v.total)}
                        </span>
                      </span>
                      {e.parcial && (
                        <span className="text-[11px] font-normal text-slate-400">de {formatearMoneda(v.total)}</span>
                      )}
                    </button>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      <div data-tour="cli-tabla" className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Último fiado</th>
              <th className="px-4 py-3 font-medium">Debe</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!cargando && clientes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Todavía no cargaste ningún cliente.
                </td>
              </tr>
            )}
            {!cargando && clientes.length > 0 && clientesFiltrados.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Ningún cliente coincide con la búsqueda.
                </td>
              </tr>
            )}
            {!cargando &&
              clientesFiltrados.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                  onClick={() => setClienteAbierto(c)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {c.nombre}
                      {c.nota && (
                        <span title={c.nota}>
                          <StickyNote className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                        </span>
                      )}
                    </span>
                    {c.telefono && <span className="block text-xs font-normal text-slate-400">{c.telefono}</span>}
                    {c.ultimoFiado && (
                      <span className="block text-xs font-normal text-slate-400 sm:hidden">
                        Último fiado: {new Date(c.ultimoFiado).toLocaleDateString('es-AR')}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">
                    {c.ultimoFiado ? new Date(c.ultimoFiado).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        c.saldo > 0
                          ? 'bg-amber-100 text-amber-700'
                          : c.saldo < 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {c.saldo < 0 ? `A favor ${formatearMoneda(-c.saldo)}` : formatearMoneda(c.saldo)}
                    </span>
                    {(() => {
                      const dias = diasDeDeuda(c);
                      return dias === null ? null : (
                        <span className={`mt-1 block text-xs ${claseDeDeuda(dias)}`}>{textoDeDeuda(dias)}</span>
                      );
                    })()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right">
                    <button
                      data-tour="cli-estado"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEstadoDe(c);
                      }}
                      className="mr-1 rounded-lg bg-brand-50 p-2 text-brand-600 transition-colors hover:bg-brand-100 sm:p-1.5"
                      title="Estado de cuenta: código QR para descargar y mandarle lo que debe"
                    >
                      <QrCode className="h-4 w-4" />
                    </button>
                    {esAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEliminar(c);
                        }}
                        className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600 sm:p-1.5"
                        title="Sacar de la lista"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      </div>

      {mostrarNuevo && (
        <NuevoClienteModal
          clientesExistentes={clientes}
          onCerrar={() => setMostrarNuevo(false)}
          onCreado={() => {
            setMostrarNuevo(false);
            cargar();
          }}
        />
      )}

      {clienteAbierto && (
        <ClienteDetalleModal
          cliente={clienteAbierto}
          abrirPago={abrirPago}
          onEstadoCuenta={() => setEstadoDe(clienteAbierto)}
          onCerrar={() => {
            setClienteAbierto(null);
            setAbrirPago(false);
            recordatorioPendiente.current = null;
          }}
          onCambio={() => {
            cargar();
            preguntarSiYaEsta();
          }}
        />
      )}

      {estadoDe && <EstadoCuentaModal cliente={estadoDe} onCerrar={() => setEstadoDe(null)} />}
    </div>
  );
}

function NuevoClienteModal({
  clientesExistentes,
  onCerrar,
  onCreado,
}: {
  clientesExistentes: Cliente[];
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [deudaInicial, setDeudaInicial] = useState('');
  const [fechaDeuda, setFechaDeuda] = useState(ahoraParaInputLocal);
  // La deuda de entrada: un monto solo, o la lista de productos que debe.
  const [conProductos, setConProductos] = useState(false);
  const [filas, setFilas] = useState<FilaProducto[]>(() => [filaNueva()]);
  const [nota, setNota] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Aviso al toque si ya hay un cliente anotado con ese nombre — el backend
  // no deja crear dos con el mismo nombre, así que mejor decirlo antes de
  // que llene todo el formulario y se entere recién al querer guardar.
  const nombreDuplicado = useMemo(() => {
    const texto = normalizar(nombre.trim());
    if (!texto) return false;
    return clientesExistentes.some((c) => normalizar(c.nombre) === texto);
  }, [nombre, clientesExistentes]);

  // Se escribe como se escribe acá ("1.500" o "1500,50") — parsearMonto lo
  // interpreta, y el textito de abajo muestra el monto que se va a cargar
  // para poder revisarlo antes de guardar.
  const deudaParseada = parsearMonto(deudaInicial);
  const productos = resumenDeFilas(filas);
  const deudaNum = conProductos ? productos.total : Number.isFinite(deudaParseada) ? deudaParseada : 0;
  const deudaInvalida = !conProductos && deudaInicial.trim() !== '' && !Number.isFinite(deudaParseada);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) {
      setError('Ingresá el nombre del cliente');
      return;
    }
    if (deudaInvalida) {
      setError('El monto que debe no es un número válido');
      return;
    }
    if (conProductos && productos.incompletas > 0) {
      setError('Hay productos sin terminar de completar: poné el nombre, la cantidad y el precio, o sacalos.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      // La fecha sólo importa si hay algo que deber — con $0 no tiene
      // sentido mandarla (no se crea ningún ajuste en ese caso).
      const fechaISO = deudaNum > 0 && fechaDeuda ? new Date(fechaDeuda).toISOString() : undefined;
      await window.api.clientes.crear(
        {
          nombre: nombreLimpio,
          nota: nota.trim() || null,
          telefono: telefono.trim() || null,
        },
        deudaNum,
        fechaISO,
        conProductos && productos.items.length > 0 ? productos.items : undefined
      );
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el cliente');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div
        className={`flex max-h-[92dvh] w-full animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl ${
          conProductos ? 'max-w-xl' : 'max-w-sm'
        }`}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Nuevo cliente</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="label">Nombre y apellido</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
            {nombreDuplicado && (
              <p className="mt-1 text-xs text-amber-600">
                Ya tenés un cliente anotado con ese nombre. Si es otra persona, agregale algo para distinguirla (ej.
                un apellido o apodo).
              </p>
            )}
          </div>
          {conProductos ? (
            <div>
              <label className="label">Qué productos debe (opcional)</label>
              <EditorDeProductos filas={filas} onChange={setFilas} />
              <p className="mt-1 text-xs text-slate-400">
                Así en su estado de cuenta (el PDF) figura qué es lo que debe. No toca el stock.
              </p>
              <button
                type="button"
                className="mt-1 text-xs text-slate-500 underline hover:text-slate-700"
                onClick={() => setConProductos(false)}
              >
                Mejor poner sólo un monto
              </button>
            </div>
          ) : (
            <div>
              <label className="label">Debe (opcional)</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={deudaInicial}
                onChange={(e) => setDeudaInicial(e.target.value.replace(/[^0-9.,]/g, ''))}
              />
              <p className={`mt-1 text-xs ${deudaInvalida ? 'text-red-600' : 'text-slate-400'}`}>
                {deudaInvalida
                  ? 'Ese monto no es un número válido.'
                  : deudaNum > 0
                    ? `Se le va a cargar ${formatearMonedaConCentavos(deudaNum)} de entrada.`
                    : 'Si ya te debía plata de antes (por ejemplo, de un cuaderno), poné el monto acá.'}
              </p>
              <button
                type="button"
                className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                onClick={() => setConProductos(true)}
              >
                O anotá qué productos son
              </button>
            </div>
          )}
          {deudaNum > 0 && (
            <div>
              <label className="label">¿Desde cuándo debe?</label>
              <input
                type="datetime-local"
                className="input"
                value={fechaDeuda}
                onChange={(e) => setFechaDeuda(e.target.value)}
                max={ahoraParaInputLocal()}
              />
              <p className="mt-1 text-xs text-slate-400">
                {fechaDeuda ? capitalizarPrimera(format(new Date(fechaDeuda), "EEEE d 'de' MMMM", { locale: es })) : ''}
              </p>
            </div>
          )}
          <div>
            <label className="label">Teléfono (opcional)</label>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              placeholder="Ej: 11 5555-1234"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function ClienteDetalleModal({
  cliente,
  abrirPago,
  onEstadoCuenta,
  onCerrar,
  onCambio,
}: {
  cliente: Cliente;
  /** Abrir directo el cuadro para registrar un pago (viene de un recordatorio). */
  abrirPago?: boolean;
  /** Abrir el estado de cuenta (código QR para descargarlo y mandárselo). */
  onEstadoCuenta: () => void;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const navigate = useNavigate();
  const [movimientos, setMovimientos] = useState<MovimientoCuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarPago, setMostrarPago] = useState(abrirPago === true);
  const [sugerido, setSugerido] = useState<SugerenciaDePago | null>(null);
  const [mostrarDeuda, setMostrarDeuda] = useState(false);
  const [editando, setEditando] = useState(false);

  function cargar() {
    setCargando(true);
    window.api.clientes
      .historial(cliente.id)
      .then(setMovimientos)
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [cliente.id]);

  // No usamos cliente.saldo directo: es una foto de cuando se abrió el
  // modal. Lo recalculamos del historial recién cargado para que un pago
  // recién registrado se refleje al toque acá arriba, sin tener que cerrar
  // y volver a abrir. Un fiado ya marcado como pagado no suma — mismo
  // criterio que usa el saldo de la lista de clientes.
  const saldoActual = movimientos.reduce((acc, m) => {
    if (m.tipo === 'pago') return acc - m.monto;
    if (m.tipo === 'venta' && m.pagado) return acc;
    return acc + m.monto;
  }, 0);

  const ETIQUETA_TIPO: Record<MovimientoCuenta['tipo'], string> = {
    venta: 'este fiado',
    pago: 'este pago',
    ajuste: 'este ajuste',
  };

  async function eliminarMovimiento(m: MovimientoCuenta) {
    if (!confirm(`¿Borrar ${ETIQUETA_TIPO[m.tipo]}? Se saca de la cuenta y el saldo se recalcula solo.`)) return;
    try {
      await window.api.clientes.eliminarMovimiento(m.tipo, m.id);
      cargar();
      onCambio();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo borrar el movimiento');
    }
  }

  // Un fiado que estaba marcado como pagado a mano (así se hacía antes) se puede volver a
  // dejar pendiente. Ya no se marcan así: lo pagado se registra como pago, que suma a lo
  // cobrado y se descuenta de lo más viejo.
  async function desmarcarPagado(m: MovimientoCuenta) {
    if (!confirm('¿Volver a dejar este fiado como pendiente? Estaba marcado como pagado a mano.')) return;
    try {
      await window.api.ventas.marcarPagado(m.id, false);
      cargar();
      onCambio();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo actualizar el fiado');
    }
  }

  // Cobrar una deuda puntual: abre el pago con el monto que hace falta para cubrirla. Como
  // lo que se paga se descuenta de lo más viejo primero, incluye lo anterior que todavía se debe.
  function abrirCobro(m: MovimientoCuenta) {
    const pendientes = movimientos
      .filter((x) => x.tipo !== 'pago' && x.resta !== null && x.resta > 0.005)
      .sort(compararAntiguedad);
    const hasta = Math.max(0, pendientes.findIndex((x) => x.id === m.id));
    const previo = pendientes.slice(0, hasta).reduce((acc, x) => acc + (x.resta ?? 0), 0);
    const monto = Math.round((previo + (m.resta ?? 0)) * 100) / 100;
    setSugerido({
      monto,
      nota: `Pago de ${m.descripcion}`,
      aviso:
        previo > 0.005
          ? `Incluye ${formatearMoneda(previo)} de lo más viejo que todavía debe: lo que se paga se descuenta de lo más viejo primero.`
          : null,
    });
    setMostrarPago(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85dvh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-800">{cliente.nombre}</h2>
              <p className="text-sm text-slate-500">
                {saldoActual < 0 ? 'Saldo a favor:' : 'Debe:'}{' '}
                <span
                  className={
                    saldoActual > 0
                      ? 'font-semibold text-amber-600'
                      : saldoActual < 0
                        ? 'font-semibold text-emerald-600'
                        : 'font-semibold text-slate-500'
                  }
                >
                  {formatearMoneda(Math.abs(saldoActual))}
                </span>
              </p>
              {(() => {
                const dias = diasDeDeuda({ ...cliente, saldo: saldoActual });
                return dias === null ? null : (
                  <p className={`text-xs ${claseDeDeuda(dias)}`}>{textoDeDeuda(dias)}</p>
                );
              })()}
              {cliente.telefono && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <a href={`tel:${cliente.telefono.replace(/[^0-9+]/g, '')}`} className="hover:text-brand-600">
                    {cliente.telefono}
                  </a>
                </p>
              )}
              {cliente.nota && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-400">
                  <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {cliente.nota}
                </p>
              )}
            </div>
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 sm:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => navigate(`/recordatorios?cliente=${cliente.id}`)}
              title="Anotar un recordatorio sobre este cliente (por ejemplo, cobrarle)"
            >
              <BellRing className="h-4 w-4" />
              Recordatorio
            </button>
            <button
              className="btn-secondary"
              onClick={onEstadoCuenta}
              title="Código QR para descargar y mandarle lo que debe"
            >
              <QrCode className="h-4 w-4" />
              Estado de cuenta
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditando(true)}
              title="Cambiar el nombre, el teléfono o la nota"
            >
              <Pencil className="h-4 w-4" />
              Editar
            </button>
            <button
              className="btn-secondary"
              onClick={() => setMostrarDeuda(true)}
              title="Anotar una deuda a mano (por ejemplo, algo que estaba en el cuaderno)"
            >
              <NotebookPen className="h-4 w-4" />
              Anotar deuda
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setSugerido(null);
                setMostrarPago(true);
              }}
            >
              Registrar pago
            </button>
            <button onClick={onCerrar} className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 sm:block">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <p className="px-6 py-8 text-center text-slate-400">Cargando...</p>
          ) : movimientos.length === 0 ? (
            <p className="px-6 py-8 text-center text-slate-400">Todavía no hay movimientos.</p>
          ) : (
            <>
            {/* Celular: cada movimiento en su propia tarjeta. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {movimientos.map((m) => (
                <li key={`${m.tipo}-${m.id}`} className={`px-4 py-3 ${estaCubierto(m) ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm text-slate-800 ${estaCubierto(m) ? 'line-through' : ''}`}>
                        {m.descripcion}
                        {m.tipo === 'pago' && m.metodoPago && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            {ETIQUETA_METODO[m.metodoPago]}
                          </span>
                        )}
                      </p>
                      <DetalleDeMovimiento m={m} />
                      <p className="text-xs text-slate-400">
                        {formatearFechaHoraCorta(m.fecha)}
                        {m.usuarioNombre ? ` · ${m.usuarioNombre}` : ''}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-semibold ${estaCubierto(m) ? 'line-through' : ''} ${
                        m.tipo === 'pago' ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {m.tipo === 'pago' ? '−' : '+'}
                      {formatearMoneda(m.monto)}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <EstadoDeLinea m={m} onCobrar={abrirCobro} onDesmarcar={desmarcarPagado} />
                    <button
                      onClick={() => eliminarMovimiento(m)}
                      className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      title={`Borrar ${ETIQUETA_TIPO[m.tipo]}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Detalle</th>
                  <th className="px-4 py-2 font-medium">Quién</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movimientos.map((m) => (
                  <tr key={`${m.tipo}-${m.id}`} className={estaCubierto(m) ? 'opacity-60' : ''}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {formatearFechaHoraCorta(m.fecha)}
                    </td>
                    <td className={`px-4 py-2 text-slate-800 ${estaCubierto(m) ? 'line-through' : ''}`}>
                      {m.descripcion}
                      {m.tipo === 'pago' && m.metodoPago && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {ETIQUETA_METODO[m.metodoPago]}
                        </span>
                      )}
                      <DetalleDeMovimiento m={m} />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{m.usuarioNombre ?? '—'}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${estaCubierto(m) ? 'line-through' : ''} ${
                        m.tipo === 'pago' ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {m.tipo === 'pago' ? '−' : '+'}
                      {formatearMoneda(m.monto)}
                    </td>
                    <td className="px-4 py-2">
                      <EstadoDeLinea m={m} onCobrar={abrirCobro} onDesmarcar={desmarcarPagado} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => eliminarMovimiento(m)}
                        className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                        title={`Borrar ${ETIQUETA_TIPO[m.tipo]}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </div>
      </div>

      {mostrarDeuda && (
        <AnotarDeudaModal
          cliente={cliente}
          saldo={saldoActual}
          onCerrar={() => setMostrarDeuda(false)}
          onAnotada={() => {
            setMostrarDeuda(false);
            cargar();
            onCambio();
          }}
        />
      )}

      {editando && (
        <EditarClienteModal
          cliente={cliente}
          onCerrar={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            onCambio();
          }}
        />
      )}

      {mostrarPago && (
        <RegistrarPagoModal
          cliente={cliente}
          saldo={saldoActual}
          sugerido={sugerido}
          onCerrar={() => {
            setMostrarPago(false);
            setSugerido(null);
          }}
          onRegistrado={() => {
            setMostrarPago(false);
            setSugerido(null);
            cargar();
            onCambio();
          }}
        />
      )}
    </div>,
    document.body
  );
}

// El estado de cuenta de un cliente: un código QR que se escanea con el celular y baja
// un PDF con lo que debe (sin usuario ni contraseña), para compartirlo y mandárselo, y
// un botón para bajar ese mismo PDF desde acá. El enlace vale 30 días y siempre trae lo
// de ahora.
function EstadoCuentaModal({ cliente, onCerrar }: { cliente: Pick<Cliente, 'id' | 'nombre'>; onCerrar: () => void }) {
  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    let vigente = true;
    window.api.clientes
      .estado(cliente.id)
      .then((e) => vigente && setEstado(e))
      .catch((err) => vigente && setErrorEstado(err instanceof Error ? err.message : 'No se pudo cargar la cuenta'));
    window.api.clientes
      .enlaceEstado(cliente.id)
      .then(async (l) => {
        const imagen = await QRCode.toDataURL(l.url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
        if (vigente) setQr(imagen);
      })
      .catch((err) => vigente && setErrorEnlace(err instanceof Error ? err.message : 'No se pudo armar el enlace'));
    return () => {
      vigente = false;
    };
  }, [cliente.id]);

  async function descargarPdf() {
    setDescargando(true);
    setAviso(null);
    try {
      const base64 = await window.api.clientes.estadoPdf(cliente.id);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivoEstadoCuenta(cliente.nombre);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      setAviso({ tipo: 'ok', texto: 'Listo: se descargó el PDF.' });
    } catch (err) {
      setAviso({ tipo: 'error', texto: err instanceof Error ? err.message : 'No se pudo armar el PDF' });
    } finally {
      setDescargando(false);
    }
  }

  const debe = estado ? estado.saldo > 0 : false;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[92dvh] w-full max-w-md animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-800">Estado de cuenta</h2>
            <p className="truncate text-sm text-slate-500">{cliente.nombre}</p>
          </div>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {errorEstado ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorEstado}</p>
          ) : (
            <div
              className={`rounded-lg px-4 py-3 ${
                !estado ? 'bg-slate-50' : debe ? 'bg-amber-50' : 'bg-emerald-50'
              }`}
            >
              <p className="text-xs text-slate-500">
                {!estado ? 'Cargando...' : debe ? 'Debe' : estado.saldo < 0 ? 'Saldo a favor' : 'Estado'}
              </p>
              <p
                className={`text-2xl font-semibold ${
                  !estado ? 'text-slate-300' : debe ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {estado
                  ? debe || estado.saldo < 0
                    ? formatearMonedaConCentavos(Math.abs(estado.saldo))
                    : 'No debe nada'
                  : '—'}
              </p>
            </div>
          )}

          {estado && estado.pendientes.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Lo que tiene que pagar</p>
              <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {estado.pendientes.map((l, i) => {
                  const resta = l.resta ?? l.monto;
                  return (
                    <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-slate-700">{l.descripcion}</p>
                        {aclaracionesDeLinea(l).map((t, n) => (
                          <p key={n} className="text-xs text-slate-400">
                            {t}
                          </p>
                        ))}
                        <p className="text-xs text-slate-400">{new Date(l.fecha).toLocaleDateString('es-AR')}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-slate-800">{formatearMonedaConCentavos(resta)}</p>
                        {resta < l.monto - 0.005 && (
                          <p className="text-[11px] text-slate-400">de {formatearMonedaConCentavos(l.monto)}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-xs text-slate-400">
                Esto es lo que va a ver en el PDF.{' '}
                {estado.totalPagado > 0 &&
                  `Ya pagó ${formatearMonedaConCentavos(estado.totalPagado)}: se descontó de lo más viejo primero.`}
              </p>
            </div>
          )}

          <div className="text-center">
            {errorEnlace ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-700">
                {errorEnlace} Igual podés descargar el PDF con el botón de abajo.
              </p>
            ) : qr ? (
              <>
                <img src={qr} alt="Código QR del estado de cuenta" className="mx-auto rounded-lg border border-slate-200" />
                <p className="mt-2 text-sm text-slate-600">
                  Escaneá este código con el celular para <strong>descargar el estado de cuenta</strong> (PDF) y mandárselo
                  a {cliente.nombre.trim().split(/\s+/)[0]}.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  El enlace vale 30 días y siempre muestra lo que debe en ese momento. La primera vez puede tardar hasta 1
                  minuto en abrir (el servidor de internet descansa cuando no se usa).
                </p>
              </>
            ) : (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Armando el código...
              </p>
            )}
          </div>

          {aviso && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
              }`}
            >
              {aviso.texto}
            </p>
          )}

          <button className="btn-primary w-full justify-center" onClick={descargarPdf} disabled={descargando || !!errorEstado}>
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar PDF
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Anotar una deuda a mano: lo que ya debía de antes (el cuaderno) o algo que no pasó por la
// caja. Se anotan los productos (así el estado de cuenta dice qué es lo que debe) o, si no se
// sabe qué fue, sólo el monto. Se suma a lo que debe y queda anotado con su detalle y su fecha.
// No toca el stock: para lo que se lleva ahora, usar "Armar cuenta" con "Fiado".
function AnotarDeudaModal({
  cliente,
  saldo,
  onCerrar,
  onAnotada,
}: {
  cliente: Cliente;
  /** Lo que debe ahora (calculado del historial recién cargado). */
  saldo: number;
  onCerrar: () => void;
  onAnotada: () => void;
}) {
  const [conProductos, setConProductos] = useState(true);
  const [filas, setFilas] = useState<FilaProducto[]>(() => [filaNueva()]);
  const [monto, setMonto] = useState('');
  const [detalle, setDetalle] = useState('');
  const [fecha, setFecha] = useState(ahoraParaInputLocal);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const productos = resumenDeFilas(filas);
  const montoNum = conProductos ? productos.total : parsearMonto(monto);
  const montoValido = Number.isFinite(montoNum) && montoNum > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (conProductos && productos.incompletas > 0) {
      setError('Hay productos sin terminar de completar: poné el nombre, la cantidad y el precio, o sacalos.');
      return;
    }
    if (!montoValido) {
      setError(conProductos ? 'Agregá al menos un producto con su precio' : 'Ingresá un monto válido');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await window.api.clientes.anotarDeuda(
        cliente.id,
        montoNum,
        detalle.trim() || null,
        fecha ? new Date(fecha).toISOString() : undefined,
        conProductos ? productos.items : undefined
      );
      onAnotada();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anotar la deuda');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div
        className={`flex max-h-[92dvh] w-full animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl ${
          conProductos ? 'max-w-xl' : 'max-w-sm'
        }`}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Anotar deuda de {cliente.nombre}</h2>
          <p className="text-xs text-slate-400">Hoy: {textoDeSaldo(saldo).toLowerCase()}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {[
              { valor: true, texto: 'Con productos' },
              { valor: false, texto: 'Sólo un monto' },
            ].map((o) => (
              <button
                key={o.texto}
                type="button"
                onClick={() => setConProductos(o.valor)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  conProductos === o.valor ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {o.texto}
              </button>
            ))}
          </div>

          {conProductos ? (
            <div>
              <label className="label">Qué productos debe</label>
              <EditorDeProductos filas={filas} onChange={setFilas} />
            </div>
          ) : (
            <div>
              <label className="label">Monto que debe</label>
              <input
                className="input"
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ''))}
                autoFocus
              />
            </div>
          )}
          {montoNum > 0 && Number.isFinite(montoNum) && (
            <p className="-mt-2 text-xs text-slate-500">
              Se le suman {formatearMonedaConCentavos(montoNum)}:{' '}
              {saldo + montoNum >= 0
                ? `pasa a deber ${formatearMonedaConCentavos(saldo + montoNum)}`
                : `le quedan ${formatearMonedaConCentavos(-(saldo + montoNum))} a favor`}
            </p>
          )}
          {!conProductos && monto.trim() !== '' && !montoValido && (
            <p className="-mt-2 text-xs text-red-600">Ese monto no es un número válido.</p>
          )}

          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              maxLength={200}
              placeholder="Ej: del cuaderno de octubre"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
            />
          </div>
          <div>
            <label className="label">¿Desde cuándo lo debe?</label>
            <input
              type="datetime-local"
              className="input"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              max={ahoraParaInputLocal()}
            />
            <p className="mt-1 text-xs text-slate-400">
              {fecha ? capitalizarPrimera(format(new Date(fecha), "EEEE d 'de' MMMM", { locale: es })) : ''}
              {' · '}así se sabe hace cuánto debe.
            </p>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Anotar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// Cambiar el nombre, el teléfono o la nota de un cliente.
function EditarClienteModal({
  cliente,
  onCerrar,
  onGuardado,
}: {
  cliente: Cliente;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(cliente.nombre);
  const [telefono, setTelefono] = useState(cliente.telefono ?? '');
  const [nota, setNota] = useState(cliente.nota ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Ingresá el nombre del cliente');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await window.api.clientes.actualizar(cliente.id, {
        nombre: nombre.trim(),
        nota: nota.trim() || null,
        telefono: telefono.trim() || null,
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Datos del cliente</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label">Nombre y apellido</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Teléfono (opcional)</label>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              placeholder="Ej: 11 5555-1234"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function RegistrarPagoModal({
  cliente,
  saldo,
  sugerido,
  onCerrar,
  onRegistrado,
}: {
  cliente: Cliente;
  /** Lo que debe ahora — calculado del historial recién cargado, no el
   * cliente.saldo de la lista (ése es una foto de cuando se abrió la pantalla
   * y no incluía los pagos registrados desde entonces). */
  saldo: number;
  /** Si se llegó desde una deuda puntual: el monto y la nota que van ya escritos. */
  sugerido: SugerenciaDePago | null;
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const [monto, setMonto] = useState(() => (sugerido ? String(sugerido.monto).replace('.', ',') : ''));
  const [nota, setNota] = useState(sugerido?.nota ?? '');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Se escribe como se escribe acá: "1500", "1.500" o "1500,50". Antes este
  // cuadro borraba la coma y "1500,50" quedaba registrado como $150.050.
  const montoNum = parsearMonto(monto);
  const montoValido = Number.isFinite(montoNum) && montoNum > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const num = montoNum;
    if (!montoValido) {
      setError('Ingresá un monto válido');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await window.api.clientes.registrarPago(cliente.id, num, nota.trim() || null, metodoPago);
      onRegistrado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Registrar pago de {cliente.nombre}</h2>
          <p className="text-xs text-slate-400">{textoDeSaldo(saldo)}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="label !mb-0">Monto que paga</label>
              {saldo > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => setMonto(String(saldo).replace('.', ','))}
                >
                  Paga todo ({formatearMoneda(saldo)})
                </button>
              )}
            </div>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ''))}
              autoFocus
              required
            />
            {monto.trim() !== '' && (
              <p className={`mt-1 text-xs ${montoValido ? 'text-slate-500' : 'text-red-600'}`}>
                {montoValido
                  ? `Se registra un pago de ${formatearMonedaConCentavos(montoNum)}${
                      saldo > 0 && montoNum > saldo ? ' — es más de lo que debe, le queda saldo a favor' : ''
                    }`
                  : 'Ese monto no es un número válido.'}
              </p>
            )}
            {sugerido?.aviso && <p className="mt-1 text-xs text-amber-600">{sugerido.aviso}</p>}
            <p className="mt-1 text-xs text-slate-400">Lo que paga se descuenta de lo más viejo primero.</p>
          </div>
          <div>
            <label className="label">Con qué paga</label>
            <div className="grid grid-cols-3 gap-1.5">
              {METODOS_PAGO_CUENTA.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => setMetodoPago(m.valor)}
                  className={`rounded-lg border px-2 py-1.5 text-sm ${
                    metodoPago === m.valor
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              maxLength={200}
              placeholder="Ej: dejó una parte, el resto el viernes"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
