import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { X, Wifi } from 'lucide-react';
import type { InfoRed, PcDeLaRed } from '@shared/types';

type Via = 'internet' | 'local';

// El servidor de internet se anota como una "PC" más de la red, pero con una
// dirección completa (https://...).
const esRemota = (pc: PcDeLaRed) => /^https?:\/\//i.test(pc.direccion);

export default function AccesoCelularModal({ onCerrar }: { onCerrar: () => void }) {
  const [info, setInfo] = useState<InfoRed>(null);
  const [internet, setInternet] = useState<PcDeLaRed | null>(null);
  const [via, setVia] = useState<Via | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const puente = window.escritorio;
    const pedirRed =
      puente && (puente.versionPuente ?? 0) >= 3
        ? puente
            .red()
            .then((r) => r.pcs.find(esRemota) ?? null)
            .catch(() => null)
        : Promise.resolve(null);
    Promise.all([window.api.sistema.infoRed().catch(() => null), pedirRed])
      .then(([i, remota]) => {
        setInfo(i);
        setInternet(remota);
        const hayLocal = !!i && 'urls' in i && i.urls.length > 0;
        // Si el servidor de internet está conectado, es lo que más conviene: anda
        // desde cualquier lado y aunque las PCs estén apagadas.
        setVia(remota ? 'internet' : hayLocal ? 'local' : null);
      })
      .finally(() => setCargando(false));
  }, []);

  const urlsLocales = info && 'urls' in info ? info.urls : [];
  const direccion = via === 'internet' ? (internet?.direccion ?? null) : via === 'local' ? (urlsLocales[0] ?? null) : null;

  useEffect(() => {
    if (!direccion) {
      setQr(null);
      return;
    }
    let vigente = true;
    QRCode.toDataURL(direccion, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (vigente) setQr(dataUrl);
      })
      .catch(() => {
        if (vigente) setQr(null);
      });
    return () => {
      vigente = false;
    };
  }, [direccion]);

  const hayLas2 = !!internet && urlsLocales.length > 0;
  const sinNada = !cargando && !internet && urlsLocales.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-sm animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800">
            <Wifi className="h-5 w-5 text-brand-600" />
            Usar desde el celular
          </h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-5 text-center">
          {cargando && <p className="text-sm text-slate-400">Buscando la dirección...</p>}

          {sinNada && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {info && 'error' in info
                ? info.error
                : 'No se pudo detectar la red. Fijate que la PC esté conectada por WiFi o cable de red.'}
            </p>
          )}

          {hayLas2 && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              <button
                onClick={() => setVia('internet')}
                className={`rounded-md px-2 py-1.5 font-medium ${via === 'internet' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}
              >
                Desde cualquier lado
              </button>
              <button
                onClick={() => setVia('local')}
                className={`rounded-md px-2 py-1.5 font-medium ${via === 'local' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}
              >
                En el local (WiFi)
              </button>
            </div>
          )}

          {!cargando && via === 'internet' && internet && (
            <>
              <p className="text-sm text-slate-500">
                Escaneá el código o escribí la dirección en el navegador del celular. Anda <strong>desde cualquier
                lado</strong> (con WiFi o con datos) y <strong>aunque las PCs estén apagadas</strong>:
              </p>
              {qr && <img src={qr} alt="Código QR" className="mx-auto rounded-lg border border-slate-200" />}
              <div className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
                {internet.direccion}
              </div>
              {!internet.enLinea && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Ahora esta PC no está logrando hablar con el servidor de internet. Si recién lo conectaste, esperá un
                  momento.
                </p>
              )}
              <p className="text-xs text-slate-400">
                Se entra con tu usuario y contraseña de siempre. Si hace un rato que nadie lo usa, la primera vez puede
                tardar hasta un minuto en abrir.
              </p>
            </>
          )}

          {!cargando && via === 'local' && urlsLocales.length > 0 && (
            <>
              <p className="text-sm text-slate-500">
                Con el celular conectado al <strong>mismo WiFi</strong> que esta PC, escaneá el código o escribí la
                dirección en el navegador:
              </p>
              {qr && <img src={qr} alt="Código QR" className="mx-auto rounded-lg border border-slate-200" />}
              <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">{urlsLocales[0]}</div>
              {urlsLocales.length > 1 && (
                <p className="text-xs text-slate-400">
                  Si esa dirección no abre, probá con esta:{' '}
                  <span className="font-mono text-slate-500">{urlsLocales[1]}</span>
                </p>
              )}
              <p className="text-xs text-slate-400">
                Esta PC tiene que estar prendida y con la app abierta para que el celular pueda entrar. La primera
                vez, Windows puede preguntar si permitir el acceso — hay que aceptar.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
