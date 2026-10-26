import { Schema, model, type InferSchemaType, Types } from "mongoose";

const interviewSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    applicationId: { type: Types.ObjectId, ref: "Application", required: true, index: true },
    type: {
      type: String,
      enum: [
        "hr_screening",
        "technical",
        "assignment_review",
        "managerial",
        "cultural",
        "final",
      ],
      default: "technical",
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    meetingUrl: { type: String, default: "" },
    location: { type: String, default: "" },
    instructions: { type: String, default: "" },
    interviewerIds: [{ type: Types.ObjectId, ref: "User" }],
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "rescheduled"],
      default: "scheduled",
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const scorecardSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    interviewId: { type: Types.ObjectId, ref: "Interview", required: true, index: true },
    interviewerId: { type: Types.ObjectId, ref: "User", required: true },
    competencies: [
      {
        name: String,
        rating: { type: Number, min: 1, max: 5 },
        comment: String,
      },
    ],
    recommendation: {
      type: String,
      enum: ["strong_hire", "hire", "neutral", "do_not_hire", "strong_do_not_hire"],
      required: true,
    },
    overallNotes: { type: String, default: "" },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

scorecardSchema.index({ interviewId: 1, interviewerId: 1 }, { unique: true });

export type InterviewDoc = InferSchemaType<typeof interviewSchema> & {
  _id: Types.ObjectId;
};
export type ScorecardDoc = InferSchemaType<typeof scorecardSchema> & {
  _id: Types.ObjectId;
};

export const Interview = model("Interview", interviewSchema);
export const Scorecard = model("Scorecard", scorecardSchema);
