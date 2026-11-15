# Folio

Una app para el celular para **leer y editar PDF, Excel, Word y PowerPoint**.
Es una PWA (app web instalable): funciona en Android y iPhone, se instala desde el navegador
y funciona **sin conexión**. Los archivos se procesan solo en el teléfono; nunca se suben a internet.

## Qué puede hacer

| Formato | Leer | Editar |
|---|---|---|
| **PDF** (.pdf) | Ver todas las páginas, zoom | Texto (tamaño, negrita, color), lápiz y resaltador, formas (rectángulo, círculo, línea, flecha), **corrector** para tapar texto, **imágenes** y **firma** dibujada con el dedo. Todo se puede **seleccionar, mover, cambiar de tamaño, duplicar o eliminar**. **Deshacer y rehacer** cualquier cambio (también girar o eliminar páginas). |
| **Excel** (.xlsx, .xls, .csv, .ods) | Hojas, celdas y valores con formato | Editar celdas, fórmulas (SUMA/SUM, PROMEDIO/AVERAGE, MIN, MAX, CONTAR, SI, REDONDEAR…) que se recalculan al momento, autosuma, agregar, renombrar y eliminar hojas. Guarda como .xlsx, .csv u .ods |
| **Word** (.docx, .txt) | Texto, títulos, listas, tablas e imágenes | Negrita, cursiva, subrayado, tachado, tamaño y color, resaltado, títulos, viñetas y numeración, alineación, insertar imágenes, tablas y enlaces. Guarda como .docx, .txt o .html |
| **PowerPoint** (.pptx) | Diapositivas con fondos, imágenes, tablas y formato del texto | Editar el texto en su lugar, agregar, mover y eliminar cuadros de texto, duplicar y eliminar diapositivas, modo presentación a pantalla completa |

También puedes **crear** documentos, hojas de cálculo y presentaciones nuevas, **compartir** el archivo
(WhatsApp, correo, Drive…) con el botón ⤴, y volver a abrir los **archivos recientes**.

## App para Android (APK)

El archivo listo para instalar está en **`dist/Folio.apk`** (Android 7 o superior).

**Instalarlo en el celular:**
1. Descarga `Folio.apk` en el teléfono.
2. Ábrelo desde *Descargas*. Si Android lo pide, permite *Instalar apps desconocidas* para tu navegador o gestor de archivos.
3. Toca *Instalar*. Aparecerá **Folio** en tus apps.

La app funciona sin internet. Además de lo que hace la versión web:
- **Guardar** deja el archivo en *Descargas › Folio*.
- **Compartir** abre el menú de Android (WhatsApp, Gmail, Drive…).
- En cualquier app puedes elegir **Abrir con › Folio** o **Compartir › Folio** para un PDF, Word, Excel o PowerPoint.

**Volver a compilar el APK** (Ubuntu/Debian, sin Android Studio):

```bash
sudo apt-get install -y openjdk-17-jdk android-sdk-platform-23 aapt zipalign apksigner dalvik-exchange
./android/build-apk.sh        # genera dist/Folio.apk
```

El APK se firma con la llave `android/folio-release.jks`, que **no se guarda en el repositorio** por seguridad
(si no existe, el script crea una nueva). Para que una versión nueva se instale encima de la anterior hay que
firmarla con la misma llave; con una llave distinta, primero hay que desinstalar la versión anterior.

## Usarla como app web (sin APK)

1. Publica esta carpeta en cualquier hosting estático con HTTPS. La forma más fácil es **GitHub Pages**:
   en el repositorio ve a *Settings → Pages*, elige la rama y la carpeta `/ (root)` y guarda.
2. Abre la dirección en el celular:
   - **Android (Chrome):** menú ⋮ → *Instalar app* (o *Agregar a la pantalla principal*).
   - **iPhone (Safari):** botón Compartir → *Agregar a inicio*.
3. Listo: aparece el ícono de **Folio** y funciona sin internet.

Para probarla en la computadora:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Formatos que abre

| Tipo | Extensiones |
|---|---|
| PDF | .pdf |
| Documentos | .docx .docm .dotx .dotm · **.doc** (texto) · .odt .ott · .rtf · .md · .html .htm · .txt y archivos de texto/código (.json .xml .csv .log .py .js…) |
| Hojas de cálculo | .xlsx .xlsm .xlsb .xls .xltx .ods .fods .csv .tsv **.numbers** .dif .slk .dbf .wk1–.wk4 .qpw .et |
| Presentaciones | .pptx .pptm .ppsx .potx · **.ppt** y .odp (texto e imágenes de cada diapositiva) |
| Imágenes | .jpg .png .webp .gif .bmp .svg (se abren como PDF para anotarlas) |

## Editar un PDF

1. **Seleccionar** (✥): toca un elemento para moverlo; el punto azul cambia su tamaño. La barra que aparece permite
   **Editar** (textos), **Duplicar**, traer al frente o **Eliminar**. Doble toque sobre un texto para editarlo.
2. **Texto**: toca donde quieras escribir. **Formas**: elige rectángulo, círculo, línea, flecha o **corrector**
   (un recuadro blanco para tapar algo y escribir encima). **Imagen**: inserta una foto o logo. **Firma**: dibuja tu
   firma; queda guardada para reutilizarla.
3. **↶ Deshacer / ↷ Rehacer** en la barra (o Ctrl+Z / Ctrl+Y). Funciona con todo: añadir, mover, cambiar tamaño,
   borrar, girar y eliminar páginas.
