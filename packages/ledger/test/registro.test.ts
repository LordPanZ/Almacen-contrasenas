import { describe, expect, it } from "vitest";
import {
  generateSigningKeyPair,
  InvalidInputError,
  toHex,
  utf8Encode,
} from "@cerbero/crypto";
import type { HybridSigningKeyPair } from "@cerbero/crypto";
import {
  AuditLedger,
  LEDGER_EVENT_TYPES,
  LedgerError,
  decodeSignedTreeHead,
  detailHash,
  encodeEntry,
  encodeSignedTreeHead,
  entryHash,
  genesisHash,
  merkleRoot,
  verifyConsistency,
  verifyDetail,
  verifyInclusion,
  verifySignedTreeHead,
} from "../src/index.ts";
import type { LedgerEntry } from "../src/index.ts";

const CLAVES: HybridSigningKeyPair = generateSigningKeyPair(new Uint8Array(32).fill(7));
const OTRAS_CLAVES: HybridSigningKeyPair = generateSigningKeyPair(new Uint8Array(32).fill(9));

/** Registro reproducible: marcas de tiempo fijas para que nada dependa del reloj. */
function registroDePrueba(entradas: number, claves = CLAVES): AuditLedger {
  const registro = AuditLedger.create(claves);
  for (let i = 0; i < entradas; i++) {
    registro.append({
      type: "item-added",
      detail: utf8Encode(`detalle-${i}`),
      device: i % 2 === 0 ? "portátil" : "móvil",
      timestamp: 1_700_000_000_000 + i,
    });
  }
  return registro;
}

/** Búsqueda de subcadena de bytes: para comprobar que un secreto NO está. */
function contieneBytes(pajar: Uint8Array, aguja: Uint8Array): boolean {
  if (aguja.length === 0) return true;
  for (let i = 0; i + aguja.length <= pajar.length; i++) {
    let igual = true;
    for (let j = 0; j < aguja.length; j++) {
      if (pajar[i + j] !== aguja[j]) {
        igual = false;
        break;
      }
    }
    if (igual) return true;
  }
  return false;
}

