/**
 * Image generation provider.
 *
 * Behind an interface so the concrete service is one implementation detail
 * rather than a dependency threaded through the app. Replicate is the first
 * implementation (ARCHITECTURE §2 names "Replicate or fal.ai").
 */
export type GenerateConceptInput = {
  prompt: string;
  /** Aspect guidance derived from the project's real proportions. */
  widthPx: number;
  heightPx: number;
};

export type GenerateSiteInput = GenerateConceptInput & {
  /** The site photograph the proposal is composited onto. */
  imageBytes: Buffer;
  imageMimeType: string;
};

export type GeneratedImage = {
  bytes: Buffer;
  mimeType: string;
  model: string;
};

export interface MockupProvider {
  readonly name: string;
  generateConcept(input: GenerateConceptInput): Promise<GeneratedImage>;
  generateOnSite(input: GenerateSiteInput): Promise<GeneratedImage>;
}

export const CONCEPT_MODEL =
  process.env.REPLICATE_CONCEPT_MODEL?.trim() || 'black-forest-labs/flux-1.1-pro';

export const SITE_MODEL =
  process.env.REPLICATE_SITE_MODEL?.trim() || 'black-forest-labs/flux-kontext-pro';

export function isMockupConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN?.trim());
}

/** Downloads a generated image, whatever shape the provider returns. */
async function fetchOutput(output: unknown): Promise<Buffer> {
  // Replicate returns either a URL, an array of URLs, or a FileOutput with a
  // url() method depending on the model. Handling all three keeps a model swap
  // from becoming a code change.
  const candidate = Array.isArray(output) ? output[0] : output;

  if (candidate && typeof candidate === 'object' && 'url' in candidate) {
    const url = (candidate as { url: () => URL | string }).url();
    const response = await fetch(String(url));
    return Buffer.from(await response.arrayBuffer());
  }

  if (typeof candidate === 'string') {
    const response = await fetch(candidate);
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('The image provider returned no usable image.');
}

export function createReplicateProvider(): MockupProvider {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error('REPLICATE_API_TOKEN is not set.');

  return {
    name: 'replicate',

    async generateConcept(input) {
      const { default: Replicate } = await import('replicate');
      const client = new Replicate({ auth: token });

      const output = await client.run(CONCEPT_MODEL as `${string}/${string}`, {
        input: {
          prompt: input.prompt,
          width: input.widthPx,
          height: input.heightPx,
          output_format: 'png',
        },
      });

      return { bytes: await fetchOutput(output), mimeType: 'image/png', model: CONCEPT_MODEL };
    },

    async generateOnSite(input) {
      const { default: Replicate } = await import('replicate');
      const client = new Replicate({ auth: token });

      // The site photo is sent as a data URI so the bucket stays private — the
      // same reasoning as the vision layer in T2.
      const dataUri = `data:${input.imageMimeType};base64,${input.imageBytes.toString('base64')}`;

      const output = await client.run(SITE_MODEL as `${string}/${string}`, {
        input: {
          prompt: input.prompt,
          input_image: dataUri,
          output_format: 'png',
        },
      });

      return { bytes: await fetchOutput(output), mimeType: 'image/png', model: SITE_MODEL };
    },
  };
}
