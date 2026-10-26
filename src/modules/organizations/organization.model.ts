import { Schema, model, type InferSchemaType, Types } from "mongoose";
import { DEFAULT_SCORING_WEIGHTS } from "../../types/domain.js";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    logoFileId: { type: Types.ObjectId, ref: "File", default: null },
    /** Accent used on the public careers board / apply pages (hex). Default black. */
    careersAccentColor: { type: String, default: "#171717" },
    industry: { type: String, default: "" },
    size: { type: String, default: "" },
    website: { type: String, default: "" },
    address: { type: String, default: "" },
    country: { type: String, default: "IN" },
    timezone: { type: String, default: "Asia/Kolkata" },
    currency: { type: String, default: "INR" },
    dateFormat: { type: String, default: "DD/MM/YYYY" },
    scoringWeights: {
      type: Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_SCORING_WEIGHTS }),
    },
    retentionMonths: { type: Number, default: 12 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & {
  _id: Types.ObjectId;
};

export const Organization = model("Organization", organizationSchema);
