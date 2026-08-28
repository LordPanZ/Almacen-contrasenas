# API de `@cerbero/crypto`

Referencia completa del núcleo criptográfico. **Ningún otro paquete debe
importar `@noble/*` directamente**: toda la criptografía pasa por aquí, para que
haya un único punto que auditar.

```ts
import { ... } from "@cerbero/crypto";
```

## Aleatoriedad (`random.ts`)

```ts
randomBytes(length: number): Uint8Array          // CSPRNG del sistema
randomInt(maxExclusive: number): number          // uniforme, sin sesgo modular
randomChoice<T>(items: readonly T[]): T
shuffleInPlace<T>(items: T[]): T[]               // Fisher-Yates sin sesgo
```

## Material secreto (`secret.ts`)

```ts
class SecretBuffer {
  static wrap(bytes: Uint8Array): SecretBuffer     // toma posesión del array
  static copyOf(bytes: Uint8Array): SecretBuffer   // copia; el original sigue siendo del llamante
  static fromText(text: string): SecretBuffer
  static random(length: number): SecretBuffer
  static allocate(length: number): SecretBuffer
  readonly destroyed: boolean
  readonly length: number
  readonly bytes: Uint8Array        // lanza DestroyedSecretError si ya se destruyó
  clone(): SecretBuffer
  destroy(): void                   // sobrescribe con ceros e inutiliza
}
withSecret<T>(secret: SecretBuffer, fn: (bytes: Uint8Array) => T): T
withSecretAsync<T>(secret, fn): Promise<T>
zeroize(...buffers: (Uint8Array | null | undefined)[]): void
```

`SecretBuffer` nunca filtra su contenido por `toString`, `JSON.stringify` ni
`console.log`.

## Derivación de claves (`kdf.ts`)

```ts
MASTER_KEY_LENGTH = 32
SALT_LENGTH = 32
ARGON2_PROFILES: { test, interactive, moderate, paranoid }   // usa "test" en los tests
generateSalt(): Uint8Array

deriveMasterKey(
  password: SecretBuffer,
  salt: Uint8Array,                                  // >= 16 bytes
  profile?: Argon2ProfileName | Argon2Profile,       // por defecto "moderate"
): SecretBuffer

deriveKey(
  ikm: Uint8Array,
  label: string,                                     // se prefija con "cerbero/v1/"
  options?: { salt?: Uint8Array; context?: Uint8Array; length?: number },
): SecretBuffer                                      // HKDF-SHA256, 32 bytes por defecto

deriveBytes(ikm, label, options?): Uint8Array        // igual, para datos no secretos

KDF_LABELS   // etiquetas ya reservadas: authentication, keyWrapping, vaultData,
             // itemKey, metadataKey, identityKem, identitySigning, ledgerSigning,
             // duressSlot, guardianShare, timeLock, canaryTag, breachRequest
```

Regla: **cada clave del sistema nace de una etiqueta distinta**. `context` ata
además la clave a un dato concreto (id de ítem, índice de ranura…).

## Cifrado autenticado (`aead.ts`) — XChaCha20-Poly1305

```ts
AEAD_KEY_LENGTH = 32
AEAD_NONCE_LENGTH = 24
AEAD_TAG_LENGTH = 16
AEAD_OVERHEAD = 40                    // nonce + tag

seal(key: SecretBuffer | Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array
open(key, sealed, aad?): Uint8Array   // lanza AeadError (mensaje opaco e idéntico en todos los casos)
tryOpen(key, sealed, aad?): Uint8Array | null    // devuelve null en vez de lanzar
sealWithNonce(key, nonce, plaintext, aad?): Uint8Array   // solo si puedes DEMOSTRAR unicidad del nonce
```

Formato de `seal`: `nonce(24) || ciphertext || tag(16)`.

Usa **siempre** `aad` para atar el criptograma a su contexto (id de ítem,
versión de formato, índice de entrada): impide moverlo a otro sitio del fichero
y que siga validando.

## KEM híbrido post-cuántico (`hybrid.ts`) — X-Wing (ML-KEM-768 + X25519)

