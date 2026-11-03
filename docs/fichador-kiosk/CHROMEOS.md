# ChromeOS — fichador en modo kiosco

Estado: **sin validar en un dispositivo físico.** Esta guía dice qué opción existe y qué hay que comprobar. Se siguen los nombres de la consola de administración de Google vigentes y su documentación oficial.

## Lo que ya resuelve la aplicación

Pairing, identidad del dispositivo, heartbeat y modo mantenimiento con código de RRHH (ver [README.md](README.md)).

## Opción del sistema

| Opción | Qué es | Requisitos | Uso sugerido |
|---|---|---|---|
| **Modo kiosco de ChromeOS** | El equipo arranca directamente en una sola app web a pantalla completa, sin escritorio ni otras apps | Equipo ChromeOS **administrado**: inscripción en el dominio y la licencia de administración correspondiente (Chrome Enterprise o Education). Se configura en la consola de administración de Google | Despliegue real |

## Qué verificar en el equipo elegido

- [ ] **Licencia e inscripción** del equipo en la consola de administración.
- [ ] **Configurar el fichador como app de kiosco** con su URL HTTPS de producción o staging, según la etapa. Confirmar si la consola instala la PWA o abre la URL como app web de kiosco, y si el IndexedDB (la vinculación del equipo) **persiste entre reinicios** del kiosco. Sin persistencia, el equipo pediría pairing en cada arranque, y eso bloquea la adopción.
- [ ] **Autoarranque** al encender, sin pasar por la pantalla de inicio de sesión.
- [ ] **Pairing** desde el kiosco y aprobación en Admin.
- [ ] **Permiso de cámara:** definirlo por política para el origen del fichador, de modo que no lo pida en cada arranque.
- [ ] **Pantalla encendida:** las políticas de energía del kiosco, además del Wake Lock del fichador.
- [ ] **Modo mantenimiento en kiosco:** presionar 5 s el título abre el acceso, con mouse, touchpad o pantalla táctil. "Recargar aplicación" no saca del kiosco.
- [ ] **Revocación** desde Admin con el kiosco activo: muestra "Dispositivo deshabilitado".

## Salida del kiosco

La salida y la configuración las controla **la consola de administración**, nunca el código de mantenimiento de la app.
