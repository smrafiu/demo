import { logger } from "../utils/logger.js";

const APPLICATION_WEBHOOK_URL =
  "https://n8n.srv1499623.hstgr.cloud/webhook/3e2071bb-9b77-4a45-ae78-d38cf71924e5";

export type ApplicationWebhookPayload = {
  event: "application.created";
  organizationName: string;
  organizationSlug: string;
  role: string;
  location: string;
  city: string;
  country: string;
  department: string;
  workplaceType: string;
  employmentType: string;
  jobSlug: string;
  fullName: string;
  email: string;
  phone: string;
  resumeText: string;
  screeningQuestions: string[];
  screeningAnswers: string[];
  screening: Array<{ question: string; answer: string }>;
  applicationId: string;
  candidateId: string;
  jobId: string;
  source: string;
  submittedAt: string;
};

/**
 * Fire-and-forget POST to the n8n application webhook.
 * Failures are logged and never block the apply response.
 */
export function notifyApplicationWebhook(payload: ApplicationWebhookPayload): void {
  void (async () => {
    try {
      const res = await fetch(APPLICATION_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.warn("Application webhook non-OK response", {
          status: res.status,
          body: text.slice(0, 400),
        });
      } else {
        logger.info("Application webhook delivered", {
          applicationId: payload.applicationId,
          email: payload.email,
        });
      }
    } catch (err) {
      logger.warn("Application webhook failed", {
        error: err instanceof Error ? err.message : String(err),
        applicationId: payload.applicationId,
      });
    }
  })();
}
