import { Schema, model, type InferSchemaType, Types } from "mongoose";

const resumeSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    candidateId: { type: Types.ObjectId, ref: "Candidate", required: true, index: true },
    fileId: { type: Types.ObjectId, ref: "File", required: true },
    rawText: { type: String, default: "" },
    parsedJson: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: Schema.Types.Mixed, default: {} },
    parseStatus: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending",
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type ResumeDoc = InferSchemaType<typeof resumeSchema> & { _id: Types.ObjectId };
export const Resume = model("Resume", resumeSchema);
