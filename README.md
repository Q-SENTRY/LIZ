# Folio

Una app para el celular para **leer y editar PDF, Excel, Word y PowerPoint**.
Es una PWA (app web instalable): funciona en Android y iPhone, se instala desde el navegador
y funciona **sin conexión**. Los archivos se procesan solo en el teléfono; nunca se suben a internet.

## Qué puede hacer

| Formato | Leer | Editar |
|---|---|---|
| **PDF** (.pdf) | Ver todas las páginas, zoom | Escribir texto, dibujar o firmar con el lápiz, resaltar, borrar anotaciones, girar y eliminar páginas |
| **Excel** (.xlsx, .xls, .csv, .ods) | Hojas, celdas y valores con formato | Editar celdas, fórmulas (SUMA/SUM, PROMEDIO/AVERAGE, MIN, MAX, CONTAR, SI, REDONDEAR…) que se recalculan al momento, autosuma, agregar, renombrar y eliminar hojas. Guarda como .xlsx, .csv u .ods |
| **Word** (.docx, .txt) | Texto, títulos, listas, tablas e imágenes | Negrita, cursiva, subrayado, tachado, tamaño y color, resaltado, títulos, viñetas y numeración, alineación, insertar imágenes, tablas y enlaces. Guarda como .docx, .txt o .html |
| **PowerPoint** (.pptx) | Diapositivas con fondos, imágenes, tablas y formato del texto | Editar el texto en su lugar, agregar, mover y eliminar cuadros de texto, duplicar y eliminar diapositivas, modo presentación a pantalla completa |

También puedes **crear** documentos, hojas de cálculo y presentaciones nuevas, **compartir** el archivo
(WhatsApp, correo, Drive…) con el botón ⤴, y volver a abrir los **archivos recientes**.

## Cómo instalarla en el celular

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

- Los formatos antiguos binarios **.doc** y **.ppt** no son compatibles (guárdalos antes como .docx / .pptx).
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
