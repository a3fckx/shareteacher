# Runway-First Meeting Teacher Plan

## Goal

Build a Runway-first AI meeting teacher that joins Zoom, Google Meet, or Teams, listens to humans, speaks as a Runway Character, shares a real browser, and teaches workflows in ChatGPT, YouTube, and other AI tools.

The first successful demo should look like this:

1. A participant joins a Google Meet.
2. The AI teacher joins as a visible participant.
3. The teacher speaks through a Runway preset Character and English voice.
4. The teacher shares a screen that shows a real browser.
5. The teacher opens ChatGPT, teaches how to create a PPT, answers human questions, generates the PPT, saves the transcript and artifacts, and exits cleanly.

## Core Stack

```text
Runway Character
  Face, voice, realtime conversation, screen awareness, knowledge base, tool calling.

Recall.ai
  Meeting bot that joins Zoom, Google Meet, or Teams and streams our webpage as camera or screenshare.

Kernel
  Real cloud browser runtime with persistent profiles, live view, recordings, and browser session management.

Browser Use
  Agentic browser controller for messy workflows and UI recovery.

Playwright / Stagehand
  Deterministic browser actions for repeatable lesson steps.

Next.js
  Shared teaching screen shown inside the meeting.

Postgres + Memory Store
  Users, sessions, lessons, transcripts, progress, browser traces, memory, and artifacts.
```

## Product Principle

Use Runway wherever possible. Do not build an avatar, voice, or realtime video stack ourselves unless Runway fails a concrete requirement.

Runway should own:

- preset Character
- English voice
- live conversational video
- screen and camera visual context
- lesson knowledge base
- client tools for UI actions
- server tools for backend actions
- transcript and recording retrieval

External systems are only used where Runway does not provide the required primitive:

- Recall.ai for joining third-party meetings.
- Kernel for real browser infrastructure.
- Browser Use, Playwright, and Stagehand for browser control.
- Postgres and Memory Store for durable product memory.
- Next.js for the actual classroom surface.

## Swarm Structure

### Agent 0: Orchestrator

Owns architecture, integration contracts, timeline, acceptance criteria, and merges work.

Responsibilities:

- keep the Runway-first constraint intact
- define shared APIs between agents
- decide when a dependency is good enough
- run end-to-end demos
- maintain this plan as implementation reality changes

### Agent 1: Runway Character Agent

Owns Runway integration.

Responsibilities:

- select a preset Runway Character and English voice
- configure personality prompt
- create and update lesson knowledge base
- configure client tools and server tools
- retrieve transcript and recording after sessions
- handle Runway session lifecycle and session renewal

First tools to expose:

```text
show_step
highlight_area
write_prompt
show_output
ask_checkpoint
save_artifact
```

Acceptance:

- a 5-minute Runway session works
- Character sees screen context
- Character calls UI tools correctly
- transcript is retrievable

### Agent 2: Meeting Agent

Owns Recall.ai integration.

Responsibilities:

- create meeting bot endpoint
- join Google Meet, Zoom, and Teams links
- stream our teaching webpage as bot camera or screenshare
- receive meeting transcript and audio where available
- handle waiting room, join failure, and timeout states
- stop bot cleanly after lesson

Acceptance:

- 8 out of 10 successful meeting joins
- bot starts showing the teaching screen within 90 seconds
- 10-minute meeting demo completes

### Agent 3: Browser Infra Agent

Owns Kernel browser runtime.

Responsibilities:

- create Kernel browser sessions
- configure persistent browser profiles
- support demo-account login persistence
- expose live browser view
- capture screenshots and recordings
- clean up browser sessions and timeouts

Acceptance:

- a browser can be started, viewed live, and stopped
- ChatGPT login persists between sessions
- browser recording or screenshot evidence is saved

### Agent 4: Browser Control Agent

Owns Browser Use, Playwright, and Stagehand control.

Responsibilities:

- implement browser tool bridge
- choose deterministic actions where possible
- use Browser Use for open-ended or recovery actions
- create ChatGPT workflow proof
- create YouTube workflow proof
- enforce domain allowlists and action limits

