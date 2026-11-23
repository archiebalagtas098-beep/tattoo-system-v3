// controllers/storageControllers.js
// Dito ginagawa ang lahat ng file upload / view / list / delete.
// Ang mga file ay nasa STORAGE_DIR (default: <project>/storage/uploads),
// HINDI sa /public, kaya dumadaan muna sa permission check bago maibigay.

import "dotenv/config";               // para nababasa ang STORAGE_DIR kahit ma-import ito nang maaga
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import StorageFile from "../models/storageModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STORAGE_DIR = process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.join(__dirname, "..", "storage", "uploads");

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const ADMIN_ROLES = ["admin", "owner"];
const STAFF_ROLES = ["admin", "owner", "tattooartist"];
const CATEGORIES = ["reference", "gallery", "document", "other"];

// Ang extension ay galing sa mimetype (hindi sa pangalang ibinigay ng user),
// at walang SVG para walang script na maipasok.
const MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tif",
    "application/pdf": ".pdf"
};

const IMAGE_MIMES = Object.keys(MIME_TO_EXT).filter((m) => m.startsWith("image/"));
const ALL_MIMES = Object.keys(MIME_TO_EXT);

const STORED_NAME_PATTERN = /^[a-f0-9]{32}\.[a-z]{3,4}$/;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function currentUser(req) {
    const cookies = req.cookies || {};

    return {
        id: cookies.userId || "",
        username: cookies.username || "",
        role: cookies.role || ""
    };
}

export function fileUrl(storedName) {
    return "/api/storage/files/" + storedName;
}

function toPublic(doc) {
    return {
        id: String(doc._id),
        originalName: doc.originalName,
        storedName: doc.storedName,
        mimeType: doc.mimeType,
        size: doc.size,
        category: doc.category,
        isPublic: doc.isPublic,
        uploadedBy: doc.uploadedBy,
        uploadedByName: doc.uploadedByName,
        createdAt: doc.createdAt,
        url: fileUrl(doc.storedName)
    };
}

async function removeFromDisk(storedName) {
    if (!STORED_NAME_PATTERN.test(storedName || "")) {
        return;
    }

    try {
        await fs.promises.unlink(path.join(STORAGE_DIR, storedName));
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("Failed to delete file from disk:", error.message);
        }
    }
}

function errorDetail(error) {
    if (process.env.NODE_ENV === "production") {
        return "";
    }

    return " (" + (error && error.message ? error.message : String(error)) + ")";
}

// ------------------------------------------------------------------
// Multer (disk storage, labas ng /public)
// ------------------------------------------------------------------

function makeUploader(allowedMimes, maxMB) {
    return multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, STORAGE_DIR),
            filename: (req, file, cb) => {
                cb(null, crypto.randomBytes(16).toString("hex") + MIME_TO_EXT[file.mimetype]);
            }
        }),
        limits: { fileSize: maxMB * 1024 * 1024, files: 1 },
        fileFilter: (req, file, cb) => {
            if (allowedMimes.includes(file.mimetype)) {
                return cb(null, true);
            }

            cb(new Error("File type not allowed."));
        }
    });
}

function runUpload(uploader, fieldName, maxMB) {
    return (req, res, next) => {
        uploader.single(fieldName)(req, res, (error) => {
            if (!error) {
                return next();
            }

            let message = error.message;

            if (error instanceof multer.MulterError) {
                message = error.code === "LIMIT_FILE_SIZE"
                    ? "File is too large (max " + maxMB + "MB)."
                    : "Upload error: " + error.message;
            }

            return res.status(400).json({ success: false, message });
        });
    };
}

// Para sa booking reference image (image lang, max 5MB) - field name: "reference"
export const uploadReferenceImage = runUpload(makeUploader(IMAGE_MIMES, 5), "reference", 5);

// Para sa POST /api/storage/upload (image o PDF, max 10MB) - field name: "file"
export const uploadAnyFile = runUpload(makeUploader(ALL_MIMES, 10), "file", 10);

// ------------------------------------------------------------------
// Ginagamit din ng server.js (booking) para i-register ang na-upload na file
// ------------------------------------------------------------------

