# Cerbero y Arca

Dos aplicaciones **independientes**, de conocimiento cero y con todo el cifrado
en el navegador:

- **Cerbero** — almacén de contraseñas con criptografía híbrida post-cuántica.
  Aplicación web, extensión, línea de comandos y librerías auditables.
- **Arca** — caja cifrada para documentos: DNI, escrituras, PDF y fotos. Su
  propia contraseña, su propio formato y su propia dirección web.
  Ver [docs/ARCA.md](docs/ARCA.md).

No comparten datos, claves ni origen: abiertas en direcciones distintas, el
navegador aísla el almacenamiento de una del de la otra. Solo comparten código,
nunca información: `@cerbero/crypto` (las primitivas, el único paquete
autorizado a tocar criptografía) y `@cerbero/sentinel` (el medidor de fuerza de
contraseñas).

> **Aviso:** no ha pasado una auditoría criptográfica independiente. No lo uses
> para proteger secretos reales hasta que la tenga.

## Por qué otro gestor de contraseñas

Bitwarden, 1Password y KeePass resuelven bien el problema de 2015: cifrar
secretos en reposo y sincronizarlos. Cerbero ataca los huecos que quedan.

| Amenaza real | Qué hace Cerbero | ¿Existe hoy? |
| --- | --- | --- |
| Roban tu bóveda hoy y la descifran cuando haya ordenador cuántico | KEM híbrido X-Wing (ML-KEM-768 + X25519) y firmas Ed25519 + ML-DSA-65 | No |
| Te obligan por la fuerza a abrir la bóveda | Ranuras indistinguibles: nadie puede demostrar que exista una segunda bóveda | No |
| El servidor te devuelve una versión antigua o reescribe tu historial | Registro Merkle con pruebas de inclusión y consistencia | No |
| Pierdes la contraseña maestra y lo pierdes todo | Recuperación social Shamir k-de-n, sin empresa que custodie tu clave | No |
| Mueres y tu familia no puede acceder a nada | Herencia con doble condición: umbral de beneficiarios **y** cerradura temporal | No |
| Alguien entra en tu bóveda y no te enteras | Credenciales trampa indistinguibles de las reales | No |
| El servidor ve tus dominios, títulos y cuántos ítems tienes | Metadatos dentro del cifrado y relleno por cubos | Parcial |
| Comprobar si tu contraseña está filtrada se la revela a alguien | OPRF verificable: el servidor no aprende ni un prefijo | No |
| Caes en una página que imita a tu banco | La extensión exige coincidencia exacta de origen, y **explica** por qué se niega | Parcial |

## Empezar

```bash
pnpm install
pnpm test                          # 261 tests
pnpm build
pnpm run typecheck:apps            # comprueba los tipos de las apps (la raíz solo ve los paquetes)

pnpm --filter @cerbero/web dev        # Cerbero, en el navegador
pnpm --filter @cerbero/arca-web dev   # Arca, en el navegador
pnpm --filter @cerbero/extension build  # extensión → cargar apps/extension/dist
node --experimental-strip-types apps/cli/src/main.ts --help
```

### La extensión

Una extensión de gestor de contraseñas no vale por ahorrarte teclear: vale por
**negarse a escribir donde no debe**. Exige que el nombre de host coincida
exactamente, nunca rellena dentro de un marco de otro origen, repite la
comprobación en el momento de rellenar —no solo al listar— y, cuando se niega,
dice por qué. Detecta además dominios que cuelgan el tuyo como prefijo
(`banco.es.atacante.com`) y homógrafos (`xn--banc-85d.es`, que se lee «bancó.es»
con una «о» cirílica). Detalles en [apps/extension](apps/extension/README.md).

### La línea de comandos

```bash
cerbero init                 # crea la bóveda
cerbero add "Banco"          # añade una entrada
cerbero list                 # lista (marca las trampas)
cerbero duress               # añade una bóveda de coacción
cerbero canary --cantidad 3  # siembra credenciales trampa
cerbero check                # filtraciones, sin revelar nada
cerbero audit --verificar    # comprueba que el historial no fue reescrito
```

## Estructura

```
packages/crypto      Primitivas: Argon2id, XChaCha20-Poly1305, X-Wing, ML-DSA, Shamir
packages/vault       Jerarquía de claves, cifrado de ítems, bóvedas de coacción
packages/ledger      Registro de auditoría Merkle (RFC 6962)
packages/guardians   Recuperación social, cerradura temporal, hombre muerto
packages/sentinel    Credenciales trampa y filtraciones con conocimiento cero
packages/arca        Caja de documentos: claves, cifrado por trozos, copia de seguridad
apps/cli             Cerbero: línea de comandos
apps/web             Cerbero: interfaz gráfica, entera en el navegador
apps/extension       Cerbero: extensión con relleno vinculado al origen
apps/arca            Arca: interfaz gráfica de la caja de documentos
scripts/             Empaquetador de un solo fichero y selector de sitio
```

Las dependencias van en un solo sentido: todos apuntan a `crypto` y ninguno se
apunta entre sí. Solo las apps los componen. `arca` no depende de `vault`, ni
al revés: son productos distintos.

## Publicar

Cada aplicación se publica como **su propio sitio de Netlify**, desde este mismo
repositorio. Qué construye cada sitio lo decide la variable `APP_PUBLICAR`:

| Sitio | Variable (Netlify → Site configuration → Environment variables) |
| --- | --- |
| Cerbero | ninguna, o `APP_PUBLICAR = cerbero` |
| Arca | `APP_PUBLICAR = arca` |

La rama a desplegar y el resto (`pnpm run construir:sitio`, carpeta `dist-sitio`)
ya vienen en `netlify.toml`. En local: `pnpm run construir:cerbero` o
`pnpm run construir:arca` dejan en `dist-sitio/` lo que se publicaría.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md) — jerarquía de claves y formato de fichero de Cerbero
- [Arca](docs/ARCA.md) — la caja de documentos: claves, formato, copia y límites
- [Modelo de amenazas](docs/MODELO-AMENAZAS.md) — siete adversarios, y lo que **no** cubre
- [API del núcleo](docs/API-NUCLEO-CRIPTO.md) — referencia de `@cerbero/crypto`

## Lo que cuesta

Cada garantía se paga con algo, y conviene saberlo antes:

- Si pierdes la contraseña y no configuraste guardianes, **no hay vuelta atrás**.
- El tamaño de ranura es fijo desde que se crea el fichero.
- El desbloqueo tarda segundos, a propósito.
- El servidor no puede indexar ni buscar por ti, porque no ve nada.

Un gestor de contraseñas que nunca te incomoda es, casi siempre, uno que ha
cedido en la columna de la izquierda.