4. Con **Ver** (flecha) desplazas el documento; en **Seleccionar** también puedes desplazarlo tocando fuera de los elementos.

## Quitar páginas y unir PDF

- **Organizar páginas** (botón *Páginas* en la barra del PDF, o menú ⋯): cuadrícula con todas las páginas. Toca para
  seleccionar una o varias y elige **Eliminar**, **Girar**, mover **Antes/Después**, **Mover a…** una posición,
  **Extraer** (guarda solo esas páginas como un PDF nuevo) o **Añadir PDF** (inserta otro PDF o imágenes después de
  la selección). Todo se puede deshacer.
- Cada página también tiene sus botones **Girar** y **Eliminar** debajo.
- **Unir PDF** (pantalla de inicio): elige varios PDF o imágenes, ordénalos y se abren como un solo documento listo
  para guardar. También puedes usar ⋯ › *Añadir otro PDF al final* en un PDF abierto.
- Al quitar o reordenar páginas se crea un PDF nuevo que copia solo lo necesario, así el archivo pesa menos.
  Si no cambias páginas, se conserva el PDF original (marcadores, formularios y metadatos).

## Zoom

- **Pellizca con dos dedos** para acercar o alejar en PDF, presentaciones, documentos y hojas de cálculo. En documentos
  el texto se agranda y se reacomoda al ancho de la pantalla (sin desplazamiento horizontal).
- En computadora: **Ctrl + rueda** del ratón o pellizco en el trackpad. También están los botones − / + en la barra.

## Navegar, imprimir y exportar a PDF

- Indicador **«página X de N»** abajo en PDF, presentaciones y documentos (en documentos es aproximado, como hoja Carta).
  Tócalo para **ir a una página** escribiendo el número o eligiendo una **miniatura**; en documentos también aparece
  el **índice de títulos**. En tablet y computadora las miniaturas se muestran en un panel lateral.
- En Excel, toca la referencia de celda (A1) para **ir a una celda**, también en otra hoja (`Hoja2!B10`).
- Menú **⋯ › Imprimir** o **Exportar como PDF**. Se abre el diálogo de impresión del sistema, donde puedes elegir
  una impresora o **«Guardar como PDF»** (Android, iPhone y computadora). El PDF conserva el tamaño original de cada
  página; las presentaciones salen una diapositiva por hoja.
- Atajos con teclado: Ctrl+S guardar, Ctrl+P imprimir, Ctrl+G ir a página.

## Compatibilidad verificada

Cada formato se probó abriendo, editando y exportando archivos complejos (creados con Office y con LibreOffice),
y verificando el resultado con LibreOffice y con lectores independientes:

- **PDF:** páginas verticales, horizontales y giradas; imágenes; PDF con contraseña. Las anotaciones de texto
  se exportan con la orientación correcta también en páginas giradas.
- **Excel:** .xlsx, .xls, .ods y .csv con acentos; varias hojas; fechas, porcentajes y formatos numéricos;
  celdas combinadas; 5 000 filas; fórmulas entre hojas (`'Hoja'!A1`). Las fórmulas se pueden escribir en español
  o inglés (SUMA, PROMEDIO, SI, SI.ERROR, BUSCARV, SUMAR.SI, CONTAR.SI, INDICE, COINCIDIR, IZQUIERDA, FECHA…)
  y se guardan en el formato que entiende Excel. Al abrir, la app comprueba sus cálculos contra los valores
  guardados por Excel; si alguna fórmula no la puede reproducir, la deja intacta y el archivo exportado pide a Excel
  que la recalcule.
- **Word:** títulos, colores, tamaños, fuentes, resaltado, alineación, listas, tablas combinadas, imágenes PNG/JPG.
  Al guardar se reutiliza el archivo original, así que **se conservan encabezados, pies de página, márgenes,
  tamaño de página y estilos**.
- **PowerPoint:** temas, fondos, imágenes, grupos, tablas, formas, viñetas por nivel y **gráficos** (barras,
  líneas, áreas, circulares). Duplicar una diapositiva copia también sus gráficos.

## Límites conocidos

- De los formatos antiguos **.doc** y **.ppt** se recupera el texto (y las tablas en .doc), no el diseño.
- Word: los cuadros de texto flotantes, columnas y saltos de página manuales se simplifican al guardar.
- PowerPoint: si cambias un párrafo, toma el formato de su primera palabra. Las animaciones y SmartArt no se
  muestran, pero se conservan intactos en el archivo.
- Excel: el formato visual de las celdas (colores, bordes) puede perderse al guardar.
- PDF: no se edita el texto original; se agregan textos y dibujos encima. Un PDF con contraseña se guarda como
  copia sin contraseña con las páginas como imagen.

## Tipografía

La interfaz usa **Inter** y **Manrope** (licencia SIL Open Font License), incluidas en `fonts/`
para que la app se vea igual en todos los teléfonos y funcione sin conexión.

## Estructura

```
index.html            Pantalla de inicio y editor
css/app.css           Estilos (modo claro y oscuro)
js/ui.js              Diálogos, avisos, descargas, recientes
js/app.js             Abrir, guardar y compartir archivos
js/pdf-editor.js      Visor y anotaciones de PDF (pdf.js + pdf-lib)
js/excel-editor.js    Hojas de cálculo y fórmulas (SheetJS)
js/word-editor.js     Editor de documentos (mammoth + generador .docx propio)
js/ppt-editor.js      Editor de presentaciones (lector .pptx propio con JSZip)
sw.js                 Modo sin conexión
vendor/               Librerías de terceros incluidas (licencias MIT / Apache-2.0)
```