describe("registro de auditoría", () => {
  it("anota los sucesos con índices consecutivos y encadena cada entrada con la anterior", () => {
    const registro = AuditLedger.create(CLAVES);
    expect(registro.size).toBe(0);

    const anotadas: LedgerEntry[] = LEDGER_EVENT_TYPES.map((type, i) =>
      registro.append({ type, detail: utf8Encode(`d-${i}`), timestamp: 1000 + i }),
    );

    expect(registro.size).toBe(LEDGER_EVENT_TYPES.length);
    expect(anotadas[0]?.previousHash).toEqual(genesisHash(registro.publicKey));
    for (let i = 0; i < anotadas.length; i++) {
      const entrada = anotadas[i] as LedgerEntry;
      expect(entrada.index).toBe(i);
      expect(entrada.type).toBe(LEDGER_EVENT_TYPES[i]);
      expect(entrada.timestamp).toBe(1000 + i);
      if (i > 0) {
        expect(entrada.previousHash).toEqual(entryHash(anotadas[i - 1] as LedgerEntry));
      }
    }
  });

  it("guarda el dispositivo solo cuando se indica, sin confundirlo con la cadena vacía", () => {
    const registro = AuditLedger.create(CLAVES);
    const sin = registro.append({ type: "export", timestamp: 1 });
    const vacio = registro.append({ type: "export", device: "", timestamp: 1 });
    const con = registro.append({ type: "export", device: "portátil", timestamp: 1 });
    expect(sin.device).toBeUndefined();
    expect(vacio.device).toBe("");
    expect(con.device).toBe("portátil");
    // La codificación canónica debe distinguir "ausente" de "vacío".
    expect(encodeEntry(sin)).not.toEqual(encodeEntry({ ...vacio, index: sin.index, previousHash: sin.previousHash }));
  });

  it("la raíz es la del árbol Merkle sobre las entradas codificadas", () => {
    const registro = registroDePrueba(9);
    const hojas = registro.entries().map((entrada) => encodeEntry(entrada));
    expect(registro.rootHash).toEqual(merkleRoot(hojas));
    for (let n = 0; n <= 9; n++) {
      expect(registro.rootAt(n)).toEqual(merkleRoot(hojas.slice(0, n)));
    }
  });

  it("produce pruebas de inclusión válidas para todas sus entradas", () => {
    for (const n of [1, 2, 3, 7, 16, 25]) {
      const registro = registroDePrueba(n);
      const raiz = registro.rootHash;
      const entradas = registro.entries();
      for (let i = 0; i < n; i++) {
        const entrada = entradas[i] as LedgerEntry;
        expect(verifyInclusion(raiz, entryHash(entrada), i, n, registro.inclusionProof(i))).toBe(
          true,
        );
      }
    }
  });

  it("produce pruebas de consistencia válidas entre cualquier par de tamaños", () => {
    const registro = registroDePrueba(24);
    for (let n = 0; n <= 24; n++) {
      for (let m = 0; m <= n; m++) {
        expect(
          verifyConsistency(
            registro.rootAt(m),
            m,
            registro.rootAt(n),
            n,
            registro.consistencyProof(m, n),
          ),
        ).toBe(true);
      }
    }
  });

  it("rechaza índices y rangos fuera del registro", () => {
    const registro = registroDePrueba(4);
    expect(() => registro.inclusionProof(4)).toThrow(InvalidInputError);
    expect(() => registro.inclusionProof(-1)).toThrow(InvalidInputError);
    expect(() => registro.consistencyProof(0, 5)).toThrow(InvalidInputError);
    expect(() => registro.consistencyProof(3, 2)).toThrow(InvalidInputError);
    expect(() => registro.rootAt(5)).toThrow(InvalidInputError);
    // @ts-expect-error tipo de suceso inventado
    expect(() => registro.append({ type: "no-existe" })).toThrow(InvalidInputError);
  });

  it("entra un dato secreto y no vuelve a salir: el registro solo guarda su hash", () => {
    const secreto = utf8Encode("contraseña-del-banco:Tr0ub4dor&3");
    const registro = registroDePrueba(3);
    const entrada = registro.append({
      type: "item-added",
      detail: secreto,
      device: "portátil",
      timestamp: 1_700_000_100_000,
    });

    expect(entrada.detailHash).toEqual(detailHash(secreto));
    expect(contieneBytes(entrada.detailHash, secreto)).toBe(false);

    const bytes = registro.serialize();
    expect(contieneBytes(bytes, secreto)).toBe(false);
    expect(toHex(bytes)).not.toContain(toHex(secreto));
    expect(JSON.stringify(registro.entries())).not.toContain("Tr0ub4dor");
  });

  it("revela un detalle selectivamente: el verdadero casa con su hash y uno falso no", () => {
    const secreto = utf8Encode("github.com/urko");
    const registro = registroDePrueba(5);
    const entrada = registro.append({ type: "item-read", detail: secreto, timestamp: 2000 });

    expect(verifyDetail(entrada, secreto)).toBe(true);
    expect(verifyDetail(entrada, utf8Encode("github.com/otro"))).toBe(false);
    expect(verifyDetail(entrada, new Uint8Array(0))).toBe(false);

    const casiIgual = Uint8Array.from(secreto);
    casiIgual[0] ^= 0x01;
    expect(verifyDetail(entrada, casiIgual)).toBe(false);

    // Revelación completa: la entrada está en el árbol Y su detalle es este.
    const prueba = registro.inclusionProof(entrada.index);
    expect(
      verifyInclusion(registro.rootHash, entryHash(entrada), entrada.index, registro.size, prueba),
    ).toBe(true);
  });

  it("un suceso sin detalle casa con el detalle vacío", () => {
    const registro = AuditLedger.create(CLAVES);
    const entrada = registro.append({ type: "vault-unlocked", timestamp: 1 });
    expect(verifyDetail(entrada, new Uint8Array(0))).toBe(true);
    expect(verifyDetail(entrada, utf8Encode("algo"))).toBe(false);
  });

  it("las entradas devueltas son copias: mutarlas no toca el registro", () => {
    const registro = registroDePrueba(3);
    const raizAntes = registro.rootHash;
    const copia = registro.entries();
    (copia[1] as LedgerEntry).detailHash[0] ^= 0xff;
    expect(registro.rootHash).toEqual(raizAntes);
    expect(registro.entries()[1]?.detailHash).not.toEqual(copia[1]?.detailHash);
  });

  it("dos registros que divergen en una entrada pasada no admiten prueba de consistencia", () => {
    const honesto = registroDePrueba(12);
    const raizVista = honesto.rootAt(6);

    // El servidor reescribe la entrada 3 y sigue añadiendo por encima.
    const reescrito = AuditLedger.create(CLAVES);
    for (let i = 0; i < 12; i++) {
      reescrito.append({
        type: "item-added",
        detail: utf8Encode(i === 3 ? "detalle-3-REESCRITO" : `detalle-${i}`),
        device: i % 2 === 0 ? "portátil" : "móvil",
        timestamp: 1_700_000_000_000 + i,
      });
    }

    expect(reescrito.rootAt(6)).not.toEqual(raizVista);
    for (let m = 0; m <= 12; m++) {
      expect(
        verifyConsistency(raizVista, 6, reescrito.rootHash, 12, reescrito.consistencyProof(m, 12)),
      ).toBe(false);
    }
  });
});

