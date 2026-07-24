import { Router, Request, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { issueToken } from "../auth/tokens";
import { AuthError, createUser, verifyCredentials } from "../auth/userStore";

const router = Router();

function respondAuthError(res: Response, err: unknown): void {
  const statusCode = err instanceof AuthError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : "认证失败";
  res.status(statusCode).json({ error: message });
}

router.post("/register", (req: Request, res: Response) => {
  try {
    const user = createUser({
      username: req.body?.username,
      password: req.body?.password,
      displayName: req.body?.displayName,
    });
    res.status(201).json({ user, token: issueToken(user) });
  } catch (err) {
    respondAuthError(res, err);
  }
});

router.post("/login", (req: Request, res: Response) => {
  try {
    const user = verifyCredentials(req.body?.username, req.body?.password);
    res.json({ user, token: issueToken(user) });
  } catch (err) {
    respondAuthError(res, err);
  }
});

router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: (req as AuthenticatedRequest).authUser });
});

export default router;
