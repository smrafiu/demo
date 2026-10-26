import { Schema, model, type InferSchemaType, Types } from "mongoose";

const departmentSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    headUserId: { type: Types.ObjectId, ref: "User", default: null },
    archived: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type DepartmentDoc = InferSchemaType<typeof departmentSchema> & {
  _id: Types.ObjectId;
};
export const Department = model("Department", departmentSchema);
