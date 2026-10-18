import type { LlmProvider } from "../zeroRetentionConfig";
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
export const usageModels = {openai:"gpt-5.5", anthropic:"claude-sonnet-4-6", gemini:"gemini-2.5-flash"} as const;
export type UsageFixtureProvider = keyof typeof usageModels;
export function usageFixture(provider: LlmProvider, input: unknown = 12, output: unknown = 6,
  options: {terminal?: boolean; partial?: boolean; text?: string; errorAfter?: boolean} = {}): string {
  const terminal=options.terminal !== false, text=options.text ?? "Synthetic supported answer";
  const sum=typeof input === 'number' && typeof output === 'number' ? input+output : 18;
  if(provider==='anthropic') return sse({type:'message_start',message:{usage:{input_tokens:input}}})
    +sse({type:'content_block_delta',delta:{type:'text_delta',text}})
    +(options.partial?'':sse({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:output}}))
    +(terminal?sse({type:'message_stop'}):'')+(options.errorAfter?sse({type:'error',error:{message:'Synthetic failure'}}):'');
  if(provider==='gemini') return sse({candidates:[{content:{parts:[{text}]},...(terminal?{finishReason:'STOP'}:{})}],
    usageMetadata:{promptTokenCount:input,...(options.partial?{}:{candidatesTokenCount:output,thoughtsTokenCount:0,totalTokenCount:sum})}})
    +(options.errorAfter?sse({error:{message:'Synthetic failure'}}):'');
  return sse({choices:[{delta:{content:text}}]})
    +sse({choices:[{delta:{},...(terminal?{finish_reason:'stop'}:{})}]})
    +sse({choices:[],usage:{prompt_tokens:input,...(options.partial?{}:{completion_tokens:output,total_tokens:sum})}})
    +(terminal?'data: [DONE]\n\n':'')+(options.errorAfter?sse({error:{message:'Synthetic failure'}}):'');
}
