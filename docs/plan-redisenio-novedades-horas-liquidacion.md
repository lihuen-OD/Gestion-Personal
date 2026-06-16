# Plan de redisenio: Novedades, horas especiales, carga horaria y exportacion a Finnegans

## 1. Objetivo

Redefinir desde cero el funcionamiento de novedades, conceptos horarios y liquidacion para que la app sea mas clara y mas facil de conectar luego con backend y Finnegans.

La idea principal es:

- La carga horaria se hace por persona y por dia.
- En esa carga se pueden registrar horas normales, horas especiales y novedades.
- Las novedades pueden ser internas, de Finnegans o ambas.
- Liquidacion no deberia tener una logica compleja propia: deberia tomar las novedades y horas del periodo y preparar la exportacion mensual a Finnegans.

## 2. Problema actual

Hoy existen tres ideas separadas que se pisan entre si:

- Tipos de novedades.
- Conceptos horarios.
- Configuracion de liquidacion.

El problema es que no queda claro:

- Si una novedad se carga desde el modulo Novedades o desde Carga de horas.
- Si un concepto horario es una novedad o una hora especial.
- Que se exporta realmente a Finnegans.
- Como una novedad afecta la jornada de una persona.
- Como se cargan casos como vacaciones, enfermedad, sereno, manejo de colectivo o llegada tarde.

Por eso conviene redefinir la estructura.

## 3. Nuevo modelo funcional

### 3.1. Catalogo de novedades

Este modulo define las novedades posibles del sistema.

Una novedad es un evento que puede ocurrirle a una persona en un periodo o dia determinado.

Ejemplos:

- Vacaciones.
- Enfermedad.
- Llegada tarde.
- Ausente sin aviso.
- Suspension.
- Accidente laboral.
- Franco compensatorio.

No son novedades:

- Sereno.
- Guardia.
- Manejo de colectivo.
- Horas extra.
- Nocturna.
- Feriado trabajado.

Esos casos son horas especiales. Se cargan dentro de la carga horaria como horas trabajadas con un concepto distinto.

Cada novedad debe tener:

- Codigo interno.
- Nombre interno.
- Tipo de novedad:
  - Interna.
  - Finnegans.
  - Interna vinculada a Finnegans.
- Categoria:
  - Ausencia.
  - Licencia.
  - Horaria.
  - Vacaciones.
  - Accidente.
  - Sancion.
  - Otro.
- Estado:
  - Activa.
  - Inactiva.
- Si se puede cargar:
  - Por dia completo.
  - Por rango de fechas.
  - Por cantidad de horas.
  - Por varias personas.
- Si requiere:
  - Aprobacion.
  - Documentacion.
  - Observacion obligatoria.
- Si impacta en:
  - Carga horaria.
  - Liquidacion.
  - Finnegans.
  - Dashboard / ausentismo.
  - Historial del legajo.

### 3.2. Novedades internas y novedades Finnegans

No deberian ser modulos separados, sino dos formas de clasificar una misma novedad.

Una novedad puede ser:

#### Interna

Existe solo dentro de la app.

Ejemplos:

- Llegada tarde.
- Aviso interno.
- Cambio operativo.
- Observacion horaria.

Puede impactar horas o liquidacion, pero no necesariamente se exporta a Finnegans.

#### Finnegans

Existe en Finnegans y se exporta.

Ejemplos:

- Vacaciones.
- Enfermedad.
- Accidente laboral.
- Suspension.

Tiene codigo o concepto equivalente en Finnegans.

#### Interna vinculada a Finnegans

La app la maneja con un nombre interno, pero al exportar se traduce a una novedad de Finnegans.

Ejemplo:

- Interna: Enfermedad con certificado.
- Finnegans: LIC_ENF.

## 4. Catalogo de horas especiales

El modulo actual `Conceptos horarios` conviene renombrarlo a:

**Horas especiales**

Este modulo no deberia manejar ausencias ni licencias. Solo deberia definir tipos de horas cargables en una jornada.

Ejemplos:

- Hora normal.
- Hora extra 50%.
- Hora extra 100%.
- Feriado trabajado.
- Nocturna.
- Sereno.
- Guardia.
- Manejo de colectivo.

Cada hora especial debe tener:

- Codigo interno.
- Nombre.
- Tipo:
  - Normal.
  - Extra.
  - Nocturna.
  - Guardia.
  - Sereno.
  - Transporte.
  - Feriado.
  - Otro.