describe("cabecera de árbol firmada", () => {
  it("verifica con la clave del registro y no con otra", () => {
    const registro = registroDePrueba(6);
    const cabecera = registro.signedTreeHead(1_700_000_500_000);
    expect(cabecera.size).toBe(6);
    expect(cabecera.rootHash).toEqual(registro.rootHash);
    expect(verifySignedTreeHead(registro.publicKey, cabecera)).toBe(true);
    expect(verifySignedTreeHead(OTRAS_CLAVES.publicKey, cabecera)).toBe(false);
  });

  it("falla si se manipula el tamaño, la raíz o la marca de tiempo", () => {
    const registro = registroDePrueba(6);
    const cabecera = registro.signedTreeHead(1_700_000_500_000);
    const clave = registro.publicKey;

    expect(verifySignedTreeHead(clave, { ...cabecera, size: 7 })).toBe(false);
    expect(verifySignedTreeHead(clave, { ...cabecera, size: 5 })).toBe(false);
    expect(verifySignedTreeHead(clave, { ...cabecera, timestamp: cabecera.timestamp + 1 })).toBe(
      false,
    );

    const raizAlterada = Uint8Array.from(cabecera.rootHash);
    raizAlterada[16] ^= 0x01;
    expect(verifySignedTreeHead(clave, { ...cabecera, rootHash: raizAlterada })).toBe(false);

    const firmaAlterada = Uint8Array.from(cabecera.signature);
    firmaAlterada[0] ^= 0x01;
    expect(verifySignedTreeHead(clave, { ...cabecera, signature: firmaAlterada })).toBe(false);

    // También cae la raíz de otro tamaño del mismo registro: tamaño y raíz van
    // firmados juntos, y ahí es donde se cierra el hueco que la prueba Merkle
    // por sí sola deja abierto.
    expect(verifySignedTreeHead(clave, { ...cabecera, rootHash: registro.rootAt(5) })).toBe(false);
  });

  it("una firma híbrida a medias no vale", () => {
    const registro = registroDePrueba(2);
    const cabecera = registro.signedTreeHead(1000);
    // Estropear solo la mitad ML-DSA (la segunda) debe bastar para invalidarla.
    const firma = Uint8Array.from(cabecera.signature);
    firma[firma.length - 1] ^= 0x01;
    expect(verifySignedTreeHead(registro.publicKey, { ...cabecera, signature: firma })).toBe(false);
  });

  it("hace ida y vuelta por su codificación binaria", () => {
    const registro = registroDePrueba(4);
    const cabecera = registro.signedTreeHead(1_700_000_900_000);
    const recuperada = decodeSignedTreeHead(encodeSignedTreeHead(cabecera));
    expect(recuperada).toEqual(cabecera);
    expect(verifySignedTreeHead(registro.publicKey, recuperada)).toBe(true);
  });
});

