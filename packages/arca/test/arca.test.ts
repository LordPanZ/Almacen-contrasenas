import { describe, expect, it } from "vitest";
import { AeadError, SecretBuffer, concatBytes, randomBytes, toHex } from "@cerbero/crypto";
import {
  CABECERA_LENGTH,
  CajaBloqueadaError,
  CajaFormatoError,
  CajaPasswordError,
  MAX_DOCUMENTO,
  abrirCaja,
  abrirIndice,
  cambiarPassword,
  crearCaja,
  cubo,
  indiceVacio,
  inspeccionarPaquete,
  leerCabecera,
  leerIndice,
  lectorDeBytes,
  nuevoIdDocumento,
  preambuloPaquete,
  prefijoDocumento,
  tamanoSellado,
  type Indice,
} from "../src/index.ts";

const clave = (t = "correcto caballo grapa") => SecretBuffer.fromText(t);
const nueva = () => crearCaja(clave(), { perfil: "test" });

function indiceCon(n: number): Indice {
  return {
    version: 1,
    revision: n,
    documentos: Array.from({ length: n }, (_, i) => ({
      id: nuevoIdDocumento(),
      nombre: `documento-${i}.pdf`,
      mime: "application/pdf",
      tam: 1000 + i,
      categoria: "identidad",
      notas: "",
      creado: 1,
      actualizado: 2,
    })),
  };
}

describe("caja: apertura y contraseña", () => {
  it("una caja creada se abre con su contraseña y descifra lo suyo", () => {
    const { cabecera, caja } = nueva();
    const indice = indiceCon(2);
    const sellado = caja.sellarIndice(indice);
    const abierta = abrirCaja(cabecera, clave());
    expect(abierta.id).toBe(caja.id);
    expect(abierta.abrirIndice(sellado)).toEqual(indice);
  });

  it("una contraseña incorrecta falla", () => {
    const { cabecera } = nueva();
    expect(() => abrirCaja(cabecera, clave("otra contraseña"))).toThrow(CajaPasswordError);
  });

  it("alterar cualquier byte del sobre, la sal o el identificador impide abrirla", () => {
    const { cabecera } = nueva();
    // Desde el identificador (offset 10) hasta el final: todo lo que el sobre autentica.
    for (const posicion of [10, 20, 26, 30, 38, 60, 75, 100, CABECERA_LENGTH - 1]) {
      const rota = Uint8Array.from(cabecera);
      rota[posicion] = (rota[posicion] as number) ^ 1;
      expect(() => abrirCaja(rota, clave()), `byte ${posicion}`).toThrow();
    }
  });

  it("rechaza una cabecera con otro magic, recortada o alargada, sin gastar Argon2", () => {
    const { cabecera } = nueva();
    const otroMagic = Uint8Array.from(cabecera);
    otroMagic[0] = 0;
    expect(() => leerCabecera(otroMagic)).toThrow(CajaFormatoError);
    expect(() => leerCabecera(cabecera.subarray(0, cabecera.length - 1))).toThrow(CajaFormatoError);
    expect(() => leerCabecera(concatBytes(cabecera, new Uint8Array(1)))).toThrow(CajaFormatoError);
  });

  it("rechaza parámetros de Argon2 que pedirían terabytes de memoria", () => {
    const { cabecera } = nueva();
    const gigante = Uint8Array.from(cabecera);
    // Memoria en KiB: bytes 30..33 (magic 8 + versión 2 + id 16 + tiempo 4).
    new DataView(gigante.buffer).setUint32(30, 0x7fffffff);
    expect(() => leerCabecera(gigante)).toThrow(/fuera de rango/);
  });

  it("dos cajas con la misma contraseña no comparten sal ni claves", () => {
    const a = nueva();
    const b = nueva();
    expect(toHex(leerCabecera(a.cabecera).sal)).not.toBe(toHex(leerCabecera(b.cabecera).sal));
    const id = nuevoIdDocumento();
    const sellado = a.caja.sellarDocumento(id, randomBytes(500));
    expect(() => b.caja.abrirDocumento(id, sellado)).toThrow(AeadError);
  });

  it("bloquear borra las claves y deja la caja inservible", () => {
    const { caja } = nueva();
    caja.bloquear();
    expect(caja.bloqueada).toBe(true);
    expect(() => caja.sellarIndice(indiceVacio())).toThrow(CajaBloqueadaError);
    expect(() => caja.sellarDocumento(nuevoIdDocumento(), randomBytes(10))).toThrow(CajaBloqueadaError);
  });

  it("la cabecera no contiene la clave de datos ni nada del contenido", () => {
    const { cabecera, caja } = nueva();
    const marca = new TextEncoder().encode("ESCRITURA 4471");
    caja.sellarIndice({
      ...indiceVacio(),
      documentos: [{ ...indiceCon(1).documentos[0]!, nombre: "ESCRITURA 4471" }],
    });
    expect(toHex(cabecera)).not.toContain(toHex(marca));
  });
});

