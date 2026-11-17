// Nothing reaches the AI. Each call is recorded with the request the module built, and the next queued
// answer is returned, so a test can say exactly what the model replies — including a malformed answer, a
// refusal, or a truncated one.
export function aiCalls() {
	return (globalThis.__aiCalls ??= []);
}

// Queue of answers. Each is either a full message object or a shorthand: { json }, { text }, { throws },
// { refusal }, { truncated }.
export function queueAiAnswers(...answers) {
	globalThis.__aiAnswers = [...(globalThis.__aiAnswers ?? []), ...answers];
}

function toMessage(answer) {
	if (answer?.throws) throw new Error(answer.throws);

	const base = {
		model: answer?.model ?? "claude-opus-5-5",
		stop_reason: "end_turn",
		usage: { input_tokens: answer?.inputTokens ?? 1000, output_tokens: answer?.outputTokens ?? 200 },
		content: [],
	};
	if (answer?.refusal) return { ...base, stop_reason: "refusal", stop_details: { type: "refusal", category: answer.refusal } };
	if (answer?.truncated) return { ...base, stop_reason: "max_tokens", content: [{ type: "text", text: '{"one_line' }] };

	const text = answer?.json !== undefined ? JSON.stringify(answer.json) : (answer?.text ?? "");
	// A real response can carry a thinking block before the text; the module must read past it.
	return { ...base, content: [{ type: "thinking", thinking: "" }, { type: "text", text }] };
}

export default class Anthropic {
	constructor(options = {}) {
		this.options = options;
		this.beta = {
			messages: {
				create: async (request) => {
					aiCalls().push(request);
					const queue = globalThis.__aiAnswers ?? [];
					if (queue.length === 0) throw new Error("no AI answer was queued for this call");
					return toMessage(queue.shift());
				},
			},
		};
	}
}
