// Tiempos del autoguardado de la pantalla de edición. Es un objeto para que las pruebas puedan acortarlos o apagarlo.
export const tiempos = {
  /** Cuánto se espera después del último cambio antes de guardar solo. */
  espera: 2000,
  /** Cuánto se espera para volver a probar cuando no se pudo guardar por la conexión o por un error del servidor. */
  reintento: 5000,
};
