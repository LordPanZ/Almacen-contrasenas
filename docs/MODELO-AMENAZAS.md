# Modelo de amenazas de Cerbero

Un gestor de contraseñas que no dice explícitamente de qué protege y de qué no
está vendiendo humo. Este documento es el contrato: si una amenaza aparece como
"fuera de alcance", significa que Cerbero **no** te protege de ella, y conviene
saberlo antes y no después.

## 1. Qué se protege

| Activo | Por qué importa |
| --- | --- |
| Secretos de la bóveda | Contraseñas, claves, notas: el objetivo evidente |
| Metadatos de los ítems | Saber *dónde* tienes cuenta ya es un mapa de ataque |
| Estructura de la bóveda | Cuántos ítems tienes, de qué tamaño, cuándo cambian |
| Existencia de bóvedas ocultas | Si se puede demostrar que hay una segunda bóveda, la negación plausible no existe |
| Historial de acceso | Sin historial íntegro no puedes saber si entraron |
| Claves de recuperación | Quien las tenga tiene todo, sin pasar por la contraseña maestra |

## 2. Adversarios considerados

### A1 — Ladrón del fichero cifrado
Se lleva el fichero de la bóveda (portátil robado, copia de seguridad expuesta,
bucket mal configurado) y ataca sin conexión, sin prisa y con hardware dedicado.

**Defensa.** Argon2id con coste de memoria alto: cada intento cuesta cientos de
MiB, que es justo lo que las GPU y los ASIC no pueden paralelizar barato. Sal de
32 bytes por bóveda, así no existen tablas precalculadas útiles. Toda la
seguridad frente a A1 se apoya en la entropía de la contraseña maestra: es el
único eslabón que Cerbero no controla, y por eso la CLI insiste en frases largas.

### A2 — Servidor de sincronización malicioso u honesto-pero-comprometido
Almacena tu bóveda cifrada. Quiere leerla, alterarla o hacerte retroceder en el
tiempo.

**Defensa.** El servidor solo ve criptogramas: la clave de autenticación deriva
de una etiqueta HKDF distinta de la de cifrado, así que probar tu identidad ante
el servidor no le da ningún poder de descifrado. Los metadatos van dentro del
cifrado y el relleno por cubos oculta los tamaños. Contra la alteración y el
retroceso está el registro Merkle: el servidor no puede reescribir el pasado sin
romper una prueba de consistencia, ni devolverte una versión antigua sin que el
monitor lo detecte.

### A3 — Coacción física o legal
Alguien con poder sobre ti —un asaltante, una frontera, una orden judicial— te
obliga a abrir la bóveda.

**Defensa.** Ranuras de coacción: das una contraseña distinta y se abre una
bóveda real, funcional y plausible, con contenido creíble. Todas las ranuras son
del mismo tamaño y las no usadas contienen bytes aleatorios indistinguibles de
un criptograma, así que **no se puede demostrar que exista una segunda bóveda**.
El desbloqueo bajo coacción queda registrado en el histórico para que sepas que
ocurrió.

*Límite honesto:* esto protege frente a quien inspecciona el fichero, no frente a
quien sabe con certeza que escondes algo y tiene tiempo. Ninguna criptografía
resuelve la coacción sostenida.

### A4 — Atacante con ordenador cuántico (futuro)
Guarda hoy tu bóveda cifrada y la descifra dentro de diez o veinte años, cuando
exista la máquina. Es el ataque de "cosechar ahora, descifrar después".

**Defensa.** KEM híbrido X-Wing (ML-KEM-768 + X25519) y firmas híbridas
(Ed25519 + ML-DSA-65) en todo lo que viaja o debe seguir siendo verificable:
fragmentos de recuperación, paquetes de herencia, cabeceras del registro. La
combinación exige romper **ambas** familias. El cifrado simétrico de la bóveda
usa claves de 256 bits, que frente a Grover conservan un margen de 128 bits.

Este adversario es el motivo de que sea razonable construir esto hoy: una
contraseña que guardas ahora puede seguir siendo válida dentro de quince años.

### A5 — Intruso silencioso
Ya tiene acceso: una sesión desbloqueada, un dispositivo comprometido, una copia
de la bóveda abierta. Quiere usar credenciales sin que te enteres.

**Defensa.** Credenciales trampa indistinguibles de las reales. Cualquier uso de
una de ellas es, por definición, actividad no autorizada: tú nunca las usas. Es
detección de intrusión dentro de la bóveda, algo que ningún gestor actual ofrece.

### A6 — Guardián o beneficiario deshonesto
Alguien a quien confiaste un fragmento de recuperación intenta usarlo solo, o
adelantar tu herencia digital.

**Defensa.** Shamir k-de-n: por debajo del umbral, un fragmento no da
*ninguna* información (seguridad de la información, no computacional: ni un
ordenador cuántico ayuda). Cada fragmento va cifrado a la clave pública de su
guardián, así que no es transferible. La herencia añade una segunda condición
independiente: umbral de beneficiarios **y** cerradura temporal, de modo que ni
la familia puede precipitarse ni un servidor puede liberar el legado por su cuenta.

### A7 — Curioso del canal de consulta
Quieres saber si una contraseña tuya está en una filtración, y la consulta misma
se convierte en la fuga.

**Defensa.** OPRF: el servidor evalúa sobre un valor cegado y no aprende la
contraseña, ni su hash, ni un prefijo. Mejora el modelo k-anonymity del estándar
actual, que sí revela un prefijo y permite correlacionar consultas.

## 3. Fuera de alcance (léelo)

Estas amenazas **no** están cubiertas, y ningún diseño de bóveda las cubre:

- **Dispositivo comprometido con la bóveda abierta.** Un registrador de teclas o
  un proceso con acceso a tu memoria gana. `SecretBuffer` reduce la ventana
  borrando claves en cuanto dejan de usarse, pero no convierte una máquina
  infectada en segura.
- **Contraseña maestra débil.** Argon2id encarece cada intento; no arregla
  "verano2024".
- **Coacción con conocimiento previo.** Si el adversario *sabe* que hay una
  segunda bóveda, la negación plausible no le convence.
- **Análisis de tráfico.** Cuándo y con qué frecuencia sincronizas es visible
  para quien observe la red.
- **Ataques al lado del servicio.** Si te roban la sesión directamente en tu
  banco, tu gestor de contraseñas es irrelevante.
- **Cadena de suministro.** Un paquete npm comprometido, un compilador troyanizado
  o un binario alterado derrotan cualquier diseño criptográfico. Se mitiga con
  dependencias mínimas y auditadas, no se elimina.

## 4. Decisiones de diseño y lo que cuestan

| Decisión | A cambio de |
| --- | --- |
| Sin recuperación por parte de una empresa | Si pierdes la contraseña y no configuraste guardianes, no hay vuelta atrás |
| Tamaño de ranura fijo | Límite duro de contenido por bóveda, a cambio de negación plausible real |
| Todo cifrado, metadatos incluidos | El servidor no puede indexar ni buscar por ti |
| Criptografía híbrida post-cuántica | Claves y criptogramas más grandes (1216 B por clave pública) |
| Relleno por cubos | Ficheros mayores de lo estrictamente necesario |
| Argon2id con coste alto | El desbloqueo tarda segundos, a propósito |

Cada casilla de la derecha es intencionada. Un gestor de contraseñas que nunca
te incomoda es, casi siempre, uno que ha cedido en la izquierda.
