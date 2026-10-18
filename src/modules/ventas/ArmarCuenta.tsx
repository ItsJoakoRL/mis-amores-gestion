import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Plus, ReceiptText, Search, ShoppingCart, Trash2, X, RotateCcw } from 'lucide-react';
import type { Articulo, Cliente, MetodoPago } from '@shared/types';
import {
  formatearCantidad,
  formatearMoneda,
  limpiarDecimal,
  numeroDeDecimal,
  pareceCodigoDeBarras,
  redondearCantidad,
} from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import CartelExito from '../../components/CartelExito';
import LectorCamara, { puedeUsarCamara, type RespuestaDeCodigo } from '../../components/LectorCamara';
import AsignarCodigoModal from '../articulos/AsignarCodigoModal';
import ArticuloFormModal from '../articulos/ArticuloFormModal';
import { esTactil } from '../../utils/dispositivo';

const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'fiado', etiqueta: 'Fiado' },
];

interface LineaCarrito {
  producto: Articulo;
  cantidad: number;
  // Permite anotar sólo ALGUNOS productos de la cuenta a un cliente,
  // aunque el resto se pague en efectivo/tarjeta/transferencia — para
  // cuando alguien paga casi todo pero pide "esto ponelo en mi cuenta".
  fiado: boolean;
}

interface CuentaGuardada {
  carrito: LineaCarrito[];
  metodoPago: MetodoPago;
  clienteId: string | null;
}

// Guardamos la cuenta que se está armando en localStorage — así, si la app
// se reinicia sola a mitad de camino (ej. se instaló una actualización
// mientras alguien estaba cobrando), al volver a abrirla la cuenta sigue ahí
// en vez de perderse. Cada usuario tiene la suya, para que no se mezcle la
// cuenta que dejó a medias una empleada con la de otra que entra después en
// la misma PC.
function claveGuardado(usuarioId: string): string {
  return `mis-amores:armar-cuenta:${usuarioId}`;
}

function cargarGuardado(usuarioId: string | undefined): CuentaGuardada | null {
  if (!usuarioId) return null;
  try {
    const crudo = localStorage.getItem(claveGuardado(usuarioId));
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as CuentaGuardada;
    return Array.isArray(datos.carrito) && datos.carrito.length > 0 ? datos : null;
  } catch {
    return null;
  }
}