- Si suma como hora trabajada.
- Si impacta liquidacion.
- Si tiene equivalencia Finnegans.
- Codigo Finnegans, si aplica.
- Estado.

Este catalogo alimenta:

- Las horas habilitadas del legajo.
- La carga diaria de horas.
- La exportacion mensual, si corresponde.

Importante:

Una hora especial no es una novedad. Es una hora trabajada clasificada con un concepto distinto.

Una persona puede tener en el mismo dia:

- Horas normales.
- Horas especiales.
- Una novedad.

Ejemplo:

- 8 hs normales.
- 2 hs manejo de colectivo.
- Novedad: llegada tarde, si corresponde.

Cada cosa se registra separada para que despues liquidacion pueda leer correctamente el detalle.

## 5. Legajo y horas habilitadas

En cada legajo ya existe la idea de horas especiales habilitadas.

Eso deberia mantenerse, pero conectado al modulo Horas especiales.

Ejemplo:

Legajo Juan Perez:

- Hora normal.
- Manejo de colectivo.
- Guardia.

Entonces, al cargar horas para Juan Perez, solo deberian aparecer esas opciones.

Esto evita que cualquier persona cargue cualquier concepto.

## 6. Carga de horas

La carga de horas deberia ser el lugar operativo principal.

Cuando entro a cargar horas de una persona, deberia poder:

1. Seleccionar el dia o rango.
2. Cargar horas normales.
3. Cargar horas especiales habilitadas para ese legajo.
4. Cargar novedades para esa persona.
5. Ver el impacto final del dia.

La pantalla no deberia mezclar los conceptos:

- Las horas normales y especiales son horas trabajadas.
- Las novedades son eventos o situaciones del dia/rango.
- La liquidacion toma ambos mundos, pero no son lo mismo.

### 6.1. Ejemplo: manejo de colectivo

Persona: Juan Perez.

Dia: 10/06/2026.

Carga:

- Hora normal: 8 hs.
- Manejo de colectivo: 2 hs.

Resultado:

- Horas trabajadas: 10 hs.
- Horas normales: 8 hs.
- Horas especiales: 2 hs.
- Liquidacion: se exporta o liquida segun regla del concepto Manejo de colectivo.
- No se genera novedad, salvo que ademas exista una novedad real ese dia.

### 6.2. Ejemplo: vacaciones

Persona: Juan Perez.

Novedad:

- Vacaciones.
- Desde: 10/06/2026.
- Hasta: 20/06/2026.

Resultado:

- Se registran dias de vacaciones para esa persona.
- No se cargan horas normales manuales en esos dias, salvo que la empresa quiera permitir excepciones.
- Para liquidacion, esos dias suman como novedad vacaciones.
- A Finnegans se exporta: persona + novedad vacaciones + rango de fechas.

### 6.3. Ejemplo: llegada tarde

Persona: Juan Perez.

Dia: 10/06/2026.

Carga:

- Hora normal: 7 hs.
- Novedad: llegada tarde, 1 h.

Resultado:

- Horas trabajadas: 7 hs.
- Novedad interna: llegada tarde.
- Liquidacion: descuenta 1 h si la regla lo indica.
- Finnegans: solo se exporta si esta novedad tiene vinculacion Finnegans.

### 6.4. Ejemplo: enfermedad

Persona: Juan Perez.

Novedad:

- Enfermedad.
- Desde: 10/06/2026.
- Hasta: 12/06/2026.
- Documento: certificado medico.

Resultado:

- Se registra ausencia justificada.
- Puede bloquear la carga normal de horas del dia.
- Puede sumar como dia justificado para liquidacion.
- Se exporta a Finnegans como novedad enfermedad.

## 7. Modulo Novedades

El modulo Novedades deberia servir para:

- Consultar novedades cargadas.
- Crear novedades para una o varias personas.
- Aprobar novedades pendientes.
- Adjuntar documentacion.
- Ver que novedades se exportaran a Finnegans.

### 7.1. Crear novedad para varias personas

Debe permitir seleccionar:

- Una persona.
- Varias personas.
- Todas las personas filtradas por empresa, sector, centro de costo o responsable.

Ejemplo:

Novedad: Vacaciones.

Personas:

- Pedro.
- Martin.
- Lucas.

Fecha:

- Desde 10/06/2026.
- Hasta 15/06/2026.

Resultado:

- Se generan registros individuales por cada persona.
- Cada registro queda asociado al legajo.
- Cada registro impacta en carga horaria y liquidacion segun la regla de vacaciones.

