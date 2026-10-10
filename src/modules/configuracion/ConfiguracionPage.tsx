import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Smartphone,
  Unplug,
  X,
} from 'lucide-react';
import type { InfoModoPc, InfoRed, PcEncontrada, ResumenJuntar, ResumenSubidaBase } from '@shared/types';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';

// Cómo está armada esta PC dentro del negocio: si es la "principal" (la que
// guarda todos los datos) o está "conectada" a la principal. Sólo tiene
// sentido en las PCs — en el celular esta pantalla no aparece.
export default function ConfiguracionPage() {
  const [info, setInfo] = useState<InfoModoPc | null>(null);
  const [red, setRed] = useState<InfoRed>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrarConectar, setMostrarConectar] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  useEffect(() => {
    window.escritorio
      ?.modo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer la configuración'));
    if (window.api.esElectron) window.api.sistema.infoRed().then(setRed).catch(() => {});
  }, []);

  async function desconectar() {
    if (
      !confirm(
        'Esta PC va a dejar de usar la PC principal y vuelve a usar sus datos propios, que quedaron como estaban el día que se conectó (sin nada de lo que se cargó después). ¿Seguro?'
      )
    )
      return;
    setDesconectando(true);
    try {
      await window.escritorio?.desconectar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desconectar');
      setDesconectando(false);
    }
  }

  const direccionCelular = red && 'urls' in red ? red.urls[0] : null;

  return (
    <div className="mx-auto max-w-3xl animate-slide-up p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
          Configuración
          <BotonAyuda seccion="Configuración" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">Cómo trabaja esta PC junto con la otra PC del negocio y los celulares.</p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {!info ? (
        <div className="card flex items-center justify-center p-10 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : info.modo === 'principal' ? (
        <div className="space-y-4">
          <div data-tour="conf-modo" className="card flex items-start gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/30">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-800">
                {info.baseCompartida ? 'Esta PC usa la base compartida' : 'Esta PC es la principal'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {info.baseCompartida ? (
                  <>
                    Los datos (productos, precios, ventas y fiados) están en la base compartida: todas las PCs y celulares
                    que usan la misma ven lo mismo al instante, sin que ninguna tenga que quedar prendida.
                  </>
                ) : (
                  <>
                    Acá se guardan todos los datos: productos, precios, ventas y fiados. Los celulares y la otra PC del
                    negocio se conectan a esta, así todos ven lo mismo al instante. Tiene que quedar prendida con Mis
                    Amores abierto.
                  </>
                )}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-slate-400">Nombre de esta PC: </dt>
                  <dd className="inline font-medium text-slate-700">{info.nombrePc}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-400">Versión: </dt>
                  <dd className="inline font-medium text-slate-700">{info.versionApp}</dd>
                </div>
                {direccionCelular && (
                  <div className="sm:col-span-2">
                    <dt className="inline text-slate-400">Dirección en la red: </dt>
                    <dd className="inline font-mono text-slate-700">{direccionCelular}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <BaseCompartidaCard info={info} onError={setError} />

          {!info.baseCompartida && (
          <div data-tour="conf-conectar" className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800">
              <Link2 className="h-4 w-4 text-brand-500" />
              ¿Esta no tendría que ser la principal?
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Si en el negocio hay otra PC que va a ser la principal, conectá esta a esa. Lo que se cargó en esta PC
              (ventas, fiados, pagos, clientes, productos nuevos, códigos y precios) se pasa a la principal, y desde ahí
              esta PC trabaja con los datos de la principal.
            </p>
            <button className="btn-primary mt-4" onClick={() => setMostrarConectar(true)}>
              <Link2 className="h-4 w-4" />
              Conectar esta PC a la principal
            </button>
          </div>
          )}
        </div>
      ) : (
        <div data-tour="conf-modo" className="card flex items-start gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-500/30">
            <Laptop className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-800">Esta PC está conectada a la principal</h2>
            <p className="mt-1 text-sm text-slate-500">
              Todo lo que se carga acá se guarda en <b>{info.nombrePrincipal ?? 'la PC principal'}</b>
              {info.direccionPrincipal && <span className="font-mono"> ({info.direccionPrincipal})</span>}. Esa PC tiene
              que estar prendida con Mis Amores abierto para que esta funcione.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
              <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
              Los celulares también se conectan a la principal.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Esta PC: {info.nombrePc} · versión {info.versionApp}
            </p>
            <button className="btn-secondary mt-4" onClick={desconectar} disabled={desconectando}>
              <Unplug className="h-4 w-4" />
              {desconectando ? 'Desconectando...' : 'Dejar de usar la PC principal'}
            </button>
          </div>
        </div>
      )}

      {mostrarConectar && <ConectarPrincipalModal onCerrar={() => setMostrarConectar(false)} />}
    </div>
  );
}

