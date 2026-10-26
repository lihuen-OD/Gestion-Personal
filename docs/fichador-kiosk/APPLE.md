# iPad / iPhone — fichador en modo kiosco

Estado: **sin validar en un dispositivo físico.** La infraestructura para probar en iPad quedó lista técnicamente, pero la prueba física se difirió ([FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md](../decisions/FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md) §6). Esta guía dice qué opciones existen y qué hay que comprobar. Se siguen los nombres de menú de la versión de iPadOS/iOS del equipo y la documentación oficial de Apple.

## Lo que ya resuelve la aplicación

Pairing, identidad del dispositivo, heartbeat y modo mantenimiento con código de RRHH (ver [README.md](README.md)). La guía de puesta en marcha del propio fichador ya recomienda instalarlo en la pantalla de inicio y menciona Acceso guiado.

## Opciones del sistema para no salir del fichador

| Opción | Qué es | Requisitos | Uso sugerido |
|---|---|---|---|
| **Acceso guiado** | Función de accesibilidad que deja una sola app en pantalla. Se activa y se termina con un código propio del equipo | Ninguno además del equipo. Se habilita en Ajustes → Accesibilidad | Piloto o pocos equipos, sin MDM |
| **Modo de app única** (Single App Mode) | Bloqueo administrado en una app, que se mantiene aunque el equipo se reinicie | Equipo **supervisado** con MDM (Apple Configurator o Apple Business Manager + MDM) | Despliegue real con varios equipos |

## Qué verificar en el equipo elegido

- [ ] **Instalación.** Desde Safari, Compartir → "Agregar a pantalla de inicio". Abrir siempre desde el ícono. **En iOS/iPadOS lo que se configura en Safari no pasa al ícono**: hay que configurar y aprobar el equipo desde el ícono instalado. El fichador ya lo advierte.
- [ ] **Pairing desde el ícono** y aprobación en Admin.
- [ ] **Acceso guiado sobre el ícono instalado:** comprobar que se puede iniciar con el fichador abierto desde el ícono, que impide el inicio y otras apps, y que sólo se sale con el código del equipo.
- [ ] **Modo de app única (si hay MDM):** confirmar si el MDM admite como destino una app web de la pantalla de inicio o sólo apps nativas (Safari incluido). Si no admite la app web, evaluar alternativas con el proveedor del MDM antes de decidir.
- [ ] **Cámara** con Acceso guiado activo: el permiso se pide una vez y la captura funciona.
- [ ] **Pantalla encendida:** Wake Lock con la sesión activa (iPadOS 16.4+) y el bloqueo automático del sistema configurado para el uso de kiosco.
- [ ] **Modo mantenimiento con Acceso guiado:** presionar 5 s el título abre el acceso, aunque la configuración de Acceso guiado restrinja áreas de la pantalla. **El título no puede quedar dentro de un área deshabilitada.**
- [ ] **Revocación** desde Admin con Acceso guiado activo: muestra "Dispositivo deshabilitado".
- [ ] **Segundo plano:** iOS suspende el JavaScript en segundo plano. Con Acceso guiado no debería pasar; confirmar que el heartbeat sigue y que Admin lo muestra "En línea".

## Salida del kiosco

La salida la controla **el sistema**: el código de Acceso guiado o el MDM, nunca el código de mantenimiento de la app. El código de Acceso guiado lo guarda quien administra los equipos y no se escribe en el equipo.
