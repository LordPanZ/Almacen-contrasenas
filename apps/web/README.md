# Interfaz de Cerbero

Aplicación web que corre **entera en el navegador**. No hay servidor: se sirve
como ficheros estáticos, así que no existe ninguna máquina que pudiera ver tus
secretos aunque quisiera.

```bash
pnpm --filter @cerbero/web dev            # desarrollo
pnpm --filter @cerbero/web build          # ficheros estáticos en dist/
pnpm --filter @cerbero/web build:suelto   # UN solo fichero: cerbero.html
```

## El fichero suelto

`build:suelto` produce `cerbero.html`: la aplicación entera —código, estilos,
trabajador criptográfico y tipografías— en un único fichero de unos 1,7 MiB que
se abre con doble clic, cabe en una memoria USB y **no hace ni una sola petición
a la red**. La compilación falla a propósito si queda alguna referencia externa,
para que nadie entregue como suelto algo que no lo es.

Encaja con el modelo de amenazas del proyecto: un almacén que presume de que
ningún servidor puede abrir tu bóveda lo demuestra mejor si además no hace falta
ningún servidor para usarlo.

**Lo que cambia al abrirlo desde el disco:** el navegador da a la página un
origen anónimo distinto en cada carga, así que no hay almacenamiento que
sobreviva a cerrar la pestaña. IndexedDB se abre sin error y la escritura parece
funcionar —un fallo silencioso con apariencia de éxito—, de modo que la
aplicación lo detecta por adelantado y lo avisa en pantalla: la bóveda solo vive
en esa pestaña, y hay que descargarla antes de cerrar.

## Cómo está montada

Toda la criptografía vive en un *web worker* (`boveda.worker.ts`), por dos
razones:

1. **Interfaz.** Derivar la clave maestra con Argon2id ocupa cientos de MiB y
   varios segundos. En el hilo principal congelaría la ventana entera.
2. **Seguridad.** La bóveda abierta, su clave de ranura y los secretos
   descifrados nunca entran en la memoria del hilo que pinta la interfaz. Lo que
   cruza la frontera son datos ya escogidos, y el secreto de una entrada solo
   cuando se pide explícitamente.

El fichero cifrado se guarda en IndexedDB por comodidad —es exactamente el mismo
fichero que habría en disco, sin nada descifrado—, pero limpiar los datos del
sitio lo borra. La copia de seguridad de verdad es la que descarga el usuario.

## Decisiones de interfaz

- **La espera de Argon2 se enseña, no se disimula.** Mientras deriva, la pantalla
  explica cuánta memoria está ocupando y por qué: ese coste es justo lo que le
  cuesta a un atacante cada intento contra el fichero robado.
- **La tira de ranuras** aparece en la portada y en la vista del fichero. Todas
  se dibujan idénticas, con el mismo barrido, porque así son: no se puede saber
  cuáles contienen una bóveda. Es la tesis del producto hecha imagen.
- **Nunca se muestra qué ranura abrió tu contraseña.** Si quien te coacciona
  viera "ranura 2" y supiera que la primera bóveda se coloca al azar, deduciría
  que hay otra.
