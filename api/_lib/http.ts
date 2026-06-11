export function sendJson(res: any, status: number, payload: unknown) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

export function methodNotAllowed(res: any, allow: string[]) {
  res.setHeader("Allow", allow.join(", "));
  sendJson(res, 405, { error: "Method not allowed" });
}

export function badRequest(res: any, message: string) {
  sendJson(res, 400, { error: message });
}

export function serverError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error";
  sendJson(res, 500, { error: message });
}
