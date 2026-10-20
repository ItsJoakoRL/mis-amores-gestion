// Servidor HTTP para que los celulares de la misma red WiFi del local puedan
// usar la app entera desde el navegador (Chrome/Safari), conectándose a la
// PC donde corre esta app de escritorio. La PC tiene que estar prendida y la
// app abierta para que los celulares puedan entrar — no es un servidor en la
// nube, vive adentro de la app de escritorio.
import express, { type Request } from 'express';
import cors from 'cors';
import http from 'http';
import os from 'os';
import path from 'path';
import { armarPdfEstado, crearEnlaceEstado, nombreArchivoEstado, verificarEnlaceEstado } from '../estadoCuenta';
import { aplicarCambioPrecios, aplicarCostos, deshacerLotePrecios, lotesDePrecios } from '../repositories/precios';
import {
  MENSAJE_SIN_SESION,
  type ArticuloInput,
  type ArticulosFiltro,
  type CambioPrecioItem,
  type ClienteInput,
  type CostoItem,
  type DatosParaJuntar,
  type EstadoCuenta,
  type Genero,
  type InfoPc,
  type ItemConteo,
  type MetodoPago,
  type Rol,
  type SesionActual,
} from '../../shared/types';
import { juntarDatos } from '../juntarDatos';
import { respaldoExtra } from '../backup';
import { carpetaImagenes } from '../imagenes';
import { escucharCambios } from '../cambiosEnVivo';
import { armarManifiesto, claveDeCopia, claveEsValida, coleccionComoTexto } from '../replica';
import { completarStockBase } from '../sync/aplicar';
import { registrarRutasSync, type DepsRutasSync } from '../sync/rutas';
import { esModoNube } from '../nube';
import { anotarFallo, intentoBloqueado, limpiarFallos } from './limiteIntentos';
import { crearToken, obtenerSesionPorToken, eliminarToken } from './tokenSessions';
import { NOMBRE_HOST } from './mdns';
import { ocultarCostoSiNoAdmin, ocultarCostoSiNoAdminLista, sanitizarInputSegunRol } from '../reglasRol';
import { mensajeParaLaPersona } from '../mensajesError';
import {
  verificarCredenciales,
  listUsuarios,
  listCuentasPublicas,
  crearUsuario,
  actualizarUsuario,
  setUsuarioActivo,
  resetPassword,
  cambiarPasswordPropia,
  eliminarUsuario,
} from '../repositories/usuarios';
import {
  listArticulos,
  getArticulo,
  buscarPorCodigo,
  crearArticulo,
  actualizarArticulo,
  eliminarArticulo,
  restaurarArticulo,
  eliminarDefinitivo,
  vaciarPapelera,
  ajustarStock,
  aplicarConteo,
  historialPrecios,
  movimientosStock,
} from '../repositories/articulos';
import { listFamilias, crearFamilia, listMarcas, crearMarca, listProveedores, crearProveedor } from '../repositories/catalogos';
import { getDashboardStats } from '../repositories/dashboard';
import { getReporteVentas } from '../repositories/reportes';
import { sugerirRubro } from '../repositories/asistente';
import { responderPreguntaInteligente } from '../asistenteIa';
import {
  crearVenta,
  eliminarVenta,
  listVentasPorDia,
  resumenMes,
  resumenHoy,
  listUltimosFiados,
  marcarFiadoPagado,
} from '../repositories/ventas';
import {
  listClientes,
  crearCliente,
  setClienteActivo,
  historialCliente,
  registrarPago,
  eliminarPago,
  eliminarAjuste,
  estadoDeCuenta,
  registrarAjuste,
  actualizarCliente,
  pagosDelDia,
} from '../repositories/clientes';
import {
  listRecordatorios,
  resumenRecordatorios,
  crearRecordatorio,
  actualizarRecordatorio,
  marcarRecordatorioHecho,
  eliminarRecordatorio,
} from '../repositories/recordatorios';

// La versión "en vivo" (desarrollo) usa un puerto distinto al de la app
// instalada de verdad — así se puede tener las dos abiertas a la vez sin que
// una le gane el puerto a la otra y la conexión del celular falle con
// "EADDRINUSE". (En desarrollo se puede elegir otro con MIS_AMORES_PUERTO,
// para probar dos "PCs" en la misma máquina.)
// En un servicio de internet (Render, etc.) el puerto lo da la variable PORT.
export const PUERTO =
  Number(process.env.MIS_AMORES_PUERTO) ||
  (process.env.MIS_AMORES_MODO_SERVIDOR === '1' ? Number(process.env.PORT) : 0) ||
  (process.env.NODE_ENV === 'development' ? 4001 : 4000);

