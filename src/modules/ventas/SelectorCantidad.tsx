import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { limpiarDecimal, numeroDeDecimal, redondearCantidad } from '@shared/formato';

// La cantidad como se escribe acá: "1,5" (con coma), sin ceros de más.
export const textoDeCantidad = (n: number): string => String(redondearCantidad(n)).replace('.', ',');

/** Lo que se tecleó, dejando sólo lo que sirve: enteros para lo que se vende por unidad, y un solo
 * separador decimal para lo que se vende por peso. */
export const limpiarCantidadEscrita = (valor: string, porPeso: boolean): string =>
  porPeso ? limpiarDecimal(valor) : valor.replace(/[^0-9]/g, '');

/** Cuánto suman los botones − y +: de a 1 unidad, o de a medio kilo. */
const pasoDe = (porPeso: boolean): number => (porPeso ? 0.5 : 1);
const minimoDe = (porPeso: boolean): number => (porPeso ? 0.1 : 1);

/** El número de cantidad con sus botones − y +, para no tener que escribir de a una unidad. `texto` es lo que
 * se ve en el cuadro; `onCambiar` recibe lo nuevo ya limpio (el padre decide qué hacer con el número). */
export function CantidadConBotones({
  texto,
  onCambiar,
  porPeso,
  etiqueta,
  onEnter,
  datos,
  ancho = 'w-14',
}: {
  texto: string;
  onCambiar: (texto: string) => void;
  porPeso: boolean;
  /** Para lectores de pantalla ("Cantidad de COCA COLA"). */
  etiqueta?: string;
  onEnter?: () => void;
  /** Atributos de datos para las pruebas/guías. */
  datos?: Record<string, string>;
  ancho?: string;
}) {
  const n = redondearCantidad(numeroDeDecimal(texto));
  const paso = pasoDe(porPeso);
  const minimo = minimoDe(porPeso);
  const mover = (delta: number) => {
    const siguiente = Math.max(minimo, redondearCantidad((n > 0 ? n : 0) + delta));
    onCambiar(textoDeCantidad(siguiente));
  };
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        aria-label="Una menos"
        title="Una menos"
        onClick={() => mover(-paso)}
        disabled={!(n > minimo)}
        className="flex w-9 shrink-0 items-center justify-center rounded-l-lg border border-r-0 border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        className={`input ${ancho} rounded-none px-1 text-center`}
        inputMode="decimal"
        aria-label={etiqueta}
        value={texto}
        onChange={(e) => onCambiar(limpiarCantidadEscrita(e.target.value, porPeso))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
        {...datos}
      />
      <button
        type="button"
        aria-label="Una más"
        title="Una más"
        onClick={() => mover(paso)}
        className="flex w-9 shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** La cantidad de un renglón de la cuenta, que se puede cambiar después de agregarlo. Mientras se escribe puede
 * quedar vacía o a medias ("1,"): el renglón sólo cambia cuando el número es mayor que cero, y al salir vuelve a
 * mostrar el que vale. */
export function CantidadDeRenglon({
  cantidad,
  porPeso,
  etiqueta,
  onCambiar,
}: {
  cantidad: number;
  porPeso: boolean;
  etiqueta: string;
  onCambiar: (cantidad: number) => void;
}) {
  const [texto, setTexto] = useState(textoDeCantidad(cantidad));

  // Si la cantidad cambia por otro lado (se dividió el renglón, se escaneó el mismo producto de nuevo),
  // se muestra la nueva; lo que se está tecleando no se pisa si ya vale lo mismo.
  useEffect(() => {
    setTexto((actual) => (redondearCantidad(numeroDeDecimal(actual)) === cantidad ? actual : textoDeCantidad(cantidad)));
  }, [cantidad]);

  function cambiar(nuevoTexto: string) {
    setTexto(nuevoTexto);
    const n = redondearCantidad(numeroDeDecimal(nuevoTexto));
    if (n > 0 && n !== cantidad) onCambiar(n);
  }

  return (
    <div
      data-tour="cuenta-cantidad-renglon"
      onBlur={(e) => {
        // Al salir de los botones y el cuadro, si quedó vacío o en 0 vuelve al que vale.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTexto(textoDeCantidad(cantidad));
      }}
    >
      <CantidadConBotones texto={texto} onCambiar={cambiar} porPeso={porPeso} etiqueta={etiqueta} ancho="w-12" />
    </div>
  );
}
