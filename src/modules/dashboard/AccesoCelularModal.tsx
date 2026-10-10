import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { X, Wifi } from 'lucide-react';
import type { InfoRed } from '@shared/types';

export default function AccesoCelularModal({ onCerrar }: { onCerrar: () => void }) {
  const [info, setInfo] = useState<InfoRed>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    window.api.sistema
      .infoRed()
      .then(async (i) => {
        setInfo(i);
        if (i && 'urls' in i && i.urls.length > 0) {
          const dataUrl = await QRCode.toDataURL(i.urls[0], { margin: 1, width: 220 });
          setQr(dataUrl);
        }
      })
      .finally(() => setCargando(false));
  }, []);

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
          {cargando && <p className="text-sm text-slate-400">Buscando la dirección de red...</p>}

          {!cargando && (!info || 'error' in info) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {info && 'error' in info
                ? info.error
                : 'No se pudo detectar la red. Fijate que la PC esté conectada por WiFi o cable de red.'}
            </p>
          )}

          {!cargando && info && 'urls' in info && info.urls.length > 0 && (
            <>
              <p className="text-sm text-slate-500">
                Con el celular conectado al <strong>mismo WiFi</strong> que esta PC, escaneá el código o escribí la
                dirección en el navegador:
              </p>
              {qr && <img src={qr} alt="Código QR" className="mx-auto rounded-lg border border-slate-200" />}
              <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">{info.urls[0]}</div>
              {info.urls.length > 1 && (
                <p className="text-xs text-slate-400">
                  Si esa dirección no abre, probá con esta:{' '}
                  <span className="font-mono text-slate-500">{info.urls[1]}</span>
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
