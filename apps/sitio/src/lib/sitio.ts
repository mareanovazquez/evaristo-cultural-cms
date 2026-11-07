import { enlaceValido, TOPBAR_POR_DEFECTO, type Topbar } from "@evaristo/compartido/sitio";
import { prisma } from "./prisma";

/** Topbar que se dibuja: null si está apagado o sin texto. Lo configura el administrador en el panel (tabla `configuracion_sitio`). */
export async function leerTopbar(): Promise<Topbar | null> {
  const fila = await prisma.configuracionSitio.findUnique({ where: { id: 1 }, select: { topbarActivo: true, topbarTexto: true, topbarEnlace: true } });
  const topbar: Topbar = fila ? { activo: fila.topbarActivo, texto: fila.topbarTexto, enlace: fila.topbarEnlace } : TOPBAR_POR_DEFECTO;
  if (!topbar.activo || topbar.texto.trim() === "") return null;
  // Aunque la API ya lo valida, un enlace raro que llegara a la base no se dibuja.
  return { ...topbar, enlace: topbar.enlace !== null && enlaceValido(topbar.enlace) ? topbar.enlace : null };
}
