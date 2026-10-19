import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Flashlight, FlashlightOff, Loader2, Sun, X, ZoomIn, ZoomOut } from 'lucide-react';
import { esTactil } from '../utils/dispositivo';

/** Lo que la pantalla le contesta al lector después de cada código leído. */
export interface RespuestaDeCodigo {
  /** Un aviso corto para mostrar abajo ("+1 · ALFAJOR", "No está cargado"...). */
  mensaje?: string;
  tipo?: 'ok' | 'error';
  /** Cerrar la cámara (por ejemplo, si ahora hay que escribir algo). */
  cerrar?: boolean;
}

interface Props {
  titulo?: string;
  /** Qué hace la pantalla con cada código que se lee. */
  alLeer: (codigo: string) => Promise<RespuestaDeCodigo | void> | RespuestaDeCodigo | void;
  onCerrar: () => void;
}

/** ¿Tiene sentido ofrecer la cámara? Sólo en celulares y tablets (en la PC está la
 * lectora de códigos) y en una página segura (https): sin eso el navegador no la deja usar. */
export function puedeUsarCamara(): boolean {
  try {
    return esTactil() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  } catch {
    return false;
  }
}

interface Motor {
  nombre: 'nativo' | 'zxing';
  /** Mira un cuadro del video y devuelve el código que encuentre (o null). */
  leer: (video: HTMLVideoElement) => Promise<string | null>;
}

interface DetectorNativo {
  detect(fuente: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface ConstructorDetector {
  new (opciones: { formats: string[] }): DetectorNativo;
  getSupportedFormats?: () => Promise<string[]>;
}

const FORMATOS_NATIVOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

// Se usa el lector que trae el celular (BarcodeDetector, el de Android/Chrome: rápido y
// muy bueno con poca luz) y, si no lo tiene (iPhone, Chrome de PC), la librería ZXing,
// que se descarga recién en ese momento (no pesa para el resto de la gente).
async function crearMotor(): Promise<Motor> {
  const Detector = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
  if (Detector) {
    try {
      const soportados = (await Detector.getSupportedFormats?.()) ?? FORMATOS_NATIVOS;
      const formatos = FORMATOS_NATIVOS.filter((f) => soportados.includes(f));
      if (formatos.length > 0) {
        const detector = new Detector({ formats: formatos });
        return {
          nombre: 'nativo',
          leer: async (video) => (await detector.detect(video))[0]?.rawValue ?? null,
        };
      }
    } catch {
      /* si falla, se usa ZXing */
    }
  }
  const zx = await import('@zxing/library');
  const hints = new Map<import('@zxing/library').DecodeHintType, unknown>();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.EAN_13,
    zx.BarcodeFormat.EAN_8,
    zx.BarcodeFormat.UPC_A,
    zx.BarcodeFormat.UPC_E,
    zx.BarcodeFormat.CODE_128,
    zx.BarcodeFormat.CODE_39,
    zx.BarcodeFormat.ITF,
  ]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  const lector = new zx.MultiFormatReader();
  lector.setHints(hints);
  const lienzo = document.createElement('canvas');
  const contexto = lienzo.getContext('2d', { willReadFrequently: true });
  return {
    nombre: 'zxing',
    leer: async (video) => {
      const ancho = video.videoWidth;
      const alto = video.videoHeight;
      if (!ancho || !alto || !contexto) return null;
      // Un cuadro un poco más chico se lee más rápido y alcanza para un código de barras.
      const escala = Math.min(1, 1000 / ancho);
      lienzo.width = Math.round(ancho * escala);
      lienzo.height = Math.round(alto * escala);
      contexto.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      try {
        const imagen = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.HTMLCanvasElementLuminanceSource(lienzo)));
        return lector.decode(imagen).getText();
      } catch {
        return null; // no hay ningún código en este cuadro
      }
    },
  };
}

// Lo que la cámara de este celular deja controlar. La linterna (el flash) y el zoom sólo
// aparecen si el celular los ofrece: en los Android con Chrome suele andar; el iPhone no
// deja prender la linterna desde una página de internet.
interface Controles {
  linterna: boolean;
  zoom: { min: number; max: number; step: number } | null;
}
const SIN_CONTROLES: Controles = { linterna: false, zoom: null };
const CLAVE_LINTERNA = 'misAmores.linterna';

function leerControles(pista: MediaStreamTrack): Controles {
  try {
    const c = (pista.getCapabilities?.() ?? {}) as { torch?: boolean; zoom?: { min: number; max: number; step?: number } };
    const zoom = c.zoom && Number.isFinite(c.zoom.min) && Number.isFinite(c.zoom.max) && c.zoom.max > c.zoom.min ? c.zoom : null;
    return {
      linterna: c.torch === true,
      zoom: zoom ? { min: zoom.min, max: zoom.max, step: zoom.step && zoom.step > 0 ? zoom.step : (zoom.max - zoom.min) / 20 } : null,
    };
  } catch {
    return SIN_CONTROLES;
  }
}

