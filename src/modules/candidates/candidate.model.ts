import { Schema, model, type InferSchemaType, Types } from "mongoose";

const workHistorySchema = new Schema(
  {
    company: String,
    title: String,
    location: String,
    startDate: String,
    endDate: String,
    description: String,
    logoHint: String,
  },
  { _id: false },
);

const educationSchema = new Schema(
  {
    school: String,
    degree: String,
    field: String,
    year: String,
  },
  { _id: false },
);

const candidateSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: "" },
    currentCity: { type: String, default: "" },
    preferredLocation: { type: String, default: "" },
    country: { type: String, default: "" },
    currentCompany: { type: String, default: "" },
    currentDesignation: { type: String, default: "" },
    totalExperience: { type: Number, default: 0 },
    relevantExperience: { type: Number, default: 0 },
    currentSalary: { type: Number, default: null },
    expectedSalary: { type: Number, default: null },
    noticePeriodDays: { type: Number, default: null },
    skills: { type: [String], default: [] },
    education: { type: [educationSchema], default: [] },
    certifications: { type: [String], default: [] },
    workHistory: { type: [workHistorySchema], default: [] },
    projects: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    linkedinUrl: { type: String, default: "" },
    githubUrl: { type: String, default: "" },
    portfolioUrl: { type: String, default: "" },
    about: { type: String, default: "" },
    photoFileId: { type: Types.ObjectId, ref: "File", default: null },
    level: {
      type: String,
      enum: ["junior", "mid", "senior", "lead", "executive"],
      default: "mid",
    },
    tags: { type: [String], default: [] },
    ownerUserId: { type: Types.ObjectId, ref: "User", default: null },
    source: {
      type: String,
      enum: ["public_apply", "manual", "resume_upload"],
      default: "manual",
    },
    duplicateOf: { type: Types.ObjectId, ref: "Candidate", default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

candidateSchema.index({ organizationId: 1, email: 1 });
candidateSchema.index({
  fullName: "text",
  email: "text",
  skills: "text",
  currentDesignation: "text",
});

export type CandidateDoc = InferSchemaType<typeof candidateSchema> & {
  _id: Types.ObjectId;
};
export const Candidate = model("Candidate", candidateSchema);
