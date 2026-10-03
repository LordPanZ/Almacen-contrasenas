# Arca

Arca es la caja para **documentos**: DNI, escrituras, seguros, PDF y fotos. Es
una aplicación **independiente** de Cerbero —su gestor de contraseñas—: tiene su
propia contraseña, su propio formato de fichero y su propia dirección web. Solo
comparte código, nunca datos: `@cerbero/crypto`, el paquete que contiene las
primitivas y que sigue siendo el único autorizado a tocar criptografía, y
`@cerbero/sentinel`, de donde la pantalla de creación toma el medidor de fuerza
de la contraseña. El núcleo de Arca (`@cerbero/arca`) depende solo del primero.

## Por qué no es parte de Cerbero

Tienen requisitos opuestos.

| | Cerbero (contraseñas) | Arca (documentos) |
| --- | --- | --- |
| Unidad | Entradas de cientos de bytes | Ficheros de hasta 50 MiB |
| Tamaño en disco | **Fijo** (ranuras de 256 KiB): no revela cuánto guardas | Crece con lo que guardas |
| Negación plausible | Sí: ranuras indistinguibles, bóvedas de coacción | **No**: no tiene sentido con ficheros de tamaño variable |
| Copia de seguridad | Un fichero pequeño | Un fichero con todo, potencialmente de cientos de MiB |

Un gestor con ranuras de tamaño fijo no puede guardar un escrito escaneado, y
meterlo a la fuerza obligaba a que cada uno cargara con las limitaciones del
otro. Separadas, cada una hace una sola cosa.

Además, al publicarse en **direcciones distintas** son orígenes distintos, y el
navegador aísla el almacenamiento por origen: ninguna puede leer lo que guarda
la otra, ni siquiera por un fallo de la propia aplicación.

## Jerarquía de claves

```
contraseña + sal ──Argon2id──▶ MK
MK ──HKDF "arca-wrap-key"──▶ clave de envoltorio ──abre──▶ sobre ──▶ CD (32 B, aleatoria)
CD ──HKDF "arca-index-key"────────────▶ clave del índice
CD ──HKDF "arca-doc-key" ‖ idDocumento─▶ clave de cada documento
```

- **La clave de datos (CD) es aleatoria**, no se deriva de la contraseña. Cambiar
  la contraseña reenvuelve 72 bytes y nunca recifra los documentos: sin esa
  indirección, cambiarla obligaría a recifrar todos los PDF y fotos, que es justo
  la operación que más fácil se interrumpe a medias.
- **La clave maestra se destruye** en cuanto produce la clave de envoltorio. Una
  caja abierta en memoria solo contiene la clave de datos.
- **Una clave por documento.** Filtrar la de uno no da ninguna otra.
- Cambiar la contraseña **verifica antes la actual**: un despiste al teclear no
  puede reenvolver la clave bajo una que nadie conoce.

## Qué se guarda y dónde

Todo está en IndexedDB, en dos almacenes. Es exactamente lo que contiene la copia
de seguridad: nada en claro.

**Cabecera (142 bytes, en claro).** `magic "ARCAFILE" (8) | versión (2) | cajaId
(16) | Argon2: t, m, p (12) | sal (32) | sobre (72)`. Revela que es una caja de
Arca, el coste de derivación y una sal aleatoria. El sobre autentica el resto de
la cabecera: alterar la sal, los parámetros o el identificador impide abrirla.
Los parámetros de Argon2 que trae el fichero se acotan antes de gastar un solo
byte en ellos: sin cota, bastarían dos bytes alterados para que desbloquear
intentara reservar terabytes.

**Índice (cifrado).** JSON con, por documento: identificador, nombre, tipo,
tamaño real, categoría, notas y fechas. **Todo eso va dentro del cifrado.** Se
rellena hasta un suelo de **16 KiB**, así que una caja con 3 documentos y otra con
40 pesan lo mismo en disco (caben unos sesenta; a partir de ahí el tamaño solo
revela el cubo). Lleva un contador de **revisión**: quien guarda comprueba, en la
misma transacción, que la de disco es la que él leyó. Dos pestañas abiertas sobre
la misma caja se pisarían el índice en silencio; así la segunda falla con un
mensaje.

**Documentos (cifrados, uno por criptograma).** Fuera del cifrado solo queda su
identificador de 16 bytes aleatorios, sin relación con el contenido.

## Cifrado de un documento

Por trozos de 1 MiB. Cifrar de una vez exige tener a la vez el original, una
copia rellenada y el criptograma, y en un móvil eso es lo que mata la pestaña.

