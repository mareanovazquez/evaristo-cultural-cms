// Verifica, SOLO CON SELECT, que lo que hay en evaristo_cms (127.0.0.1:3308) es lo que el plan dice para los artículos pedidos. No escribe: las dos
// conexiones (el CMS y WordPress, para armar el plan) son las de solo lectura de leer-wordpress.ts, con la sesión READ ONLY verificada. Apunta SIEMPRE a
// evaristo_cms: no hay argumento de base. Contra evaristo_cms_test la misma función (lib/verificar.ts) se usa desde los tests con base.
//
// Uso: npm run verificar:escritura -w @evaristo/compartido -- (--id=N | --ids=a,b,c | --muestra) [--solo-estos] [--originales=<carpeta>]
//   --solo-estos: no compara los conteos globales de la base (útil si hay más artículos que los pedidos).
//   --originales: carpeta de originales (por defecto CMS-EVARISTO(ASSETS)/uploads-muestra/originales, al lado del repositorio).
// Sale con 0 si no hay diferencias y con 1 si las hay (un artículo pedido que no está en la base cuenta como diferencia). Con 2 si los argumentos no sirven.
// Credenciales: el usuario y la clave de DATABASE_URL (host, puerto y base salen de las constantes). Nunca imprime correos, bios ni claves.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { DESTINO_REAL } from "./lib/destinos.ts";
import { cargarDatosVersionados } from "./lib/entrada-snapshot.ts";
import { abrirSoloCms, abrirSoloWordPress } from "./lib/leer-wordpress.ts";
import { codigoDeSalida, formatearVerificacion, verificarEscritura } from "./lib/verificar.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const USO = "Uso: verificar-escritura.ts (--id=N | --ids=a,b,c | --muestra) [--solo-estos] [--originales=<carpeta>]";
const idsMuestra = cargarDatosVersionados().ids;

function argumentos(argv: readonly string[]): { ids: number[]; soloEstos: boolean; originales: string } | string {
  let ids: number[] | null = null, soloEstos = false, originales: string | null = null;
  const vistos = new Set<string>();
  for (const arg of argv) {
    const nombre = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (vistos.has(nombre)) return `${nombre} está repetido`;
    vistos.add(nombre);
    const valor = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
    switch (nombre) {
      case "--id": case "--ids": {
        if (ids !== null) return "hay que indicar exactamente uno de --id, --ids o --muestra";
        if (valor === null || valor === "") return `${nombre} necesita un valor`;
        const partes = valor.split(",").map((x) => x.trim());
        if (nombre === "--id" && partes.length !== 1) return "--id lleva un solo número (para varios, --ids=a,b,c)";
        if (partes.some((x) => !/^\d+$/.test(x))) return `${nombre} tiene que ser un número (o una lista de números separados por coma)`;
        const numeros = partes.map(Number);
        const fuera = numeros.filter((n) => !idsMuestra.includes(n));
        if (fuera.length) return `${nombre} tiene ids que no son de la muestra de ${idsMuestra.length} artículos: ${[...new Set(fuera)].join(", ")}`;
        ids = idsMuestra.filter((n) => numeros.includes(n));
        break;
      }
      case "--muestra":
        if (valor !== null) return "--muestra no lleva valor";
        if (ids !== null) return "hay que indicar exactamente uno de --id, --ids o --muestra";
        ids = [...idsMuestra];
        break;
      case "--solo-estos":
        if (valor !== null) return "--solo-estos no lleva valor";
        soloEstos = true;
        break;
      case "--originales":
        if (valor === null || valor === "") return "--originales necesita un valor (--originales=<carpeta>)";
        originales = valor;
        break;
      default: return `argumento desconocido: ${arg}`;
    }
  }
  if (ids === null) return "hay que indicar uno de --id, --ids o --muestra";
  return { ids, soloEstos, originales: originales ?? fileURLToPath(new URL("../../../../../CMS-EVARISTO(ASSETS)/uploads-muestra/originales", import.meta.url)) };
}

const args = argumentos(process.argv.slice(2));
if (typeof args === "string") { console.error(`Error en los argumentos: ${args}\n${USO}`); process.exit(2); }
if (!existsSync(args.originales)) { console.error(`Error en los argumentos: no se puede leer la carpeta de originales ${args.originales}\n${USO}`); process.exit(2); }

const cms = await abrirSoloCms();
let wp: Awaited<ReturnType<typeof abrirSoloWordPress>> | null = null;
try {
  wp = await abrirSoloWordPress();
  const r = await verificarEscritura({ bd: cms.bd, wp: wp.wp, destino: DESTINO_REAL, ids: args.ids, soloEstos: args.soloEstos, originales: args.originales });
  for (const linea of formatearVerificacion(r, args.ids)) console.log(linea);
  process.exitCode = codigoDeSalida(r);
} finally {
  await wp?.cerrar();
  await cms.cerrar();
}