describe("caja: cambio de contraseña", () => {
  it("la nueva abre, la vieja ya no, y lo guardado sigue siendo legible", () => {
    const { cabecera, caja } = nueva();
    const id = nuevoIdDocumento();
    const original = randomBytes(3000);
    const doc = caja.sellarDocumento(id, original);
    const indice = caja.sellarIndice(indiceCon(3));

    const nuevaCabecera = cambiarPassword(cabecera, clave(), clave("la contraseña nueva"), {
      perfil: "test",
    });
    expect(() => abrirCaja(nuevaCabecera, clave())).toThrow(CajaPasswordError);
    const abierta = abrirCaja(nuevaCabecera, clave("la contraseña nueva"));

    // Mismo identificador y mismos datos: no hubo que recifrar nada.
    expect(abierta.id).toBe(caja.id);
    expect(toHex(abierta.abrirDocumento(id, doc))).toBe(toHex(original));
    expect(abierta.abrirIndice(indice).documentos).toHaveLength(3);
    expect(nuevaCabecera.length).toBe(cabecera.length);
  });

  it("estrena sal: no reutiliza la derivación de la contraseña anterior", () => {
    const { cabecera } = nueva();
    const otra = cambiarPassword(cabecera, clave(), clave(), { perfil: "test" });
    expect(toHex(leerCabecera(otra).sal)).not.toBe(toHex(leerCabecera(cabecera).sal));
  });

  it("con la contraseña actual equivocada no toca nada en vez de dejarte fuera", () => {
    const { cabecera } = nueva();
    expect(() => cambiarPassword(cabecera, clave("me equivoqué"), clave("nueva"))).toThrow(
      CajaPasswordError,
    );
    // La cabecera original sigue abriéndose con la contraseña de siempre.
    expect(abrirCaja(cabecera, clave()).bloqueada).toBe(false);
  });
});

describe("índice", () => {
  it("el tamaño del índice cifrado no dice cuántos documentos hay, mientras sean pocos", () => {
    const { caja } = nueva();
    const tamanos = [0, 1, 4, 20, 40].map((n) => caja.sellarIndice(indiceCon(n)).length);
    expect(new Set(tamanos).size).toBe(1);
  });

  it("y cuando se queda pequeño el suelo, solo revela el cubo", () => {
    const { caja } = nueva();
    const grande = caja.sellarIndice(indiceCon(400)).length;
    expect(grande).toBeGreaterThan(caja.sellarIndice(indiceCon(1)).length);
    expect(grande % 1024).toBe(40); // un cubo exacto más la sobrecarga del AEAD
  });

  it("un índice de otra caja no se abre", () => {
    const a = nueva().caja;
    const b = nueva().caja;
    expect(() => b.abrirIndice(a.sellarIndice(indiceCon(1)))).toThrow(AeadError);
  });

  it("detecta un byte alterado", () => {
    const { caja } = nueva();
    const sellado = Uint8Array.from(caja.sellarIndice(indiceCon(2)));
    sellado[60] = (sellado[60] as number) ^ 1;
    expect(() => caja.abrirIndice(sellado)).toThrow(AeadError);
  });

  it("valida la forma: repetidos, ids raros, tamaños imposibles y campos que faltan", () => {
    const base = indiceCon(1).documentos[0]!;
    const con = (d: unknown) => JSON.stringify({ version: 1, revision: 1, documentos: d });
    expect(() => leerIndice(con([base, base]))).toThrow(/repite/);
    expect(() => leerIndice(con([{ ...base, id: "zz" }]))).toThrow(/identificador/);
    expect(() => leerIndice(con([{ ...base, tam: -1 }]))).toThrow(CajaFormatoError);
    expect(() => leerIndice(con([{ ...base, tam: MAX_DOCUMENTO + 1 }]))).toThrow(/tamaño/);
    expect(() => leerIndice(con([{ ...base, nombre: undefined }]))).toThrow(/nombre/);
    expect(() => leerIndice("{")).toThrow(/JSON/);
    expect(() => leerIndice(JSON.stringify({ version: 2, revision: 0, documentos: [] }))).toThrow(
      /versión/,
    );
  });

  it("abrirIndice exportada funciona igual que la del objeto", () => {
    expect(typeof abrirIndice).toBe("function");
  });
});

