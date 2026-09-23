import { defineAgent } from "eve";

export default defineAgent({
  model: "inclusionai/ling-3.0-flash-sante",

  // Se apagan las tools por defecto (bash, web_search, web_fetch, glob, grep,
  // todo, read_file, write_file, sleep...). Este agente no las usa: opera por
  // sus tools autoradas.
  //
  // Importa por dos razones. La definicion de cada tool viaja en CADA
  // llamada al modelo, asi que 19 esquemas engordan el request y lo encarecen
  // sin aportar nada; y los modelos chicos o de capa gratuita fallan con
  // superficies de tools grandes, a veces con un 400 sin explicacion.
  //
  // Se vuelven a agregar solo las imprescindibles, en agent/tools/.
  defaultTools: false,
});
