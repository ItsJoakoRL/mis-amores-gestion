import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Sparkles, XCircle } from 'lucide-react';
import type { EstadoIa, ResultadoProbarIa } from '@shared/types';
import CampoContrasena from '../../components/CampoContrasena';

// Dólares para mostrar: "US$ 2,31"; lo que no llega a un centavo se dice así para no mostrar un engañoso "US$ 0,00".
function montoUsd(n: number): string {
  if (n > 0 && n < 0.01) return 'menos de US$ 0,01';
  return `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Una idea de cuánto sale cada pregunta según el modelo (una pregunta típica: un par de consultas a la base, unos
// 6.000 tokens de entrada y 1.000 de salida; precios de octubre 2026). Es orientativo.
function costoPorPregunta(modelo: string): string {
  if (/haiku/i.test(modelo)) return 'menos de una décima de centavo de dólar';
  if (/sonnet/i.test(modelo)) return 'unos 2 centavos de dólar (con 30 preguntas por día, alrededor de 15 a 20 dólares por mes)';
  if (/opus/i.test(modelo)) return 'unos 4 centavos de dólar';
  return 'una fracción de dólar (depende del modelo)';
}

// El asistente del botón redondo puede ser una IA de verdad (Claude, de Anthropic). Para eso
// hace falta la clave de una cuenta de Anthropic, que se carga acá. La clave se guarda sólo en
// esta PC (cada PC tiene la suya) y nunca vuelve a la pantalla: se muestra una "pista" para
// reconocerla. Sin clave, o sin internet, el asistente sigue contestando lo básico.
export default function TarjetaIa() {
  const [estado, setEstado] = useState<EstadoIa | null>(null);
  const [clave, setClave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoProbarIa | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El casillero del tope: null = se muestra el valor guardado (así la actualización de fondo no pisa lo que se está escribiendo).
  const [topeTexto, setTopeTexto] = useState<string | null>(null);
  const [guardandoTope, setGuardandoTope] = useState(false);

  const cargar = useCallback(() => {
    window.escritorio?.ia
      .estado()
      .then((e) => {
        setEstado(e);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer el estado de la IA'));
  }, []);

  useEffect(() => {
    cargar();
    // El gasto del mes sube cuando alguien le pregunta al asistente: se actualiza solo.
    const t = setInterval(cargar, 8000);
    return () => clearInterval(t);
  }, [cargar]);

  async function guardarTope(e: FormEvent) {
    e.preventDefault();
    if (topeTexto === null || guardandoTope) return;
    setGuardandoTope(true);
    setError(null);
    try {
      setEstado(await window.escritorio!.ia.fijarTope(Number(topeTexto.trim().replace(',', '.'))));
      setTopeTexto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el tope');
    } finally {
      setGuardandoTope(false);
    }
  }

  async function probar() {
    setProbando(true);
    setResultado(null);
    try {
      setResultado(await window.escritorio!.ia.probar());
    } catch (err) {
      setResultado({ ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo probar la IA' });
    } finally {
      setProbando(false);
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!clave.trim() || guardando) return;
    setGuardando(true);
    setError(null);
    setResultado(null);
    try {
      setEstado(await window.escritorio!.ia.guardarClave(clave));
      setClave('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la clave');
      setGuardando(false);
      return;
    }
    setGuardando(false);
    // Se prueba enseguida: así se sabe en el momento si la clave está bien copiada y tiene saldo.
    await probar();
  }

  async function sacar() {
    if (!confirm('Se saca la clave de esta PC y el asistente vuelve a contestar sólo lo básico, sin IA. ¿Seguro?')) return;
    setError(null);
    setResultado(null);
    try {
      setEstado(await window.escritorio!.ia.guardarClave(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sacar la clave');
    }
  }

  const activa = estado?.configurada === true;
  const porcentaje = estado ? Math.min(100, Math.round((estado.gastoMes.costoUsd / estado.topeMensualUsd) * 100)) : 0;
  const colorBarra = porcentaje >= 100 ? 'bg-red-500' : porcentaje >= 80 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div data-tour="conf-ia" className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Sparkles className="h-4 w-4 text-brand-500" />
          Asistente con IA
        </h2>
        {estado && (
          <span
            data-estado-ia={activa ? 'activa' : 'sin-clave'}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              activa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${activa ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {activa ? 'IA activa' : 'Sin clave: asistente simple'}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-500">
        El botón redondo de abajo a la derecha puede ser una IA de verdad: entiende las preguntas como las escribas
        (“¿qué se vendió más que el mes pasado?”, “¿a quién le conviene cobrarle?”), junta varios datos y se acuerda de lo que
        hablaron. Sólo mira los datos del negocio: no puede vender, cobrar ni cambiar nada. Sin clave, o si no hay internet,
        sigue contestando lo básico.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!estado ? (
        <div className="mt-4 flex items-center text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <>
          {activa && (
            <div className="mt-3 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
              <p className="flex flex-wrap items-center gap-x-2">
                <KeyRound className="h-4 w-4 text-slate-400" />
                <span className="text-slate-500">Clave:</span>
                <span className="font-mono text-slate-700">{estado.pista}</span>
                <span className="text-xs text-slate-400">
                  {estado.origen === 'entorno'
                    ? '(viene de una variable del sistema)'
                    : '(guardada en esta PC; las otras PCs necesitan la suya)'}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-secondary" onClick={probar} disabled={probando}>
                  {probando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Probar que funciona
                </button>
                {estado.origen === 'archivo' && (
                  <button onClick={sacar} className="text-xs text-slate-400 underline hover:text-slate-600">
                    Sacar la clave de esta PC
                  </button>
                )}
              </div>
              {resultado && (
                <p
                  data-resultado-ia={resultado.ok ? 'ok' : 'error'}
                  className={`flex items-start gap-1.5 text-sm ${resultado.ok ? 'text-emerald-700' : 'text-red-700'}`}
                >
                  {resultado.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {resultado.mensaje}
                </p>
              )}
            </div>
          )}

          {activa && (
            <div data-gasto-ia className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
              <p className="text-slate-600">
                Gasto de este mes (aproximado): <b data-gasto-texto>{montoUsd(estado.gastoMes.costoUsd)}</b> de un tope de{' '}
                <b>{montoUsd(estado.topeMensualUsd)}</b>
                <span className="text-slate-400"> · {estado.gastoMes.preguntas} pregunta(s)</span>
              </p>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label="Gasto del mes sobre el tope"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={porcentaje}
              >
                <div className={`h-full rounded-full ${colorBarra}`} style={{ width: `${porcentaje}%` }} />
              </div>
              {estado.topeAlcanzado && (
                <p data-tope-alcanzado className="mt-2 flex items-start gap-1.5 text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Se llegó al tope de este mes: el asistente contesta lo básico (sin IA) hasta el mes que viene o hasta que subas el tope.
                </p>
              )}
              <form onSubmit={guardarTope} className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="tope-ia" className="text-slate-600">
                  Tope por mes (dólares):
                </label>
                <input
                  id="tope-ia"
                  className="input !w-28"
                  inputMode="decimal"
                  autoComplete="off"
                  value={topeTexto ?? String(estado.topeMensualUsd).replace('.', ',')}
                  onChange={(e) => setTopeTexto(e.target.value)}
                />
                <button type="submit" className="btn-secondary" disabled={topeTexto === null || !topeTexto.trim() || guardandoTope}>
                  {guardandoTope && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar tope
                </button>
              </form>
              <p className="mt-1.5 text-xs text-slate-500">
                Es una cuenta aproximada que hace la app con lo que informa la IA en cada respuesta; lo que vale es lo que dice
                platform.claude.com (poné ahí también un tope). Al llegar al tope el asistente deja de usar la IA y contesta lo
                básico. Cada PC lleva su propia cuenta.
              </p>
            </div>
          )}

          <form onSubmit={guardar} className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="clave-ia">
              {activa ? 'Cambiar la clave' : 'Pegá acá la clave de la IA'}
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-[16rem] flex-1">
                <CampoContrasena
                  id="clave-ia"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                />
              </div>
              <button type="submit" className="btn-primary" disabled={!clave.trim() || guardando}>
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar y probar
              </button>
            </div>
            {!activa && resultado && !resultado.ok && (
              <p data-resultado-ia="error" className="mt-2 flex items-start gap-1.5 text-sm text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {resultado.mensaje}
              </p>
            )}
          </form>

          <details className="mt-4 text-sm text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">¿Cómo consigo la clave y cuánto cuesta?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Entrá desde el navegador a <b>platform.claude.com</b> y creá una cuenta (es la de la empresa que hace Claude; no es
                la misma que la de un plan de Claude).
              </li>
              <li>
                En <b>Billing</b> cargá un poco de saldo y poné un <b>tope de gasto mensual</b>: así nunca se pasa de lo que decidas.
              </li>
              <li>
                En <b>API keys</b> creá una clave, copiala (empieza con <b>sk-ant-</b>) y pegala en el casillero de arriba.
              </li>
            </ol>
            <p className="mt-2">
              Se paga sólo lo que se usa. Con el modelo que usa ahora (<span className="font-mono">{estado.modelo}</span>) una
              pregunta cuesta {costoPorPregunta(estado.modelo)}. Además, la app tiene su propio tope mensual (arriba): al llegar,
              el asistente deja de usar la IA hasta el mes que viene.
            </p>
            <p className="mt-2">
              <b>Ojo:</b> el plan Pro de Claude (el de claude.ai) <b>no</b> cubre esto: la IA del asistente se paga aparte, con el
              saldo de la cuenta de platform.claude.com.
            </p>
            <p className="mt-2">
              <b>Qué se manda:</b> cada pregunta y los datos que hagan falta para contestarla (por ejemplo, el total vendido de un
              día o lo que debe un cliente) viajan a Anthropic para armar la respuesta. No se manda la base entera, ni contraseñas.
              Los costos y las ganancias sólo se incluyen si pregunta la administradora.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
