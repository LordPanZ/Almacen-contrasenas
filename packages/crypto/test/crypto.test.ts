import { describe, expect, it } from "vitest";
import {
  AEAD_NONCE_LENGTH,
  AeadError,
  ARGON2_PROFILES,
  ByteReader,
  DestroyedSecretError,
  HYBRID_KEM,
  HYBRID_SIGNATURE,
  InvalidInputError,
  SecretBuffer,
  combineShares,
  constantTimeEqual,
  decodeShare,
  deriveKey,
  bindHardwareFactor,
  deriveMasterKey,
  webauthnPrfSalt,
  domainHash,
  encodeShare,
  fromBase64Url,
  fromHex,
  generateHybridKeyPair,
  generateSalt,
  generateSigningKeyPair,
  hybridFingerprint,
  hybridOpen,
  hybridSeal,
  hybridSign,
  hybridVerify,
  open,
  randomBytes,
  randomInt,
  seal,
  splitSecret,
  toBase64Url,
  toHex,
  tryOpen,
  utf8Encode,
  withSecret,
} from "../src/index.ts";

describe("codificación", () => {
  it("hace ida y vuelta en hex y base64url para cualquier longitud", () => {
    for (const length of [0, 1, 2, 3, 15, 16, 31, 32, 127, 1000]) {
      const bytes = randomBytes(length);
      expect(fromHex(toHex(bytes))).toEqual(bytes);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("produce base64url sin relleno ni caracteres no seguros en URL", () => {
    for (let i = 0; i < 50; i++) {
      const encoded = toBase64Url(randomBytes(i + 1));
      expect(encoded).not.toContain("=");
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
    }
  });

  it("rechaza entradas mal formadas en vez de devolver basura", () => {
    expect(() => fromHex("abc")).toThrow(InvalidInputError);
    expect(() => fromHex("zz")).toThrow(InvalidInputError);
    expect(() => fromBase64Url("A")).toThrow(InvalidInputError);
  });

  it("ByteReader detecta truncamiento y datos sobrantes", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    expect(reader.takeUint8()).toBe(1);
    expect(() => reader.take(5)).toThrow(InvalidInputError);
    expect(() => reader.expectEnd()).toThrow(InvalidInputError);
  });

  it("takeUint64 lee valores por encima de 2^53 sin perder precisión", () => {
    const reader = new ByteReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(reader.takeUint64()).toBe(0xffffffffffffffffn);
  });
});

describe("aleatoriedad", () => {
  it("randomInt se mantiene dentro del rango y cubre todos los valores", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const value = randomInt(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Sin sesgo grosero: ningún valor debería alejarse mucho de 1000.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });

  it("no repite salidas de 32 bytes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(toHex(randomBytes(32)));
    expect(seen.size).toBe(200);
  });
});

describe("SecretBuffer", () => {
  it("borra los bytes y bloquea el acceso posterior", () => {
    const secret = SecretBuffer.copyOf(new Uint8Array([1, 2, 3, 4]));
    const view = secret.bytes;
    secret.destroy();
    expect(view.every((b) => b === 0)).toBe(true);
    expect(secret.destroyed).toBe(true);
    expect(() => secret.bytes).toThrow(DestroyedSecretError);
  });

  it("withSecret destruye el secreto incluso si el cuerpo lanza", () => {
    const secret = SecretBuffer.copyOf(new Uint8Array([9, 9, 9]));
    expect(() =>
      withSecret(secret, () => {
        throw new Error("fallo");
      }),
    ).toThrow("fallo");
    expect(secret.destroyed).toBe(true);
  });

  it("nunca expone el contenido al serializar o registrar", () => {
    const secret = SecretBuffer.copyOf(utf8Encode("contraseña-supersecreta"));
    expect(JSON.stringify({ secret })).not.toContain("supersecreta");
    expect(String(secret)).not.toContain("supersecreta");
    secret.destroy();
  });
});

describe("derivación de claves", () => {
  it("Argon2id es determinista con la misma contraseña y sal", () => {
    const salt = generateSalt();
    const a = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    const b = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    expect(a.bytes).toEqual(b.bytes);
    expect(a.length).toBe(32);
  });

  it("una sal distinta da una clave distinta con la misma contraseña", () => {
    const password = "misma contraseña";
    const a = deriveMasterKey(SecretBuffer.fromText(password), generateSalt(), "test");
    const b = deriveMasterKey(SecretBuffer.fromText(password), generateSalt(), "test");
    expect(a.bytes).not.toEqual(b.bytes);
  });

  it("rechaza sales demasiado cortas para ser únicas", () => {
    expect(() => deriveMasterKey(SecretBuffer.fromText("x"), randomBytes(8), "test")).toThrow(
      InvalidInputError,
    );
  });

  it("etiquetas distintas producen claves independientes (separación de dominios)", () => {
    const root = randomBytes(32);
    const auth = deriveKey(root, "auth-key");
    const wrap = deriveKey(root, "key-wrapping-key");
    expect(auth.bytes).not.toEqual(wrap.bytes);
  });

  it("el contexto separa claves derivadas con la misma etiqueta", () => {
    const root = randomBytes(32);
    const a = deriveKey(root, "item-key", { context: utf8Encode("item-1") });
    const b = deriveKey(root, "item-key", { context: utf8Encode("item-2") });
    expect(a.bytes).not.toEqual(b.bytes);
  });

  it("los perfiles de producción cuestan bastante más memoria que el de test", () => {
    expect(ARGON2_PROFILES.moderate.memoryKiB).toBeGreaterThan(ARGON2_PROFILES.test.memoryKiB * 8);
    expect(ARGON2_PROFILES.paranoid.memoryKiB).toBeGreaterThanOrEqual(
      ARGON2_PROFILES.moderate.memoryKiB,
    );
  });
});

describe("cifrado autenticado", () => {
  it("hace ida y vuelta con y sin datos asociados", () => {
    const key = randomBytes(32);
    const message = utf8Encode("credenciales del banco");
    expect(open(key, seal(key, message))).toEqual(message);
    const aad = utf8Encode("item:42");
    expect(open(key, seal(key, message, aad), aad)).toEqual(message);
  });

  it("cifra de forma no determinista (nonce nuevo por operación)", () => {
    const key = randomBytes(32);
    const message = utf8Encode("mismo mensaje");
    expect(toHex(seal(key, message))).not.toBe(toHex(seal(key, message)));
  });

  it("rechaza clave incorrecta, texto alterado y aad que no coincide", () => {
    const key = randomBytes(32);
    const message = utf8Encode("secreto");
    const sealed = seal(key, message, utf8Encode("contexto-a"));

    expect(() => open(randomBytes(32), sealed, utf8Encode("contexto-a"))).toThrow(AeadError);
    expect(() => open(key, sealed, utf8Encode("contexto-b"))).toThrow(AeadError);

    for (const position of [0, AEAD_NONCE_LENGTH, sealed.length - 1]) {
      const tampered = Uint8Array.from(sealed);
      tampered[position] ^= 0x01;
      expect(() => open(key, tampered, utf8Encode("contexto-a"))).toThrow(AeadError);
    }
  });

  it("no distingue por el mensaje de error el motivo del fallo", () => {
    const key = randomBytes(32);
    const sealed = seal(key, utf8Encode("x"));
    const wrongKey = (() => {
      try {
        open(randomBytes(32), sealed);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    const corrupted = (() => {
      try {
        open(key, tampered);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(wrongKey).toBe(corrupted);
  });

  it("tryOpen devuelve null en vez de lanzar", () => {
    const key = randomBytes(32);
    expect(tryOpen(randomBytes(32), seal(key, utf8Encode("x")))).toBeNull();
    expect(tryOpen(key, new Uint8Array(3))).toBeNull();
  });
});

describe("KEM híbrido post-cuántico", () => {
  it("cifra y descifra para el titular de la clave", () => {
    const { publicKey, secretKey } = generateHybridKeyPair();
    const message = utf8Encode("fragmento de recuperación para un guardián");
    const sealed = hybridSeal(publicKey, message);
    expect(hybridOpen(secretKey, sealed)).toEqual(message);
    expect(publicKey.length).toBe(HYBRID_KEM.publicKeyLength);
  });

  it("otra clave privada no puede abrirlo", () => {
    const alice = generateHybridKeyPair();
    const mallory = generateHybridKeyPair();
    const sealed = hybridSeal(alice.publicKey, utf8Encode("solo para Alice"));
    expect(() => hybridOpen(mallory.secretKey, sealed)).toThrow(AeadError);
  });

  it("es determinista a partir de una semilla, pero aleatorio sin ella", () => {
    const seed = randomBytes(HYBRID_KEM.seedLength);
    expect(generateHybridKeyPair(seed).publicKey).toEqual(generateHybridKeyPair(seed).publicKey);
    expect(generateHybridKeyPair().publicKey).not.toEqual(generateHybridKeyPair().publicKey);
  });

  it("detecta manipulación del criptograma KEM", () => {
    const { publicKey, secretKey } = generateHybridKeyPair();
    const sealed = hybridSeal(publicKey, utf8Encode("mensaje"));
    const tampered = Uint8Array.from(sealed);
    tampered[10] ^= 0x01;
    expect(() => hybridOpen(secretKey, tampered)).toThrow(AeadError);
  });

  it("la huella es corta, estable y distinta por clave", () => {
    const a = generateHybridKeyPair();
    const b = generateHybridKeyPair();
    expect(hybridFingerprint(a.publicKey)).toBe(hybridFingerprint(a.publicKey));
    expect(hybridFingerprint(a.publicKey)).not.toBe(hybridFingerprint(b.publicKey));
    expect(hybridFingerprint(a.publicKey)).toMatch(/^([0-9A-F]{4}-){5}[0-9A-F]{4}$/);
  });
});

describe("firma híbrida", () => {
  it("firma y verifica", () => {
    const { publicKey, secretKey } = generateSigningKeyPair();
    const message = utf8Encode("raíz del registro de auditoría");
    expect(hybridVerify(publicKey, message, hybridSign(secretKey, message))).toBe(true);
    expect(publicKey.length).toBe(HYBRID_SIGNATURE.publicKeyLength);
  });

  it("rechaza mensaje alterado, clave ajena y firma manipulada", () => {
    const { publicKey, secretKey } = generateSigningKeyPair();
    const other = generateSigningKeyPair();
    const message = utf8Encode("entrada original");
    const signature = hybridSign(secretKey, message);

    expect(hybridVerify(publicKey, utf8Encode("entrada alterada"), signature)).toBe(false);
    expect(hybridVerify(other.publicKey, message, signature)).toBe(false);

    // Manipular solo la mitad Ed25519 o solo la mitad ML-DSA debe bastar
    // para invalidar: la firma híbrida exige que ambas verifiquen.
    for (const position of [0, HYBRID_SIGNATURE.signatureLength - 1]) {
      const tampered = Uint8Array.from(signature);
      tampered[position] ^= 0x01;
      expect(hybridVerify(publicKey, message, tampered)).toBe(false);
    }
  });

  it("una firma de un contexto no vale en otro", () => {
    const { publicKey, secretKey } = generateSigningKeyPair();
    const message = utf8Encode("carga útil");
    const signature = hybridSign(secretKey, message, "ledger-entry");
    expect(hybridVerify(publicKey, message, signature, "ledger-entry")).toBe(true);
    expect(hybridVerify(publicKey, message, signature, "guardian-attestation")).toBe(false);
  });

  it("no se rompe con entradas de longitud incorrecta", () => {
    const { publicKey } = generateSigningKeyPair();
    expect(hybridVerify(publicKey, utf8Encode("x"), new Uint8Array(10))).toBe(false);
    expect(hybridVerify(new Uint8Array(10), utf8Encode("x"), new Uint8Array(HYBRID_SIGNATURE.signatureLength))).toBe(false);
  });
});

describe("compartición de secretos de Shamir", () => {
  it("reconstruye con exactamente el umbral de fragmentos", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    const recovered = combineShares([shares[0]!, shares[2]!, shares[4]!]);
    expect(recovered.bytes).toEqual(secret);
  });

  it("reconstruye con cualquier subconjunto del umbral", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 2, shares: 4 });
    for (let i = 0; i < shares.length; i++) {
      for (let j = i + 1; j < shares.length; j++) {
        expect(combineShares([shares[i]!, shares[j]!]).bytes).toEqual(secret);
      }
    }
  });

  it("no revela nada con menos fragmentos de los necesarios", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    expect(() => combineShares([shares[0]!, shares[1]!])).toThrow(InvalidInputError);
    // Ningún fragmento suelto se parece al secreto.
    for (const share of shares) {
      expect(share.data).not.toEqual(secret);
    }
  });

  it("detecta fragmentos de conjuntos distintos y duplicados", () => {
    const a = splitSecret(randomBytes(32), { threshold: 2, shares: 3 });
    const b = splitSecret(randomBytes(32), { threshold: 2, shares: 3 });
    expect(() => combineShares([a[0]!, b[1]!])).toThrow(/secretos distintos/);
    expect(() => combineShares([a[0]!, a[0]!])).toThrow(/duplicado/);
  });

  it("detecta un fragmento alterado mediante la suma de comprobación", () => {
    const shares = splitSecret(randomBytes(32), { threshold: 2, shares: 3 });
    const tampered = { ...shares[1]!, data: Uint8Array.from(shares[1]!.data) };
    tampered.data[0] ^= 0x01;
    expect(() => combineShares([shares[0]!, tampered])).toThrow(/no supera la verificación/);
  });

  it("valida los parámetros de reparto", () => {
    const secret = randomBytes(32);
    expect(() => splitSecret(secret, { threshold: 1, shares: 3 })).toThrow(InvalidInputError);
    expect(() => splitSecret(secret, { threshold: 4, shares: 3 })).toThrow(InvalidInputError);
    expect(() => splitSecret(secret, { threshold: 2, shares: 256 })).toThrow(InvalidInputError);
  });

  it("los fragmentos sobreviven a la serialización", () => {
    const secret = randomBytes(48);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    const restored = shares.map((share) => decodeShare(encodeShare(share)));
    expect(combineShares([restored[1]!, restored[3]!, restored[4]!]).bytes).toEqual(secret);
  });

  it("funciona con el máximo de fragmentos que admite GF(2^8)", () => {
    const secret = randomBytes(16);
    const shares = splitSecret(secret, { threshold: 2, shares: 255 });
    expect(shares).toHaveLength(255);
    expect(combineShares([shares[0]!, shares[254]!]).bytes).toEqual(secret);
  });
});

describe("utilidades de hash", () => {
  it("constantTimeEqual se comporta como una comparación normal", () => {
    const a = randomBytes(32);
    expect(constantTimeEqual(a, Uint8Array.from(a))).toBe(true);
    const b = Uint8Array.from(a);
    b[31] ^= 0x01;
    expect(constantTimeEqual(a, b)).toBe(false);
    expect(constantTimeEqual(a, a.subarray(0, 31))).toBe(false);
  });

  it("domainHash separa dominios y evita colisiones por concatenación", () => {
    // Sin marcado inequívoco, ("ab","c") y ("a","bc") colisionarían.
    const ab_c = domainHash("d", utf8Encode("ab"), utf8Encode("c"));
    const a_bc = domainHash("d", utf8Encode("a"), utf8Encode("bc"));
    expect(ab_c).not.toEqual(a_bc);
    // Dominios distintos, hashes distintos, con la misma entrada.
    expect(domainHash("uno", utf8Encode("x"))).not.toEqual(domainHash("dos", utf8Encode("x")));
  });
});

describe("factor de hardware", () => {
  const salt = generateSalt();

  it("la clave con factor no coincide con la de sin factor", () => {
    const mk = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    const conFactor = bindHardwareFactor(mk, new Uint8Array(32).fill(7));
    expect(toHex(conFactor.bytes)).not.toBe(toHex(mk.bytes));
  });

  it("el mismo factor da siempre la misma clave", () => {
    const mk = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    const factor = randomBytes(32);
    const a = bindHardwareFactor(mk, factor);
    const b = bindHardwareFactor(mk, factor);
    expect(toHex(a.bytes)).toBe(toHex(b.bytes));
  });

  it("dos factores distintos dan claves distintas", () => {
    const mk = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    const a = bindHardwareFactor(mk, randomBytes(32));
    const b = bindHardwareFactor(mk, randomBytes(32));
    expect(toHex(a.bytes)).not.toBe(toHex(b.bytes));
  });

  it("rechaza un factor demasiado corto para aportar entropía", () => {
    const mk = deriveMasterKey(SecretBuffer.fromText("x"), salt, "test");
    expect(() => bindHardwareFactor(mk, randomBytes(8))).toThrow(/al menos 16 bytes/);
  });

  it("la sal del PRF es distinta en cada fichero y estable en el mismo", () => {
    const unaSal = generateSalt();
    const otraSal = generateSalt();
    expect(toHex(webauthnPrfSalt(unaSal))).toBe(toHex(webauthnPrfSalt(unaSal)));
    expect(toHex(webauthnPrfSalt(unaSal))).not.toBe(toHex(webauthnPrfSalt(otraSal)));
  });

  it("del resultado no se recupera el factor ni la clave maestra", () => {
    // HKDF es de un solo sentido: la comprobación posible es que la salida no
    // contenga literalmente ninguna de sus dos entradas.
    const mk = deriveMasterKey(SecretBuffer.fromText("correcto caballo grapa"), salt, "test");
    const factor = randomBytes(32);
    const salida = toHex(bindHardwareFactor(mk, factor).bytes);
    expect(salida).not.toContain(toHex(factor));
    expect(salida).not.toContain(toHex(mk.bytes));
  });
});
