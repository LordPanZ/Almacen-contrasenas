import { describe, expect, it } from "vitest";
import { SecretBuffer, generateSigningKeyPair, randomBytes, toHex } from "@cerbero/crypto";
import {
  RecoveryError,
  SwitchError,
  TimeLockError,
  applyHeartbeat,
  claimInheritance,
  countValidAttestations,
  createDeadManSwitch,
  createGuardianAttestation,
  createInheritancePackage,
  createRecoveryPackage,
  createTimeLock,
  decodeHeartbeat,
  decodeSwitch,
  decodeTimeLock,
  describeSwitch,
  emitHeartbeat,
  encodeHeartbeat,
  encodeSwitch,
  encodeTimeLock,
  evaluateSwitch,
  generateGuardianIdentity,
  guardianDecryptShare,
  hasAttestationQuorum,
  openTimeLockWithTrapdoor,
  recoverSecret,
  revokeSwitch,
  solveTimeLock,
  squaringsForDuration,
  timeUntilRelease,
  verifyGuardianAttestation,
} from "../src/index.ts";

/** Parámetros pequeños: los tests prueban el protocolo, no la dureza. */
const BITS_TEST = 512;
const ELEVACIONES_TEST = 300;

function guardianes(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) =>
    generateGuardianIdentity(`Guardián ${i + 1}`),
  );
}

describe("recuperación social con guardianes", () => {
  it("reconstruye el secreto con exactamente el umbral", () => {
    const secreto = randomBytes(32);
    const identidades = guardianes(5);
    const paquete = createRecoveryPackage(
      secreto,
      identidades.map((g) => g.guardian),
      3,
    );

    const fragmentos = [0, 2, 4].map((i) =>
      guardianDecryptShare(identidades[i]!.kemSecretKey, paquete.shares[i]!),
    );
    expect(recoverSecret(fragmentos, paquete.policy).bytes).toEqual(secreto);
  });

  it("funciona con cualquier subconjunto que alcance el umbral", () => {
    const secreto = randomBytes(32);
    const identidades = guardianes(4);
    const paquete = createRecoveryPackage(
      secreto,
      identidades.map((g) => g.guardian),
      2,
    );

    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const fragmentos = [i, j].map((k) =>
          guardianDecryptShare(identidades[k]!.kemSecretKey, paquete.shares[k]!),
        );
        expect(recoverSecret(fragmentos, paquete.policy).bytes).toEqual(secreto);
      }
    }
  });

  it("por debajo del umbral no revela nada", () => {
    const secreto = randomBytes(32);
    const identidades = guardianes(5);
    const paquete = createRecoveryPackage(
      secreto,
      identidades.map((g) => g.guardian),
      3,
    );
    const dos = [0, 1].map((i) =>
      guardianDecryptShare(identidades[i]!.kemSecretKey, paquete.shares[i]!),
    );
    expect(() => recoverSecret(dos, paquete.policy)).toThrow();
    // Y ningún fragmento suelto se parece al secreto.
    for (const fragmento of dos) expect(fragmento.data).not.toEqual(secreto);
  });

  it("un guardián no puede descifrar el fragmento de otro", () => {
    const identidades = guardianes(3);
    const paquete = createRecoveryPackage(
      randomBytes(32),
      identidades.map((g) => g.guardian),
      2,
    );
    expect(() => guardianDecryptShare(identidades[1]!.kemSecretKey, paquete.shares[0]!)).toThrow();
  });

  it("un fragmento cifrado no vale en otra política", () => {
    const identidades = guardianes(3);
    const lista = identidades.map((g) => g.guardian);
    const primera = createRecoveryPackage(randomBytes(32), lista, 2);
    const segunda = createRecoveryPackage(randomBytes(32), lista, 2);

    // El `aad` ata cada fragmento a su política: mezclarlas debe fallar.
    const trasplantado = { ...segunda.shares[0]!, policyId: primera.policy.policyId };
    expect(() => guardianDecryptShare(identidades[0]!.kemSecretKey, trasplantado)).toThrow();
  });

  it("el paquete cifrado no contiene el secreto en claro", () => {
    const secreto = randomBytes(32);
    const identidades = guardianes(3);
    const paquete = createRecoveryPackage(
      secreto,
      identidades.map((g) => g.guardian),
      2,
    );
    for (const share of paquete.shares) {
      expect(toHex(share.payload)).not.toContain(toHex(secreto));
    }
  });

  it("valida los parámetros del reparto", () => {
    const lista = guardianes(3).map((g) => g.guardian);
    expect(() => createRecoveryPackage(randomBytes(32), lista, 1)).toThrow(RecoveryError);
    expect(() => createRecoveryPackage(randomBytes(32), lista, 4)).toThrow(RecoveryError);
  });
});

