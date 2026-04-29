# Suggester Steering Redesign

## Thesis

The current framing — predicting the next user prompt — is the wrong objective for this extension.

In practice, that framing encourages the model to:
- continue the current local thread too eagerly
- overfit to recent surface-level flow
- repeat stale momentum from earlier in the session
- imitate the user's phrasing instead of improving the direction of the work

What we actually want is a steering layer that helps the implementation agent stay aligned with the product vision, current priorities, and highest-leverage next move.

## New Product Goal

The suggester should not act like a user emulator.

It should act more like a lightweight director, editor, or rail-keeper that asks:

> What intervention would most help the implementation agent stay aligned and make the best next move?

That means the suggester is allowed to:
- zoom out when the implementation agent is too deep in details
- redirect when the agent is drifting or polishing too long
- recognize when a feature is done enough
- switch to another important area of the app
- ask a clarifying question when ambiguity is blocking progress
- suggest verification, cleanup, or closure instead of more implementation

## Core Role Separation

### Implementation agent
Focused on local execution:
- edits code
- follows the current thread
- resolves immediate issues
- can get lost in detail or momentum

### Suggester agent
Focused on strategic steering:
- keeps the implementation agent on the rails
- compares current work against the broader vision
- notices drift, loops, over-elaboration, and diminishing returns
- proposes the next best intervention, not the next likely user sentence

The suggester should be explicitly self-aware that it is **not** the feature implementation agent.

## Input Priority

For the redesigned suggester, inputs should be ranked like this:

1. **Full transcript**
   - Primary signal for what is happening now
   - Lets the suggester infer drift, completion, confusion, momentum, and recent decisions

2. **Vision / seed / project intent**
   - Primary signal for what should matter overall
   - Lets the suggester compare local work against product direction

3. **Current repo state / codebase evidence**
   - Useful when transcript alone is insufficient to judge completion or next area

4. **Persistent user preferences**
   - Only if they represent stable steering preferences
   - Example: bias toward simplification, shipping, coherence, or scope control

5. **Automatic interaction history**
   - Accepted / ignored / changed-course outcomes can still be useful
   - But they should be passive telemetry, not a high-friction manual system

## What to De-emphasize or Remove

### Repeated recent user prompts in transcript mode
If the full transcript is already present, separately injecting recent user prompts is likely redundant and may over-anchor the model to recent wording.

### Manual user corrections system
This appears too high-friction and too difficult to evaluate in real use.
If even the extension author does not naturally use it, that is a strong signal that it is not the right interaction model.

### Strong “predict the next user message” prompt framing
This encourages imitation, not steering.
It optimizes for plausibility instead of usefulness.

## New Output Model

Instead of “next user prompt prediction”, the suggester should produce the highest-leverage next intervention.

That intervention can take different forms.

### Intervention types

1. **Continue**
   - The current thread is right; keep going

2. **Verify / close loop**
   - Test it, validate it, clean it up, commit it, prove it works

3. **Zoom out / realign**
   - Re-check against the original goal, simplify, cut scope, revisit architecture

4. **Switch track**
   - The current area is done enough; move to another important part of the app

5. **Ask a question**
   - The next best move is a clarification, not more implementation

6. **Explore first**
   - The suggester lacks enough confidence and should gather more repo context first

## What “done” should mean

A key capability of the redesigned suggester is detecting when the implementation agent should stop.

That can mean:
- the requested feature is already functionally complete
- additional work is polish, not leverage
- the current line of work is no longer the highest-priority area
- the best next step is validation or switching context

This is critical. The current system tends to reward continuation. The redesigned system must be willing to say:
- this is done enough
- stop extending this flow
- move on

## Explorer Subagent (Optional)

A small explorer subagent may be useful, but only as a selective tool.

### Purpose
The explorer would gather extra evidence when the suggester is uncertain, for example by:
- reviewing current diffs
- checking whether a feature seems complete
- scanning the repo for nearby unfinished work
- comparing implementation state against the project vision
- summarizing the next likely high-leverage area

### When to use it
Only when:
- transcript suggests drift but completion is unclear
- repo state matters and is not obvious from the transcript
- the session is long and locally myopic
- the suggester has low confidence in its steering recommendation

### When not to use it
Not by default.
It should be a tool for ambiguity, not a required step on every turn.

## Prompting Direction

The redesigned prompting should make the suggester self-aware that:
- it is a steering system, not the implementation agent
- its job is to improve trajectory, not imitate the user
- it should optimize for usefulness, strategic alignment, and leverage
- it may redirect, question, close, or switch contexts when appropriate

This means the prompt should ask something closer to:

> Given the transcript, project vision, and current state, what message would most help steer the implementation agent toward the right next move?

Not:

> What would the user most likely type next?

## Evaluation Direction

The current evaluation philosophy should also shift.

### Old eval question
- Did the suggestion match the next user prompt?

### Better eval questions
- Did the suggestion reduce drift?
- Did it help the session move in a better direction?
- Did it encourage closure when needed?
- Did it surface a higher-leverage next area?
- Did it ask a good question when ambiguity was real?
- Did it stop unnecessary continuation?

The redesign should optimize for usefulness, not imitation accuracy.

## Proposed Simplification Plan

### Keep
- full transcript input
- vision / seed input
- persistent steering preferences, if truly useful
- passive telemetry from actual suggestion outcomes
- transcript-based completion / drift inference

### Remove or reduce
- explicit next-user-prompt prediction framing
- duplicated recent-user-prompt injection in transcript mode
- manual correction UX that users do not naturally adopt
- prompt wording that encourages stylistic mimicry over strategic guidance

## North Star

The target experience is not:

> “Here is my best guess at what the user would type next.”

It is:

> “Here is the intervention that most helps the implementation agent get back on the rails and make the best next move.”

That intervention might be:
- continue
- verify
- simplify
- switch tracks
- ask a question
- explore first

That is the product direction this redesign should follow.
