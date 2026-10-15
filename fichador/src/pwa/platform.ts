// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29): única detección del
// modo de uso del fichador. Las capacidades (Wake Lock, cámara, instalación)
// se detectan por sí mismas; esto sólo decide qué ayuda de instalación mostrar.

/** El fichador se abrió desde el ícono instalado (pantalla de inicio), no desde una pestaña. */
export function isStandaloneMode() {
  const displayStandalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  // iOS no siempre informa display-mode; Safari expone navigator.standalone.
  return displayStandalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * iPhone/iPad, sólo para elegir el texto de instalación ("Agregar a pantalla de
 * inicio" desde Compartir): iOS no tiene un aviso de instalación detectable.
 * iPadOS se presenta como Mac de escritorio; lo delata la pantalla táctil.
 */
export function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
