# Android — fichador en modo kiosco

Estado: **sin validar en un dispositivo físico.** Esta guía dice qué opciones existen y qué hay que comprobar. No es un procedimiento probado. Los nombres de menú cambian según el fabricante y la versión: se siguen los del equipo elegido y la documentación oficial de Android o del EMM.

## Lo que ya resuelve la aplicación

Pairing, identidad del dispositivo, heartbeat y modo mantenimiento con código de RRHH (ver [README.md](README.md)). Nada de esto depende de la plataforma.

## Opciones del sistema para no salir del fichador

| Opción | Qué es | Requisitos | Uso sugerido |
|---|---|---|---|
| **Fijar app** (screen pinning) | Función del sistema que deja una sola app en pantalla hasta que alguien la desfija con un gesto. Puede pedir el PIN o patrón del equipo para desfijar | Ninguno además del equipo. Se activa en los ajustes de seguridad | Piloto o pocos equipos. Es una ayuda de uso: quien sepa el gesto y el PIN sale |
| **Lock task mode** (equipo dedicado) | Modo kiosco administrado: la app queda bloqueada en primer plano, sin barra de navegación ni notificaciones, y el equipo puede arrancar directamente en ella | Una app de administración (DPC) como *device owner*, en general mediante un EMM o Android Enterprise ("dispositivo dedicado"). Suele requerir aprovisionar el equipo desde cero | Despliegue real con varios equipos |

## Qué verificar en el equipo elegido

- [ ] **Instalación de la PWA.** Desde Chrome, "Instalar app" o "Agregar a la pantalla principal". Comprobar que abre sin barra del navegador y que el fichador muestra "Fichador instalado en este equipo" en la configuración inicial.
- [ ] **Pairing desde la app instalada** y aprobación en Admin. En Android la app instalada comparte el almacenamiento del navegador; confirmarlo en el equipo.
- [ ] **Fijar app:** fijar el fichador instalado, confirmar que no se puede ir al inicio ni a otras apps, y que para desfijar pide el PIN del equipo.
- [ ] **Lock task (si se usa EMM):** confirmar que el EMM admite una PWA o web app como app del kiosco (o sólo Chrome con una URL fija), que arranca sola al encender y cómo sale un administrador.
- [ ] **Cámara:** permiso concedido una vez y que se conserve en modo kiosco.
- [ ] **Pantalla encendida:** el fichador pide Wake Lock con la sesión activa. Revisar además las opciones del sistema para pantalla siempre encendida mientras carga.
- [ ] **Modo mantenimiento con el kiosco activo:** presionar 5 s el título abre el acceso; el panel funciona; "Recargar aplicación" no saca del kiosco.
- [ ] **Revocación** desde Admin con el equipo en kiosco: muestra "Dispositivo deshabilitado".
- [ ] **Corte de red** y vuelta: el fichador bloquea las fichadas sin conexión y se recupera solo.

## Salida del kiosco

La salida la controla **el sistema** (gesto + PIN, o la consola del EMM), nunca el código de mantenimiento de la app. El PIN o las credenciales del EMM los guarda quien administra los equipos y no se escriben en el equipo.