Initial server tools:

```text
start_browser_session(profile_id)
browser_open(url)
browser_observe()
browser_click(instruction)
browser_type(text)
browser_task(goal)
browser_screenshot()
browser_takeover_url()
browser_stop()
```

Acceptance:

- agent opens ChatGPT
- agent types a prompt
- agent observes visible output
- agent explains what happened
- human takeover works if login, CAPTCHA, or unexpected UI appears

### Agent 5: Teaching UI Agent

Owns the webpage streamed into meetings.

Responsibilities:

- Runway Character tile
- live browser viewport
- lesson step timeline
- prompt editor
- model/tool output panel
- transcript panel
- human takeover controls
- fallback display if browser or avatar fails

Acceptance:

- participants can understand the lesson by watching the shared page
- browser view is readable in a meeting screenshare
- text does not overlap on laptop or meeting layouts
- operator can pause, skip step, or take over

### Agent 6: Lesson Engine Agent

Owns pedagogy and lesson graph.

Responsibilities:

- define lesson graph format
- model steps, checkpoints, scoring, and artifacts
- build first three lessons
- route Runway tool calls into lesson state
- prevent the teacher from drifting into generic chatbot advice

Initial lessons:

1. Create a PPT using ChatGPT.
2. Create an image prompt using ChatGPT or an image model.
3. Use YouTube and ChatGPT for a research workflow.

Acceptance:

- each lesson has clear start, demo, student checkpoint, correction, and completion
- each lesson saves a useful artifact
- learner can repeat the workflow after the session

### Agent 7: Memory and Data Agent

Owns persistence and memory.

Responsibilities:

- users
- sessions
- lesson progress
- transcripts
- browser traces
- saved prompts
- PPT/image artifacts
- Memory Store recall and record hooks
- post-session summary page

Acceptance:

- session can be replayed or reviewed
- transcript, artifacts, and score persist
- next lesson recommendation is stored

### Agent 8: QA and Demo Agent

Owns full dry runs and measurement.

Responsibilities:

- run 10-minute Meet demo
- run 10-minute Zoom demo
- test ChatGPT login stability
- test YouTube flow
- measure Runway latency
- measure browser action latency
- measure total cost per lesson
- write known-failure notes

Acceptance:

- demo can run without an engineer narrating recovery steps
- cost and latency numbers are recorded
- failure modes are concrete and reproducible

## Phase Plan

### Phase 1: Runway-Only Proof

Goal: prove the teacher can talk, see screen context, and call tools.

Build:

- Runway preset Character with English voice.
- One knowledge-base lesson.
- Next.js page with Runway avatar.
- Client tools: `show_step`, `highlight_area`, `write_prompt`, `show_output`.
- Transcript and recording retrieval.

Acceptance:

- 5-minute live session works.
- Character responds naturally.
- Character sees shared screen.
- Character triggers UI tools correctly.
- Transcript is retrievable after the call.

### Phase 2: Real Browser Proof

Goal: give the teacher a real browser.

Build:

- Kernel browser session.
- Persistent browser profile.
- Browser live view embedded in teaching screen.
- Browser Use and Playwright tool bridge.
- Human takeover path.

Acceptance:

- agent opens ChatGPT
- agent types prompt
- agent reads visible result
- agent explains the result
- human can take over on login, CAPTCHA, or popup

### Phase 3: First Lesson

Goal: teach one useful workflow end to end.

Lesson:

```text
How to create a PPT using ChatGPT
```

Flow:

1. Human gives a presentation topic.
2. Teacher opens ChatGPT.
3. Teacher writes a prompt.
4. Teacher generates slide outline.
5. Teacher revises with human feedback.
6. App exports a `.pptx`.
7. Teacher summarizes reusable workflow.

Acceptance:

- 15-minute lesson completes.
- Browser remains visible.
- Human interrupts at least twice and teacher adapts.
- PPT artifact is saved.
- Reusable prompt template is saved.

