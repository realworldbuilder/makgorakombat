// The bindings the tests see, as wrangler.jsonc declares them.
declare namespace Cloudflare {
  interface Env {
    ROOMS: DurableObjectNamespace<import('../src/index').Room>;
    LOBBY: DurableObjectNamespace<import('../src/lobby').Lobby>;
  }
}
