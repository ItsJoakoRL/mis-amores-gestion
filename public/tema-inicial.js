// Corre antes de que se dibuje la pantalla: si el modo oscuro está elegido, lo pone ya, así no hay un
// destello blanco al abrir. (La misma cuenta está en src/tema.ts.)
(function () {
  try {
    var p = localStorage.getItem('ma-tema');
    var oscuro = p === 'oscuro' || (p === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (oscuro) document.documentElement.classList.add('dark');
  } catch (e) {
    /* sin almacenamiento: queda el claro */
  }
})();