Para casos como Sereno, Guardia o Manejo de colectivo no se usa este flujo de novedades. Se cargan como horas especiales desde la carga horaria.

## 8. Liquidacion

El modulo Liquidacion deberia simplificarse.

No deberia configurar demasiadas reglas paralelas.

Su objetivo deberia ser:

- Tomar las horas del periodo.
- Tomar las novedades del periodo.
- Filtrar lo que impacta liquidacion.
- Preparar la exportacion a Finnegans.

### 8.1. Que se exporta a Finnegans

Se exportan:

- Novedades de Finnegans.
- Novedades internas vinculadas a Finnegans.
- Horas especiales con codigo Finnegans, si aplica.

No se exportan:

- Novedades internas sin vinculacion Finnegans.
- Observaciones internas.
- Alertas operativas.

### 8.2. Ejemplo de exportacion

Periodo: junio 2026.

Empleado: Juan Perez.

Exportar:

- Vacaciones desde 10/06/2026 hasta 20/06/2026.
- Enfermedad 24/06/2026.
- Manejo de colectivo 8 hs.

Formato futuro:

- Legajo.
- DNI o CUIL.
- Codigo Finnegans.
- Fecha desde.
- Fecha hasta.
- Cantidad.
- Unidad.
- Observacion.

## 9. Nueva estructura de modulos

### Configuracion

1. Novedades
   - Antes: Tipos de novedades.
   - Nuevo objetivo: catalogo maestro de novedades internas y Finnegans.

2. Horas especiales
   - Antes: Conceptos horarios.
   - Nuevo objetivo: catalogo de horas cargables en una jornada.

3. Liquidacion / Exportacion Finnegans
   - Nuevo objetivo: preparar exportacion mensual.

### Operacion

1. Carga de horas
   - Carga diaria por persona.
   - Horas normales.
   - Horas especiales.
   - Novedades por persona.

2. Novedades
   - Alta masiva o individual de novedades.
   - Aprobacion.
   - Documentacion.
   - Seguimiento.

3. Legajo
   - Horas especiales habilitadas.
   - Historial de novedades.
   - Historial de carga horaria.

## 10. Plan de implementacion

### Etapa 1: Limpiar conceptos

- Renombrar `Conceptos horarios` a `Horas especiales`.
- Sacar de ese modulo todo lo que parezca ausencia, licencia o novedad.
- Mantener ahi Sereno, Guardia, Manejo de colectivo, Hora extra, Nocturna y Feriado trabajado.
- Dejar solo conceptos de horas trabajadas o especiales.
- Conectar las horas especiales al legajo.

### Etapa 2: Redisenar catalogo de novedades

- Redefinir `Tipos de novedades` como `Novedades`.
- Agregar clasificacion:
  - Interna.
  - Finnegans.
  - Interna vinculada a Finnegans.
- Agregar vinculacion Finnegans.
- Agregar reglas:
  - Permite carga individual.
  - Permite carga masiva.
  - Permite rango de fechas.
  - Permite horas.
  - Requiere documento.
  - Requiere aprobacion.
  - Impacta carga horaria.
  - Impacta liquidacion.

### Etapa 3: Redisenar carga de horas

- En la pantalla de carga por persona, permitir:
  - Cargar horas normales.
  - Cargar horas especiales habilitadas.
  - Agregar novedad desde la misma pantalla.
- Mostrar resumen diario:
  - Horas normales.
  - Horas especiales.
  - Novedades.
  - Total a liquidar.
- No tratar horas especiales como novedades.

### Etapa 4: Redisenar modulo Novedades operativo

- Permitir cargar novedad para:
  - Una persona.
  - Varias personas.
  - Personas filtradas.
- Generar un registro por persona.
- Mostrar estado, documentacion, aprobacion e impacto.

### Etapa 5: Simplificar Liquidacion

- Cambiar foco a `Exportacion Finnegans`.
- Mostrar novedades exportables del mes.
- Mostrar horas especiales exportables del mes.
- Permitir revisar antes de exportar.
- Preparar estructura de archivo o payload futuro.

## 11. Decision recomendada

Yo eliminaria la logica actual de:

- Reglas complejas de conceptos horarios.
- Configuracion de liquidacion demasiado amplia.
- Impactos duplicados entre novedades y conceptos.

Y dejaria:

- Novedades como catalogo funcional principal.
- Horas especiales como catalogo auxiliar de carga horaria.
- Liquidacion como salida/exportacion mensual.

Esto va a ser mas claro para el usuario y mucho mas facil de conectar con backend y Finnegans.
