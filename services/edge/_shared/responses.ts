// Structured JSON responses. Error shape matches EdgeError in
// packages/api-client/src/edge.ts: { code, message, status }.
import { corsHeaders } from './cors.ts';

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

export class EdgeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Wrap a handler so thrown EdgeError / unknown errors become the structured shape. */
export function withErrors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof EdgeError) {
        return json({ code: e.code, message: e.message, status: e.status }, e.status);
      }
      const message = e instanceof Error ? e.message : 'internal error';
      console.error('unhandled edge error:', message);
      return json({ code: 'internal_error', message, status: 500 }, 500);
    }
  };
}
