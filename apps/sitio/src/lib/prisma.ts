import { obtenerClientePrisma } from "@evaristo/compartido/db";

// Cliente compartido con la API: es el mismo objeto dentro del proceso.
export const prisma = obtenerClientePrisma();
