import { describe, expect, it } from "vitest";
import { AeadError, concatBytes, randomBytes, toHex } from "@cerbero/crypto";
import {
  COMPARTIDO_MAGIC,
  CompartidoCodigoError,
  CompartidoFormatoError,
  ConstructorEnvio,
  LONGITUD_CODIGO,
  MAX_COMPARTIDO_DOCUMENTOS,
  abrirEnvio,
  generarCodigo,
  inspeccionarEnvio,
  lectorDeBytes,
  normalizarCodigo,
  type ArchivoParaEnviar,
} from "../src/index.ts";

const TROZO = 300; // pequeño a propósito: cubre fronteras de trozo con pocos bytes
const CODIGO = "ABCDE-FGHJK-MNPQR-STVWX";

const archivo = (nombre: string, n: number, mime = "application/pdf"): ArchivoParaEnviar => ({
  nombre,
  mime,
  datos: randomBytes(n),
});

function envio(archivos: readonly ArchivoParaEnviar[], codigo: string = CODIGO) {
  const b = ConstructorEnvio.crear({ perfil: "test", trozo: TROZO, codigo });
  for (const a of archivos) b.anadir(a);
  return concatBytes(...b.terminar(1_700_000_000_000));
}

const inspeccionar = (bytes: Uint8Array) => inspeccionarEnvio(lectorDeBytes(bytes));
const abrir = async (bytes: Uint8Array, codigo: string = CODIGO) =>
  abrirEnvio(await inspeccionar(bytes), codigo, { trozo: TROZO });

/** Los bloques de documentos de un envío, para poder recolocarlos. */
async function bloques(bytes: Uint8Array) {
  const i = await inspeccionar(bytes);
  return { i, partes: i.documentos.map((d) => bytes.subarray(d.desde - 4, d.desde + d.tam)) };
}
const inicioDocumentos = async (bytes: Uint8Array) => (await inspeccionar(bytes)).documentos[0]!.desde - 4;