describe("documentos", () => {
  const TROZO = 300; // pequeño a propósito: cubre fronteras de trozo con pocos bytes

  it("recupera idéntico cualquier tamaño, incluidas las fronteras de trozo y de cubo", () => {
    const { caja } = nueva();
    const tamanos = [1, 2, 3, 4, 5, 251, 252, 253, 255, 256, 257, 296, 297, 299, 300, 301, 596, 597, 600,
      1019, 1020, 1021, 4091, 4092, 4093, 10_000, 65_531, 65_532, 65_533, 130_000];
    for (const n of tamanos) {
      const id = nuevoIdDocumento();
      const original = randomBytes(n);
      const sellado = caja.sellarDocumento(id, original, { trozo: TROZO });
      expect(sellado.length, `longitud sellada de ${n}`).toBe(tamanoSellado(n, { trozo: TROZO }));
      const vuelto = caja.abrirDocumento(id, sellado, { trozo: TROZO });
      expect(toHex(vuelto), `contenido de ${n}`).toBe(toHex(original));
    }
  });

  it("con el tamaño de trozo real, un documento de 2,5 MiB sale idéntico", () => {
    const { caja } = nueva();
    const id = nuevoIdDocumento();
    const original = randomBytes(2_621_440);
    const vuelto = caja.abrirDocumento(id, caja.sellarDocumento(id, original));
    expect(Buffer.compare(Buffer.from(vuelto), Buffer.from(original))).toBe(0);
  });

  it("no deja el contenido en claro dentro del criptograma", () => {
    const { caja } = nueva();
    const marca = new TextEncoder().encode("ESCRITURA DE PROPIEDAD 4471 DNI 12345678Z");
    const original = new Uint8Array(5000);
    original.set(marca, 700);
    const sellado = caja.sellarDocumento(nuevoIdDocumento(), original, { trozo: TROZO });
    expect(toHex(sellado)).not.toContain(toHex(marca));
  });

  it("el tamaño cifrado cae en un cubo y no delata el del original", () => {
    const { caja } = nueva();
    const a = caja.sellarDocumento(nuevoIdDocumento(), randomBytes(70_000)).length;
    const b = caja.sellarDocumento(nuevoIdDocumento(), randomBytes(120_000)).length;
    expect(a).toBe(b);
    expect(cubo(70_004)).toBe(131_072);
  });

  describe("manipulaciones del cifrado por trozos", () => {
    const unidad = TROZO + 40;
    function documento() {
      const { caja } = nueva();
      const id = nuevoIdDocumento();
      const sellado = caja.sellarDocumento(id, randomBytes(1000), { trozo: TROZO });
      return { caja, id, sellado, trozos: Math.ceil(sellado.length / unidad) };
    }
    const abrir = (c: ReturnType<typeof documento>, bytes: Uint8Array, id = c.id) =>
      c.caja.abrirDocumento(id, bytes, { trozo: TROZO });
    const trozo = (s: Uint8Array, i: number) => s.subarray(i * unidad, Math.min(s.length, (i + 1) * unidad));

    it("tiene varios trozos, para que estas pruebas signifiquen algo", () => {
      expect(documento().trozos).toBeGreaterThanOrEqual(4);
    });

    it("reordenar dos trozos falla", () => {
      const c = documento();
      const rev = concatBytes(trozo(c.sellado, 1), trozo(c.sellado, 0), c.sellado.subarray(2 * unidad));
      expect(() => abrir(c, rev)).toThrow(AeadError);
    });

    it("repetir un trozo falla", () => {
      const c = documento();
      const dup = concatBytes(c.sellado.subarray(0, unidad), c.sellado.subarray(0, unidad), c.sellado.subarray(unidad));
      expect(() => abrir(c, dup)).toThrow();
    });

    it("quitar el último trozo falla: un documento recortado no pasa por completo", () => {
      const c = documento();
      // Primera capa: la longitud total depende de la longitud declarada, que va
      // autenticada en el primer trozo, así que un recorte no cuadra.
      expect(() => abrir(c, c.sellado.subarray(0, (c.trozos - 1) * unidad))).toThrow(
        /no cuadra|autenticado/,
      );
    });

    it("el aviso de «último trozo» está autenticado por separado de la longitud", () => {
      // Segunda capa: un trozo sellado como no-último no se acepta como último,
      // aunque se le ponga delante un fichero que lo presente como completo.
      const c = documento();
      expect(() => abrir(c, c.sellado.subarray(0, unidad))).toThrow(AeadError);
    });

    it("añadir un trozo al final falla", () => {
      const c = documento();
      const otro = concatBytes(c.sellado, trozo(c.sellado, 0));
      expect(() => abrir(c, otro)).toThrow();
    });

    it("cambiar un solo bit en cualquier trozo falla", () => {
      const c = documento();
      for (const pos of [0, 30, unidad + 5, 2 * unidad + 100, c.sellado.length - 1]) {
        const roto = Uint8Array.from(c.sellado);
        roto[pos] = (roto[pos] as number) ^ 1;
        expect(() => abrir(c, roto), `bit en ${pos}`).toThrow(AeadError);
      }
    });

    it("el criptograma de un documento no se hace pasar por otro de la misma caja", () => {
      const c = documento();
      const otroId = nuevoIdDocumento();
      expect(() => abrir(c, c.sellado, otroId)).toThrow(AeadError);
    });

    it("mezclar trozos de dos documentos de la misma caja falla", () => {
      const { caja } = nueva();
      const idA = nuevoIdDocumento();
      const idB = nuevoIdDocumento();
      const a = caja.sellarDocumento(idA, randomBytes(1000), { trozo: TROZO });
      const b = caja.sellarDocumento(idB, randomBytes(1000), { trozo: TROZO });
      const mezcla = concatBytes(a.subarray(0, unidad), b.subarray(unidad));
      expect(() => caja.abrirDocumento(idA, mezcla, { trozo: TROZO })).toThrow(AeadError);
    });

    it("rechaza tamaños imposibles antes de intentar descifrar", () => {
      const c = documento();
      expect(() => abrir(c, new Uint8Array(10))).toThrow(CajaFormatoError);
      expect(() => abrir(c, concatBytes(c.sellado.subarray(0, unidad), new Uint8Array(20)))).toThrow();
    });
  });

  it("rechaza un documento vacío, uno por encima del tope y un identificador mal formado", () => {
    const { caja } = nueva();
    expect(() => caja.sellarDocumento(nuevoIdDocumento(), new Uint8Array(0))).toThrow(/vacío/);
    expect(() => caja.sellarDocumento(nuevoIdDocumento(), new Uint8Array(MAX_DOCUMENTO + 1))).toThrow(
      /máximo/,
    );
    expect(() => caja.sellarDocumento("no-es-un-id", randomBytes(10))).toThrow(/identificador/);
  });
});

