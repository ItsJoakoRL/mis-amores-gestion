import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Globe,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Unplug,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { EstadoRed, EstadoServidorWeb, PcDeLaRed, PcEncontrada, ResultadoSumarPc, ResumenJuntar } from '@shared/types';
import { URL_SERVIDOR_INTERNET } from '@shared/servidor';
import { compararVersiones } from '@shared/versiones';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';
import CampoContrasena from '../../components/CampoContrasena';

// "hace 3 min", "hace 2 h", "ayer 14:30"...
function hace(iso: string | null): string {
  if (!iso) return 'todavía no';
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// El servidor de internet se anota como una "PC" más de la red, pero con una
// dirección completa (https://...): se muestra aparte, en su propia tarjeta.
const esRemota = (pc: PcDeLaRed) => /^https?:\/\//i.test(pc.direccion);

// Cómo trabaja esta PC junto con las otras PCs del negocio. En el negocio todas
// las PCs son iguales: cada una guarda todos los datos y se mantiene al día con
// las demás. Sólo tiene sentido en las PCs — en el celular esta pantalla no aparece.
export default function ConfiguracionPage() {
  const [red, setRed] = useState<EstadoRed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSumar, setMostrarSumar] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [resultadoRevision, setResultadoRevision] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const puenteNuevo = (window.escritorio?.versionPuente ?? 0) >= 3;

  const cargar = useCallback(() => {
    window.escritorio
      ?.red()
      .then((estado) => {
        setRed(estado);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer la configuración'));
  }, []);

  useEffect(() => {
    if (!puenteNuevo) return;
    cargar();
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [cargar, puenteNuevo]);

  async function revisar() {
    setRevisando(true);
    setResultadoRevision(null);
    try {
      const r = await window.escritorio!.revisarRed();
      setResultadoRevision(
        r.revisadas === 0
          ? 'No hay ninguna otra PC en línea para comparar.'
          : r.corregidas === 0
            ? 'Todo coincide: las PCs tienen exactamente lo mismo.'
            : 'Había diferencias y se corrigieron: ahora tienen lo mismo.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer la revisión');
    } finally {
      setRevisando(false);
    }
  }

  async function salir() {
    if (
      !confirm(
        'Esta PC va a dejar de compartir datos con las otras: lo que se cargue acá ya no les llega, ni lo de ellas llega acá. ' +
          'Se queda con todo lo que tiene ahora. ¿Seguro?'
      )
    )
      return;
    setSaliendo(true);
    try {
      await window.escritorio!.salirDeLaRed();
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sacar esta PC de la red');
    } finally {
      setSaliendo(false);
    }
  }

  const servidorInternet = red?.pcs.find(esRemota) ?? null;

  return (
    // Abajo queda lugar de sobra: el botón flotante de ayuda no tapa lo último.
    <div className="mx-auto max-w-3xl animate-slide-up p-8 pb-28">
      <div className="mb-6">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
          Configuración
          <BotonAyuda seccion="Configuración" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">Cómo trabaja esta PC junto con las otras PCs del negocio y los celulares.</p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {!puenteNuevo ? (
        <div className="card p-5">
          <h2 className="font-semibold text-slate-800">Esta PC tiene que actualizarse</h2>
          <p className="mt-1 text-sm text-slate-500">
            Esta pantalla viene de otra PC con una versión más nueva. Buscá actualizaciones desde el menú de la izquierda
            para que esta PC también guarde sus propios datos.
          </p>
        </div>
      ) : !red ? (
        <div className="card flex items-center justify-center p-10 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div data-tour="conf-modo" className="card flex items-start gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/30">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-800">Todas las PCs son iguales</h2>
              <p className="mt-1 text-sm text-slate-500">
                Cada PC guarda todos los datos del negocio (productos, precios, ventas y fiados) y trabaja sola, aunque
                las otras estén apagadas. Lo que se carga en una aparece en las demás al instante, y cuando una vuelve a
                prenderse se pone al día sola.
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-slate-400">Nombre de esta PC: </dt>
                  <dd className="inline font-medium text-slate-700">{red.nombrePc}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-400">Versión: </dt>
                  <dd className="inline font-medium text-slate-700">{red.versionApp}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-slate-400">Dirección para los celulares: </dt>
                  <dd className="inline break-all font-mono text-slate-700">{URL_SERVIDOR_INTERNET}</dd>
                </div>
              </dl>
            </div>
          </div>

          <ListaDePcs
            red={red}
            revisando={revisando}
            resultadoRevision={resultadoRevision}
            onRevisar={revisar}
          />

          {red.avisos.length > 0 && <Avisos avisos={red.avisos} onBorrar={() => window.escritorio?.borrarAvisos().then(cargar)} />}

          <div data-tour="conf-conectar" className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800">
              <Link2 className="h-4 w-4 text-brand-500" />
              Sumar otra PC del negocio
            </h2>
            {red.pendienteDeSumarse && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Esta PC estaba conectada a <b>{red.pendienteDeSumarse.nombre ?? 'otra PC'}</b>. Sumala a la red para que
                  vuelva a tener los datos del negocio.
                </span>
              </p>
            )}
            <p className="mt-2 text-sm text-slate-500">
              Hacé esto en la PC que se suma. Si ya tenía datos propios (ventas, fiados, productos nuevos) se juntan con
              los de la otra PC sin duplicar nada, y desde ahí las dos comparten todo. Hace falta la cuenta de
              administradora de la otra PC.
            </p>
            <button className="btn-primary mt-4" onClick={() => setMostrarSumar(true)}>
              <Link2 className="h-4 w-4" />
              Sumar esta PC a otra
            </button>
          </div>

          <ServidorDeInternet red={red} onCambio={cargar} />

          {red.pcs.some((pc) => !esRemota(pc)) && (
            <div className="px-1">
              <button
                onClick={salir}
                disabled={saliendo}
                className="flex items-center gap-1.5 text-xs text-slate-400 underline hover:text-slate-600"
              >
                <Unplug className="h-3.5 w-3.5" />
                {saliendo ? 'Saliendo...' : 'Dejar de compartir datos con las otras PCs'}
              </button>
            </div>
          )}
        </div>
      )}

      {mostrarSumar && (
        <SumarPcModal
          sugerencia={red?.pendienteDeSumarse ?? null}
          conServidorInternet={servidorInternet !== null}
          onCerrar={() => {
            setMostrarSumar(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// El servidor que se deja en internet (ver SERVIDOR_RENDER.md) para que los
// celulares anden con todas las PCs apagadas. A diferencia de otra PC, él no
// puede llamar a esta (está detrás del router): esta PC es la que le manda sus
// cambios y recibe los del celular.
// Cómo está la relación de esta PC con el servidor, en una palabra y un color.
type EstadoServidor = 'conectado' | 'sincronizando' | 'conectando' | 'sin-respuesta' | 'clave' | 'desconectado';

function estadoDelServidor(conectado: PcDeLaRed | null): EstadoServidor {
  if (!conectado) return 'desconectado';
  if (conectado.enLinea) return conectado.pendientes > 0 ? 'sincronizando' : 'conectado';
  if (/clave/i.test(conectado.error ?? '')) return 'clave';
  // Recién agregado: todavía no hubo tiempo de hablar con él.
  if (!conectado.error && !conectado.ultimaVez) return 'conectando';
  return 'sin-respuesta';
}

const ETIQUETA_ESTADO: Record<EstadoServidor, { texto: string; clases: string; punto: string }> = {
  conectado: { texto: 'Esta PC: conectada', clases: 'bg-emerald-50 text-emerald-700', punto: 'bg-emerald-500' },
  sincronizando: { texto: 'Esta PC: conectada, sincronizando', clases: 'bg-emerald-50 text-emerald-700', punto: 'bg-emerald-500' },
  conectando: { texto: 'Esta PC: conectando...', clases: 'bg-sky-50 text-sky-700', punto: 'bg-sky-500' },
  'sin-respuesta': { texto: 'Esta PC: sin respuesta', clases: 'bg-amber-50 text-amber-700', punto: 'bg-amber-500' },
  clave: { texto: 'Esta PC: desconectada (otra clave de red)', clases: 'bg-red-50 text-red-700', punto: 'bg-red-500' },
  desconectado: { texto: 'Esta PC: desconectada', clases: 'bg-red-50 text-red-700', punto: 'bg-red-500' },
};

// El servidor que se deja en internet (ver SERVIDOR_RENDER.md) para que los
// celulares anden con todas las PCs apagadas. A diferencia de otra PC, él no
// puede llamar a esta (está detrás del router): esta PC es la que le manda sus
// cambios y recibe los del celular.
function ServidorDeInternet({ red, onCambio }: { red: EstadoRed; onCambio: () => void }) {
  const conectado = red.pcs.find(esRemota) ?? null;
  const estado = estadoDelServidor(conectado);
  const etiqueta = ETIQUETA_ESTADO[estado];
  // La dirección de siempre ya viene puesta: sólo hay que tocar "Conectar".
  const [direccion, setDireccion] = useState(URL_SERVIDOR_INTERNET);
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Si el servidor anda (la página del celular), aparte de si esta PC está
  // conectada con él: las dos cosas pueden no coincidir.
  const [web, setWeb] = useState<EstadoServidorWeb | 'consultando'>('consultando');

  const aProbar = conectado?.direccion ?? URL_SERVIDOR_INTERNET;
  useEffect(() => {
    let vigente = true;
    const preguntar = () => {
      window.escritorio
        ?.probarServidor(aProbar)
        .then((r) => {
          if (vigente) setWeb(r);
        })
        .catch(() => {});
    };
    preguntar();
    const t = setInterval(preguntar, 30_000);
    return () => {
      vigente = false;
      clearInterval(t);
    };
  }, [aProbar]);

  async function conectar(e: FormEvent) {
    e.preventDefault();
    if (!direccion.trim()) return;
    setConectando(true);
    setError(null);
    try {
      await window.escritorio!.conectarNube(direccion);
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setConectando(false);
    }
  }

  async function dejar() {
    if (!conectado) return;
    if (
      !confirm(
        'Esta PC va a dejar de usar el servidor de internet: los celulares dejan de ver lo que se cargue acá cuando ' +
          'todas las PCs estén apagadas. ¿Seguro?'
      )
    )
      return;
    await window.escritorio?.olvidarPc(conectado.idPc).catch(() => {});
    onCambio();
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Globe className="h-4 w-4 text-brand-500" />
          Servidor en internet (para el celular)
        </h2>
        <span
          data-estado-servidor={estado}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${etiqueta.clases}`}
        >
          <span className={`h-2 w-2 rounded-full ${etiqueta.punto} ${estado === 'sincronizando' || estado === 'conectando' ? 'animate-pulse' : ''}`} />
          {etiqueta.texto}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Con un servidor en internet, el celular puede cargar y consultar todo aunque todas las PCs estén apagadas. Esta PC le
        manda lo suyo y recibe lo que se cargue desde el celular. Los pasos para armarlo están en la guía
        SERVIDOR_RENDER.md.
      </p>

      <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="text-slate-500">La página del celular (el servidor):</span>
          {web === 'consultando' ? (
            <span className="text-slate-400">comprobando...</span>
          ) : web.funciona ? (
            <span className="font-medium text-emerald-700">
              ● Funciona{web.version ? ` (versión ${web.version})` : ''}
            </span>
          ) : (
            <span className="font-medium text-amber-700">
              ● No contesta (si estaba dormido, tarda hasta un minuto en despertar)
            </span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="text-slate-500">Esta PC con el servidor:</span>
          <span
            className={`font-medium ${
              estado === 'conectado' || estado === 'sincronizando'
                ? 'text-emerald-700'
                : estado === 'conectando' || estado === 'sin-respuesta'
                  ? 'text-amber-700'
                  : 'text-red-700'
            }`}
          >
            ●{' '}
            {estado === 'conectado' || estado === 'sincronizando'
              ? 'Conectada'
              : estado === 'conectando'
                ? 'Conectando...'
                : estado === 'sin-respuesta'
                  ? 'Sin respuesta por ahora'
                  : 'Desconectada'}
          </span>
        </p>
        {web !== 'consultando' && web.funciona && web.mismaRed === false && (
          <p className="text-xs text-red-700">
            La página anda, pero está en <b>otra red</b> (tiene otra clave que las PCs). Por eso esta PC no puede
            sincronizar con ella: hay que ponerle a Render la clave de esta red (<b>MIS_AMORES_CLAVE_RED</b>).
          </p>
        )}
        {web !== 'consultando' && web.funciona && web.mismaRed !== false && estado === 'desconectado' && (
          <p className="text-xs text-slate-500">
            La página anda y está en la misma red que esta PC: tocá <b>Conectar</b> para que esta PC le mande lo suyo.
          </p>
        )}
      </div>

      {conectado && (
        <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-slate-800">
            {conectado.enLinea ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-slate-300" />
            )}
            {estado === 'conectado' && 'Esta PC y el servidor están al día.'}
            {estado === 'sincronizando' && `Pasando cambios con el servidor (${conectado.pendientes} por recibir).`}
            {estado === 'conectando' && 'Hablando con el servidor por primera vez (si estaba dormido, tarda hasta un minuto).'}
            {estado === 'sin-respuesta' && 'El servidor no contesta por ahora. Si estaba dormido, tarda hasta un minuto en despertar.'}
            {estado === 'clave' &&
              'El servidor tiene otra clave de red que esta PC. Hay que ponerle a Render la clave de esta red (MIS_AMORES_CLAVE_RED).'}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-slate-400">{conectado.direccion}</p>
          <p className="mt-1 text-xs text-slate-400">
            Última vez que habló con él: {hace(conectado.ultimaVez)}
            {conectado.version ? ` · versión del servidor: ${conectado.version}` : ''}
          </p>
          {!conectado.enLinea && conectado.error && estado !== 'clave' && (
            <p className="mt-1 text-xs text-amber-700">{conectado.error}</p>
          )}
          <button onClick={dejar} className="mt-2 text-xs text-slate-400 underline hover:text-slate-600">
            Dejar de usar este servidor
          </button>
        </div>
      )}

      {!conectado && (
        <form onSubmit={conectar} className="mt-3 space-y-2">
          <p className="text-sm text-slate-600">Esta PC no está conectada con el servidor. Tocá el botón para conectarla.</p>
          <input
            className="input"
            placeholder="Dirección del servidor (ej. https://mis-amores.onrender.com)"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            autoComplete="off"
          />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit" disabled={conectando || !direccion.trim()}>
            {conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {conectando ? 'Conectando (puede tardar un minuto)...' : 'Conectar con el servidor'}
          </button>
        </form>
      )}
    </div>
  );
}

function ListaDePcs({
  red,
  revisando,
  resultadoRevision,
  onRevisar,
}: {
  red: EstadoRed;
  revisando: boolean;
  resultadoRevision: string | null;
  onRevisar: () => void;
}) {
  const porcentaje =
    red.progreso && red.progreso.total > 0 ? Math.min(100, Math.round((red.progreso.hecho / red.progreso.total) * 100)) : null;
  // El servidor de internet tiene su propia tarjeta más abajo: acá, sólo las PCs del local.
  const pcsDelLocal = red.pcs.filter((pc) => !esRemota(pc));
  return (
    <div data-tour="conf-pcs" className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Laptop className="h-4 w-4 text-brand-500" />
          Las otras PCs del negocio
        </h2>
        {red.sincronizando && !red.poniendoseAlDia && (
          <span className="flex items-center gap-1.5 text-xs text-brand-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sincronizando...
          </span>
        )}
      </div>

      {red.poniendoseAlDia && (
        <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Trayendo los datos de la otra PC{porcentaje !== null ? ` (${porcentaje}%)` : '...'}
          </p>
          {porcentaje !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${porcentaje}%` }} />
            </div>
          )}
        </div>
      )}

      {pcsDelLocal.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay otra PC en la red. Cuando sumes la otra PC del negocio va a aparecer acá, con su estado.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {pcsDelLocal.map((pc) => (
            <FilaPc key={pc.idPc} pc={pc} versionPropia={red.versionApp} />
          ))}
        </ul>
      )}

      {/* Compara con todas las que están en línea, incluido el servidor de internet. */}
      {red.pcs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-secondary" onClick={onRevisar} disabled={revisando}>
            {revisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {revisando ? 'Revisando...' : 'Revisar que todo coincida'}
          </button>
          {resultadoRevision && <span className="text-sm text-slate-500">{resultadoRevision}</span>}
        </div>
      )}
    </div>
  );
}

