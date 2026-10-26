import { Schema, model, type InferSchemaType, Types } from "mongoose";

const fileSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", default: null, index: true },
    key: { type: String, required: true, unique: true },
    bucket: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, default: "" },
    purpose: {
      type: String,
      enum: [
        "org_logo",
        "user_avatar",
        "candidate_photo",
        "resume",
        "offer_pdf",
        "brand_asset",
        "other",
      ],
      required: true,
    },
    ownerUserId: { type: Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type FileDoc = InferSchemaType<typeof fileSchema> & { _id: Types.ObjectId };
export const FileObject = model("File", fileSchema);
