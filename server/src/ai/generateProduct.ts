import Anthropic from "@anthropic-ai/sdk";

export interface ProductDraft {
  title: string;
  descriptionHtml: string;
  highlights: string;
  vendor: string;
}

const SYSTEM_PROMPT = `You draft e-commerce product listings for a Daraz/Shopify seller from a short, rough description.
Reply with ONLY a JSON object (no markdown fences, no commentary) with exactly these string fields:
- "title": a concise, sellable product title (under 100 characters)
- "descriptionHtml": a persuasive product description as simple HTML using only <p> and <ul><li> tags
- "highlights": 3-5 short selling points, one per line, no bullets or numbering
- "vendor": a plausible brand/vendor name, or "No Brand" if none is implied
Do not invent specific prices, SKUs, or measurements.`;

export async function generateProductDraft(prompt: string): Promise<ProductDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI response was not valid JSON");
  }

  const draft = parsed as Partial<ProductDraft>;
  if (typeof draft.title !== "string" || typeof draft.descriptionHtml !== "string") {
    throw new Error("AI response was missing required fields");
  }

  return {
    title: draft.title,
    descriptionHtml: draft.descriptionHtml,
    highlights: typeof draft.highlights === "string" ? draft.highlights : "",
    vendor: typeof draft.vendor === "string" ? draft.vendor : "",
  };
}