describe("atestaciones de guardián", () => {
  it("una atestación verifica y no vale para otra recuperación", () => {
    const identidad = generateGuardianIdentity("Ana");
    const lista = [identidad.guardian, ...guardianes(2).map((g) => g.guardian)];
    const paquete = createRecoveryPackage(randomBytes(32), lista, 2);

    const atestacion = createGuardianAttestation(identidad.signingSecretKey, {
      policyId: paquete.policy.policyId,
      guardianId: identidad.guardian.id,
      recoveryId: "rec-1",
    });

    expect(verifyGuardianAttestation(atestacion, paquete.policy, "rec-1")).toBe(true);
    // La misma firma no vale para aprobar otra recuperación distinta.
    expect(verifyGuardianAttestation(atestacion, paquete.policy, "rec-2")).toBe(false);
    expect(
      verifyGuardianAttestation({ ...atestacion, recoveryId: "rec-2" }, paquete.policy, "rec-2"),
    ).toBe(false);
  });

  it("cuenta el quórum de aprobaciones válidas", () => {
    const identidades = Array.from({ length: 3 }, (_, i) =>
      generateGuardianIdentity(`G${i}`),
    );
    const lista = identidades.map((g) => g.guardian);
    const paquete = createRecoveryPackage(randomBytes(32), lista, 2);

    const atestaciones = identidades
      .slice(0, 2)
      .map((identidad) =>
        createGuardianAttestation(identidad.signingSecretKey, {
          policyId: paquete.policy.policyId,
          guardianId: identidad.guardian.id,
          recoveryId: "rec-x",
        }),
      );

    expect(countValidAttestations(atestaciones, paquete.policy, "rec-x")).toBe(2);
    expect(hasAttestationQuorum(atestaciones, paquete.policy, "rec-x")).toBe(true);
    expect(hasAttestationQuorum(atestaciones.slice(0, 1), paquete.policy, "rec-x")).toBe(false);
  });
});

describe("cerradura temporal", () => {
  it("la vía lenta y el atajo del creador dan el mismo secreto", () => {
    const secreto = randomBytes(32);
    const { puzzle, trapdoor } = createTimeLock(secreto, {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });

    expect(solveTimeLock(puzzle).bytes).toEqual(secreto);
    expect(openTimeLockWithTrapdoor(puzzle, trapdoor).bytes).toEqual(secreto);
  });

  it("resolver con menos elevaciones de las exigidas no abre nada", () => {
    const { puzzle } = createTimeLock(randomBytes(32), {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });
    const acortado = { ...puzzle, squarings: ELEVACIONES_TEST - 1 };
    expect(() => solveTimeLock(acortado)).toThrow(TimeLockError);
  });

  it("una trampilla falsa no abre el puzzle", () => {
    const { puzzle } = createTimeLock(randomBytes(32), {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });
    expect(() => openTimeLockWithTrapdoor(puzzle, randomBytes(32))).toThrow(TimeLockError);
  });

  it("manipular el criptograma o los parámetros hace que falle", () => {
    const { puzzle } = createTimeLock(randomBytes(32), {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });
    const sealed = Uint8Array.from(puzzle.sealed);
    (sealed[0] as number) !== undefined && (sealed[0] ^= 0x01);
    expect(() => solveTimeLock({ ...puzzle, sealed })).toThrow(TimeLockError);
    expect(() => solveTimeLock({ ...puzzle, base: puzzle.base + 1n })).toThrow(TimeLockError);
  });

  it("informa del progreso mientras trabaja", () => {
    const { puzzle } = createTimeLock(randomBytes(16), {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });
    let ultimo = 0;
    solveTimeLock(puzzle, { onProgress: (hechas) => (ultimo = hechas) });
    expect(ultimo).toBe(ELEVACIONES_TEST);
  });

  it("sobrevive a la serialización", () => {
    const secreto = randomBytes(32);
    const { puzzle } = createTimeLock(secreto, {
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
    });
    const recuperado = decodeTimeLock(encodeTimeLock(puzzle));
    expect(recuperado.modulus).toBe(puzzle.modulus);
    expect(recuperado.squarings).toBe(puzzle.squarings);
    expect(solveTimeLock(recuperado).bytes).toEqual(secreto);
  });

  it("rechaza parámetros sin garantía", () => {
    expect(() => createTimeLock(randomBytes(32), { squarings: 0 })).toThrow(TimeLockError);
    expect(() =>
      createTimeLock(randomBytes(32), { squarings: 10, modulusBits: 64 }),
    ).toThrow(TimeLockError);
  });

  it("traduce duraciones a elevaciones", () => {
    expect(squaringsForDuration(1000, 5000)).toBe(5000);
    expect(squaringsForDuration(2000, 5000)).toBe(10_000);
    expect(() => squaringsForDuration(0)).toThrow(TimeLockError);
  });
});