- Flujo lógico: `longitud (4) | datos | ceros hasta el cubo`. Los cubos son los
  de Cerbero: 256 B, 1, 4, 16 y 64 KiB, y múltiplos de 64 KiB por encima. Un PDF
  de 70 KB y otro de 120 KB pesan lo mismo.
- Cada trozo: `nonce (24) | texto cifrado | etiqueta (16)`, con XChaCha20-Poly1305.
- **Datos autenticados de cada trozo**: caja, documento, posición y *si es el
  último*. Eso cierra lo que el cifrado por trozos abre: reordenar, repetir,
  recortar el final para entregar un documento incompleto o colar un trozo de otro
  documento fallan la autenticación.
- Un recorte se detecta además por otra vía independiente: la longitud total
  depende de la longitud declarada, que va autenticada en el primer trozo.
- Tope: **50 MiB** por documento.

Las **fotos** se re-codifican antes de cifrar (JPEG, o PNG si lo eran), lo que
elimina el EXIF: ubicación GPS, modelo del móvil y hora. Es una casilla marcada
por defecto en la hoja de añadir. Los PDF y el resto de archivos pasan tal cual.

## Copia de seguridad (`.arca`)

Un solo fichero con la cabecera, el índice y todos los documentos, cifrados. No
añade cifrado propio ni revela nada nuevo: son los mismos criptogramas que hay en
el navegador, uno tras otro. Se abre con la contraseña que tenía la caja cuando
se hizo.

Al restaurar, la copia se **valida entera antes de escribir nada** (sin leer los
documentos, solo sus prefijos) y se escribe en este orden: documentos primero y,
**al final**, cabecera e índice en una sola transacción. Mientras no se escriben
esos dos, la caja anterior sigue siendo la que hay: una copia cortada o
manipulada no deja nada a medias. La lectura es con acceso aleatorio, no entera
en memoria.

## Otras decisiones

- **El trabajador criptográfico es el único que toca las claves y el almacén.**
  La interfaz nunca recibe la clave de datos ni un criptograma; además el Argon2
  de desbloquear (~10 s) congelaría la pantalla en el hilo principal.
- **Bloqueo por inactividad** (1, 5, 15 o 30 minutos). Se mide con marcas de
  tiempo y no con un temporizador único: los navegadores congelan los de las
  pestañas en segundo plano, y al volver lo que cuenta es cuánto pasó de verdad.
  Al bloquear se borran las claves.
- **Borrado en el orden seguro**: al borrar un documento se guarda primero el
  índice y después se retira el criptograma. Si algo falla en medio queda un
  criptograma sin dueño (que la pestaña *Caja* permite liberar), nunca una
  entrada que apunta a nada.
- Pide al navegador **almacenamiento persistente** para que no lo expulse cuando
  falte espacio, y avisa si no lo concede.
- Si el índice menciona un documento que el navegador no tiene (una copia
  incompleta), la lista lo marca en lugar de fallar al abrirlo.

## Qué no cubre

- **No ha pasado una auditoría independiente.** Lo mismo que Cerbero.
- **Sin negación plausible.** El tamaño total delata cuánto guardas, y un
  atacante con acceso al navegador sabe que hay una caja. Por eso Arca no
  pretende ocultar su existencia, solo su contenido.
- **Sin recuperación.** Perder la contraseña y no tener copia es perder los
  documentos. Es el precio de que nadie más pueda abrirlos.
- **Quien sirve el código es de fiar.** Cada visita, el sitio entrega el código
  que descifra. La política de seguridad del despliegue (`connect-src 'none'`) lo
  dificulta, pero quien controla el sitio controla las cabeceras. El fichero
  descargado y abierto sin conexión es más seguro, aunque Arca no funciona abierta
  desde el disco: sin un origen estable el navegador no guarda nada entre sesiones.
- **Contra un navegador comprometido** —una extensión maliciosa, un dispositivo
  infectado— no hay criptografía que valga con la caja abierta.
- **Reversión.** Quien restaure una copia antigua en lugar de la actual pierde lo
  añadido desde entonces, y nada lo detecta: el contador de revisión protege
  contra dos pestañas, no contra una copia vieja.
- La contraseña pasa por el hilo principal como cadena de JavaScript, que es
  inmutable y no se puede borrar. El núcleo mantiene el secreto en búferes
  borrables; la capa de interfaz no puede.
- Al ver una imagen, esta vive en memoria como URL de objeto hasta cerrar el
  visor; al cerrarlo se revoca.
- HEIC y otros formatos que el navegador no sabe decodificar se guardan tal cual,
  con sus metadatos, y la aplicación lo avisa.

## Publicar

Arca se publica como **un sitio de Netlify distinto** al de Cerbero, con la
variable `APP_PUBLICAR = arca`. Ver el README de la raíz.
