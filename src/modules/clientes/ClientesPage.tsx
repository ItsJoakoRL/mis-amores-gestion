import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { UserPlus, X, Wallet, Clock, Trash2, Search, StickyNote, CheckCircle2, Circle, BellRing } from 'lucide-react';
import type { Cliente, MetodoPago, MovimientoCuenta, Venta } from '@shared/types';
import { formatearCantidad, formatearMoneda, formatearMonedaConCentavos, parsearMonto } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';
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
    return clientes.filter((c) => {
      if (soloConDeuda && c.saldo <= 0) return false;
      if (texto && !normalizar(c.nombre).includes(texto)) return false;
      return true;
    });
  }, [clientes, busqueda, soloConDeuda]);

  async function handleEliminar(c: Cliente) {
    if (!confirm(`¿Sacar a "${c.nombre}" de la lista de clientes? Su historial de fiados y pagos queda guardado.`))
      return;
    try {
      await window.api.clientes.setActivo(c.id, false);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar el cliente');
    }
  }

  async function toggleFiadoPagado(v: Venta) {
    try {
      await window.api.ventas.marcarPagado(v.id, !v.pagado);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo actualizar el fiado');
    }
  }

  return (
    <div className="mx-auto max-w-4xl animate-slide-up p-8">
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
      </div>

      {ultimosFiados.length > 0 && (
        <div data-tour="cli-ultimos-fiados" className="card mb-6 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Últimos fiados</h2>
            <p className="text-xs text-slate-400">Para que se vea quién anotó qué, sin entrar cliente por cliente.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {ultimosFiados.map((v) => (
              <div
                key={v.id}
                className={`flex w-full items-center justify-between px-5 py-2.5 transition-colors ${v.pagado ? 'opacity-60' : ''}`}
              >
                <button
                  onClick={() => {
                    const cliente = v.clienteId ? clientes.find((c) => c.id === v.clienteId) : undefined;
                    if (cliente) setClienteAbierto(cliente);
                  }}
                  className="min-w-0 flex-1 text-left hover:opacity-80"
                >
                  <p className="truncate text-sm text-slate-800">
                    <span className="font-medium">{v.clienteNombre ?? 'Cliente eliminado'}</span>
                    <span className="text-slate-400"> · {formatearCantidad(v.cantidad)} x {v.articuloDescripcion}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatearFechaHora(v.fecha)} · anotó{' '}
                    <span className="font-medium text-slate-500">{v.usuarioNombre ?? '—'}</span>
                  </p>
                </button>
                <button
                  onClick={() => toggleFiadoPagado(v)}
                  title={v.pagado ? 'Marcar como no pagado' : 'Marcar como pagado'}
                  className={`ml-3 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold transition-colors ${
                    v.pagado
                      ? 'text-emerald-600 hover:bg-emerald-50'
                      : 'text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  {v.pagado ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                  <span className={v.pagado ? 'line-through' : ''}>{formatearMoneda(v.total)}</span>
                </button>
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
              <th className="px-4 py-3 font-medium">Último fiado</th>
              <th className="px-4 py-3 font-medium">Debe</th>
              {esAdmin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={esAdmin ? 4 : 3} className="px-4 py-10 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!cargando && clientes.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 4 : 3} className="px-4 py-10 text-center text-slate-400">
                  Todavía no cargaste ningún cliente.
                </td>
              </tr>
            )}
            {!cargando && clientes.length > 0 && clientesFiltrados.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 4 : 3} className="px-4 py-10 text-center text-slate-400">
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
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.ultimoFiado ? new Date(c.ultimoFiado).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        c.saldo > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatearMoneda(c.saldo)}
                    </span>
                  </td>
                  {esAdmin && (
                    <td className="px-2 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEliminar(c);
                        }}
                        className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Sacar de la lista"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
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
  const [nota, setNota] = useState('');
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
  const deudaNum = Number.isFinite(deudaParseada) ? deudaParseada : 0;
  const deudaInvalida = deudaInicial.trim() !== '' && !Number.isFinite(deudaParseada);

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
        },
        deudaNum,
        fechaISO
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
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Nuevo cliente</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
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
          </div>
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
  onCerrar,
  onCambio,
}: {
  cliente: Cliente;
  /** Abrir directo el cuadro para registrar un pago (viene de un recordatorio). */
  abrirPago?: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const navigate = useNavigate();
  const [movimientos, setMovimientos] = useState<MovimientoCuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarPago, setMostrarPago] = useState(abrirPago === true);

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

  async function toggleMovimientoPagado(m: MovimientoCuenta) {
    try {
      await window.api.ventas.marcarPagado(m.id, !m.pagado);
      cargar();
      onCambio();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo actualizar el fiado');
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{cliente.nombre}</h2>
            <p className="text-sm text-slate-500">
              Debe:{' '}
              <span className={saldoActual > 0 ? 'font-semibold text-amber-600' : 'font-semibold text-slate-500'}>
                {formatearMoneda(saldoActual)}
              </span>
            </p>
            {cliente.nota && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-400">
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {cliente.nota}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => navigate(`/recordatorios?cliente=${cliente.id}`)}
              title="Anotar un recordatorio sobre este cliente (por ejemplo, cobrarle)"
            >
              <BellRing className="h-4 w-4" />
              Recordatorio
            </button>
            <button className="btn-primary" onClick={() => setMostrarPago(true)}>
              Registrar pago
            </button>
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
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
            <div className="overflow-x-auto">
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
                  <tr key={`${m.tipo}-${m.id}`} className={m.pagado ? 'opacity-60' : ''}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {formatearFechaHoraCorta(m.fecha)}
                    </td>
                    <td className={`px-4 py-2 text-slate-800 ${m.pagado ? 'line-through' : ''}`}>
                      {m.descripcion}
                      {m.tipo === 'pago' && m.metodoPago && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {ETIQUETA_METODO[m.metodoPago]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{m.usuarioNombre ?? '—'}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${m.pagado ? 'line-through' : ''} ${
                        m.tipo === 'pago' ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {m.tipo === 'pago' ? '−' : '+'}
                      {formatearMoneda(m.monto)}
                    </td>
                    <td className="px-4 py-2">
                      {m.tipo === 'venta' && (
                        <button
                          onClick={() => toggleMovimientoPagado(m)}
                          title={m.pagado ? 'Marcar como no pagado' : 'Marcar como pagado'}
                          className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                            m.pagado
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                          }`}
                        >
                          {m.pagado ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                          {m.pagado ? 'Pagado' : 'Pendiente'}
                        </button>
                      )}
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
          )}
        </div>
      </div>

      {mostrarPago && (
        <RegistrarPagoModal
          cliente={cliente}
          saldo={saldoActual}
          onCerrar={() => setMostrarPago(false)}
          onRegistrado={() => {
            setMostrarPago(false);
            cargar();
            onCambio();
          }}
        />
      )}
    </div>,
    document.body
  );
}

function RegistrarPagoModal({
  cliente,
  saldo,
  onCerrar,
  onRegistrado,
}: {
  cliente: Cliente;
  /** Lo que debe ahora — calculado del historial recién cargado, no el
   * cliente.saldo de la lista (ése es una foto de cuando se abrió la pantalla
   * y no incluía los pagos registrados desde entonces). */
  saldo: number;
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const [monto, setMonto] = useState('');
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
      await window.api.clientes.registrarPago(cliente.id, num, null, metodoPago);
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
          <p className="text-xs text-slate-400">Debe {formatearMoneda(saldo)}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label">Monto que paga</label>
            <input
              className="input"
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
