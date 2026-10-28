// The bindings the tests see, as wrangler.jsonc declares them.
declare namespace Cloudflare {
  interface Env {
    ROOMS: DurableObjectNamespace<import('../src/index').Room>;
    LOBBY: DurableObjectNamespace<import('../src/lobby').Lobby>;
    SITE: DurableObjectNamespace<import('../src/site').Site>;
    FEEDBACK: DurableObjectNamespace<import('../src/feedback').FeedbackStore>;
    FEEDBACK_TOKEN?: string;
    DISCORD_TOKEN?: string;
    DISCORD_GUILD?: string;
    DISCORD_CATEGORY?: string;
  }
}
