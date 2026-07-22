export type RevenueCategory = "inference" | "gpu_cluster" | "credits_other";

export const REVENUE_CATEGORIES: RevenueCategory[] = ["inference", "gpu_cluster", "credits_other"];

export const REVENUE_CATEGORY_LABELS: Record<RevenueCategory, string> = {
  inference: "Inference",
  gpu_cluster: "GPU cluster",
  credits_other: "Credits / other",
};

export const REVENUE_CATEGORY_BAR_CLASSES: Record<RevenueCategory, string> = {
  inference: "bg-violet-400",
  gpu_cluster: "bg-amber-400",
  credits_other: "bg-zinc-400",
};

export const REVENUE_CATEGORY_FILL_CLASSES: Record<RevenueCategory, string> = {
  inference: "fill-violet-400",
  gpu_cluster: "fill-amber-400",
  credits_other: "fill-zinc-400",
};
