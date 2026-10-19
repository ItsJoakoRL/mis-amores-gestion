// Cada vez que se cobra una cuenta, todos sus productos se anotan con el mismo número de
// "ticket": así el programa cuenta compras (no productos sueltos) y el ticket promedio sale bien.
export function nuevoIdTicket(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
