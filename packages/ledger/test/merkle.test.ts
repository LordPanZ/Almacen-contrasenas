import { describe, expect, it } from "vitest";
import { concatBytes, sha256, toHex, utf8Encode } from "@cerbero/crypto";
import {
  consistencyProof,
  emptyTreeHash,
  inclusionProof,
  leafHash,
  merkleRoot,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from "../src/index.ts";

function hojas(n: number, prefijo = "hoja"): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => utf8Encode(`${prefijo}-${i}`));
}

/**
 * Segunda implementación, escrita directamente desde el texto de RFC 6962 y sin
 * compartir nada con la del paquete. Si ambas coinciden en todos los tamaños,
 * el error tendría que estar en las dos a la vez.
 */
function raizDeReferencia(datos: readonly Uint8Array[]): Uint8Array {
  if (datos.length === 0) return sha256(new Uint8Array(0));
  if (datos.length === 1) return sha256(concatBytes(new Uint8Array([0x00]), datos[0] as Uint8Array));
  let k = 1;
  while (k * 2 < datos.length) k *= 2;
  return sha256(
    concatBytes(
      new Uint8Array([0x01]),
      raizDeReferencia(datos.slice(0, k)),
      raizDeReferencia(datos.slice(k)),
    ),
  );
}

describe("raíz Merkle RFC 6962", () => {
  it("el árbol vacío es SHA-256 de la cadena vacía", () => {
    expect(toHex(merkleRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(merkleRoot([])).toEqual(emptyTreeHash());
  });

  it("un árbol de una sola hoja es exactamente el hash de esa hoja", () => {
    for (const datos of [new Uint8Array(0), utf8Encode("una entrada"), new Uint8Array([1, 2, 3])]) {
      expect(merkleRoot([datos])).toEqual(leafHash(datos));
    }
    // El prefijo 0x00 de hoja, comprobado contra un valor conocido.
    expect(toHex(leafHash(new Uint8Array(0)))).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    );
  });

  it("distingue hoja de nodo interno: hashes de dominio separados", () => {
    const izquierda = leafHash(utf8Encode("a"));
    const derecha = leafHash(utf8Encode("b"));
    // Una hoja cuyos datos sean la concatenación de dos hashes NO puede
    // confundirse con el nodo que los une: es la segunda preimagen clásica.
    expect(nodeHash(izquierda, derecha)).not.toEqual(leafHash(concatBytes(izquierda, derecha)));
  });

  it("calcula la raíz correcta para los tamaños 0, 1, 2, 3, 4, 5, 7, 8 y 100", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 100]) {
      const datos = hojas(n);
      expect(merkleRoot(datos)).toEqual(raizDeReferencia(datos));
    }
  });

  it("parte por la mayor potencia de dos menor que n, construido a mano", () => {
    const d = hojas(8);
    const h = d.map((x) => leafHash(x));
    const r2 = nodeHash(h[0] as Uint8Array, h[1] as Uint8Array);
    const r4 = nodeHash(r2, nodeHash(h[2] as Uint8Array, h[3] as Uint8Array));

    expect(merkleRoot(d.slice(0, 2))).toEqual(r2);
    expect(merkleRoot(d.slice(0, 3))).toEqual(nodeHash(r2, h[2] as Uint8Array));
    expect(merkleRoot(d.slice(0, 4))).toEqual(r4);
    expect(merkleRoot(d.slice(0, 5))).toEqual(nodeHash(r4, h[4] as Uint8Array));
    expect(merkleRoot(d.slice(0, 7))).toEqual(
      nodeHash(r4, nodeHash(nodeHash(h[4] as Uint8Array, h[5] as Uint8Array), h[6] as Uint8Array)),
    );
    expect(merkleRoot(d)).toEqual(
      nodeHash(
        r4,
        nodeHash(
          nodeHash(h[4] as Uint8Array, h[5] as Uint8Array),
          nodeHash(h[6] as Uint8Array, h[7] as Uint8Array),
        ),
      ),
    );
  });

  it("no rellena hasta la siguiente potencia de dos", () => {
    const d = hojas(3);
    const h = d.map((x) => leafHash(x));
    const conRelleno = nodeHash(
      nodeHash(h[0] as Uint8Array, h[1] as Uint8Array),
      nodeHash(h[2] as Uint8Array, h[2] as Uint8Array),
    );
    expect(merkleRoot(d)).not.toEqual(conRelleno);
  });

  it("añadir una hoja cambia la raíz", () => {
    const vistas = new Set<string>();
    for (let n = 0; n <= 40; n++) vistas.add(toHex(merkleRoot(hojas(n))));
    expect(vistas.size).toBe(41);
  });
});

