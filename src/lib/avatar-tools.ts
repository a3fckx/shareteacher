// ─────────────────────────────────────────────────────────────────────────
// Runway GWM-1 avatar tools — the single source of truth for what the live
// Character can call. (Mirrors the official example file path
// `runwayml/avatars-sdk-react → examples/nextjs-client-events/lib/avatar-tools.ts`.)
//
// These definitions are consumed in TWO places and MUST stay in sync:
//   • SERVER  — serialized into the `tools` array of the realtime session
//               CREATE payload (`POST /v1/realtime_sessions`). See `RUNWAY_TOOLS`.
//   • CLIENT  — registered as fire-and-forget handlers in the browser via the
//               built-in <PageActions/> component and `useClientEvent(tool, …)`.
//
// WIRE FORMAT (verified against the installed SDK runtime
// node_modules/@runwayml/avatars/dist/api.js + api.d.ts — re-exported by
// `@runwayml/avatars-react/api` — and the avatars-sdk-react example
// `examples/nextjs-client-events/lib/avatar-tools.ts`):
//
//   {
//     "type": "client_event",          // fire-and-forget UI tool (no return)
//     "name": "highlight",             // or "backend_rpc" for server tools that return
//     "description": "…",
//     "parameters": [
//       { "name": "target", "type": "string", "description": "…",
//         "items": { "type": "string" } }   // items only for type:"array"
//     ]
//   }
//
// CRITICAL: `clientTool(name,{description,schema})` serializes to ONLY
// `{ type, name, description }` at runtime (confirmed in api.js: the Zod
// `schema` is stashed in a WeakMap via `toolSchemas.set` and is NEVER sent over
// the wire). The model-facing `parameters` array therefore has to be authored
// EXPLICITLY and kept in sync with the schema — this is exactly what the
// built-in `pageActionTools` do (they spread the `clientTool` def and append a
// `parameters` array). The schema is used client-side only, for type inference
// and `useClientEvent` runtime validation.
//
// This module is server-safe: `@runwayml/avatars-react/api` re-exports the
// fetch-only `@runwayml/avatars/api` subpath (no React, no DOM), so it can be
// imported from both the API route (server) and AvatarStage (client). We do NOT
// need `@runwayml/sdk`: the create payload is plain JSON and the app's own
// RunwayHttp already POSTs the identical `/v1/realtime_sessions` endpoints, so
// serializing to this documented shape is the supported path.
// ─────────────────────────────────────────────────────────────────────────

import { clientTool, pageActionTools } from "@runwayml/avatars-react/api";
import { z } from "zod";

/** A single model-facing tool parameter (kept loose to match `pageActionTools`). */
export interface RealtimeToolParam {
  name: string;
  type: string; // "string" | "number" | "boolean" | "array" | "object"
  description: string;
  items?: { type: string }; // present only for `type: "array"`
}

/** The exact JSON shape a tool takes inside `realtimeSessions.create({ tools })`. */
export interface RealtimeToolDef {
  type: string; // "client_event" (UI, no return) | "backend_rpc" (returns to LLM)
  name: string;
  description: string;
  parameters?: RealtimeToolParam[];
}

// ── share_screen — agent-driven "look at the teaching browser" ───────────────
// The browser's getDisplayMedia()/toggleScreenShare() requires a real human
// gesture, so the agent can NOT silently start an OS screen share. In our app
// the teaching screen is already the embedded Kernel live-view <iframe>. This
// client tool lets the avatar bring that viewport to the FOREGROUND (full-bleed)
// on the stage and back — i.e. the agent decides what the class is looking at.
// Fire-and-forget: client tools never return a value to the model.
const shareScreenSchema = z.object({
  focus: z.enum(["foreground", "restore"]).default("foreground"),
  reason: z.string().optional(),
});

/** Args the browser handler receives for `share_screen` (inferred from the schema). */
export type ShareScreenArgs = z.infer<typeof shareScreenSchema>;

