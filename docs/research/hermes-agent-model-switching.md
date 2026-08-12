# Hermes Agent Model Switching and Routing

Date: 2026-07-25

## Question

Does Nous Research Hermes Agent support automatic intelligent model switching per task, including main chat routing, auxiliary tasks, subagents, fallbacks, MoA/router behavior, or only manual `/model` / `hermes model` switching?

## Bottom Line

Hermes Agent does not currently provide native automatic intelligent model switching for the main chat based on task type or context. The main agent runs on a selected main model until the user explicitly switches it, or until configured failure fallback fires. Hermes does support separate auxiliary model slots, static subagent model overrides, automatic failure fallback, provider routing within aggregators such as OpenRouter/Nous Portal, and Mixture of Agents as a selectable model provider or one-shot `/moa` command. Those features are not the same as transparent per-task model routing for the main chat.

## Findings

| Capability | Supported? | Finding |
|---|---:|---|
| Main chat automatic task-based model switching | No | Hermes documents one main model for user messages, tool-call loops, and streamed responses. Existing sessions keep their model; changing the running chat uses explicit `/model`. GitHub feature requests describe automatic role/capability routing as currently missing or not planned. |
| Manual main model switching | Yes | Users can switch globally through dashboard/`hermes model`, or in a running session with `/model`, including `/model ... --once` for one turn. |
| Auxiliary task automatic model selection | Partial | Hermes has auxiliary slots for side jobs such as compression, vision, web extraction, approval scoring, MCP routing, title generation, and skill search. Each slot can be configured independently. Default `provider: auto` first uses the main model, then task fallback, top-level fallback, and built-in discovery chains. This is per-auxiliary-task plumbing, not semantic routing of arbitrary main-chat work. |
| Subagents | Partial | Hermes can spawn isolated subagents. Current docs say subagents inherit the parent provider/model by default, or can use a static `delegation.provider` / `delegation.model` override. The docs do not describe automatic per-subtask model choice. Several GitHub issues request per-task/profile subagent model routing, suggesting that dynamic subagent routing is not native behavior. |
| Fallbacks | Yes, failure-based | Hermes can automatically switch to configured fallback provider:model pairs when the primary provider fails with rate limits, server errors, auth failures, not-found errors, or repeated invalid responses. This is resilience/error handling, not "pick the best model for this task." |
| Provider routing | Yes, provider-level only | With OpenRouter or Nous Portal, Hermes can pass provider-routing preferences such as cheapest/fastest provider, whitelist, blacklist, or explicit provider order. This selects underlying providers for a chosen model/provider path; it does not classify tasks and switch main models. |
| MoA / model-of-agent | Yes, manual/selectable | Mixture of Agents is exposed as a normal provider in the model system. Users select an MoA preset with `/model <preset> --provider moa` or run one prompt through `/moa`; Hermes then restores the previous model. This is not automatic task detection. |

## Evidence

- Hermes' model configuration docs define two model-slot classes: a main model and auxiliary models. The main model is used for user messages, tool-call loops, and streamed responses; auxiliary models are side jobs with independently overridable slots. Source: Hermes Agent docs, "Configuring Models": https://hermes-agent.nousresearch.com/docs/user-guide/configuring-models
- The same page says changing the dashboard model applies to new sessions only; active chats keep the model they started with, and `/model` is used to hot-swap the current session. It also documents `/model ... --once` as one-turn manual switching. Source: https://hermes-agent.nousresearch.com/docs/user-guide/configuring-models
- The fallback docs say primary fallback activates automatically on provider/API failures and swaps provider:model in-place while preserving conversation state. They also say fallback is turn-scoped and the primary is retried on the next user message. Source: Hermes Agent docs, "Fallback Providers": https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers
- The fallback docs list auxiliary tasks with independent provider resolution and describe the default auto chain: main provider/model, task fallback, top-level fallback, then built-in auxiliary discovery. Source: https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers
- The configuration docs say subagents inherit the parent provider/model by default, with static `delegation.provider` and `delegation.model` overrides available in config. Source: Hermes Agent docs, "Configuration": https://hermes-agent.nousresearch.com/docs/user-guide/configuration
- The subagent docs describe `delegate_task` as spawning isolated child agents with fresh conversation context and inherited tool access. The delegation guide describes parallel work patterns but not automatic per-task model selection. Sources: https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation and https://hermes-agent.nousresearch.com/docs/guides/delegation-patterns
- The provider routing docs define routing as fine-grained control over underlying providers when using OpenRouter or Nous Portal, with options for price, throughput, latency, allowlists, denylists, and explicit order. Source: Hermes Agent docs, "Provider Routing": https://hermes-agent.nousresearch.com/docs/user-guide/features/provider-routing
- The MoA docs say MoA presets are selectable through normal model-picking surfaces, and `/moa` is one-shot convenience sugar that runs a prompt through the default preset and restores the previous model. Source: Hermes Agent docs, "Mixture of Agents": https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents
- NousResearch issue #38954 states that Hermes currently requires manual `/model` switching or subagent delegation for different task models and proposes context-aware model routing. Source: https://github.com/NousResearch/hermes-agent/issues/38954
- NousResearch issue #32704 says Hermes currently uses a single model per agent session and that there is no native way to configure transparent capability-based routing; it is marked duplicate. Source: https://github.com/NousResearch/hermes-agent/issues/32704
- NousResearch issue #21827 proposes topic-aware subagent routing and is closed as not planned. Source: https://github.com/NousResearch/hermes-agent/issues/21827
- NousResearch issue #59943 asks for a smart router/dynamic LLM routing and is closed as not planned. Source: https://github.com/NousResearch/hermes-agent/issues/59943
- NousResearch issue #18591 requests per-task model override for `delegate_task` subagents and is marked duplicate, reinforcing that per-task subagent model choice is request-level rather than documented native behavior. Source: https://github.com/NousResearch/hermes-agent/issues/18591

## Practical Interpretation

If the goal is "use model A for planning, model B for coding, model C for research, and switch automatically based on what I ask," Hermes does not currently advertise that as a native feature. The closest built-in options are:

- Manually switch the main chat with `/model`, `hermes model`, or `/model ... --once`.
- Configure fixed auxiliary slots for known side jobs.
- Configure static subagent provider/model overrides.
- Configure failure fallbacks for resilience.
- Select an MoA preset manually, or use `/moa` for one prompt.
- Use OpenRouter/Nous Portal provider-routing knobs for provider choice behind a selected model path.