describe("pruebas de inclusión", () => {
  it("valida todos los índices de árboles de tamaño 1 a 20, 33 y 100", () => {
    for (const n of [...Array.from({ length: 20 }, (_, i) => i + 1), 33, 100]) {
      const datos = hojas(n);
      const raiz = merkleRoot(datos);
      for (let i = 0; i < n; i++) {
        const prueba = inclusionProof(datos, i);
        expect(verifyInclusion(raiz, leafHash(datos[i] as Uint8Array), i, n, prueba)).toBe(true);
      }
    }
  });

  it("la prueba tiene tamaño logarítmico, no lineal", () => {
    const datos = hojas(1000);
    expect(inclusionProof(datos, 500).length).toBeLessThanOrEqual(10);
  });

  it("falla si se cambia el índice", () => {
    const n = 11;
    const datos = hojas(n);
    const raiz = merkleRoot(datos);
    for (let i = 0; i < n; i++) {
      const prueba = inclusionProof(datos, i);
      const hoja = leafHash(datos[i] as Uint8Array);
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        expect(verifyInclusion(raiz, hoja, j, n, prueba)).toBe(false);
      }
      expect(verifyInclusion(raiz, hoja, n, n, prueba)).toBe(false);
      expect(verifyInclusion(raiz, hoja, -1, n, prueba)).toBe(false);
    }
  });

  it("falla si se cambia la raíz", () => {
    const datos = hojas(9);
    const prueba = inclusionProof(datos, 4);
    const hoja = leafHash(datos[4] as Uint8Array);
    const raizAjena = merkleRoot(hojas(9, "otro"));
    expect(verifyInclusion(raizAjena, hoja, 4, 9, prueba)).toBe(false);

    const raizAlterada = Uint8Array.from(merkleRoot(datos));
    raizAlterada[0] ^= 0x01;
    expect(verifyInclusion(raizAlterada, hoja, 4, 9, prueba)).toBe(false);
  });

  it("falla si se cambia la hoja", () => {
    const datos = hojas(9);
    const raiz = merkleRoot(datos);
    const prueba = inclusionProof(datos, 4);
    expect(verifyInclusion(raiz, leafHash(utf8Encode("hoja-4-falsa")), 4, 9, prueba)).toBe(false);
    const hojaAlterada = Uint8Array.from(leafHash(datos[4] as Uint8Array));
    hojaAlterada[31] ^= 0x80;
    expect(verifyInclusion(raiz, hojaAlterada, 4, 9, prueba)).toBe(false);
  });

  it("falla si se altera cualquier byte de la prueba", () => {
    for (const n of [2, 5, 8, 13]) {
      const datos = hojas(n);
      const raiz = merkleRoot(datos);
      for (let i = 0; i < n; i++) {
        const original = inclusionProof(datos, i);
        const hoja = leafHash(datos[i] as Uint8Array);
        for (let nivel = 0; nivel < original.length; nivel++) {
          for (const byte of [0, 7, 31]) {
            const prueba = original.map((nodo) => Uint8Array.from(nodo));
            (prueba[nivel] as Uint8Array)[byte] ^= 0x01;
            expect(verifyInclusion(raiz, hoja, i, n, prueba)).toBe(false);
          }
        }
      }
    }
  });

  it("falla si sobran o faltan niveles en la prueba", () => {
    const datos = hojas(8);
    const raiz = merkleRoot(datos);
    const prueba = inclusionProof(datos, 3);
    const hoja = leafHash(datos[3] as Uint8Array);
    expect(verifyInclusion(raiz, hoja, 3, 8, prueba.slice(0, -1))).toBe(false);
    expect(verifyInclusion(raiz, hoja, 3, 8, [...prueba, new Uint8Array(32)])).toBe(false);
  });

  it("una prueba válida no sirve en un árbol de forma distinta", () => {
    const datos = hojas(8);
    const raiz = merkleRoot(datos);
    const prueba = inclusionProof(datos, 3);
    const hoja = leafHash(datos[3] as Uint8Array);
    for (const otroTamano of [3, 4, 9, 16]) {
      expect(verifyInclusion(raiz, hoja, 3, otroTamano, prueba)).toBe(false);
    }
  });

  it("la prueba ata la forma del árbol, no el par (tamaño, raíz)", () => {
    // Límite real del algoritmo de RFC 6962, documentado a propósito: dos
    // tamaños que producen la misma forma de árbol son indistinguibles para
    // quien solo tiene la prueba. Lo que ata un tamaño concreto a una raíz
    // concreta es la FIRMA de la cabecera, y por eso el monitor nunca compara
    // raíces sueltas sino cabeceras firmadas.
    const datos = hojas(8);
    const prueba = inclusionProof(datos, 3);
    const hoja = leafHash(datos[3] as Uint8Array);
    expect(verifyInclusion(merkleRoot(datos), hoja, 3, 5, prueba)).toBe(true);
  });

  it("rechaza hashes con longitud incorrecta en vez de aceptarlos", () => {
    const datos = hojas(4);
    const raiz = merkleRoot(datos);
    const prueba = inclusionProof(datos, 1);
    const hoja = leafHash(datos[1] as Uint8Array);
    expect(verifyInclusion(raiz.subarray(0, 31), hoja, 1, 4, prueba)).toBe(false);
    expect(verifyInclusion(raiz, hoja.subarray(0, 16), 1, 4, prueba)).toBe(false);
    expect(verifyInclusion(raiz, hoja, 1, 4, [new Uint8Array(31), ...prueba.slice(1)])).toBe(false);
  });
});