function explicarError(err: unknown): string {
  const nombre = err instanceof Error ? err.name : '';
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
    return 'No diste permiso para usar la cámara. Activalo desde el candado de la barra de direcciones y volvé a intentar.';
  }
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'Este aparato no tiene una cámara que se pueda usar.';
  if (nombre === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación. Cerrala y volvé a intentar.';
  return 'No se pudo abrir la cámara' + (err instanceof Error && err.message ? `: ${err.message}` : '.');
}

// La cámara como lectora de códigos de barras. Queda abierta para ir leyendo uno tras
// otro (contar, vender); cada código se lo pasa a la pantalla, que contesta qué hizo.
export default function LectorCamara({ titulo = 'Escaneá el código de barras', alLeer, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'error'>('abriendo');
  const [motor, setMotor] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<RespuestaDeCodigo | null>(null);
  const pistaRef = useRef<MediaStreamTrack | null>(null);
  const [controles, setControles] = useState<Controles>(SIN_CONTROLES);
  const [linterna, setLinterna] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  // Si lo que ve la cámara está muy oscuro (para avisar que prenda la linterna o busque luz).
  const [oscuro, setOscuro] = useState(false);
  const [mensajeControl, setMensajeControl] = useState<string | null>(null);

  async function aplicarARestricciones(restriccion: Record<string, unknown>): Promise<boolean> {
    const pista = pistaRef.current;
    if (!pista) return false;
    try {
      await pista.applyConstraints({ advanced: [restriccion as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  async function cambiarLinterna() {
    const nueva = !linterna;
    if (await aplicarARestricciones({ torch: nueva })) {
      setLinterna(nueva);
      try {
        sessionStorage.setItem(CLAVE_LINTERNA, nueva ? '1' : '0');
      } catch {
        /* sin memoria del navegador: no pasa nada */
      }
    } else {
      setMensajeControl('Este celular no dejó prender la linterna');
      setTimeout(() => setMensajeControl(null), 2800);
    }
  }

  async function cambiarZoom(valor: number) {
    setZoom(valor);
    await aplicarARestricciones({ zoom: valor });
  }

  // Siempre la última versión de lo que hace la pantalla con el código.
  const alLeerRef = useRef(alLeer);
  alLeerRef.current = alLeer;
  const alCerrarRef = useRef(onCerrar);
  alCerrarRef.current = onCerrar;

  useEffect(() => {
    let vivo = true;
    let flujo: MediaStream | null = null;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let apagarAviso: ReturnType<typeof setTimeout> | undefined;
    let ultimo = { codigo: '', cuando: 0 };

    // Cada tanto se mira qué tan clara es la imagen: si está oscura varias veces seguidas se
    // avisa (con una imagen oscura el código casi no se lee).
    const lienzoLuz = document.createElement('canvas');
    lienzoLuz.width = 24;
    lienzoLuz.height = 16;
    const contextoLuz = lienzoLuz.getContext('2d', { willReadFrequently: true });
    let seguidasOscuras = 0;
    let vuelta = 0;
    function medirLuz(video: HTMLVideoElement) {
      if (!contextoLuz || !video.videoWidth) return;
      try {
        contextoLuz.drawImage(video, 0, 0, 24, 16);
        const d = contextoLuz.getImageData(0, 0, 24, 16).data;
        let suma = 0;
        for (let i = 0; i < d.length; i += 4) suma += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const brillo = suma / (d.length / 4);
        seguidasOscuras = brillo < 55 ? seguidasOscuras + 1 : 0;
        if (seguidasOscuras >= 3) setOscuro(true);
        else if (brillo > 80) setOscuro(false);
      } catch {
        /* si no se puede medir, simplemente no se avisa nada */
      }
    }

    async function recibir(codigo: string) {
      // El mismo código seguido (el celular lo ve varias veces mientras se apunta) cuenta una sola vez.
      const ahora = Date.now();
      if (codigo === ultimo.codigo && ahora - ultimo.cuando < 2200) return;
      ultimo = { codigo, cuando: ahora };
      try {
        navigator.vibrate?.(60);
      } catch {
        /* no todos los aparatos vibran */
      }
      let respuesta: RespuestaDeCodigo | void;
      try {
        respuesta = await alLeerRef.current(codigo);
      } catch (err) {
        respuesta = { mensaje: err instanceof Error ? err.message : 'No se pudo usar ese código', tipo: 'error' };
      }
      if (!vivo) return;
      ultimo = { codigo, cuando: Date.now() };
      if (respuesta?.mensaje) {
        setAviso(respuesta);
        clearTimeout(apagarAviso);
        apagarAviso = setTimeout(() => setAviso(null), 2600);
      }
      if (respuesta?.cerrar) alCerrarRef.current();
    }

    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!vivo) {
          flujo.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = flujo;
        await video.play();
        const pista = flujo.getVideoTracks()[0];
        pistaRef.current = pista;
        // Enfoque continuo, si el celular lo permite (si no, sigue igual).
        try {
          await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
        } catch {
          /* no todos los celulares lo dejan cambiar */
        }
        // Linterna y zoom, si el celular los ofrece. Si la linterna estaba prendida la última
        // vez que se usó la cámara, vuelve a prenderse (se escanea de a muchos seguidos).
        const ofrece = leerControles(pista);
        setControles(ofrece);
        if (ofrece.zoom) setZoom(ofrece.zoom.min);
        if (ofrece.linterna) {
          let estabaPrendida = false;
          try {
            estabaPrendida = sessionStorage.getItem(CLAVE_LINTERNA) === '1';
          } catch {
            /* nada */
          }
          if (estabaPrendida && (await aplicarARestricciones({ torch: true }))) setLinterna(true);
        }
        const elegido = await crearMotor();
        if (!vivo) return;
        setMotor(elegido.nombre);
        setEstado('leyendo');
        const paso = async () => {
          if (!vivo) return;
          vuelta += 1;
          if (vuelta % 8 === 1) medirLuz(video);
          let codigo: string | null = null;
          try {
            codigo = await elegido.leer(video);
          } catch {
            codigo = null;
          }
          if (codigo && vivo) await recibir(codigo);
          if (vivo) temporizador = setTimeout(paso, 120);
        };
        void paso();
      } catch (err) {
        if (!vivo) return;
        setEstado('error');
        setError(explicarError(err));
      }
    })();

    return () => {
      vivo = false;
      clearTimeout(temporizador);
      clearTimeout(apagarAviso);
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black"
      data-lector-camara
      data-estado={estado}
      data-motor={motor}
      data-linterna={linterna ? 'prendida' : controles.linterna ? 'apagada' : 'no-hay'}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{titulo}</p>
        <button
          onClick={onCerrar}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
          title="Cerrar la cámara"
        >
          <span className="flex items-center gap-1.5">
            <X className="h-4 w-4" />
            Listo
          </span>
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        {estado === 'leyendo' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-[78%] max-w-md rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {estado === 'abriendo' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            Abriendo la cámara...
          </div>
        )}
        {estado === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="flex max-w-sm items-start gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {error}
            </p>
          </div>
        )}
        {estado === 'leyendo' && oscuro && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
            <p
              data-aviso-oscuro
              className="flex max-w-md items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-medium text-white shadow-lg"
            >
              <Sun className="h-4 w-4 shrink-0" />
              {controles.linterna && !linterna
                ? 'Se ve oscuro: prendé la linterna (el botón de abajo)'
                : linterna
                  ? 'Sigue oscuro: acercá el código a una luz'
                  : 'Se ve oscuro: buscá más luz o acercate a una lámpara'}
            </p>
          </div>
        )}
        {mensajeControl && (
          <div className="absolute inset-x-0 top-14 flex justify-center px-4">
            <p className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-lg">{mensajeControl}</p>
          </div>
        )}
        {aviso?.mensaje && (
          <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
            <p
              data-aviso-camara
              className={`flex max-w-md items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
                aviso.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
              }`}
            >
              {aviso.tipo === 'error' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
              {aviso.mensaje}
            </p>
          </div>
        )}
      </div>

      {estado === 'leyendo' && (controles.linterna || controles.zoom) && (
        <div className="flex items-center gap-3 px-4 pt-3 text-white">
          {controles.linterna && (
            <button
              type="button"
              onClick={cambiarLinterna}
              aria-pressed={linterna}
              data-boton-linterna
              title={linterna ? 'Apagar la linterna' : 'Prender la linterna'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                linterna ? 'bg-amber-400 text-slate-900' : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              {linterna ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
            </button>
          )}
          {controles.zoom && zoom !== null && (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-white/80">
              <ZoomOut className="h-4 w-4 shrink-0" />
              <input
                type="range"
                data-zoom-camara
                aria-label="Zoom de la cámara"
                min={controles.zoom.min}
                max={controles.zoom.max}
                step={controles.zoom.step}
                value={zoom}
                onChange={(e) => cambiarZoom(Number(e.target.value))}
                className="h-2 min-w-0 flex-1 accent-white"
              />
              <ZoomIn className="h-4 w-4 shrink-0" />
            </label>
          )}
        </div>
      )}

      <p className="px-4 py-3 text-center text-xs text-white/70">
        Apuntá al código de barras: se lee solo. Podés ir escaneando uno tras otro.
        {controles.zoom || controles.linterna ? ' Si no lo lee, probá con la linterna o el zoom.' : ''}
      </p>
    </div>,
    document.body
  );
}
