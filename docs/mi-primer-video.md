# Mi primer video

Guía de cinco minutos. No necesitas IA ni conexión a Internet.

## 1. Abre la app

1. En PowerShell, dentro de la carpeta del proyecto, ejecuta `npm run dev:web`.
2. En Chrome o Edge, abre **http://127.0.0.1:5173**.

## 2. Carga el ejemplo

1. Pulsa **Probar con material de ejemplo**.
2. Se abre un montaje de 8,5 s: dos clips con una disolución, música de fondo, un título animado y dos subtítulos.
3. Pulsa **Espacio** para reproducir. Cada destello blanco coincide con un pitido.

## 3. Edita

| Quieres | Haz esto |
|---|---|
| Mover el cabezal | Haz clic en la regla de tiempo, sobre la línea de tiempo. |
| Cortar un clip | Coloca el cabezal y pulsa **S**. |
| Acortar un clip | Arrastra su borde izquierdo o derecho. |
| Mover un clip | Arrástralo. Con el ajuste magnético activo (**N**), se pega a bordes y al cabezal. |
| Deshacer o rehacer | **Ctrl + Z** o **Ctrl + Y**. Un arrastre completo cuenta como un solo paso. |
| Cambiar color | Selecciona el clip. En el panel derecho, sección **Color**, mueve los controles o elige una **LUT 3D**. |
| Cambiar velocidad | Sección **Velocidad**: constante o con curva. |
| Ajustar volumen | Sección **Audio del clip**: volumen, fundidos y puerta de ruido. |
| Agregar un título | Pestaña **Texto**, a la izquierda. |
| Agregar subtítulos | Pestaña **Subtítulos**: crea uno en el cabezal o importa un SRT o VTT. |
| Alargar un clip sin IA | Selecciona el clip y pulsa **Extender…**. Elige **Ralentizar** o **Bucle inteligente**. |

La lista completa de atajos está en **Atajos**, arriba a la derecha.

## 4. Exporta

1. Pulsa **Exportar**, arriba a la derecha.
2. Elige **MP4 (H.264 + AAC)** y **720p**.
3. Revisa el recuadro **Ruta detectada en este navegador**. Indica qué codificador se usará.
4. Pulsa **Exportar MP4**. Verás la fase real: mezcla de audio, codificación de video y unión.
5. Al terminar, pulsa **Descargar**. El archivo queda en tu carpeta de descargas.

Con el ejemplo, la exportación tarda unos segundos.

## 5. Usa tus propios archivos

1. Vuelve al inicio con el botón de la casa, arriba a la izquierda.
2. Pulsa **Importar para editar** y elige tus videos, audios o imágenes. La app los coloca en orden en la línea de tiempo.
3. Edita y exporta como antes.

El proyecto se guarda solo en este navegador. Si cierras la pestaña, al volver aparece **Recuperar sesión**.

Para pasar el proyecto a otro equipo, pulsa **Copia portátil**. Descarga un .zip con el proyecto y sus medios, sin claves. En el otro equipo, usa **Abrir proyecto (.zip)**.

## 6. Genera con IA (opcional)

1. Inicia la app con `npm run dev`, que también arranca el puente de IA.
2. Pulsa **IA** y pega tu clave de Alibaba Cloud Model Studio.
3. Lee la sección «Política de gasto» del [README](../README.md#conectar-la-ia-opcional). En «Solo cuota gratuita» la app no envía nada facturable.
4. Pestaña **Generar**: escribe el prompt, elige modelo, resolución, proporción y duración. Revisa el recuadro **Antes de enviar** y pulsa **Generar video**.
5. Al terminar, el video se descarga solo a la biblioteca. Pulsa **Llevar a la línea de tiempo**.

Si algo falla, el prompt y el montaje se conservan. Un envío incierto no se repite solo.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| «npm no se reconoce» | Cierra y abre PowerShell después de instalar Node.js. |
| La página no carga | Comprueba que PowerShell muestre «VITE … ready». Usa 127.0.0.1, no «localhost», si tu antivirus bloquea IPv6. |
| «El puente local de IA no responde» | Inicia con `npm run dev`, no con `npm run dev:web`. |
| «Este navegador no puede decodificar…» | Usa Chrome o Edge actualizados, o convierte el archivo a MP4 H.264. |
| «No hay espacio local suficiente» | El archivo sigue disponible en esta sesión. Libera espacio o descarga una copia portátil. |
