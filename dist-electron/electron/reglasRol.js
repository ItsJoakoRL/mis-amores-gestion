"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizarInputSegunRol = sanitizarInputSegunRol;
exports.ocultarCostoSiNoAdmin = ocultarCostoSiNoAdmin;
exports.ocultarCostoSiNoAdminLista = ocultarCostoSiNoAdminLista;
// Si quien edita no es admin, no dejamos que toque el precio de costo ni la
// utilidad calculada: eso queda reservado para la jefa. La utilidad se
// recalcula acá con el costo real — antes quedaba en 0 cada vez que una
// empleada editaba el artículo (ej. le cambiaba el precio de venta).
function sanitizarInputSegunRol(input, rol, precioCostoActual = 0) {
    if (rol === 'admin')
        return input;
    const utilidadPct = precioCostoActual > 0
        ? Math.round(((input.precioVenta - precioCostoActual) / precioCostoActual) * 1000) / 10
        : 0;
    return { ...input, precioCosto: precioCostoActual, utilidadPct };
}
// Mismo criterio pero para lo que se devuelve: antes sólo se ocultaba el
// precio de costo deshabilitando el campo en la pantalla, pero el valor real
// viajaba igual en la respuesta — cualquiera podía verlo abriendo la consola
// del navegador o entrando por el celular. Esto lo saca de la respuesta
// misma para quien no sea admin.
function ocultarCostoSiNoAdmin(articulo, rol) {
    if (rol === 'admin')
        return articulo;
    return { ...articulo, precioCosto: 0, utilidadPct: 0 };
}
function ocultarCostoSiNoAdminLista(articulos, rol) {
    return rol === 'admin' ? articulos : articulos.map((a) => ocultarCostoSiNoAdmin(a, rol));
}
