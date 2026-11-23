// models/storageModel.js
// Metadata lang ng file ang naka-save dito. Ang mismong file ay nasa
// storage/uploads (labas ng /public), kaya hindi ito maaabot ng static.

import mongoose from "mongoose";

const storageSchema = new mongoose.Schema(
    {
        // Orihinal na pangalan ng file mula sa user (para sa display lang)
        originalName: { type: String, default: "", trim: true },

        // Random na pangalan sa disk (hal. a3f9...c1.jpg) - ito ang ginagamit sa URL
        storedName: { type: String, required: true, unique: true },

        mimeType: { type: String, required: true },
        size: { type: Number, default: 0 },

        category: {
            type: String,
            enum: ["reference", "gallery", "document", "other"],
            default: "other",
            index: true
        },

        // true = kahit hindi naka-login ay makikita (admin / owner lang ang makakapag-set)
        isPublic: { type: Boolean, default: false },

        uploadedBy: { type: String, required: true, index: true },
        uploadedByName: { type: String, default: "" }
    },
    { timestamps: true }
);

const StorageFile =
    mongoose.models.StorageFile ||
    mongoose.model("StorageFile", storageSchema, "storagefiles");

export default StorageFile;