# Quick-action synthesis latency

Read-only diagnosis of `/gaps` turn `turn-1791149422324-nlydsn`, bundle `92085e30ec8d583795d5043d5f424e6b3c0fc06af2175646b29e0a1804da189a`: synthesis requested at 13921 ms, first visible answer at 48327 ms. The 34406 ms interval occurred after gathering handed off. Request size was 20930 characters, use case `knowledge_gaps`, model Sonnet 4.6. Google Docs search was skipped because gathering had ended. The output gate defaults to zero artificial delay.

Ordinary synthesis previously enabled thinking unconditionally. Sonnet 4.6 uses adaptive thinking at high effort. Current diagnostics have no first-thinking event, so they do not establish how much of this interval was reasoning versus provider queue/network latency.

Parent authorized a narrow policy repair: ordinary `knowledge-gaps` and `understand-repo` synthesis disables an additional thinking phase once the existing shared gather allowance is spent (15000 ms response guidance minus 6000 ms synthesis reserve). This preserves operator model selection, prompts, gathered evidence, output length, and user Stop semantics. Earlier synthesis and other/complex paths keep their existing thinking policy. The exact outgoing thinking flag is included in the existing opt-in synthesis-request diagnostic.

Deterministic regressions in responseDeadline.test.ts cover just-before/at/after the boundary, both eligible actions, and unchanged other actions/chat/edit. Parent owns execution and live requalification. No latency or answer-quality live pass is claimed until installed candidate retests confirm first-answer timing and supported evidence/unknown handling.
