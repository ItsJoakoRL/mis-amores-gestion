import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { X, Smartphone } from 'lucide-react';
import type { PcDeLaRed } from '@shared/types';
import { URL_SERVIDOR_INTERNET } from '@shared/servidor';

// El servidor de internet se anota como una "PC" más de la red, pero con una
// dirección completa (https://...).
const esRemota = (pc: PcDeLaRed) => /^https?:\/\//i.test(pc.direccion);

// Un solo código, siempre el mismo: el de la página de internet. Anda desde
// cualquier lado (WiFi de la casa, WiFi de invitados, datos) y con las PCs
// apagadas. Los celulares hablan con el servidor, no con esta PC.
export default function AccesoCelularModal({ onCerrar }: { onCerrar: () => void }) {
  const [servidor, setServidor] = useState<PcDeLaRed | null>(null);
  const [consultado, setConsultado] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const puente = window.escritorio;
    if (!puente || (puente.versionPuente ?? 0) < 3) {
      setConsultado(true);
      return;
    }
    puente
      .red()
      .then((r) => setServidor(r.pcs.find(esRemota) ?? null))
      .catch(() => setServidor(null))
      .finally(() => setConsultado(true));
  }, []);

  useEffect(() => {
    let vigente = true;
    QRCode.toDataURL(URL_SERVIDOR_INTERNET, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (vigente) setQr(dataUrl);
      })
      .catch(() => {
        if (vigente) setQr(null);
      });
    return () => {
      vigente = false;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-sm animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800">
            <Smartphone className="h-5 w-5 text-brand-600" />
            Usar desde el celular
          </h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-5 text-center">
          <p className="text-sm text-slate-500">
            Escaneá el código o escribí la dirección en el navegador del celular. Anda <strong>desde cualquier
            lado</strong> (con el WiFi que sea, o con datos) y <strong>aunque las PCs estén apagadas</strong>:
          </p>
          {qr && <img src={qr} alt="Código QR" className="mx-auto rounded-lg border border-slate-200" />}
          <div className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
            {URL_SERVIDOR_INTERNET}
          </div>

          {consultado && !servidor && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Esta PC todavía no está conectada con el servidor de internet. Entrá a <b>Configuración → Servidor en
              internet</b> y tocá <b>Conectar</b>, así lo que se cargue acá le llega al celular.
            </p>
          )}
          {servidor && !servidor.enLinea && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Ahora esta PC no está logrando hablar con el servidor de internet. Si recién lo conectaste, esperá un
              momento.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Se entra con tu usuario y contraseña de siempre. Si hace un rato que nadie lo usa, la primera vez puede
            tardar hasta un minuto en abrir.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
