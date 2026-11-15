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

## Límites conocidos

- Los formatos antiguos binarios **.doc** y **.ppt** no son compatibles (guárdalos antes como .docx / .pptx).
- Word: al guardar se genera un .docx nuevo con el contenido. Se conservan texto, títulos, listas, tablas,
  imágenes y formato básico, pero los diseños complejos (columnas, encabezados/pies, cuadros flotantes) se simplifican.
- PowerPoint: el texto que no editas conserva su formato original. Si cambias un párrafo, este toma el formato
  de su primera palabra. Las formas complejas, gráficos y animaciones se muestran de forma aproximada,
  pero se conservan intactos en el archivo.
- Excel: las fórmulas que la app no conoce se guardan tal cual y Excel las recalcula al abrir.
  El formato de celdas (colores, bordes) se puede perder al guardar.
- PDF: no se edita el texto original del PDF; se agregan textos y dibujos encima.

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
