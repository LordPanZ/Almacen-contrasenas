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

## Carpetas

La caja se organiza en carpetas: cada documento está en exactamente una. Nacen
nueve (Identidad, Vivienda, Vehículo, Seguros, Salud, Finanzas, Trabajo y
estudios, Legal y familia, Otros) y el usuario puede **crear las suyas**,
renombrarlas y borrarlas, también al subir un documento ("＋ Nueva carpeta…").

- La lista de carpetas **va dentro del índice cifrado**, igual que los nombres de
  los documentos: desde fuera no se ve ni cómo se llaman ni cuántas hay.
- Los documentos apuntan a su carpeta por **identificador**, no por nombre:
  renombrar una carpeta no toca ningún documento.
- Borrar una carpeta **nunca borra documentos**: si los tiene, hay que elegir a
  qué carpeta pasan, y todo ocurre en un solo guardado del índice. Tiene que
  quedar siempre al menos una.
- Dos carpetas no pueden llamarse igual, aunque cambien las mayúsculas o los
  acentos («Vehículo» y «vehiculo» son la misma).
- El almacenamiento físico **no** se organiza en carpetas: sigue siendo una lista
  plana de criptogramas con identificador aleatorio. La estructura existe solo
  dentro del cifrado.

**Versión del índice.** Las carpetas son la versión 2 del índice. Una caja creada
con la versión 1 se abre sin más: sus carpetas son las nueve de siempre, con los
mismos identificadores que ya usaban sus documentos, y el índice se guarda como
versión 2 la primera vez que algo cambia. Un documento que apuntara a una carpeta
inexistente no impide abrir la caja: pasa a «Otros». Rechazar el índice entero
por un campo suelto dejaría al usuario fuera de todo por un fallo que no es suyo.
A la inversa, una copia hecha con la versión nueva no se abre con una versión
anterior de la app.

## Compartir

Arca no tiene servidor, así que **compartir es pasar un fichero** por el canal
que se quiera. Hay dos caminos y la app los distingue con todas las letras,
porque no son equivalentes.

### Envío cifrado con un código

Un fichero `.arcashare` con uno o varios documentos (hasta 50, 200 MiB en total)
que solo abre un **código** que se genera al crearlo:

```
"ARCASHR1" | versión(2) | argon2: t,m,p (12) | sal(32) | envíoId(16)
u32 len | manifiesto cifrado
{ u32 len | documento cifrado } × n
```

- **El código es de azar, no una contraseña elegida**: 20 símbolos del alfabeto
  de Crockford (sin I, L, O ni U, para poder dictarlo por teléfono), es decir,
  **100 bits** generados por el navegador y mostrados en grupos de cinco. Un
  fichero que viaja por una mensajería queda en sus servidores y en las copias de
  quien lo recibe; con una contraseña humana, esa copia sería un blanco de
  ataque sin conexión. Con 100 bits no hay nada que adivinar. Argon2id (perfil
  `interactive`) queda como cinturón y tirantes.
- **Fichero y código por canales distintos.** Es la parte que no puede resolver
  la criptografía: si viajan juntos por el mismo canal, quien lo intercepte tiene
  las dos cosas.
- **Dentro del cifrado** van los nombres, los tipos y los tamaños reales. Fuera
  solo se ve que es un envío de Arca, el coste de derivación, la sal y los
  tamaños de los documentos, que caen en cubos igual que en la caja. El nombre
  del fichero es genérico (`arca-AAAA-MM-DD.arcashare`): nunca el del documento.
- **Cada documento va por trozos de 1 MiB** con datos autenticados que atan el
  envío, la posición del documento, la del trozo y si es el último: reordenar,
  repetir, recortar o mezclar trozos de otro envío falla la autenticación. El
  manifiesto —que anuncia cuántos documentos hay y cuánto mide cada uno— va
  atado a la cabecera entera, así que un envío al que quitan o añaden un
  documento se detecta.
