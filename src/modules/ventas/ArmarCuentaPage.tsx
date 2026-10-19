import BotonAyuda from '../../components/BotonAyuda';
import ArmarCuenta from './ArmarCuenta';

// La pantalla para vender: se arma lo que se lleva el cliente (escaneando o buscando) y se cobra,
// cada producto con su forma de pago. Antes era un botón dentro de "Artículos y stock"; ahora es
// una parte del menú, igual que el resto, para encontrarla de una.
export default function ArmarCuentaPage() {
  return (
    <div className="mx-auto max-w-4xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-5">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
          Armar cuenta
          <BotonAyuda seccion="Armar cuenta" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Lo que se lleva el cliente: buscá o escaneá los productos, elegí cómo paga y cobrá.
        </p>
      </div>
      <ArmarCuenta onVentaRegistrada={() => {}} />
    </div>
  );
}
