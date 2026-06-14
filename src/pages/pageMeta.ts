import {
  Cloud,
  Database,
  FileCode2,
  History,
  LayoutDashboard,
  Layers3,
  ScrollText,
  Send,
  Settings,
  Workflow
} from "lucide-react";

export type PageId =
  | "dashboard"
  | "submit"
  | "history"
  | "logs"
  | "templates"
  | "appConfig"
  | "clusters"
  | "s3"
  | "settings";

export const navigationItems = [
  { id: "submit", label: "Submit Job", description: "Template-driven submission", icon: Send },
  { id: "history", label: "Job History", description: "Track and clone jobs", icon: History },
  { id: "logs", label: "Logs", description: "CloudWatch browsing", icon: ScrollText },
  { id: "templates", label: "Resource Templates", description: "Spark sizing presets", icon: Layers3 },
  { id: "appConfig", label: "Application Config", description: "Submit JSON templates", icon: Workflow },
  { id: "dashboard", label: "Dashboard", description: "Activity overview", icon: LayoutDashboard },
  { id: "clusters", label: "Virtual Clusters", description: "EMR on EKS clusters", icon: Database },
  { id: "s3", label: "S3 Browser", description: "Text file editing", icon: FileCode2 },
  { id: "settings", label: "Settings", description: "AWS credentials", icon: Settings }
] as const satisfies Array<{
  id: PageId;
  label: string;
  description: string;
  icon: typeof Cloud;
}>;
