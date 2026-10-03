# Arquitectura de Cerbero

## Principio rector

**El servidor nunca puede abrir tu bóveda, y tú puedes demostrarlo.**

La primera mitad la cumplen casi todos los gestores serios. La segunda no la
cumple ninguno: hoy no tienes forma de saber si el servicio te devolvió una
versión antigua de tu bóveda, si ocultó un acceso o si enseñó historiales
distintos a dos de tus dispositivos. Cerbero convierte esa confianza en
verificación.

## Jerarquía de claves

```
                     contraseña maestra
                            │
                            │  Argon2id  (sal de 32 B, coste de memoria alto)
                            ▼
                    Clave Maestra (MK, 32 B)
                            │
            ┌───────────────┴────────────────┐
            │ HKDF "auth-key"                │ HKDF "duress-slot-key" (ctx = índice)
            ▼                                ▼
     Clave de autenticación          Clave de ranura_i  ──abre──▶  Ranura i
     (prueba identidad ante                                            │
      el servidor; NO descifra                                         ▼
      absolutamente nada)                                    Sobre de la bóveda
                                                    { vaultId, VDK, semillas de identidad }
                                                                       │
                                    ┌──────────────────┬───────────────┴────────┐
                                    │ HKDF "item-key"  │ HKDF "identity-kem"    │ HKDF "identity-signing"
                                    │  (ctx = itemId)  ▼                        ▼
                                    ▼            Par KEM híbrido          Par de firma híbrida
                             Clave del ítem      (recuperación,            (registro, atestaciones)
                             (una por ítem)       herencia)
```

Tres propiedades que caen de este diseño:

1. **La clave de autenticación y la de cifrado son ramas hermanas, no la misma.**
   Entregarle al servidor lo necesario para probar quién eres no le da nada con
   lo que descifrar. Sin esta separación, autenticarte sería regalarle la bóveda.
2. **Una clave por ítem.** Comprometer el criptograma de un ítem no ayuda con los
   demás, y permite compartir un ítem suelto sin ceder la bóveda entera.
3. **Las claves de identidad se derivan, no se guardan.** Tu par de claves
   post-cuántico renace de la bóveda en cada desbloqueo, así que no hay un
   segundo fichero que perder ni que sincronizar.

## Formato del fichero

```
┌─────────────────────────────────────────────────────────────┐
│ Cabecera (en claro, y deliberadamente aburrida)             │
│  magic · versión · parámetros Argon2 · sal · nº ranuras     │
│  · tamaño de ranura                                          │
├─────────────────────────────────────────────────────────────┤
│ Ranura 0   ── tamaño fijo ──▶  ¿bóveda real o ruido?         │
│ Ranura 1   ── tamaño fijo ──▶  indistinguible                │
│ Ranura 2   ── tamaño fijo ──▶  indistinguible                │
│ Ranura 3   ── tamaño fijo ──▶  indistinguible                │
└─────────────────────────────────────────────────────────────┘
```

La cabecera no revela **cuántas** de las ranuras contienen una bóveda de verdad.
Una ranura sin usar guarda bytes aleatorios; una ranura en uso guarda un
criptograma. Ambos son estadísticamente idénticos, y esa es toda la base de la
negación plausible.

El desbloqueo cuesta **un solo Argon2**, no uno por ranura: se deriva la clave
maestra una vez y luego se prueba contra cada ranura con una operación AEAD, que
es despreciable. Sin esto, tener cuatro ranuras multiplicaría por cuatro el
tiempo de desbloqueo y la propia lentitud delataría el diseño.

## Flujo de un desbloqueo

```
contraseña ─▶ Argon2id ─▶ MK ─┬─▶ ranura 0: ¿abre? no
                              ├─▶ ranura 1: ¿abre? SÍ ──▶ sobre ──▶ VDK
                              ├─▶ ranura 2: ¿abre? no        │
                              └─▶ ranura 3: ¿abre? no        ▼
                                                     ítems descifrados
                                                     bajo demanda
```

Un fallo de contraseña y una ranura vacía producen exactamente el mismo error, y
el mismo mensaje. Esa indistinguibilidad no es cosmética: es lo que impide
convertir el desbloqueo en un oráculo que cuente bóvedas.

## Los cinco paquetes

| Paquete | Responsabilidad | Idea central |
| --- | --- | --- |
| `crypto` | Todas las primitivas | Un único punto que auditar; nadie más importa `@noble/*` |
| `vault` | Jerarquía de claves, ítems, ranuras de coacción | Los metadatos viven dentro del cifrado |
| `ledger` | Registro Merkle append-only | El pasado no se puede reescribir sin que se note |
| `guardians` | Recuperación social, tiempo, herencia | Recuperar sin que exista una empresa que confiar |
| `sentinel` | Trampas y filtraciones | La bóveda detecta que entraron |

Las dependencias van en un solo sentido: todos apuntan a `crypto` y ninguno se
apunta entre sí. La CLI es la única que los compone.

## Lo que hace distinto a Cerbero

Lo que sigue no existe hoy en Bitwarden, 1Password ni KeePass:

1. **Criptografía híbrida post-cuántica de serie**, no como opción de laboratorio.
2. **Negación plausible real**: ranuras indistinguibles, no un "PIN de pánico"
   que el propio formato del fichero delata.
3. **Historial verificable**: pruebas de inclusión y de consistencia que
   convierten "confía en el servidor" en "compruébalo".
4. **Recuperación sin custodio**: Shamir k-de-n con guardianes, sin que ninguna
   empresa guarde una copia de tu clave.
5. **Herencia con doble condición**: umbral de beneficiarios *y* cerradura
   temporal basada en trabajo secuencial, no en la fecha que diga un servidor.
6. **Detección de intrusión**: credenciales trampa indistinguibles de las reales.
7. **Consultas de filtración de conocimiento cero**: el servidor no aprende ni un
   prefijo.
8. **Metadatos y tamaños ocultos**: ni dominios, ni títulos, ni cuántos ítems tienes.

## Aviso

Este proyecto no ha pasado una auditoría criptográfica independiente. Está
construido sobre primitivas auditadas (`@noble/*`) y estándares publicados
(FIPS 203/204, RFC 6962, RFC 9106, RFC 9497), pero componer primitivas correctas
puede producir un sistema incorrecto. No lo uses para proteger secretos reales
hasta que alguien cualificado lo revise.
