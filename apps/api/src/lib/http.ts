import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "erro", public details?: unknown) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, "Dados inválidos.", "validacao",
      r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })));
  }
  return r.data;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ erro: err.message, codigo: err.code, detalhes: err.details });
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 413) {   // JSON malformado / corpo grande demais
    res.status(status).json({ erro: "Requisição inválida.", codigo: "requisicao_invalida" });
    return;
  }
  console.error("[erro não tratado]", err);
  res.status(500).json({ erro: "Erro interno. Tente novamente.", codigo: "interno" });
}
