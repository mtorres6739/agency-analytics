import type { FastifyInstance } from "fastify";

const passthroughParser = (_request: unknown, _payload: unknown, done: (error: Error | null, body?: null) => void) => {
  done(null, null);
};

export function registerAuthContentTypeParsers(fastify: FastifyInstance) {
  // fastify-raw-body replaces Fastify's JSON parser when configured to retain
  // exact request bytes. Remove the inherited parser inside this encapsulated
  // auth scope before installing Better Auth's raw-stream passthrough parser.
  if (fastify.hasContentTypeParser("application/json")) {
    fastify.removeContentTypeParser("application/json");
  }
  fastify.addContentTypeParser("application/json", passthroughParser);

  if (fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
    fastify.removeContentTypeParser("application/x-www-form-urlencoded");
  }
  fastify.addContentTypeParser("application/x-www-form-urlencoded", passthroughParser);
}
