import { useState } from "react";
import { descargarBytes, formatearBytes } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import type { DocumentoMeta, EnvioCreado } from "./tipos.ts";

type Fase =
  | { readonly tipo: "elegir" }
  | { readonly tipo: "trabajando"; readonly texto: string }
  | { readonly tipo: "cifrado"; readonly envio: EnvioCreado; readonly fichero: File }
  | { readonly tipo: "claro"; readonly ficheros: readonly File[] };

/** ¿Puede este navegador abrir la hoja de compartir del sistema con estos archivos? */
function puedeCompartir(ficheros: readonly File[]): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [...ficheros] });
  } catch {
    return false;
  }
}

/**
 * Compartir uno o varios documentos.
 *
 * Hay dos caminos y se dicen con todas las letras, porque no son equivalentes:
 *
 * - **Cifrado con un código**: sale un fichero que solo abre el código que se
 *   genera ahora. Fichero y código se envían por canales distintos.
 * - **Sin cifrar**: el archivo sale tal cual por la hoja de compartir del
 *   sistema. Es lo cómodo, pero queda en la aplicación que lo reciba.
 *
 * El envío (`navigator.share`) tiene que invocarse directamente desde el toque
 * del usuario: si hubiera que descifrar *después* del toque, en algunos móviles
 * el permiso ya habría caducado. Por eso se prepara primero y se envía con un
 * segundo botón.
 */