### Phase 4: Meeting Integration

Goal: bring the teacher into real meetings.

Build:

- Recall bot creation endpoint.
- Bot joins Google Meet, Zoom, and Teams.
- Bot streams teaching screen.
- Meeting participants hear the Runway Character.
- Browser view is visible in meeting.

Acceptance:

- 8 out of 10 successful joins.
- Bot starts teaching within 90 seconds.
- 10-minute meeting lesson completes.
- Bot exits cleanly.

### Phase 5: Multi-App Lessons

Goal: expand beyond one ChatGPT lesson.

Add:

- ChatGPT PPT creation.
- ChatGPT image prompt creation.
- YouTube research workflow.
- One external AI tool such as Gamma, Canva, Perplexity, or Claude.

Acceptance:

- each lesson has deterministic fallback steps
- browser autonomy does not require more than two human recoveries per 15 minutes
- lesson artifacts are saved
- post-session summary is generated

## Execution Order

Do not build everything in parallel without dependency order.

```text
Runway proof
  -> Teaching UI
  -> Kernel browser
  -> Browser Use bridge
  -> ChatGPT lesson
  -> Recall meeting mode
  -> Memory and artifacts
  -> multi-app expansion
```

## Browser Strategy

Use Kernel as the browser environment and Browser Use as one control layer.

Kernel gives:

- cloud Chromium
- persistent profiles
- live view
- MP4 recordings
- stealth/proxy/CAPTCHA support
- scalable browser sessions

Browser Use gives:

- open-ended web task execution
- recovery from UI drift
- natural-language browser control
- page observation and action planning

Playwright and Stagehand should handle repeatable lesson steps where possible. Browser Use should handle messy or adaptive actions.

Preferred control order:

```text
Playwright deterministic action
  -> Stagehand AI-assisted action
  -> Browser Use open-ended recovery
  -> human takeover
```

## Critical Risks

### Runway Session Duration

Runway realtime sessions may require duration caps and renewal. The implementation must support session chaining or fast restart.

### ChatGPT Login and CAPTCHA

The browser stack must support persistent profiles and human takeover. The first demo should use controlled demo accounts.

### Over-Autonomous Browser Actions

Browser Use should not free-run inside a live class. It should operate under lesson-state constraints and domain allowlists.

### Meeting Reliability

Recall integration can be operationally messy due to waiting rooms, host permissions, platform differences, and network failures. Keep the in-app classroom demo as fallback.

### Browser Audio

YouTube browser audio may need separate routing if the meeting participants must hear page audio. For v1, the teacher can narrate and control YouTube without relying on browser audio.

## Cost Targets

Initial media-layer estimate:

```text
Runway Character: about $0.22 first minute, then about $0.20/min
Recall.ai bot: about $0.008/min
```

Target total cost for a 20-minute lesson:

```text
Media layer: about $4.25
All-in prototype ceiling: less than $10 per 20-minute lesson
Production target: less than $5 per 20-minute lesson
```

## Demo Script

1. Start a Google Meet.
2. Invite the AI teacher bot.
3. Teacher joins and greets participants.
4. Teacher shares the teaching screen.
5. Teacher asks: "What PPT do you want to create?"
6. Human answers with a topic.
7. Teacher opens ChatGPT in the real browser.
8. Teacher writes a strong PPT prompt.
9. Teacher explains each part of the prompt.
10. Teacher submits the prompt and reads the output.
11. Human asks for changes.
12. Teacher revises the prompt and output.
13. App creates a `.pptx`.
14. Teacher summarizes the reusable workflow.
15. Session page saves transcript, prompt template, browser trace, and PPT.

## Definition of Done for V1

V1 is done when:

- the teacher can join a real meeting
- participants can hear the teacher
- participants can see the teacher and browser
- teacher can operate ChatGPT in a real browser
- teacher can teach one full PPT workflow
- teacher can answer interruptions
- artifact is saved
- transcript is saved
- operator can take over
- session can end cleanly

