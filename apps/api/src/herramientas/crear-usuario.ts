// Crea un usuario del panel. La contraseña se pide por teclado (sin mostrarse) y nunca se guarda en archivos ni en el historial.
//
// Uso:
//   npm run usuario:crear -- --base-dev --email=ana@ejemplo.org --nombre="Ana Pérez" --rol=ADMINISTRADOR
//   --base-dev   crea el usuario en evaristo_cms_dev (desarrollo)
//   --base-real  lo crea en evaristo_cms (la base real); hay que pedirlo de forma explícita
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { z } from "zod";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { hashearClave, problemaDeClave } from "../auth/clave.js";
import { elegirBase } from "../entorno.js";

function salir(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

const base = elegirBase();
if (!base) salir("indicá la base: --base-dev (desarrollo) o --base-real (la real)");

const arg = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const datos = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    nombre: z.string().trim().min(1).max(255),
    rol: z.enum(["EDITOR", "ADMINISTRADOR"]),
  })
  .safeParse({ email: arg("email"), nombre: arg("nombre"), rol: arg("rol") });
if (!datos.success) salir('faltan datos o son inválidos. Uso: --email=<email> --nombre="<nombre>" --rol=EDITOR|ADMINISTRADOR');

/** Pide un texto sin mostrar lo que se escribe. */
function pedirOculto(pregunta: string): Promise<string> {
  return new Promise((resolver) => {
    let mudo = false;
    const salida = new Writable({
      write(trozo, _codificacion, listo) {
        if (!mudo) process.stdout.write(trozo);
        listo();
      },
    });
    const rl = createInterface({ input: process.stdin, output: salida, terminal: true });
    rl.question(pregunta, (respuesta) => {
      rl.close();
      process.stdout.write("\n");
      resolver(respuesta);
    });
    mudo = true;
    process.stdout.write(pregunta);
  });
}

const clave = await pedirOculto("Contraseña: ");
const problema = problemaDeClave(clave);
if (problema) salir(problema);
if ((await pedirOculto("Repetí la contraseña: ")) !== clave) salir("las contraseñas no coinciden");

const prisma = obtenerClientePrisma();
try {
  const existente = await prisma.usuario.findUnique({ where: { email: datos.data.email }, select: { id: true } });
  if (existente) salir(`ya existe un usuario con el email ${datos.data.email}`);
  const creado = await prisma.usuario.create({
    data: { email: datos.data.email, nombre: datos.data.nombre, rol: datos.data.rol, passwordHash: await hashearClave(clave) },
    select: { id: true, email: true, rol: true },
  });
  console.log(`Usuario creado en la base ${base === "dev" ? "de desarrollo" : "REAL"}: #${creado.id} ${creado.email} (${creado.rol})`);
} finally {
  await prisma.$disconnect();
}
