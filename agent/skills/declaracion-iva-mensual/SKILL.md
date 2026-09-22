---
description: Usar cuando haya que preparar, revisar o presentar una declaración mensual de IVA (Formulario 104) de un contribuyente ecuatoriano en SRI en línea.
---

# Declaración mensual de IVA (Formulario 104)

Seguí este orden. No saltes pasos ni presentes nada sin llegar al paso 5.

## 1. Encuadrar el período

Confirmá con el usuario, antes de tocar el portal:

- **RUC** del contribuyente (13 dígitos).
- **Período** declarado (año y mes).
- **Periodicidad**: `mensual`, o `semestral` si el contribuyente solo transfiere
  bienes/servicios con tarifa 0%, es RIMPE Emprendedor, o se le retiene el 100%.
- **Arrastres** del período anterior: crédito tributario por adquisiciones y
  crédito por retenciones. Si no los tenés, pedilos; asumir cero es un error caro.

Corré `sri_verificar_acceso` antes que nada. Si falla por credenciales, pará y decilo:
no reintentes, porque el SRI bloquea la cuenta tras varios fallos.

## 2. Recopilar

`sri_descargar_comprobantes` por cada tipo que aplique al período: facturas (1),
notas de crédito (4), notas de débito (5) y comprobantes de retención (7).

## 3. Conciliar

Contrastá lo descargado contra lo que el usuario tiene registrado y reportá
explícitamente, sin corregir por tu cuenta:

- comprobantes en el portal que no están en los libros, y al revés;
- comprobantes anulados o con autorización fuera del período;
- notas de crédito que no referencian una factura del período;
- compras cuya clasificación de crédito tributario no está definida.

**Cada compra necesita una clasificación** antes de liquidar:
crédito total (destinada a ventas gravadas), uso común (sujeta a proporcionalidad),
o sin crédito (destinada a ventas 0% o a gastos sin derecho). Si el usuario no
la define, preguntá. No la adivines.

## 4. Liquidar

Llamá a `sri_liquidar_iva`. **Nunca hagas la aritmética vos mismo** ni verifiques
"de cabeza" el resultado: el cálculo es determinista y está en código con tests.
Tu trabajo es explicar el resultado, no reproducirlo.

Presentá al usuario: factor de proporcionalidad, crédito aplicable, IVA a cargo,
retenciones aplicadas, arrastres al próximo período, total a pagar y fecha límite.

## 5. Preparar y revisar

`sri_preparar_104` llena el formulario en el portal y se detiene. Mirá la captura
que devuelve y verificá casillero por casillero contra la liquidación del paso 4.
Si algo no coincide, pará y reportalo.

Mostrale al usuario la captura y el total, y pedile que confirme.

## 6. Presentar

`sri_presentar_104` solo con **los mismos casilleros** que se revisaron en el paso 5.
La tool exige aprobación humana en cada llamada; eso es un control del sistema,
no una formalidad que puedas dar por cumplida.

Después de presentar, entregá el número de comprobante y la ruta del PDF, y
recordá el crédito tributario que queda arrastrado al período siguiente.

## Límites

- No das asesoría tributaria ni interpretás normativa dudosa: eso lo decide el
  contador responsable. Cuando una regla no es clara, decilo y pedí la decisión.
## Cuando un selector falla

El portal cambia de diseño sin avisar. Si un paso falla con "no se encontró el
elemento", "timeout esperando el localizador" o "no es un selector válido",
**no lo reportes como problema de red ni lo reintentes igual**. Entrá en modo
exploración:

1. `sri_inspeccionar_pantalla` con la URL del paso que falló. Te devuelve el
   árbol de accesibilidad, los controles con sus atributos y una captura.
2. Mirá qué hay realmente: puede que el campo haya cambiado de id, que la
   pantalla se pinte en dos etapas, o que estés en otra pantalla (por ejemplo,
   el portal te devolvió al login).
3. Proponé el selector nuevo. Preferí, en este orden: `getByRole` con el nombre
   accesible > `getByLabel` > id estable > CSS estructural. Nunca clases
   autogeneradas.
4. **Verificalo con `sri_validar_selector` antes de darlo por bueno.** Sirve
   solo si resuelve exactamente 1 elemento. Si resuelve 0 o varios, probá otro.
5. Reportá al usuario: qué clave de `selectores.mjs` hay que cambiar, por qué
   valor, y qué verificación diste. Vos no editás el archivo; lo hace una
   persona.

Los ids de JSF llevan dos puntos. En CSS van como `[id="form:campo"]`, no como
`#form:campo`, que el navegador lee como pseudo-clase e invalida el selector.