// La cuenta de un cliente en el mostrador: se van agregando productos (por
// escaneo o buscando) hasta tener todo lo que se lleva, se ve el total en
// vivo, y recién al final se cobra todo junto. Se usa igual desde Ventas
// (caja) y desde Artículos y stock, para no tener que cambiar de pantalla
// mientras se atiende a alguien.
export default function ArmarCuenta({ onVentaRegistrada }: { onVentaRegistrada: () => void }) {
  const { sesion } = useAuth();
  // Se lee una sola vez, al montar — un useState con inicializador perezoso
  // en vez de useMemo, para no depender de un array de dependencias que de
  // cualquier forma no queremos que dispare de nuevo esta lectura.
  const guardado = useState(() => cargarGuardado(sesion?.id))[0];

  const busquedaRef = useRef<HTMLInputElement>(null);
  const [termino, setTermino] = useState('');
  const [resultados, setResultados] = useState<Articulo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [producto, setProducto] = useState<Articulo | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [carrito, setCarrito] = useState<LineaCarrito[]>(() => guardado?.carrito ?? []);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>(() => guardado?.metodoPago ?? 'efectivo');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(() => guardado?.clienteId ?? null);
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartelExito, setCartelExito] = useState<string | null>(null);
  // Sólo para mostrar el avisito de "recuperamos tu cuenta" una vez, al
  // abrir — no tiene sentido si se armó ahora mismo.
  const [mostrarAvisoRecuperada] = useState(() => !!guardado);
  const [quitadosAlRecuperar, setQuitadosAlRecuperar] = useState(0);
  // Se escaneó un código que no está cargado: se pregunta a qué producto es (o se
  // lo carga nuevo) y recién ahí se suma a la cuenta.
  const [codigoDesconocido, setCodigoDesconocido] = useState<string | null>(null);
  const [cargandoConCodigo, setCargandoConCodigo] = useState<string | null>(null);
  // Después de cobrar: qué productos se vendieron sin stock registrado (quedan
  // para revisar). Va fijo en pantalla (el cartel de "venta registrada" se cierra
  // solo en 2 segundos, poco para leer una lista).
  const [vendidosSinStock, setVendidosSinStock] = useState<string[]>([]);
  // La cámara del celular como lectora de códigos (se va escaneando producto tras producto).
  const [camaraAbierta, setCamaraAbierta] = useState(false);

  const hayFiado = metodoPago === 'fiado' || carrito.some((l) => l.fiado);

  // La cuenta recuperada trae los productos como estaban cuando se guardó
  // (puede ser de ayer): se actualizan precio y stock con lo que hay ahora en
  // la base, y se sacan los que ya no existen. Antes la cuenta seguía
  // mostrando el precio viejo aunque al cobrar se registrara el actual.
  useEffect(() => {
    if (!guardado) return;
    let vigente = true;
    Promise.all(guardado.carrito.map((l) => window.api.articulos.get(l.producto.id).catch(() => undefined))).then(
      (actualizados) => {
        if (!vigente) return;
        const actualizadosPorId = new Map<string, Articulo>();
        const quitar = new Set<string>();
        guardado.carrito.forEach((l, i) => {
          const actualizado = actualizados[i];
          // null: ya no existe; undefined: no se pudo consultar (queda como estaba).
          // Uno que se mandó a la papelera tampoco se puede vender: se saca igual.
          if (actualizado === null || (actualizado && !actualizado.activo)) quitar.add(l.producto.id);
          else if (actualizado) actualizadosPorId.set(l.producto.id, actualizado);
        });
        setCarrito((actual) =>
          actual
            .filter((l) => !quitar.has(l.producto.id))
            .map((l) => {
              const actualizado = actualizadosPorId.get(l.producto.id);
              return actualizado ? { ...l, producto: actualizado } : l;
            })
        );
        setQuitadosAlRecuperar(quitar.size);
      }
    );
    return () => {
      vigente = false;
    };
  }, [guardado]);

  // Guarda la cuenta en curso a cada cambio, y la borra sola cuando queda
  // vacía (ej. después de cobrar todo) — así nunca queda pegada una cuenta
  // vieja ya terminada.
  useEffect(() => {
    if (!sesion) return;
    try {
      if (carrito.length === 0) {
        localStorage.removeItem(claveGuardado(sesion.id));
        return;
      }
      const datos: CuentaGuardada = { carrito, metodoPago, clienteId };
      localStorage.setItem(claveGuardado(sesion.id), JSON.stringify(datos));
    } catch {
      // Sin lugar donde guardarla (modo privado, o el celular lo bloquea): la
      // cuenta sigue andando, sólo que no se recupera si se cierra la página.
    }
  }, [sesion, carrito, metodoPago, clienteId]);

  function vaciarCuenta() {
    if (!confirm('¿Vaciar la cuenta que estás armando? Se pierden los productos ya agregados.')) return;
    setCarrito([]);
    setClienteId(null);
    setMetodoPago('efectivo');
  }

  useEffect(() => {
    if (hayFiado && clientes.length === 0) {
      window.api.clientes
        .list()
        .then(setClientes)
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la lista de clientes'));
    }
  }, [hayFiado, clientes.length]);

  useEffect(() => {
    if (producto || !termino.trim()) {
      setResultados([]);
      return;
    }
    // Con WiFi lenta una respuesta vieja puede llegar después de la nueva: si
    // el término ya cambió (o se eligió un producto), esa respuesta se ignora.
    let vigente = true;
    const debounce = setTimeout(() => {
      setBuscando(true);
      window.api.articulos
        .list({ busqueda: termino.trim() })
        .then((lista) => {
          if (vigente) setResultados(lista.slice(0, 6));
        })
        .finally(() => {
          if (vigente) setBuscando(false);
        });
    }, 200);
    return () => {
      vigente = false;
      clearTimeout(debounce);
    };
  }, [termino, producto]);

  function elegirProducto(a: Articulo) {
    setProducto(a);
    setTermino('');
    setResultados([]);
    setError(null);
    // Si quedó escrita una cantidad con decimales (de un producto por peso
    // que después se descartó), no puede pasar a uno que se vende por unidad.
    if (a.unidad !== 'peso' && !Number.isInteger(numeroDeDecimal(cantidad))) setCantidad('1');
  }

  // Suma un producto a la cuenta — si ya estaba en la lista (se escaneó el
  // mismo código dos veces), suma la cantidad en el mismo renglón en vez de
  // duplicarlo.
  function sumarAlCarrito(prod: Articulo, cant: number) {
    setCarrito((actual) => {
      const yaEsta = actual.find((l) => l.producto.id === prod.id);
      if (yaEsta) {
        return actual.map((l) =>
          l.producto.id === prod.id ? { ...l, cantidad: redondearCantidad(l.cantidad + cant) } : l
        );
      }
      return [...actual, { producto: prod, cantidad: cant, fiado: false }];
    });
  }

  // Marca/desmarca un producto puntual para que quede anotado en la cuenta
  // corriente del cliente en vez de cobrarse ahora — independiente de la
  // forma de pago general, para poder mezclar "esto lo pago, esto me lo fías".
  function toggleFiadoLinea(articuloId: string) {
    setCarrito((actual) => actual.map((l) => (l.producto.id === articuloId ? { ...l, fiado: !l.fiado } : l)));
  }

  // Un producto que se encontró por su código (escaneado, o recién asignado).
  function agregarEscaneado(a: Articulo) {
    setVendidosSinStock([]);
    if (a.unidad === 'peso') {
      // Se vende por peso: no hay forma de saber cuántos kg son con sólo
      // el código, así que igual pide confirmar la cantidad a mano.
      elegirProducto(a);
    } else {
      // Escaneo real de la lectora: se suma directo a la cuenta (1
      // unidad) sin pasos intermedios — si se escanea el mismo producto
      // de nuevo, la cantidad de ese renglón sube sola.
      sumarAlCarrito(a, 1);
      setTermino('');
      setResultados([]);
      setError(null);
    }
  }

  function cerrarCodigoDesconocido() {
    setCodigoDesconocido(null);
    if (!esTactil()) busquedaRef.current?.focus();
  }

  // Se cargó como producto nuevo con el código escaneado: se lo busca por ese
  // código y se suma a la cuenta.
  async function sumarRecienCargado(codigo: string) {
    try {
      const a = await window.api.articulos.buscarPorCodigo(codigo);
      if (a && a.activo) agregarEscaneado(a);
    } catch {
      // Quedó cargado igual: se lo puede escanear de nuevo.
    }
    if (!esTactil()) busquedaRef.current?.focus();
  }

  // Un código leído con la cámara (uno tras otro, sin tocar nada): se lo busca y se suma a la
  // cuenta. Si hay que escribir algo (un producto por peso, o un código que no está cargado)
  // se cierra la cámara para poder hacerlo.
  async function procesarCodigoDeCamara(codigo: string): Promise<RespuestaDeCodigo> {
    if (!pareceCodigoDeBarras(codigo)) return { mensaje: 'Ese código no parece el de un producto', tipo: 'error' };
    const encontrado = await window.api.articulos.buscarPorCodigo(codigo);
    if (encontrado && !encontrado.activo) {
      return { mensaje: `"${encontrado.descripcion}" está en la papelera: no se puede vender`, tipo: 'error' };
    }
    if (encontrado) {
      agregarEscaneado(encontrado);
      return encontrado.unidad === 'peso'
        ? { mensaje: `${encontrado.descripcion}: poné cuántos kg`, tipo: 'ok', cerrar: true }
        : { mensaje: `+1 · ${encontrado.descripcion}`, tipo: 'ok' };
    }
    setCodigoDesconocido(codigo);
    setError(null);
    return { cerrar: true };
  }

  async function handleBusquedaKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const codigo = termino.trim();
    if (!codigo) return;
    try {
      const encontrado = await window.api.articulos.buscarPorCodigo(codigo);
      if (encontrado && !encontrado.activo) {
        // Está en la papelera (se dio de baja pero conserva su código).
        setError(`"${encontrado.descripcion}" está en la papelera: no se puede vender.`);
        setTermino('');
        setResultados([]);
      } else if (encontrado) {
        agregarEscaneado(encontrado);
      } else if (pareceCodigoDeBarras(codigo)) {
        // Un código que no está cargado: no se adivina el producto por un
        // parecido de números. Se pregunta a cuál corresponde (o se lo carga) y
        // ese producto se suma a la cuenta.
        setCodigoDesconocido(codigo);
        setTermino('');
        setResultados([]);
        setError(null);
      } else {
        // Se busca de nuevo en lugar de usar la lista que está en pantalla: si
        // se escribió rápido y se apretó Enter, esa lista puede ser la de una
        // palabra anterior y se elegiría otro producto.
        const lista = await window.api.articulos.list({ busqueda: codigo });
        if (lista.length > 0) elegirProducto(lista[0]);
      }
    } catch {
      // si falla la búsqueda por código, no hacemos nada — el usuario puede
      // seguir escribiendo y elegir de la lista de resultados.
    }
  }

  function cambiarCantidad(valor: string) {
    if (producto?.unidad === 'peso') {
      // Productos por peso aceptan decimales (ej. 1,5 kg) — con coma (como
      // se escribe acá) o con punto, pero un solo separador.
      setCantidad(limpiarDecimal(valor));
    } else {
      setCantidad(valor.replace(/[^0-9]/g, ''));
    }
  }

  const cantidadNum = redondearCantidad(numeroDeDecimal(cantidad));
  const totalCarrito = carrito.reduce((acc, l) => acc + l.producto.precioVenta * l.cantidad, 0);
  // Si la forma de pago general ya es "Fiado", da igual lo que diga cada
  // renglón — total y viceversa. Si no, sólo cuentan como fiado los
  // renglones marcados uno por uno.
  const totalFiado = metodoPago === 'fiado'
    ? totalCarrito
    : carrito.filter((l) => l.fiado).reduce((acc, l) => acc + l.producto.precioVenta * l.cantidad, 0);
  const totalCobrarAhora = totalCarrito - totalFiado;

  function agregarAlCarrito() {
    if (!producto || cantidadNum <= 0) return;
    setVendidosSinStock([]);
    sumarAlCarrito(producto, cantidadNum);
    setProducto(null);
    setCantidad('1');
    setError(null);
    busquedaRef.current?.focus();
  }

  function quitarDelCarrito(articuloId: string) {
    setCarrito((actual) => actual.filter((l) => l.producto.id !== articuloId));
  }

  async function cobrar() {
    if (carrito.length === 0) return;
    if (hayFiado && !clienteId) {
      setError('Elegí a qué cliente se le anota lo fiado');
      return;
    }
    setRegistrando(true);
    setError(null);
    const pendientes = [...carrito];
    // El total del cartel sale de lo que de verdad quedó registrado (el
    // precio lo pone la base al guardar), no de lo que mostraba la cuenta.
    let totalRegistrado = 0;
    try {
      for (const linea of pendientes) {
        const esFiado = metodoPago === 'fiado' || linea.fiado;
        const venta = await window.api.ventas.crear({
          articuloId: linea.producto.id,
          cantidad: linea.cantidad,
          metodoPago: esFiado ? 'fiado' : metodoPago,
          clienteId: esFiado ? clienteId : null,
        });
        totalRegistrado += venta.total;
        // Se saca de a uno a medida que se confirma — si algo falla a mitad
        // de camino, lo ya cobrado no se vuelve a intentar de nuevo.
        setCarrito((actual) => actual.filter((l) => l.producto.id !== linea.producto.id));
      }
      setCartelExito(`Venta registrada: ${formatearMoneda(totalRegistrado)} en ${pendientes.length} producto(s)`);
      // Se mira cómo quedó el stock de verdad (no lo que mostraba la cuenta, que
      // puede estar viejo): los que quedaron en negativo hay que contarlos.
      const despues = await Promise.all(
        pendientes.map((l) => window.api.articulos.get(l.producto.id).catch(() => null))
      );
      setVendidosSinStock(despues.filter((a): a is Articulo => !!a && a.stock < 0).map((a) => a.descripcion));
      setClienteId(null);
      setMetodoPago('efectivo');
      onVentaRegistrada();
      // En el celular enfocar el campo abriría el teclado justo después de cobrar.
      if (!esTactil()) busquedaRef.current?.focus();
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'No se pudo registrar la venta') +
          ' — lo que ya se cobró antes de este error queda registrado; el resto sigue en la cuenta.'
      );
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <div className="card p-4">
      {mostrarAvisoRecuperada && carrito.length > 0 && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          Recuperamos la cuenta que habías empezado a armar — seguí donde la dejaste, o vaciala si ya no vale.
          {quitadosAlRecuperar > 0 &&
            ` Se sacaron ${quitadosAlRecuperar} producto(s) que ya no existen en el sistema.`}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[260px] flex-1">
          <label className="label">Producto</label>
          {producto ? (
            <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">{producto.descripcion}</p>
                <p className="text-xs text-slate-500">
                  {formatearMoneda(producto.precioVenta)} · Stock: {formatearCantidad(producto.stock)}
                </p>
                {producto.stock <= 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Figura sin stock: se puede vender igual y queda para revisar.
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setProducto(null);
                  busquedaRef.current?.focus();
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                title="Cambiar producto"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={busquedaRef}
                className={`input pl-9 ${puedeUsarCamara() ? 'pr-11' : ''}`}
                placeholder="Escaneá o buscá por nombre..."
                value={termino}
                onChange={(e) => setTermino(e.target.value)}
                onKeyDown={handleBusquedaKeyDown}
                autoFocus
              />
              {puedeUsarCamara() && (
                <button
                  type="button"
                  onClick={() => setCamaraAbierta(true)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-brand-600 hover:bg-brand-50"
                  title="Escanear con la cámara del celular"
                >
                  <Camera className="h-5 w-5" />
                </button>
              )}
              {(resultados.length > 0 || buscando) && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {buscando && <p className="px-3 py-2 text-xs text-slate-400">Buscando...</p>}
                  {!buscando &&
                    resultados.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => elegirProducto(a)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <span className="text-slate-700">{a.descripcion}</span>
                        <span className="text-xs text-slate-400">{formatearMoneda(a.precioVenta)}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="w-24">
          <label className="label">Cantidad</label>
          <input
            className="input"
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => cambiarCantidad(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') agregarAlCarrito();
            }}
          />
        </div>

        <button className="btn-secondary" onClick={agregarAlCarrito} disabled={!producto || cantidadNum <= 0}>
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </div>

      {/* La cuenta que se le va armando al cliente — cada producto que se
          agrega suma acá, para tener a la vista cuánto va llevando antes de
          cobrar todo junto. */}
      <div className="mt-4 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <ShoppingCart className="h-4 w-4 text-slate-400" />
          <p className="flex-1 text-sm font-medium text-slate-600">
            {carrito.length === 0 ? 'Todavía no agregaste nada' : `${carrito.length} producto(s) en la cuenta`}
          </p>
          {carrito.length > 0 && (
            <button
              onClick={vaciarCuenta}
              className="text-xs font-medium text-slate-400 hover:text-red-600"
              title="Sacar todo lo agregado y empezar de nuevo"
            >
              Vaciar
            </button>
          )}
        </div>
        {carrito.length > 0 && (
          <div className="divide-y divide-slate-100">
            {carrito.map((linea) => (
              <div key={linea.producto.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{linea.producto.descripcion}</p>
                  <p className="text-xs text-slate-400">
                    {formatearCantidad(linea.cantidad)} {linea.producto.unidad === 'peso' ? 'kg' : 'un.'} ×{' '}
                    {formatearMoneda(linea.producto.precioVenta)}
                  </p>
                  {linea.cantidad > linea.producto.stock && (
                    <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {linea.producto.stock > 0 ? `Figuran ${formatearCantidad(linea.producto.stock)}` : 'Figura sin stock'}:
                      se vende igual y queda para revisar
                    </p>
                  )}
                </div>
                <p className="shrink-0 font-medium text-slate-700">
                  {formatearMoneda(linea.producto.precioVenta * linea.cantidad)}
                </p>
                {metodoPago !== 'fiado' && (
                  <button
                    onClick={() => toggleFiadoLinea(linea.producto.id)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      linea.fiado
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title="Anotar este producto en la cuenta del cliente en vez de cobrarlo ahora"
                  >
                    {linea.fiado ? 'Fiado' : 'Fiar'}
                  </button>
                )}
                <button
                  onClick={() => quitarDelCarrito(linea.producto.id)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                  title="Sacar de la cuenta"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="label">Forma de pago</label>
          <select
            className="input"
            value={metodoPago}
            onChange={(e) => {
              setMetodoPago(e.target.value as MetodoPago);
              setClienteId(null);
            }}
          >
            {METODOS_PAGO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>

        {hayFiado && (
          <div className="w-48">
            <label className="label">Cliente (fiado)</label>
            <select className="input" value={clienteId ?? ''} onChange={(e) => setClienteId(e.target.value || null)}>
              <option value="">Elegir...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {hayFiado && totalCobrarAhora > 0 ? (
          <>
            <div className="w-28">
              <label className="label">Cobrás ahora</label>
              <p className="input flex items-center bg-slate-50 font-semibold text-slate-800">
                {formatearMoneda(totalCobrarAhora)}
              </p>
            </div>
            <div className="w-28">
              <label className="label">Fiado</label>
              <p className="input flex items-center border-amber-200 bg-amber-50 font-semibold text-amber-700">
                {formatearMoneda(totalFiado)}
              </p>
            </div>
          </>
        ) : (
          <div className="w-32">
            <label className="label">Total</label>
            <p
              className={`input flex items-center font-semibold ${
                hayFiado ? 'border-amber-200 bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-800'
              }`}
            >
              {formatearMoneda(totalCarrito)}
            </p>
          </div>
        )}

        <button
          className="btn-primary"
          onClick={cobrar}
          disabled={carrito.length === 0 || registrando || (hayFiado && !clienteId)}
        >
          <ReceiptText className="h-4 w-4" />
          {registrando ? 'Cobrando...' : 'Cobrar'}
        </button>
      </div>

      {hayFiado && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {totalCobrarAhora > 0
            ? 'Lo marcado como "Fiado" se anota a la cuenta del cliente; el resto se cobra ahora.'
            : 'Esto se anota a la cuenta del cliente — no se cuenta como plata cobrada hasta que la pague.'}{' '}
          Lo vas a ver separado en el Panel, el calendario de Ventas y en Reportes.
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {vendidosSinStock.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            La venta quedó registrada, pero el sistema no tenía stock de: <strong>{vendidosSinStock.join(', ')}</strong>.
            Quedan <strong>para revisar</strong>: cuando puedas contalos (en Artículos y stock, o en Contar inventario)
            y se corrige el stock.
          </p>
          <button
            onClick={() => setVendidosSinStock([])}
            className="shrink-0 rounded-lg p-1 text-amber-600 hover:bg-amber-100"
            title="Cerrar este aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {cartelExito && <CartelExito mensaje={cartelExito} onCerrar={() => setCartelExito(null)} />}

      {camaraAbierta && (
        <LectorCamara
          titulo="Escaneá los productos de la cuenta"
          alLeer={procesarCodigoDeCamara}
          onCerrar={() => setCamaraAbierta(false)}
        />
      )}

      {codigoDesconocido && (
        <AsignarCodigoModal
          codigo={codigoDesconocido}
          onCerrar={cerrarCodigoDesconocido}
          onAsignado={(a) => {
            setCodigoDesconocido(null);
            agregarEscaneado(a);
            if (!esTactil()) busquedaRef.current?.focus();
          }}
          onCrearNuevo={() => {
            setCargandoConCodigo(codigoDesconocido);
            setCodigoDesconocido(null);
          }}
        />
      )}
      {cargandoConCodigo && (
        <ArticuloFormModal
          articulo={null}
          codigoInicial={cargandoConCodigo}
          onCerrar={() => {
            setCargandoConCodigo(null);
            if (!esTactil()) busquedaRef.current?.focus();
          }}
          onGuardado={() => {
            const codigo = cargandoConCodigo;
            setCargandoConCodigo(null);
            void sumarRecienCargado(codigo);
          }}
        />
      )}
    </div>
  );
}
