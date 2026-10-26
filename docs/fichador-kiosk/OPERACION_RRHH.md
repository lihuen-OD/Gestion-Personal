# Operación de RRHH — modo mantenimiento del fichador

Para quién: RRHH con acceso Nivel 1 a Gestión Personal. Para qué: revisar o reconfigurar un fichador sin dejar controles a la vista de quienes fichan.

## 1. Generar el código

1. En **Admin → Configuración → Dispositivos de fichada**, buscar el equipo. Tiene que estar **Activo**.
2. En la columna Acciones, tocar el ícono de llave, **"Generar acceso de mantenimiento"**.
3. Se muestra un código de 6 dígitos y su cuenta regresiva.
   - Vale **5 minutos**, sirve **una sola vez** y **sólo en ese equipo**.
   - "Generar nuevo código" invalida el anterior.
   - Al cerrar el aviso, el código ya no se puede volver a ver.

El código no se manda por chat ni por correo: se dicta o se escribe en el equipo. Si se filtra, generar uno nuevo lo anula.

## 2. Entrar al modo mantenimiento en el equipo

1. En el fichador, **mantener presionado el título "Fichador de personal" durante 5 segundos**, sin mover el dedo. Funciona con el kiosco libre, sin cámara abierta ni fichada en curso.
2. Aparece **"Acceso de mantenimiento"**. Escribir el código y tocar **Ingresar**.
3. Mensajes posibles:
   - "El código no es válido o ya venció.": código mal escrito, vencido, ya usado o de otro equipo. Revisar o generar uno nuevo.
   - "No se pudo verificar el acceso. Revisá la conexión.": el equipo no llega al servidor.
   - "Hay demasiados intentos…": esperar unos minutos. **5 intentos fallidos anulan el código**; generar otro.
4. Si nadie escribe nada durante 60 segundos, el acceso se cierra solo y vuelve el fichador.

## 3. En el modo mantenimiento

Mientras está abierto **no se puede fichar**. Se cierra solo a los **10 minutos** (la cuenta regresiva está arriba a la derecha).

**Qué muestra:**

| Sección | Datos |
|---|---|
| Dispositivo | Nombre, estado, establecimiento, conexión, última conexión registrada, versión informada y fecha de aprobación |
| Aplicación | Versión, Internet, modo de uso (instalada o en el navegador) y última verificación con el servidor |

**Acciones:**

- **Volver al fichador:** cierra el modo mantenimiento.
- **Recargar aplicación:** útil después de una actualización o si algo se ve mal.
- **Reconfigurar dispositivo:** ver §4.

## 4. Reconfigurar un equipo

Sirve para volver a vincular un equipo, por ejemplo después de un problema con la vinculación guardada.

1. En el modo mantenimiento, **Reconfigurar dispositivo**.
2. Leer el aviso: *"Este dispositivo dejará de estar vinculado y deberá aprobarse nuevamente desde RRHH."*
3. Escribir **RECONFIGURAR** y confirmar.
4. El equipo vuelve a "Configurar este dispositivo".
   - **No se borran** fichadas, fotos, historial ni auditoría.
   - **No se revoca** nada en el servidor.
5. En Admin:
   - aprobar el equipo nuevo con su código de vinculación (botón "Aprobar dispositivo");
   - **revocar el registro anterior**, que va a seguir como "Activo · Sin conexión" hasta que RRHH lo revoque.

## 5. Revocar un equipo

Sólo desde Admin (ícono de escudo, "Revocar"). El equipo queda bloqueado en su próxima comunicación, también si está en modo mantenimiento, y se corta cualquier acceso de mantenimiento pendiente. Revocar es definitivo: para volver a usar el equipo hay que configurarlo como nuevo.

## 6. Lo que el modo mantenimiento no hace

- No saca al equipo del modo kiosco del sistema operativo (ver [README.md](README.md)): eso pide el código o la administración **del sistema**.
- No revoca dispositivos, no borra datos del servidor y no cambia el establecimiento. Eso se hace en Admin.
- No muestra ni guarda contraseñas o códigos permanentes.

## 7. Auditoría

En **Auditoría** quedan, como "Mantenimiento de dispositivo de fichada":

- la generación de cada código, con la persona de RRHH que lo generó;
- cada ingreso al modo mantenimiento, con el dispositivo como actor;
- los códigos rechazados mientras había uno vigente, y la anulación por exceso de intentos.

El código en sí nunca aparece en la auditoría.
