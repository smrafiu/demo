import { Schema, model, type InferSchemaType, Types } from "mongoose";

const notificationSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const auditLogSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    actorId: { type: Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

const pipelineEventSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    applicationId: { type: Types.ObjectId, ref: "Application", required: true, index: true },
    fromStage: { type: String, required: true },
    toStage: { type: String, required: true },
    actorId: { type: Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
};
export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };

export const Notification = model("Notification", notificationSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
export const PipelineEvent = model("PipelineEvent", pipelineEventSchema);