export function Compartir({
  documentos,
  alCerrar,
}: {
  readonly documentos: readonly DocumentoMeta[];
  readonly alCerrar: () => void;
}) {
  const [fase, setFase] = useState<Fase>({ tipo: "elegir" });
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);

  const titulo = documentos.length === 1 ? (documentos[0] as DocumentoMeta).nombre : `${documentos.length} documentos`;
  const ocupado = fase.tipo === "trabajando";

  function contar(error: unknown) {
    setFallo(error instanceof Error ? error.message : String(error));
  }

  async function prepararCifrado() {
    setFallo(null);
    setNota(null);
    setFase({ tipo: "trabajando", texto: "Cifrando el envío. Se deriva la clave con Argon2, así que tarda unos segundos…" });
    try {
      const envio = await arca.compartirCifrado(documentos.map((d) => d.id));
      setFase({
        tipo: "cifrado",
        envio,
        fichero: new File([envio.archivo], envio.nombre, { type: "application/octet-stream" }),
      });
    } catch (error) {
      contar(error);
      setFase({ tipo: "elegir" });
    }
  }

  async function prepararClaro() {
    setFallo(null);
    setNota(null);
    setFase({ tipo: "trabajando", texto: "Descifrando…" });
    try {
      const ficheros: File[] = [];
      for (const d of documentos) {
        const { meta, datos } = await arca.leer(d.id);
        ficheros.push(new File([datos], meta.nombre, { type: meta.mime }));
        // El archivo ya tiene su copia: la nuestra no hace falta ni un instante más.
        new Uint8Array(datos).fill(0);
      }
      setFase({ tipo: "claro", ficheros });
    } catch (error) {
      contar(error);
      setFase({ tipo: "elegir" });
    }
  }

  async function enviar(ficheros: readonly File[]) {
    setFallo(null);
    setNota(null);
    try {
      await navigator.share({ files: [...ficheros], title: titulo });
    } catch (error) {
      // Cerrar la hoja de compartir sin enviar no es un fallo.
      if (!(error instanceof DOMException && error.name === "AbortError")) contar(error);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setNota("Código copiado.");
    } catch {
      setNota("No se pudo copiar solo: mantén pulsado el código para copiarlo.");
    }
  }

  return (
    <Hoja titulo="Compartir" alCerrar={alCerrar} bloqueada={ocupado}>
      <p className="texto compartir-que">
        <strong>{titulo}</strong>
        {documentos.length > 1 && (
          <span className="dato">
            {" "}
            · {formatearBytes(documentos.reduce((n, d) => n + d.tam, 0))}
          </span>
        )}
      </p>

      {fallo && <div className="aviso alarma">{fallo}</div>}
      {nota && <div className="aviso exito">{nota}</div>}

      {fase.tipo === "trabajando" && (
        <div className="derivando" role="status">
          <div className="barra-espera">
            <span />
          </div>
          <p>{fase.texto}</p>
        </div>
      )}

      {fase.tipo === "elegir" && (
        <>
          <section className="opcion recomendada">
            <h2>Cifrado con un código</h2>
            <p className="texto pequeno">
              Se crea un fichero que <strong>solo abre un código</strong> que se genera ahora. Envías el fichero por
              un canal y el código por otro —el fichero por WhatsApp y el código por una llamada, por ejemplo—.
              Quien lo reciba lo abre en Arca sin necesitar cuenta.
            </p>
            <button className="boton principal" onClick={() => void prepararCifrado()}>
              Crear envío cifrado
            </button>
          </section>

          <section className="opcion">
            <h2>Sin cifrar</h2>
            <p className="texto pequeno">
              El archivo sale de Arca <strong>tal cual</strong>. La aplicación que lo reciba (WhatsApp, el correo…)
              guardará una copia que Arca ya no puede proteger ni borrar.
            </p>
            <button className="boton" onClick={() => void prepararClaro()}>
              Preparar sin cifrar
            </button>
          </section>
        </>
      )}

      {fase.tipo === "cifrado" && (
        <>
          <section className="opcion recomendada">
            <span className="etiqueta">Tu código</span>
            <div className="codigo" aria-label="Código de acceso del envío">
              {fase.envio.codigo}
            </div>
            <button className="boton chico" onClick={() => void copiar(fase.envio.codigo)}>
              Copiar el código
            </button>
            <p className="texto pequeno">
              Es de un solo uso para este envío y <strong>Arca no lo guarda</strong>: si lo pierdes, crea otro envío.
            </p>
          </section>

          <section className="opcion">
            <span className="etiqueta">Paso 1 · el fichero</span>
            <div className="acciones">
              {puedeCompartir([fase.fichero]) && (
                <button className="boton principal" onClick={() => void enviar([fase.fichero])}>
                  Enviar el fichero…
                </button>
              )}
              <button
                className="boton"
                onClick={() => descargarBytes(fase.fichero, fase.fichero.name, "application/octet-stream")}
              >
                Descargar el fichero
              </button>
            </div>
            <p className="texto pequeno dato-fichero">
              {fase.fichero.name} · {formatearBytes(fase.fichero.size)}
            </p>
          </section>

          <section className="opcion">
            <span className="etiqueta">Paso 2 · el código</span>
            <p className="texto pequeno">
              Dáselo por <strong>otro medio</strong>: una llamada, un SMS, en persona. Si fichero y código viajan
              juntos, cualquiera que intercepte el mensaje puede abrirlo.
            </p>
          </section>

          <div className="aviso aviso-suave">
            No se puede revocar: quien tenga el fichero <strong>y</strong> el código podrá abrirlo siempre, y puede
            guardarlo sin cifrar. Esto protege el camino, no la confianza en quien lo recibe.
          </div>
        </>
      )}

      {fase.tipo === "claro" && (
        <>
          <section className="opcion">
            <span className="etiqueta">Listo para enviar sin cifrar</span>
            <ul className="seleccion">
              {fase.ficheros.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="seleccion-nombre">{f.name}</span>
                  <span className="dato">{formatearBytes(f.size)}</span>
                  <button
                    className="enlace"
                    onClick={() => descargarBytes(f, f.name, f.type || "application/octet-stream")}
                    aria-label={`Descargar ${f.name}`}
                  >
                    Descargar
                  </button>
                </li>
              ))}
            </ul>
            {puedeCompartir(fase.ficheros) ? (
              <button className="boton principal" onClick={() => void enviar(fase.ficheros)}>
                Enviar…
              </button>
            ) : (
              <p className="texto pequeno">
                Este navegador no puede abrir la hoja de compartir con archivos: descárgalos y envíalos desde
                tu aplicación de mensajes o de correo.
              </p>
            )}
          </section>
          <div className="aviso aviso-suave">
            Estos archivos ya no están cifrados. Cuando los envíes, la copia que quede en la otra aplicación no la
            controla Arca.
          </div>
        </>
      )}
    </Hoja>
  );
}
