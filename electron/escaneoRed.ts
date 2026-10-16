// Busca PCs con Mis Amores en la red de la casa o del local PREGUNTANDO
// directamente a cada dirección (las 254 de la red), en vez de esperar a que
// contesten un aviso general ("misamores.local", ver server/mdns.ts).
//
// Ese aviso general no siempre llega: muchos routers y redes de escuela no
// dejan pasar la multidifusión, y una PC con varias placas de red (VPN,
// máquinas virtuales) lo manda por la que no es. Preguntar de a una dirección
// es lento en una red enorme, pero en una red de casa (254 direcciones) tarda
// unos pocos segundos y siempre funciona.

const NOMBRE_APP = 'mis-amores-gestion';

/** Para no volver a barrer la red cada vez que se la busca de nuevo. */
const VIGENCIA_MS = 20_000;
let ultimo: { cuando: number; clave: string; direcciones: string[] } | null = null;

/** Las redes (de a 254 direcciones) que corresponden a estas IPs propias. Sólo
 * redes privadas: nunca se barre algo de internet. */
export function redesDe(ips: string[]): string[] {
  const redes = new Set<string>();
  for (const ip of ips) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m) continue;
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const privada = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
    if (!privada || [a, b, c].some((n) => n > 255)) continue;
    redes.add(`${a}.${b}.${c}.`);
  }
  return [...redes];
}

export interface OpcionesEscaneo {
  /** Cuánto se espera la respuesta de cada dirección. */
  esperaMs?: number;
  /** Cuántas direcciones se preguntan a la vez. */
  paralelo?: number;
  /** Para forzar un barrido nuevo (ignora el anterior). */
  sinCache?: boolean;
}

/** Las direcciones ("192.168.1.55:4000") de las PCs con Mis Amores que contestan
 * en las redes de `ipsPropias`. No incluye las propias. */
export async function escanearRedLocal(
  ipsPropias: string[],
  puerto: number,
  opciones: OpcionesEscaneo = {}
): Promise<string[]> {
  const esperaMs = opciones.esperaMs ?? 800;
  const paralelo = Math.max(1, opciones.paralelo ?? 64);
  const redes = redesDe(ipsPropias);
  const clave = `${redes.join(',')}:${puerto}`;
  if (!opciones.sinCache && ultimo && ultimo.clave === clave && Date.now() - ultimo.cuando < VIGENCIA_MS) {
    return ultimo.direcciones;
  }

  const propias = new Set(ipsPropias);
  const pendientes: string[] = [];
  for (const red of redes) {
    for (let n = 1; n <= 254; n++) {
      const ip = `${red}${n}`;
      if (!propias.has(ip)) pendientes.push(ip);
    }
  }

  const encontradas: string[] = [];
  async function trabajador(): Promise<void> {
    for (;;) {
      const ip = pendientes.pop();
      if (!ip) return;
      try {
        const respuesta = await fetch(`http://${ip}:${puerto}/api/sistema/info`, {
          signal: AbortSignal.timeout(esperaMs),
        });
        const json = (await respuesta.json()) as { ok?: boolean; data?: { app?: string } };
        if (json?.ok && json.data?.app === NOMBRE_APP) encontradas.push(`${ip}:${puerto}`);
      } catch {
        // No hay nadie, o no es esta app: no cuenta.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, pendientes.length) }, trabajador));

  encontradas.sort();
  ultimo = { cuando: Date.now(), clave, direcciones: encontradas };
  return encontradas;
}