describe("serialización del registro", () => {
  it("conserva raíz, tamaño, entradas y pruebas al recargarlo", () => {
    const registro = registroDePrueba(17);
    const recargado = AuditLedger.deserialize(registro.serialize());

    expect(recargado.size).toBe(registro.size);
    expect(recargado.rootHash).toEqual(registro.rootHash);
    expect(recargado.publicKey).toEqual(registro.publicKey);
    expect(recargado.entries()).toEqual(registro.entries());

    for (let i = 0; i < registro.size; i++) {
      expect(recargado.inclusionProof(i)).toEqual(registro.inclusionProof(i));
      expect(
        verifyInclusion(
          recargado.rootHash,
          entryHash(recargado.entries()[i] as LedgerEntry),
          i,
          recargado.size,
          recargado.inclusionProof(i),
        ),
      ).toBe(true);
    }
    for (let m = 0; m <= 17; m++) {
      expect(recargado.consistencyProof(m, 17)).toEqual(registro.consistencyProof(m, 17));
    }

    // La cabecera firmada antes de guardar sigue verificando después.
    const cabecera = registro.signedTreeHead(1_700_001_000_000);
    expect(verifySignedTreeHead(recargado.publicKey, cabecera)).toBe(true);
  });

  it("un registro vacío también va y viene", () => {
    const registro = AuditLedger.create(CLAVES);
    const recargado = AuditLedger.deserialize(registro.serialize());
    expect(recargado.size).toBe(0);
    expect(recargado.rootHash).toEqual(registro.rootHash);
  });

  it("el registro recargado no lleva clave privada: verifica pero no firma ni añade", () => {
    const recargado = AuditLedger.deserialize(registroDePrueba(3).serialize());
    expect(recargado.readOnly).toBe(true);
    expect(() => recargado.append({ type: "export" })).toThrow(LedgerError);
    expect(() => recargado.signedTreeHead()).toThrow(LedgerError);
    expect(recargado.inclusionProof(0)).toBeInstanceOf(Array);
  });

  it("detecta cualquier alteración del fichero al recargarlo", () => {
    const bytes = registroDePrueba(6).serialize();

    // Un byte cambiado dentro de las entradas rompe la cadena o el formato.
    let detectados = 0;
    for (let i = 100; i < bytes.length; i += 37) {
      const alterado = Uint8Array.from(bytes);
      (alterado[i] as number) !== undefined && (alterado[i] ^= 0x01);
      try {
        AuditLedger.deserialize(alterado);
      } catch {
        detectados++;
        continue;
      }
      // Si no lanzó, al menos la raíz tiene que haber cambiado.
      expect(AuditLedger.deserialize(alterado).rootHash).not.toEqual(
        AuditLedger.deserialize(bytes).rootHash,
      );
      detectados++;
    }
    expect(detectados).toBeGreaterThan(0);

    expect(() => AuditLedger.deserialize(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => AuditLedger.deserialize(new Uint8Array([...bytes, 0]))).toThrow(InvalidInputError);
    expect(() => AuditLedger.deserialize(new Uint8Array(20))).toThrow(InvalidInputError);
  });

  it("detecta el borrado de una entrada intermedia: la cadena deja de cuadrar", () => {
    const registro = registroDePrueba(5);
    const entradas = registro.entries();

    // Reconstruimos el fichero a mano saltándonos la entrada 2, como haría un
    // servidor que quiere borrar una lectura del historial.
    const partes: Uint8Array[] = [];
    for (const entrada of entradas) {
      if (entrada.index === 2) continue;
      partes.push(encodeEntry(entrada));
    }
    const original = registro.serialize();
    const cabeceraFichero = original.subarray(0, original.length - partes.length * 0); // sin uso directo
    expect(cabeceraFichero.length).toBeGreaterThan(0);

    const falsificado = falsificarFichero(registro, (lista) => lista.filter((e) => e.index !== 2));
    expect(() => AuditLedger.deserialize(falsificado)).toThrow(LedgerError);
  });

  it("detecta la alteración de una entrada pasada aunque se recodifique el fichero", () => {
    const registro = registroDePrueba(5);
    const falsificado = falsificarFichero(registro, (lista) =>
      lista.map((entrada) =>
        entrada.index === 1 ? { ...entrada, detailHash: detailHash(utf8Encode("otra cosa")) } : entrada,
      ),
    );
    expect(() => AuditLedger.deserialize(falsificado)).toThrow(LedgerError);
  });
});

/**
 * Reescribe el fichero serializado con la lista de entradas que devuelva
 * `transformar`, respetando el formato. Simula a un servidor que manipula el
 * registro con pleno conocimiento del formato binario.
 */
function falsificarFichero(
  registro: AuditLedger,
  transformar: (entradas: LedgerEntry[]) => LedgerEntry[],
): Uint8Array {
  const original = registro.serialize();
  const entradas = transformar([...registro.entries()]);
  // Cabecera: magia(14) + versión(1) + longitud(4) + clave pública.
  const finCabecera = 14 + 1 + 4 + registro.publicKey.length;
  const cabecera = original.subarray(0, finCabecera);

  const cuerpo: number[] = [];
  const total = entradas.length;
  cuerpo.push((total >>> 24) & 0xff, (total >>> 16) & 0xff, (total >>> 8) & 0xff, total & 0xff);
  for (const entrada of entradas) {
    const bytes = encodeEntry(entrada);
    cuerpo.push(
      (bytes.length >>> 24) & 0xff,
      (bytes.length >>> 16) & 0xff,
      (bytes.length >>> 8) & 0xff,
      bytes.length & 0xff,
    );
    cuerpo.push(...bytes);
  }
  return new Uint8Array([...cabecera, ...cuerpo]);
}