export const shareScreenTool = clientTool("share_screen", {
  description:
    "Control what the class is looking at on the shared stage. Pass " +
    "focus='foreground' to bring the live teaching browser full-screen so " +
    "everyone watches it, or focus='restore' to return to the normal classroom " +
    "layout. Call this whenever you say things like 'let me show you on screen', " +
    "'look at this', or when you want the class to focus on the browser.",
  schema: shareScreenSchema,
});

/** Model-facing serialization of `share_screen` (schema is not sent — author it here). */
const shareScreenServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "share_screen",
  description: shareScreenTool.description,
  parameters: [
    {
      name: "focus",
      type: "string",
      description:
        "'foreground' to bring the live teaching browser full-screen; 'restore' to return to the normal layout. Defaults to 'foreground'.",
    },
    {
      name: "reason",
      type: "string",
      description:
        "Optional short phrase shown to the class, e.g. 'Let me show you this on screen'.",
    },
  ],
};

// ── take_control — agent-driven "take the class fully into the live browser" ──
// Like share_screen but for the FULL-CONTROL moment: the live teaching browser
// goes edge-to-edge (the exact live view) so the class is fully inside the
// browser while the teacher demonstrates hands-on. The floating avatar PiP stays
// on top. mode='full' enters; mode='exit' returns to the normal screen.
// Fire-and-forget: client tools never return a value to the model.
const takeControlSchema = z.object({
  mode: z.enum(["full", "exit"]).optional(),
  reason: z.string().optional(),
});

/** Args the browser handler receives for `take_control` (inferred from the schema). */
export type TakeControlArgs = z.infer<typeof takeControlSchema>;

export const takeControlTool = clientTool("take_control", {
  description:
    "Take the class FULLY into the live teaching browser. Pass mode='full' to " +
    "go edge-to-edge full-screen on the exact live browser view (your floating " +
    "avatar stays on top) when you want to demonstrate hands-on, then mode='exit' " +
    "to return to the normal screen. Use it for 'let me take over and show you " +
    "directly' moments.",
  schema: takeControlSchema,
});

/** Model-facing serialization of `take_control` (schema is not sent — author it here). */
const takeControlServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "take_control",
  description: takeControlTool.description,
  parameters: [
    {
      name: "mode",
      type: "string",
      description:
        "'full' to take the class fully into the live browser (edge-to-edge exact view); 'exit' to return to the normal screen. Defaults to 'full'.",
    },
    {
      name: "reason",
      type: "string",
      description:
        "Optional short phrase shown to the class, e.g. 'Let me take over and show you directly'.",
    },
  ],
};

// ── Visual presentation tools — zoom / spotlight / arrow / circle / caption ──
// These drive the <AnnotationOverlay/> that sits over the LIVE BROWSER viewport.
// The Kernel live browser is a cross-origin iframe with NO addressable inner DOM,
// so in-browser annotations are positioned by NORMALIZED coordinates: x/y/w/h as
// 0..1 fractions of the viewport box, which the agent estimates from the
// screenshots it is shown. Flat numeric params (never a nested region object) to
// match how the built-in pageActionTools author their `parameters` arrays.
//
// Robustness: schemas use `z.coerce.number()` so a stringy "0.8" still parses,
// and the descriptions steer the model toward 0..1 fractions. Type mismatches
// make `validateClientToolArgs` return null and the SDK silently drops the event,
// so coercion materially improves reliability.

const num = z.coerce.number();

/** Shared region params (x/y/w/h as 0..1 fractions of the viewport box). */
const REGION_PARAMS: RealtimeToolParam[] = [
  {
    name: "x",
    type: "number",
    description:
      "Left edge as a 0..1 fraction of the live browser viewport width (estimate from what you see on screen).",
  },
  {
    name: "y",
    type: "number",
    description: "Top edge as a 0..1 fraction of the viewport height.",
  },
  {
    name: "w",
    type: "number",
    description: "Width as a 0..1 fraction of the viewport width.",
  },
  {
    name: "h",
    type: "number",
    description: "Height as a 0..1 fraction of the viewport height.",
  },
];

