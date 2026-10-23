// jsdom no trae tipos propios y no vale la pena sumar @types/jsdom solo para esta prueba (test-carrusel-base.ts).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, opciones?: Record<string, unknown>);
    window: any;
  }
}
