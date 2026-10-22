// Every AI provider a player can bring a key for. Each one accepts direct
// browser calls (CORS), which is what lets the game run with no backend at
// all. `kind` picks the request shape in ai/terrain.js: Gemini and Anthropic
// have their own APIs; everything else speaks OpenAI's chat-completions
// dialect at `baseUrl`. The first entry is the default selection.
export const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    defaultModel: 'gemini-flash-latest',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    // OpenAI's reasoning models reject any temperature but the default.
    temperature: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    // Any other OpenAI-compatible endpoint (Together, Fireworks, xAI, a local
    // Ollama/LM Studio…). The player supplies the base URL and model; the key
    // is optional since local servers often take none. JSON mode stays off
    // because not every compatible server implements response_format.
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    custom: true,
    defaultModel: '',
    jsonMode: false
  }
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export const modelFor = (settings, p) => settings.models[p.id] || p.defaultModel;

// A preset needs only its key; a custom endpoint needs somewhere to send the
// request and a model to ask for.
export function isUsable(settings, p) {
  return p.custom ? !!(settings.customUrl && settings.models[p.id]) : !!settings.keys[p.id];
}

// The providers a request will try, in order: the player's chosen one first,
// then every other provider they've saved a key for, as automatic backups.
export function usableProviders(settings) {
  const chosen = PROVIDER_BY_ID[settings.provider];
  return [chosen, ...PROVIDERS.filter((p) => p !== chosen)].filter((p) => p && isUsable(settings, p));
}
