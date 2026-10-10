// Hace que "misamores.local" resuelva a esta PC dentro de la red del local,
// sin depender de internet ni de comprar un dominio. Es el mismo mecanismo
// (mDNS / Bonjour) que usan las impresoras de red o un Chromecast para que
// los aparatos se encuentren por nombre en vez de por IP — funciona en
// celulares Android e iPhone sin instalar nada de su lado.
import mdns from 'multicast-dns';

export const NOMBRE_HOST = 'misamores.local';

export function iniciarMdns(ip: string): () => void {
  const respondedor = mdns();

  respondedor.on('query', (consulta) => {
    const preguntaPorNuestroNombre = consulta.questions.some(
      (q) => q.name.toLowerCase() === NOMBRE_HOST && q.type === 'A'
    );
    if (!preguntaPorNuestroNombre) return;

    respondedor.respond({
      answers: [{ name: NOMBRE_HOST, type: 'A', ttl: 120, data: ip }],
    });
  });

  respondedor.on('error', () => {
    // Si falla (por ejemplo, algo ya está usando el puerto de mDNS), no pasa
    // nada grave: el acceso desde el celular sigue andando igual por IP.
  });

  return () => respondedor.destroy();
}
