// Carita del asistente — nada de imágenes ni librerías, todo hecho con
// divs/CSS para que se sienta "vivo" (parpadea solita, respira con un
// bobbing suave) sin pesar nada ni depender de ningún servicio externo.
const TAMANIOS = {
  sm: { caja: 'h-6 w-6', ojo: 'h-1 w-1', gap: 'gap-1', boca: 'h-0.5 w-2', dot: 'h-0.5 w-0.5' },
  md: { caja: 'h-9 w-9', ojo: 'h-1.5 w-1.5', gap: 'gap-1.5', boca: 'h-1 w-3', dot: 'h-1 w-1' },
  lg: { caja: 'h-8 w-8', ojo: 'h-1.5 w-1.5', gap: 'gap-1.5', boca: 'h-1 w-3', dot: 'h-1 w-1' },
} as const;

export default function Mascota({
  tamanio = 'md',
  pensando = false,
  quieto = false,
  className = '',
}: {
  tamanio?: keyof typeof TAMANIOS;
  pensando?: boolean;
  quieto?: boolean;
  className?: string;
}) {
  const t = TAMANIOS[tamanio];
  return (
    <div className={`${quieto ? '' : 'animate-bob'} ${className}`}>
      <div className={`flex ${t.caja} flex-col items-center justify-center gap-1 rounded-full bg-white shadow-sm`}>
        <div className={`flex ${t.gap}`}>
          <span className={`${t.ojo} animate-blink rounded-full bg-brand-600`} />
          <span className={`${t.ojo} animate-blink rounded-full bg-brand-600`} style={{ animationDelay: '0.15s' }} />
        </div>
        {pensando ? (
          <div className="flex items-center gap-0.5">
            <span className={`${t.dot} animate-bounce-dot rounded-full bg-brand-400`} />
            <span className={`${t.dot} animate-bounce-dot rounded-full bg-brand-400`} style={{ animationDelay: '0.15s' }} />
            <span className={`${t.dot} animate-bounce-dot rounded-full bg-brand-400`} style={{ animationDelay: '0.3s' }} />
          </div>
        ) : (
          <span className={`${t.boca} rounded-full bg-brand-300`} />
        )}
      </div>
    </div>
  );
}
