import { z } from "zod";

/**
 * A field contract is the single source of truth for one column of scraped data.
 *
 * The `description` is deliberately written in plain language, because it serves
 * two masters: it documents the field for humans, and it is the exact text handed
 * to `bdata scraper heal` when the field stops extracting. Keeping one description
 * for both means a healed scraper can never drift from what the contract promised.
 */
export const FieldContract = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, "field names are lower_snake_case"),

    /** Plain-language definition. Reused verbatim as heal instructions. */
    description: z.string().min(10).max(240),

    type: z.enum(["string", "number", "integer", "boolean", "url", "date"]),

    /** A field that may legitimately be absent on some rows. */
    required: z.boolean().default(true),

    /**
     * Share of rows that must carry a usable value before the field is
     * considered healthy. Below this, the field is a heal candidate.
     */
    minFillRate: z.number().min(0).max(1).default(0.9),

    /** Optional regex the string form of the value must satisfy. */
    pattern: z.string().optional(),

    /** Optional inclusive bounds for numeric fields. Guards against unit drift. */
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();

export type FieldContract = z.infer<typeof FieldContract>;

/** Row-level expectations that catch breakage the per-field checks would miss. */
export const ShapeExpectations = z
  .object({
    /** A run returning fewer rows than this is broken regardless of fill rates. */
    minRows: z.number().int().min(0).default(1),

    /**
     * Largest tolerated shrink against the last healthy run, as a ratio.
     * 0.5 means "a run that returns less than half of what we saw last time is
     * suspicious" — this is how silent pagination breakage gets caught.
     */
    maxRowShrinkRatio: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export type ShapeExpectations = z.infer<typeof ShapeExpectations>;

export const Contract = z
  .object({
    /** Stable local identifier, independent of the Bright Data collector. */
    id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),

    /**
     * The Bright Data Collector ID (`c_*`). Healing never changes it, which is
     * the whole point: downstream consumers keep pointing at the same endpoint.
     */
    collectorId: z.string().regex(/^c_[a-z0-9]+$/, "expected a c_* Collector ID"),

    /** Pages the sentinel probes on every sweep. Keep these few and stable. */
    canaries: z.array(z.string().url()).min(1),

    fields: z.array(FieldContract).min(1),
    shape: ShapeExpectations.default({ minRows: 1, maxRowShrinkRatio: 0.5 }),

    /**
     * Overall score under which the supervisor is allowed to spend credits on a
     * heal. Set conservatively — healing is not free.
     */
    healBelowScore: z.number().min(0).max(1).default(0.8),
  })
  .strict()
  .superRefine((contract, ctx) => {
    const seen = new Set<string>();
    for (const field of contract.fields) {
      if (seen.has(field.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate field "${field.name}"`,
          path: ["fields"],
        });
      }
      seen.add(field.name);
    }
  });

export type Contract = z.infer<typeof Contract>;
