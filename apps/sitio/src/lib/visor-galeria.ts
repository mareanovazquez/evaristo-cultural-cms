// Visor ampliado de la galería de un artículo: al hacer clic en una imagen se abre grande sobre un fondo oscuro, con su epígrafe, flechas
// para pasar a la anterior o la siguiente (con el mouse o con las flechas del teclado) y se cierra con Esc, con la X o haciendo clic afuera.
// Usa el elemento <dialog> del navegador (maneja el foco y Esc). Sin JavaScript, cada imagen es un enlace que abre el archivo.
// Es DOM puro y exporta sus funciones para probarlo con jsdom.

export function iniciarVisores(doc: Document): void {
  for (const seccion of doc.querySelectorAll<HTMLElement>(".galeria")) iniciarVisor(seccion);
}

export function iniciarVisor(seccion: HTMLElement): void {
  const dialogo = seccion.querySelector<HTMLDialogElement>("dialog.visor");
  const enlaces = Array.from(seccion.querySelectorAll<HTMLAnchorElement>("a.galeria-abrir"));
  if (!dialogo || typeof dialogo.showModal !== "function" || enlaces.length === 0) return;
  const imagen = dialogo.querySelector<HTMLImageElement>(".visor-imagen");
  const epigrafe = dialogo.querySelector<HTMLElement>(".visor-epigrafe");
  const contador = dialogo.querySelector<HTMLElement>(".visor-contador");
  const anterior = dialogo.querySelector<HTMLButtonElement>(".visor-anterior");
  const siguiente = dialogo.querySelector<HTMLButtonElement>(".visor-siguiente");
  const cerrar = dialogo.querySelector<HTMLButtonElement>(".visor-cerrar");
  if (!imagen || !epigrafe || !contador || !anterior || !siguiente || !cerrar) return;

  const total = enlaces.length;
  let actual = 0;
  const mostrar = (indice: number): void => {
    actual = ((indice % total) + total) % total;
    const enlace = enlaces[actual]!;
    imagen.src = enlace.getAttribute("href") ?? enlace.href;
    imagen.alt = enlace.querySelector("img")?.alt ?? "";
    epigrafe.textContent = enlace.closest("figure")?.querySelector("figcaption")?.textContent ?? "";
    contador.textContent = total > 1 ? `${actual + 1} de ${total}` : "";
  };
  // Con una sola imagen no hay a dónde pasar.
  anterior.hidden = siguiente.hidden = total < 2;

  enlaces.forEach((enlace, i) =>
    enlace.addEventListener("click", (e) => {
      e.preventDefault();
      mostrar(i);
      dialogo.showModal();
    }),
  );
  anterior.addEventListener("click", () => mostrar(actual - 1));
  siguiente.addEventListener("click", () => mostrar(actual + 1));
  cerrar.addEventListener("click", () => dialogo.close());
  dialogo.addEventListener("keydown", (e) => {
    if (total < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      mostrar(actual - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      mostrar(actual + 1);
    }
  });
  // Un clic en el fondo oscuro (el propio <dialog>, no su contenido) lo cierra.
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo) dialogo.close();
  });
}
