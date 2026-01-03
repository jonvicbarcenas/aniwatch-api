import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";

export const commentsRouter = new Hono<ServerContext>();

// Disable caching for comments
commentsRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

// Get comments for an anime (general, not episode-specific)
commentsRouter.get("/anime/:animeId", async (c) => {
    const { animeId } = c.req.param();
    const decodedAnimeId = decodeURIComponent(animeId);
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ 
            animeId: decodedAnimeId, 
            $or: [
                { episodeId: null },
                { episodeId: { $exists: false } }
            ]
        })
        .sort({ createdAt: -1 })
        .toArray();
    
    // Convert _id to string for frontend compatibility
    const formattedComments = comments.map(c => ({
        ...c,
        _id: c._id.toString()
    }));
    
    return c.json({ success: true, data: formattedComments });
});

// Get comments for a specific episode (using wildcard to handle special chars)
commentsRouter.get("/episode/*", async (c) => {
    const path = c.req.path;
    // Extract episodeId from path after /episode/
    const episodeId = decodeURIComponent(path.split('/episode/')[1] || '');
    if (!episodeId) {
        return c.json({ success: false, error: "episodeId is required" }, 400);
    }
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ episodeId })
        .sort({ createdAt: -1 })
        .toArray();
    
    // Convert _id to string for frontend compatibility
    const formattedComments = comments.map(c => ({
        ...c,
        _id: c._id.toString()
    }));
    
    console.log(`Fetching comments for episodeId: ${episodeId}, found: ${formattedComments.length}`);
    return c.json({ success: true, data: formattedComments });
});

// Get all comments for an anime (including all episodes)
commentsRouter.get("/anime/:animeId/all", async (c) => {
    const { animeId } = c.req.param();
    const decodedAnimeId = decodeURIComponent(animeId);
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ animeId: decodedAnimeId })
        .sort({ createdAt: -1 })
        .toArray();
    
    // Convert _id to string for frontend compatibility
    const formattedComments = comments.map(c => ({
        ...c,
        _id: c._id.toString()
    }));
    
    return c.json({ success: true, data: formattedComments });
});

// Post a new comment
commentsRouter.post("/", async (c) => {
    const body = await c.req.json();
    const { animeId, episodeId, userId, username, userAvatar, content, parentId, isSpoiler } = body;

    if (!animeId || !userId || !username || !content) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    if (content.length > 500) {
        return c.json({ success: false, error: "Comment exceeds 500 character limit" }, 400);
    }

    const db = await getDB();
    const comment = {
        animeId,
        episodeId: episodeId || null,
        userId,
        username,
        userAvatar,
        content,
        parentId: parentId || null,
        isSpoiler: isSpoiler || false,
        likes: [],
        createdAt: Date.now(),
        isEdited: false,
    };

    const result = await db.collection("comments").insertOne(comment);
    return c.json({ success: true, data: { ...comment, _id: result.insertedId.toString() } });
});

// Edit a comment
commentsRouter.put("/:commentId", async (c) => {
    const { commentId } = c.req.param();
    const body = await c.req.json();
    const { content, userId } = body;

    if (!content || !userId) {
        return c.json({ success: false, error: "Content and userId are required" }, 400);
    }

    if (content.length > 500) {
        return c.json({ success: false, error: "Comment exceeds 500 character limit" }, 400);
    }

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
    }

    if (comment.userId !== userId) {
        return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    await db.collection("comments").updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { content, isEdited: true, updatedAt: Date.now() } }
    );

    return c.json({ success: true });
});

// Delete a comment
commentsRouter.delete("/:commentId", async (c) => {
    const { commentId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const { userId } = body;

    if (!userId) {
        return c.json({ success: false, error: "userId is required" }, 400);
    }

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
    }

    if (comment.userId !== userId) {
        return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    // Delete the comment and all its replies
    await db.collection("comments").deleteMany({
        $or: [
            { _id: new ObjectId(commentId) },
            { parentId: commentId }
        ]
    });

    return c.json({ success: true });
});

// Like/Unlike a comment
commentsRouter.post("/:commentId/like", async (c) => {
    const { commentId } = c.req.param();
    const body = await c.req.json();
    const { userId } = body;

    if (!userId) {
        return c.json({ success: false, error: "userId is required" }, 400);
    }

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
    }

    const likes = comment.likes || [];
    const hasLiked = likes.includes(userId);

    if (hasLiked) {
        // Unlike
        await db.collection("comments").updateOne(
            { _id: new ObjectId(commentId) },
            { $pull: { likes: userId } }
        );
    } else {
        // Like
        await db.collection("comments").updateOne(
            { _id: new ObjectId(commentId) },
            { $addToSet: { likes: userId } }
        );
    }

    return c.json({ success: true, liked: !hasLiked });
});
