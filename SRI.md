# Automatización de SRI en línea con Playwright

## Cómo está armado

El SRI **no expone API pública** para descargar comprobantes recibidos ni para
presentar el Formulario 104: ambas cosas solo existen detrás de una sesión
autenticada en el portal. Por eso la integración es automatización de navegador.

```
runtime de la app (tools TS)          sandbox aislado (Playwright)
─────────────────────────────         ─────────────────────────────
resuelve credenciales por RUC   ──▶   verificar-acceso.mjs
llama sandbox.run({ env })            descargar-comprobantes.mjs
parsea __SRI_RESULT__<json>     ◀──   preparar-104.mjs
                                      presentar-104.mjs
```

Decisiones que sostienen el diseño:

| Decisión | Por qué |
|---|---|
| Playwright corre en el sandbox, no en el runtime | Aísla el navegador del proceso de la app y permite cerrar el egress |
| Egress limitado a `*.sri.gob.ec` | Un navegador con credenciales fiscales no debe poder alcanzar otro host |
| Credenciales por `env` de cada `run()` | No pasan por argv (visible en `ps`), ni por disco, ni por el contexto del modelo |
| Todos los selectores en `selectores.mjs` | Cuando el SRI rediseña, se arregla un solo archivo |
| Preparar y presentar son scripts distintos | `preparar-104.mjs` no contiene ninguna ruta de código que presente |
| La aritmética vive en `agent/lib/calculo/` | Funciones puras con tests; el modelo explica, no calcula |
| Dinero en centavos enteros | Un centavo de diferencia obliga a una sustitutiva |

## Antes del primer uso

### 1. Capturar los selectores reales

`agent/sandbox/workspace/sri/lib/selectores.mjs` trae **placeholders**. Hay que
reemplazarlos contra el portal real:

```sh
npx playwright codegen https://srienlinea.sri.gob.ec
```

Recorré a mano el flujo completo (login → comprobantes recibidos → declaración de
IVA) y copiá los selectores. Preferí, en este orden: `getByRole` / `getByLabel` /
`getByText` > id estable > CSS estructural. Nunca clases autogeneradas.

Hacelo primero contra el **ambiente de pruebas** del SRI, no contra producción.

### 2. Configurar credenciales

Copiá `.env.example` a `.env` y completá `SRI_CRED_<RUC>="usuario:clave"`.
`.env` está en `.gitignore`.

### 3. Elegir dónde corre Chromium

`SRI_EJECUCION` decide si el navegador corre dentro del sandbox de eve o en el
runtime de la app.

| | `sandbox` (por defecto) | `local` |
|---|---|---|
| Dónde corre Chromium | Sandbox aislado | Proceso hijo del runtime |
| Requiere | Docker / microsandbox / Vercel | Solo `npm run sri:setup` |
| Aislamiento del navegador | Sí | **No** |
| Restricción de egress | Sí, con microsandbox o vercel | **No** |
| Para qué | Producción | Desarrollo en Windows sin Docker |

**Desarrollo local en Windows, sin Docker:**

```sh
npm run sri:setup    # descarga Chromium (una vez)
npm run sri:check    # verifica que el entorno funciona, sin tocar el SRI
# poner SRI_EJECUCION=local en .env
npm run dev
```

En modo `local` el sandbox de eve queda sin bootstrap, así que no intenta
instalar Playwright en un backend que no tiene binarios reales. Los archivos
que producen los scripts (capturas, descargas, borradores) van a `.sri-datos/`.

**En sandbox**, el backend se elige con `SRI_SANDBOX_BACKEND`: `docker`,
`microsandbox` o `vercel`. Solo los dos últimos soportan allow-list por dominio
y restringen el egress a `*.sri.gob.ec`. El criterio para el VPS está en
[DESPLIEGUE.md](DESPLIEGUE.md).

El `bootstrap` instala Playwright y Chromium una sola vez por template (~400 MB).
Para forzar la reconstrucción, subí `VERSION_RUNTIME` en `agent/sandbox/sandbox.ts`.

## Verificar

```sh
npm run typecheck      # tipos
npm run test:calculo   # liquidación de IVA y fechas límite (15 casos)
npm run sri:check      # Chromium arranca y el contrato del runner funciona
npx eve info           # descubrimiento de tools y skill
```

Después, extremo a extremo contra el ambiente de pruebas:

```
"Verificá el acceso al SRI del RUC 1790012345001"
"Descargá los comprobantes recibidos de enero 2026"
```

## Lo que el sistema NO hace

- No presenta una declaración sin aprobación humana. `sri_presentar_104` exige
  `user-approval` en cada llamada, también cuando la dispara un schedule.
- No da asesoría tributaria.
- No reintenta un login fallido: el SRI bloquea la cuenta tras varios intentos.

## UI web

Una SPA de React en `web/` que habla con el agente por su canal HTTP.

```sh
npm run dev        # el agente, en :2000
npm run web:dev    # la UI, en :5173 (proxea /eve al agente)
```

En produccion, Caddy sirve `web/dist` y el agente en el MISMO origen, asi que
no hay CORS y la UI usa rutas relativas. `deploy.sh` compila las dos cosas.

Lo que la UI aporta sobre la TUI:

- **Aprobaciones con la captura a la vista.** Cuando el agente pide aprobar
  `sri_presentar_104`, la UI muestra la captura del formulario 104 lleno junto
  al boton, y marca la accion como irreversible en rojo. Aprobar a ciegas es el
  riesgo real de este flujo.
- Autenticacion HTTP Basic con las credenciales del agente, guardadas en
  `sessionStorage` (se borran al cerrar la pestana), nunca en `localStorage`.

## Despliegue

Ver [DESPLIEGUE.md](DESPLIEGUE.md).

## Pendiente

- Conciliación automática contra los libros (hoy el agente reporta, no cruza).
- Mapa completo de casilleros del 104 en `DECLARACION_104.casilleros`.
- Multas e intereses por declaración tardía y flujo de sustitutiva.
- Anexo Transaccional Simplificado (ATS).
- Schedules de alerta por noveno dígito (`fechaLimiteIva` ya está listo).
- Persistencia del arrastre de crédito tributario fuera de la sesión
  (`defineState` es por sesión; esto necesita un memory provider o una base).
