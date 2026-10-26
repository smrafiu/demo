import PDFDocument from "pdfkit";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function buildOfferPdf(input: {
  companyName: string;
  candidateName: string;
  jobTitle: string;
  letterBody: string;
  annualCtc: number;
  currency: string;
  joiningDate?: string;
  documentId: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor("#0A0A0A").fontSize(20).text(input.companyName, { align: "left" });
    doc.moveDown(0.5);
    doc.fillColor("#77A719").fontSize(14).text("Offer Letter", { align: "left" });
    doc.moveDown();
    doc.fillColor("#0A0A0A").fontSize(11);
    doc.text(`Document ID: ${input.documentId}`);
    doc.text(`Candidate: ${input.candidateName}`);
    doc.text(`Role: ${input.jobTitle}`);
    if (input.joiningDate) doc.text(`Joining date: ${input.joiningDate}`);
    doc.text(
      `Annual CTC: ${input.currency} ${input.annualCtc.toLocaleString("en-IN")}`,
    );
    doc.moveDown();
    doc.text(input.letterBody || "We are pleased to offer you the position.", {
      align: "left",
    });
    doc.moveDown(2);
    doc.text("__________________________");
    doc.text("Authorized Signatory");
    doc.end();
  });
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!env.SMTP_HOST || !env.SMTP_USER) {
    logger.info("Email skipped (SMTP not configured)", {
      to: params.to,
      subject: params.subject,
    });
    return;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 465,
    secure: (env.SMTP_PORT ?? 465) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: env.SMTP_FROM ?? "HireFlow <noreply@hireflow.ai>",
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