// Para el nombre de la carpeta del respaldo previo a juntar datos, en hora local.
function marcaDeTiempo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export interface InfoServidorWeb {
  puerto: number;
  urls: string[];
  /** Cierra el servidor y libera el puerto — hay que llamarlo al salir de
   * verdad de la app (ver electron/main.ts), para no dejar el puerto
   * ocupado ni conexiones abiertas colgando el apagado del proceso. */
  detener: () => Promise<void>;
}

function tokenDesdeHeader(req: Request): string | undefined {
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
}

function requiereSesion(req: Request): SesionActual {
  const sesion = obtenerSesionPorToken(tokenDesdeHeader(req));
  if (!sesion) throw new Error(MENSAJE_SIN_SESION);
  return sesion;
}

function requiereAdmin(req: Request): SesionActual {
  const sesion = requiereSesion(req);
  if (sesion.rol !== 'admin') throw new Error('Esta acción requiere permisos de administrador');
  return sesion;
}

function filtroDesdeQuery(query: Request['query']): ArticulosFiltro {
  return {
    busqueda: typeof query.busqueda === 'string' && query.busqueda ? query.busqueda : undefined,
    familiaId: typeof query.familiaId === 'string' && query.familiaId ? query.familiaId : null,
    soloStockBajo: query.soloStockBajo === 'true',
    soloSinStock: query.soloSinStock === 'true',
    incluirInactivos: query.incluirInactivos === 'true',
    soloInactivos: query.soloInactivos === 'true',
    soloParaRevisar: query.soloParaRevisar === 'true',
  };
}

// Placas de red "de mentira" que crean programas como VirtualBox, VMware,
// Hyper-V/WSL o las VPN: tienen IP propia, pero un celular del local no
// puede llegar a ellas. Si la PC tenía alguna, su IP podía quedar primera —
// y como la primera es la que va en el código QR y en misamores.local, el
// celular no conectaba. Ahora quedan al final de la lista.
const ADAPTADOR_VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|radmin|vpn|tap-/i;

export function obtenerIpsLan(): string[] {
  const interfaces = os.networkInterfaces();
  const candidatas: Array<{ ip: string; prioridad: number }> = [];
  for (const nombre of Object.keys(interfaces)) {
    for (const info of interfaces[nombre] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // 169.254.x.x: la IP que se pone Windows solo cuando una placa no tiene
      // red de verdad. 192.168.137.x: la del "zona con cobertura inalámbrica
      // móvil" de Windows, que tampoco es la red del local.
      const sinRed = info.address.startsWith('169.254.');
      const secundaria = ADAPTADOR_VIRTUAL.test(nombre) || info.address.startsWith('192.168.137.');
      candidatas.push({ ip: info.address, prioridad: sinRed ? 2 : secundaria ? 1 : 0 });
    }
  }
  return candidatas.sort((a, b) => a.prioridad - b.prioridad).map((c) => c.ip);
}

