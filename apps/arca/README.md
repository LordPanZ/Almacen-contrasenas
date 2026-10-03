# Arca

Aplicación web para guardar **documentos** cifrados: DNI, escrituras, seguros,
PDF y fotos. Corre **entera en el navegador**; no hay servidor.

Es independiente de Cerbero (el gestor de contraseñas): otra contraseña, otro
formato, otra dirección web. Cómo funciona por dentro, qué cifra y qué no cubre:
[docs/ARCA.md](../../docs/ARCA.md).

```bash
pnpm --filter @cerbero/arca-web dev            # desarrollo
pnpm --filter @cerbero/arca-web build:suelto   # UN solo fichero: arca.html
pnpm run construir:arca                         # lo prepara para publicar (dist-sitio/)
```

## Qué hace

- **Carpetas.** La caja se organiza en carpetas y cada documento está dentro de
  la suya. Nacen nueve (Identidad, Vivienda, Vehículo…) y puedes **crear las
  tuyas**, renombrarlas y borrarlas —borrar una carpeta mueve sus documentos a
  otra, nunca los pierde—. También se crean al vuelo al añadir un documento.
- **Añadir** uno o varios archivos a la vez, o hacer una foto con la cámara, y
  elegir su carpeta (por defecto, la que tienes abierta). Hasta 50 MiB cada uno,
  de cualquier tipo.
- Las **fotos pierden el EXIF** (ubicación GPS, modelo del móvil, hora) al
  guardarse; una casilla lo permite desactivar.
- **Buscar** por nombre, carpeta o notas, atravesando todas las carpetas.
- **Ver** las imágenes con zoom; **descargar** cualquier documento descifrado.
- **Renombrar**, mover de carpeta y anotar. **Borrar** con confirmación.
- **Compartir** uno o varios documentos: como **envío cifrado** con un código
  (fichero y código, por canales distintos; quien lo recibe lo abre sin
  necesitar caja) o **sin cifrar** por la hoja de compartir del sistema. Ver
  los límites en [docs/ARCA.md](../../docs/ARCA.md#compartir).
- **Abrir un envío** que te han mandado, desde la portada o con la caja abierta
  (y entonces guardarlo en una carpeta).
- **Copia de seguridad** de toda la caja en un solo fichero `.arca`, y
  restauración validada antes de escribir nada.
- **Cambiar la contraseña** sin recifrar los documentos.
- **Bloqueo automático** por inactividad.

## Cómo está montada

Toda la criptografía y el acceso a IndexedDB viven en un *web worker*
(`arca.worker.ts`). Es el único que ve las claves: la interfaz nunca recibe la
clave de datos ni un criptograma, y el Argon2 de desbloquear no congela la
pantalla. Los archivos viajan al trabajador *transferidos*, no copiados.

El núcleo está en [`@cerbero/arca`](../../packages/arca) y no depende de ninguna
interfaz: se prueba entero con `vitest`.

## Solo funciona desde su dirección web

Abierta como fichero del disco el navegador da a la página un origen anónimo
distinto en cada carga y no guarda nada entre sesiones; Arca lo detecta y lo
dice. Sirve el fichero suelto desde una dirección https.
