// ¿Se está usando desde un celular o tablet (con el dedo)? En ese caso no
// conviene dejar un campo "enfocado" por las dudas: abre el teclado de la
// pantalla y tapa la mitad de lo que se está mirando.
//
// En la app de la PC siempre da false aunque la pantalla sea táctil: el campo
// de escaneo tiene que quedar enfocado para que la lectora de códigos (que
// escribe como un teclado) funcione sin tocar nada.
export function esTactil(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.api?.esElectron) return false;
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
