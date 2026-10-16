import { useEffect, useState } from 'react';

// Igual que el corte "md" de Tailwind (768px): por debajo se muestran las
// listas como tarjetas en vez de tablas.
const CONSULTA = '(max-width: 767px)';

/** ¿La pantalla es de celular? Sirve para dibujar una sola de las dos vistas
 * (tarjetas o tabla) en lugar de las dos y esconder una con CSS. */
export function useEsPantallaChica(): boolean {
  const [chica, setChica] = useState(() => typeof window !== 'undefined' && window.matchMedia(CONSULTA).matches);

  useEffect(() => {
    const lista = window.matchMedia(CONSULTA);
    const alCambiar = () => setChica(lista.matches);
    alCambiar();
    lista.addEventListener('change', alCambiar);
    return () => lista.removeEventListener('change', alCambiar);
  }, []);

  return chica;
}
