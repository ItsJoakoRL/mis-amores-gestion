// Contraseñas fáciles de dictar o de leer en voz alta: sin las letras y números
// que se confunden entre sí (0/o, 1/l/i).
const LETRAS = 'abcdefghjkmnpqrstuvwxyz';
const NUMEROS = '23456789';

function azar(max: number): number {
  // Sin sesgo: se descartan los valores que dejarían unas opciones más
  // probables que otras.
  const limite = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limite);
  return buffer[0] % max;
}

/** Una contraseña nueva al azar, ej. "kxmpa482". */
export function generarClave(): string {
  let clave = '';
  for (let i = 0; i < 5; i++) clave += LETRAS[azar(LETRAS.length)];
  for (let i = 0; i < 3; i++) clave += NUMEROS[azar(NUMEROS.length)];
  return clave;
}

/** Copia un texto al portapapeles. Devuelve false si el navegador no lo permite
 * (por ejemplo, una página sin https en el celular). */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const campo = document.createElement('textarea');
      campo.value = texto;
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(campo);
      return ok;
    } catch {
      return false;
    }
  }
}
