# packages/shared

Code shared between `apps/web` and `services/render`:

- `schemas/` — zod schemas for every LLM structured output and job payload
- `providers/` — provider adapter interface + kie.ai, fal.ai, ElevenLabs, etc.
- `prompts/` — the prompt registry (versioned, see spec §2 rule 11)
