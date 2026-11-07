// ENSAYO GENERAL, paso B: corre la migración sobre la copia que dejó `ensayo:preparar` en evaristo_cms_test, con el MISMO flujo que migrar:escribir
// (lib/flujo-escribir.ts) y los mismos argumentos que va a llevar la real (decisión 87: --todos, --sobrescribir --esperar-sobrescribir=N y
// --limpiar-taxonomia), con las credenciales de evaristo_migracion. Lo único distinto del comando real son las dependencias: el destino es la
// constante DESTINO_PRUEBAS (como en test-flujo), la terminal no es interactiva (no se tipea el nombre de la base) y la lectura de WordPress usa la
// base de --wordpress. Mide el tiempo y deja el informe en out/ensayo/.
//
// Uso: npm run ensayo:migrar -w @evaristo/compartido -- --todos --wordpress=evaristo_lectura_nueva --originales=<...> --mapa=<...> --avatares=<...>
//        --esperar-articulos=N [--sobrescribir --esperar-sobrescribir=N] [--limpiar-taxonomia]
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { ConexionesVerificadas } from "../lib/conexiones.ts";
import { leerDestinoServidor, verificarServidorWordPress } from "../lib/conexiones.ts";
import { DESTINO_PRUEBAS } from "../lib/destinos.ts";
import { abrirConexionLectura } from "../lib/escribir.ts";
import { correrFlujoEscribir } from "../lib/flujo-escribir.ts";
import { abrirSoloWordPress, BASE_WORDPRESS_POR_DEFECTO } from "../lib/leer-wordpress.ts";
import { dependenciasDePruebaEnVivo } from "./dependencias-prueba.ts";

config({ path: fileURLToPath(new URL("../../../../../.env", import.meta.url)), quiet: true });

const CARPETA = fileURLToPath(new URL("../../../out/ensayo/", import.meta.url));
const rastro = dependenciasDePruebaEnVivo({
  carpetaInformes: CARPETA,
  salida: { log: (t) => console.log(t), error: (t) => console.error(t) },
  // La lectura respeta --wordpress (las dependencias de prueba leen siempre la base por defecto).
  abrirLectura: async (base?: string): Promise<ConexionesVerificadas> => {
    const wp = await abrirSoloWordPress(base ?? BASE_WORDPRESS_POR_DEFECTO);
    try {
      const cms = await abrirConexionLectura(DESTINO_PRUEBAS);
      try {
        const servidorWordPress = verificarServidorWordPress(await leerDestinoServidor(wp.wp), base ?? BASE_WORDPRESS_POR_DEFECTO);
        return {
          wp: wp.wp, bd: cms.bd, destino: { host: DESTINO_PRUEBAS.host, puerto: DESTINO_PRUEBAS.puerto, base: DESTINO_PRUEBAS.base },
          servidorCms: { puerto: cms.servidor.puerto, base: cms.servidor.base, readOnly: 0, version: cms.servidor.version }, servidorWordPress,
          cerrar: async () => { await wp.cerrar(); await cms.cerrar(); },
        };
      } catch (e) { await cms.cerrar(); throw e; }
    } catch (e) { await wp.cerrar(); throw e; }
  },
});

console.log(`Ensayo sobre ${DESTINO_PRUEBAS.host}:${DESTINO_PRUEBAS.puerto}/${DESTINO_PRUEBAS.base} (la copia de la real). Informe en ${CARPETA}`);
const t0 = Date.now();
const codigo = await correrFlujoEscribir(process.argv.slice(2), { DATABASE_URL_MIGRACION: process.env["DATABASE_URL_MIGRACION"] }, rastro.deps);
const segundos = (Date.now() - t0) / 1000;
console.log(`\nEnsayo terminado con código ${codigo} en ${Math.floor(segundos / 60)} min ${Math.round(segundos % 60)} s. Conexiones de escritura con el usuario: ${rastro.usuariosDeEscritura.join(", ") || "(ninguna)"}`);
process.exitCode = codigo;