// ── zoom — magnify a region of the live browser ──────────────────────────────
const zoomSchema = z.object({
  target: z.string().optional(),
  x: num.min(0).max(1).optional(),
  y: num.min(0).max(1).optional(),
  w: num.min(0).max(1).optional(),
  h: num.min(0).max(1).optional(),
  scale: num.min(1).max(5).optional(),
  duration: num.int().positive().optional(),
  reset: z.boolean().optional(),
});
export type ZoomArgs = z.infer<typeof zoomSchema>;
export const zoomTool = clientTool("zoom", {
  description:
    "Magnify a region of the LIVE BROWSER so the class can read it. Pass x/y/w/h " +
    "as 0..1 fractions of the viewport (estimate from the screen). The view eases " +
    "in, holds, then eases back out. Pass reset=true to zoom back out now. Use it " +
    "when you say things like 'look closely at this' or 'let me zoom in'.",
  schema: zoomSchema,
});
const zoomServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "zoom",
  description: zoomTool.description,
  parameters: [
    {
      name: "target",
      type: "string",
      description:
        "Optional panel id to frame (usually omit; the live browser has no inner ids — pass x/y/w/h).",
    },
    ...REGION_PARAMS,
    {
      name: "scale",
      type: "number",
      description: "Optional magnification 1..5; omit to auto-fit the region.",
    },
    {
      name: "duration",
      type: "number",
      description: "Milliseconds to hold before easing out. Default 6000.",
    },
    {
      name: "reset",
      type: "boolean",
      description: "true = zoom back out to the full page immediately.",
    },
  ],
};

// ── spotlight — dim everything except one region ─────────────────────────────
const spotlightSchema = z.object({
  target: z.string().optional(),
  x: num.min(0).max(1).optional(),
  y: num.min(0).max(1).optional(),
  w: num.min(0).max(1).optional(),
  h: num.min(0).max(1).optional(),
  shape: z.enum(["circle", "rect"]).optional(),
  label: z.string().optional(),
  duration: num.int().positive().optional(),
});
export type SpotlightArgs = z.infer<typeof spotlightSchema>;
export const spotlightTool = clientTool("spotlight", {
  description:
    "Dim everything except one region of the live browser to force focus. Give " +
    "x/y/w/h (0..1). Optional label is shown as a caption under the spotlight. " +
    "Use it for 'everyone look right here'.",
  schema: spotlightSchema,
});
const spotlightServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "spotlight",
  description: spotlightTool.description,
  parameters: [
    {
      name: "target",
      type: "string",
      description: "Optional panel id; usually omit and pass x/y/w/h.",
    },
    ...REGION_PARAMS,
    { name: "shape", type: "string", description: "'circle' (default) or 'rect'." },
    {
      name: "label",
      type: "string",
      description: "Optional caption shown under the spotlight.",
    },
    { name: "duration", type: "number", description: "Milliseconds. Default 5000." },
  ],
};

// ── arrow — animated pointer at a spot ───────────────────────────────────────
const arrowSchema = z.object({
  target: z.string().optional(),
  x: num.min(0).max(1).optional(),
  y: num.min(0).max(1).optional(),
  from: z.enum(["left", "right", "top", "bottom", "auto"]).optional(),
  label: z.string().optional(),
  duration: num.int().positive().optional(),
});
export type ArrowArgs = z.infer<typeof arrowSchema>;
export const arrowTool = clientTool("arrow", {
  description:
    "Draw an animated arrow pointing at a spot in the live browser. Give x/y (0..1) " +
    "for the arrow TIP. Optional from = which side it flies in from. Use it for " +
    "'click this button' or 'notice this'.",
  schema: arrowSchema,
});
const arrowServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "arrow",
  description: arrowTool.description,
  parameters: [
    {
      name: "target",
      type: "string",
      description: "Optional panel id; usually omit and pass x/y.",
    },
    { name: "x", type: "number", description: "Arrow TIP x, 0..1 of viewport width." },
    { name: "y", type: "number", description: "Arrow TIP y, 0..1 of viewport height." },
    {
      name: "from",
      type: "string",
      description:
        "'left'|'right'|'top'|'bottom'|'auto' — which edge the arrow flies in from. Default auto.",
    },
    {
      name: "label",
      type: "string",
      description: "Optional short label at the arrow tail.",
    },
    { name: "duration", type: "number", description: "Milliseconds. Default 4000." },
  ],
};

