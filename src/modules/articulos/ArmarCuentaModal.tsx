import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ArmarCuenta from '../ventas/ArmarCuenta';

interface Props {
  onCerrar: () => void;
  onVentaRegistrada: () => void;
}

// Mismo "armar la cuenta" de Ventas (caja), pero accesible sin salir de
// Artículos y stock — para cuando ya se está ahí escaneando productos y no
// hace falta cambiar de pantalla para cobrarle a alguien.
export default function ArmarCuentaModal({ onCerrar, onVentaRegistrada }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-10">
      <div className="w-full max-w-2xl animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">Armar cuenta</h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <ArmarCuenta onVentaRegistrada={onVentaRegistrada} />
        </div>
      </div>
    </div>,
    document.body
  );
}
