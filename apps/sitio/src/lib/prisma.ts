import { crearClientePrisma } from "@evaristo/compartido/db";

// Un único cliente por proceso de servidor.
export const prisma = crearClientePrisma();
