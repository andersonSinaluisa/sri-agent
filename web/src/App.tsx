import { useState, type FormEvent } from "react";
import { useEveAgent, type EveMessagePart } from "eve/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Credenciales {
  readonly usuario: string;
  readonly clave: string;
}

const CLAVE_ALMACEN = "sri-agent.credenciales";

function leerCredencialesGuardadas(): Credenciales | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_ALMACEN);
    return crudo === null ? null : (JSON.parse(crudo) as Credenciales);
  } catch {
    return null;
  }
}

export function App() {
  const [credenciales, setCredenciales] = useState<Credenciales | null>(leerCredencialesGuardadas);

  if (credenciales === null) {
    return <Ingreso onIngresar={setCredenciales} />;
  }
  return (
    <Chat
      credenciales={credenciales}
      onSalir={() => {
        try {
          sessionStorage.removeItem(CLAVE_ALMACEN);
        } catch {
          /* modo privado */
        }
        setCredenciales(null);
      }}
    />
  );
}

function Ingreso({ onIngresar }: { onIngresar: (c: Credenciales) => void }) {
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const credenciales: Credenciales = {
      usuario: String(datos.get("usuario") ?? ""),
      clave: String(datos.get("clave") ?? ""),
    };
    // sessionStorage se borra al cerrar la pestaña. No uses localStorage para
    // esto: son las credenciales de acceso al agente.
    try {
      sessionStorage.setItem(CLAVE_ALMACEN, JSON.stringify(credenciales));
    } catch {
      /* modo privado: se sigue solo con las credenciales en memoria */
    }
    onIngresar(credenciales);
  }

  return (
    <main className="ingreso">
      <form onSubmit={enviar}>
        <h1>Agente SRI</h1>
        <p className="tenue">Credenciales de acceso al agente, no las del portal del SRI.</p>
        <label>
          Usuario
          <input name="usuario" autoComplete="username" required />
        </label>
        <label>
          Clave
          <input name="clave" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}

function Chat({ credenciales, onSalir }: { credenciales: Credenciales; onSalir: () => void }) {
  const agente = useEveAgent({
    auth: { basic: { username: credenciales.usuario, password: credenciales.clave } },
  });

  const ocupado = agente.status === "submitted" || agente.status === "streaming";
  const reanudando = agente.status === "resuming";

  // Se recorren TODOS los mensajes: un turno posterior puede agregar mensajes
  // nuevos mientras una aprobación sigue abierta.
  const pendientes = agente.data.messages
    .flatMap((mensaje) => mensaje.parts)
    .flatMap((parte) => {
      if (parte.type !== "dynamic-tool" || parte.state !== "approval-requested") return [];
      const solicitud = parte.toolMetadata?.eve?.inputRequest;
      return solicitud ? [solicitud as unknown as SolicitudPendiente] : [];
    });

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const texto = String(new FormData(formulario).get("mensaje") ?? "").trim();
    if (texto.length === 0 || reanudando) return;
    formulario.reset();
    void agente.send(texto, ocupado ? { turnPolicy: "steer" } : undefined);
  }

  return (
    <div className="marco">
      <header>
        <strong>Agente SRI</strong>
        <span className={`estado estado-${agente.status}`}>{etiquetaEstado(agente.status)}</span>
        <button className="enlace" onClick={onSalir} type="button">
          Salir
        </button>
      </header>

      {agente.error ? <p className="error">{agente.error.message}</p> : null}

      <section className="conversacion">
        {agente.data.messages.length === 0 ? <Bienvenida /> : null}
        {agente.data.messages.map((mensaje) => (
          <article key={mensaje.id} className={`mensaje ${mensaje.role}`}>
            {mensaje.parts.map((parte, indice) => (
              <Parte key={indice} parte={parte} />
            ))}
          </article>
        ))}
      </section>

      {pendientes.map((solicitud) => (
        <Aprobacion
          key={solicitud.requestId}
          solicitud={solicitud}
          deshabilitado={reanudando}
          onResponder={(optionId) =>
            void agente.respond([{ requestId: solicitud.requestId, optionId }])
          }
          onTexto={(text) => void agente.respond([{ requestId: solicitud.requestId, text }])}
        />
      ))}

      <form className="redactor" onSubmit={enviar}>
        <input
          name="mensaje"
          placeholder="Liquidá el IVA de enero 2026..."
          disabled={reanudando}
          autoComplete="off"
        />
        {ocupado ? (
          <button type="button" onClick={() => void agente.cancel()}>
            Cancelar
          </button>
        ) : (
          <button type="submit" disabled={reanudando}>
            Enviar
          </button>
        )}
      </form>
    </div>
  );
}

