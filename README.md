# Cerbero

Almacén de contraseñas de conocimiento cero con criptografía híbrida
post-cuántica, pensado para lo que los gestores actuales no cubren.

> Estado: en construcción. El núcleo criptográfico está implementado y probado.

## Por qué otro gestor de contraseñas

Bitwarden, 1Password y KeePass resuelven bien el problema de 2015: cifrar
secretos en reposo y sincronizarlos. Cerbero ataca los huecos que quedan:

| Amenaza real | Respuesta de Cerbero |
| --- | --- |
| "Cosechar ahora, descifrar después" con ordenador cuántico | KEM híbrido X-Wing (ML-KEM-768 + X25519) |
| Te obligan por la fuerza a abrir la bóveda | Bóveda de coacción con negación plausible |
| El servidor te devuelve una versión antigua o alterada | Registro de auditoría Merkle con pruebas de consistencia |
| Pierdes la contraseña maestra y lo pierdes todo | Recuperación social Shamir k-de-n con guardianes |
| Mueres y tu familia no puede acceder a nada | Cerradura temporal + interruptor de hombre muerto |
| Alguien entra en tu bóveda y no te enteras | Credenciales trampa que avisan al usarse |
| El servidor ve tus dominios, títulos y cuántos ítems tienes | Metadatos cifrados y relleno por cubos |
| Comprobar si tu contraseña está filtrada se la revela a alguien | Consulta OPRF de conocimiento cero |

## Estructura

```
packages/crypto      Primitivas: Argon2id, XChaCha20-Poly1305, X-Wing, ML-DSA, Shamir
packages/vault       Jerarquía de claves, cifrado de ítems, bóveda de coacción
packages/ledger      Registro de auditoría Merkle
packages/guardians   Recuperación social, cerradura temporal, hombre muerto
packages/sentinel    Credenciales trampa y filtraciones con conocimiento cero
apps/cli             Interfaz de línea de comandos
```

## Desarrollo

```bash
pnpm install
pnpm test
pnpm build
```

## Aviso

Este proyecto no ha pasado una auditoría criptográfica independiente. No lo uses
para proteger secretos reales hasta que la tenga.