describe("interruptor de hombre muerto", () => {
  const DIA = 86_400_000;

  function nuevo(ahora = Date.now()) {
    const clave = generateSigningKeyPair();
    const estado = createDeadManSwitch(clave, {
      intervaloSenalMs: 30 * DIA,
      periodoGraciaMs: 7 * DIA,
      ahora,
    });
    return { clave, estado, ahora };
  }

  it("sigue activo mientras llegan señales de vida", () => {
    const { clave, estado, ahora } = nuevo();
    expect(evaluateSwitch(estado, ahora)).toBe("activo");

    const masTarde = ahora + 20 * DIA;
    const actualizado = applyHeartbeat(
      estado,
      emitHeartbeat(estado, clave.secretKey, masTarde),
      masTarde,
    );
    expect(evaluateSwitch(actualizado, masTarde + 20 * DIA)).toBe("activo");
  });

  it("vence, pasa por gracia y acaba liberable sin señales", () => {
    const { estado, ahora } = nuevo();
    expect(evaluateSwitch(estado, ahora + 29 * DIA)).toBe("activo");
    expect(evaluateSwitch(estado, ahora + 32 * DIA)).toBe("en-gracia");
    expect(evaluateSwitch(estado, ahora + 40 * DIA)).toBe("liberable");
  });

  it("rechaza una señal con firma falsificada", () => {
    const { estado, ahora } = nuevo();
    const impostor = generateSigningKeyPair();
    const falsa = emitHeartbeat(estado, impostor.secretKey, ahora + DIA);
    expect(() => applyHeartbeat(estado, falsa, ahora + DIA)).toThrow(SwitchError);
  });

  it("rechaza señales de otro interruptor y fechadas en el futuro", () => {
    const { clave, estado, ahora } = nuevo();
    const otro = nuevo(ahora);

    const ajena = emitHeartbeat(otro.estado, otro.clave.secretKey, ahora);
    expect(() => applyHeartbeat(estado, ajena, ahora)).toThrow(/otro interruptor/);

    const futura = emitHeartbeat(estado, clave.secretKey, ahora + 10 * DIA);
    expect(() => applyHeartbeat(estado, futura, ahora)).toThrow(/futuro/);
  });

  it("una señal antigua no retrasa el vencimiento", () => {
    const { clave, estado, ahora } = nuevo();
    const reciente = applyHeartbeat(
      estado,
      emitHeartbeat(estado, clave.secretKey, ahora + 10 * DIA),
      ahora + 10 * DIA,
    );
    const conAntigua = applyHeartbeat(
      reciente,
      emitHeartbeat(reciente, clave.secretKey, ahora + 5 * DIA),
      ahora + 11 * DIA,
    );
    expect(conAntigua.ultimaSenal).toBe(reciente.ultimaSenal);
  });

  it("se puede revocar y deja de aceptar señales", () => {
    const { clave, estado, ahora } = nuevo();
    const revocado = revokeSwitch(estado);
    expect(evaluateSwitch(revocado, ahora + 100 * DIA)).toBe("revocado");
    expect(() =>
      applyHeartbeat(revocado, emitHeartbeat(estado, clave.secretKey, ahora), ahora),
    ).toThrow(SwitchError);
  });

  it("informa del tiempo restante en lenguaje llano", () => {
    const { estado, ahora } = nuevo();
    expect(timeUntilRelease(estado, ahora)).toBe(37 * DIA);
    expect(describeSwitch(estado, ahora)).toMatch(/Activo/);
    expect(describeSwitch(estado, ahora + 40 * DIA)).toMatch(/Liberable/);
    expect(describeSwitch(revokeSwitch(estado), ahora)).toMatch(/Revocado/);
  });

  it("sobrevive a la serialización, señales incluidas", () => {
    const { clave, estado, ahora } = nuevo();
    expect(decodeSwitch(encodeSwitch(estado)).id).toBe(estado.id);
    expect(decodeSwitch(encodeSwitch(estado)).ultimaSenal).toBe(estado.ultimaSenal);

    const senal = emitHeartbeat(estado, clave.secretKey, ahora + DIA);
    const recuperada = decodeHeartbeat(encodeHeartbeat(senal));
    expect(applyHeartbeat(estado, recuperada, ahora + DIA).ultimaSenal).toBe(ahora + DIA);
  });
});

