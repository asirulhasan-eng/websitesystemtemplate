# Codex image model availability: handling variant requests

## Purpose
When a user asks for a different image model (for example `gpt-image-2-high`), validate what is actually configured and supported instead of guessing from model names.

## Current configured baseline
- `image_gen.provider` is expected to be `openai-codex`.
- `image_gen.model` is expected to be `gpt-image-2-medium` in this {{SITE_NAME}} setup.
- Always treat this as environment state, not a permanent global truth.

## Standard check before changing model
1. Read the active config:
   - `hermes config get image_gen.provider`
   - `hermes config get image_gen.model`
2. Inspect the active reference docs for the workflow you are using (for example `references/codex-image-generate-preview-finalization.md` and this note).
3. Execute a real smoke `image_generate` call with the requested model/prompt and confirm returned evidence.

## Evidence you must capture
- `provider` returned by the tool call
- `model` returned by the tool call
- result `image` path

## Decision rule for unavailable variants
- If the requested variant is unavailable or unsupported, keep the validated supported model and report this clearly.
- Do **not** claim success from a failed or missing model call.
- Do **not** switch to SVG/HTML/canvas/Sharp fallback for blog work unless the user explicitly requests it in the current task.

## Practical workflow impact
For scheduled/semi-safe blog publishing, failing to produce valid image evidence should block image-dependent claims and keep the workflow in blocked/review state until fixed. This includes refusing to claim infographic completion without a real `image_generate` success manifest.