export async function iniciarServidorWeb(
  distDir: string,
  infoPc: () => InfoPc,
  // null: la sincronización no pudo arrancar; igual se atiende a los celulares.
  sync: Omit<DepsRutasSync, 'requiereAdmin'> | null
): Promise<InfoServidorWeb> {
  const app = express();
  // En internet (ver nube.ts) la app está detrás del balanceador del servicio:
  // la dirección de quien pide viene en X-Forwarded-For.
  const enNube = esModoNube();
  if (enNube) app.set('trust proxy', 1);
  app.use(cors());

  // Envuelve cada ruta con el mismo formato { ok, data } / { ok:false, error }
  // que ya usa el canal IPC de la app de escritorio, para poder reusar el
  // mismo cliente de API del lado del navegador.
  function ruta(fn: (req: Request) => Promise<unknown> | unknown) {
    return async (req: Request, res: express.Response) => {
      try {
        const data = await fn(req);
        res.json({ ok: true, data });
      } catch (err) {
        res.json({ ok: false, error: mensajeParaLaPersona(err) });
      }
    };
  }

  // --- Red de PCs ---
  // Para que otra PC del negocio reconozca a esta en la red antes de
  // sumarse (sin sesión: hace falta para encontrarla).
  app.get(
    '/api/sistema/info',
    ruta(() => infoPc())
  );
  // Recibe toda la base de otra PC y la junta con la de acá (ver
  // juntarDatos.ts): es lo que se hace una vez, al sumar a la red una PC que
  // ya tenía datos propios. Va antes del express.json() general porque los
  // datos pesan mucho más que el límite normal de un pedido.
  let juntandoAhora = false;
  // Pesa cientos de MB y se interpreta antes de mirar la sesión: en internet no
  // se ofrece (las PCs suben sus datos por la sincronización).
  if (enNube) {
    app.post('/api/sistema/juntar-datos', (_req, res) => {
      res.json({ ok: false, error: 'Esto no está disponible en el servidor de internet.' });
    });
  }
  app.post(
    '/api/sistema/juntar-datos',
    express.json({ limit: '300mb' }),
    ruta(async (req) => {
      requiereAdmin(req);
      if (juntandoAhora) throw new Error('Ya se están juntando datos de otra PC. Esperá a que termine.');
      const { datos, simular } = req.body as { datos: DatosParaJuntar; simular?: boolean };
      juntandoAhora = true;
      try {
        const resumen = await juntarDatos(datos, {
          // Si no se aclara, se simula: escribir tiene que ser a propósito.
          simular: simular !== false,
          carpetaImagenes: carpetaImagenes(),
          antesDeEscribir: () => respaldoExtra(`antes-de-juntar-${marcaDeTiempo()}`),
        });
        // Los productos que vinieron de una base anterior no tienen "stock
        // inicial": se les calcula para que el stock siga cerrando, y se anota
        // en el diario para que las otras PCs también lo reciban.
        if (simular === false && sync) {
          await completarStockBase(sync.diario);
          await sync.diario.barrer({ colecciones: ['articulos'], marcaNuevos: 'ahora' });
        }
        return resumen;
      } finally {
        juntandoAhora = false;
      }
    })
  );

  app.use(express.json());
  // Un pedido mal armado (JSON roto) se contesta con un mensaje claro y no con una página de error.
  app.use((err: unknown, _req: Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(400).json({ ok: false, error: 'El pedido no se entendió (datos mal armados).' });
  });
  // Un pedido sin cuerpo (o con uno que no es un objeto) se toma como vacío: así cada ruta dice
  // qué dato falta en vez de dar un error técnico.
  app.use((req, _res, next) => {
    if (req.body === undefined || req.body === null || typeof req.body !== 'object') req.body = {};
    next();
  });

  // --- Compatibilidad con la versión anterior (ver replica.ts) ---
  // Una PC que todavía no se actualizó se "conecta" a ésta y guarda una copia
  // de sus datos: se le sigue dando hasta que se actualice.
  async function autorizarCopia(req: Request): Promise<void> {
    // La copia de la versión anterior es sólo para PCs de la red del local: en
    // internet no se ofrece (entregaría colecciones enteras a quien tenga la clave).
    if (enNube) throw new Error('Esto no está disponible en el servidor de internet.');
    if (await claveEsValida(req.headers['x-clave-copia'])) return;
    requiereAdmin(req);
  }
  app.get(
    '/api/copia/manifiesto',
    ruta(async (req) => {
      await autorizarCopia(req);
      const yo = infoPc();
      return armarManifiesto(yo.idPc, yo.nombrePc, 0);
    })
  );
  app.get('/api/copia/coleccion/:nombre', async (req, res) => {
    try {
      await autorizarCopia(req);
      res.type('application/json').send(await coleccionComoTexto(String(req.params.nombre)));
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'Error desconocido';
      res.status(/sesión|permisos/i.test(mensaje) ? 401 : 500).json({ ok: false, error: mensaje });
    }
  });
  app.get(
    '/api/copia/clave',
    ruta(async (req) => {
      if (enNube) throw new Error('Esto no está disponible en el servidor de internet.');
      requiereAdmin(req);
      return { clave: await claveDeCopia() };
    })
  );

  // --- Sincronización entre PCs (ver sync/rutas.ts) ---
  if (enNube) {
    // Sumar una PC a la red le devuelve la clave de la red a quien entre con una
    // cuenta de administradora: por internet no se ofrece (va primero para
    // ganarle a la ruta de sync/rutas.ts).
    app.post('/api/sync/unirse', (_req, res) => {
      res.json({ ok: false, error: 'Esto no está disponible en el servidor de internet.' });
    });
  }
  if (sync) {
    registrarRutasSync(app, { ...sync, requiereAdmin: (req) => void requiereAdmin(req) });
  } else {
    // La sincronización de esta PC no pudo arrancar: que las otras PCs lo
    // sepan (en vez de creer que esta tiene una versión que no sabe sincronizar).
    app.all('/api/sync/*splat', (_req, res) => {
      res.json({ ok: false, error: 'La sincronización de esta PC no pudo arrancar. Reiniciá Mis Amores en esa PC.' });
    });
  }

  // --- Auth ---
  app.post(
    '/api/auth/login',
    ruta(async (req) => {
      const { usuario, password } = req.body as { usuario: string; password: string };
      // En internet cualquiera puede probar contraseñas: hay un límite de
      // intentos fallidos (ver limiteIntentos.ts).
      const ip = req.ip ?? '';
      if (enNube && intentoBloqueado(ip, String(usuario ?? ''))) {
        throw new Error('Demasiados intentos. Esperá un rato (hasta una hora) y probá de nuevo.');
      }
      const user = await verificarCredenciales(usuario, password);
      if (!user) {
        if (enNube) anotarFallo(ip, String(usuario ?? ''));
        throw new Error('Usuario o contraseña incorrectos');
      }
      if (enNube) limpiarFallos(String(usuario ?? ''));
      const token = crearToken(user);
      return { ...user, token };
    })
  );
  app.post(
    '/api/auth/logout',
    ruta(async (req) => {
      eliminarToken(tokenDesdeHeader(req));
      return true;
    })
  );
  app.get(
    '/api/auth/sesion',
    ruta((req) => obtenerSesionPorToken(tokenDesdeHeader(req)))
  );
  app.get(
    '/api/auth/cuentas',
    ruta(() => {
      // La lista de cuentas para "tocar y entrar" es cómoda en el local, pero
      // en internet le regalaría los nombres de usuario a cualquiera: ahí se
      // escribe el usuario (la pantalla de entrada ya sabe hacerlo).
      if (enNube) throw new Error('Escribí tu usuario y tu contraseña.');
      return listCuentasPublicas();
    })
  );

  // --- Artículos ---
  app.get(
    '/api/articulos',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      return ocultarCostoSiNoAdminLista(await listArticulos(filtroDesdeQuery(req.query)), sesion.rol);
    })
  );
  app.get(
    '/api/articulos/codigo/:codigo',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const art = await buscarPorCodigo(req.params.codigo as string);
      return art ? ocultarCostoSiNoAdmin(art, sesion.rol) : null;
    })
  );
  app.post(
    '/api/articulos/sugerir-rubro',
    ruta((req) => {
      requiereSesion(req);
      return sugerirRubro(req.body.descripcion as string);
    })
  );
  app.get(
    '/api/articulos/:id/historial-precios',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const historial = await historialPrecios(req.params.id as string);
      // Los cambios del precio de costo son sólo para la administradora.
      return sesion.rol === 'admin' ? historial : historial.filter((c) => c.tipo !== 'costo');
    })
  );
  app.get(
    '/api/articulos/:id/movimientos-stock',
    ruta((req) => {
      requiereSesion(req);
      return movimientosStock((req.params.id as string));
    })
  );
  app.get(
    '/api/articulos/:id',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const art = await getArticulo(req.params.id as string);
      return art ? ocultarCostoSiNoAdmin(art, sesion.rol) : null;
    })
  );
  app.post(
    '/api/articulos/eliminar-definitivo',
    ruta((req) => {
      requiereAdmin(req);
      return eliminarDefinitivo(req.body.ids as string[]);
    })
  );
  app.post(
    '/api/articulos/aplicar-conteo',
    ruta((req) => {
      const sesion = requiereSesion(req);
      return aplicarConteo((req.body as { items: ItemConteo[] }).items, sesion.id);
    })
  );
  app.post(
    '/api/articulos/vaciar-papelera',
    ruta((req) => {
      requiereAdmin(req);
      return vaciarPapelera(filtroDesdeQuery(req.query));
    })
  );
  app.post(
    '/api/articulos/:id/restaurar',
    ruta((req) => {
      requiereAdmin(req);
      return restaurarArticulo((req.params.id as string));
    })
  );
  app.post(
    '/api/articulos/:id/ajustar-stock',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const { cantidad, tipo, motivo } = req.body as {
        cantidad: number;
        tipo: 'ingreso' | 'egreso' | 'ajuste';
        motivo: string | null;
      };
      const art = await ajustarStock(req.params.id as string, cantidad, tipo, motivo, sesion.id);
      return ocultarCostoSiNoAdmin(art, sesion.rol);
    })
  );
  app.post(
    '/api/articulos',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const saneado = sanitizarInputSegunRol(req.body as ArticuloInput, sesion.rol, 0);
      return ocultarCostoSiNoAdmin(await crearArticulo(saneado), sesion.rol);
    })
  );
  app.put(
    '/api/articulos/:id',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const actual = await getArticulo((req.params.id as string));
      if (!actual) throw new Error('El artículo no existe');
      // Viene { input, original } (para no pisar lo que otra persona cambió
      // mientras tanto — ver actualizarArticulo) o, de versiones viejas, el
      // artículo solo.
      const cuerpo = req.body as ArticuloInput | { input: ArticuloInput; original?: ArticuloInput };
      const { input, original } =
        'input' in cuerpo && typeof cuerpo.input === 'object' ? cuerpo : { input: cuerpo as ArticuloInput, original: undefined };
      const saneado = sanitizarInputSegunRol(input, sesion.rol, actual.precioCosto);
      const actualizado = await actualizarArticulo(req.params.id as string, saneado, sesion.id, original);
      return ocultarCostoSiNoAdmin(actualizado, sesion.rol);
    })
  );
  app.delete(
    '/api/articulos/:id',
    ruta(async (req) => {
      requiereAdmin(req);
      await eliminarArticulo((req.params.id as string));
      return true;
    })
  );

  // --- Familias / marcas / proveedores ---
  app.get(
    '/api/familias',
    ruta((req) => {
      requiereSesion(req);
      return listFamilias();
    })
  );
  app.post(
    '/api/familias',
    ruta((req) => {
      requiereSesion(req);
      return crearFamilia(req.body.nombre as string);
    })
  );
  app.get(
    '/api/marcas',
    ruta((req) => {
      requiereSesion(req);
      return listMarcas();
    })
  );
  app.post(
    '/api/marcas',
    ruta((req) => {
      requiereSesion(req);
      return crearMarca(req.body.nombre as string);
    })
  );
  app.get(
    '/api/proveedores',
    ruta((req) => {
      requiereSesion(req);
      return listProveedores();
    })
  );
  app.post(
    '/api/proveedores',
    ruta((req) => {
      requiereSesion(req);
      return crearProveedor(req.body);
    })
  );

  // --- Dashboard ---
  app.get(
    '/api/dashboard/stats',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const stats = await getDashboardStats();
      // El valor del inventario a costo es sólo para la administradora.
      return sesion.rol === 'admin' ? stats : { ...stats, valorInventarioCosto: 0 };
    })
  );

  // --- Reportes ---
  app.get(
    '/api/reportes/ventas',
    ruta((req) => {
      requiereSesion(req);
      const { desde, hasta } = req.query as { desde: string; hasta: string };
      return getReporteVentas(desde, hasta);
    })
  );

  // --- Asistente (la IA se maneja desde la PC; el celular sólo pregunta) ---
  app.post(
    '/api/asistente/preguntar',
    ruta((req) => responderPreguntaInteligente(req.body?.pregunta, req.body?.historial, requiereSesion(req)))
  );

  // --- Ventas ---
  app.get(
    '/api/ventas/resumen-mes',
    ruta((req) => {
      requiereSesion(req);
      return resumenMes(Number(req.query.anio), Number(req.query.mes));
    })
  );
  app.get(
    '/api/ventas/resumen-hoy',
    ruta((req) => {
      requiereSesion(req);
      return resumenHoy();
    })
  );
  app.get(
    '/api/ventas/ultimos-fiados',
    ruta((req) => {
      requiereSesion(req);
      const limite = req.query.limite ? Number(req.query.limite) : 20;
      return listUltimosFiados(limite);
    })
  );
  app.get(
    '/api/ventas/dia/:fecha',
    ruta((req) => {
      requiereSesion(req);
      return listVentasPorDia((req.params.fecha as string));
    })
  );
  app.post(
    '/api/ventas',
    ruta((req) => {
      const sesion = requiereSesion(req);
      return crearVenta(req.body, sesion.id);
    })
  );
  app.delete(
    '/api/ventas/:id',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      await eliminarVenta(req.params.id as string, sesion.id);
      return true;
    })
  );
  app.post(
    '/api/ventas/:id/pagado',
    ruta(async (req) => {
      requiereSesion(req);
      await marcarFiadoPagado((req.params.id as string), req.body.pagado as boolean);
      return true;
    })
  );

  // --- Precios y costos masivos (sólo la administradora) ---
  app.post(
    '/api/precios/aplicar',
    ruta((req) => {
      const sesion = requiereAdmin(req);
      const { items, descripcion, loteId } = req.body as { items: CambioPrecioItem[]; descripcion: string; loteId: string };
      return aplicarCambioPrecios(items, descripcion, loteId, sesion.id);
    })
  );
  app.get(
    '/api/precios/lotes',
    ruta((req) => {
      requiereAdmin(req);
      return lotesDePrecios();
    })
  );
  app.post(
    '/api/precios/lotes/:id/deshacer',
    ruta((req) => {
      const sesion = requiereAdmin(req);
      return deshacerLotePrecios(req.params.id as string, sesion.id);
    })
  );
  app.post(
    '/api/precios/costos',
    ruta((req) => {
      const sesion = requiereAdmin(req);
      return aplicarCostos((req.body as { items: CostoItem[] }).items, sesion.id);
    })
  );

  // --- Clientes / fiado ---
  app.get(
    '/api/clientes',
    ruta((req) => {
      requiereSesion(req);
      return listClientes();
    })
  );
  app.post(
    '/api/clientes',
    ruta((req) => {
      const sesion = requiereSesion(req);
      const { deudaInicial, fechaInicial, items, ...input } = req.body as ClienteInput & {
        deudaInicial: number;
        fechaInicial?: string;
        items?: unknown;
      };
      return crearCliente(input, deudaInicial, sesion.id, fechaInicial, items);
    })
  );
  app.get(
    '/api/clientes/:id/historial',
    ruta((req) => {
      requiereSesion(req);
      return historialCliente((req.params.id as string));
    })
  );
  // El estado de cuenta para mandárselo al cliente: los datos, el enlace firmado
  // (el del código QR) y el PDF en base64 (para guardarlo desde la pantalla).
  const estadoOError = async (id: string): Promise<EstadoCuenta> => {
    const estado = await estadoDeCuenta(id);
    if (!estado) throw new Error('Ese cliente ya no está en la lista.');
    return estado;
  };
  app.get(
    '/api/clientes/:id/estado',
    ruta(async (req) => {
      requiereSesion(req);
      return estadoOError(req.params.id as string);
    })
  );
  app.post(
    '/api/clientes/:id/enlace-estado',
    ruta(async (req) => {
      requiereSesion(req);
      await estadoOError(req.params.id as string);
      return crearEnlaceEstado(sync?.claveRed() ?? '', req.params.id as string);
    })
  );
  app.get(
    '/api/clientes/:id/estado-pdf',
    ruta(async (req) => {
      requiereSesion(req);
      return armarPdfEstado(await estadoOError(req.params.id as string)).toString('base64');
    })
  );
  // El enlace del código QR: lo abre quien escanea (sin usuario ni contraseña),
  // por eso va firmado y vence (ver estadoCuenta.ts). Un enlace malo o vencido
  // dice lo mismo, para no dar pistas.
  app.get('/estado/:id/:expira/:firma', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    try {
      const id = String(req.params.id);
      const valido = verificarEnlaceEstado(sync?.claveRed() ?? '', id, String(req.params.expira), String(req.params.firma));
      const estado = valido === 'ok' ? await estadoDeCuenta(id) : null;
      if (!estado) {
        res.status(404).type('text/plain; charset=utf-8').send('Este enlace no es válido o ya venció. Pedile a Mis Amores que te mande uno nuevo.');
        return;
      }
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivoEstado(estado.nombre)}"`,
      });
      res.send(armarPdfEstado(estado));
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('No se pudo armar el estado de cuenta. Probá de nuevo en un rato.');
    }
  });
  app.post(
    '/api/clientes/:id/deuda',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const { monto, nota, fecha, items } = req.body as {
        monto: number;
        nota: string | null;
        fecha?: string;
        items?: unknown;
      };
      await registrarAjuste(req.params.id as string, monto, nota ?? null, sesion.id, fecha, items);
      return true;
    })
  );
  app.put(
    '/api/clientes/:id',
    ruta(async (req) => {
      requiereSesion(req);
      await actualizarCliente(req.params.id as string, req.body as ClienteInput);
      return true;
    })
  );
  app.get(
    '/api/clientes/pagos/dia/:fecha',
    ruta((req) => {
      requiereSesion(req);
      return pagosDelDia(req.params.fecha as string);
    })
  );
  app.post(
    '/api/clientes/:id/activo',
    ruta(async (req) => {
      requiereAdmin(req);
      await setClienteActivo((req.params.id as string), req.body.activo as boolean);
      return true;
    })
  );
  app.post(
    '/api/clientes/:id/pago',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const { monto, nota, metodoPago } = req.body as { monto: number; nota: string | null; metodoPago: MetodoPago };
      await registrarPago((req.params.id as string), monto, sesion.id, nota ?? null, metodoPago);
      return true;
    })
  );
  app.delete(
    '/api/clientes/movimientos/:tipo/:id',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const tipo = req.params.tipo as 'venta' | 'pago' | 'ajuste';
      const id = req.params.id as string;
      if (tipo === 'venta') await eliminarVenta(id, sesion.id);
      else if (tipo === 'pago') await eliminarPago(id);
      else await eliminarAjuste(id);
      return true;
    })
  );

  // --- Recordatorios ---
  app.get(
    '/api/recordatorios/resumen',
    ruta((req) => {
      requiereSesion(req);
      return resumenRecordatorios();
    })
  );
  app.get(
    '/api/recordatorios',
    ruta((req) => {
      requiereSesion(req);
      return listRecordatorios(req.query.estado === 'hechos' ? 'hechos' : 'pendientes');
    })
  );
  app.post(
    '/api/recordatorios',
    ruta((req) => {
      const sesion = requiereSesion(req);
      return crearRecordatorio(req.body, sesion.id);
    })
  );
  app.put(
    '/api/recordatorios/:id',
    ruta((req) => {
      requiereSesion(req);
      return actualizarRecordatorio(req.params.id as string, req.body);
    })
  );
  app.post(
    '/api/recordatorios/:id/hecho',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      await marcarRecordatorioHecho(req.params.id as string, req.body.hecho === true, sesion.id);
      return true;
    })
  );
  app.delete(
    '/api/recordatorios/:id',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      await eliminarRecordatorio(req.params.id as string, sesion.id, sesion.rol === 'admin');
      return true;
    })
  );

  // --- Usuarios (sólo admin) ---
  app.get(
    '/api/usuarios',
    ruta((req) => {
      requiereAdmin(req);
      return listUsuarios();
    })
  );
  app.post(
    '/api/usuarios',
    ruta((req) => {
      requiereAdmin(req);
      const { nombre, usuario, password, rol, genero } = req.body as {
        nombre: string;
        usuario: string;
        password: string;
        rol: Rol;
        genero: Genero;
      };
      return crearUsuario(nombre, usuario, password, rol, genero);
    })
  );
  app.put(
    '/api/usuarios/:id',
    ruta((req) => {
      requiereAdmin(req);
      const { nombre, usuario, rol, genero } = req.body as {
        nombre: string;
        usuario: string;
        rol: Rol;
        genero: Genero;
      };
      return actualizarUsuario((req.params.id as string), nombre, usuario, rol, genero);
    })
  );
  app.post(
    '/api/usuarios/:id/activo',
    ruta(async (req) => {
      const sesion = requiereAdmin(req);
      const id = req.params.id as string;
      const activo = req.body.activo === true;
      if (sesion.id === id && !activo) throw new Error('No podés desactivar tu propia cuenta mientras estás usándola.');
      await setUsuarioActivo(id, activo);
      return true;
    })
  );
  app.post(
    '/api/usuarios/:id/reset-password',
    ruta(async (req) => {
      const sesion = requiereAdmin(req);
      const id = req.params.id as string;
      const password = req.body.password as string;
      // Si se cambia la suya, esta sesión sigue abierta (las otras se cierran).
      await resetPassword(id, password, sesion.id === id ? tokenDesdeHeader(req) : null);
      return true;
    })
  );
  app.post(
    '/api/usuarios/mi-password',
    ruta(async (req) => {
      const sesion = requiereSesion(req);
      const { actual, nueva } = (req.body ?? {}) as { actual?: string; nueva?: string };
      await cambiarPasswordPropia(sesion.id, String(actual ?? ''), String(nueva ?? ''), tokenDesdeHeader(req));
      return true;
    })
  );
  app.delete(
    '/api/usuarios/:id',
    ruta(async (req) => {
      const sesion = requiereAdmin(req);
      const id = req.params.id as string;
      if (sesion.id === id) throw new Error('No podés eliminar tu propia cuenta mientras estás usándola.');
      await eliminarUsuario(id);
      return true;
    })
  );

  // Nota: elegir una foto de producto abre el explorador de archivos de
  // Windows — eso no existe en un navegador de celular, así que ese botón
  // avisa que no se puede desde ahí (ver src/webApiClient.ts).

  // Las fotos de los productos: en esta PC se ven directo del disco, pero
  // los celulares y la PC conectada las piden por acá (antes no se veían).
  // Sin sesión porque una etiqueta <img> no puede mandar el token; igual
  // sólo se puede pedir un archivo de esa carpeta, por su nombre.
  app.get('/imagenes/:archivo', (req, res) => {
    const archivo = path.basename(String(req.params.archivo));
    res.sendFile(path.join(carpetaImagenes(), archivo), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // Aviso en vivo: la pantalla (en un celular) se vuelve a cargar sola cuando
  // alguien, desde cualquier PC o celular, cambia algo. No lleva datos, sólo
  // el aviso de que hay algo nuevo para pedir.
  // En internet no pide sesión (un EventSource no puede mandar el token), así
  // que se pone un tope: nadie puede dejar abiertas miles de conexiones.
  let conexionesEventos = 0;
  const MAX_EVENTOS_NUBE = 100;
  app.get('/api/eventos', (req, res) => {
    if (enNube && conexionesEventos >= MAX_EVENTOS_NUBE) {
      res.status(503).end();
      return;
    }
    conexionesEventos += 1;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const latido = setInterval(() => res.write(': latido\n\n'), 25_000);
    const parar = escucharCambios(() => res.write('event: cambio\ndata: 1\n\n'));
    req.on('close', () => {
      conexionesEventos -= 1;
      clearInterval(latido);
      parar();
    });
  });

  // --- Sirve la app ya compilada para que el celular la abra como una
  // página web normal, en la misma dirección que la API. ---
  // Una dirección de la API que no existe (por ejemplo con un dato vacío) contesta con un mensaje,
  // no con la página de la aplicación (que el celular intentaría leer como datos).
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'No se encontró lo que se pidió: esa dirección no existe.' });
  });
  app.use(express.static(distDir));
  // Express 5 exige que el comodín tenga nombre (ya no alcanza con '*' solo).
  app.get('/*splat', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const servidor = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(PUERTO, '0.0.0.0', () => resolve());
  });

  const ipsLan = obtenerIpsLan();
  // La IP va primero (y es la que se usa para el código QR): funciona en
  // cualquier celular sin importar el modelo. El nombre "misamores.local"
  // (resuelto por mdns.ts) queda como respaldo — es más fácil de recordar,
  // pero varios Android/Chrome no resuelven bien los nombres ".local" y
  // terminan con "no se puede acceder a este sitio" aunque estén en la
  // misma red.
  const urls = [...ipsLan.map((ip) => `http://${ip}:${PUERTO}`), `http://${NOMBRE_HOST}:${PUERTO}`];
  const detener = () =>
    new Promise<void>((resolve) => {
      // closeAllConnections (Node 18.2+) corta de una las conexiones ya
      // abiertas (ej. un celular con la app abierta) — si no, server.close()
      // espera a que se cierren solas y puede tardar o no completarse nunca
      // mientras alguien la sigue usando desde el celular.
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
  return { puerto: PUERTO, urls, detener };
}