// ── circle / box — glowing ring around a region ──────────────────────────────
const circleSchema = z.object({
  target: z.string().optional(),
  x: num.min(0).max(1).optional(),
  y: num.min(0).max(1).optional(),
  w: num.min(0).max(1).optional(),
  h: num.min(0).max(1).optional(),
  shape: z.enum(["circle", "box"]).optional(),
  color: z.enum(["accent", "good", "warn", "bad"]).optional(),
  label: z.string().optional(),
  duration: num.int().positive().optional(),
});
export type CircleArgs = z.infer<typeof circleSchema>;
export const circleTool = clientTool("circle", {
  description:
    "Draw a glowing circle or box around a region of the live browser. Give " +
    "x/y/w/h (0..1). Use it to ring a field, a result, or a menu item.",
  schema: circleSchema,
});
const circleServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "circle",
  description: circleTool.description,
  parameters: [
    {
      name: "target",
      type: "string",
      description: "Optional panel id; usually omit and pass x/y/w/h.",
    },
    ...REGION_PARAMS,
    { name: "shape", type: "string", description: "'circle' (default) or 'box'." },
    {
      name: "color",
      type: "string",
      description: "'accent'(default)|'good'|'warn'|'bad'.",
    },
    {
      name: "label",
      type: "string",
      description: "Optional label pill above the ring.",
    },
    { name: "duration", type: "number", description: "Milliseconds. Default 4000." },
  ],
};

// ── caption — large lower-third over the stage ───────────────────────────────
const captionSchema = z.object({
  text: z.string(),
  position: z.enum(["top", "bottom"]).optional(),
  duration: num.int().positive().optional(),
});
export type CaptionArgs = z.infer<typeof captionSchema>;
export const captionTool = clientTool("caption", {
  description:
    "Show a large lower-third caption over the stage. Use it for the key takeaway, " +
    "a term you want the class to remember, or the exact text to type.",
  schema: captionSchema,
});
const captionServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "caption",
  description: captionTool.description,
  parameters: [
    { name: "text", type: "string", description: "The caption text (required)." },
    { name: "position", type: "string", description: "'bottom'(default) or 'top'." },
    { name: "duration", type: "number", description: "Milliseconds. Default 6000." },
  ],
};

// ── clear_overlay — wipe all overlays ────────────────────────────────────────
const clearOverlaySchema = z.object({});
export type ClearOverlayArgs = z.infer<typeof clearOverlaySchema>;
export const clearOverlayTool = clientTool("clear_overlay", {
  description:
    "Remove all visual overlays (zoom, spotlight, arrow, circle, caption) and " +
    "return the live browser to normal. Call it when you move on to the next thing.",
  schema: clearOverlaySchema,
});
const clearOverlayServerDef: RealtimeToolDef = {
  type: "client_event",
  name: "clear_overlay",
  description: clearOverlayTool.description,
  parameters: [],
};

// ── The full tool set sent in the realtime CREATE payload ────────────────────
// `pageActionTools` are the built-in click / scroll_to / highlight tools (each
// already carries its own `parameters` array). They are executed in the browser
// by <PageActions/>, which resolves a target by `getElementById(target)` then
// `document.querySelector('[data-avatar-target="target"]')`. The presentation
// tools below are handled by the app's own `useClientEvent` handlers, which feed
// the <AnnotationOverlay/> over the live browser viewport.
export const RUNWAY_TOOLS: RealtimeToolDef[] = [
  ...pageActionTools,
  shareScreenServerDef,
  takeControlServerDef,
  zoomServerDef,
  spotlightServerDef,
  arrowServerDef,
  circleServerDef,
  captionServerDef,
  clearOverlayServerDef,
];

// Re-export the built-in page-action tool defs so callers that want to register
// the matching client handlers can import everything from one module.
export { pageActionTools };

/** The `data-avatar-target` / id values the stage exposes for page actions. */
export const AVATAR_TARGETS = [
  "teaching-browser",
  "lesson-steps",
  "prompt",
  "output",
  "transcript",
] as const;
