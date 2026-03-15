export interface WatchTemplate {
  id: string;
  name: string;
  description: string;
  category: "price" | "news" | "competitor" | "availability" | "general";
  defaultGoal: (subject: string) => string;
  defaultIntervalHours: number;
  defaultDeliveryMode: "always" | "change-gated";
  defaultDepthLevel: "quick" | "standard" | "deep";
}

const templates: WatchTemplate[] = [
  {
    id: "price-watch",
    name: "Price Watch",
    description: "Track price changes for a product or asset",
    category: "price",
    defaultGoal: (subject) =>
      `Monitor the price of ${subject} and report any changes`,
    defaultIntervalHours: 6,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "quick",
  },
  {
    id: "news-watch",
    name: "News Watch",
    description: "Stay informed about news on a topic",
    category: "news",
    defaultGoal: (subject) =>
      `Find and summarize the latest news about ${subject}`,
    defaultIntervalHours: 12,
    defaultDeliveryMode: "always",
    defaultDepthLevel: "standard",
  },
  {
    id: "competitor-watch",
    name: "Competitor Watch",
    description: "Track a competitor's public activity",
    category: "competitor",
    defaultGoal: (subject) =>
      `Monitor public announcements, product launches, and updates from ${subject}`,
    defaultIntervalHours: 24,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "deep",
  },
  {
    id: "availability-watch",
    name: "Availability Watch",
    description: "Check whether something is available or in stock",
    category: "availability",
    defaultGoal: (subject) =>
      `Check whether ${subject} is available and report its status`,
    defaultIntervalHours: 4,
    defaultDeliveryMode: "change-gated",
    defaultDepthLevel: "quick",
  },
  {
    id: "general-watch",
    name: "General Watch",
    description: "Generic monitoring for any topic",
    category: "general",
    defaultGoal: (subject) =>
      `Keep track of updates related to ${subject} and brief me on notable changes`,
    defaultIntervalHours: 24,
    defaultDeliveryMode: "always",
    defaultDepthLevel: "standard",
  },
];

/** Return all available watch templates. */
export function listTemplates(): WatchTemplate[] {
  return [...templates];
}

/** Return a single template by id, or undefined if not found. */
export function getTemplate(id: string): WatchTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export interface AppliedTemplate {
  goal: string;
  intervalHours: number;
  deliveryMode: "always" | "change-gated";
  depthLevel: "quick" | "standard" | "deep";
  label: string;
}

/**
 * Apply a template to a given subject, producing concrete watch parameters.
 * Returns undefined if the template id is not found.
 */
export function applyTemplate(
  templateId: string,
  opts: { subject: string },
): AppliedTemplate | undefined {
  const tpl = getTemplate(templateId);
  if (!tpl) return undefined;

  return {
    goal: tpl.defaultGoal(opts.subject),
    intervalHours: tpl.defaultIntervalHours,
    deliveryMode: tpl.defaultDeliveryMode,
    depthLevel: tpl.defaultDepthLevel,
    label: `${tpl.name}: ${opts.subject}`,
  };
}
