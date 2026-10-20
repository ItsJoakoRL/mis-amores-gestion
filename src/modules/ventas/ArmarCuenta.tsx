import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
  Split,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
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
import { nuevoIdTicket } from '../../utils/ticket';
import AsignarCodigoModal from '../articulos/AsignarCodigoModal';
import ArticuloFormModal from '../articulos/ArticuloFormModal';
import NuevoClienteRapido from './NuevoClienteRapido';
import { esTactil } from '../../utils/dispositivo';

const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'fiado', etiqueta: 'Fiado' },
];

const esMetodo = (m: unknown): m is MetodoPago => METODOS_PAGO.some((x) => x.valor === m);

// Un renglón de la cuenta: un producto, cuántos y CÓMO SE PAGA. Un mismo producto puede estar en
// varios renglones (por ejemplo 3 gaseosas: 2 en efectivo y 1 por transferencia), y cada renglón
// fiado lleva su propio cliente. Al cobrar, cada renglón es una venta.
interface LineaCarrito {
  id: string;
  producto: Articulo;
  cantidad: number;
  metodo: MetodoPago;
  /** A quién se le anota (sólo cuando el renglón es fiado). */
  clienteId: string | null;
}

interface CuentaGuardada {
  version: 2;
  carrito: LineaCarrito[];
  /** La forma de pago con la que arrancan los productos que se agregan. */
  metodoPago: MetodoPago;
  ultimoClienteId: string | null;
}

const nuevoIdLinea = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// Guardamos la cuenta que se está armando en localStorage — así, si la app
// se reinicia sola a mitad de camino (ej. se instaló una actualización
// mientras alguien estaba cobrando), al volver a abrirla la cuenta sigue ahí
// en vez de perderse. Cada usuario tiene la suya, para que no se mezcle la
// cuenta que dejó a medias una empleada con la de otra que entra después en
// la misma PC.
function claveGuardado(usuarioId: string): string {
  return `mis-amores:armar-cuenta:${usuarioId}`;
}

// Lee lo guardado. Hasta la 0.8.17 se guardaba una sola forma de pago para toda la cuenta y los
// productos "fiados" marcados aparte (con un solo cliente): se pasa al formato nuevo.
function cargarGuardado(usuarioId: string | undefined): CuentaGuardada | null {
  if (!usuarioId) return null;
  try {
    const crudo = localStorage.getItem(claveGuardado(usuarioId));
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as {
      carrito?: Array<{ id?: string; producto: Articulo; cantidad: number; metodo?: unknown; clienteId?: string | null; fiado?: boolean }>;
      metodoPago?: unknown;
      clienteId?: string | null;
      ultimoClienteId?: string | null;
    };
    if (!Array.isArray(datos.carrito) || datos.carrito.length === 0) return null;
    const general: MetodoPago = esMetodo(datos.metodoPago) ? datos.metodoPago : 'efectivo';
    const carrito: LineaCarrito[] = datos.carrito
      .filter((l) => l && l.producto && typeof l.cantidad === 'number')
      .map((l) => {
        if (esMetodo(l.metodo)) {
          return {
            id: l.id ?? nuevoIdLinea(),
            producto: l.producto,
            cantidad: l.cantidad,
            metodo: l.metodo,
            clienteId: l.metodo === 'fiado' ? l.clienteId ?? null : null,
          };
        }
        const fiado = general === 'fiado' || l.fiado === true;
        return {
          id: nuevoIdLinea(),
          producto: l.producto,
          cantidad: l.cantidad,
          metodo: fiado ? 'fiado' : general,
          clienteId: fiado ? datos.clienteId ?? null : null,
        };
      });
    if (carrito.length === 0) return null;
    return {
      version: 2,
      carrito,
      metodoPago: general,
      ultimoClienteId: datos.ultimoClienteId ?? datos.clienteId ?? null,
    };
  } catch {
    return null;
  }
}

