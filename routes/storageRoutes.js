// routes/storageRoutes.js
// Naka-mount sa server.js bilang:  app.use("/api/storage", storageRoutes)
//
//   POST   /api/storage/upload            -> mag-upload (field: "file")
//   GET    /api/storage/files/:storedName -> tingnan / i-download ang file
//   GET    /api/storage                   -> listahan ng files
//   DELETE /api/storage/:id               -> burahin

import express from "express";
import {
    uploadAnyFile,
    uploadFile,
    getFile,
    listFiles,
    deleteFile
} from "../controllers/storageControllers.js";

const router = express.Router();

// Ang req.cookies.userId / role ay galing sa auth middleware ng server.js
// (signed cookie + database lookup).
function requireAuth(req, res, next) {
    if (!req.cookies || !req.cookies.userId || !req.cookies.role) {
        return res.status(401).json({
            success: false,
            message: "Not logged in."
        });
    }

    next();
}

// Walang requireAuth dito dahil ang controller mismo ang nag-che-check
// (may "isPublic" na files na pwedeng makita ng hindi naka-login).
router.get("/files/:storedName", getFile);

router.get("/", requireAuth, listFiles);
router.post("/upload", requireAuth, uploadAnyFile, uploadFile);
router.delete("/:id", requireAuth, deleteFile);

export default router;