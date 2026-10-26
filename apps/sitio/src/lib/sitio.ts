import { enlaceValido, TOPBAR_POR_DEFECTO, type Topbar } from "@evaristo/compartido/sitio";
import { prisma } from "./prisma";

/** Topbar que se dibuja: null si está apagado o sin texto. Lo configura el administrador en el panel (tabla `configuracion_sitio`). */
export async function leerTopbar(): Promise<Topbar | null> {
  let topbar: Topbar = TOPBAR_POR_DEFECTO;
  try {
    const fila = await prisma.configuracionSitio.findUnique({ where: { id: 1 }, select: { topbarActivo: true, topbarTexto: true, topbarEnlace: true } });
    if (fila) topbar = { activo: fila.topbarActivo, texto: fila.topbarTexto, enlace: fila.topbarEnlace };
  } catch (error) {
    // Provisorio: la base real todavía no tiene la tabla (la migración `configuracion_sitio` se aplica en la fase 7). Sin ella, se usan
    // los valores por defecto. Borrar este respaldo cuando la real tenga la migración.
    if ((error as { code?: string } | null)?.code !== "P2021" && !/configuracion_sitio|doesn't exist/i.test(String((error as Error | null)?.message))) throw error;
  }
  if (!topbar.activo || topbar.texto.trim() === "") return null;
  // Aunque la API ya lo valida, un enlace raro que llegara a la base no se dibuja.
  return { ...topbar, enlace: topbar.enlace !== null && enlaceValido(topbar.enlace) ? topbar.enlace : null };
}