// Si dos renglones quedaron iguales (mismo producto, misma forma de pago y mismo cliente), se
// juntan en uno: así no queda "2 gaseosas en efectivo" y "1 gaseosa en efectivo" por separado.
function unificar(lineas: LineaCarrito[]): LineaCarrito[] {
  const resultado: LineaCarrito[] = [];
  for (const l of lineas) {
    const igual = resultado.find(
      (r) => r.producto.id === l.producto.id && r.metodo === l.metodo && r.clienteId === l.clienteId
    );
    if (igual) igual.cantidad = redondearCantidad(igual.cantidad + l.cantidad);
    else resultado.push({ ...l });
  }
  return resultado;
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
  // El número de compra se mantiene si el cobro falla a medias y se reintenta: lo que ya se cobró y lo
  // que se cobra después son de la misma compra (si no, el Panel la contaría dos veces).
  const ticketActual = useRef<string | null>(null);
  const [termino, setTermino] = useState('');
  const [resultados, setResultados] = useState<Articulo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [producto, setProducto] = useState<Articulo | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [carrito, setCarrito] = useState<LineaCarrito[]>(() => guardado?.carrito ?? []);
  // Cómo se paga lo que se agregue de ahora en más (y lo que muestra el selector "de todo").
  const [metodoPago, setMetodoPago] = useState<MetodoPago>(() => guardado?.metodoPago ?? 'efectivo');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  // El último cliente elegido para un fiado: los demás productos fiados de la cuenta arrancan con él.
  const [ultimoCliente, setUltimoCliente] = useState<string | null>(() => guardado?.ultimoClienteId ?? null);
  const [nuevoClientePara, setNuevoClientePara] = useState<string | null>(null);
  // Dividir un renglón: "de estas N, ¿cuántas se pagan de otra forma?"
  const [dividiendoId, setDividiendoId] = useState<string | null>(null);
  const [divCantidad, setDivCantidad] = useState('');
  const [divMetodo, setDivMetodo] = useState<MetodoPago>('transferencia');
  const [divError, setDivError] = useState<string | null>(null);
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

  const hayFiado = carrito.some((l) => l.metodo === 'fiado');
  const faltaCliente = carrito.some((l) => l.metodo === 'fiado' && !l.clienteId);
  const variasFormas = new Set(carrito.map((l) => l.metodo)).size > 1;

  // La cuenta recuperada trae los productos como estaban cuando se guardó
  // (puede ser de ayer): se actualizan precio y stock con lo que hay ahora en
  // la base, y se sacan los que ya no existen. Antes la cuenta seguía
  // mostrando el precio viejo aunque al cobrar se registrara el actual.
  useEffect(() => {
    if (!guardado) return;
    let vigente = true;
    const ids = [...new Set(guardado.carrito.map((l) => l.producto.id))];
    Promise.all(ids.map((id) => window.api.articulos.get(id).catch(() => undefined))).then((actualizados) => {
      if (!vigente) return;
      const actualizadosPorId = new Map<string, Articulo>();
      const quitar = new Set<string>();
      ids.forEach((id, i) => {
        const actualizado = actualizados[i];
        // null: ya no existe; undefined: no se pudo consultar (queda como estaba).
        // Uno que se mandó a la papelera tampoco se puede vender: se saca igual.
        if (actualizado === null || (actualizado && !actualizado.activo)) quitar.add(id);
        else if (actualizado) actualizadosPorId.set(id, actualizado);
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
    });
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
      const datos: CuentaGuardada = { version: 2, carrito, metodoPago, ultimoClienteId: ultimoCliente };
      localStorage.setItem(claveGuardado(sesion.id), JSON.stringify(datos));
    } catch {
      // Sin lugar donde guardarla (modo privado, o el celular lo bloquea): la
      // cuenta sigue andando, sólo que no se recupera si se cierra la página.
    }
  }, [sesion, carrito, metodoPago, ultimoCliente]);

  function vaciarCuenta() {
    if (!confirm('¿Vaciar la cuenta que estás armando? Se pierden los productos ya agregados.')) return;
    setCarrito([]);
    setUltimoCliente(null);
    setMetodoPago('efectivo');
    setDividiendoId(null);
  }

  useEffect(() => {
    if (hayFiado && clientes.length === 0) {
      window.api.clientes
        .list()
        .then(setClientes)
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la lista de clientes'));
    }
  }, [hayFiado, clientes.length]);

  // La lectora de códigos "tipea" los números como un teclado. Si el foco quedó en un desplegable o en un
  // botón (se tocó la forma de pago, por ejemplo), el escaneo se perdía hasta hacer clic en el buscador:
  // con un número, el foco vuelve solo al buscador (y ese número ya cae ahí).
  useEffect(() => {
    if (esTactil()) return;
    const alApretar = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable="true"]')) return;
      // Con un cuadro abierto (cliente nuevo, asignar código, cargar producto...) o la ayuda en pantalla, no se toca nada.
      if (document.querySelector('.fixed.inset-0[class*="z-50"], .fixed.inset-0[class*="z-[60]"], [data-recorrido-ayuda]')) return;
      busquedaRef.current?.focus();
    };
    document.addEventListener('keydown', alApretar);
    return () => document.removeEventListener('keydown', alApretar);
  }, []);

  // Una cuenta guardada puede traer un cliente que ya no está en la lista (se lo sacó): ese renglón
  // vuelve a pedir cliente, en vez de dejar cobrar a nombre de alguien que no existe.
  useEffect(() => {
    if (clientes.length === 0) return;
    const ids = new Set(clientes.map((c) => c.id));
    setCarrito((actual) =>
      actual.some((l) => l.clienteId && !ids.has(l.clienteId))
        ? actual.map((l) => (l.clienteId && !ids.has(l.clienteId) ? { ...l, clienteId: null } : l))
        : actual
    );
    setUltimoCliente((u) => (u && !ids.has(u) ? null : u));
  }, [clientes]);

  // Con la cuenta vacía, la próxima compra arranca con un número nuevo.
  useEffect(() => {
    if (carrito.length === 0) ticketActual.current = null;
  }, [carrito.length]);

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
        .catch(() => {})
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

  // Suma un producto a la cuenta — si ya estaba en la lista con la misma forma de pago (se
  // escaneó el mismo código dos veces), suma la cantidad en el mismo renglón en vez de duplicarlo.
  function sumarAlCarrito(prod: Articulo, cant: number) {
    const cliente = metodoPago === 'fiado' ? ultimoCliente : null;
    setCarrito((actual) => {
      const yaEsta = actual.find((l) => l.producto.id === prod.id && l.metodo === metodoPago && l.clienteId === cliente);
      if (yaEsta) {
        return actual.map((l) =>
          l.id === yaEsta.id ? { ...l, cantidad: redondearCantidad(l.cantidad + cant) } : l
        );
      }
      return [...actual, { id: nuevoIdLinea(), producto: prod, cantidad: cant, metodo: metodoPago, clienteId: cliente }];
    });
  }

  // Cambia cómo se paga UN renglón (por ejemplo "esto va por transferencia y el resto en efectivo").
  function cambiarMetodoDeLinea(id: string, metodo: MetodoPago) {
    setCarrito((actual) =>
      unificar(
        actual.map((l) =>
          l.id !== id ? l : { ...l, metodo, clienteId: metodo === 'fiado' ? l.clienteId ?? ultimoCliente : null }
        )
      )
    );
  }

  // Cambia cómo se paga TODA la cuenta, y es la forma de pago con la que arrancan los productos que se agreguen.
  function cambiarMetodoGeneral(metodo: MetodoPago) {
    setMetodoPago(metodo);
    setDividiendoId(null);
    setCarrito((actual) =>
      unificar(actual.map((l) => ({ ...l, metodo, clienteId: metodo === 'fiado' ? l.clienteId ?? ultimoCliente : null })))
    );
  }

  // Elige a quién se le anota un renglón fiado. Los otros fiados que todavía no tienen cliente
  // arrancan con el mismo (lo normal es que sea una sola persona).
  function elegirClienteDeLinea(id: string, clienteId: string | null) {
    if (clienteId) setUltimoCliente(clienteId);
    setCarrito((actual) =>
      unificar(
        actual.map((l) => {
          if (l.id === id) return { ...l, clienteId };
          if (clienteId && l.metodo === 'fiado' && !l.clienteId) return { ...l, clienteId };
          return l;
        })
      )
    );
  }

  function clienteCreado(c: Cliente) {
    setClientes((actual) => [...actual, c].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
    if (nuevoClientePara) elegirClienteDeLinea(nuevoClientePara, c.id);
    setNuevoClientePara(null);
  }

  function abrirDividir(l: LineaCarrito) {
    setDividiendoId(l.id);
    setDivCantidad(l.producto.unidad === 'peso' ? '' : '1');
    // Lo más común: la mitad va por otra forma de pago distinta de la del renglón.
    setDivMetodo(l.metodo === 'efectivo' ? 'transferencia' : 'efectivo');
    setDivError(null);
  }

  function cambiarDivCantidad(l: LineaCarrito, valor: string) {
    setDivCantidad(l.producto.unidad === 'peso' ? limpiarDecimal(valor) : valor.replace(/[^0-9]/g, ''));
  }

  // "De estas N, M se pagan de otra forma": el renglón queda con N-M y aparece uno nuevo con M.
  function confirmarDividir(l: LineaCarrito) {
    const cuantas = redondearCantidad(numeroDeDecimal(divCantidad));
    if (!(cuantas > 0) || cuantas >= l.cantidad) {
      setDivError(`Poné un número mayor que 0 y menor que ${formatearCantidad(l.cantidad)}.`);
      return;
    }
    // Dividir hacia la misma forma de pago no cambia nada (volverían a juntarse), salvo con fiado: ahí
    // sirve para anotar una parte a otro cliente.
    if (divMetodo === l.metodo && divMetodo !== 'fiado') {
      setDivError(`Elegí una forma de pago distinta de ${l.metodo === 'efectivo' ? 'Efectivo' : l.metodo === 'tarjeta' ? 'Tarjeta' : 'Transferencia'}.`);
      return;
    }
    setCarrito((actual) => {
      const i = actual.findIndex((x) => x.id === l.id);
      if (i < 0) return actual;
      const copia = [...actual];
      copia[i] = { ...actual[i], cantidad: redondearCantidad(actual[i].cantidad - cuantas) };
      copia.splice(i + 1, 0, {
        id: nuevoIdLinea(),
        producto: l.producto,
        cantidad: cuantas,
        metodo: divMetodo,
        // Un fiado que sale de otro fiado arranca sin cliente (se divide para anotarlo a otra persona).
        clienteId: divMetodo === 'fiado' ? (l.metodo === 'fiado' ? null : ultimoCliente) : null,
      });
      return unificar(copia);
    });
    setDividiendoId(null);
    setDivError(null);
  }

  // Un producto sin precio cargado se vendería a $0 sin que nadie se dé cuenta.
  const sinPrecio = (a: Articulo) => !(a.precioVenta > 0);
  const avisoSinPrecio = (a: Articulo) =>
    `"${a.descripcion}" no tiene precio cargado: cargalo en Artículos y stock antes de venderlo.`;

  // Un producto que se encontró por su código (escaneado, o recién asignado).
  function agregarEscaneado(a: Articulo) {
    setVendidosSinStock([]);
    if (sinPrecio(a)) {
      setError(avisoSinPrecio(a));
      setTermino('');
      setResultados([]);
      return;
    }
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
    if (encontrado && sinPrecio(encontrado)) {
      return { mensaje: `"${encontrado.descripcion}" no tiene precio cargado`, tipo: 'error' };
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
  const subtotalDe = (l: LineaCarrito) => l.producto.precioVenta * l.cantidad;
  const totalCarrito = carrito.reduce((acc, l) => acc + subtotalDe(l), 0);
  const totalDe = (m: MetodoPago) => carrito.filter((l) => l.metodo === m).reduce((acc, l) => acc + subtotalDe(l), 0);
  const totalFiado = totalDe('fiado');
  const totalCobrarAhora = totalCarrito - totalFiado;
  // Cuántas unidades de cada producto hay en total en la cuenta (puede estar en varios renglones).
  const cantidadPorProducto = new Map<string, number>();
  for (const l of carrito) cantidadPorProducto.set(l.producto.id, (cantidadPorProducto.get(l.producto.id) ?? 0) + l.cantidad);
  // El selector de "forma de pago de todo": la que tienen todos, o "varias".
  const metodoGeneral: MetodoPago | '' = carrito.length === 0 ? metodoPago : variasFormas ? '' : carrito[0].metodo;

  function agregarAlCarrito() {
    if (!producto || cantidadNum <= 0 || sinPrecio(producto)) return;
    setVendidosSinStock([]);
    sumarAlCarrito(producto, cantidadNum);
    setProducto(null);
    setCantidad('1');
    setError(null);
    busquedaRef.current?.focus();
  }

  function quitarDelCarrito(lineaId: string) {
    setCarrito((actual) => actual.filter((l) => l.id !== lineaId));
    if (dividiendoId === lineaId) setDividiendoId(null);
  }

  async function cobrar() {
    if (carrito.length === 0) return;
    if (faltaCliente) {
      setError('Elegí a qué cliente se le anota lo fiado');
      return;
    }
    setRegistrando(true);
    setError(null);
    const pendientes = [...carrito];
    // Todos los productos de esta cuenta comparten un número: así se cuenta una compra, no varias.
    if (!ticketActual.current) ticketActual.current = nuevoIdTicket();
    const ticketId = ticketActual.current;
    // El total del cartel sale de lo que de verdad quedó registrado (el
    // precio lo pone la base al guardar), no de lo que mostraba la cuenta.
    let totalRegistrado = 0;
    let fiadoRegistrado = 0;
    try {
      for (const linea of pendientes) {
        const esFiado = linea.metodo === 'fiado';
        const venta = await window.api.ventas.crear({
          articuloId: linea.producto.id,
          cantidad: linea.cantidad,
          metodoPago: linea.metodo,
          clienteId: esFiado ? linea.clienteId : null,
          ticketId,
        });
        totalRegistrado += venta.total;
        if (esFiado) fiadoRegistrado += venta.total;
        // Se saca de a uno a medida que se confirma — si algo falla a mitad
        // de camino, lo ya cobrado no se vuelve a intentar de nuevo.
        setCarrito((actual) => actual.filter((l) => l.id !== linea.id));
      }
      ticketActual.current = null; // se cobró todo: la próxima compra es otra
      const productos = new Set(pendientes.map((l) => l.producto.id)).size;
      setCartelExito(
        `Venta registrada: ${formatearMoneda(totalRegistrado)} en ${productos} producto(s)` +
          (fiadoRegistrado > 0 && fiadoRegistrado < totalRegistrado ? ` (${formatearMoneda(fiadoRegistrado)} quedaron fiados)` : '')
      );
      // Se mira cómo quedó el stock de verdad (no lo que mostraba la cuenta, que
      // puede estar viejo): los que quedaron en negativo hay que contarlos.
      const ids = [...new Set(pendientes.map((l) => l.producto.id))];
      const despues = await Promise.all(ids.map((id) => window.api.articulos.get(id).catch(() => null)));
      setVendidosSinStock(despues.filter((a): a is Articulo => !!a && a.stock < 0).map((a) => a.descripcion));
      setUltimoCliente(null);
      setMetodoPago('efectivo');
      setDividiendoId(null);
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

  const clasePago = (m: MetodoPago) => (m === 'fiado' ? 'border-amber-300 bg-amber-50 text-amber-800' : '');

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
                {sinPrecio(producto) && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    No tiene precio cargado: cargalo en Artículos y stock antes de venderlo.
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
                // En el celular enfocar el campo abre el teclado apenas se entra a la pantalla.
                autoFocus={!esTactil()}
              />
              {puedeUsarCamara() && (
                <button
                  type="button"
                  data-tour="cuenta-camara"
                  onClick={() => setCamaraAbierta(true)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-brand-600 hover:bg-brand-50"
                  title="Escanear con la cámara del celular"
                >
                  <Camera className="h-5 w-5" />
                </button>
              )}
              {(resultados.length > 0 || buscando) && (
                <div
                  data-desborda
                  className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
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

        <div data-tour="cuenta-cantidad" className="flex items-end gap-3">
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

          <button
            data-tour="cuenta-agregar"
            className="btn-secondary"
            onClick={agregarAlCarrito}
            disabled={!producto || cantidadNum <= 0 || sinPrecio(producto)}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>
      </div>

      {/* La cuenta que se le va armando al cliente — cada producto que se
          agrega suma acá, para tener a la vista cuánto va llevando antes de
          cobrar todo junto. Cada renglón dice cómo se paga. */}
      <div data-tour="cuenta-lista" className="mt-4 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <ShoppingCart className="h-4 w-4 text-slate-400" />
          <p className="flex-1 text-sm font-medium text-slate-600">
            {carrito.length === 0
              ? 'Todavía no agregaste nada'
              : `${cantidadPorProducto.size} producto(s) en la cuenta` +
                (carrito.length > cantidadPorProducto.size ? ` · ${carrito.length} renglones, según cómo se paga cada uno` : '')}
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
            {carrito.map((linea) => {
              const esFiado = linea.metodo === 'fiado';
              const enLaCuenta = cantidadPorProducto.get(linea.producto.id) ?? linea.cantidad;
              const sePuedeDividir = linea.producto.unidad === 'peso' ? linea.cantidad > 0.01 : linea.cantidad >= 2;
              return (
                <div key={linea.id} data-linea className={`px-3 py-2 ${esFiado ? 'bg-amber-50/50' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{linea.producto.descripcion}</p>
                      <p className="text-xs text-slate-400">
                        {formatearCantidad(linea.cantidad)} {linea.producto.unidad === 'peso' ? 'kg' : 'un.'} ×{' '}
                        {formatearMoneda(linea.producto.precioVenta)}
                      </p>
                      {enLaCuenta > linea.producto.stock && (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {linea.producto.stock > 0 ? `Figuran ${formatearCantidad(linea.producto.stock)}` : 'Figura sin stock'}:
                          se vende igual y queda para revisar
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-medium text-slate-700">{formatearMoneda(subtotalDe(linea))}</p>
                    <button
                      onClick={() => quitarDelCarrito(linea.id)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                      title="Sacar de la cuenta"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div data-tour="cuenta-opciones-linea" className="mt-2 flex flex-wrap items-center gap-2">
                    <div data-tour="cuenta-metodo-linea">
                      <select
                        aria-label={`Forma de pago de ${linea.producto.descripcion}`}
                        className={`input w-auto py-1 text-sm ${clasePago(linea.metodo)}`}
                        value={linea.metodo}
                        onChange={(e) => cambiarMetodoDeLinea(linea.id, e.target.value as MetodoPago)}
                      >
                        {METODOS_PAGO.map((m) => (
                          <option key={m.valor} value={m.valor}>
                            {m.etiqueta}
                          </option>
                        ))}
                      </select>
                    </div>

                    {sePuedeDividir && (
                      <button
                        type="button"
                        data-tour="cuenta-dividir"
                        onClick={() => (dividiendoId === linea.id ? setDividiendoId(null) : abrirDividir(linea))}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        title="Pagar una parte de este producto de otra forma (por ejemplo 2 en efectivo y 1 por transferencia)"
                      >
                        <Split className="h-3.5 w-3.5" />
                        Dividir
                      </button>
                    )}

                    {esFiado && (
                      <div data-tour="cuenta-cliente" className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Cliente de ${linea.producto.descripcion}`}
                          className={`input w-auto max-w-[14rem] py-1 text-sm ${
                            linea.clienteId ? '' : 'border-amber-400 bg-white'
                          }`}
                          value={linea.clienteId ?? ''}
                          onChange={(e) => elegirClienteDeLinea(linea.id, e.target.value || null)}
                        >
                          <option value="">¿A quién? Elegir cliente...</option>
                          {/* El cliente ya está elegido (el de la última vez) pero la lista todavía no llegó:
                              si no, el cuadro se vería vacío con "Cobrar" ya habilitado. */}
                          {linea.clienteId && !clientes.some((c) => c.id === linea.clienteId) && (
                            <option value={linea.clienteId}>Cargando cliente...</option>
                          )}
                          {clientes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          data-tour="cuenta-cliente-nuevo"
                          onClick={() => setNuevoClientePara(linea.id)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                          title="Agregar un cliente nuevo a la lista, sin salir de la cuenta"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Cliente nuevo
                        </button>
                      </div>
                    )}
                  </div>

                  {dividiendoId === linea.id && (
                    <div data-dividir className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5">
                      <p className="text-xs font-medium text-slate-600">
                        De {formatearCantidad(linea.cantidad)} {linea.producto.unidad === 'peso' ? 'kg' : 'un.'}, ¿cuántas se pagan de otra forma?
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div className="w-20">
                          <label className="label">Cuántas</label>
                          <input
                            data-dividir-cantidad
                            className="input py-1 text-sm"
                            inputMode="decimal"
                            value={divCantidad}
                            onChange={(e) => cambiarDivCantidad(linea, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmarDividir(linea);
                            }}
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="label">Se pagan con</label>
                          <select
                            data-dividir-metodo
                            className="input w-auto py-1 text-sm"
                            value={divMetodo}
                            onChange={(e) => setDivMetodo(e.target.value as MetodoPago)}
                          >
                            {METODOS_PAGO.map((m) => (
                              <option key={m.valor} value={m.valor}>
                                {m.etiqueta}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button type="button" data-dividir-ok className="btn-primary py-1 text-sm" onClick={() => confirmarDividir(linea)}>
                          Dividir
                        </button>
                        <button type="button" className="btn-secondary py-1 text-sm" onClick={() => setDividiendoId(null)}>
                          Cancelar
                        </button>
                      </div>
                      {divError && <p className="mt-1.5 text-xs text-red-600">{divError}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div data-tour="cuenta-pago" className="w-48">
          <label className="label">{carrito.length > 1 ? 'Forma de pago de todo' : 'Forma de pago'}</label>
          <select
            className="input"
            value={metodoGeneral}
            onChange={(e) => cambiarMetodoGeneral(e.target.value as MetodoPago)}
          >
            {metodoGeneral === '' && (
              <option value="" disabled>
                Varias formas de pago
              </option>
            )}
            {METODOS_PAGO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>

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
          data-tour="cuenta-cobrar"
          className="btn-primary"
          onClick={cobrar}
          disabled={carrito.length === 0 || registrando || faltaCliente}
        >
          <ReceiptText className="h-4 w-4" />
          {registrando ? 'Cobrando...' : 'Cobrar'}
        </button>
      </div>

      {variasFormas && (
        <p data-detalle-pagos className="mt-3 text-sm text-slate-600">
          <span className="font-medium">Se paga así:</span>{' '}
          {METODOS_PAGO.filter((m) => totalDe(m.valor) > 0)
            .map((m) => `${m.etiqueta} ${formatearMoneda(totalDe(m.valor))}`)
            .join(' · ')}
        </p>
      )}
      {hayFiado && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {faltaCliente && (
            <>
              <strong>Falta elegir a quién se le anota lo fiado</strong> (en el renglón marcado en amarillo).{' '}
            </>
          )}
          {totalCobrarAhora > 0
            ? 'Lo que está como "Fiado" se anota a la cuenta de cada cliente; el resto se cobra ahora.'
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

      {nuevoClientePara && (
        <NuevoClienteRapido
          clientesExistentes={clientes}
          onCerrar={() => setNuevoClientePara(null)}
          onCreado={clienteCreado}
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
