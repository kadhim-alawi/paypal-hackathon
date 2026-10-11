/**
 * Converts a JSON Schema into the subset Claude's structured outputs accept:
 * nullable types become `anyOf` with null, every object is closed
 * (`additionalProperties: false`, all keys required), and constraints the API
 * doesn't enforce (patterns, item counts, numeric bounds) move into the
 * description, where the model still reads them. Used for AG Grid's AI Toolkit
 * schema, which uses `type: ["object", "null"]` throughout.
 */
type Schema = Record<string, unknown>;

const MOVED_TO_DESCRIPTION = ["pattern", "minLength", "maxLength", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"];
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

export function toStrictSchema(input: Schema): Schema {
  const node: Schema = { ...input };
  const notes: string[] = [];

  if (node.$defs && typeof node.$defs === "object") {
    node.$defs = Object.fromEntries(Object.entries(node.$defs as Record<string, Schema>).map(([k, v]) => [k, toStrictSchema(v)]));
  }
  if (typeof node.$ref === "string") return node.$defs ? { $ref: node.$ref, $defs: node.$defs } : { $ref: node.$ref };

  // ["object", "null"] → anyOf: [{...object}, {type: "null"}]
  if (Array.isArray(node.type)) {
    const types = (node.type as string[]).filter((t) => t !== "null");
    const nullable = (node.type as string[]).includes("null");
    const { description, ...rest } = node;
    const variants = types.map((t) => toStrictSchema({ ...rest, type: t }));
    if (nullable) variants.push({ type: "null" });
    if (variants.length === 1) return description ? { ...variants[0], description } : variants[0]!;
    return description ? { anyOf: variants, description } : { anyOf: variants };
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(node[key])) {
      const out: Schema = { [key === "oneOf" ? "anyOf" : key]: (node[key] as Schema[]).map(toStrictSchema) };
      if (key === "oneOf") delete node.oneOf;
      if (node.description) out.description = node.description;
      return out;
    }
  }

  for (const key of MOVED_TO_DESCRIPTION) {
    if (node[key] !== undefined) {
      notes.push(`${key}: ${JSON.stringify(node[key])}`);
      delete node[key];
    }
  }
  if (node.minItems !== undefined && node.minItems !== 0 && node.minItems !== 1) {
    notes.push(`minItems: ${JSON.stringify(node.minItems)}`);
    delete node.minItems;
  }
  if (typeof node.format === "string" && !SUPPORTED_FORMATS.has(node.format)) {
    notes.push(`format: ${node.format}`);
    delete node.format;
  }

  if (node.type === "object") {
    const props = (node.properties ?? {}) as Record<string, Schema>;
    node.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toStrictSchema(v)]));
    node.required = Object.keys(props);
    node.additionalProperties = false;
  } else if (node.type === "array" && node.items && typeof node.items === "object") {
    node.items = toStrictSchema(node.items as Schema);
  }

  if (notes.length) node.description = [node.description, `(${notes.join("; ")})`].filter(Boolean).join(" ");
  return node;
}