- **El destinatario no necesita una caja.** En la portada hay «Abrir un envío
  cifrado…»: elige el fichero, escribe el código y puede ver las fotos y
  descargar lo que trae. Si tiene la caja abierta, además puede guardarlo en la
  carpeta que quiera. Al elegir el fichero se valida su estructura **antes de
  pedir el código** y sin descifrar nada.
- **Los parámetros de Argon2 del fichero se acotan** antes de usarlos, como en la
  caja: dos bytes alterados no pueden hacer que abrirlo intente reservar
  terabytes.

### Sin cifrar

El archivo sale tal cual por la hoja de compartir del sistema (WhatsApp, correo,
AirDrop). Es lo cómodo, pero **sale de Arca**: la aplicación que lo reciba guarda
una copia que Arca ya no puede proteger ni borrar. Se prepara primero y se envía
con un segundo toque, porque `navigator.share` exige que lo dispare directamente
el usuario y en algunos móviles descifrar *después* del toque deja caducar el
permiso. Si el navegador no puede compartir archivos, se ofrece descargarlos.

### Lo que un envío no puede hacer

- **No se puede revocar.** Quien tenga el fichero y el código lo abrirá siempre.
- **Quien lo abre puede guardarlo en claro.** Un envío protege el camino, no la
  confianza en el destinatario. No hay forma técnica de impedir que alguien
  copie lo que ya ha visto.
- **No caduca.** No hay reloj de confianza en un fichero sin servidor.
- **Un envío no es una conversación.** No hay acuse de recibo ni forma de saber
  si se abrió.

## Varios dispositivos y varias personas

La caja vive **solo en el navegador** de cada dispositivo: no hay servidor que la
lleve a otro sitio, y esa es justo la razón de que nadie más pueda leerla. Para
tener la misma caja en el móvil de la pareja o en el ordenador de casa hay que
llevarla a mano.

**Primera vez, en el dispositivo nuevo.** En el que ya tiene la caja:
«Descargar copia» (pestaña *Caja*). Es un solo fichero `.arca`, cifrado: sin la
contraseña no se abre, así que puede viajar por el canal que se quiera. En el
dispositivo nuevo, abrir Arca en la misma dirección web, «Restaurar desde una
copia…», y desbloquear con **la misma contraseña**. La contraseña se dice en
persona, no junto al fichero. Es lo mismo que la copia de seguridad, y por eso
funciona con la versión que ya está publicada.

**Después, cada copia cambia por su lado.** Aquí empieza el problema: restaurar
otra vez *sustituye* lo que hubiera, y quien lo hace pierde lo que añadió desde la
última copia. Para eso está **«Combinar con otra copia…»**: suma a la caja
abierta lo que traiga otra copia **de esa misma caja**, y no quita nada.

Cómo funciona, y por qué no hace falta la contraseña de la copia:

- Dos copias de una misma caja comparten la clave de datos, así que el índice de
  una se abre con la clave de la otra. Eso es también lo que **demuestra que la
  copia es de la misma caja**: el índice de una caja ajena no se abre, y uno
  alterado falla la autenticación. Se rechazan las dos cosas.
- Un documento es **inmutable**: mismo identificador, mismo contenido. Los
  criptogramas que faltan se copian tal cual, sin recifrar, y **nunca se pisa
  uno que ya esté**. Primero se copian los documentos y solo después se guarda el
  índice, con la misma comprobación de revisión que cualquier guardado: si algo
  falla en medio quedan criptogramas sin dueño, que se pueden liberar, nunca una
  entrada que apunta a nada.
- Lo único que puede diferir entre copias es **dónde está** y **cómo se llama**
  un documento, que viven en el índice. Si se tocó en las dos, gana lo editado más
  tarde; el contenido no cambia.
- Una carpeta que solo está en la otra copia se añade, aunque esté vacía. Si su
  nombre ya lo usa otra carpeta de aquí, la que llega se distingue con «(copia)».
