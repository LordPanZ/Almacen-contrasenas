import { useEffect, useState } from "react";
import {
  descargar,
  formatearFecha,
  nucleo,
  type EstadoInterruptor,
  type EstadoSwitch,
  type Herencia,
  type PoliticaGuardianes,
  type SobreGuardian,
} from "./nucleo.ts";

const DIA_MS = 86_400_000;

type Seccion = "reparto" | "recuperar" | "interruptor" | "herencia";

const SECCIONES: readonly { clave: Seccion; nombre: string }[] = [
  { clave: "reparto", nombre: "Repartir" },
  { clave: "recuperar", nombre: "Recuperar" },
  { clave: "interruptor", nombre: "Hombre muerto" },
  { clave: "herencia", nombre: "Herencia" },
];

const COLOR_ESTADO: Readonly<Record<EstadoSwitch, string>> = {
  activo: "jade",
  vencido: "senal",
  "en-gracia": "senal",
  liberable: "alarma",
  revocado: "neutro",
};

function formatearPlazo(ms: number): string {
  if (ms <= 0) return "0";
  const dias = Math.floor(ms / DIA_MS);
  const horas = Math.floor((ms % DIA_MS) / 3_600_000);
  if (dias > 0) return `${dias} d ${horas} h`;
  const minutos = Math.floor((ms % 3_600_000) / 60_000);
  if (horas > 0) return `${horas} h ${minutos} min`;
  return `${Math.max(1, minutos)} min`;
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ─── Vista ───────────────────────────────────────────────────────────── */

export function VistaGuardianes({
  passwordActual,
  alActualizarFichero,
}: {
  readonly passwordActual: string;
  readonly alActualizarFichero: (fichero: Uint8Array) => void;
}) {
  const [seccion, setSeccion] = useState<Seccion>("reparto");
  const [politica, setPolitica] = useState<PoliticaGuardianes | null>(null);
  const [interruptor, setInterruptor] = useState<EstadoInterruptor | null>(null);
  // Los sobres viven aquí y no dentro de su sección: son irrepetibles —la app
  // no conserva las claves privadas—, así que cambiar de pestaña no puede ser
  // la forma de perderlos.
  const [sobres, setSobres] = useState<readonly SobreGuardian[]>([]);

  useEffect(() => {
    void nucleo
      .politicaGuardianes()
      .then(({ politica: guardada }) => setPolitica(guardada))
      .catch(() => setPolitica(null));
    void nucleo
      .estadoInterruptor()
      .then(({ interruptor: estado }) => setInterruptor(estado))
      .catch(() => setInterruptor(null));
  }, []);

  return (
    <>
      <div className="cabecera-vista">
        <h1>Guardianes</h1>
        <p className="prosa">
          Las dos formas de perderlo todo con un gestor de contraseñas no son que te lo rompan: son
          olvidar la contraseña maestra y morirte. Ninguna se arregla aquí confiando en una empresa
          que guarde una copia de tu clave —esa copia se puede robar, filtrar o entregar por
          orden judicial—, sino <strong>repartiendo el secreto entre personas</strong>: hacen falta
          k de ellas para reconstruirlo y ninguna, por su cuenta, sabe nada.
        </p>
      </div>

      <div className="barra-acciones" style={{ marginBottom: 16 }}>
        {SECCIONES.map((entrada) => (
          <button
            key={entrada.clave}
            className="boton"
            style={seccion === entrada.clave ? { borderColor: "var(--senal)" } : undefined}
            onClick={() => setSeccion(entrada.clave)}
          >
            {entrada.nombre}
          </button>
        ))}
      </div>

      <div key={seccion} className="aparece">
        {seccion === "reparto" && (
          <SeccionReparto
            passwordActual={passwordActual}
            politica={politica}
            sobres={sobres}
            alConfigurar={(nueva, nuevos, fichero) => {
              setPolitica(nueva);
              setSobres(nuevos);
              alActualizarFichero(fichero);
            }}
            alRevocar={(fichero) => {
              setPolitica(null);
              setSobres([]);
              alActualizarFichero(fichero);
            }}
          />
        )}
        {seccion === "recuperar" && <SeccionRecuperar />}
        {seccion === "interruptor" && (
          <SeccionInterruptor
            interruptor={interruptor}
            alCambiar={(estado, fichero) => {
              setInterruptor(estado);
              alActualizarFichero(fichero);
            }}
          />
        )}
        {seccion === "herencia" && (
          <SeccionHerencia passwordActual={passwordActual} interruptor={interruptor} />
        )}
      </div>
    </>
  );
}

/* ─── Nombres de guardianes ───────────────────────────────────────────── */

function ListaNombres({
  nombres,
  etiqueta,
  alCambiar,
}: {
  readonly nombres: readonly string[];
  readonly etiqueta: string;
  readonly alCambiar: (nombres: readonly string[]) => void;
}) {
  return (
    <div className="campo">
      <span className="etiqueta">{etiqueta}</span>
      {nombres.map((nombre, indice) => (
        <div key={indice} className="barra-acciones" style={{ marginBottom: 8 }}>
          <input
            type="text"
            value={nombre}
            placeholder={`Nombre del guardián ${indice + 1}`}
            onChange={(e) =>
              alCambiar(nombres.map((otro, j) => (j === indice ? e.target.value : otro)))
            }
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="boton"
            disabled={nombres.length <= 2}
            onClick={() => alCambiar(nombres.filter((_, j) => j !== indice))}
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        className="boton"
        disabled={nombres.length >= 8}
        onClick={() => alCambiar([...nombres, ""])}
      >
        Añadir
      </button>
    </div>
  );
}

/* ─── Sobres ──────────────────────────────────────────────────────────── */

function TablaSobres({ sobres }: { readonly sobres: readonly SobreGuardian[] }) {
  return (
    <div className="panel aparece">
      <div className="panel-titulo">
        <h2 style={{ fontSize: 17 }}>Sobres por entregar</h2>
        <button
          className="boton"
          onClick={() => {
            for (const sobre of sobres) descargar(sobre.bytes, sobre.fichero);
          }}
        >
          Descargar todos
        </button>
      </div>

      <div className="aviso senal">
        <span className="glifo">!</span>
        <span>
          Descárgalos <strong>ahora</strong>. Cada sobre lleva la clave privada de su guardián y su
          fragmento, y la app no se ha quedado con ninguna copia: si sales de aquí sin bajarlos, no
          hay forma de volver a producirlos y habrá que repartir de nuevo.
        </span>
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th style={{ width: "26%" }}>Guardián</th>
            <th>Huella de su clave</th>
            <th style={{ width: 130 }} />
          </tr>
        </thead>
        <tbody>
          {sobres.map((sobre) => (
            <tr key={sobre.fichero} style={{ cursor: "default" }}>
              <td>{sobre.nombre}</td>
              <td className="dato" style={{ color: "var(--texto-medio)" }}>
                {sobre.huella}
              </td>
              <td>
                <button className="boton" onClick={() => descargar(sobre.bytes, sobre.fichero)}>
                  Descargar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Repartir ────────────────────────────────────────────────────────── */

function SeccionReparto({
  passwordActual,
  politica,
  sobres,
  alConfigurar,
  alRevocar,
}: {
  readonly passwordActual: string;
  readonly politica: PoliticaGuardianes | null;
  readonly sobres: readonly SobreGuardian[];
  readonly alConfigurar: (
    politica: PoliticaGuardianes,
    sobres: readonly SobreGuardian[],
    fichero: Uint8Array,
  ) => void;
  readonly alRevocar: (fichero: Uint8Array) => void;
}) {
  const [nombres, setNombres] = useState<readonly string[]>(["", "", ""]);
  const [umbral, setUmbral] = useState(2);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const validos = nombres.map((nombre) => nombre.trim()).filter((nombre) => nombre.length > 0);
  const listo = validos.length >= 2 && umbral >= 2 && umbral <= validos.length;

  async function configurar(evento: React.FormEvent) {
    evento.preventDefault();
    setTrabajando(true);
    setFallo(null);
    try {
      const resultado = await nucleo.configurarGuardianes(passwordActual, validos, umbral);
      alConfigurar(resultado.politica, resultado.sobres, resultado.fichero);
    } catch (error) {
      setFallo(mensaje(error));
    } finally {
      setTrabajando(false);
    }
  }

  async function revocar() {
    setFallo(null);
    try {
      const { fichero } = await nucleo.revocarGuardianes();
      alRevocar(fichero);
    } catch (error) {
      setFallo(mensaje(error));
    }
  }

  return (
    <>
      <div className="panel">
        <p className="prosa">
          Tu contraseña maestra se parte en n fragmentos con Shamir sobre GF(2⁸). Con k cualesquiera
          se reconstruye entera; con k−1 no se aprende <strong>nada</strong> —no "es más difícil":
          nada—. Cada fragmento sale cifrado con la clave pública de su destinatario, así que los
          sobres pueden viajar por correo o por un servidor sin que quien los transporte pueda
          leerlos.
        </p>
        <p className="prosa" style={{ marginTop: 12 }}>
          En la bóveda se guarda solo la política: nombres, claves públicas, umbral y fecha. Los
          fragmentos no, y no por ahorrar sitio: para leerlos habría que abrir la bóveda, y quien
          pueda abrirla no necesita recuperarla. Por eso se descargan.
        </p>
      </div>

      <div className="aviso senal">
        <span className="glifo">!</span>
        <span>
          En un despliegue real cada guardián generaría su par de claves en su propio dispositivo y
          te daría <strong>solo la pública</strong>; su clave privada no pasaría jamás por tus
          manos. Aquí la genera esta app, por comodidad, y la mete en el sobre. Eso significa que
          durante un instante este dispositivo ve las claves privadas de todos tus guardianes: si
          estuviera comprometido, quien lo controle podría quedarse los sobres y reunir el umbral él
          solo. La app las destruye en cuanto escribe el sobre, pero <strong>tienes que confiar en
          la máquina que lo hizo</strong>.
        </span>
      </div>

      <form className="panel" onSubmit={configurar}>
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>{politica ? "Repartir de nuevo" : "Repartir"}</h2>
        </div>

        <ListaNombres nombres={nombres} etiqueta="Guardianes (de 2 a 8)" alCambiar={setNombres} />

        <div className="campo">
          <span className="etiqueta">Umbral</span>
          <div className="barra-acciones">
            <input
              type="number"
              min={2}
              max={Math.max(2, validos.length)}
              value={umbral}
              onChange={(e) => setUmbral(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="dato" style={{ color: "var(--texto-tenue)" }}>
              hacen falta {umbral} de {validos.length || "—"} para reconstruir
            </span>
          </div>
        </div>

        {politica && (
          <div className="aviso senal">
            <span className="glifo">!</span>
            <span>
              Ya hay una política repartida. Repartir otra vez sustituye la anterior en la bóveda,
              pero <strong>no invalida los sobres antiguos</strong>: siguen abriendo la contraseña
              maestra que tuvieras al repartirlos.
            </span>
          </div>
        )}

        {fallo && (
          <div className="aviso alarma">
            <span className="glifo">!</span>
            <span>{fallo}</span>
          </div>
        )}

        <button type="submit" className="boton principal" disabled={trabajando || !listo}>
          {trabajando ? "Repartiendo…" : "Repartir la contraseña maestra"}
        </button>
      </form>

      {sobres.length > 0 && <TablaSobres sobres={sobres} />}

      <div className="panel">
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>Política guardada</h2>
          {politica && (
            <button className="boton peligro" onClick={() => void revocar()}>
              Revocar
            </button>
          )}
        </div>

        {!politica ? (
          <div className="vacio">Todavía no has repartido la contraseña maestra.</div>
        ) : (
          <>
            <div className="rejilla-datos" style={{ marginBottom: 16 }}>
              <span className="etiqueta">Umbral</span>
              <span className="dato">
                {politica.umbral} de {politica.guardianes.length}
              </span>
              <span className="etiqueta">Identificador</span>
              <span className="dato" style={{ color: "var(--texto-tenue)" }}>
                {politica.policyId}
              </span>
            </div>
            <table className="tabla">
              <thead>
                <tr>
                  <th style={{ width: "26%" }}>Guardián</th>
                  <th>Huella de su clave pública</th>
                  <th style={{ width: 190 }}>Alta</th>
                </tr>
              </thead>
              <tbody>
                {politica.guardianes.map((guardian) => (
                  <tr key={guardian.id} style={{ cursor: "default" }}>
                    <td>{guardian.nombre}</td>
                    <td className="dato" style={{ color: "var(--texto-medio)" }}>
                      {guardian.huella}
                    </td>
                    <td className="dato" style={{ color: "var(--texto-tenue)" }}>
                      {formatearFecha(guardian.anadidoEn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="prosa" style={{ marginTop: 14, fontSize: 13.5 }}>
              La huella son doce bytes del hash de la clave pública. Sirve para que un guardián y tú
              comprobéis por teléfono que el sobre que recibió es el que le mandaste: comparar 1216
              bytes a ojo no es viable, seis grupos de cuatro caracteres sí.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/* ─── Recuperar ───────────────────────────────────────────────────────── */

function SeccionRecuperar() {
  const [ficheros, setFicheros] = useState<readonly { nombre: string; bytes: Uint8Array }[]>([]);
  const [resultado, setResultado] = useState<{
    password: string;
    aportados: number;
    umbral: number;
    nombres: readonly string[];
  } | null>(null);
  const [revelado, setRevelado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function elegir(lista: FileList | null) {
    setFallo(null);
    setResultado(null);
    if (!lista) return;
    const leidos = await Promise.all(
      Array.from(lista).map(async (fichero) => ({
        nombre: fichero.name,
        bytes: new Uint8Array(await fichero.arrayBuffer()),
      })),
    );
    setFicheros(leidos);
  }

  async function recuperar() {
    setTrabajando(true);
    setFallo(null);
    setRevelado(false);
    try {
      setResultado(await nucleo.recuperarConSobres(ficheros));
    } catch (error) {
      setResultado(null);
      setFallo(mensaje(error));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="panel">
        <p className="prosa">
          Sube los sobres que te devuelvan tus guardianes. La app abre cada uno con la clave privada
          que trae dentro, combina los fragmentos por interpolación de Lagrange y reconstruye la
          contraseña maestra. Si faltan sobres para el umbral, o si vienen de políticas distintas,
          no sale una contraseña parecida: no sale ninguna.
        </p>
        <p className="prosa" style={{ marginTop: 12 }}>
          Estás haciéndolo desde dentro de una bóveda ya abierta, así que esto es un{" "}
          <strong>ensayo</strong>. El día que importe lo harás en una instalación recién puesta, sin
          bóveda que abrir, con los sobres que tengan tus guardianes. Ensáyalo ahora, que es cuando
          no pasa nada por equivocarse.
        </p>
      </div>

      <div className="panel">
        <label className="campo">
          <span className="etiqueta">Sobres de guardián</span>
          <input
            type="file"
            multiple
            accept=".json,application/json"
            onChange={(e) => void elegir(e.target.files)}
          />
        </label>

        <div className="barra-acciones">
          <button
            className="boton principal"
            disabled={trabajando || ficheros.length === 0}
            onClick={() => void recuperar()}
          >
            {trabajando ? "Combinando…" : "Reconstruir la contraseña"}
          </button>
          <span className="dato" style={{ color: "var(--texto-tenue)" }}>
            {ficheros.length} sobre{ficheros.length === 1 ? "" : "s"} cargado
            {ficheros.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {fallo && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>{fallo}</span>
        </div>
      )}

      {resultado && (
        <div className="panel aparece">
          <div className="panel-titulo">
            <h2 style={{ fontSize: 17 }}>Contraseña maestra reconstruida</h2>
            <span className="distintivo jade">
              {resultado.aportados} de {resultado.umbral} exigidos
            </span>
          </div>
          <div className="secreto">
            <div className={`secreto-valor${revelado ? "" : " oculto"}`}>
              {revelado ? resultado.password : "•".repeat(24)}
            </div>
            <button className="boton" onClick={() => setRevelado(!revelado)}>
              {revelado ? "Ocultar" : "Revelar"}
            </button>
            <button
              className="boton"
              onClick={() => void navigator.clipboard?.writeText(resultado.password)}
            >
              Copiar
            </button>
          </div>
          <p className="prosa" style={{ marginTop: 14, fontSize: 13.5 }}>
            Reconstruida con los fragmentos de {resultado.nombres.join(", ")}. La suma de
            comprobación del reparto cuadra, así que no es una combinación errónea disfrazada de
            resultado.
          </p>
        </div>
      )}

      <div className="panel">
        <p className="prosa" style={{ fontSize: 13.5 }}>
          Un detalle honesto: cada fragmento lleva una suma de comprobación del secreto repartido,
          que existe para detectar una combinación equivocada en vez de devolver basura. Con una
          clave aleatoria de 32 bytes eso es irrelevante; con una contraseña maestra{" "}
          <strong>adivinable</strong>, un guardián podría probar candidatos contra ella por su
          cuenta, sin necesitar a nadie más. Una razón más para que la maestra sea larga.
        </p>
      </div>
    </>
  );
}

/* ─── Interruptor de hombre muerto ────────────────────────────────────── */

function SeccionInterruptor({
  interruptor,
  alCambiar,
}: {
  readonly interruptor: EstadoInterruptor | null;
  readonly alCambiar: (estado: EstadoInterruptor, fichero: Uint8Array) => void;
}) {
  const [intervaloDias, setIntervaloDias] = useState(30);
  const [graciaDias, setGraciaDias] = useState(7);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function ejecutar(accion: () => Promise<{ fichero: Uint8Array; interruptor: EstadoInterruptor }>) {
    setTrabajando(true);
    setFallo(null);
    try {
      const { fichero, interruptor: estado } = await accion();
      alCambiar(estado, fichero);
    } catch (error) {
      setFallo(mensaje(error));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="panel">
        <p className="prosa">
          Das señales de vida cada cierto tiempo. Si dejan de llegar y además pasa el periodo de
          gracia, el legado queda reclamable. El intervalo es tu ritmo; la gracia es el margen para
          un viaje largo, un hospital o un teléfono roto.
        </p>
        <p className="prosa" style={{ marginTop: 12 }}>
          Las señales van <strong>firmadas</strong>, y eso no es adorno. Sin firma, cualquiera que
          pudiera escribir en el almacén compartido —el servidor de sincronización, por ejemplo—
          fabricaría señales de vida indefinidamente y mantendría tu legado bloqueado para siempre,
          que es exactamente el ataque contra el que existe el interruptor. Se firman con la
          identidad de la propia bóveda, así que no hay un segundo fichero de claves que perder.
        </p>
      </div>

      {fallo && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>{fallo}</span>
        </div>
      )}

      {!interruptor ? (
        <div className="panel">
          <div className="panel-titulo">
            <h2 style={{ fontSize: 17 }}>Crear el interruptor</h2>
          </div>
          <div className="barra-acciones">
            <span className="etiqueta">Intervalo de señal</span>
            <input
              type="number"
              min={1}
              max={365}
              value={intervaloDias}
              onChange={(e) => setIntervaloDias(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="etiqueta">días · gracia</span>
            <input
              type="number"
              min={1}
              max={365}
              value={graciaDias}
              onChange={(e) => setGraciaDias(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="etiqueta">días</span>
            <button
              className="boton principal"
              disabled={trabajando}
              onClick={() => void ejecutar(() => nucleo.crearInterruptor(intervaloDias, graciaDias))}
            >
              {trabajando ? "Creando…" : "Crear"}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-titulo">
            <h2 style={{ fontSize: 17 }}>Estado</h2>
            <span className={`distintivo ${COLOR_ESTADO[interruptor.estado]}`}>
              {interruptor.estado}
            </span>
          </div>

          <div className="rejilla-datos">
            <span className="etiqueta">Situación</span>
            <span>{interruptor.descripcion}</span>
            <span className="etiqueta">Última señal</span>
            <span className="dato">{formatearFecha(interruptor.ultimaSenal)}</span>
            <span className="etiqueta">Intervalo · gracia</span>
            <span className="dato">
              {interruptor.intervaloDias} d · {interruptor.graciaDias} d
            </span>
            <span className="etiqueta">Falta para liberar</span>
            <span className="dato" style={{ color: interruptor.revocado ? "var(--texto-tenue)" : undefined }}>
              {interruptor.revocado ? "—" : formatearPlazo(interruptor.restanteMs)}
            </span>
            <span className="etiqueta">Identificador</span>
            <span className="dato" style={{ color: "var(--texto-tenue)" }}>
              {interruptor.id}
            </span>
          </div>

          {!interruptor.revocado && (
            <div className="medidor" style={{ marginTop: 16 }}>
              <span
                style={{
                  width: `${Math.min(
                    100,
                    (interruptor.restanteMs /
                      ((interruptor.intervaloDias + interruptor.graciaDias) * DIA_MS)) *
                      100,
                  )}%`,
                  background:
                    interruptor.estado === "activo" ? "var(--jade)" : "var(--senal)",
                }}
              />
            </div>
          )}

          <div className="barra-acciones" style={{ marginTop: 18 }}>
            <button
              className="boton principal"
              disabled={trabajando || interruptor.revocado}
              onClick={() => void ejecutar(() => nucleo.senalDeVida())}
            >
              {trabajando ? "Firmando…" : "Dar señal de vida"}
            </button>
            <button
              className="boton peligro"
              disabled={trabajando || interruptor.revocado}
              onClick={() => void ejecutar(() => nucleo.revocarInterruptor())}
            >
              Revocar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Herencia ────────────────────────────────────────────────────────── */

function SeccionHerencia({
  passwordActual,
  interruptor,
}: {
  readonly passwordActual: string;
  readonly interruptor: EstadoInterruptor | null;
}) {
  const [nombres, setNombres] = useState<readonly string[]>(["", ""]);
  const [umbral, setUmbral] = useState(2);
  const [plazoDias, setPlazoDias] = useState(30);
  const [herencia, setHerencia] = useState<Herencia | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  // El legado hereda el ritmo del interruptor que ya tengas; si no hay ninguno,
  // arranca con uno propio de valores razonables.
  const intervaloDias = interruptor?.intervaloDias ?? 30;
  const graciaDias = interruptor?.graciaDias ?? 7;

  const validos = nombres.map((nombre) => nombre.trim()).filter((nombre) => nombre.length > 0);
  const listo = validos.length >= 2 && umbral >= 2 && umbral <= validos.length;

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    setTrabajando(true);
    setFallo(null);
    try {
      setHerencia(
        await nucleo.crearHerencia(
          passwordActual,
          validos,
          umbral,
          plazoDias,
          intervaloDias,
          graciaDias,
        ),
      );
    } catch (error) {
      setHerencia(null);
      setFallo(mensaje(error));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="panel">
        <p className="prosa">
          Dos condiciones <strong>independientes</strong>, no una: hace falta el umbral de
          beneficiarios <strong>y</strong> que se abra la cerradura temporal. Solo el umbral, y k
          beneficiarios de acuerdo abrirían tu herencia estando tú vivo. Solo el tiempo, y bastaría
          con hacerse con el fichero. Solo un servidor que "libere" al no ver señales, y ese
          servidor puede mentir en las dos direcciones.
        </p>
        <p className="prosa" style={{ marginTop: 12 }}>
          La cerradura es un puzzle de trabajo secuencial: quien no conozca los factores del módulo
          tiene que encadenar T elevaciones al cuadrado, cada una sobre el resultado de la anterior.
          El trabajo no se reparte —mil máquinas tardan lo mismo que una—, así que la barrera es
          física y no administrativa: no hay reloj que adelantar ni administrador al que convencer.
        </p>
      </div>

      <div className="aviso senal">
        <span className="glifo">!</span>
        <span>
          El módulo es de <strong>1024 bits</strong> para que generar los primos no deje la ventana
          colgada. La cerradura se apoya en que nadie factorice N, así que a este tamaño quien la
          abre es un factorizador y no el paso del tiempo: en producción hacen falta 2048 bits o
          más. La trampilla que abre el puzzle al instante se destruye nada más crearlo —tú no la
          necesitas, ya tienes la contraseña—.
        </span>
      </div>

      <form className="panel" onSubmit={crear}>
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>Crear el paquete de legado</h2>
        </div>

        <ListaNombres
          nombres={nombres}
          etiqueta="Beneficiarios (de 2 a 8)"
          alCambiar={setNombres}
        />

        <div className="campo">
          <span className="etiqueta">Umbral y plazo</span>
          <div className="barra-acciones">
            <input
              type="number"
              min={2}
              max={Math.max(2, validos.length)}
              value={umbral}
              onChange={(e) => setUmbral(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="etiqueta">de {validos.length || "—"} · cerradura de</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={plazoDias}
              onChange={(e) => setPlazoDias(Number(e.target.value))}
              style={{ width: 90 }}
            />
            <span className="etiqueta">días</span>
          </div>
        </div>

        <div className="rejilla-datos" style={{ marginBottom: 15 }}>
          <span className="etiqueta">Interruptor del legado</span>
          <span className="dato" style={{ color: "var(--texto-medio)" }}>
            señal cada {intervaloDias} d · gracia {graciaDias} d
            {interruptor ? " (los del interruptor que ya tienes)" : " (valores por defecto)"}
          </span>
        </div>

        {fallo && (
          <div className="aviso alarma">
            <span className="glifo">!</span>
            <span>{fallo}</span>
          </div>
        )}

        <button type="submit" className="boton principal" disabled={trabajando || !listo}>
          {trabajando ? "Calibrando y sellando…" : "Crear el legado"}
        </button>
      </form>

      {herencia && (
        <>
          <div className="panel aparece">
            <div className="panel-titulo">
              <h2 style={{ fontSize: 17 }}>Paquete de legado</h2>
              <button
                className="boton"
                onClick={() => descargar(herencia.legado.bytes, herencia.legado.fichero)}
              >
                Descargar el paquete
              </button>
            </div>

            <div className="rejilla-datos">
              <span className="etiqueta">Elevaciones</span>
              <span className="dato">{herencia.elevaciones.toLocaleString("es-ES")}</span>
              <span className="etiqueta">Velocidad medida</span>
              <span className="dato">
                {herencia.velocidad.toLocaleString("es-ES")} elevaciones/s en este equipo
              </span>
              <span className="etiqueta">Trabajo secuencial</span>
              <span className="dato">{formatearPlazo(herencia.duracionEfectivaMs)}</span>
            </div>

            {herencia.recortado && (
              <div className="aviso senal" style={{ marginTop: 16, marginBottom: 0 }}>
                <span className="glifo">!</span>
                <span>
                  El puzzle guarda sus elevaciones en 32 bits, así que el plazo pedido no cabía y se
                  ha recortado al tope del formato: el trabajo real son{" "}
                  {formatearPlazo(herencia.duracionEfectivaMs)}, no {plazoDias} días. Y esa medida
                  es floja por naturaleza —el hardware de dentro de unos años irá más rápido—, que
                  es justo por lo que la herencia no se apoya solo en el tiempo.
                </span>
              </div>
            )}
          </div>

          <TablaSobres sobres={herencia.sobres} />

          <div className="panel">
            <p className="prosa" style={{ fontSize: 13.5 }}>
              El paquete lleva la parte pública —el interruptor, el puzzle y los fragmentos
              cifrados—; cada sobre lleva la clave con la que su beneficiario abre el suyo. Ni el
              paquete ni los sobres se guardan en la bóveda: dejarlos dentro sería pedirle a tus
              herederos que abran la bóveda para poder abrir la bóveda. Guarda el paquete donde tus
              herederos lo encuentren —un notario, una copia en casa— y reparte los sobres.
            </p>
          </div>
        </>
      )}
    </>
  );
}
