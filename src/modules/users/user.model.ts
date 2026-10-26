import { Schema, model, type InferSchemaType, Types } from "mongoose";
import { ROLES } from "../../types/domain.js";

const userSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    title: { type: String, default: "" },
    departmentId: { type: Types.ObjectId, ref: "Department", default: null },
    avatarFileId: { type: Types.ObjectId, ref: "File", default: null },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    refreshTokenHash: { type: String, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    googleId: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ organizationId: 1, email: 1 }, { unique: true });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User = model("User", userSchema);
