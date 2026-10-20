// Carita del asistente — nada de imágenes ni librerías, todo hecho con
// divs/CSS para que se sienta "vivo" sin pesar nada ni depender de ningún servicio externo:
//  - sonríe (la boca es una curva) y tiene mejillas
//  - parpadea solita y respira con un bobbing suave
//  - `habla`: mueve la boca como si dijera algo EN SILENCIO (y cabecea un poquito)
//  - `murmura`: de vez en cuando, cada unos segundos, se pone a "hablar" un rato (para invitar a tocarla)
//  - `pensando`: tres puntitos que saltan en vez de la boca
// Las animaciones se apagan solas si la persona tiene activado "reducir movimientos" (ver index.css).
const TAMANIOS = {
  sm: { caja: 'h-6 w-6', ojo: 'h-1 w-1', gap: 'gap-1', ancho: '9px', alto: '4px', abierta: '7px', borde: '1.5px', mejilla: null, dot: 'h-0.5 w-0.5' },
  md: { caja: 'h-9 w-9', ojo: 'h-1.5 w-1.5', gap: 'gap-1.5', ancho: '14px', alto: '6px', abierta: '11px', borde: '2px', mejilla: 'h-1.5 w-1.5', dot: 'h-1 w-1' },
  lg: { caja: 'h-8 w-8', ojo: 'h-1.5 w-1.5', gap: 'gap-1.5', ancho: '13px', alto: '5px', abierta: '10px', borde: '2px', mejilla: 'h-1 w-1', dot: 'h-1 w-1' },
} as const;

export default function Mascota({
  tamanio = 'md',
  pensando = false,
  quieto = false,
  habla = false,
  murmura = false,
  className = '',
}: {
  tamanio?: keyof typeof TAMANIOS;
  pensando?: boolean;
  quieto?: boolean;
  /** Habla en silencio: la boca se abre y se cierra y la cabecita cabecea. */
  habla?: boolean;
  /** Cada tanto se pone a "hablar" un ratito sola (para la carita del botón redondo). */
  murmura?: boolean;
  className?: string;
}) {
  const t = TAMANIOS[tamanio];
  const estado = pensando ? 'pensando' : habla ? 'habla' : murmura ? 'murmura' : 'sonrie';
  // Las medidas de la boca viajan como variables: las animaciones (tailwind.config.js) las usan para abrirse y cerrarse.
  const medidasBoca = { '--boca-h': t.alto, '--boca-abierta': t.abierta } as React.CSSProperties;
  const movimiento = habla ? 'animate-habla' : murmura ? 'animate-murmura' : '';
  const cabeza = habla ? 'animate-cabeceo' : murmura ? 'animate-cabeza-murmura' : '';

  return (
    <div data-mascota data-estado={estado} aria-hidden="true" className={`${quieto ? '' : 'animate-bob'} ${className}`}>
      <div className={cabeza}>
        <div className={`relative flex ${t.caja} flex-col items-center justify-center gap-1 rounded-full bg-white shadow-sm`}>
          {t.mejilla && (
            <>
              <span className={`absolute left-[10%] top-[56%] ${t.mejilla} rounded-full`} style={{ backgroundColor: 'rgb(var(--c-pink-300) / 0.75)' }} />
              <span className={`absolute right-[10%] top-[56%] ${t.mejilla} rounded-full`} style={{ backgroundColor: 'rgb(var(--c-pink-300) / 0.75)' }} />
            </>
          )}
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
            // La sonrisa: una curva (el borde de abajo de una caja con las esquinas de abajo redondas).
            <span
              data-boca
              className={`block shrink-0 ${movimiento}`}
              style={{
                ...medidasBoca,
                width: t.ancho,
                height: t.alto,
                borderBottom: `${t.borde} solid rgb(var(--c-brand-600))`,
                borderRadius: '0 0 999px 999px',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
