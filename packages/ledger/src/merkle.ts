import { concatBytes, constantTimeEqual, sha256 } from "@cerbero/crypto";

/**
 * Árbol Merkle append-only con la forma exacta de RFC 6962 (Certificate
 * Transparency).
 *
 * Dos decisiones cierran ataques concretos:
 *
 * 1. **Prefijos de dominio distintos para hojas (0x00) y nodos (0x01).** Sin
 *    ellos, el hash de una hoja cuyos datos fueran la concatenación de dos
 *    hashes sería indistinguible del hash de un nodo interno: un atacante
 *    podría presentar un subárbol entero como si fuera una única entrada, o al
 *    revés. Es la segunda preimagen clásica de los árboles Merkle.
 *
 * 2. **Subárbol izquierdo = mayor potencia de dos MENOR que n**, no "la mitad"
 *    ni relleno hasta la siguiente potencia de dos. Esta forma es la que hace
 *    que un árbol de tamaño m sea literalmente un subconjunto de nodos del
 *    árbol de tamaño n > m: sin ella no existirían las pruebas de consistencia,
 *    que son la pieza que detecta la reescritura del historial.
 */

const HASH_LENGTH = 32;
const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

/** SHA256(""), la raíz convenida para el árbol vacío en RFC 6962. */
const EMPTY_TREE_HASH = /* @__PURE__ */ sha256(new Uint8Array(0));

/** Raíz del árbol sin ninguna hoja. Copia nueva: nadie puede mutar la constante. */
export function emptyTreeHash(): Uint8Array {
  return Uint8Array.from(EMPTY_TREE_HASH);
}

export function leafHash(data: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, data));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

function isSize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isHash(value: Uint8Array): boolean {
  return value.length === HASH_LENGTH;
}

/**
 * Mayor potencia de dos estrictamente menor que `n` (definida para n >= 2).
 * Se calcula por duplicación en vez de con desplazamientos de 32 bits para no
 * romperse en árboles de más de 2^31 hojas.
 */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** MTH del rango [start, end) sobre hojas ya hasheadas. */
function rootOfRange(hashes: readonly Uint8Array[], start: number, end: number): Uint8Array {
  const n = end - start;
  if (n === 1) return hashes[start] as Uint8Array;
  const k = splitPoint(n);
  return nodeHash(rootOfRange(hashes, start, start + k), rootOfRange(hashes, start + k, end));
}

export function rootFromLeafHashes(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 0) return emptyTreeHash();
  return rootOfRange(hashes, 0, hashes.length);
}

/** MTH(D[n]) sobre los datos en claro de las hojas. */
export function merkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  return rootFromLeafHashes(leaves.map((leaf) => leafHash(leaf)));
}

/**
 * PATH(m, D[n]) de RFC 6962 §2.1.1: los hermanos que hacen falta para
 * recalcular la raíz desde la hoja `m`. Longitud O(log n): el verificador no
 * necesita descargar el árbol.
 */
function appendPath(
  m: number,
  hashes: readonly Uint8Array[],
  start: number,
  end: number,
  out: Uint8Array[],
): void {
  const n = end - start;
  if (n === 1) return;
  const k = splitPoint(n);
  if (m < k) {
    appendPath(m, hashes, start, start + k, out);
    out.push(rootOfRange(hashes, start + k, end));
  } else {
    appendPath(m - k, hashes, start + k, end, out);
    out.push(rootOfRange(hashes, start, start + k));
  }
}

export function inclusionProofFromLeafHashes(
  hashes: readonly Uint8Array[],
  index: number,
): Uint8Array[] {
  if (!isSize(index) || index >= hashes.length) {
    throw new RangeError(`índice ${index} fuera de un árbol de ${hashes.length} hojas`);
  }
  const out: Uint8Array[] = [];
  appendPath(index, hashes, 0, hashes.length, out);
  return out;
}

export function inclusionProof(leaves: readonly Uint8Array[], index: number): Uint8Array[] {
  return inclusionProofFromLeafHashes(
    leaves.map((leaf) => leafHash(leaf)),
    index,
  );
}

/**
 * SUBPROOF(m, D[n], b) de RFC 6962 §2.1.2. El bandera `b` indica si la raíz del
 * subárbol de tamaño m ya es conocida por el verificador (y por tanto no hace
 * falta enviarla) o si hay que incluirla en la prueba.
 */
function appendSubproof(
  m: number,
  hashes: readonly Uint8Array[],
  start: number,
  end: number,
  known: boolean,
  out: Uint8Array[],
): void {
  const n = end - start;
  if (m === n) {
    if (!known) out.push(rootOfRange(hashes, start, end));
    return;
  }
  const k = splitPoint(n);
  if (m <= k) {
    appendSubproof(m, hashes, start, start + k, known, out);
    out.push(rootOfRange(hashes, start + k, end));
  } else {
    appendSubproof(m - k, hashes, start + k, end, false, out);
    out.push(rootOfRange(hashes, start, start + k));
  }
}

export function consistencyProofFromLeafHashes(
  hashes: readonly Uint8Array[],
  fromSize: number,
  toSize: number,
): Uint8Array[] {
  if (!isSize(fromSize) || !isSize(toSize) || fromSize > toSize || toSize > hashes.length) {
    throw new RangeError(
      `rango de consistencia no válido: ${fromSize} -> ${toSize} sobre ${hashes.length} hojas`,
    );
  }
  // Del árbol vacío, y de un árbol a sí mismo, la prueba es vacía: no hay nada
  // que demostrar más allá de comparar las raíces.
  if (fromSize === 0 || fromSize === toSize) return [];
  const out: Uint8Array[] = [];
  appendSubproof(fromSize, hashes, 0, toSize, true, out);
  return out;
}

