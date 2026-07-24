import { NextFunction, Request, Response } from "express";
import { PublicUser } from "../types";
import { AuthError } from "./userStore";
import { verifyToken } from "./tokens";

export interface AuthenticatedRequest extends Request {
  authUser: PublicUser;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (!token) {
    res.status(401).json({ error: "请先登录" });
    return;
  }

  try {
    (req as AuthenticatedRequest).authUser = verifyToken(token);
    next();
  } catch (err) {
    const statusCode = err instanceof AuthError ? err.statusCode : 401;
    const message = err instanceof Error ? err.message : "请先登录";
    res.status(statusCode).json({ error: message });
  }
}