- Antes de aplicar se enseña exactamente qué va a entrar. Una copia incompleta
  —que menciona documentos que no trae— no añade entradas sin contenido.

**Lo que combinar no puede hacer: propagar borrados.** Un índice no guarda lo que
ya no está, así que lo que se borró en un dispositivo y sigue en la otra copia
**vuelve a aparecer** al combinarla. Es el precio de combinar sin servidor, y la
pantalla lo avisa. Si algo sensible se borra, hay que borrarlo en cada
dispositivo, y destruir las copias de seguridad viejas que lo contengan.

**Si cada persona quiere su caja,** con su contraseña, en vez de una compartida:
no se combinan; se pasan documentos concretos con un envío cifrado (ver
*Compartir*). Quien tiene la contraseña de una caja puede leerla entera: no hay
permisos por documento ni por persona.

**La contraseña,** si se cambia en un dispositivo, solo cambia en ese: reenvuelve
la clave de datos de esa copia y las demás siguen con la suya. Combinar no
necesita ninguna contraseña (la clave de datos es la misma), pero conviene
cambiarla en todos o se acaba con contraseñas distintas para la misma caja.

**Un ordenador de la familia es un lugar delicado:**

- Quien use ese navegador ve la pantalla de desbloqueo, y «He olvidado la
  contraseña» permite **borrar la caja de ese navegador** a cualquiera. No toca
  las demás copias, pero por eso conviene tener siempre una.
- Un documento **descargado** queda **sin cifrar** en la carpeta de descargas.
  «Ver» una imagen no escribe nada en el disco; «Descargar» sí.
- Hay navegadores configurados para borrar los datos del sitio al cerrarse: la
  caja desaparece. Si pasa, se restaura desde la copia.
- Lo prudente: un usuario o perfil de navegador solo para quien usa Arca, el
  bloqueo automático en pocos minutos y bloquear a mano al terminar.
- El **modo privado** borra todo al cerrar la ventana: no sirve para guardar, y
  solo valdría para consultar restaurando la copia cada vez.

**Compartir la aplicación** es dar la dirección web: no contiene ningún dato, y
cada navegador que la abre empieza vacío. En el iPhone conviene añadirla a la
pantalla de inicio, o Safari puede borrar los datos tras siete días sin abrirla.

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

## Arca frente a Cerbero: qué defensas tiene y cuáles no

**Arca no tiene todas las defensas de Cerbero, y ninguna de las dos es
«inexpugnable»**: esa palabra no describe nada real, y decirla sería mentir. Son
aplicaciones con amenazas distintas, y Arca tiene menos capas.

| Defensa | Cerbero | Arca |
| --- | :---: | :---: |
| Cifrado autenticado XChaCha20-Poly1305 | ✔ | ✔ |
| Contraseña → clave con Argon2id (coste a elegir) | ✔ | ✔ |
| Clave de datos aleatoria con envoltorio: cambiar la contraseña no recifra | ✔ | ✔ |
| Metadatos (nombres, tipos, carpetas) dentro del cifrado y relleno por cubos | ✔ | ✔ |
| Sin red: política de seguridad `connect-src 'none'` | ✔ | ✔ |
| Cifrado por trozos con datos autenticados (contra reordenar o recortar) | n/a | ✔ |
| Bloqueo automático por inactividad | — | ✔ |
| Quitar ubicación y datos del móvil de las fotos | n/a | ✔ |
| Segundo factor con llave de seguridad (WebAuthn PRF) | ✔ | — |
| Negación plausible: ranuras indistinguibles y bóvedas de coacción | ✔ | — |
| Tamaño fijo del fichero: no revela cuánto guardas | ✔ | — |
| Recuperación social (Shamir) y herencia con cerradura temporal | ✔ | — |
| Credenciales trampa que avisan si alguien entra | ✔ | n/a |
| Criptografía de clave pública post-cuántica (X-Wing, ML-DSA) | ✔ | n/a |
| Registro Merkle contra reversión del historial | parcial | — |
| Auditoría independiente | — | — |

