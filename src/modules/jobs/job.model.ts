import { Schema, model, type InferSchemaType, Types } from "mongoose";

const requirementSchema = new Schema(
  {
    text: { type: String, required: true },
    kind: {
      type: String,
      enum: ["mandatory", "preferred", "optional", "disqualifying"],
      required: true,
    },
    skill: { type: String, default: "" },
  },
  { _id: false },
);

const jobSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    department: { type: String, default: "", trim: true },
    departmentId: { type: Types.ObjectId, ref: "Department", default: null },
    hiringManagerId: { type: Types.ObjectId, ref: "User", default: null },
    recruiterId: { type: Types.ObjectId, ref: "User", default: null },
    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "intern"],
      default: "full_time",
    },
    workplaceType: {
      type: String,
      enum: ["onsite", "hybrid", "remote"],
      default: "hybrid",
    },
    location: { type: String, default: "" },
    country: { type: String, default: "IN" },
    vacancies: { type: Number, default: 1 },
    filledCount: { type: Number, default: 0 },
    minExperience: { type: Number, default: 0 },
    maxExperience: { type: Number, default: 10 },
    minSalary: { type: Number, default: null },
    maxSalary: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    applicationDeadline: { type: Date, default: null },
    description: { type: String, default: "" },
    responsibilities: { type: String, default: "" },
    benefits: { type: String, default: "" },
    requirements: { type: [requirementSchema], default: [] },
    screeningQuestions: { type: [String], default: [] },
    companyLogoHint: { type: String, default: "" }, // deprecated — use organization logo
    status: {
      type: String,
      enum: ["draft", "open", "paused", "closed", "filled", "archived"],
      default: "draft",
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

jobSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
jobSchema.index({ title: "text", description: "text" });

export type JobDoc = InferSchemaType<typeof jobSchema> & { _id: Types.ObjectId };
export const Job = model("Job", jobSchema);
