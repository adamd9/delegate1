// Builtin tool provider. Currently empty: the OpenAI Responses builtin web_search
// is invoked indirectly via the local web_search function tool (so it also works
// for the Realtime API used by voice). Kept as an extension point.
export function registerBuiltinTools() {
  // no-op
}