describe("copia de seguridad", () => {
  function copia(n: number) {
    const { cabecera, caja } = nueva();
    const indice = caja.sellarIndice(indiceCon(n));
    const docs = Array.from({ length: n }, () => {
      const id = nuevoIdDocumento();
      return { id, sellado: caja.sellarDocumento(id, randomBytes(700), { trozo: 300 }) };
    });
    const piezas: Uint8Array[] = [preambuloPaquete(cabecera, indice, n)];
    for (const d of docs) piezas.push(prefijoDocumento(d.id, d.sellado.length), d.sellado);
    return { bytes: concatBytes(...piezas), cabecera, indice, docs };
  }

  it("inspeccionar devuelve cabecera, índice y dónde está cada documento", async () => {
    const c = copia(3);
    const r = await inspeccionarPaquete(lectorDeBytes(c.bytes));
    expect(toHex(r.cabecera)).toBe(toHex(c.cabecera));
    expect(toHex(r.indice)).toBe(toHex(c.indice));
    expect(r.documentos.map((d) => d.id)).toEqual(c.docs.map((d) => d.id));
    r.documentos.forEach((d, i) => {
      expect(toHex(c.bytes.subarray(d.desde, d.desde + d.tam))).toBe(toHex(c.docs[i]!.sellado));
    });
  });

  it("una copia sin documentos es válida", async () => {
    const r = await inspeccionarPaquete(lectorDeBytes(copia(0).bytes));
    expect(r.documentos).toEqual([]);
  });

  it("cualquier recorte de la copia se rechaza, sea donde sea", async () => {
    const { bytes } = copia(2);
    for (let n = 0; n < bytes.length; n += 7) {
      await expect(inspeccionarPaquete(lectorDeBytes(bytes.subarray(0, n))), `recorte en ${n}`).rejects.toThrow(
        CajaFormatoError,
      );
    }
  });

  it("rechaza otro magic, datos sobrantes, documentos repetidos y longitudes absurdas", async () => {
    const c = copia(2);
    const otro = Uint8Array.from(c.bytes);
    otro[0] = 0;
    await expect(inspeccionarPaquete(lectorDeBytes(otro))).rejects.toThrow(/no es una copia/);

    await expect(inspeccionarPaquete(lectorDeBytes(concatBytes(c.bytes, new Uint8Array(3))))).rejects.toThrow(
      /sobrantes/,
    );

    const d = c.docs[0]!;
    const repetido = concatBytes(
      preambuloPaquete(c.cabecera, c.indice, 2),
      prefijoDocumento(d.id, d.sellado.length),
      d.sellado,
      prefijoDocumento(d.id, d.sellado.length),
      d.sellado,
    );
    await expect(inspeccionarPaquete(lectorDeBytes(repetido))).rejects.toThrow(/repite/);

    const absurdo = Uint8Array.from(c.bytes);
    const posicion = preambuloPaquete(c.cabecera, c.indice, 2).length + 16;
    new DataView(absurdo.buffer).setUint32(posicion, 0xffffffff);
    await expect(inspeccionarPaquete(lectorDeBytes(absurdo))).rejects.toThrow(CajaFormatoError);
  });

  it("un lector que devuelve menos bytes de los pedidos se trata como copia cortada", async () => {
    const { bytes } = copia(1);
    const corto = { tamano: bytes.length, leer: async (d: number, n: number) => bytes.subarray(d, d + n - 1) };
    await expect(inspeccionarPaquete(corto)).rejects.toThrow(CajaFormatoError);
  });

  it("lo restaurado se abre con la contraseña y se descifra", async () => {
    const c = copia(2);
    const r = await inspeccionarPaquete(lectorDeBytes(c.bytes));
    const caja = abrirCaja(r.cabecera, clave());
    expect(caja.abrirIndice(r.indice).documentos).toHaveLength(2);
    const d = r.documentos[0]!;
    const original = c.docs[0]!;
    expect(
      caja.abrirDocumento(d.id, c.bytes.subarray(d.desde, d.desde + d.tam), { trozo: 300 }).length,
    ).toBe(700);
    void original;
  });
});
