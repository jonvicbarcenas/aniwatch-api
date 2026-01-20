import { Hono } from "hono";
import { ObjectId } from "mongodb";
import type { ServerContext } from "../config/context.js";
import { getDB } from "../config/mongodb.js";

export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'critical';
export type AnnouncementType = 'info' | 'warning' | 'maintenance' | 'update' | 'event';

export interface Announcement {
  _id?: ObjectId;
  subject: string;
  content: string;
  priority: AnnouncementPriority;
  type: AnnouncementType;
  isActive: boolean;
  isPinned: boolean;
  showOnce: boolean;
  startsAt?: number;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  createdBy: {
    uid: string;
    username: string;
  };
}

const COLLECTION = "announcements";

export const announcementsRouter = new Hono<ServerContext>();

// Disable caching for announcements
announcementsRouter.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
});

// Helper to check if user is admin
async function isAdmin(db: any, uid: string): Promise<boolean> {
  const user = await db.collection("users").findOne({ uid });
  return user?.isAdmin === true;
}

// GET / - Get all active announcements for users (public)
announcementsRouter.get("/", async (c) => {
  try {
    const db = await getDB();
    const now = Date.now();

    const announcements = await db
      .collection(COLLECTION)
      .find({
        isActive: true,
        $or: [
          { startsAt: { $exists: false } },
          { startsAt: { $eq: null } },
          { startsAt: { $lte: now } },
        ],
        $and: [
          {
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: { $eq: null } },
              { expiresAt: { $gt: now } },
            ],
          },
        ],
      })
      .sort({ isPinned: -1, priority: -1, createdAt: -1 })
      .toArray() as Announcement[];

    // Map priority to sortable value for proper ordering
    const priorityOrder: Record<AnnouncementPriority, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    // Sort by pinned first, then by priority, then by creation date
    const sorted = announcements.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });

    return c.json({ success: true, data: sorted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch announcements";
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /admin - Get all announcements for admin (requires auth)
announcementsRouter.get("/admin", async (c) => {
  const uid = c.req.query("uid");

  if (!uid) {
    return c.json({ success: false, error: "uid is required" }, 400);
  }

  try {
    const db = await getDB();

    if (!(await isAdmin(db, uid))) {
      return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    const announcements = await db
      .collection(COLLECTION)
      .find({})
      .sort({ createdAt: -1 })
      .toArray() as Announcement[];

    return c.json({ success: true, data: announcements });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch announcements";
    return c.json({ success: false, error: message }, 500);
  }
});

// POST / - Create new announcement (admin only)
announcementsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const { uid, subject, content, priority, type, isActive, isPinned, showOnce, startsAt, expiresAt } = body as {
    uid?: string;
    subject?: string;
    content?: string;
    priority?: AnnouncementPriority;
    type?: AnnouncementType;
    isActive?: boolean;
    isPinned?: boolean;
    showOnce?: boolean;
    startsAt?: number;
    expiresAt?: number;
  };

  if (!uid) {
    return c.json({ success: false, error: "uid is required" }, 400);
  }

  if (!subject || !content) {
    return c.json({ success: false, error: "subject and content are required" }, 400);
  }

  const validPriorities: AnnouncementPriority[] = ['low', 'medium', 'high', 'critical'];
  const validTypes: AnnouncementType[] = ['info', 'warning', 'maintenance', 'update', 'event'];

  if (priority && !validPriorities.includes(priority)) {
    return c.json({ success: false, error: "Invalid priority" }, 400);
  }

  if (type && !validTypes.includes(type)) {
    return c.json({ success: false, error: "Invalid type" }, 400);
  }

  try {
    const db = await getDB();

    const user = await db.collection("users").findOne({ uid });
    if (!user || user.isAdmin !== true) {
      return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    const now = Date.now();
    const announcement: Announcement = {
      subject: subject.trim(),
      content: content.trim(),
      priority: priority || 'medium',
      type: type || 'info',
      isActive: isActive !== false,
      isPinned: isPinned === true,
      showOnce: showOnce === true,
      startsAt: startsAt || undefined,
      expiresAt: expiresAt || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: {
        uid: user.uid,
        username: user.username || 'Admin',
      },
    };

    const result = await db.collection(COLLECTION).insertOne(announcement);

    return c.json({
      success: true,
      data: { ...announcement, _id: result.insertedId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create announcement";
    return c.json({ success: false, error: message }, 500);
  }
});

// PUT /:id - Update announcement (admin only)
announcementsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const { uid, subject, content, priority, type, isActive, isPinned, showOnce, startsAt, expiresAt } = body as {
    uid?: string;
    subject?: string;
    content?: string;
    priority?: AnnouncementPriority;
    type?: AnnouncementType;
    isActive?: boolean;
    isPinned?: boolean;
    showOnce?: boolean;
    startsAt?: number | null;
    expiresAt?: number | null;
  };

  if (!uid) {
    return c.json({ success: false, error: "uid is required" }, 400);
  }

  if (!ObjectId.isValid(id)) {
    return c.json({ success: false, error: "Invalid announcement ID" }, 400);
  }

  try {
    const db = await getDB();

    if (!(await isAdmin(db, uid))) {
      return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    const existing = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return c.json({ success: false, error: "Announcement not found" }, 404);
    }

    const update: Partial<Announcement> = {
      updatedAt: Date.now(),
    };

    if (subject !== undefined) update.subject = subject.trim();
    if (content !== undefined) update.content = content.trim();
    if (priority !== undefined) update.priority = priority;
    if (type !== undefined) update.type = type;
    if (isActive !== undefined) update.isActive = isActive;
    if (isPinned !== undefined) update.isPinned = isPinned;
    if (showOnce !== undefined) update.showOnce = showOnce;
    if (startsAt !== undefined) update.startsAt = startsAt || undefined;
    if (expiresAt !== undefined) update.expiresAt = expiresAt || undefined;

    await db.collection(COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    const updated = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) }) as Announcement | null;

    return c.json({ success: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update announcement";
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /:id - Delete announcement (admin only)
announcementsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const uid = c.req.query("uid");

  if (!uid) {
    return c.json({ success: false, error: "uid is required" }, 400);
  }

  if (!ObjectId.isValid(id)) {
    return c.json({ success: false, error: "Invalid announcement ID" }, 400);
  }

  try {
    const db = await getDB();

    if (!(await isAdmin(db, uid))) {
      return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return c.json({ success: false, error: "Announcement not found" }, 404);
    }

    return c.json({ success: true, message: "Announcement deleted" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete announcement";
    return c.json({ success: false, error: message }, 500);
  }
});
