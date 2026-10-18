import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
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
        // Enfoque continuo, si el celular lo permite (si no, sigue igual).
        try {
          await flujo.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
        } catch {
          /* no todos los celulares lo dejan cambiar */
        }
        const elegido = await crearMotor();
        if (!vivo) return;
        setMotor(elegido.nombre);
        setEstado('leyendo');
        const paso = async () => {
          if (!vivo) return;
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
    <div className="fixed inset-0 z-[70] flex flex-col bg-black" data-lector-camara data-estado={estado} data-motor={motor}>
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

      <p className="px-4 py-3 text-center text-xs text-white/70">
        Apuntá al código de barras: se lee solo. Podés ir escaneando uno tras otro.
      </p>
    </div>,
    document.body
  );
}