function BaseCompartidaCard({ info, onError }: { info: InfoModoPc; onError: (m: string | null) => void }) {
  const [direccion, setDireccion] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [probada, setProbada] = useState<{ datos: number } | null>(null);
  const [resumen, setResumen] = useState<ResumenSubidaBase | null>(null);
  const [terminado, setTerminado] = useState(false);

  async function probar() {
    onError(null);
    setTrabajando(true);
    setProbada(null);
    try {
      setProbada(await window.escritorio!.probarBaseCompartida(direccion));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo probar la conexión');
    } finally {
      setTrabajando(false);
    }
  }

  async function usar(subirDatos: boolean) {
    onError(null);
    setTrabajando(true);
    try {
      setResumen(await window.escritorio!.usarBaseCompartida({ uri: direccion, subirDatos }));
      setTerminado(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo pasar a la base compartida');
      setTrabajando(false);
    }
  }

  async function volverALaPropia() {
    if (!confirm('Esta PC vuelve a usar su base propia (la que tenía antes de pasar a la compartida). ¿Seguro?')) return;
    onError(null);
    setTrabajando(true);
    try {
      await window.escritorio!.dejarBaseCompartida();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo volver a la base propia');
      setTrabajando(false);
    }
  }

  if (terminado) {
    return (
      <div className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          Listo: esta PC ya usa la base compartida
        </h2>
        {resumen && (
          <p className="mt-1 text-sm text-slate-500">
            Se subieron {resumen.documentos} registros ({resumen.colecciones} listas) y {resumen.imagenes} fotos.
          </p>
        )}
        <p className="mt-2 text-sm text-slate-500">La app se reinicia sola en unos segundos.</p>
      </div>
    );
  }

  if (info.baseCompartida) {
    return (
      <div className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Cloud className="h-4 w-4 text-brand-500" />
          Base compartida
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Conectada a <span className="font-mono text-slate-700">{info.baseCompartida}</span>. Para sumar otra PC, abrí
          Configuración en esa y pegá la misma dirección.
        </p>
        <button className="btn-secondary mt-4" onClick={volverALaPropia} disabled={trabajando}>
          <Unplug className="h-4 w-4" />
          {trabajando ? 'Cambiando...' : 'Volver a la base propia de esta PC'}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <Cloud className="h-4 w-4 text-brand-500" />
        Usar una base compartida (sin PC principal)
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Con una base compartida (MongoDB Atlas) todas las PCs y celulares ven los mismos datos al instante, y no hace falta
        que una quede prendida. Pegá la dirección de la base que te da MongoDB Atlas.
      </p>
      <input
        type="password"
        className="input mt-3 font-mono text-xs"
        placeholder="mongodb+srv://usuario:contraseña@cluster.mongodb.net/"
        value={direccion}
        onChange={(e) => {
          setDireccion(e.target.value);
          setProbada(null);
        }}
        autoComplete="off"
      />
      {probada && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Conectó bien.{' '}
          {probada.datos === 0
            ? 'La base está vacía: podés subir los datos de esta PC.'
            : 'La base ya tiene datos cargados (de otra PC): conectá esta para usarlos.'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!probada && (
          <button className="btn-primary" onClick={probar} disabled={trabajando || !direccion.trim()}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Probar conexión
          </button>
        )}
        {probada && probada.datos === 0 && (
          <button className="btn-primary" onClick={() => usar(true)} disabled={trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Subir los datos de esta PC y usar la compartida
          </button>
        )}
        {probada && probada.datos > 0 && (
          <button className="btn-primary" onClick={() => usar(false)} disabled={trabajando}>
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Usar la base compartida
          </button>
        )}
      </div>
    </div>
  );
}

type Paso = 'elegir' | 'revisar' | 'listo';

function ConectarPrincipalModal({ onCerrar }: { onCerrar: () => void }) {
  const { sesion } = useAuth();
  const [paso, setPaso] = useState<Paso>('elegir');
  const [buscando, setBuscando] = useState(true);
  const [encontradas, setEncontradas] = useState<PcEncontrada[]>([]);
  const [direccion, setDireccion] = useState('');
  const [usuario, setUsuario] = useState(sesion?.usuario ?? '');
  const [password, setPassword] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenJuntar | null>(null);
  const [nombrePrincipal, setNombrePrincipal] = useState<string | null>(null);

  async function buscar() {
    setBuscando(true);
    setError(null);
    try {
      const lista = (await window.escritorio?.buscarPcsPrincipales()) ?? [];
      setEncontradas(lista);
      const unica = lista.filter((p) => !p.versionVieja);
      if (unica.length === 1 && !direccion) setDireccion(unica[0].direccion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar en la red');
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function conectar(simular: boolean) {
    setTrabajando(true);
    setError(null);
    try {
      const resultado = await window.escritorio!.conectarAPrincipal({ direccion, usuario, password, simular });
      setResumen(resultado.resumen);
      setNombrePrincipal(resultado.nombrePrincipal);
      setPaso(simular ? 'revisar' : 'listo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con la PC principal');
    } finally {
      setTrabajando(false);
    }
  }

  function revisar(e: FormEvent) {
    e.preventDefault();
    if (!direccion.trim()) {
      setError('Elegí la PC principal de la lista o escribí su dirección.');
      return;
    }
    conectar(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">Conectar esta PC a la principal</h2>
          {paso !== 'listo' && (
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" disabled={trabajando}>
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {paso === 'elegir' && (
            <form id="form-conectar" onSubmit={revisar} className="space-y-5">
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Hacé esto en la PC que <b>deja</b> de tener sus datos propios. La principal tiene que estar prendida, con
                Mis Amores abierto y actualizado, en el mismo WiFi.
              </p>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="label !mb-0">PC principal</label>
                  <button
                    type="button"
                    onClick={buscar}
                    disabled={buscando}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${buscando ? 'animate-spin' : ''}`} />
                    Buscar de nuevo
                  </button>
                </div>
                {buscando ? (
                  <p className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-400">
                    <Search className="h-4 w-4" />
                    Buscando la PC principal en la red...
                  </p>
                ) : encontradas.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                    No apareció ninguna PC con Mis Amores en la red. Escribí su dirección abajo (la ves en la pantalla
                    Configuración de la principal).
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {encontradas.map((pc) => (
                      <button
                        key={pc.direccion}
                        type="button"
                        disabled={pc.versionVieja}
                        onClick={() => setDireccion(pc.direccion)}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          direccion === pc.direccion
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Server className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-800">{pc.nombrePc ?? 'PC con Mis Amores'}</span>
                          <span className="block font-mono text-xs text-slate-400">{pc.direccion}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {pc.versionVieja ? 'Hay que actualizarla primero' : `versión ${pc.version}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="input mt-2"
                  placeholder="O escribí la dirección (ej. 192.168.1.50)"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                />
              </div>

              <div>
                <p className="label">Cuenta de administradora en la PC principal</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Usuario"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
            </form>
          )}

          {paso === 'revisar' && resumen && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Esto es lo que se va a pasar de esta PC a <b>{nombrePrincipal}</b>. Todavía no se tocó nada: antes de
                juntar, la principal hace un respaldo de sus datos.
              </p>
              <ListaResumen resumen={resumen} />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Después, esta PC se reinicia y queda trabajando con los datos de la principal. Sus datos propios quedan
                guardados acá, sin tocar, por las dudas.
              </p>
            </div>
          )}

          {paso === 'listo' && resumen && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <div>
                <p className="font-semibold text-slate-800">¡Listo! Los datos ya están en {nombrePrincipal}.</p>
                <p className="mt-1 text-sm text-slate-500">
                  La app se reinicia sola en unos segundos y queda conectada a la principal.
                </p>
              </div>
              <div className="text-left">
                <ListaResumen resumen={resumen} />
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {paso !== 'listo' && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {paso === 'elegir' ? (
              <>
                <button type="button" className="btn-secondary" onClick={onCerrar} disabled={trabajando}>
                  Cancelar
                </button>
                <button type="submit" form="form-conectar" className="btn-primary" disabled={trabajando || buscando}>
                  {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {trabajando ? 'Revisando...' : 'Revisar qué se pasa'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={() => setPaso('elegir')} disabled={trabajando}>
                  Volver
                </button>
                <button type="button" className="btn-primary" onClick={() => conectar(false)} disabled={trabajando}>
                  {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  {trabajando ? 'Juntando los datos...' : 'Juntar y conectar'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ListaResumen({ resumen: r }: { resumen: ResumenJuntar }) {
  const filas: Array<[number, string]> = [
    [r.ventasNuevas, 'venta(s)'],
    [r.pagosNuevos, 'pago(s) de fiados'],
    [r.ajustesNuevos, 'saldo(s) cargados a mano'],
    [r.clientesNuevos, 'cliente(s) nuevos'],
    [r.clientesUnidos, 'cliente(s) que estaban anotados en las dos PCs (quedan como uno solo)'],
    [r.articulosNuevos, 'producto(s) nuevos'],
    [r.preciosActualizados, 'producto(s) con un precio más nuevo'],
    [r.codigosAsignados, 'código(s) de barras cargados'],
    [r.stockAjustado, 'producto(s) con el stock actualizado (por lo vendido o repuesto en esta PC)'],
    [r.usuariosNuevos, 'usuario(s) nuevos'],
    [r.rubrosNuevos + r.marcasNuevas + r.proveedoresNuevos, 'rubro(s), marca(s) o proveedor(es) nuevos'],
    [r.imagenesCopiadas, 'foto(s) de productos'],
  ];
  const conAlgo = filas.filter(([n]) => n > 0);
  return (
    <div className="space-y-3">
      {conAlgo.length === 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          No hay nada nuevo para pasar: la principal ya tiene todo lo de esta PC.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {conAlgo.map(([n, texto]) => (
            <li key={texto} className="flex items-baseline gap-3 px-3 py-2 text-sm">
              <span className="w-12 shrink-0 text-right font-semibold text-slate-800">{n}</span>
              <span className="text-slate-600">{texto}</span>
            </li>
          ))}
        </ul>
      )}
      {r.avisos.length > 0 && (
        <ul className="space-y-1.5">
          {r.avisos.map((aviso) => (
            <li key={aviso} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {aviso}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
