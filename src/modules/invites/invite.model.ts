import { Schema, model, type InferSchemaType, Types } from "mongoose";
import { ROLES } from "../../types/domain.js";

const inviteSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ROLES, required: true },
    tokenHash: { type: String, required: true },
    invitedBy: { type: Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked"],
      default: "pending",
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type InviteDoc = InferSchemaType<typeof inviteSchema> & { _id: Types.ObjectId };
export const Invite = model("Invite", inviteSchema);