function Bienvenida() {
  return (
    <div className="bienvenida">
      <p>Probá con algo así:</p>
      <ul>
        <li>Liquidá el IVA del RUC 0953227857001 para enero 2026.</li>
        <li>¿Cuándo vence la declaración de ese RUC?</li>
        <li>Verificá el acceso al SRI.</li>
      </ul>
    </div>
  );
}

/** Las tools del SRI devuelven la captura del formulario en base64. */
function extraerCaptura(salida: unknown): string | null {
  if (typeof salida !== "object" || salida === null) return null;
  const captura = (salida as { capturaBase64?: unknown }).capturaBase64;
  return typeof captura === "string" && captura.length > 0 ? captura : null;
}

/**
 * El agente responde en markdown: tablas de casilleros, listas de hallazgos,
 * montos en negrita. Sin esto se leen los pipes y los asteriscos crudos.
 *
 * react-markdown no renderiza HTML embebido salvo que se lo pida, así que el
 * texto del modelo no puede inyectar marcado en la página.
 */
function TextoMarkdown({ texto }: { texto: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{texto}</Markdown>
    </div>
  );
}

function Parte({ parte }: { parte: EveMessagePart }) {
  if (parte.type === "text") return <TextoMarkdown texto={parte.text} />;

  if (parte.type === "dynamic-tool") {
    const captura = parte.state === "output-available" ? extraerCaptura(parte.output) : null;
    return (
      <div className="herramienta">
        <code>
          {parte.toolName} · {parte.state}
        </code>
        {captura ? (
          <figure>
            <img src={`data:image/png;base64,${captura}`} alt="Formulario 104 lleno" />
            <figcaption>Revisá casillero por casillero antes de aprobar.</figcaption>
          </figure>
        ) : null}
      </div>
    );
  }

  return null;
}

interface SolicitudPendiente {
  readonly requestId: string;
  readonly kind: string;
  readonly prompt?: string;
  readonly toolName?: string;
  readonly options?: readonly { readonly id: string; readonly label: string }[];
  readonly allowFreeform?: boolean;
}

function Aprobacion({
  solicitud,
  deshabilitado,
  onResponder,
  onTexto,
}: {
  solicitud: SolicitudPendiente;
  deshabilitado: boolean;
  onResponder: (optionId: string) => void;
  onTexto: (texto: string) => void;
}) {
  const esPresentacion = solicitud.toolName === "sri_presentar_104";
  const opciones =
    solicitud.options && solicitud.options.length > 0
      ? solicitud.options
      : [
          { id: "approve", label: "Aprobar" },
          { id: "cancel", label: "Cancelar" },
        ];

  return (
    <section className={`solicitud ${esPresentacion ? "irreversible" : ""}`}>
      <h2>
        {solicitud.kind === "tool-approval" ? "Requiere aprobación" : "Pregunta"}
        {solicitud.toolName ? <code>{solicitud.toolName}</code> : null}
      </h2>

      {esPresentacion ? (
        <p className="alerta">
          Esto presenta la declaración ante el SRI. Es irreversible y tiene efecto jurídico a
          nombre del contribuyente.
        </p>
      ) : null}

      {solicitud.prompt ? <TextoMarkdown texto={solicitud.prompt} /> : null}

      {solicitud.kind === "question" && solicitud.allowFreeform ? (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            const texto = String(new FormData(evento.currentTarget).get("respuesta") ?? "").trim();
            if (texto.length > 0) onTexto(texto);
          }}
        >
          <input name="respuesta" placeholder="Tu respuesta..." disabled={deshabilitado} />
          <button type="submit" disabled={deshabilitado}>
            Responder
          </button>
        </form>
      ) : null}

      <div className="opciones">
        {opciones.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            disabled={deshabilitado}
            className={opcion.id === "approve" && esPresentacion ? "peligro" : undefined}
            onClick={() => onResponder(opcion.id)}
          >
            {opcion.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function etiquetaEstado(estado: string): string {
  switch (estado) {
    case "ready":
      return "listo";
    case "submitted":
      return "enviando";
    case "streaming":
      return "respondiendo";
    case "resuming":
      return "reanudando";
    case "error":
      return "error";
    default:
      return estado;
  }
}
