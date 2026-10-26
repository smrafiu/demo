import { Schema, model, type InferSchemaType, Types } from "mongoose";
import { PIPELINE_STAGES } from "../../types/domain.js";

const applicationSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    jobId: { type: Types.ObjectId, ref: "Job", required: true, index: true },
    candidateId: { type: Types.ObjectId, ref: "Candidate", required: true, index: true },
    source: {
      type: String,
      enum: ["public_apply", "manual", "resume_upload"],
      default: "public_apply",
    },
    stage: { type: String, enum: PIPELINE_STAGES, default: "applied" },
    fitScore: { type: Number, default: null },
    fitExplanation: { type: Schema.Types.Mixed, default: null },
    eligibility: {
      type: String,
      enum: ["passed", "failed", "unavailable", "human_review"],
      default: "human_review",
    },
    override: {
      reason: { type: String, default: null },
      byUserId: { type: Types.ObjectId, ref: "User", default: null },
      at: { type: Date, default: null },
    },
    screeningAnswers: { type: [String], default: [] },
    notes: [
      {
        body: String,
        authorId: { type: Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

applicationSchema.index({ organizationId: 1, jobId: 1, candidateId: 1 }, { unique: true });

export type ApplicationDoc = InferSchemaType<typeof applicationSchema> & {
  _id: Types.ObjectId;
};
export const Application = model("Application", applicationSchema);