```ts
HYBRID_KEM = { seedLength: 32, publicKeyLength: 1216, secretKeyLength: 32,
               ciphertextLength: 1120, sharedSecretLength: 32 }

generateHybridKeyPair(seed?: Uint8Array): { publicKey: Uint8Array; secretKey: SecretBuffer }
hybridPublicKeyFrom(secretKey: SecretBuffer | Uint8Array): Uint8Array
hybridEncapsulate(publicKey): { ciphertext: Uint8Array; sharedSecret: SecretBuffer }
hybridDecapsulate(secretKey, ciphertext): SecretBuffer
hybridSeal(publicKey, plaintext, aad?): Uint8Array     // ciphertextKEM(1120) || nonce || ct || tag
hybridOpen(secretKey, sealed, aad?): Uint8Array
hybridFingerprint(publicKey): string                   // "A1B2-C3D4-..." para verificar en persona
```

Con `seed` de 32 bytes la generación es determinista: así una clave de identidad
puede derivarse de la bóveda en vez de guardarse aparte.

## Firma híbrida (`signature.ts`) — Ed25519 + ML-DSA-65

```ts
HYBRID_SIGNATURE = { seedLength: 32, publicKeyLength: 1984,
                     secretKeyLength: 4064, signatureLength: 3373 }

generateSigningKeyPair(seed?: Uint8Array): { publicKey: Uint8Array; secretKey: SecretBuffer }
hybridSign(secretKey, message: Uint8Array, context?: string): Uint8Array
hybridVerify(publicKey, message, signature, context?: string): boolean
```

`context` separa dominios de firma: una firma emitida como `"ledger-entry"` no
verifica como `"guardian-attestation"`. Úsalo siempre.

## Compartición de secretos de Shamir (`shamir.ts`)

```ts
interface ShamirShare {
  index: number; threshold: number; setId: Uint8Array;
  data: Uint8Array; checksum: Uint8Array;
}
splitSecret(secret: SecretBuffer | Uint8Array,
            options: { threshold: number; shares: number; checksum?: boolean }): ShamirShare[]
combineShares(shares: readonly ShamirShare[]): SecretBuffer
encodeShare(share): Uint8Array
decodeShare(encoded: Uint8Array): ShamirShare
```

Umbral mínimo 2, máximo 255 fragmentos. Detecta fragmentos de conjuntos
distintos, duplicados y alterados.

## Hash y comparación (`hash.ts`)

```ts
sha256(data), sha512(data), blake3(data)
hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array
constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean    // úsalo para TODA comparación de secretos
domainHash(domain: string, ...parts: Uint8Array[]): Uint8Array
```

`domainHash` aplica separación de dominios y prefija cada parte con su longitud,
de modo que `("ab","c")` y `("a","bc")` nunca colisionan.

## Codificación y parseo (`encoding.ts`)

```ts
utf8Encode(text): Uint8Array          utf8Decode(bytes): string
toHex(bytes): string                  fromHex(hex): Uint8Array
toBase64Url(bytes): string            fromBase64Url(text): Uint8Array   // sin relleno, URL-safe
concatBytes(...parts): Uint8Array
lengthPrefixed(bytes): Uint8Array     // uint32(len) || bytes
uint16(n) / uint32(n) / uint64(n: bigint | number): Uint8Array   // big-endian

class ByteReader {
  constructor(source: Uint8Array)
  readonly remaining: number
  readonly offset: number
  take(length): Uint8Array            // lanza InvalidInputError si se pasa del final
  takeUint8() / takeUint16() / takeUint32(): number
  takeUint64(): bigint
  takeLengthPrefixed(): Uint8Array
  expectEnd(): void                   // lanza si sobran bytes
}
```

Usa `ByteReader` para **todo** parseo binario: cierra de golpe la clase de bugs
de lectura fuera de límites.

## Errores (`errors.ts`)

```ts
class CerberoError extends Error {}
class AeadError extends CerberoError {}          // fallo de descifrado, deliberadamente opaco
class InvalidInputError extends CerberoError {}  // contrato de argumentos incumplido
class DestroyedSecretError extends CerberoError {}
```