function FilaPc({ pc, versionPropia }: { pc: PcDeLaRed; versionPropia: string }) {
  // Que esté "en línea" y sin cambios pendientes no quiere decir que esté al día
  // con el programa: si tiene una versión vieja, hay que actualizarla.
  const desactualizada = !!pc.version && compararVersiones(pc.version, versionPropia) < 0;
  const masNueva = !!pc.version && compararVersiones(pc.version, versionPropia) > 0;
  async function olvidar() {
    if (
      !confirm(
        `¿Sacar a "${pc.nombrePc || 'esta PC'}" de la lista? Sólo tiene sentido si esa PC ya no se va a usar: ` +
          'si sigue prendida en la red, vuelve a aparecer sola.'
      )
    )
      return;
    await window.escritorio?.olvidarPc(pc.idPc).catch(() => {});
  }
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      {pc.enLinea ? (
        <Wifi className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0 text-slate-300" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-800">{pc.nombrePc || 'PC del negocio'}</span>
        <span className="block font-mono text-xs text-slate-400">{pc.direccion}</span>
        {pc.version && <span className="block text-xs text-slate-400">Versión {pc.version}</span>}
        {desactualizada && (
          <span className="mt-0.5 block text-xs font-medium text-amber-700">
            Tiene una versión más vieja que esta ({versionPropia}): abrí Mis Amores en esa PC y buscá actualizaciones.
          </span>
        )}
        {masNueva && (
          <span className="mt-0.5 block text-xs font-medium text-sky-700">
            Tiene una versión más nueva que esta PC ({versionPropia}): buscá actualizaciones acá.
          </span>
        )}
        {!pc.enLinea && pc.error && <span className="block text-xs text-slate-400">{pc.error}</span>}
      </span>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          pc.enLinea
            ? desactualizada || masNueva
              ? 'bg-amber-50 text-amber-700'
              : pc.pendientes > 0
                ? 'bg-brand-50 text-brand-700'
                : 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-500'
        }`}
      >
        {pc.enLinea
          ? desactualizada
            ? 'En línea · desactualizada'
            : masNueva
              ? 'En línea · esta PC está atrasada'
              : pc.pendientes > 0
                ? `Recibiendo (${pc.pendientes})`
                : 'En línea, al día'
          : pc.ultimaVez
            ? `Sin conexión · vista ${hace(pc.ultimaVez)}`
            : 'Sin conexión'}
      </span>
      {!pc.enLinea && (
        <button onClick={olvidar} title="Sacar de la lista" className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

function Avisos({ avisos, onBorrar }: { avisos: EstadoRed['avisos']; onBorrar: () => void }) {
  return (
    <div className="card border-amber-200 bg-amber-50/50 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Para revisar
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Cosas que pasaron al juntar lo que se cargó en distintas PCs al mismo tiempo. No se perdió nada, pero conviene mirarlas.
      </p>
      <ul className="mt-3 space-y-1.5">
        {avisos.map((a) => (
          <li key={a.id} className="rounded-lg bg-surface px-3 py-2 text-sm text-slate-700 shadow-sm">
            {a.texto}
            <span className="ml-2 text-xs text-slate-400">{hace(a.fecha)}</span>
          </li>
        ))}
      </ul>
      <button className="btn-secondary mt-3" onClick={onBorrar}>
        Entendido, sacar los avisos
      </button>
    </div>
  );
}

type Paso = 'elegir' | 'revisar' | 'listo';

// Sumarse a la red de otra PC cambia la clave de la red de ésta. Si está
// conectada al servidor de internet (que tiene la clave vieja), deja de hablar
// con él. Casi siempre lo que se quiere es lo contrario: que la OTRA PC se sume
// a ésta.
function AvisoServidorInternet() {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
      <b>Ojo: esta PC está conectada al servidor de internet (el del celular).</b> Si la sumás a la red de otra PC,
      va a dejar de hablar con ese servidor hasta que le cambies la clave en Render. Si lo que querés es juntar las
      PCs, hacelo <b>desde la otra PC</b>: que ella se sume a ésta.
    </p>
  );
}

function SumarPcModal({
  onCerrar,
  sugerencia,
  conServidorInternet,
}: {
  onCerrar: () => void;
  sugerencia: { direccion: string; nombre: string | null } | null;
  /** Esta PC está conectada al servidor de internet. */
  conServidorInternet: boolean;
}) {
  const { sesion } = useAuth();
  const [paso, setPaso] = useState<Paso>('elegir');
  const [buscando, setBuscando] = useState(true);
  const [encontradas, setEncontradas] = useState<PcEncontrada[]>([]);
  const [direccion, setDireccion] = useState(sugerencia?.direccion ?? '');
  const [usuario, setUsuario] = useState(sesion?.usuario ?? '');
  const [password, setPassword] = useState('');
  // Si venía conectada a la otra PC, no tiene nada propio que pasar.
  const [soloTraer, setSoloTraer] = useState(sugerencia !== null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoSumarPc | null>(null);

  async function buscar() {
    setBuscando(true);
    setError(null);
    try {
      const lista = ((await window.escritorio?.buscarPcs()) ?? []).filter((p) => !p.enMiRed);
      setEncontradas(lista);
      const utiles = lista.filter((p) => !p.versionVieja);
      if (utiles.length === 1 && !direccion) setDireccion(utiles[0].direccion);
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

  async function sumar(simular: boolean) {
    setTrabajando(true);
    setError(null);
    try {
      const r = await window.escritorio!.sumarPc({ direccion, usuario, password, simular, soloTraer });
      setResultado(r);
      setPaso(simular ? 'revisar' : 'listo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sumar esta PC a la red');
    } finally {
      setTrabajando(false);
    }
  }

  function revisar(e: FormEvent) {
    e.preventDefault();
    if (!direccion.trim()) {
      setError('Elegí la otra PC de la lista o escribí su dirección.');
      return;
    }
    sumar(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">Sumar esta PC a la red del negocio</h2>
          {paso !== 'listo' && (
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" disabled={trabajando}>
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {paso === 'elegir' && (
            <form id="form-sumar" onSubmit={revisar} className="space-y-5">
              {conServidorInternet && <AvisoServidorInternet />}
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Hacé esto en la PC que <b>se suma</b>. La otra PC tiene que estar prendida, con Mis Amores abierto y
                actualizado, en el mismo WiFi.
              </p>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="label !mb-0">La otra PC</label>
                  <button
                    type="button"
                    onClick={buscar}
                    disabled={buscando}
                    className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${buscando ? 'animate-spin' : ''}`} />
                    Buscar de nuevo
                  </button>
                </div>
                {buscando ? (
                  <p className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-400">
                    <Search className="h-4 w-4" />
                    Buscando PCs con Mis Amores en la red...
                  </p>
                ) : encontradas.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                    No apareció ninguna PC con Mis Amores en la red. Escribí su dirección abajo (la ves en la pantalla
                    Configuración de esa PC).
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
                          direccion === pc.direccion ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
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
                <p className="label">Cuenta de administradora de la otra PC</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Usuario"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <CampoContrasena
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" className="mt-1" checked={soloTraer} onChange={(e) => setSoloTraer(e.target.checked)} />
                <span>
                  Esta PC no tiene nada propio que pasar (es nueva, o venía conectada a la otra): sólo traer los datos de
                  la otra PC.
                </span>
              </label>
            </form>
          )}

          {paso === 'revisar' && resultado && (
            <div className="space-y-4">
              {conServidorInternet && <AvisoServidorInternet />}
              {resultado.resumen ? (
                <>
                  <p className="text-sm text-slate-600">
                    Esto es lo que se va a pasar de esta PC a <b>{resultado.nombrePc}</b>. Todavía no se tocó nada: antes
                    de juntar, esa PC hace un respaldo de sus datos.
                  </p>
                  <ListaResumen resumen={resultado.resumen} />
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Esta PC va a traer todos los datos de <b>{resultado.nombrePc}</b>. Lo que tiene ahora se guarda antes
                  en un respaldo (en "Documentos\Mis Amores - Respaldos").
                </p>
              )}
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Después, las dos PCs comparten todo en el momento. En esta PC vas a tener que volver a entrar con tu
                cuenta (la de la otra PC).
              </p>
            </div>
          )}

          {paso === 'listo' && resultado && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <div>
                <p className="font-semibold text-slate-800">¡Listo! Esta PC ya forma parte de la red.</p>
                <p className="mt-1 text-sm text-slate-500">
                  Tiene todos los datos de <b>{resultado.nombrePc}</b> y desde ahora se mantienen iguales. Volvé a entrar
                  con tu cuenta.
                </p>
              </div>
              {resultado.resumen && (
                <div className="text-left">
                  <ListaResumen resumen={resultado.resumen} />
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          {paso === 'listo' ? (
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Volver a entrar
            </button>
          ) : paso === 'elegir' ? (
            <>
              <button type="button" className="btn-secondary" onClick={onCerrar} disabled={trabajando}>
                Cancelar
              </button>
              <button type="submit" form="form-sumar" className="btn-primary" disabled={trabajando || buscando}>
                {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {trabajando ? 'Revisando...' : 'Revisar qué se pasa'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPaso('elegir')} disabled={trabajando}>
                Volver
              </button>
              <button type="button" className="btn-primary" onClick={() => sumar(false)} disabled={trabajando}>
                {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {trabajando ? 'Trayendo los datos...' : 'Sumar a la red'}
              </button>
            </>
          )}
        </div>
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
    [r.recordatoriosNuevos, 'recordatorio(s)'],
  ];
  const conAlgo = filas.filter(([n]) => n > 0);
  return (
    <div className="space-y-3">
      {conAlgo.length === 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          No hay nada nuevo para pasar: la otra PC ya tiene todo lo de esta.
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
