// Selección de la base para el servidor y las herramientas.
//   --base-dev   usa DATABASE_URL_DEV (evaristo_cms_dev) en lugar de DATABASE_URL. Es la base del desarrollo de la fase 4.
//   --base-real  usa DATABASE_URL tal cual (evaristo_cms). Solo para herramientas que lo piden de forma explícita.
// Tiene que llamarse antes de crear el cliente de Prisma.

export type BaseElegida = "dev" | "real" | undefined;

export function elegirBase(argv: readonly string[] = process.argv): BaseElegida {
  if (argv.includes("--base-dev")) {
    const dev = process.env["DATABASE_URL_DEV"];
    if (!dev) throw new Error("Falta DATABASE_URL_DEV en el .env");
    if (decodeURIComponent(new URL(dev).pathname.slice(1)) !== "evaristo_cms_dev") {
      throw new Error("DATABASE_URL_DEV no apunta a evaristo_cms_dev");
    }
    process.env["DATABASE_URL"] = dev;
    console.log("Base de desarrollo: evaristo_cms_dev");
    return "dev";
  }
  return argv.includes("--base-real") ? "real" : undefined;
}
