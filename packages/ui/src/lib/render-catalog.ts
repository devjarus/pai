import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * PAI Result Catalog — defines the UI components that research/swarm
 * LLM prompts can use to render structured results.
 *
 * The LLM generates a json-render "spec" using these components.
 * The Renderer maps specs to React components via the registry.
 */
export const resultCatalog = defineCatalog(schema, {
  components: {
    // Layout
    Section: {
      props: z.object({
        title: z.string(),
        subtitle: z.string().nullable(),
        collapsible: z.boolean().nullable(),
        defaultOpen: z.boolean().nullable(),
      }),
      slots: ["default"],
      description: "A titled section that groups related content. Use for report sections.",
    },
    Stack: {
      props: z.object({
        direction: z.enum(["horizontal", "vertical"]).nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
        wrap: z.boolean().nullable(),
      }),
      slots: ["default"],
      description: "Flex container for arranging children horizontally or vertically.",
    },
    Grid: {
      props: z.object({
        columns: z.number().nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      slots: ["default"],
      description: "Grid layout. Use for metric cards, comparison tables.",
    },

    // Data display
    MetricCard: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        unit: z.string().nullable(),
        trend: z.enum(["up", "down", "neutral"]).nullable(),
        description: z.string().nullable(),
      }),
      description: "Displays a single metric with label, value, optional trend arrow. Use for prices, percentages, counts.",
    },
    DataTable: {
      props: z.object({
        columns: z.array(z.union([
          z.object({
            key: z.string().optional(),
            label: z.string().optional(),
            align: z.enum(["left", "center", "right"]).nullable().optional(),
          }),
          z.string(),
        ])),
        rows: z.array(z.record(z.string(), z.unknown())),
        highlightFirst: z.boolean().nullable().optional(),
      }),
      description: "Table for structured data. columns: array of {key, label, align} objects. rows: array of objects where keys MUST match column key values. Example: columns=[{key:'ticker',label:'Ticker'}], rows=[{ticker:'AAPL'}].",
    },
    Badge: {
      props: z.object({
        text: z.string(),
        variant: z.enum(["success", "warning", "danger", "info", "neutral"]).nullable(),
      }),
      description: "Small colored label. Use for verdict, status, category, confidence level.",
    },
    ProgressBar: {
      props: z.object({
        value: z.number(),
        max: z.number().nullable(),
        label: z.string().nullable(),
        variant: z.enum(["success", "warning", "danger", "info"]).nullable(),
      }),
      description: "Progress or confidence bar. Use for confidence %, completion, scores.",
    },
    LineChart: {
      props: z.object({
        title: z.string().nullable(),
        labels: z.array(z.string()),
        values: z.array(z.number()),
        color: z.string().nullable(),
        valuePrefix: z.string().nullable(),
        valueSuffix: z.string().nullable(),
        minValue: z.number().nullable(),
        maxValue: z.number().nullable(),
        showArea: z.boolean().nullable(),
      }),
      description: "Line chart for time-series or trend data. labels and values must have the same length.",
    },
    BarChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.object({
          label: z.string(),
          value: z.number(),
          color: z.string().nullable().optional(),
        })),
        valuePrefix: z.string().nullable(),
        valueSuffix: z.string().nullable(),
        maxValue: z.number().nullable(),
      }),
      description: "Bar chart for ranked comparisons or categorical values.",
    },
    DonutChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.object({
          label: z.string(),
          value: z.number(),
          color: z.string().nullable().optional(),
        })),
        centerLabel: z.string().nullable(),
        valueSuffix: z.string().nullable(),
      }),
      description: "Donut chart for composition, allocation, or share-of-total data.",
    },

    // Content
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["1", "2", "3"]).nullable(),
      }),
      description: "Heading text. Use for report titles and section headers.",
    },
    Text: {
      props: z.object({
        content: z.string(),
        variant: z.enum(["body", "caption", "bold", "muted"]).nullable(),
      }),
      description: "Text paragraph. Supports basic formatting.",
    },
    Markdown: {
      props: z.object({
        content: z.string(),
      }),
      description: "Renders markdown content inline. Use for rich text blocks within structured layouts.",
    },
    BulletList: {
      props: z.object({
        items: z.array(z.string()),
        icon: z.enum(["bullet", "check", "warning", "arrow-up", "arrow-down"]).nullable(),
        variant: z.enum(["default", "success", "danger", "warning"]).nullable(),
      }),
      description: "Bulleted list. Use for risks, catalysts, key points, recommendations.",
    },

    // Interactive
    LinkButton: {
      props: z.object({
        url: z.string(),
        text: z.string(),
        icon: z.enum(["external", "booking", "source", "chart"]).nullable(),
        variant: z.enum(["primary", "secondary", "outline"]).nullable(),
      }),
      description: "Clickable link button. Use for booking URLs, source links, artifact links.",
    },
    SourceList: {
      props: z.object({
        sources: z.array(z.object({
          title: z.string(),
          url: z.string(),
        })),
      }),
      description: "List of source links with icons. Use at the bottom of reports.",
    },

    // Media
    ChartImage: {
      props: z.object({
        src: z.string(),
        alt: z.string(),
        caption: z.string().nullable(),
      }),
      description: "Displays a chart image from artifact URL or data URI.",
    },

    // Specialized (optional premium renderers for established types)
    FlightOption: {
      props: z.object({
        airline: z.string(),
        flightNo: z.string().nullable(),
        departure: z.string(),
        arrival: z.string(),
        duration: z.string(),
        stops: z.number(),
        price: z.string(),
        currency: z.string().nullable(),
        score: z.number().nullable(),
        scoreReason: z.string().nullable(),
        bookingUrl: z.string().nullable(),
        baggage: z.string().nullable(),
        refundable: z.boolean().nullable(),
      }),
      description: "Single flight option card with details and booking CTA.",
    },
  },

  actions: {
    open_link: {
      params: z.object({ url: z.string() }),
      description: "Open a URL in a new tab",
    },
  },
});

/**
 * Generate the system prompt fragment for LLMs.
 * Include this in research/swarm prompts so the LLM knows
 * which UI components are available.
 */
export function getResultRenderPrompt(): string {
  return resultCatalog.prompt({
    customRules: [
      "Always use Section as the top-level element to group content",
      "Use Grid with MetricCard children for key metrics (2-4 columns)",
      "Use DataTable for comparing multiple items (flights, stocks, etc.)",
      "Use BulletList for risks, catalysts, recommendations",
      "Use Badge for verdict, status, and category labels",
      "Use LineChart, BarChart, or DonutChart when quantitative data exists and a native chart communicates it better than a static image",
      "Use ChartImage for static chart artifacts at /api/artifacts/<id> when visuals are available",
      "Use LinkButton for artifact downloads or high-value external links",
      "Use SourceList at the end for all reference links",
      "Keep the spec concise — avoid deeply nested structures",
    ],
  });
}