describe("herencia digital con doble condición", () => {
  const DIA = 86_400_000;

  function legado(ahora: number) {
    const secreto = randomBytes(32);
    const identidades = guardianes(3);
    const { paquete, trapdoor } = createInheritancePackage(secreto, {
      beneficiarios: identidades.map((g) => g.guardian),
      umbral: 2,
      signingKey: generateSigningKeyPair(),
      intervaloSenalMs: 30 * DIA,
      periodoGraciaMs: 7 * DIA,
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
      ahora,
    });
    const fragmentos = [0, 1].map((i) =>
      guardianDecryptShare(identidades[i]!.kemSecretKey, paquete.recovery.shares[i]!),
    );
    return { secreto, paquete, trapdoor, fragmentos, identidades };
  }

  it("con umbral y cerradura, tras liberarse, entrega el secreto", () => {
    const ahora = Date.now();
    const { secreto, paquete, fragmentos } = legado(ahora);
    const recuperado = claimInheritance(paquete, {
      shares: fragmentos,
      ahora: ahora + 40 * DIA,
    });
    expect(recuperado.bytes).toEqual(secreto);
  });

  it("los beneficiarios no pueden precipitarse mientras el titular da señales", () => {
    const ahora = Date.now();
    const { paquete, fragmentos } = legado(ahora);
    expect(() => claimInheritance(paquete, { shares: fragmentos, ahora: ahora + DIA })).toThrow(
      SwitchError,
    );
  });

  it("el tiempo por sí solo no basta: hacen falta los beneficiarios", () => {
    const ahora = Date.now();
    const { paquete, fragmentos } = legado(ahora);
    expect(() =>
      claimInheritance(paquete, { shares: fragmentos.slice(0, 1), ahora: ahora + 40 * DIA }),
    ).toThrow();
  });

  it("los beneficiarios por sí solos no bastan: hace falta la cerradura", () => {
    // Sin resolver el puzzle no hay clave, y sin clave los fragmentos
    // combinados no son el secreto. Se comprueba que el material intermedio
    // recuperado por Shamir no coincide con el secreto real.
    const ahora = Date.now();
    const { secreto, paquete, fragmentos } = legado(ahora);
    const soloShamir = recoverSecret(fragmentos, paquete.recovery.policy);
    expect(soloShamir.bytes).not.toEqual(secreto);
  });

  it("el titular puede abrir su propio legado con la trampilla", () => {
    const ahora = Date.now();
    const { secreto, paquete, trapdoor, fragmentos } = legado(ahora);
    const recuperado = claimInheritance(paquete, {
      shares: fragmentos,
      trapdoor,
      ahora: ahora + 40 * DIA,
    });
    expect(recuperado.bytes).toEqual(secreto);
  });

  it("acepta un secreto más largo que la clave interna", () => {
    // La máscara se deriva con HKDF a la longitud exacta, así que un secreto
    // de 100 bytes no reutiliza tramos de clave.
    const ahora = Date.now();
    const secreto = randomBytes(100);
    const identidades = guardianes(3);
    const { paquete } = createInheritancePackage(SecretBuffer.copyOf(secreto), {
      beneficiarios: identidades.map((g) => g.guardian),
      umbral: 2,
      signingKey: generateSigningKeyPair(),
      intervaloSenalMs: 30 * DIA,
      periodoGraciaMs: 7 * DIA,
      squarings: ELEVACIONES_TEST,
      modulusBits: BITS_TEST,
      ahora,
    });
    const fragmentos = [0, 1].map((i) =>
      guardianDecryptShare(identidades[i]!.kemSecretKey, paquete.recovery.shares[i]!),
    );
    expect(
      claimInheritance(paquete, { shares: fragmentos, ahora: ahora + 40 * DIA }).bytes,
    ).toEqual(secreto);
  });
});
