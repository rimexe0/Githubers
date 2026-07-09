export function ok<T>(data: T) {
  return Response.json(data);
}

export function badRequest(message: string, details?: unknown) {
  return Response.json({ error: message, details }, { status: 400 });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown server error";
  return Response.json({ error: message }, { status: 500 });
}

export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}