export function consistencyProof(
  leaves: readonly Uint8Array[],
  fromSize: number,
  toSize: number,
): Uint8Array[] {
  return consistencyProofFromLeafHashes(
    leaves.map((leaf) => leafHash(leaf)),
    fromSize,
    toSize,
  );
}

/**
 * Verifica una prueba de inclusión (RFC 6962-bis §2.1.3.2).
 *
 * `fn`/`sn` son el índice de la hoja y el de la última hoja del árbol; al
 * desplazarlos a la vez, el bit bajo de `fn` dice si el hermano va a la
 * izquierda o a la derecha, y la igualdad `fn === sn` detecta el borde derecho
 * incompleto del árbol. Reconstruir la raíz de un árbol de tamaño concreto —y
 * exigir que `sn` acabe en 0— impide aceptar una prueba a la que le sobren o
 * falten niveles, que es como se cuela una hoja de otro árbol.
 *
 * Alcance exacto de lo que demuestra: que la hoja ocupa esa posición en un
 * árbol de esa *forma* con esa raíz. Dos tamaños que dan la misma forma no se
 * distinguen aquí. Quien ata un tamaño concreto a una raíz concreta es la
 * firma de la cabecera, y por eso nunca debe verificarse una prueba contra una
 * raíz suelta: siempre contra la de un `SignedTreeHead` ya verificado.
 */
export function verifyInclusion(
  rootHash: Uint8Array,
  leafHash: Uint8Array,
  index: number,
  treeSize: number,
  proof: readonly Uint8Array[],
): boolean {
  if (!isSize(index) || !isSize(treeSize) || index >= treeSize) return false;
  if (!isHash(rootHash) || !isHash(leafHash)) return false;
  for (const sibling of proof) {
    if (!isHash(sibling)) return false;
  }

  let fn = index;
  let sn = treeSize - 1;
  let computed: Uint8Array = Uint8Array.from(leafHash);

  for (const sibling of proof) {
    // Si ya estamos en la raíz, la prueba trae niveles de más.
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      computed = nodeHash(sibling, computed);
      if (fn % 2 === 0) {
        while (fn !== 0 && fn % 2 === 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      computed = nodeHash(computed, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  // `sn !== 0` significa que la prueba se quedó corta y no llegó a la raíz.
  return sn === 0 && constantTimeEqual(computed, rootHash);
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Verifica una prueba de consistencia (RFC 6962-bis §2.1.4.2): demuestra que el
 * árbol de tamaño `oldSize` con raíz `oldRoot` es un **prefijo exacto** del de
 * tamaño `newSize` con raíz `newRoot`.
 *
 * Es la defensa central contra el servidor que reescribe el pasado: la prueba
 * reconstruye *las dos* raíces a partir de los mismos nodos intermedios. Si el
 * servidor borra, reordena o altera cualquier entrada antigua, no existe un
 * conjunto de nodos que produzca a la vez la raíz vieja que el cliente ya vio y
 * la raíz nueva que ahora afirma. No es que sea difícil de falsificar: exigiría
 * una colisión de SHA-256.
 */
export function verifyConsistency(
  oldRoot: Uint8Array,
  oldSize: number,
  newRoot: Uint8Array,
  newSize: number,
  proof: readonly Uint8Array[],
): boolean {
  if (!isSize(oldSize) || !isSize(newSize)) return false;
  if (!isHash(oldRoot) || !isHash(newRoot)) return false;
  for (const node of proof) {
    if (!isHash(node)) return false;
  }
  // Un árbol nunca encoge: esto por sí solo ya es un retroceso.
  if (oldSize > newSize) return false;
  if (oldSize === newSize) {
    // Mismo tamaño: solo es consistente consigo mismo, y sin nodos de más que
    // pudieran hacer pasar por válida una prueba de otro par de árboles.
    return proof.length === 0 && constantTimeEqual(oldRoot, newRoot);
  }
  if (oldSize === 0) {
    // El árbol vacío es prefijo de cualquier cosa; lo único comprobable es que
    // la raíz que se afirma vieja sea de verdad la del árbol vacío.
    return proof.length === 0 && constantTimeEqual(oldRoot, EMPTY_TREE_HASH);
  }

  // Cuando el árbol viejo es un subárbol completo, su raíz no viaja en la
  // prueba (el verificador ya la tiene): se antepone aquí.
  const path = isPowerOfTwo(oldSize) ? [oldRoot, ...proof] : [...proof];
  if (path.length === 0) return false;

  let fn = oldSize - 1;
  let sn = newSize - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  let oldComputed: Uint8Array = Uint8Array.from(path[0] as Uint8Array);
  let newComputed: Uint8Array = Uint8Array.from(path[0] as Uint8Array);

  for (let i = 1; i < path.length; i++) {
    const node = path[i] as Uint8Array;
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      // Nodo compartido por ambos árboles: entra en las dos reconstrucciones.
      oldComputed = nodeHash(node, oldComputed);
      newComputed = nodeHash(node, newComputed);
      if (fn % 2 === 0) {
        while (fn !== 0 && fn % 2 === 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      // Nodo que solo existe en el árbol nuevo: son las entradas añadidas.
      newComputed = nodeHash(newComputed, node);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  return (
    sn === 0 &&
    constantTimeEqual(oldComputed, oldRoot) &&
    constantTimeEqual(newComputed, newRoot)
  );
}
