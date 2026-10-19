// Comando de ESCRITURA de la migración: el ÚNICO programa (junto con lib/flujo-escribir.ts) que alcanza correr-escritura.ts y escribir.ts.
// migrar.ts sigue siendo solo simulación. El destino es siempre DESTINO_REAL (127.0.0.1:3308/evaristo_cms); no hay opción de destino.
// Mientras ESCRITURA_REAL_HABILITADA sea false (lib/destinos.ts) este comando se niega con salida 2 ANTES de abrir ninguna conexión, de
// lectura o de escritura. Este archivo solo carga el .env, arma las dependencias REALES y llama al flujo (lib/flujo-escribir.ts), que es el
// mismo código que ejecutan los tests con dependencias inyectadas.
//
// Uso: npm run migrar:escribir -w @evaristo/compartido -- (--muestra | --ids=a,b) --esperar-articulos=N --originales=<carpeta> [--abortar-al-primer-error]
//                                                           [--sobrescribir --esperar-sobrescribir=N]
// Credenciales: usuario y clave de DATABASE_URL_MIGRACION (host, puerto y base salen de la constante del destino). Nunca se imprime la clave.
// Informe: packages/compartido/out/migracion/<fecha>-escribir.json y .md (ignorados por git)
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { correrFlujoEscribir, dependenciasReales } from "./lib/flujo-escribir.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

process.exitCode = await correrFlujoEscribir(process.argv.slice(2), process.env, dependenciasReales());