export async function saveUploadedFile(file, user, options = {}) {
    try {
        return await StorageFile.create({
            originalName: (file.originalname || "").slice(0, 200),
            storedName: file.filename,
            mimeType: file.mimetype,
            size: file.size || 0,
            category: CATEGORIES.includes(options.category) ? options.category : "other",
            isPublic: Boolean(options.isPublic),
            uploadedBy: String(user.id),
            uploadedByName: user.username || ""
        });
    } catch (error) {
        // Kung pumalya ang database, huwag mag-iwan ng orphan file sa disk
        await removeFromDisk(file.filename);
        throw error;
    }
}

// ------------------------------------------------------------------
// Controllers
// ------------------------------------------------------------------

// POST /api/storage/upload   (form-data: file, category?, isPublic?)
export async function uploadFile(req, res) {
    const user = currentUser(req);

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded. Use the field name \"file\"."
            });
        }

        const category = CATEGORIES.includes(req.body.category) ? req.body.category : "other";
        const isAdmin = ADMIN_ROLES.includes(user.role);

        // Gallery at public files: admin / owner lang
        if ((category === "gallery" || req.body.isPublic === "true") && !isAdmin) {
            await removeFromDisk(req.file.filename);

            return res.status(403).json({
                success: false,
                message: "Only admins can upload gallery or public files."
            });
        }

        const doc = await saveUploadedFile(req.file, user, {
            category,
            isPublic: isAdmin && req.body.isPublic === "true"
        });

        return res.status(201).json({ success: true, file: toPublic(doc) });

    } catch (error) {
        console.error("POST /api/storage/upload", error);

        return res.status(500).json({
            success: false,
            message: "Failed to save file." + errorDetail(error)
        });
    }
}

// GET /api/storage/files/:storedName   (ito ang URL na ilalagay sa <img src>)
export async function getFile(req, res) {
    try {
        const storedName = String(req.params.storedName || "");

        if (!STORED_NAME_PATTERN.test(storedName)) {
            return res.status(400).end();
        }

        const doc = await StorageFile.findOne({ storedName }).lean();

        if (!doc) {
            return res.status(404).end();
        }

        if (!doc.isPublic) {
            const user = currentUser(req);

            if (!user.id || !user.role) {
                return res.status(401).end();
            }

            const allowed = STAFF_ROLES.includes(user.role) || doc.uploadedBy === user.id;

            if (!allowed) {
                return res.status(403).end();
            }
        }

        res.set("Content-Type", doc.mimeType);
        res.set("Cache-Control", doc.isPublic ? "public, max-age=86400" : "private, max-age=3600");
        res.set("X-Content-Type-Options", "nosniff");

        return res.sendFile(storedName, { root: STORAGE_DIR }, (error) => {
            if (error && !res.headersSent) {
                res.status(404).end();
            }
        });

    } catch (error) {
        console.error("GET /api/storage/files/:storedName", error);
        return res.status(500).end();
    }
}

// GET /api/storage?category=reference
// Staff: lahat ng files. Client: sarili niyang files lang.
export async function listFiles(req, res) {
    try {
        const user = currentUser(req);
        const query = {};

        if (!STAFF_ROLES.includes(user.role)) {
            query.uploadedBy = user.id;
        }

        if (CATEGORIES.includes(req.query.category)) {
            query.category = req.query.category;
        }

        const docs = await StorageFile.find(query)
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({ success: true, files: docs.map(toPublic) });

    } catch (error) {
        console.error("GET /api/storage", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load files." + errorDetail(error)
        });
    }
}

// DELETE /api/storage/:id
// Admin / owner: kahit anong file. Iba: sarili niyang file lang.
export async function deleteFile(req, res) {
    try {
        const user = currentUser(req);

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid file id." });
        }

        const doc = await StorageFile.findById(req.params.id);

        if (!doc) {
            return res.status(404).json({ success: false, message: "File not found." });
        }

        if (!ADMIN_ROLES.includes(user.role) && doc.uploadedBy !== user.id) {
            return res.status(403).json({
                success: false,
                message: "You do not have access to this file."
            });
        }

        await removeFromDisk(doc.storedName);
        await doc.deleteOne();

        return res.json({ success: true, message: "File deleted." });

    } catch (error) {
        console.error("DELETE /api/storage/:id", error);

        return res.status(500).json({
            success: false,
            message: "Failed to delete file." + errorDetail(error)
        });
    }
}