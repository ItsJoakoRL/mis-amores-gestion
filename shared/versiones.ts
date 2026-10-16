/** Compara dos versiones de la app ("0.8.10" contra "0.8.9"): negativo si `a` es
 * más vieja que `b`, 0 si son iguales, positivo si `a` es más nueva. Compara
 * número por número (0.8.10 es MÁS nueva que 0.8.9, aunque como texto no lo sea). */
export function compararVersiones(a: string, b: string): number {
  const partes = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const x = partes(a);
  const y = partes(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diferencia = (x[i] ?? 0) - (y[i] ?? 0);
    if (diferencia !== 0) return diferencia;
  }
  return 0;
}
