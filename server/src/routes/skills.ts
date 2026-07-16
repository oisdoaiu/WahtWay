import { Router, Request, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import {
  addReport,
  addReview,
  addSkillVersion,
  archiveSkill,
  createSkill,
  downloadSkill,
  getSkill,
  listSkills,
  listVersions,
  summarizeSkill,
  updateSkillMetadata,
} from "../skills/hubStore";
import {
  sanitizeChangelog,
  sanitizeOptionalText,
  sanitizeSkillManifest,
  sanitizeTags,
  sanitizeVersion,
  SkillValidationError,
} from "../skills/validation";
import { SkillStatus, SkillVisibility } from "../types";

const router = Router();

const STATUSES: SkillStatus[] = ["draft", "pending", "published", "rejected", "archived"];
const VISIBILITIES: SkillVisibility[] = ["public", "unlisted"];

function respondError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "Unknown error";
  if (err instanceof SkillValidationError) {
    res.status(400).json({ error: message });
    return;
  }
  if (message === "Skill not found" || message === "Skill version not found") {
    res.status(404).json({ error: message });
    return;
  }
  if (message.includes("已存在")) {
    res.status(409).json({ error: message });
    return;
  }
  res.status(500).json({ error: message });
}

function parseVisibility(value: unknown): SkillVisibility {
  if (typeof value !== "string" || !VISIBILITIES.includes(value as SkillVisibility)) {
    return "public";
  }
  return value as SkillVisibility;
}

function parseStatus(value: unknown): SkillStatus {
  if (typeof value === "string" && STATUSES.includes(value as SkillStatus)) {
    return value as SkillStatus;
  }
  return process.env.REQUIRE_SKILL_REVIEW === "true" ? "pending" : "published";
}

function canManageSkill(req: Request, skillId: string): boolean {
  const user = (req as AuthenticatedRequest).authUser;
  const record = getSkill(skillId);
  if (!record || record.status === "archived") return false;
  return user.role === "admin" || record.authorUserId === user.id;
}

function assertCanManageSkill(req: Request, res: Response, skillId: string): boolean {
  if (!canManageSkill(req, skillId)) {
    res.status(403).json({ error: "没有权限管理这个 Skill" });
    return false;
  }
  return true;
}

router.get("/", (req: Request, res: Response) => {
  const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;
  const skills = listSkills({
    q: typeof req.query.q === "string" ? req.query.q.trim() : undefined,
    tag: typeof req.query.tag === "string" ? req.query.tag.trim() : undefined,
    category: typeof req.query.category === "string" ? req.query.category.trim() : undefined,
    sort: sort === "downloads" || sort === "rating" || sort === "name" ? sort : "latest",
    includeUnlisted: req.query.includeUnlisted === "true",
  });
  res.json({ skills });
});

router.get("/:skillId", (req: Request, res: Response) => {
  try {
    const record = getSkill(req.params.skillId);
    if (!record || record.status === "archived") {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json({
      skill: summarizeSkill(record),
      versions: listVersions(record.skillId),
      downloadUrl: `/api/skills/${record.skillId}/download`,
    });
  } catch (err) {
    respondError(res, err);
  }
});

router.get("/:skillId/versions", (req: Request, res: Response) => {
  try {
    res.json({ versions: listVersions(req.params.skillId) });
  } catch (err) {
    respondError(res, err);
  }
});

router.get("/:skillId/download", (req: Request, res: Response) => {
  try {
    const selected = typeof req.query.version === "string" ? req.query.version : "latest";
    const { record, version } = downloadSkill(req.params.skillId, selected);
    const payload = {
      skill: version.manifest,
      version: version.version,
      checksum: version.checksum,
      source: {
        hub: "WahtWay Skill Hub",
        skillId: record.skillId,
      },
    };

    if (req.query.raw === "1" || req.query.format === "raw") {
      res.json(version.manifest);
      return;
    }

    res.json(payload);
  } catch (err) {
    respondError(res, err);
  }
});

router.post("/", requireAuth, (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const user = (req as AuthenticatedRequest).authUser;
    const manifest = sanitizeSkillManifest(body.manifest || body);
    const record = createSkill({
      manifest,
      version: sanitizeVersion(body.version),
      changelog: sanitizeChangelog(body.changelog),
      authorUserId: user.id,
      authorName: user.displayName || user.username,
      category: sanitizeOptionalText(body.category, "category", 40),
      tags: sanitizeTags(body.tags || manifest.keywords?.slice(0, 6) || []),
      visibility: parseVisibility(body.visibility),
      status: parseStatus(body.status),
    });

    res.status(201).json({
      success: true,
      skill: summarizeSkill(record),
      downloadUrl: `/api/skills/${record.skillId}/download`,
    });
  } catch (err) {
    respondError(res, err);
  }
});

router.post("/:skillId/versions", requireAuth, (req: Request, res: Response) => {
  try {
    if (!assertCanManageSkill(req, res, req.params.skillId)) return;
    const body = req.body || {};
    const manifest = sanitizeSkillManifest(body.manifest || body);
    const record = addSkillVersion(
      req.params.skillId,
      manifest,
      sanitizeVersion(body.version),
      sanitizeChangelog(body.changelog)
    );
    res.status(201).json({
      success: true,
      skill: summarizeSkill(record),
      downloadUrl: `/api/skills/${record.skillId}/download?version=${record.currentVersion}`,
    });
  } catch (err) {
    respondError(res, err);
  }
});

router.patch("/:skillId", requireAuth, (req: Request, res: Response) => {
  try {
    if (!assertCanManageSkill(req, res, req.params.skillId)) return;
    const body = req.body || {};
    const user = (req as AuthenticatedRequest).authUser;
    const record = updateSkillMetadata(req.params.skillId, {
      status:
        user.role === "admin" && typeof body.status === "string" && STATUSES.includes(body.status)
          ? body.status
          : undefined,
      visibility:
        typeof body.visibility === "string" && VISIBILITIES.includes(body.visibility) ? body.visibility : undefined,
      category: body.category === undefined ? undefined : sanitizeOptionalText(body.category, "category", 40),
      tags: body.tags === undefined ? undefined : sanitizeTags(body.tags),
    });
    res.json({ success: true, skill: summarizeSkill(record) });
  } catch (err) {
    respondError(res, err);
  }
});

router.delete("/:skillId", requireAuth, (req: Request, res: Response) => {
  try {
    if (!assertCanManageSkill(req, res, req.params.skillId)) return;
    const record = archiveSkill(req.params.skillId);
    res.json({ success: true, skill: summarizeSkill(record) });
  } catch (err) {
    respondError(res, err);
  }
});

router.post("/:skillId/review", (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const comment = sanitizeOptionalText(body.comment, "comment", 500);
    const record = addReview(req.params.skillId, Number(body.rating), comment);
    res.status(201).json({ success: true, skill: summarizeSkill(record) });
  } catch (err) {
    respondError(res, err);
  }
});

router.post("/:skillId/report", (req: Request, res: Response) => {
  try {
    const reason = sanitizeOptionalText(req.body?.reason, "reason", 500);
    if (!reason) {
      res.status(400).json({ error: "reason 不能为空" });
      return;
    }
    const record = addReport(req.params.skillId, reason);
    res.status(201).json({ success: true, reportCount: record.reportCount });
  } catch (err) {
    respondError(res, err);
  }
});

export default router;
