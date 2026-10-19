import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  mensaje: string;
  onCerrar: () => void;
}

// Cartel centrado que confirma que algo salió bien y se cierra solo — para
// avisos rápidos (guardado, venta registrada) que no necesitan que alguien
// los cierre a mano en medio de una fila de gente esperando en el mostrador.
export default function CartelExito({ mensaje, onCerrar }: Props) {
  // onCerrar llega como una función nueva en cada render de la pantalla de
  // atrás: si el temporizador dependiera de ella, se reiniciaba con cada
  // tecla (ej. escaneando el próximo producto) y el cartel no se iba nunca.
  const onCerrarRef = useRef(onCerrar);
  onCerrarRef.current = onCerrar;

  useEffect(() => {
    const timer = setTimeout(() => onCerrarRef.current(), 2200);
    return () => clearTimeout(timer);
  }, [mensaje]);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="animate-scale-in pointer-events-none flex items-center gap-3 rounded-2xl bg-slate-900/95 px-6 py-4 text-white shadow-2xl">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
        <p className="font-medium">{mensaje}</p>
      </div>
    </div>,
    document.body
  );
}