**Lo que Arca sí protege tan bien como Cerbero** es lo principal: *el fichero que
alguien se lleve*. Los dos usan las mismas primitivas, y con una contraseña larga
y de azar atacar el fichero robado no es viable. Lo que decide ahí no es el
programa sino la contraseña.

**Sobre lo post-cuántico.** Arca no usa criptografía de clave pública, así que no
tiene el punto débil que protege X-Wing en Cerbero: nada de lo guardado se
cifra con una clave que un ordenador cuántico pudiera deducir de una pública. Con
claves simétricas de 256 bits, Grover las deja en unos 128 bits de seguridad,
que sigue siendo inalcanzable. El eslabón débil vuelve a ser la contraseña.

**Dónde Arca es más débil que Cerbero:**

- **Solo la contraseña.** Sin segundo factor, quien la consiga y tenga el
  fichero lo abre. Es la mejora de mayor valor que le falta (se puede añadir con
  la misma técnica que Cerbero, WebAuthn PRF).
- **Sin negación plausible.** Un fichero de tamaño variable y una caja visible no
  permiten decir «aquí no hay nada». Es una decisión de diseño: documentos de
  decenas de MiB y ranuras de tamaño fijo no pueden convivir.
- **Sin recuperación ni herencia.** Perder la contraseña sin copia es perder los
  documentos.
- **Compartir abre una puerta por diseño.** Un envío cifrado protege el camino y
  el sin cifrar no protege nada: ver la sección anterior.

**Dónde las dos son igual de débiles** (y es donde de verdad se pierden los
secretos):

- **Quien sirve el código.** Cada visita, el sitio entrega el código que
  descifra. Quien controle la cuenta de Netlify puede servir una versión
  modificada que se lleve la contraseña la próxima vez que se escriba, y la
  política de seguridad viaja en la misma respuesta, así que no lo impide.
  La defensa es protegerla: verificación en dos pasos en Netlify y pocos
  accesos. Cerbero tiene además la salida de abrir el fichero HTML descargado, sin
  conexión; Arca no, porque necesita una dirección estable para guardar datos.
- **El dispositivo.** Un móvil con malware, una extensión maliciosa o alguien
  con el móvil desbloqueado y Arca abierta no se frenan con criptografía. El
  bloqueo automático acota el último caso.
- **La contraseña.** Es el único punto donde la seguridad depende de una persona.
  Una frase de seis palabras al azar, o 16 caracteres aleatorios, y el perfil
  «Recomendado» o «Máxima protección» al crear la caja.
- **Que no se ha auditado.** Ninguna de las dos ha pasado una revisión
  independiente. El código es público y los tests son abundantes, pero eso no es
  lo mismo.

## Qué no cubre

- **No ha pasado una auditoría independiente.** Lo mismo que Cerbero.
- **Sin negación plausible.** El tamaño total delata cuánto guardas, y un
  atacante con acceso al navegador sabe que hay una caja. Por eso Arca no
  pretende ocultar su existencia, solo su contenido.
- **Sin recuperación.** Perder la contraseña y no tener copia es perder los
  documentos. Es el precio de que nadie más pueda abrirlos.
- **Un envío no se revoca.** Y quien lo abre puede guardarlo sin cifrar. Un
  envío con fichero y código por el mismo canal no protege nada. Un envío sin
  cifrar deja una copia en WhatsApp, el correo o donde se mande.
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
- **Los datos viven solo en el navegador**, y el navegador puede borrarlos. Arca
  pide almacenamiento persistente, pero no es una garantía; en Safari de iPhone,
  además, el sistema puede borrar los datos de una web que lleva siete días sin
  abrirse salvo que esté añadida a la pantalla de inicio. Lo único que cuenta como
  protección contra eso es la copia de seguridad: descárgala cada vez que añadas
  algo importante y guárdala fuera del móvil.
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
