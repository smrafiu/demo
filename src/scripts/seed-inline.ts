import bcrypt from "bcryptjs";
import { Organization } from "../modules/organizations/organization.model.js";
import { User } from "../modules/users/user.model.js";
import { Job } from "../modules/jobs/job.model.js";
import { Candidate } from "../modules/candidates/candidate.model.js";
import { Application } from "../modules/applications/application.model.js";
import { Interview } from "../modules/interviews/interview.model.js";
import { OfferTemplate } from "../modules/offers/offer.model.js";
import { Notification } from "../modules/auditLogs/audit.model.js";
import { computeFitScore } from "../services/scoring.service.js";
import { logger } from "../utils/logger.js";

export async function seedInline(): Promise<void> {
  await Promise.all([
    Organization.deleteMany({}),
    User.deleteMany({}),
    Job.deleteMany({}),
    Candidate.deleteMany({}),
    Application.deleteMany({}),
    Interview.deleteMany({}),
    OfferTemplate.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  const org = await Organization.create({
    name: "HireFlow Demo",
    slug: "hireflow-demo",
    industry: "Technology",
    country: "IN",
    timezone: "Asia/Kolkata",
    currency: "INR",
  });

  const passwordHash = await bcrypt.hash("Password123!", 12);
  const alex = await User.create({
    organizationId: org._id,
    email: "alex@hireflow.demo",
    passwordHash,
    name: "Alex Holland",
    role: "recruiter",
    title: "Recruitment Specialist",
  });
  await User.create({
    organizationId: org._id,
    email: "admin@hireflow.demo",
    passwordHash,
    name: "Priya Sharma",
    role: "org_admin",
    title: "HR Administrator",
  });
  await User.create({
    organizationId: org._id,
    email: "finance@hireflow.demo",
    passwordHash,
    name: "Rahul Mehta",
    role: "finance_approver",
    title: "Finance Approver",
  });

  await OfferTemplate.create({
    organizationId: org._id,
    name: "Full-time Employee",
    employmentType: "full_time",
    body: "Dear {{candidateName}}, we are pleased to offer you {{jobTitle}} at {{companyName}}.",
  });

  const vacancies = [
    {
      title: "Marketing Specialist",
      slug: "marketing-specialist",
      department: "Marketing",
      location: "Bengaluru",
      workplaceType: "hybrid" as const,
      employmentType: "full_time" as const,
      vacancies: 4,
      filledCount: 1,
      companyLogoHint: "Webflow",
      requirements: [
        { text: "3+ years marketing", kind: "mandatory" as const, skill: "marketing" },
        { text: "Figma", kind: "preferred" as const, skill: "figma" },
      ],
    },
    {
      title: "Financial Analyst",
      slug: "financial-analyst",
      department: "Finance",
      location: "Mumbai",
      workplaceType: "onsite" as const,
      employmentType: "full_time" as const,
      vacancies: 3,
      filledCount: 0,
      companyLogoHint: "Zapier",
      requirements: [
        { text: "Finance degree", kind: "mandatory" as const, skill: "finance" },
        { text: "SQL", kind: "preferred" as const, skill: "sql" },
      ],
    },
    {
      title: "Project Manager",
      slug: "project-manager",
      department: "Management",
      location: "Delhi NCR",
      workplaceType: "hybrid" as const,
      employmentType: "full_time" as const,
      vacancies: 4,
      filledCount: 2,
      companyLogoHint: "Framer",
      requirements: [
        { text: "PMP or equivalent", kind: "preferred" as const, skill: "project" },
      ],
    },
    {
      title: "Graphic Designer",
      slug: "graphic-designer",
      department: "Design",
      location: "Remote",
      workplaceType: "remote" as const,
      employmentType: "full_time" as const,
      vacancies: 2,
      filledCount: 0,
      companyLogoHint: "Grammarly",
      requirements: [{ text: "Figma", kind: "mandatory" as const, skill: "figma" }],
    },
    {
      title: "Data Engineer",
      slug: "data-engineer",
      department: "Development",
      location: "Hyderabad",
      workplaceType: "hybrid" as const,
      employmentType: "full_time" as const,
      vacancies: 1,
      filledCount: 0,
      companyLogoHint: "Ramp",
      requirements: [
        { text: "Python", kind: "mandatory" as const, skill: "python" },
        { text: "AWS", kind: "preferred" as const, skill: "aws" },
      ],
    },
    {
      title: "Software Developer",
      slug: "software-developer",
      department: "Development",
      location: "Bengaluru",
      workplaceType: "remote" as const,
      employmentType: "full_time" as const,
      vacancies: 1,
      filledCount: 0,
      companyLogoHint: "Confluence",
      requirements: [
        { text: "React", kind: "mandatory" as const, skill: "react" },
        { text: "Node.js", kind: "mandatory" as const, skill: "node" },
        { text: "TypeScript", kind: "preferred" as const, skill: "typescript" },
      ],
    },
  ];

  const jobs = [];
  for (const v of vacancies) {
    jobs.push(
      await Job.create({
        organizationId: org._id,
        title: v.title,
        slug: v.slug,
        department: v.department,
        location: v.location,
        workplaceType: v.workplaceType,
        employmentType: v.employmentType,
        vacancies: v.vacancies,
        filledCount: v.filledCount,
        companyLogoHint: v.companyLogoHint,
        requirements: v.requirements,
        description: `We're looking for a ${v.title} who owns outcomes end-to-end — clear communication, full ownership, and collaborative delivery with the wider team.`,
        status: "open",
        recruiterId: alex._id,
        minExperience: 2,
        maxExperience: 6,
        employmentType: "full_time",
        workplaceType: "hybrid",
      }),
    );
  }

  const people = [
    {
      fullName: "Nicolas Trevino",
      email: "nicolas@example.com",
      currentCity: "Vancouver",
      country: "CA",
      currentDesignation: "Back-End Developer",
      level: "senior" as const,
      skills: ["Java", "Python", "Spring Boot", "PostgreSQL", "node", "aws"],
      totalExperience: 6,
      about:
        "Backend engineer focused on resilient APIs and data platforms for high-growth product teams.",
      workHistory: [
        {
          company: "Confluence",
          title: "Senior Backend Engineer",
          location: "Remote",
          startDate: "2022",
          endDate: "Present",
        },
        {
          company: "Feedly",
          title: "Backend Developer",
          location: "San Francisco",
          startDate: "2019",
          endDate: "2022",
        },
      ],
      githubUrl: "https://github.com/nic-trevino",
      portfolioUrl: "https://nicolastrevino.com",
    },
    {
      fullName: "Alec Whitten",
      email: "alec@example.com",
      currentCity: "New York",
      country: "US",
      currentDesignation: "Software Developer",
      level: "senior" as const,
      skills: ["react", "typescript", "node"],
      totalExperience: 5,
    },
    {
      fullName: "Risa Nakamoto",
      email: "risa@example.com",
      currentCity: "Tokyo",
      country: "JP",
      currentDesignation: "Product Designer",
      level: "junior" as const,
      skills: ["figma", "marketing"],
      totalExperience: 2,
    },
    {
      fullName: "Drew Cano",
      email: "drew@example.com",
      currentCity: "Austin",
      country: "US",
      currentDesignation: "Data Engineer",
      level: "mid" as const,
      skills: ["python", "aws", "sql"],
      totalExperience: 4,
    },
    {
      fullName: "Lana Steiner",
      email: "lana@example.com",
      currentCity: "Berlin",
      country: "DE",
      currentDesignation: "Financial Analyst",
      level: "mid" as const,
      skills: ["finance", "sql"],
      totalExperience: 3,
    },
    {
      fullName: "Kaiya George",
      email: "kaiya@example.com",
      currentCity: "Singapore",
      country: "SG",
      currentDesignation: "Project Manager",
      level: "senior" as const,
      skills: ["project"],
      totalExperience: 7,
    },
  ];

  const softJob = jobs.find((j) => j.slug === "software-developer")!;
  let nicolasApp = null;

  for (const p of people) {
    const candidate = await Candidate.create({
      organizationId: org._id,
      ...p,
      source: "manual",
      ownerUserId: alex._id,
      noticePeriodDays: 30,
    });
    const job =
      p.currentDesignation.includes("Back-End") || p.currentDesignation.includes("Software")
        ? softJob
        : jobs[Math.floor(Math.random() * jobs.length)]!;
    const explanation = computeFitScore({
      skills: candidate.skills,
      totalExperience: candidate.totalExperience,
      relevantExperience: candidate.totalExperience,
      noticePeriodDays: 30,
      currentDesignation: candidate.currentDesignation,
      workHistory: candidate.workHistory.map((w) => ({
        company: w.company ?? undefined,
        title: w.title ?? undefined,
        description: w.description ?? undefined,
      })),
      education: [],
      certifications: [],
      projects: [],
      job: {
        minExperience: job.minExperience,
        maxExperience: job.maxExperience,
        title: job.title,
        requirements: job.requirements.map((r) => ({
          text: r.text,
          kind: r.kind,
          skill: r.skill,
        })),
      },
    });
    const app = await Application.create({
      organizationId: org._id,
      jobId: job._id,
      candidateId: candidate._id,
      source: "manual",
      stage: "shortlisted",
      fitScore: explanation.score,
      fitExplanation: explanation,
      eligibility: explanation.eligibility,
    });
    if (candidate.email === "nicolas@example.com") nicolasApp = app;
  }

  if (nicolasApp) {
    const start = new Date();
    start.setHours(10, 30, 0, 0);
    if (start < new Date()) start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setHours(11, 30, 0, 0);
    await Interview.create({
      organizationId: org._id,
      applicationId: nicolasApp._id,
      type: "technical",
      startsAt: start,
      endsAt: end,
      meetingUrl: "https://meet.example.com/hireflow-demo",
      interviewerIds: [alex._id],
      status: "scheduled",
    });
  }

  await Notification.create([
    {
      organizationId: org._id,
      userId: alex._id,
      type: "interview",
      title: "Interview upcoming",
      body: "Nicolas Trevino interview starts soon",
      link: "/app/schedule",
    },
    {
      organizationId: org._id,
      userId: alex._id,
      type: "candidate",
      title: "New application",
      body: "Alec Whitten applied to Software Developer",
      link: "/app/candidates",
    },
    {
      organizationId: org._id,
      userId: alex._id,
      type: "offer",
      title: "Offer awaiting approval",
      body: "Finance approval pending",
      link: "/app/offers",
    },
    {
      organizationId: org._id,
      userId: alex._id,
      type: "system",
      title: "Welcome to HireFlow",
      body: "Your demo workspace is ready",
      link: "/app",
    },
  ]);

  logger.info("Seed complete", {
    login: "alex@hireflow.demo / Password123!",
    admin: "admin@hireflow.demo / Password123!",
  });
}