describe("pruebas de consistencia", () => {
  it("valida todos los pares (m, n) con m <= n hasta n = 32", () => {
    const datos = hojas(32);
    const raices = Array.from({ length: 33 }, (_, n) => merkleRoot(datos.slice(0, n)));
    for (let n = 0; n <= 32; n++) {
      for (let m = 0; m <= n; m++) {
        const prueba = consistencyProof(datos.slice(0, n), m, n);
        expect(
          verifyConsistency(raices[m] as Uint8Array, m, raices[n] as Uint8Array, n, prueba),
        ).toBe(true);
      }
    }
  });

  it("un árbol nunca encoge: rechaza m > n", () => {
    const datos = hojas(16);
    const raiz16 = merkleRoot(datos);
    const raiz9 = merkleRoot(datos.slice(0, 9));
    expect(verifyConsistency(raiz16, 16, raiz9, 9, [])).toBe(false);
    expect(verifyConsistency(raiz16, 16, raiz9, 9, consistencyProof(datos, 9, 16))).toBe(false);
  });

  it("con tamaños iguales solo acepta la misma raíz y sin nodos de más", () => {
    const datos = hojas(10);
    const raiz = merkleRoot(datos);
    const otra = merkleRoot(hojas(10, "otro"));
    expect(verifyConsistency(raiz, 10, raiz, 10, [])).toBe(true);
    expect(verifyConsistency(raiz, 10, otra, 10, [])).toBe(false);
    expect(verifyConsistency(raiz, 10, raiz, 10, [new Uint8Array(32)])).toBe(false);
  });

  it("desde el árbol vacío solo acepta la raíz del árbol vacío", () => {
    const raiz = merkleRoot(hojas(7));
    expect(verifyConsistency(emptyTreeHash(), 0, raiz, 7, [])).toBe(true);
    expect(verifyConsistency(raiz, 0, raiz, 7, [])).toBe(false);
  });

  it("falla si se altera cualquier byte de la prueba", () => {
    const datos = hojas(16);
    for (const [m, n] of [
      [3, 16],
      [5, 11],
      [8, 16],
      [1, 7],
    ] as const) {
      const raizVieja = merkleRoot(datos.slice(0, m));
      const raizNueva = merkleRoot(datos.slice(0, n));
      const original = consistencyProof(datos.slice(0, n), m, n);
      expect(verifyConsistency(raizVieja, m, raizNueva, n, original)).toBe(true);
      for (let nivel = 0; nivel < original.length; nivel++) {
        const prueba = original.map((nodo) => Uint8Array.from(nodo));
        (prueba[nivel] as Uint8Array)[nivel % 32] ^= 0x02;
        expect(verifyConsistency(raizVieja, m, raizNueva, n, prueba)).toBe(false);
      }
    }
  });

  it("rechaza una prueba con la raíz vieja, el tamaño viejo o la forma equivocados", () => {
    const datos = hojas(20);
    const raizNueva = merkleRoot(datos);
    const raizVieja = merkleRoot(datos.slice(0, 12));
    const prueba = consistencyProof(datos, 12, 20);
    expect(verifyConsistency(raizVieja, 12, raizNueva, 20, prueba)).toBe(true);
    expect(verifyConsistency(merkleRoot(datos.slice(0, 11)), 12, raizNueva, 20, prueba)).toBe(false);
    expect(verifyConsistency(raizVieja, 13, raizNueva, 20, prueba)).toBe(false);
    expect(verifyConsistency(raizVieja, 11, raizNueva, 20, prueba)).toBe(false);
    for (const otroTamano of [12, 13, 16]) {
      expect(verifyConsistency(raizVieja, 12, raizNueva, otroTamano, prueba)).toBe(false);
    }
  });

  it("detecta la reescritura: no hay prueba válida tras alterar una entrada pasada", () => {
    const originales = hojas(16);
    const raizVista = merkleRoot(originales.slice(0, 7));

    const alteradas = [...originales];
    alteradas[2] = utf8Encode("hoja-2-reescrita-por-el-servidor");
    const raizAlterada = merkleRoot(alteradas);

    // El servidor construye su prueba con toda la honestidad sobre su árbol ya
    // alterado, y aun así no puede reconstruir la raíz que el cliente vio.
    expect(
      verifyConsistency(raizVista, 7, raizAlterada, 16, consistencyProof(alteradas, 7, 16)),
    ).toBe(false);

    // Ni con ninguna otra prueba que su árbol sea capaz de producir.
    for (let m = 0; m <= 16; m++) {
      expect(
        verifyConsistency(raizVista, 7, raizAlterada, 16, consistencyProof(alteradas, m, 16)),
      ).toBe(false);
    }
  });

  it("detecta el borrado y el reordenado de entradas pasadas", () => {
    const originales = hojas(12);
    const raizVista = merkleRoot(originales.slice(0, 9));

    const borrada = [...originales.slice(0, 4), ...originales.slice(5)];
    expect(
      verifyConsistency(
        raizVista,
        9,
        merkleRoot(borrada),
        borrada.length,
        consistencyProof(borrada, 9, borrada.length),
      ),
    ).toBe(false);

    const reordenada = [...originales];
    reordenada[1] = originales[6] as Uint8Array;
    reordenada[6] = originales[1] as Uint8Array;
    expect(
      verifyConsistency(raizVista, 9, merkleRoot(reordenada), 12, consistencyProof(reordenada, 9, 12)),
    ).toBe(false);
  });

  it("no acepta el crecimiento sin prueba cuando hace falta", () => {
    const datos = hojas(8);
    for (const m of [1, 2, 3, 4, 5, 6, 7]) {
      expect(verifyConsistency(merkleRoot(datos.slice(0, m)), m, merkleRoot(datos), 8, [])).toBe(
        false,
      );
    }
  });
});
