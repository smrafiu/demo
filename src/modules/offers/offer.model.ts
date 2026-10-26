import { Schema, model, type InferSchemaType, Types } from "mongoose";

const offerTemplateSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true },
    employmentType: {
      type: String,
      enum: ["full_time", "intern", "consultant", "contractor"],
      default: "full_time",
    },
    body: { type: String, required: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const salaryBreakdownSchema = new Schema(
  {
    basic: { type: Number, default: 0 },
    hra: { type: Number, default: 0 },
    specialAllowance: { type: Number, default: 0 },
    variablePay: { type: Number, default: 0 },
    performanceBonus: { type: Number, default: 0 },
    joiningBonus: { type: Number, default: 0 },
    employerPf: { type: Number, default: 0 },
    gratuity: { type: Number, default: 0 },
    insurance: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    annualCtc: { type: Number, required: true },
    monthlyGross: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
  },
  { _id: false },
);

const offerSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    applicationId: { type: Types.ObjectId, ref: "Application", required: true, index: true },
    templateId: { type: Types.ObjectId, ref: "OfferTemplate", default: null },
    version: { type: Number, default: 1 },
    previousOfferId: { type: Types.ObjectId, ref: "Offer", default: null },
    jobTitle: { type: String, required: true },
    joiningDate: { type: Date, default: null },
    reportingManager: { type: String, default: "" },
    workLocation: { type: String, default: "" },
    probationMonths: { type: Number, default: 3 },
    noticePeriodDays: { type: Number, default: 30 },
    validUntil: { type: Date, default: null },
    benefits: { type: String, default: "" },
    specialConditions: { type: String, default: "" },
    letterBody: { type: String, default: "" },
    salary: { type: salaryBreakdownSchema, required: true },
    status: {
      type: String,
      enum: [
        "draft",
        "awaiting_approval",
        "changes_requested",
        "approved",
        "sent",
        "viewed",
        "accepted",
        "rejected",
        "expired",
        "withdrawn",
        "revised",
      ],
      default: "draft",
    },
    pdfFileId: { type: Types.ObjectId, ref: "File", default: null },
    accessTokenHash: { type: String, default: null },
    sentAt: { type: Date, default: null },
    firstViewedAt: { type: Date, default: null },
    lastViewedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    candidateComment: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const offerApprovalSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    offerId: { type: Types.ObjectId, ref: "Offer", required: true, index: true },
    step: { type: Number, required: true },
    approverRole: { type: String, required: true },
    approverUserId: { type: Types.ObjectId, ref: "User", default: null },
    decision: {
      type: String,
      enum: ["pending", "approved", "rejected", "changes_requested"],
      default: "pending",
    },
    note: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type OfferTemplateDoc = InferSchemaType<typeof offerTemplateSchema> & {
  _id: Types.ObjectId;
};
export type OfferDoc = InferSchemaType<typeof offerSchema> & { _id: Types.ObjectId };
export type OfferApprovalDoc = InferSchemaType<typeof offerApprovalSchema> & {
  _id: Types.ObjectId;
};

export const OfferTemplate = model("OfferTemplate", offerTemplateSchema);
export const Offer = model("Offer", offerSchema);
export const OfferApproval = model("OfferApproval", offerApprovalSchema);
