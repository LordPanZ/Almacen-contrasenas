/**
 * Script de contenido: encuentra el formulario de acceso y lo rellena.
 *
 * No conoce la bóveda ni recibe nada hasta que el usuario pide expresamente un
 * relleno. Lo que llega es una sola credencial, ya autorizada por el trabajador
 * de fondo tras comprobar el origen contra la URL real de la pestaña.
 */

interface CamposAcceso {
  readonly usuario: HTMLInputElement | null;
  readonly secreto: HTMLInputElement;
}

/**
 * Un marco de otro origen nunca se rellena.
 *
 * Cualquier página puede incrustar un `iframe` con aspecto de formulario de
 * acceso. Si la extensión mirase solo el origen del marco, entregaría la
 * contraseña a quien lo incrustó. Comprobarlo aquí, además de en el fondo, es
 * defensa en profundidad: son dos sitios que tendrían que fallar a la vez.
 */
function marcoAjeno(): boolean {
  if (window.top === window) return false;
  try {
    // Leer el origen del marco superior lanza si es de otro origen.
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
}

function visible(elemento: HTMLElement): boolean {
  const caja = elemento.getBoundingClientRect();
  if (caja.width === 0 || caja.height === 0) return false;
  const estilo = getComputedStyle(elemento);
  return estilo.visibility !== "hidden" && estilo.display !== "none";
}

/**
 * Localiza el campo de contraseña y su campo de usuario.
 *
 * El de usuario se busca **hacia atrás** desde la contraseña: en un formulario
 * corriente el usuario va justo antes, y esa cercanía acierta más que fiarse de
 * los nombres de los campos, que cada sitio escribe como quiere.
 */
function localizarCampos(): CamposAcceso | null {
  const secretos = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (campo) => visible(campo) && !campo.disabled && !campo.readOnly,
  );
  if (secretos.length === 0) return null;

  // Con varios campos de contraseña suele tratarse de un alta o un cambio de
  // clave; el primero es el que corresponde a la credencial actual.
  const secreto = secretos[0] as HTMLInputElement;

  const candidatos = [
    ...(secreto.form ?? document).querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ].filter((campo) => visible(campo) && !campo.disabled && !campo.readOnly);

  const anteriores = candidatos.filter(
    (campo) => campo.compareDocumentPosition(secreto) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const usuario = anteriores.at(-1) ?? candidatos[0] ?? null;

  return { usuario, secreto };
}

/**
 * Escribe en un campo simulando entrada real.
 *
 * Asignar `.value` a secas no dispara los escuchadores de React, Vue y demás, y
 * el formulario se envía vacío aunque en pantalla se vea el texto. Hay que
 * llamar al asignador nativo del prototipo y luego emitir los eventos.
 */
function escribir(campo: HTMLInputElement, valor: string): void {
  const asignador = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  asignador?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  campo.dispatchEvent(new Event("change", { bubbles: true }));
}

function resaltar(campo: HTMLInputElement): void {
  const previo = campo.style.boxShadow;
  campo.style.boxShadow = "0 0 0 2px rgba(232, 163, 61, 0.75)";
  setTimeout(() => {
    campo.style.boxShadow = previo;
  }, 1100);
}

chrome.runtime.onMessage.addListener((mensaje, _emisor, responder) => {
  const datos = mensaje as { accion: string; usuario?: string; secreto?: string };

  if (datos.accion === "detectar") {
    const campos = localizarCampos();
    responder({
      hayFormulario: campos !== null,
      marcoAjeno: marcoAjeno(),
      url: window.location.href,
    });
    return false;
  }

  if (datos.accion === "rellenar") {
    if (marcoAjeno()) {
      responder({ relleno: false, motivo: "marco-ajeno" });
      return false;
    }
    const campos = localizarCampos();
    if (!campos) {
      responder({ relleno: false, motivo: "sin-formulario" });
      return false;
    }
    if (campos.usuario && datos.usuario) {
      escribir(campos.usuario, datos.usuario);
      resaltar(campos.usuario);
    }
    escribir(campos.secreto, datos.secreto ?? "");
    resaltar(campos.secreto);
    campos.secreto.focus();
    responder({ relleno: true });
    return false;
  }

  return false;
});
