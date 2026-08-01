import { z } from "zod";

const optionsSchema = z.object({ purpose: z.enum(["monitoring", "provisioning"]) }).strict();

export function parseGitLabCredentialInstallOptions(
  values: string[],
): z.infer<typeof optionsSchema> {
  const options = values[0] === "--" ? values.slice(1) : values;
  if (options.length !== 2 || options[0] !== "--purpose") {
    throw new Error("Usage: gitlab:credential:install --purpose monitoring|provisioning");
  }
  return optionsSchema.parse({ purpose: options[1] });
}