describe("el código", () => {
  it("tiene la forma de cuatro grupos de cinco, del alfabeto sin letras confusas", () => {
    for (let n = 0; n < 200; n++) {
      expect(generarCodigo()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    }
  });

  it("nunca contiene I, L, O ni U", () => {
    const todos = Array.from({ length: 300 }, generarCodigo).join("");
    expect(todos).not.toMatch(/[ILOU]/);
  });

  it("es de azar: ni repetidos ni sesgo grosero por símbolo", () => {
    const codigos = Array.from({ length: 500 }, generarCodigo);
    expect(new Set(codigos).size).toBe(500);
    const cuentas = new Map<string, number>();
    for (const c of codigos.join("").replaceAll("-", "")) cuentas.set(c, (cuentas.get(c) ?? 0) + 1);
    // 10 000 símbolos entre 32: unos 312 cada uno. Una cota muy holgada basta
    // para cazar un sesgo de verdad (por ejemplo un módulo mal hecho).
    expect(cuentas.size).toBe(32);
    for (const n of cuentas.values()) expect(n).toBeGreaterThan(200);
    for (const n of cuentas.values()) expect(n).toBeLessThan(430);
  });

  it("al escribirlo se perdonan mayúsculas, espacios, guiones y las confusiones de siempre", () => {
    const canonico = normalizarCodigo(CODIGO);
    expect(canonico).toHaveLength(LONGITUD_CODIGO);
    expect(normalizarCodigo("abcde fghjk mnpqr stvwx")).toBe(canonico);
    expect(normalizarCodigo("  ABCDE_FGHJK-MNPQR STVWX \n")).toBe(canonico);
    // I y L se leen como 1; O como 0.
    expect(normalizarCodigo("OIL00-11111-22222-33333")).toBe("01100" + "11111" + "22222" + "33333");
  });

  it("rechaza lo que no puede ser un código, sin gastar Argon2", () => {
    for (const malo of ["", "ABCDE", `${CODIGO}A`, "ABCDE-FGHJK-MNPQR-STVW!", "UUUUU-UUUUU-UUUUU-UUUUU"]) {
      expect(() => normalizarCodigo(malo), malo).toThrow(CompartidoFormatoError);
    }
  });
});

describe("crear y abrir un envío", () => {
  it("un documento sale idéntico, con su nombre, su tipo y su tamaño", async () => {
    const a = archivo("DNI frontal.jpg", 1234, "image/jpeg");
    const abierto = await abrir(envio([a]));
    expect(abierto.manifiesto.documentos).toEqual([{ nombre: "DNI frontal.jpg", mime: "image/jpeg", tam: 1234 }]);
    expect(abierto.manifiesto.creado).toBe(1_700_000_000_000);
    const i = await inspeccionar(envio([a]));
    expect(i.documentos).toHaveLength(1);
  });

  it("varios documentos salen idénticos y en su orden, de cualquier tamaño, incluidas las fronteras", async () => {
    const tamanos = [1, 2, 251, 252, 253, 296, 297, 300, 301, 596, 600, 4091, 4093, 10_000, 65_533];
    const archivos = tamanos.map((n, k) => archivo(`doc-${k}.bin`, n, "application/octet-stream"));
    // Un envío admite 50 documentos: quince caben de sobra.
    const bytes = envio(archivos);
    const abierto = await abrir(bytes);
    const i = await inspeccionar(bytes);
    expect(abierto.manifiesto.documentos.map((d) => d.nombre)).toEqual(archivos.map((a) => a.nombre));
    for (let k = 0; k < archivos.length; k++) {
      const r = abierto.registro(k);
      const vuelto = abierto.abrirDocumento(k, bytes.subarray(r.desde, r.desde + r.tam));
      expect(toHex(vuelto), `documento ${k}`).toBe(toHex(archivos[k]!.datos));
    }
    expect(i.documentos).toHaveLength(archivos.length);
  });

  it("con el tamaño de trozo real, un documento de 2,5 MiB sale idéntico", async () => {
    const a = archivo("grande.pdf", 2_621_440);
    const b = ConstructorEnvio.crear({ perfil: "test", codigo: CODIGO });
    b.anadir(a);
    const bytes = concatBytes(...b.terminar());
    const abierto = abrirEnvio(await inspeccionar(bytes), CODIGO);
    const r = abierto.registro(0);
    expect(Buffer.compare(Buffer.from(abierto.abrirDocumento(0, bytes.subarray(r.desde, r.desde + r.tam))), Buffer.from(a.datos))).toBe(0);
  });

  it("el fichero no deja ni los nombres ni el contenido en claro", () => {
    const marca = new TextEncoder().encode("ESCRITURA DE PROPIEDAD 4471 DNI 12345678Z");
    const datos = new Uint8Array(5000);
    datos.set(marca, 700);
    const bytes = envio([{ nombre: "Escritura piso Madrid.pdf", mime: "application/pdf", datos }]);
    const hex = toHex(bytes);
    expect(hex).not.toContain(toHex(marca));
    expect(hex).not.toContain(toHex(new TextEncoder().encode("Escritura")));
    expect(hex).not.toContain(toHex(new TextEncoder().encode("application/pdf")));
    expect(hex).not.toContain(toHex(new TextEncoder().encode(CODIGO)));
  });

  it("empieza por el magic de los envíos y no por el de las cajas ni el de las copias", () => {
    const bytes = envio([archivo("a.pdf", 10)]);
    expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(COMPARTIDO_MAGIC));
  });

  it("dos envíos del mismo documento con el mismo código no se parecen: sal y nonces nuevos", () => {
    const a = archivo("a.pdf", 500);
    expect(toHex(envio([a]))).not.toBe(toHex(envio([a])));
  });

  it("el tamaño del envío cae en un cubo: dos documentos distintos del mismo cubo pesan lo mismo", () => {
    const corto = envio([archivo("corto.pdf", 70_000)]);
    const largo = envio([archivo("un nombre bastante más largo que el otro.pdf", 120_000)]);
    // 70 000 y 120 000 caen en el cubo de 131 072; el manifiesto va con suelo propio.
    expect(corto.length).toBe(largo.length);
  });

  it("el código que no es el suyo no lo abre, con el mismo mensaje que un fichero alterado", async () => {
    const bytes = envio([archivo("a.pdf", 100)]);
    const i = await inspeccionar(bytes);
    expect(() => abrirEnvio(i, "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ", { trozo: TROZO })).toThrow(CompartidoCodigoError);
    expect(() => abrirEnvio(i, "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ", { trozo: TROZO })).toThrow(
      "código incorrecto, o el fichero está alterado",
    );
  });

  it("un código mal escrito falla antes de gastar Argon2, con otro mensaje", async () => {
    const i = await inspeccionar(envio([archivo("a.pdf", 100)]));
    expect(() => abrirEnvio(i, "ABC", { trozo: TROZO })).toThrow(CompartidoFormatoError);
  });

  it("un envío abierto se cierra: sin clave no descifra", async () => {
    const bytes = envio([archivo("a.pdf", 100)]);
    const abierto = await abrir(bytes);
    const r = abierto.registro(0);
    abierto.cerrar();
    expect(abierto.cerrado).toBe(true);
    expect(() => abierto.abrirDocumento(0, bytes.subarray(r.desde, r.desde + r.tam))).toThrow(/cerrado/);
  });

  it("el constructor no se reutiliza tras terminar ni tras cancelar", () => {
    const b = ConstructorEnvio.crear({ perfil: "test", codigo: CODIGO });
    b.anadir(archivo("a.pdf", 10));
    b.terminar();
    expect(() => b.anadir(archivo("b.pdf", 10))).toThrow(/terminado o cancelado/);
    expect(() => b.terminar()).toThrow(/terminado o cancelado/);

    const c = ConstructorEnvio.crear({ perfil: "test", codigo: CODIGO });
    c.cancelar();
    expect(() => c.anadir(archivo("a.pdf", 10))).toThrow(/terminado o cancelado/);
  });

  it("un envío sin documentos no se puede crear", () => {
    const b = ConstructorEnvio.crear({ perfil: "test", codigo: CODIGO });
    expect(() => b.terminar()).toThrow(/al menos un documento/);
  });

  it("tiene un tope de documentos, y no admite uno vacío", () => {
    const b = ConstructorEnvio.crear({ perfil: "test", codigo: CODIGO });
    for (let n = 0; n < MAX_COMPARTIDO_DOCUMENTOS; n++) b.anadir(archivo(`d${n}`, 1));
    expect(() => b.anadir(archivo("de más", 1))).toThrow(/hasta 50 documentos/);
    expect(() => ConstructorEnvio.crear({ perfil: "test" }).anadir({ nombre: "v", mime: "x", datos: new Uint8Array(0) })).toThrow(/vacío/);
  });

  it("sin pasar un código, genera uno válido y lo expone para enseñarlo", async () => {
    const b = ConstructorEnvio.crear({ perfil: "test", trozo: TROZO });
    b.anadir(archivo("a.pdf", 50));
    const bytes = concatBytes(...b.terminar());
    expect(b.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect((await abrir(bytes, b.codigo)).manifiesto.documentos).toHaveLength(1);
  });
});

describe("manipulaciones del fichero", () => {
  const A = () => archivo("a.pdf", 700);
  const B = () => archivo("b.pdf", 700);

  it("alterar el magic o la versión se rechaza al elegirlo, sin pedir el código", async () => {
    const bytes = envio([A()]);
    for (const [pos, quiero] of [[0, /no es un envío/], [9, /versión/]] as const) {
      const roto = Uint8Array.from(bytes);
      roto[pos] = (roto[pos] as number) ^ 1;
      await expect(inspeccionar(roto), `byte ${pos}`).rejects.toThrow(quiero);
    }
  });

  it("alterar la sal, el identificador o el coste de derivación impide abrirlo", async () => {
    const bytes = envio([A()]);
    // sal (22..53), identificador del envío (54..69) y memoria de Argon2 (14..17).
    for (const pos of [22, 40, 53, 54, 60, 69, 17]) {
      const roto = Uint8Array.from(bytes);
      roto[pos] = (roto[pos] as number) ^ 1;
      await expect(abrir(roto), `byte ${pos}`).rejects.toThrow();
    }
  });

  it("alterar el manifiesto falla con el mismo mensaje que un código equivocado", async () => {
    const bytes = envio([A()]);
    for (const pos of [74, 100, 2000]) {
      const roto = Uint8Array.from(bytes);
      roto[pos] = (roto[pos] as number) ^ 1;
      await expect(abrir(roto), `byte ${pos}`).rejects.toThrow(CompartidoCodigoError);
    }
  });

  it("cambiar un bit de un documento falla al descifrarlo", async () => {
    const bytes = envio([A(), B()]);
    const abierto = await abrir(bytes);
    const r = abierto.registro(1);
    for (const pos of [r.desde, r.desde + 50, r.desde + r.tam - 1]) {
      const roto = Uint8Array.from(bytes);
      roto[pos] = (roto[pos] as number) ^ 1;
      expect(() => abierto.abrirDocumento(1, roto.subarray(r.desde, r.desde + r.tam)), `byte ${pos}`).toThrow(AeadError);
    }
  });

  it("quitar el último documento o añadir uno de más se detecta", async () => {
    const bytes = envio([A(), B()]);
    const { i, partes } = await bloques(bytes);
    const cabeza = bytes.subarray(0, await inicioDocumentos(bytes));
    const sinUltimo = concatBytes(cabeza, partes[0]!);
    await expect(abrir(sinUltimo)).rejects.toThrow(/incompleto|datos de más/);
    const conExtra = concatBytes(bytes, partes[0]!);
    await expect(abrir(conExtra)).rejects.toThrow(/incompleto|datos de más/);
    expect(i.documentos).toHaveLength(2);
  });

  it("cualquier recorte del fichero se rechaza, sea donde sea", async () => {
    const bytes = envio([A()]);
    for (let n = 0; n < bytes.length; n += 11) {
      await expect(inspeccionar(bytes.subarray(0, n)), `recorte en ${n}`).rejects.toThrow(CompartidoFormatoError);
    }
  });

  it("recolocar dos documentos del mismo tamaño falla: el orden va en la clave", async () => {
    const bytes = envio([A(), B()]);
    const { partes } = await bloques(bytes);
    const cabeza = bytes.subarray(0, await inicioDocumentos(bytes));
    const cambiado = concatBytes(cabeza, partes[1]!, partes[0]!);
    const abierto = await abrir(cambiado);
    const r = abierto.registro(0);
    expect(() => abierto.abrirDocumento(0, cambiado.subarray(r.desde, r.desde + r.tam))).toThrow(AeadError);
  });

  it("un documento de otro envío, aunque tenga el mismo código, no se cuela", async () => {
    const uno = envio([A()]);
    const otro = envio([A()]);
    const abierto = await abrir(uno);
    const ri = await inspeccionar(otro);
    const d = ri.documentos[0]!;
    expect(() => abierto.abrirDocumento(0, otro.subarray(d.desde, d.desde + d.tam))).toThrow(AeadError);
  });

  it("un coste de Argon2 que pediría terabytes se rechaza sin derivar nada", async () => {
    const bytes = envio([A()]);
    const gigante = Uint8Array.from(bytes);
    new DataView(gigante.buffer).setUint32(14, 0x7fffffff);
    await expect(inspeccionar(gigante)).rejects.toThrow(/fuera de rango/);
    const cero = Uint8Array.from(bytes);
    new DataView(cero.buffer).setUint32(10, 0);
    await expect(inspeccionar(cero)).rejects.toThrow(/fuera de rango/);
  });

  it("rechaza tamaños absurdos de manifiesto y de documentos, y un envío sin documentos", async () => {
    const bytes = envio([A()]);
    const manifiesto = Uint8Array.from(bytes);
    new DataView(manifiesto.buffer).setUint32(70, 0xffffffff);
    await expect(inspeccionar(manifiesto)).rejects.toThrow(CompartidoFormatoError);

    const documento = Uint8Array.from(bytes);
    const inicio = await inicioDocumentos(bytes);
    new DataView(documento.buffer).setUint32(inicio, 0xffffffff);
    await expect(inspeccionar(documento)).rejects.toThrow(CompartidoFormatoError);

    await expect(inspeccionar(bytes.subarray(0, inicio))).rejects.toThrow(/ningún documento/);
  });

  it("rechaza un fichero de otra cosa: demasiado corto, copia de seguridad, texto", async () => {
    await expect(inspeccionar(new Uint8Array(10))).rejects.toThrow(/demasiado corto/);
    await expect(inspeccionar(new TextEncoder().encode("ARCABAK1".padEnd(200, "x")))).rejects.toThrow(/no es un envío/);
    await expect(inspeccionar(new TextEncoder().encode("hola ".repeat(100)))).rejects.toThrow(/no es un envío/);
  });

  it("un lector que devuelve menos bytes de los pedidos se trata como envío cortado", async () => {
    const bytes = envio([A()]);
    const corto = { tamano: bytes.length, leer: async (d: number, n: number) => bytes.subarray(d, d + n - 1) };
    await expect(inspeccionarEnvio(corto)).rejects.toThrow(CompartidoFormatoError);
  });

  it("más documentos de los permitidos se rechaza al inspeccionar", async () => {
    const bytes = envio([A()]);
    const cabeza = bytes.subarray(0, await inicioDocumentos(bytes));
    const falso = concatBytes(new Uint8Array([0, 0, 0, 41]), new Uint8Array(41));
    const demasiados = concatBytes(cabeza, ...Array.from({ length: MAX_COMPARTIDO_DOCUMENTOS + 1 }, () => falso));
    await expect(inspeccionar(demasiados)).rejects.toThrow(/más documentos/);
  });
});
